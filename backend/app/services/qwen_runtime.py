from __future__ import annotations

import json
import os
import subprocess
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .env_loader import load_env_file
from .runtime_config import qwen_endpoint, qwen_model


load_env_file()

_PROBE_CACHE: dict[str, Any] = {"expires": 0.0, "result": {"mode": "unknown", "detail": "not probed"}}
_GPU_CACHE: dict[str, Any] = {"expires": 0.0, "result": {"available": False, "detail": "not probed"}}
_RESIDENCY_CACHE: dict[str, Any] = {"expires": 0.0, "result": {"loaded": False, "detail": "not probed"}}

QWEN_TASK_PROFILES: dict[str, dict[str, Any]] = {
    "decision": {"tokens": 420, "temperature": 0.1, "topP": 0.72, "timeoutSeconds": 35, "jsonMode": True},
    "document": {"tokens": 520, "temperature": 0.12, "topP": 0.74, "timeoutSeconds": 35, "jsonMode": True},
    "flow": {"tokens": 420, "temperature": 0.1, "topP": 0.7, "timeoutSeconds": 32, "jsonMode": True},
    "counterfactual": {"tokens": 260, "temperature": 0.08, "topP": 0.68, "timeoutSeconds": 28, "jsonMode": True},
    "agent": {"tokens": 560, "temperature": 0.12, "topP": 0.72, "timeoutSeconds": 38, "jsonMode": True},
}


def build_qwen_runtime(epoch: float) -> dict[str, Any]:
    requested_context_window = _int_env("QWEN_CONTEXT_TOKENS", 4096)
    output_tokens = _int_env("QWEN_OUTPUT_TOKENS", 768)
    gpu_layers = _int_env("QWEN_GPU_LAYERS", 99)
    threads = _int_env("QWEN_THREADS", max(4, (os.cpu_count() or 8) - 2))
    batch_size = _int_env("QWEN_BATCH_SIZE", 1024)
    endpoint = qwen_endpoint()
    runtime = os.getenv("QWEN_RUNTIME", "llama.cpp / Ollama compatible")
    quantization = os.getenv("QWEN_QUANTIZATION", "Q4_K_M or Q5_K_M preferred")
    model = qwen_model()
    probe = probe_qwen_runtime(endpoint, model)
    gpu = gpu_health()
    residency = qwen_residency(endpoint, model)
    context_window = adaptive_context_window(requested_context_window, gpu, residency)
    cache_hit_rate = round(_bounded(72 + _wave(epoch, 2, 11), 0, 99), 1)
    tokens_per_second = round(_bounded(18 + gpu_layers / 9 + batch_size / 260 + _wave(epoch, 4, 2.4), 5, 82), 1)
    latency_ms = int(_bounded(980 - cache_hit_rate * 4 + _wave(epoch, 5, 90), 160, 1800))
    health_score = round(_bounded(82 + _wave(epoch, 1, 8), 0, 100), 1)

    return {
        "model": model,
        "runtime": runtime,
        "endpoint": endpoint,
        "mode": probe["mode"],
        "availabilityDetail": probe["detail"],
        "quantization": quantization,
        "requestedContextWindow": requested_context_window,
        "contextWindow": context_window,
        "effectiveContextWindow": context_window,
        "reservedOutputTokens": output_tokens,
        "promptBudgetTokens": max(2048, context_window - output_tokens - 1536),
        "gpuLayers": gpu_layers,
        "threads": threads,
        "batchSize": batch_size,
        "mmap": _bool_env("QWEN_MMAP", True),
        "flashAttention": _bool_env("QWEN_FLASH_ATTENTION", True),
        "temperature": _float_env("QWEN_TEMPERATURE", 0.18),
        "topP": _float_env("QWEN_TOP_P", 0.82),
        "repeatPenalty": _float_env("QWEN_REPEAT_PENALTY", 1.08),
        "cachePolicy": "case-hash + evidence-hash semantic cache",
        "promptPacking": "task-profiled, facts-first, cited IDs only, compact JSON packs, no raw page flooding",
        "optimizationProfile": {
            "name": "qwen3.5-4b-underwriting-balanced",
            "goal": "low-latency cited JSON reasoning for document, flow, audit, and agent workflows",
            "jsonMode": _bool_env("QWEN_JSON_MODE", True),
            "seed": _int_env("QWEN_SEED", 17),
            "taskProfiles": QWEN_TASK_PROFILES,
            "evidencePolicy": [
                "rank top anomalies, paths, and source signals before prompting",
                "strip UI-only geometry and repeated provenance from prompts",
                "normalize malformed model JSON before fallback",
                "prefer deterministic fallback over uncited or non-schema answers",
            ],
        },
        "healthScore": health_score,
        "tokensPerSecond": tokens_per_second,
        "latencyMs": latency_ms,
        "cacheHitRate": cache_hit_rate,
        "gpu": gpu,
        "residency": residency,
        "pipeline": [
            {"stage": "deterministic detectors", "role": "produce facts before LLM reasoning"},
            {"stage": "evidence compressor", "role": "rank anomalies and trim repeated OCR text"},
            {"stage": "Qwen structured reasoning", "role": "explain risk, cite evidence, draft actions"},
            {"stage": "schema repair guard", "role": "reject malformed or uncited model output"},
        ],
        "maxOutChecklist": [
            "Use quantized GGUF Q4_K_M for CPU-first demos or Q5_K_M when VRAM/RAM allows.",
            "Warm the model at 4096 context and promote to 8192 only when VRAM headroom is safe.",
            "Enable mmap, flash attention, prompt cache, and all safe GPU layers for the machine.",
            "Use temperature <= 0.2 for underwriting consistency and JSON-schema reliability.",
            "Route each endpoint through a smaller task profile instead of one generic generation setup.",
            "Keep prompts below 4096 context by compressing evidence IDs, risks, and source URLs before generation.",
        ],
    }


