from __future__ import annotations

import uvicorn

from .services.runtime_config import backend_host, backend_port, bool_env_value


def main() -> None:
    host = backend_host()
    port = backend_port()
    if not host or port <= 0:
        raise RuntimeError("BACKEND_HOST and BACKEND_PORT must be configured before starting the API server.")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=bool_env_value("BACKEND_RELOAD", False))


if __name__ == "__main__":
    main()
