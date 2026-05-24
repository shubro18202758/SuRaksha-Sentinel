from __future__ import annotations

import os

from .env_loader import load_env_file


load_env_file()


def env_value(name: str, default: str = "") -> str:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip()


def int_env_value(name: str, default: int) -> int:
    raw_value = env_value(name)
    if not raw_value:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def bool_env_value(name: str, default: bool) -> bool:
    raw_value = env_value(name)
    if not raw_value:
        return default
    return raw_value.lower() in {"1", "true", "yes", "on"}


def backend_host() -> str:
    return env_value("BACKEND_HOST")


def backend_port() -> int:
    return int_env_value("BACKEND_PORT", 0)


def frontend_origin() -> str:
    configured = env_value("FRONTEND_ORIGIN")
    if configured:
        return configured
    host = env_value("FRONTEND_HOST")
    port = int_env_value("FRONTEND_PORT", 0)
    scheme = env_value("FRONTEND_SCHEME")
    if not host or not port or not scheme:
        return ""
    return f"{scheme}://{host}:{port}"


def cors_allow_origins() -> list[str]:
    configured = env_value("CORS_ALLOW_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    origin = frontend_origin()
    return [origin] if origin else []


def qwen_endpoint() -> str:
    return env_value("QWEN_ENDPOINT")


def qwen_model() -> str:
    return env_value("QWEN_MODEL")
