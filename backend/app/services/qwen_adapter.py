from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .document_intelligence import (
    deterministic_counterfactual,
    deterministic_document_explanation,
    document_explanation_pack,
)
from .flow_engine import flow_prompt_pack
from .qwen_runtime import QWEN_TASK_PROFILES, build_qwen_runtime
from .runtime_config import qwen_endpoint


def generate_qwen_decision(snapshot: dict[str, Any]) -> dict[str, Any]:
    runtime = build_qwen_runtime(time.time())
    prompt = _build_prompt(snapshot)
    endpoint = qwen_endpoint().rstrip("/")

    if not endpoint:
        return {
            "mode": "standby",
            "model": runtime["model"],
            "latencyMs": 0,
            "output": snapshot["qwenBrief"],
            "promptPreview": prompt[:900],
            "note": "Set QWEN_ENDPOINT to Ollama or llama.cpp to enable live local Qwen inference.",
        }

    started = time.perf_counter()
    try:
        raw_output = _call_runtime(endpoint, runtime, prompt, task="decision", json_mode=True)
        output = _parse_json_object(raw_output) or raw_output
        return {
            "mode": "active",
            "model": runtime["model"],
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "output": output,
            "promptPreview": prompt[:900],
            "note": "Local Qwen response returned by configured runtime.",
        }
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {
            "mode": "fallback",
            "model": runtime["model"],
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "output": snapshot["qwenBrief"],
            "promptPreview": prompt[:900],
            "note": f"Qwen runtime unavailable, using deterministic brief: {exc}",
        }


def generate_qwen_text(prompt: str, output_tokens: int = 512, task: str = "default", json_mode: bool | None = None) -> dict[str, Any]:
    runtime = build_qwen_runtime(time.time())
    endpoint = qwen_endpoint().rstrip("/")
    if not endpoint:
        return {"mode": "standby", "model": runtime["model"], "text": "", "latencyMs": 0, "note": "QWEN_ENDPOINT is not configured"}

    started = time.perf_counter()
    runtime = _task_runtime(runtime, task, output_tokens)
    use_json_mode = _task_json_mode(task) if json_mode is None else json_mode
    try:
        return {
            "mode": "active",
            "model": runtime["model"],
            "task": task,
            "text": _call_runtime(endpoint, runtime, prompt, task=task, json_mode=use_json_mode),
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "note": "Local Qwen text response returned by configured runtime.",
        }
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {
            "mode": "fallback",
            "model": runtime["model"],
            "task": task,
            "text": "",
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "note": f"Qwen text generation failed: {exc}",
        }