def adaptive_context_window(requested_context_window: int, gpu: dict[str, Any], residency: dict[str, Any]) -> int:
    if requested_context_window <= 4096:
        return max(2048, requested_context_window)
    if not gpu.get("available"):
        return min(requested_context_window, 4096)

    free_mb = int(gpu.get("memoryFreeMb") or 0)
    total_mb = int(gpu.get("memoryTotalMb") or 0)
    loaded_context = int(residency.get("contextWindow") or 0)
    if loaded_context:
        return min(requested_context_window, loaded_context)
    if total_mb >= 10000 and free_mb >= 4500:
        return min(requested_context_window, 8192)
    if free_mb >= 5200:
        return min(requested_context_window, 8192)
    return min(requested_context_window, 4096)


def gpu_health() -> dict[str, Any]:
    now = time.time()
    if now < _GPU_CACHE["expires"]:
        return _GPU_CACHE["result"]

    result = _probe_gpu_health()
    _GPU_CACHE["result"] = result
    _GPU_CACHE["expires"] = now + 10
    return result


def _probe_gpu_health() -> dict[str, Any]:
    try:
        output = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=3,
        ).strip()
        if not output:
            raise OSError("nvidia-smi returned no GPU rows")
        name, total, used, free, utilization = [part.strip() for part in output.splitlines()[0].split(",")]
        return {
            "available": True,
            "name": name,
            "memoryTotalMb": int(total),
            "memoryUsedMb": int(used),
            "memoryFreeMb": int(free),
            "utilizationPct": int(utilization),
            "detail": f"{name}: {free} MB free of {total} MB",
        }
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return {"available": False, "detail": f"GPU probe unavailable: {exc}"}


def qwen_residency(endpoint: str, model: str) -> dict[str, Any]:
    now = time.time()
    if now < _RESIDENCY_CACHE["expires"]:
        return _RESIDENCY_CACHE["result"]

    result = _probe_qwen_residency(endpoint, model)
    _RESIDENCY_CACHE["result"] = result
    _RESIDENCY_CACHE["expires"] = now + 10
    return result


