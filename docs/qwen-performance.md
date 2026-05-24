# Qwen 3.5 4B Performance Plan

The prototype treats Qwen as the local reasoning core while deterministic detectors produce the facts. This keeps the model fast, grounded, and reliable for underwriting.

## Recommended Runtime Profile

- Prefer `llama.cpp` or Ollama for local hackathon reliability.
- Use GGUF `Q4_K_M` when CPU/RAM is constrained; use `Q5_K_M` if the machine has enough memory.
- Set `QWEN_GPU_LAYERS=99` to push all safe layers to GPU when available.
- Keep `QWEN_CONTEXT_TOKENS=4096` as the default effective window. Reasoning can use a larger window only when runtime telemetry says the machine has safe VRAM headroom.
- Keep `QWEN_TEMPERATURE=0.12`, `QWEN_TOP_P=0.74`, and `QWEN_REPEAT_PENALTY=1.10` for stable underwriting summaries.
- Enable mmap, prompt caching, and flash attention where the runtime supports them.
- Use `/api/ps` residency checks for Ollama so the UI can show whether the configured model is actually loaded on GPU.

## Prompt Strategy

1. Deterministic engines emit OCR facts, tamper flags, financial anomalies, graph paths, source provenance, and confidence scores.
2. Evidence compressor ranks facts by materiality and removes repeated OCR text.
3. Qwen receives compact JSON-like evidence packs and returns schema-bound decision support.
4. Backend rejects uncited or malformed output and falls back to deterministic brief text.

## API Surface

- `GET /api/qwen/runtime` exposes runtime settings, prompt budget, estimated throughput, latency, and cache posture.
- `GET /api/qwen/runtime` also exposes GPU health, requested context, effective context, and Ollama residency.
- `POST /api/qwen/decision-brief` sends the active case evidence pack to the configured local Qwen runtime and falls back to the deterministic brief if the runtime is unavailable.
- `POST /api/agent/turn` sends active workspace context to the local Qwen investigation copilot and falls back to deterministic, cited actions if Qwen returns malformed output.
- `GET /api/snapshot` includes `qwenRuntime`, `qwenBrief`, and `anomalyMatrix` for the live cockpit.

## Runtime Connection

For Ollama, set:

```powershell
$env:QWEN_ENDPOINT="http://127.0.0.1:11434"
$env:QWEN_API_STYLE="ollama"
$env:QWEN_MODEL="qwen3.5:4b-q4_K_M"
```

For llama.cpp server, set:

```powershell
$env:QWEN_ENDPOINT="http://127.0.0.1:8080"
$env:QWEN_API_STYLE="llama_cpp"
```

The adapter sends optimized generation settings: context window, output reserve, low temperature, top-p, repeat penalty, thread count, batch size, prompt cache, and long keep-alive for Ollama.

## Safe Use Boundary

Never send private borrower data to external model endpoints. For this prototype, Qwen should run locally or behind a trusted internal endpoint.