def generate_qwen_flow_brief(snapshot: dict[str, Any], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    pack = flow_prompt_pack(snapshot, payload)
    fallback = snapshot.get("qwenFlowBrief", {})
    prompt = _build_flow_prompt(pack)
    qwen = generate_qwen_text(prompt, output_tokens=420, task="flow", json_mode=True)
    parsed = _parse_json_object(qwen.get("text", ""))
    if not parsed:
        return {
            "mode": "fallback",
            "model": qwen.get("model", snapshot.get("qwenRuntime", {}).get("model", "")),
            "latencyMs": qwen.get("latencyMs", 0),
            "output": fallback,
            "promptPreview": prompt[:900],
            "note": qwen.get("note", "Qwen flow response unavailable; deterministic flow brief returned."),
        }
    output = _normalize_flow_brief(parsed, fallback, pack)
    return {
        "mode": qwen.get("mode", "active"),
        "model": qwen.get("model", snapshot.get("qwenRuntime", {}).get("model", "")),
        "latencyMs": qwen.get("latencyMs", 0),
        "output": output,
        "promptPreview": prompt[:900],
        "note": "Local Qwen flow explanation returned by configured runtime.",
    }


def generate_qwen_document_explanation(snapshot: dict[str, Any], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    pack = document_explanation_pack(snapshot, payload)
    fallback = deterministic_document_explanation(snapshot, payload)
    prompt = _build_document_explanation_prompt(pack)
    qwen = generate_qwen_text(prompt, output_tokens=520, task="document", json_mode=True)
    parsed = _parse_json_object(qwen.get("text", ""))
    if not parsed:
        return {
            "mode": "fallback",
            "model": qwen.get("model", snapshot.get("qwenRuntime", {}).get("model", "")),
            "latencyMs": qwen.get("latencyMs", 0),
            "output": fallback,
            "promptPreview": prompt[:900],
            "note": qwen.get("note", "Qwen document explanation unavailable; deterministic explanation returned."),
        }
    output = _normalize_document_explanation(parsed, fallback)
    return {
        "mode": qwen.get("mode", "active"),
        "model": qwen.get("model", snapshot.get("qwenRuntime", {}).get("model", "")),
        "latencyMs": qwen.get("latencyMs", 0),
        "output": output,
        "promptPreview": prompt[:900],
        "note": "Local Qwen document explanation returned by configured runtime.",
    }


def generate_qwen_counterfactual(snapshot: dict[str, Any], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    pack = document_explanation_pack(snapshot, payload)
    fallback = deterministic_counterfactual(snapshot, payload)
    prompt = _build_counterfactual_prompt(pack, fallback)
    qwen = generate_qwen_text(prompt, output_tokens=260, task="counterfactual", json_mode=True)
    parsed = _parse_json_object(qwen.get("text", ""))
    if not parsed:
        return {
            "mode": "fallback",
            "model": qwen.get("model", snapshot.get("qwenRuntime", {}).get("model", "")),
            "latencyMs": qwen.get("latencyMs", 0),
            "output": fallback,
            "promptPreview": prompt[:900],
            "note": qwen.get("note", "Qwen counterfactual unavailable; deterministic counterfactual returned."),
        }
    output = {
        **fallback,
        "mode": qwen.get("mode", "active"),
        "summary": str(parsed.get("summary") or fallback["summary"]),
        "recommendedAction": str(parsed.get("recommendedAction") or parsed.get("nextAction") or ""),
    }
    return {
        "mode": qwen.get("mode", "active"),
        "model": qwen.get("model", snapshot.get("qwenRuntime", {}).get("model", "")),
        "latencyMs": qwen.get("latencyMs", 0),
        "output": output,
        "promptPreview": prompt[:900],
        "note": "Local Qwen counterfactual returned by configured runtime.",
    }


def _task_runtime(runtime: dict[str, Any], task: str, requested_tokens: int) -> dict[str, Any]:
    profile = QWEN_TASK_PROFILES.get(task, {})
    reserved_tokens = _int_override(f"QWEN_{task.upper()}_OUTPUT_TOKENS", int(profile.get("tokens", requested_tokens)))
    temperature = _float_override(f"QWEN_{task.upper()}_TEMPERATURE", float(profile.get("temperature", runtime["temperature"])))
    top_p = _float_override(f"QWEN_{task.upper()}_TOP_P", float(profile.get("topP", runtime["topP"])))
    timeout = _float_override(f"QWEN_{task.upper()}_TIMEOUT_SECONDS", float(profile.get("timeoutSeconds", os.getenv("QWEN_TIMEOUT_SECONDS", "30"))))
    return {
        **runtime,
        "task": task,
        "reservedOutputTokens": min(reserved_tokens, runtime["reservedOutputTokens"]),
        "temperature": temperature,
        "topP": top_p,
        "timeoutSeconds": timeout,
        "seed": int(os.getenv("QWEN_SEED", "17")),
    }


def _task_json_mode(task: str) -> bool:
    profile = QWEN_TASK_PROFILES.get(task, {})
    default = bool(profile.get("jsonMode", False))
    raw_value = os.getenv(f"QWEN_{task.upper()}_JSON_MODE", os.getenv("QWEN_JSON_MODE", str(default))).lower()
    return raw_value in {"1", "true", "yes", "on"}


def _call_runtime(endpoint: str, runtime: dict[str, Any], prompt: str, task: str = "default", json_mode: bool = False) -> str:
    api_style = os.getenv("QWEN_API_STYLE", _infer_api_style(endpoint))
    timeout = float(runtime.get("timeoutSeconds") or os.getenv("QWEN_TIMEOUT_SECONDS", "30"))

    if api_style == "ollama":
        think_mode = _bool_env("QWEN_THINK_MODE", False)
        payload = {
            "model": runtime["model"],
            "prompt": prompt,
            "stream": False,
            "think": think_mode,
            "keep_alive": os.getenv("QWEN_KEEP_ALIVE", "30m"),
            "options": {
                "num_ctx": runtime["contextWindow"],
                "num_predict": runtime["reservedOutputTokens"],
                "temperature": runtime["temperature"],
                "top_p": runtime["topP"],
                "repeat_penalty": runtime["repeatPenalty"],
                "num_batch": runtime["batchSize"],
                "num_thread": runtime["threads"],
                "num_gpu": runtime["gpuLayers"],
                "seed": int(os.getenv("QWEN_SEED", str(runtime.get("seed", 17)))),
            },
        }
        if json_mode:
            payload["format"] = "json"
        response = _post_json(f"{endpoint}/api/generate", payload, timeout)
        return str(response.get("response", "")).strip()

    payload = {
        "prompt": prompt,
        "n_predict": runtime["reservedOutputTokens"],
        "temperature": runtime["temperature"],
        "top_p": runtime["topP"],
        "repeat_penalty": runtime["repeatPenalty"],
        "cache_prompt": True,
        "slot_id": int(os.getenv("QWEN_SLOT_ID", "0")),
    }
    response = _post_json(f"{endpoint}/completion", payload, timeout)
    return str(response.get("content", response.get("response", ""))).strip()


def warm_qwen_model() -> dict[str, Any]:
    runtime = build_qwen_runtime(time.time())
    endpoint = qwen_endpoint().rstrip("/")
    if not endpoint:
        return {"mode": "standby", "detail": "QWEN_ENDPOINT is not configured"}

    api_style = os.getenv("QWEN_API_STYLE", _infer_api_style(endpoint))
    timeout = float(os.getenv("QWEN_WARM_TIMEOUT_SECONDS", "120"))
    try:
        if api_style == "ollama":
            think_mode = _bool_env("QWEN_THINK_MODE", False)
            payload = {
                "model": runtime["model"],
                "prompt": "Return OK.",
                "stream": False,
                "think": think_mode,
                "keep_alive": os.getenv("QWEN_KEEP_ALIVE", "30m"),
                "options": {
                    "num_ctx": min(runtime["contextWindow"], 4096),
                    "num_predict": 1,
                    "temperature": 0,
                    "num_batch": runtime["batchSize"],
                    "num_thread": runtime["threads"],
                    "num_gpu": runtime["gpuLayers"],
                },
            }
            _post_json(f"{endpoint}/api/generate", payload, timeout)
        else:
            payload = {"prompt": "OK", "n_predict": 1, "temperature": 0, "cache_prompt": True}
            _post_json(f"{endpoint}/completion", payload, timeout)
        return {"mode": "active", "detail": f"{runtime['model']} warmed with keep-alive"}
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        return {"mode": "standby", "detail": f"Qwen warmup failed: {exc}"}


async def qwen_keepalive_loop() -> None:
    interval = int(os.getenv("QWEN_KEEPALIVE_INTERVAL_SECONDS", "120"))
    while True:
        await asyncio.to_thread(warm_qwen_model)
        await asyncio.sleep(interval)


def _build_prompt(snapshot: dict[str, Any]) -> str:
    case = snapshot["activeCase"]
    brief = snapshot["qwenBrief"]
    runtime = snapshot["qwenRuntime"]
    evidence = "\n".join(f"- {item['label']} ({item['weight']})" for item in brief["evidenceCitations"])
    anomalies = "\n".join(f"- {item}" for item in case["anomalies"])
    top_signals = "\n".join(
        f"- {signal['type']} | {signal['source']} | {signal['confidence']}% | {signal['title']}"
        for signal in snapshot["signals"][:3]
    )

    return f"""/no_think
You are SuRaksha Sentinel's local Qwen 3.5 4B underwriting risk analyst.
Return concise JSON with keys: recommendedAction, confidence, materialityScore, rationale, nextChecks, citations.
Use only the supplied evidence. Do not invent public-source claims. Do not auto-reject; produce human-review decision support.

Runtime constraints:
- Prompt budget: {runtime['promptBudgetTokens']} tokens
- Temperature target: {runtime['temperature']}
- Evidence packing: {runtime['promptPacking']}

Case:
- ID: {case['id']}
- Applicant: {case['applicant']}
- Loan type: {case['loanType']}
- Location: {case['location']}
- Risk score: {case['riskScore']}
- Stage: {case['stage']}

Anomaly facts:
{anomalies}

Evidence citations:
{evidence}

External signals:
{top_signals}

Baseline deterministic action: {brief['recommendedAction']}
"""


def _build_flow_prompt(pack: dict[str, Any]) -> str:
    runtime = pack.get("qwenRuntime", {})
    compact_pack = _compact_flow_pack(pack)
    return f"""/no_think
You are SuRaksha Sentinel's local Qwen 3.5 4B fund-flow analyst.
Return compact JSON only with keys: headline, summary, recommendedAction, confidence, materialityScore, citations, nextChecks, guardrails.
Use only supplied IDs and facts. Do not claim this is production bank transaction data. Keep summary under 55 words.
confidence and materialityScore must be 0-100 numeric percentages, not fractions.
citations, nextChecks, and guardrails must be JSON arrays.

Runtime constraints:
- Local model: {runtime.get('model', 'qwen3.5:4b-q4_K_M')}
- Effective context: {runtime.get('effectiveContextWindow', runtime.get('contextWindow', 4096))}
- Prompt packing: compact top paths/events only

Selected flow pack:
{json.dumps(compact_pack, ensure_ascii=True)}
"""


def _build_document_explanation_prompt(pack: dict[str, Any]) -> str:
    runtime = pack.get("qwenRuntime", {})
    return f"""/no_think
You are SuRaksha Sentinel's local Qwen 3.5 4B explainability analyst for Canara-style underwriting.
Return compact JSON only with keys: headline, answer, confidence, observed, baseline, citations, guardrails.
Use only the supplied anomaly facts, source traces, risk weights, and audit tip. Do not invent registry access. If language is hi or kn, answer in that language.
Keep executive answers under 35 words, standard under 90 words, forensic under 140 words.

Runtime constraints:
- Local model: {runtime.get('model', 'qwen3.5:4b-q4_K_M')}
- Effective context: {runtime.get('effectiveContextWindow', runtime.get('contextWindow', 4096))}
- Prompt packing: cited anomaly facts only

Document explanation pack:
{json.dumps(pack, ensure_ascii=True)}
"""


def _build_counterfactual_prompt(pack: dict[str, Any], fallback: dict[str, Any]) -> str:
    runtime = pack.get("qwenRuntime", {})
    return f"""/no_think
You are SuRaksha Sentinel's local Qwen 3.5 4B underwriting counterfactual analyst.
Return compact JSON only with keys: summary, recommendedAction.
Use only the supplied anomaly and deterministic risk delta. Do not change numeric risk values.

Runtime constraints:
- Local model: {runtime.get('model', 'qwen3.5:4b-q4_K_M')}
- Effective context: {runtime.get('effectiveContextWindow', runtime.get('contextWindow', 4096))}

Anomaly pack:
{json.dumps(pack, ensure_ascii=True)}

Deterministic counterfactual:
{json.dumps(fallback, ensure_ascii=True)}
"""


def _compact_flow_pack(pack: dict[str, Any]) -> dict[str, Any]:
    events = sorted(pack.get("events", []), key=lambda row: row.get("riskScore", 0), reverse=True)[:4]
    paths = sorted(pack.get("paths", []), key=lambda row: row.get("riskScore", 0), reverse=True)[:3]
    return {
        "caseId": pack.get("caseId", ""),
        "selectedPathId": pack.get("selectedPathId", ""),
        "selectedEventId": pack.get("selectedEventId", ""),
        "mode": pack.get("provenance", {}).get("mode", "demo-simulated"),
        "topEvents": [
            {
                "id": event.get("id", ""),
                "from": event.get("fromEntity", ""),
                "to": event.get("toEntity", ""),
                "amountInr": event.get("amountInr", 0),
                "channel": event.get("channel", ""),
                "risk": event.get("riskScore", 0),
                "reason": event.get("riskReason", ""),
                "evidenceIds": event.get("evidenceIds", [])[:2],
                "sourceIds": event.get("sourceIds", [])[:2],
            }
            for event in events
        ],
        "topPaths": [
            {
                "id": path.get("id", ""),
                "label": path.get("label", ""),
                "risk": path.get("riskScore", 0),
                "eventIds": path.get("eventIds", [])[:3],
                "amountInr": path.get("amountInr", 0),
            }
            for path in paths
        ],
        "controls": [
            {"id": item.get("id", ""), "label": item.get("label", ""), "status": item.get("status", "")}
            for item in pack.get("controls", [])[:4]
        ],
        "sourceFactors": [
            {"id": item.get("id", ""), "label": item.get("label", ""), "status": item.get("status", ""), "confidence": item.get("confidence", 0)}
            for item in pack.get("sourceFactors", [])[:3]
        ],
    }


def _parse_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(_repair_json_text(text[start : end + 1]))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _repair_json_text(text: str) -> str:
    repaired = text.strip()
    repaired = repaired.replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'")
    while ",}" in repaired or ",]" in repaired:
        repaired = repaired.replace(",}", "}").replace(",]", "]")
    return repaired


def _normalize_document_explanation(parsed: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    return {
        **fallback,
        "mode": "active",
        "headline": str(parsed.get("headline") or fallback.get("headline", "")),
        "answer": str(parsed.get("answer") or fallback.get("answer", "")),
        "confidence": _normalize_percent(parsed.get("confidence"), fallback.get("confidence", 0)),
        "observed": str(parsed.get("observed") or fallback.get("observed", "")),
        "baseline": str(parsed.get("baseline") or fallback.get("baseline", "")),
        "citations": _normalize_generic_citations(parsed.get("citations"), fallback.get("citations", []))[:4],
        "guardrails": _normalize_string_list(parsed.get("guardrails"), fallback.get("guardrails", []))[:3],
    }


def _normalize_flow_brief(parsed: dict[str, Any], fallback: dict[str, Any], pack: dict[str, Any]) -> dict[str, Any]:
    return {
        **fallback,
        "mode": "active",
        "headline": str(parsed.get("headline") or fallback.get("headline", "")),
        "summary": str(parsed.get("summary") or fallback.get("summary", "")),
        "recommendedAction": str(parsed.get("recommendedAction") or fallback.get("recommendedAction", "")),
        "confidence": _normalize_percent(parsed.get("confidence"), fallback.get("confidence", 0)),
        "materialityScore": _normalize_percent(parsed.get("materialityScore"), fallback.get("materialityScore", 0)),
        "citations": _normalize_flow_citations(parsed.get("citations"), fallback.get("citations", []), pack)[:4],
        "nextChecks": _normalize_string_list(parsed.get("nextChecks"), fallback.get("nextChecks", []))[:4],
        "guardrails": _normalize_string_list(parsed.get("guardrails"), fallback.get("guardrails", []))[:3],
    }


def _normalize_percent(value: Any, fallback: Any) -> float:
    candidate = value if value is not None else fallback
    try:
        if isinstance(candidate, str):
            candidate = candidate.strip().rstrip("%")
        number = float(candidate)
    except (TypeError, ValueError):
        number = 0.0
        try:
            number = float(fallback)
        except (TypeError, ValueError):
            pass
    if 0 < number <= 1:
        number *= 100
    return round(max(0.0, min(100.0, number)), 1)


def _normalize_string_list(value: Any, fallback: Any) -> list[str]:
    rows = value if isinstance(value, list) else []
    if not rows and isinstance(value, str):
        rows = [part.strip() for part in value.replace("\n", ";").split(";") if part.strip()]
    if not rows:
        rows = fallback if isinstance(fallback, list) else [str(fallback)] if fallback else []
    normalized: list[str] = []
    for row in rows:
        if isinstance(row, str) and row.strip():
            normalized.append(row.strip())
        elif isinstance(row, dict):
            label = row.get("label") or row.get("text") or row.get("summary") or row.get("id")
            if label:
                normalized.append(str(label))
    return normalized


def _normalize_generic_citations(value: Any, fallback: Any) -> list[dict[str, str]]:
    rows = value if isinstance(value, list) else []
    if not rows and isinstance(value, str):
        rows = [part.strip() for part in value.replace("\n", ",").split(",") if part.strip()]
    if not rows:
        rows = fallback if isinstance(fallback, list) else []

    citations: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if isinstance(row, dict):
            citation_id = str(row.get("id") or row.get("sourceId") or row.get("evidenceId") or row.get("label") or "")
            label = str(row.get("label") or row.get("title") or citation_id)
            source_url = str(row.get("sourceUrl") or "")
        else:
            citation_id = str(row)
            label = citation_id
            source_url = ""
        if citation_id and citation_id not in seen:
            seen.add(citation_id)
            citations.append({"id": citation_id, "label": label, "sourceUrl": source_url})
    return citations


def _normalize_flow_citations(value: Any, fallback: Any, pack: dict[str, Any]) -> list[dict[str, str]]:
    lookup: dict[str, dict[str, str]] = {}
    for event in pack.get("events", []):
        event_id = str(event.get("id", ""))
        if event_id:
            lookup[event_id] = {
                "id": event_id,
                "label": str(event.get("riskReason") or event.get("channel") or "Fund-flow event"),
                "sourceUrl": str(event.get("provenance", {}).get("sourceUrl") or ""),
            }
    for path in pack.get("paths", []):
        path_id = str(path.get("id", ""))
        if path_id:
            lookup[path_id] = {"id": path_id, "label": str(path.get("label") or "Fund-flow path"), "sourceUrl": ""}
    for source in pack.get("sourceFactors", []):
        source_id = str(source.get("id", ""))
        if source_id:
            lookup[source_id] = {"id": source_id, "label": str(source.get("label") or source.get("type") or "Source factor"), "sourceUrl": str(source.get("sourceUrl") or "")}

    rows = value if isinstance(value, list) else []
    if not rows and isinstance(value, str):
        rows = [part.strip() for part in value.replace("\n", ",").split(",") if part.strip()]
    if not rows:
        rows = fallback if isinstance(fallback, list) else []

    citations: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        if isinstance(row, dict):
            citation_id = str(row.get("id") or row.get("eventId") or row.get("pathId") or row.get("sourceId") or "")
            label = str(row.get("label") or row.get("title") or row.get("reason") or lookup.get(citation_id, {}).get("label") or citation_id)
            source_url = str(row.get("sourceUrl") or lookup.get(citation_id, {}).get("sourceUrl") or "")
        else:
            citation_id = str(row)
            label = lookup.get(citation_id, {}).get("label", citation_id)
            source_url = lookup.get(citation_id, {}).get("sourceUrl", "")
        if citation_id and citation_id not in seen:
            seen.add(citation_id)
            citations.append({"id": citation_id, "label": label, "sourceUrl": source_url})
    return citations


def _post_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _infer_api_style(endpoint: str) -> str:
    if "11434" in endpoint:
        return "ollama"
    return "llama_cpp"


def _int_override(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float_override(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.lower() in {"1", "true", "yes", "on"}