def _probe_qwen_residency(endpoint: str, model: str) -> dict[str, Any]:
    endpoint = endpoint.rstrip("/")
    api_style = os.getenv("QWEN_API_STYLE", "ollama" if "11434" in endpoint else "llama_cpp")
    if api_style != "ollama":
        return {"loaded": False, "processor": "unknown", "contextWindow": 0, "detail": "Residency probe is only implemented for Ollama"}
    try:
        request = Request(f"{endpoint}/api/ps", method="GET")
        with urlopen(request, timeout=2.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        for item in payload.get("models", []):
            if item.get("name") == model or item.get("model") == model:
                return {
                    "loaded": True,
                    "processor": item.get("processor", "unknown"),
                    "contextWindow": int(item.get("context_length") or item.get("context", 0) or 0),
                    "until": item.get("expires_at", item.get("until", "")),
                    "size": item.get("size", 0),
                    "detail": f"{model} resident on {item.get('processor', 'unknown')}",
                }
        return {"loaded": False, "processor": "none", "contextWindow": 0, "detail": f"{model} is installed but not currently resident"}
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {"loaded": False, "processor": "unknown", "contextWindow": 0, "detail": f"Residency probe failed: {exc}"}


def probe_qwen_runtime(endpoint: str, model: str) -> dict[str, str]:
    now = time.time()
    if now < _PROBE_CACHE["expires"]:
        return _PROBE_CACHE["result"]

    result = _probe_qwen_runtime(endpoint, model)
    _PROBE_CACHE["result"] = result
    _PROBE_CACHE["expires"] = now + 12
    return result


def _probe_qwen_runtime(endpoint: str, model: str) -> dict[str, str]:
    if not endpoint:
        return {"mode": "standby", "detail": "QWEN_ENDPOINT is not configured"}

    endpoint = endpoint.rstrip("/")
    api_style = os.getenv("QWEN_API_STYLE", "ollama" if "11434" in endpoint else "llama_cpp")
    try:
        if api_style == "ollama":
            request = Request(f"{endpoint}/api/tags", method="GET")
            with urlopen(request, timeout=2.5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            model_names = {item.get("name", "") for item in payload.get("models", [])}
            if model in model_names:
                return {"mode": "active", "detail": f"Ollama model {model} is installed and API is reachable"}
            return {"mode": "degraded", "detail": f"Ollama is reachable, but {model} is not in the local model list"}

        request = Request(f"{endpoint}/health", method="GET")
        with urlopen(request, timeout=2.5):
            return {"mode": "active", "detail": "llama.cpp server health endpoint is reachable"}
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return {"mode": "standby", "detail": f"Qwen runtime probe failed: {exc}"}


def build_qwen_decision_brief(
    active_case: dict[str, Any], category_scores: list[dict[str, Any]], signals: list[dict[str, Any]], epoch: float
) -> dict[str, Any]:
    top_category = max(category_scores, key=lambda item: item["score"])
    top_signal = max(signals, key=lambda item: item["confidence"])
    risk_score = active_case["riskScore"]
    action = _recommended_action(risk_score)

    return {
        "headline": f"{action}: {top_category['name']} is driving the current risk posture.",
        "summary": (
            f"Qwen should receive the top evidence pack for {active_case['id']}: "
            f"{len(active_case['anomalies'])} anomaly facts, {active_case['evidenceCount']} evidence objects, "
            f"and the highest-confidence {top_signal['type']} signal from {top_signal['source']}."
        ),
        "recommendedAction": action,
        "confidence": round(_bounded(77 + risk_score / 5 + _wave(epoch, 7, 4), 0, 98), 1),
        "materialityScore": round(_bounded((risk_score * 0.62) + (top_category["score"] * 0.38), 0, 100), 1),
        "evidenceCitations": [
            {"id": f"EV-{active_case['id']}-DOC", "label": active_case["anomalies"][0], "weight": "primary"},
            {"id": f"EV-{top_signal['id']}", "label": top_signal["title"], "weight": "external corroboration"},
            {"id": f"EV-{active_case['id']}-GRAPH", "label": "Entity graph path requires reviewer confirmation", "weight": "relationship risk"},
        ],
        "reviewerPrompts": [
            "Verify the original source document against issuer or registrar records before disbursement.",
            "Ask the branch officer to confirm whether the applicant supplied the disputed evidence directly.",
            "Record reviewer feedback so future scoring weights learn from this decision.",
        ],
        "guardrails": [
            "Do not auto-reject; route to human underwriting review with evidence.",
            "Do not cite any source unless the connector preserved URL, timestamp, and parser provenance.",
            "Do not expose private borrower data to external model endpoints.",
        ],
    }


def _recommended_action(risk_score: float) -> str:
    if risk_score >= 75:
        return "Escalate to fraud-risk review"
    if risk_score >= 55:
        return "Hold for enhanced verification"
    if risk_score >= 35:
        return "Proceed with targeted reviewer checks"
    return "Proceed with standard underwriting controls"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.lower() in {"1", "true", "yes", "on"}


def _wave(epoch: float, seed: int, amplitude: float) -> float:
    return __import__("math").sin(epoch / 11 + seed * 1.37) * amplitude


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def runtime_health() -> dict[str, Any]:
    return build_qwen_runtime(time.time())
