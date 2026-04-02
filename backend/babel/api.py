"""BABEL — FastAPI application entry point.

Thin shell: app setup, middleware, lifespan, WebSocket handler,
and router mounting. All endpoint logic lives in babel/routes/.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import init_db
from .state import (
    broadcast, engines, engine_locks, get_engine, global_lock,
    serialize_state, ws_clients,
)

# Backward-compat aliases for test imports
_engines = engines
_engine_locks = engine_locks
_global_lock = global_lock

# ── Router imports ────────────────────────────────────

from .routes.seeds import router as seeds_router
from .routes.worlds import router as worlds_router, aux_router as worlds_aux_router
from .routes.agents import router as agents_router
from .routes.oracle import router as oracle_router
from .routes.assets import router as assets_router
from .routes.timeline import router as timeline_router
from .routes.enrichment import router as enrichment_router


# ── Lifespan ──────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    for engine in engines.values():
        engine.stop()


# ── App ───────────────────────────────────────────────

app = FastAPI(title="BABEL", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    logger.error("Validation error on %s %s: %s", request.method, request.url, exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


# ── Health ────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Mount routers ─────────────────────────────────────

app.include_router(seeds_router)
app.include_router(worlds_router)
app.include_router(worlds_aux_router)
app.include_router(agents_router)
app.include_router(oracle_router)
app.include_router(assets_router)
app.include_router(timeline_router)
app.include_router(enrichment_router)


# ── WebSocket ─────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    if session_id not in ws_clients:
        ws_clients[session_id] = set()
    ws_clients[session_id].add(websocket)

    try:
        engine = await get_engine(session_id)
        if engine:
            await websocket.send_text(json.dumps({
                "type": "connected",
                "data": serialize_state(engine),
            }, ensure_ascii=False))

        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                continue
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.get(session_id, set()).discard(websocket)
