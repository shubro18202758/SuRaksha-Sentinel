from __future__ import annotations

import hashlib
import mimetypes
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from fastapi import UploadFile

from .data_provider import UPLOAD_DIR, read_json, write_json


INDEX_PATH = UPLOAD_DIR / "catalog.json"
ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "application/pdf",
}


def media_catalog() -> list[dict[str, Any]]:
    return read_json(INDEX_PATH, [])


def save_upload(file: UploadFile, case_id: str = "UNASSIGNED") -> dict[str, Any]:
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError(f"Unsupported media content type: {content_type}")

    suffix = Path(file.filename or "upload.bin").suffix.lower()
    digest = _stream_digest(file.file)
    asset_id = f"UP-{digest[:12]}"
    stored_name = f"{asset_id}{suffix or _suffix_for_type(content_type)}"
    stored_path = UPLOAD_DIR / stored_name

    file.file.seek(0)
    with stored_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)

    asset = {
        "id": asset_id,
        "caseId": case_id,
        "filename": file.filename or stored_name,
        "contentType": content_type,
        "sizeBytes": stored_path.stat().st_size,
        "kind": _kind_for_type(content_type),
        "title": Path(file.filename or stored_name).stem.replace("-", " ").replace("_", " ").title(),
        "url": f"/api/media/uploaded/{stored_name}",
        "previewUrl": f"/api/media/uploaded/{stored_name}",
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "integrityScore": 100,
        "ocrConfidence": 0 if not content_type.startswith("image") and content_type != "application/pdf" else 72,
        "tamperHeat": 0,
        "framesAnalyzed": 0 if not content_type.startswith("video") else 1,
        "detector": "uploaded evidence awaiting forensic worker",
        "provenance": {
            "connectorId": "local-upload",
            "connectorStatus": "local",
            "sourceUrl": f"file:{file.filename or stored_name}",
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
        },
    }

    catalog = [item for item in media_catalog() if item.get("id") != asset_id]
    catalog.insert(0, asset)
    write_json(INDEX_PATH, catalog[:200])
    return asset


def uploaded_media_path(filename: str) -> Path:
    safe_name = Path(filename).name
    path = UPLOAD_DIR / safe_name
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(filename)
    return path


def _stream_digest(stream: BinaryIO) -> str:
    stream.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    stream.seek(0)
    return digest.hexdigest()


def _kind_for_type(content_type: str) -> str:
    if content_type.startswith("video"):
        return "video"
    if content_type == "application/pdf":
        return "pdf"
    if content_type.startswith("image"):
        return "image"
    return "document"


def _suffix_for_type(content_type: str) -> str:
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "application/pdf": ".pdf",
    }.get(content_type, ".bin")
