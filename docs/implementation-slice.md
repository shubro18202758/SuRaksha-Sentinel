# Implementation Slice 1

This slice creates a working foundation for the SuRaksha Sentinel prototype:

- FastAPI backend with `/health`, `/api/snapshot`, dynamic media previews, and `/ws/live` WebSocket streaming.
- React/Vite frontend that consumes only backend-provided values for metrics, charts, maps, graph nodes, media previews, and signal cards.
- Canara-inspired cockpit styling with dense banking dashboard views.
- Dynamic generated intelligence that changes over time, ready to be replaced by persisted OCR, source connectors, Qwen outputs, and graph storage.

## Local Hypothesis

If the backend can emit a complete live snapshot and the frontend can render it without static dashboard values, the team can iterate subsystem-by-subsystem while preserving an end-to-end demo at all times.

## Cheap Disconfirming Check

Run `npm run check`. It must build the frontend and compile backend Python modules. Then start backend/frontend and confirm the dashboard updates every few seconds.
