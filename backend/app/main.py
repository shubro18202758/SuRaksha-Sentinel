from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .services.agent_service import run_agent_turn, validate_agent_action
from .services.connectors import connector_status, refresh_connectors
from .services.document_intelligence import build_audit_export, load_loan_profiles, record_underwriting_override, set_document_context
from .services.flow_engine import build_filtered_flow
from .services.media_store import media_catalog, save_upload, uploaded_media_path
from .services.qwen_adapter import (
    generate_qwen_counterfactual,
    generate_qwen_decision,
    generate_qwen_document_explanation,
    generate_qwen_flow_brief,
    qwen_keepalive_loop,
    warm_qwen_model,
)
from .services.qwen_runtime import runtime_health
from .services.runtime_config import cors_allow_origins
from .services.sentinel_engine import build_snapshot
from .services.source_media import proxy_source_media, render_page_preview, render_pdf_preview, resolve_source_media


@asynccontextmanager
async def lifespan(app: FastAPI):
    keepalive_task = asyncio.create_task(qwen_keepalive_loop())
    yield
    keepalive_task.cancel()
    try:
        await keepalive_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="SuRaksha Sentinel API",
    description="Live anomaly intelligence API for underwriting document and external-signal risk analysis.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "suraksha-sentinel-api"}


@app.get("/api/snapshot")
def snapshot() -> dict:
    return build_snapshot()


@app.get("/api/flow/live")
def flow_live(case_id: str | None = Query(default=None)) -> dict:
    return build_filtered_flow(build_snapshot(), case_id=case_id)


@app.get("/api/connectors/status")
def connectors_status() -> dict:
    return connector_status()


@app.post("/api/connectors/refresh")
def connectors_refresh() -> dict:
    return refresh_connectors()


@app.get("/api/qwen/runtime")
def qwen_runtime() -> dict:
    return runtime_health()


@app.post("/api/qwen/decision-brief")
def qwen_decision_brief() -> dict:
    return generate_qwen_decision(build_snapshot())


@app.post("/api/qwen/flow-brief")
def qwen_flow_brief(payload: dict[str, Any] | None = Body(default=None)) -> dict:
    return generate_qwen_flow_brief(build_snapshot(), payload or {})


@app.get("/api/document-intel/profiles")
def document_intel_profiles() -> dict:
    return {"profiles": load_loan_profiles()}


@app.post("/api/document-intel/ingest")
def document_intel_ingest(payload: dict[str, Any] | None = Body(default=None)) -> dict:
    accepted = set_document_context(payload or {})
    snapshot_payload = build_snapshot()
    return {
        "accepted": accepted,
        "documentIntelligence": snapshot_payload.get("documentIntelligence", {}),
        "selectedLoanProfile": snapshot_payload.get("selectedLoanProfile", {}),
        "riskDecomposition": snapshot_payload.get("riskDecomposition", {}),
    }


@app.post("/api/document-intel/explain")
def document_intel_explain(payload: dict[str, Any] | None = Body(default=None)) -> dict:
    return generate_qwen_document_explanation(build_snapshot(), payload or {})


@app.post("/api/document-intel/counterfactual")
def document_intel_counterfactual(payload: dict[str, Any] | None = Body(default=None)) -> dict:
    return generate_qwen_counterfactual(build_snapshot(), payload or {})


@app.post("/api/underwriting/override")
def underwriting_override(payload: dict[str, Any] | None = Body(default=None)) -> dict:
    return record_underwriting_override(payload or {}, build_snapshot())


@app.get("/api/audit/export")
def audit_export(case_id: str | None = Query(default=None)) -> dict:
    return build_audit_export(build_snapshot(), case_id=case_id)


@app.post("/api/qwen/warm")
def qwen_warm() -> dict:
    return warm_qwen_model()


@app.get("/api/media/catalog")
def media_catalog_endpoint() -> dict:
    return {"items": media_catalog()}


@app.post("/api/media/upload")
def media_upload(file: UploadFile = File(...), case_id: str = Form("UNASSIGNED")) -> dict:
    try:
        return {"item": save_upload(file, case_id=case_id)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/media/uploaded/{filename}")
def uploaded_media(filename: str) -> FileResponse:
    try:
        return FileResponse(uploaded_media_path(filename), headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Uploaded media not found") from exc


@app.get("/api/source-media/resolve")
def source_media_resolve(url: str = Query(...), title: str = Query("")) -> dict:
    return resolve_source_media(url, title=title)


@app.get("/api/source-media/proxy")
def source_media_proxy(url: str = Query(...)) -> Response:
    try:
        body, content_type, source_url = proxy_source_media(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Source media fetch failed: {type(exc).__name__}") from exc
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=900",
            "X-Source-Media-Url": source_url,
        },
    )


@app.get("/api/source-media/pdf-preview")
def source_pdf_preview(url: str = Query(...)) -> Response:
    try:
        body, content_type, source_url = render_pdf_preview(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"PDF preview render failed: {type(exc).__name__}") from exc
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=10800",
            "X-Source-Media-Url": source_url,
        },
    )


@app.get("/api/source-media/page-preview")
def source_page_preview(url: str = Query(...)) -> Response:
    try:
        body, content_type, source_url = render_page_preview(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Source page preview render failed: {type(exc).__name__}") from exc
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=10800",
            "X-Source-Media-Url": source_url,
        },
    )


@app.post("/api/agent/turn")
def agent_turn(payload: dict) -> dict:
    return run_agent_turn(payload, build_snapshot())


@app.post("/api/agent/action")
def agent_action(payload: dict) -> dict:
    return validate_agent_action(payload)


@app.websocket("/ws/live")
async def live_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(build_snapshot())
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        return
