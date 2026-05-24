from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT_DIR / "data"
DOSSIER_PATH = DATA_DIR / "dossiers.json"
CACHE_DIR = DATA_DIR / "cache"
UPLOAD_DIR = DATA_DIR / "uploads"


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    CACHE_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)


@lru_cache(maxsize=1)
def load_dossier_data() -> dict[str, Any]:
    ensure_data_dirs()
    if not DOSSIER_PATH.exists():
        raise FileNotFoundError(f"Missing dossier data file: {DOSSIER_PATH}")
    return json.loads(DOSSIER_PATH.read_text(encoding="utf-8"))


def reload_dossier_data() -> dict[str, Any]:
    load_dossier_data.cache_clear()
    return load_dossier_data()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return fallback
