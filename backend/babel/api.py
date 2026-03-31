"""BABEL — FastAPI application with WebSocket support."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .db import (
    init_db, save_session, save_event, load_events, load_events_filtered,
    load_event_by_id, list_sessions, load_session, delete_session,
    save_seed, list_seeds, get_seed, delete_seed, delete_seeds_by_source_worlds, query_memories,
    load_timeline, list_snapshots, load_nearest_snapshot,
    save_entity_details, load_entity_details, load_all_entity_details,
    save_narrator_message, load_narrator_messages, hide_seed_ref,
    is_seed_ref_hidden, list_hidden_seed_refs,
)
from .clock import world_time
from .engine import Engine
from .llm import chat_with_agent, chat_with_oracle, detect_new_character, enrich_entity, generate_seed_draft
from .memory import create_memory_from_event, update_agent_memory
from .models import AgentRole, AgentSeed, AgentState, AgentStatus, Event, SavedSeed, SeedEnvelope, SeedLineage, SeedType, Session, SessionStatus, WorldSeed
from .validator import validate_seed


# ── State ──────────────────────────────────────────────

# Active engines keyed by session_id
_engines: dict[str, Engine] = {}
# Per-session locks for mutation safety
_engine_locks: dict[str, asyncio.Lock] = {}
# Global lock protects _engines / _engine_locks dicts themselves
_global_lock = asyncio.Lock()
# WebSocket connections keyed by session_id
_ws_clients: dict[str, set[WebSocket]] = {}


# ── Lifespan ───────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    # Stop all running engines
    for engine in _engines.values():
        engine.stop()


# ── App ────────────────────────────────────────────────

app = FastAPI(title="BABEL", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SEEDS_DIR = Path(__file__).parent / "seeds"
SAVED_WORLD_PREFIX = "saved:"


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Request Models ─────────────────────────────────────

class CreateWorldRequest(BaseModel):
    name: str
    description: str = ""
    rules: list[str] = []
    locations: list[dict[str, str]] = []
    resources: list[dict[str, str]] = []
    items: list[dict[str, Any]] = []
    agents: list[dict[str, Any]] = []
    initial_events: list[str] = []


class AddAgentRequest(BaseModel):
    id: str
    name: str
    description: str = ""
    personality: str = ""
    goals: list[str] = []
    inventory: list[str] = []
    location: str = ""


class RunRequest(BaseModel):
    max_ticks: int = 50
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    tick_delay: float = 3.0


class InjectEventRequest(BaseModel):
    content: str


class HumanActionRequest(BaseModel):
    agent_id: str
    action_type: str  # "speak", "move", "trade", "observe", "wait", "use_item"
    target: str = ""
    content: str = ""


class ChatRequest(BaseModel):
    agent_id: str
    message: str
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    language: str | None = None


class SaveSeedRequest(BaseModel):
    type: str
    name: str
    description: str = ""
    tags: list[str] = []
    data: dict[str, Any] = {}
    source_world: str = ""


class UpdateSeedRequest(BaseModel):
    type: str | None = None
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    data: dict[str, Any] | None = None
    source_world: str | None = None


class EnrichRequest(BaseModel):
    entity_type: str  # "agent", "item", "location"
    entity_id: str    # agent_id, item name, or location name
    language: str | None = None
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


class SaveEntityDetailsRequest(BaseModel):
    entity_type: str
    entity_id: str
    details: dict[str, Any] = {}


class ExtractSeedRequest(BaseModel):
    session_id: str
    target_id: str = ""  # agent_id, item name, location name, or event_id
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


class OracleChatRequest(BaseModel):
    message: str
    mode: str = "narrate"  # "narrate" | "create"
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    language: str | None = None


ORACLE_DRAFT_WORLD_NAME = "__ORACLE_DRAFT__"
MAJOR_EVENT_KEYWORDS = (
    "earthquake", "meteor", "invasion", "alien", "catastrophe", "disaster",
    "outbreak", "plague", "war", "evacuation", "collapse", "blackout",
    "地震", "海啸", "火山", "洪水", "瘟疫", "疫情", "入侵", "外星", "战争",
    "灾难", "天灾", "崩塌", "封锁", "撤离", "陨石", "爆炸",
)
GLOBAL_SCOPE_KEYWORDS = (
    "entire", "whole", "global", "everyone", "all agents", "city", "world",
    "ship", "fleet", "station", "基地", "全城", "全岛", "整个", "所有人",
    "全体", "世界", "舰船", "罗德岛", "整座",
)


def _build_oracle_draft_seed() -> WorldSeed:
    """Create a minimal hidden session so Oracle can assist before a world exists."""
    return WorldSeed(
        name=ORACLE_DRAFT_WORLD_NAME,
        description="Temporary Oracle draft session.",
        locations=[
            {
                "name": "Genesis Chamber",
                "description": "A liminal drafting chamber used for worldbuilding.",
            }
        ],
        agents=[
            {
                "id": "oracle_architect",
                "name": "Architect",
                "description": "A placeholder agent that anchors draft sessions.",
                "personality": "Neutral",
                "goals": ["Hold the draft space steady."],
                "inventory": [],
                "location": "Genesis Chamber",
            }
        ],
        narrator={
            "persona": "A worldbuilding oracle that shapes coherent worlds from rough ideas."
        },
    )


def _oracle_prefers_chinese(language: str | None, message: str) -> bool:
    if any("\u4e00" <= ch <= "\u9fff" for ch in message):
        return True
    normalized = (language or "").strip().lower()
    if normalized in {"cn", "zh", "zh-cn", "zh_cn", "chinese", "simplified chinese"}:
        return True
    return False


def _saved_world_ref(seed_id: str) -> str:
    return f"{SAVED_WORLD_PREFIX}{seed_id}"


async def _session_lineage_from_seed_ref(seed_ref: str, world_seed: WorldSeed, session_id: str) -> SeedLineage:
    if seed_ref.startswith(SAVED_WORLD_PREFIX):
        seed_id = seed_ref[len(SAVED_WORLD_PREFIX):]
        saved = await get_seed(seed_id)
        base = SeedLineage(**(saved.get("lineage") or {})) if saved else SeedLineage()
        return SeedLineage.runtime(
            root_name=base.root_name or world_seed.name,
            source_seed_ref=seed_ref,
            session_id=session_id,
            tick=0,
            branch_id=base.branch_id or "main",
            root_type=base.root_type or SeedType.WORLD.value,
        )

    return SeedLineage.runtime(
        root_name=world_seed.name,
        source_seed_ref=seed_ref,
        session_id=session_id,
        tick=0,
        branch_id="main",
        root_type=SeedType.WORLD.value,
    )


def _runtime_lineage(
    session: Session,
    *,
    root_name: str | None = None,
    node_id: str = "",
    snapshot_id: str = "",
    root_type: str = SeedType.WORLD.value,
) -> SeedLineage:
    return SeedLineage.runtime(
        root_name=root_name or session.seed_lineage.root_name or session.world_seed.name,
        source_seed_ref=session.seed_lineage.source_seed_ref,
        session_id=session.id,
        tick=session.tick,
        branch_id=session.seed_lineage.branch_id or "main",
        node_id=node_id,
        snapshot_id=snapshot_id,
        root_type=root_type,
    )


def _normalize_world_event_text(text: str) -> str:
    normalized = text.strip()
    if normalized.startswith("[WORLD]"):
        normalized = normalized[len("[WORLD]"):].strip()
    return normalized


def _is_major_world_event(event: Event) -> bool:
    action_type = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
    if action_type != "world_event" or event.importance < 0.85:
        return False

    text = _normalize_world_event_text(str(event.action.get("content") or event.result or ""))
    if not text:
        return False

    lowered = text.lower()
    has_major_keyword = any(keyword in lowered for keyword in MAJOR_EVENT_KEYWORDS)
    has_global_scope = any(keyword in lowered for keyword in GLOBAL_SCOPE_KEYWORDS)
    return has_major_keyword or (has_global_scope and len(text) >= 18)


async def _auto_save_major_event_seed(session: Session, event: Event) -> None:
    if not _is_major_world_event(event):
        return

    action_type = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
    content = _normalize_world_event_text(str(event.action.get("content") or event.result or ""))
    if not content:
        return

    seed = SeedEnvelope.from_event(
        event,
        seed_id=f"auto_event_{session.id}_{event.id}",
        tags=["major", "auto", action_type],
        source_world=session.id,
        lineage=_runtime_lineage(
            session,
            root_name=content[:60],
            root_type=SeedType.EVENT.value,
        ),
    )
    seed.description = content
    seed.data["content"] = content
    seed.data["major"] = True
    seed.data["auto_saved"] = True
    await save_seed(seed)


def _serialize_seed_summary(seed_ref: str, world_seed: WorldSeed) -> dict[str, Any]:
    return {
        "file": seed_ref,
        "name": world_seed.name,
        "description": world_seed.description,
        "agent_count": len(world_seed.agents),
        "location_count": len(world_seed.locations),
    }


async def _load_world_seed_from_ref(seed_ref: str) -> WorldSeed:
    if await is_seed_ref_hidden(seed_ref):
        raise HTTPException(404, f"Seed file not found: {seed_ref}")

    if seed_ref.startswith(SAVED_WORLD_PREFIX):
        seed_id = seed_ref[len(SAVED_WORLD_PREFIX):]
        saved = await get_seed(seed_id)
        if not saved or saved.get("type") != SeedType.WORLD.value:
            raise HTTPException(404, f"Saved world seed not found: {seed_ref}")
        try:
            return SeedEnvelope(**saved).to_world_seed()
        except Exception as exc:
            raise HTTPException(500, f"Saved world seed is invalid: {seed_ref}") from exc

    path = SEEDS_DIR / seed_ref
    if not path.exists():
        raise HTTPException(404, f"Seed file not found: {seed_ref}")
    return WorldSeed.from_yaml(str(path))


async def _list_session_ids_for_world_name(world_name: str) -> list[str]:
    """Find all saved sessions that belong to a given world name."""
    if not world_name.strip():
        return []

    session_ids: list[str] = []
    for session in await list_sessions():
        raw_world_seed = session.get("world_seed")
        try:
            world_seed = json.loads(raw_world_seed) if isinstance(raw_world_seed, str) else raw_world_seed
        except Exception:
            continue
        if isinstance(world_seed, dict) and world_seed.get("name") == world_name and session.get("id"):
            session_ids.append(str(session["id"]))
    return session_ids


async def _delete_world_linked_assets(world_name: str) -> int:
    """Delete assets linked to a world name and any sessions spawned from that world."""
    source_worlds = [world_name, *(await _list_session_ids_for_world_name(world_name))]
    return await delete_seeds_by_source_worlds(source_worlds)


async def _list_visible_world_names() -> set[str]:
    """Return world names that are still visible in the library."""
    world_names: set[str] = set()
    hidden_refs = set(await list_hidden_seed_refs())

    for saved in await list_seeds(seed_type=SeedType.WORLD.value):
        try:
            world_names.add(WorldSeed(**saved.get("data", {})).name)
        except Exception:
            if saved.get("name"):
                world_names.add(str(saved["name"]))

    if SEEDS_DIR.exists():
        for seed_file in SEEDS_DIR.glob("*.yaml"):
            if seed_file.name in hidden_refs:
                continue
            try:
                world_names.add(WorldSeed.from_yaml(str(seed_file)).name)
            except Exception:
                continue

    return {name for name in world_names if name}


async def _stale_asset_ids(assets: list[dict[str, Any]]) -> set[str]:
    """Identify assets still pointing at deleted worlds kept alive only by old sessions."""
    visible_world_names = await _list_visible_world_names()
    if not assets:
        return set()

    session_world_by_id: dict[str, str] = {}
    session_world_names: set[str] = set()
    for session in await list_sessions():
        raw_world_seed = session.get("world_seed")
        try:
            world_seed = json.loads(raw_world_seed) if isinstance(raw_world_seed, str) else raw_world_seed
        except Exception:
            continue
        if not isinstance(world_seed, dict):
            continue
        world_name = str(world_seed.get("name") or "").strip()
        session_id = str(session.get("id") or "").strip()
        if not world_name or not session_id:
            continue
        session_world_by_id[session_id] = world_name
        session_world_names.add(world_name)

    stale_ids: set[str] = set()
    for asset in assets:
        source_world = str(asset.get("source_world") or "").strip()
        asset_id = str(asset.get("id") or "").strip()
        if not source_world or not asset_id:
            continue

        session_world_name = session_world_by_id.get(source_world)
        if session_world_name and session_world_name not in visible_world_names:
            stale_ids.add(asset_id)
            continue

        if source_world in session_world_names and source_world not in visible_world_names:
            stale_ids.add(asset_id)

    return stale_ids


async def _record_initial_events(session: Session) -> None:
    for text in session.world_seed.initial_events:
        event = Event(
            session_id=session.id,
            tick=0,
            agent_id=None,
            agent_name=None,
            action_type="world_event",
            action={"content": text},
            result=f"[WORLD] {text}",
            importance=0.9,
        )
        session.events.append(event)
        await save_event(event)
        await _auto_save_major_event_seed(session, event)


# ── WebSocket broadcast ───────────────────────────────

async def broadcast(session_id: str, msg_type: str, data: Any) -> None:
    """Send a message to all WebSocket clients for a session."""
    clients = _ws_clients.get(session_id, set())
    # Copy to avoid mutation during iteration
    snapshot = list(clients)
    dead: set[WebSocket] = set()
    payload = json.dumps({"type": msg_type, "data": data}, ensure_ascii=False)
    for ws in snapshot:
        try:
            await ws.send_text(payload)
        except Exception as e:
            logger.debug("WebSocket send failed, removing client: %s", e)
            dead.add(ws)
    clients -= dead


def _event_dict(e: Event) -> dict:
    """Serialize an Event model to a dict for API responses / broadcasts."""
    return {
        "id": e.id,
        "tick": e.tick,
        "agent_id": e.agent_id,
        "agent_name": e.agent_name,
        "action_type": e.action_type if isinstance(e.action_type, str) else e.action_type.value,
        "action": e.action,
        "result": e.result,
        "structured": e.structured if hasattr(e, "structured") else {},
        "location": e.location if hasattr(e, "location") else "",
        "importance": e.importance if hasattr(e, "importance") else 0.5,
    }


def make_event_callback(session_id: str):
    """Create an event callback that broadcasts + persists."""
    async def on_event(event: Event) -> None:
        await save_event(event)
        async with _global_lock:
            engine = _engines.get(session_id)
        if engine:
            await _auto_save_major_event_seed(engine.session, event)
        await broadcast(session_id, "event", _event_dict(event))
    return on_event


# ── Engine recovery from DB ───────────────────────────

async def _get_engine(session_id: str) -> Engine | None:
    """Get engine from memory, or restore from DB if the server restarted."""
    async with _global_lock:
        if session_id in _engines:
            return _engines[session_id]

    # Try to restore from DB
    data = await load_session(session_id)
    if not data:
        return None

    # Reconstruct Session
    world_seed = WorldSeed(**data["world_seed"])
    # Reconstruct relations from DB
    from babel.models import Relation
    relations_data = data.get("relations", [])
    relations = [Relation(**r) if isinstance(r, dict) else r for r in relations_data]

    session = Session(
        id=data["id"],
        world_seed=world_seed,
        seed_lineage=SeedLineage(**(data.get("seed_lineage") or {})),
        tick=data["tick"],
        status=SessionStatus(data["status"]) if data["status"] != "running" else SessionStatus.PAUSED,
        relations=relations,
    )

    # Reconstruct agent states
    for a in data["agents"]:
        role_val = a.get("role", "main")
        session.agents[a["agent_id"]] = AgentState(
            agent_id=a["agent_id"],
            name=a["name"],
            description=a["description"],
            personality=a["personality"],
            goals=a["goals"],
            location=a["location"],
            inventory=a["inventory"],
            status=AgentStatus(a["status"]) if a["status"] != "acting" else AgentStatus.IDLE,
            memory=a["memory"],
            role=AgentRole(role_val) if role_val else AgentRole.MAIN,
        )

    # Reconstruct recent events (for context)
    for e in data["events"]:
        session.events.append(Event(
            id=e["id"],
            session_id=e["session_id"],
            tick=e["tick"],
            agent_id=e["agent_id"],
            agent_name=e["agent_name"],
            action_type=e["action_type"],
            action=e["action"],
            result=e["result"],
        ))

    engine = Engine(
        session=session,
        on_event=make_event_callback(session_id),
    )
    async with _global_lock:
        _engines[session_id] = engine
    return engine


def _get_session_lock(session_id: str) -> asyncio.Lock:
    """Get or create a per-session lock."""
    if session_id not in _engine_locks:
        _engine_locks[session_id] = asyncio.Lock()
    return _engine_locks[session_id]


# ── API Routes ─────────────────────────────────────────

@app.get("/api/seeds")
async def get_seeds() -> list[dict]:
    """List available world seeds from YAML files and saved custom worlds."""
    seeds = []
    hidden_refs = set(await list_hidden_seed_refs())
    for saved in await list_seeds(seed_type=SeedType.WORLD.value):
        seed_ref = _saved_world_ref(saved["id"])
        if seed_ref in hidden_refs:
            continue
        try:
            world_seed = WorldSeed(**saved.get("data", {}))
            seeds.append(_serialize_seed_summary(seed_ref, world_seed))
        except Exception as e:
            logger.debug("Failed to parse saved world seed %s: %s", saved.get("id"), e)

    if SEEDS_DIR.exists():
        for f in SEEDS_DIR.glob("*.yaml"):
            if f.name in hidden_refs:
                continue
            try:
                ws = WorldSeed.from_yaml(str(f))
                seeds.append(_serialize_seed_summary(f.name, ws))
            except Exception as e:
                logger.debug("Failed to parse seed file %s: %s", f.name, e)
    return seeds


@app.get("/api/seeds/{filename}")
async def get_seed_detail(filename: str) -> dict:
    """Get full seed data from a YAML file or a saved custom world."""
    ws = await _load_world_seed_from_ref(filename)
    return {
        "file": filename,
        "name": ws.name,
        "description": ws.description,
        "rules": ws.rules,
        "locations": [loc.model_dump() for loc in ws.locations],
        "items": [item.model_dump() for item in ws.items],
        "agents": [a.model_dump() for a in ws.agents],
        "initial_events": ws.initial_events,
    }


@app.delete("/api/seeds/{filename:path}")
async def delete_world_seed(filename: str) -> dict:
    """Delete a world seed from the user's library view."""
    if filename.startswith(SAVED_WORLD_PREFIX):
        seed_id = filename[len(SAVED_WORLD_PREFIX):]
        existing = await get_seed(seed_id)
        if not existing or existing.get("type") != SeedType.WORLD.value:
            raise HTTPException(404, "Seed not found")

        world_name = ""
        try:
            world_name = WorldSeed(**existing.get("data", {})).name
        except Exception:
            world_name = str(existing.get("name") or "")

        deleted = await delete_seed(seed_id)
        if not deleted:
            raise HTTPException(404, "Seed not found")
        await _delete_world_linked_assets(world_name)
        return {"deleted": True}

    path = SEEDS_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Seed not found")

    world_name = ""
    try:
        world_name = WorldSeed.from_yaml(str(path)).name
    except Exception:
        world_name = ""
    await hide_seed_ref(filename)
    await _delete_world_linked_assets(world_name)
    return {"deleted": True}


@app.patch("/api/seeds/{filename:path}")
async def update_world_seed(filename: str, req: CreateWorldRequest) -> dict:
    """Update a saved custom world seed in place."""
    if not filename.startswith(SAVED_WORLD_PREFIX):
        raise HTTPException(400, "Built-in YAML seeds are read-only")

    seed_id = filename[len(SAVED_WORLD_PREFIX):]
    existing = await get_seed(seed_id)
    if not existing or existing.get("type") != SeedType.WORLD.value:
        raise HTTPException(404, "Seed not found")

    world_seed = WorldSeed(**req.model_dump())
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        raise HTTPException(400, f"Invalid world seed: {'; '.join(seed_errors)}")

    saved_seed = SeedEnvelope.from_world_seed(
        world_seed,
        seed_id=seed_id,
        tags=existing.get("tags") or ["custom"],
        source_world=existing.get("source_world", ""),
        lineage=SeedLineage(**(existing.get("lineage") or {})) if existing.get("lineage") else SeedLineage(root_name=world_seed.name, root_type=SeedType.WORLD.value),
        created_at=existing.get("created_at"),
    )
    await save_seed(saved_seed)

    return _serialize_seed_summary(filename, world_seed)


@app.post("/api/worlds")
async def create_world(req: CreateWorldRequest) -> dict:
    """Create a new world session."""
    world_seed = WorldSeed(**req.model_dump())
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        raise HTTPException(400, f"Invalid world seed: {'; '.join(seed_errors)}")
    session = Session(world_seed=world_seed)
    session.init_agents()
    session.seed_lineage = SeedLineage.runtime(
        root_name=world_seed.name,
        session_id=session.id,
        tick=0,
        branch_id="main",
        root_type=SeedType.WORLD.value,
    )
    await _record_initial_events(session)
    saved_seed = SeedEnvelope.from_world_seed(
        world_seed,
        tags=["custom"],
        lineage=SeedLineage(root_name=world_seed.name, root_type=SeedType.WORLD.value),
    )
    await save_seed(saved_seed)
    session.seed_lineage.source_seed_ref = _saved_world_ref(saved_seed.id)
    await save_session(session)

    # Store engine (not yet running)
    async with _global_lock:
        _engines[session.id] = Engine(
            session=session,
            on_event=make_event_callback(session.id),
        )

    return {
        "session_id": session.id,
        "seed_file": _saved_world_ref(saved_seed.id),
        "name": world_seed.name,
        "agents": [a.name for a in session.agents.values()],
        "tick": session.tick,
        "status": session.status.value,
    }


@app.post("/api/oracle/draft")
async def create_oracle_draft() -> dict:
    """Create a hidden draft session for Oracle-assisted world creation."""
    world_seed = _build_oracle_draft_seed()
    session = Session(world_seed=world_seed)
    session.init_agents()
    await save_session(session)

    async with _global_lock:
        _engines[session.id] = Engine(
            session=session,
            on_event=make_event_callback(session.id),
        )

    return {
        "session_id": session.id,
        "name": world_seed.name,
        "tick": session.tick,
        "status": session.status.value,
    }


@app.post("/api/worlds/from-seed/{filename}")
async def create_from_seed(filename: str) -> dict:
    """Create a world from a seed YAML file or saved custom world."""
    world_seed = await _load_world_seed_from_ref(filename)
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        raise HTTPException(400, f"Invalid seed file '{filename}': {'; '.join(seed_errors)}")
    session = Session(world_seed=world_seed)
    session.init_agents()
    session.seed_lineage = await _session_lineage_from_seed_ref(filename, world_seed, session.id)

    await _record_initial_events(session)
    await save_session(session)

    async with _global_lock:
        _engines[session.id] = Engine(
            session=session,
            on_event=make_event_callback(session.id),
        )

    return {
        "session_id": session.id,
        "seed_file": filename,
        "name": world_seed.name,
        "agents": [a.name for a in session.agents.values()],
        "tick": session.tick,
        "status": session.status.value,
    }


@app.post("/api/worlds/{session_id}/agents")
async def add_agent(session_id: str, req: AddAgentRequest) -> dict:
    """Add an agent to an existing world."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if engine.is_running:
        raise HTTPException(400, "Cannot add agent while simulation is running")

    seed = AgentSeed(**req.model_dump())
    engine.session.agents[seed.id] = AgentState.from_seed(seed)
    engine.session.world_seed.agents.append(seed)
    await save_session(engine.session)

    return {"agent_id": seed.id, "name": seed.name}


@app.post("/api/worlds/{session_id}/run")
async def run_world(session_id: str, req: RunRequest) -> dict:
    """Start or resume the simulation."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if engine.is_running:
        raise HTTPException(400, "Already running")

    # Update engine config via proper API
    engine.configure(
        model=req.model or None,
        api_key=req.api_key or None,
        api_base=req.api_base or None,
        tick_delay=req.tick_delay,
        on_event=make_event_callback(session_id),
    )

    # Run in background
    asyncio.create_task(_run_and_save(engine, req.max_ticks))

    return {"status": "running", "max_ticks": req.max_ticks}


async def _run_and_save(engine: Engine, max_ticks: int) -> None:
    """Run engine and save state periodically."""
    try:
        engine.start()

        while engine.is_running and engine.session.tick < max_ticks:
            events = await engine.tick()
            # Save state after each tick
            await save_session(engine.session)
            # Broadcast tick update
            await broadcast(engine.session.id, "tick", {
                "tick": engine.session.tick,
                "status": engine.session.status.value,
            })
            # Broadcast state update
            await broadcast(engine.session.id, "state_update", _serialize_state(engine))
            await asyncio.sleep(engine.tick_delay)
    except Exception as e:
        logger.warning("Simulation run error for session %s: %s", engine.session.id, e)
        await broadcast(engine.session.id, "error", {"message": str(e)})
    finally:
        engine.stop()
        await save_session(engine.session)
        await broadcast(engine.session.id, "stopped", {
            "tick": engine.session.tick,
        })


@app.post("/api/worlds/{session_id}/step")
async def step_world(session_id: str, req: RunRequest | None = None) -> dict:
    """Execute a single tick."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if engine.is_running:
        raise HTTPException(400, "Cannot step while running — pause first")
    lock = _get_session_lock(session_id)
    async with lock:
        engine.configure(
            model=(req.model if req and req.model else None),
            api_key=(req.api_key if req and req.api_key else None),
            api_base=(req.api_base if req and req.api_base else None),
            on_event=make_event_callback(session_id),
        )

        events = await engine.step()
        await save_session(engine.session)

    return {
        "tick": engine.session.tick,
        "events": [
            {
                "agent_name": e.agent_name,
                "action_type": e.action_type,
                "result": e.result,
            }
            for e in events
        ],
    }


@app.post("/api/worlds/{session_id}/pause")
async def pause_world(session_id: str) -> dict:
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    engine.pause()
    return {"status": "paused", "tick": engine.session.tick}


@app.get("/api/worlds/{session_id}/state")
async def get_world_state(session_id: str) -> dict:
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    return await _serialize_state_async(engine)


@app.get("/api/worlds/{session_id}/events")
async def get_events(session_id: str, limit: int = 100, offset: int = 0) -> list[dict]:
    return await load_events(session_id, limit=limit, offset=offset)


@app.get("/api/sessions")
async def get_sessions() -> list[dict]:
    return await list_sessions()


# ── Feature 1: Inject world event ─────────────────────

@app.post("/api/worlds/{session_id}/inject")
async def inject_event(session_id: str, req: InjectEventRequest) -> dict:
    """Inject a user-authored world event into the session."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    lock = _get_session_lock(session_id)
    async with lock:
        return await _inject_event_inner(engine, session_id, req)


async def _inject_event_inner(engine: Engine, session_id: str, req: InjectEventRequest) -> dict:
    event = Event(
        session_id=session_id,
        tick=engine.session.tick,
        agent_id=None,
        agent_name=None,
        action_type="world_event",
        action={"content": req.content},
        result=f"[WORLD] {req.content}",
        importance=0.9,
    )
    engine._append_event(event)
    await save_event(event)
    await _auto_save_major_event_seed(engine.session, event)

    # Mark as urgent so agents react on next tick
    engine.inject_urgent_event(req.content)

    # Write into ALL alive agents' memory so they react to it
    for aid in engine.session.agent_ids:
        agent = engine.session.agents[aid]
        update_agent_memory(agent, event.result)
        await create_memory_from_event(agent, event, engine.session)

    # ── Auto-detect new character from injected event ──
    new_agent_data = None
    existing_names = [a.name for a in engine.session.agents.values()]
    try:
        char_result = await detect_new_character(
            content=req.content,
            existing_names=existing_names,
            locations=engine.session.location_names,
            world_desc=engine.session.world_seed.description,
        )
        if char_result:
            # Slugify name into a safe agent ID
            slug = re.sub(r"[^a-z0-9]+", "_", char_result["name"].lower()).strip("_")
            if not slug:
                slug = "agent"
            # Ensure unique ID
            agent_id = slug
            counter = 2
            while agent_id in engine.session.agents:
                agent_id = f"{slug}_{counter}"
                counter += 1

            # Pick a valid location, fallback to first available
            location = char_result.get("location", "")
            if location not in engine.session.location_names and engine.session.location_names:
                location = engine.session.location_names[0]

            new_agent = AgentState(
                agent_id=agent_id,
                name=char_result["name"],
                description=char_result.get("description", ""),
                personality=char_result.get("personality", ""),
                goals=[],
                location=location,
                inventory=[],
                role=AgentRole.SUPPORTING,
            )
            # Give initial memory about their arrival
            arrival_memory = f"I have just arrived. {req.content}"
            update_agent_memory(new_agent, arrival_memory)

            engine.session.agents[agent_id] = new_agent
            new_agent_data = {
                "agent_id": agent_id,
                "name": new_agent.name,
                "description": new_agent.description,
                "personality": new_agent.personality,
                "location": new_agent.location,
                "role": new_agent.role.value,
            }
    except Exception as e:
        logger.debug("Character detection on inject failed: %s", e)

    await save_session(engine.session)

    await broadcast(session_id, "event", _event_dict(event))

    # Broadcast agent_added if a new character was created
    if new_agent_data:
        await broadcast(session_id, "agent_added", new_agent_data)

    result = {
        "id": event.id,
        "tick": event.tick,
        "result": event.result,
    }
    if new_agent_data:
        result["new_agent"] = new_agent_data
    return result


# ── Feature: Human agent control ("Play as Agent") ────

@app.post("/api/worlds/{session_id}/take-control/{agent_id}")
async def take_control(session_id: str, agent_id: str) -> dict:
    """Take human control of an agent. Its decisions will wait for human input."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if agent_id not in engine.session.agents:
        raise HTTPException(404, f"Agent not found: {agent_id}")
    lock = _get_session_lock(session_id)
    async with lock:
        from .decision import HumanDecisionSource

        # Wrap current decision source if not already a HumanDecisionSource
        if not isinstance(engine.decision_source, HumanDecisionSource):
            async def _on_waiting(aid: str, ctx: Any) -> None:
                await broadcast(session_id, "waiting_for_human", {
                    "agent_id": aid,
                    "agent_name": ctx.agent_name,
                    "location": ctx.agent_location,
                    "inventory": ctx.agent_inventory,
                    "visible_agents": ctx.visible_agents,
                    "reachable_locations": ctx.reachable_locations,
                })

            engine.decision_source = HumanDecisionSource(
                fallback=engine.decision_source,
                on_waiting=_on_waiting,
            )
        engine.decision_source.take_control(agent_id)

    await broadcast(session_id, "human_control", {
        "agent_id": agent_id, "controlled": True,
    })
    return {"agent_id": agent_id, "controlled": True}


@app.post("/api/worlds/{session_id}/release-control/{agent_id}")
async def release_control(session_id: str, agent_id: str) -> dict:
    """Release human control of an agent. It returns to AI decisions."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    lock = _get_session_lock(session_id)
    async with lock:
        from .decision import HumanDecisionSource

        if isinstance(engine.decision_source, HumanDecisionSource):
            engine.decision_source.release_control(agent_id)
            # If no more human agents, unwrap back to fallback
            if not engine.decision_source.human_agents:
                if engine.decision_source._fallback:
                    engine.decision_source = engine.decision_source._fallback

    await broadcast(session_id, "human_control", {
        "agent_id": agent_id, "controlled": False,
    })
    return {"agent_id": agent_id, "controlled": False}


@app.post("/api/worlds/{session_id}/human-action")
async def submit_human_action(session_id: str, req: HumanActionRequest) -> dict:
    """Submit an action for a human-controlled agent."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    from .decision import HumanDecisionSource
    from .models import ActionOutput, ActionType

    if not isinstance(engine.decision_source, HumanDecisionSource):
        raise HTTPException(400, "No human-controlled agents in this session")
    if not engine.decision_source.is_waiting(req.agent_id):
        raise HTTPException(400, f"Agent {req.agent_id} is not waiting for input")

    try:
        action_type = ActionType(req.action_type)
    except ValueError:
        raise HTTPException(400, f"Invalid action type: {req.action_type}")

    action = ActionOutput(
        type=action_type,
        target=req.target or None,
        content=req.content or "",
    )
    accepted = engine.decision_source.submit_action(req.agent_id, action)
    if not accepted:
        raise HTTPException(400, "Action not accepted — agent may have timed out")

    return {"accepted": True, "agent_id": req.agent_id, "action_type": req.action_type}


@app.get("/api/worlds/{session_id}/human-status")
async def get_human_status(session_id: str) -> dict:
    """Get human control status — which agents are controlled, which are waiting."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    from .decision import HumanDecisionSource

    if not isinstance(engine.decision_source, HumanDecisionSource):
        return {"controlled_agents": [], "waiting_agents": []}

    src = engine.decision_source
    controlled = list(src.human_agents)
    waiting = [aid for aid in controlled if src.is_waiting(aid)]
    # Include context for waiting agents so frontend can render action picker
    waiting_contexts = {}
    for aid in waiting:
        ctx = src.get_pending_context(aid)
        if ctx:
            waiting_contexts[aid] = {
                "agent_name": ctx.agent_name,
                "location": ctx.agent_location,
                "inventory": ctx.agent_inventory,
                "visible_agents": ctx.visible_agents,
                "reachable_locations": ctx.reachable_locations,
            }

    return {
        "controlled_agents": controlled,
        "waiting_agents": waiting,
        "waiting_contexts": waiting_contexts,
    }


# ── Feature 2: Chat with agent ────────────────────────

@app.post("/api/worlds/{session_id}/chat")
async def chat_with_agent_endpoint(session_id: str, req: ChatRequest) -> dict:
    """Have a direct conversation with an agent (does not affect simulation state)."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    agent = engine.session.agents.get(req.agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {req.agent_id}")

    reply = await chat_with_agent(
        agent_name=agent.name,
        agent_personality=agent.personality,
        agent_goals=agent.goals,
        agent_location=agent.location,
        agent_inventory=agent.inventory,
        agent_memory=agent.memory,
        agent_description=agent.description,
        user_message=req.message,
        preferred_language=req.language or "",
        model=req.model,
        api_key=req.api_key,
        api_base=req.api_base,
    )

    return {
        "agent_id": req.agent_id,
        "agent_name": agent.name,
        "reply": reply,
    }


# ── Feature 2b: Oracle (omniscient narrator) ────────

@app.post("/api/worlds/{session_id}/oracle")
async def oracle_chat_endpoint(session_id: str, req: OracleChatRequest) -> dict:
    """Chat with the omniscient Oracle narrator.

    mode="narrate" (default): Omniscient narrator conversation.
    mode="create": Creative co-pilot — generate a WorldSeed JSON from conversation.
    """
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    session = engine.session

    # Load conversation history
    history = await load_narrator_messages(session_id, limit=20)
    conv_history = [{"role": m["role"], "content": m["content"]} for m in history]

    # ── Creative mode: generate WorldSeed ──
    if req.mode == "create":
        try:
            seed_data = await generate_seed_draft(
                user_message=req.message,
                conversation_history=conv_history,
                preferred_language=req.language or "",
                model=req.model,
                api_key=req.api_key,
                api_base=req.api_base,
            )
            # Persist messages
            await save_narrator_message(session_id, "user", req.message, session.tick)
            if _oracle_prefers_chinese(req.language, req.message):
                reply_text = f"世界种子已生成：{seed_data.get('name', '未命名世界')}"
            else:
                reply_text = f"World seed generated: {seed_data.get('name', 'Untitled')}"
            msg_id = await save_narrator_message(session_id, "oracle", reply_text, session.tick)
            return {
                "reply": reply_text,
                "message_id": msg_id,
                "mode": "create",
                "seed": seed_data,
            }
        except (ValueError, Exception) as e:
            raise HTTPException(422, f"Seed generation failed: {e}")

    # ── Narrate mode (default) ──
    # Build agent states dict for prompt
    agents_dict = {}
    for aid, agent in session.agents.items():
        agents_dict[aid] = {
            "name": agent.name,
            "personality": agent.personality,
            "goals": agent.goals,
            "location": agent.location,
            "inventory": agent.inventory,
            "status": agent.status.value if hasattr(agent.status, "value") else agent.status,
            "memory": agent.memory,
            "role": agent.role.value if hasattr(agent.role, "value") else agent.role,
        }

    # Gather recent event summaries
    recent = [
        f"[T{e.tick}] {e.agent_name or 'WORLD'}: {e.result}"
        for e in session.events[-15:]
    ]

    # Gather enriched details
    details_rows = await load_all_entity_details(session_id)
    enriched = {}
    for row in details_rows:
        key = f"{row['entity_type']}:{row['entity_id']}"
        enriched[key] = row.get("details", {})

    # World time
    wt = world_time(session.tick, session.world_seed.time)
    time_display = wt.display if wt.display and not wt.display.startswith("Tick") else ""

    # Narrator persona from seed
    persona = session.world_seed.narrator.persona if session.world_seed.narrator else ""

    reply = await chat_with_oracle(
        world_name=session.world_seed.name,
        world_description=session.world_seed.description,
        world_rules=session.world_seed.rules,
        agents=agents_dict,
        recent_events=recent,
        enriched_details=enriched,
        conversation_history=conv_history,
        user_message=req.message,
        narrator_persona=persona,
        world_time_display=time_display,
        preferred_language=req.language or "",
        model=req.model,
        api_key=req.api_key,
        api_base=req.api_base,
    )

    # Persist both messages
    await save_narrator_message(session_id, "user", req.message, session.tick)
    msg_id = await save_narrator_message(session_id, "oracle", reply, session.tick)

    return {"reply": reply, "message_id": msg_id}


@app.get("/api/worlds/{session_id}/oracle/history")
async def oracle_history_endpoint(session_id: str, limit: int = 50) -> list[dict]:
    """Load Oracle conversation history for a session."""
    return await load_narrator_messages(session_id, limit=limit)


# ── Feature 3: Progressive Detail Enrichment ──────────

@app.post("/api/worlds/{session_id}/enrich")
async def enrich_entity_endpoint(session_id: str, req: EnrichRequest) -> dict:
    """Generate or update rich narrative details for a world entity."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    session = engine.session

    # 1. Load existing details from DB
    existing = await load_entity_details(session_id, req.entity_type, req.entity_id)
    current_details = existing["details"] if existing else {}

    # 2. Gather relevant events mentioning this entity
    relevant_event_strings: list[str] = []

    if req.entity_type == "agent":
        # Search by agent_id
        events = await load_events_filtered(
            session_id=session_id,
            agent_id=req.entity_id,
            limit=30,
        )
        for e in events:
            relevant_event_strings.append(e.get("result", ""))
    else:
        # For items and locations, search by content text
        all_events = await load_events(session_id, limit=200)
        search_term = req.entity_id.lower()
        for e in all_events:
            result_text = (e.get("result") or "").lower()
            action_text = json.dumps(e.get("action", {})).lower()
            location_text = (e.get("location") or "").lower()
            if search_term in result_text or search_term in action_text or search_term in location_text:
                relevant_event_strings.append(e.get("result", ""))

    # Deduplicate and limit
    seen: set[str] = set()
    unique_events: list[str] = []
    for ev_str in relevant_event_strings:
        if ev_str and ev_str not in seen:
            seen.add(ev_str)
            unique_events.append(ev_str)
    relevant_event_strings = unique_events[:20]

    # 3. Get entity context from session state
    entity_context = ""
    if req.entity_type == "agent":
        agent = session.agents.get(req.entity_id)
        if agent:
            entity_context = f"{agent.name} — {agent.description}. Personality: {agent.personality}. Location: {agent.location}."
    elif req.entity_type == "location":
        for loc in session.world_seed.locations:
            if loc.name == req.entity_id:
                entity_context = f"{loc.name} — {loc.description}"
                break
    elif req.entity_type == "item":
        entity_context = f"Item: {req.entity_id}"

    world_desc = session.world_seed.description
    if entity_context:
        world_desc = f"{world_desc}\n\n[Entity Context]\n{entity_context}"

    model = req.model or engine.model
    api_key = req.api_key or engine.api_key
    api_base = req.api_base or engine.api_base
    if not api_key or not model:
        raise HTTPException(400, "LLM settings missing for detail generation")

    # 4. Call enrichment LLM
    enriched = await enrich_entity(
        entity_type=req.entity_type,
        entity_name=req.entity_id,
        current_details=current_details,
        relevant_events=relevant_event_strings,
        world_desc=world_desc,
        preferred_language=req.language or "",
        model=model,
        api_key=api_key,
        api_base=api_base,
    )
    if not enriched:
        raise HTTPException(502, f"{req.entity_type.title()} detail generation returned no content")

    # 5. Save to DB
    await save_entity_details(
        session_id=session_id,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        details=enriched,
        tick=session.tick,
    )

    # 6. Return
    return {
        "entity_type": req.entity_type,
        "entity_id": req.entity_id,
        "details": enriched,
        "tick": session.tick,
    }


@app.get("/api/worlds/{session_id}/entity-details")
async def get_entity_details(
    session_id: str,
    entity_type: str,
    entity_id: str,
) -> dict:
    """Load existing enriched details without triggering LLM generation."""
    existing = await load_entity_details(session_id, entity_type, entity_id)
    if not existing:
        return {"details": None}
    return {"details": existing.get("details", {})}


@app.patch("/api/worlds/{session_id}/entity-details")
async def save_entity_details_endpoint(session_id: str, req: SaveEntityDetailsRequest) -> dict:
    """Persist manually edited local details for a world entity."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    await save_entity_details(
        session_id=session_id,
        entity_type=req.entity_type,
        entity_id=req.entity_id,
        details=req.details,
        tick=engine.session.tick,
    )
    return {
        "entity_type": req.entity_type,
        "entity_id": req.entity_id,
        "details": req.details,
        "tick": engine.session.tick,
    }


# ── Feature 4: Session replay ─────────────────────────

@app.get("/api/worlds/{session_id}/replay")
async def get_replay(session_id: str, limit: int = 500, offset: int = 0) -> dict:
    """Return full event history and initial state for session replay."""
    engine = await _get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    session = engine.session

    # Load events from DB (ordered by tick ASC for replay)
    all_events = await load_events(session_id, limit=limit, offset=offset)
    # load_events returns DESC order; reverse for chronological replay
    all_events.reverse()

    # Build initial agent snapshot from the world seed
    initial_agents = {}
    for seed in session.world_seed.agents:
        initial_agents[seed.id] = {
            "id": seed.id,
            "name": seed.name,
            "description": seed.description,
            "personality": seed.personality,
            "goals": seed.goals,
            "location": seed.location,
            "inventory": seed.inventory,
        }

    return {
        "world_name": session.world_seed.name,
        "world_description": session.world_seed.description,
        "total_ticks": session.tick,
        "events": all_events,
        "initial_agents": initial_agents,
    }


# ── Feature 5: Asset Library (Seeds) ─────────────────

@app.get("/api/assets")
async def get_assets(type: str | None = None) -> list[dict]:
    """List saved seeds, optionally filtered by type."""
    assets = await list_seeds(seed_type=type)
    stale_ids = await _stale_asset_ids(assets)
    if stale_ids:
        for stale_id in stale_ids:
            await delete_seed(stale_id)
        assets = [asset for asset in assets if asset.get("id") not in stale_ids]
    return assets


@app.get("/api/assets/{seed_id}")
async def get_asset(seed_id: str) -> dict:
    """Get a single saved seed."""
    seed = await get_seed(seed_id)
    if not seed:
        raise HTTPException(404, "Seed not found")
    if seed.get("id") in await _stale_asset_ids([seed]):
        await delete_seed(seed_id)
        raise HTTPException(404, "Seed not found")
    return seed


@app.post("/api/assets")
async def create_asset(req: SaveSeedRequest) -> dict:
    """Save a new seed to the asset library."""
    seed = SeedEnvelope(
        type=SeedType(req.type),
        name=req.name,
        description=req.description,
        tags=req.tags,
        data=req.data,
        source_world=req.source_world,
        lineage=SeedLineage(root_name=req.name, root_type=req.type, tick=0),
    )
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": seed.type.value}


@app.patch("/api/assets/{seed_id}")
async def update_asset(seed_id: str, req: UpdateSeedRequest) -> dict:
    """Update an existing seed in the asset library."""
    existing = await get_seed(seed_id)
    if not existing:
        raise HTTPException(404, "Seed not found")

    seed_type = req.type or existing["type"]
    seed = SeedEnvelope(
        id=existing["id"],
        type=SeedType(seed_type),
        name=req.name if req.name is not None else existing["name"],
        description=req.description if req.description is not None else existing["description"],
        tags=req.tags if req.tags is not None else existing["tags"],
        data=req.data if req.data is not None else existing["data"],
        source_world=req.source_world if req.source_world is not None else existing.get("source_world", ""),
        lineage=SeedLineage(**(existing.get("lineage") or {})),
        created_at=existing["created_at"],
    )
    await save_seed(seed)
    return seed.model_dump()


@app.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: str) -> dict:
    """Delete a session and all its data."""
    # Stop engine if running
    if session_id in _engines:
        _engines[session_id].stop()
        del _engines[session_id]
    deleted = await delete_session(session_id)
    if not deleted:
        raise HTTPException(404, "Session not found")
    await delete_seeds_by_source_worlds([session_id])
    return {"deleted": True}


@app.delete("/api/assets/{seed_id}")
async def delete_asset(seed_id: str) -> dict:
    """Delete a saved seed."""
    deleted = await delete_seed(seed_id)
    if not deleted:
        raise HTTPException(404, "Seed not found")
    return {"deleted": True}


@app.post("/api/assets/extract/agent")
async def extract_agent_seed(req: ExtractSeedRequest) -> dict:
    """Extract an agent from a running session as a reusable seed."""
    engine = await _get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    agent = engine.session.agents.get(req.target_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {req.target_id}")

    seed = SeedEnvelope.from_agent_state(
        agent,
        source_world=req.session_id,
        lineage=_runtime_lineage(
            engine.session,
            root_name=agent.name,
            root_type=SeedType.AGENT.value,
        ),
    )
    return seed.model_dump()


@app.post("/api/assets/extract/item")
async def extract_item_seed(req: ExtractSeedRequest) -> dict:
    """Extract an item from a running session as a reusable seed."""
    engine = await _get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    # Find item across all agents' inventories
    item_name = req.target_id
    found = False
    for agent in engine.session.agents.values():
        if item_name in agent.inventory:
            found = True
            break

    if not found:
        raise HTTPException(404, f"Item not found: {item_name}")

    existing = await load_entity_details(req.session_id, "item", item_name)
    details = existing.get("details", {}) if existing else {}

    if not details:
        model = req.model or engine.model
        api_key = req.api_key or engine.api_key
        api_base = req.api_base or engine.api_base
        if not api_key or not model:
            raise HTTPException(400, "LLM settings missing for item seed generation")
        relevant_event_strings: list[str] = []
        all_events = await load_events(req.session_id, limit=200)
        search_term = item_name.lower()
        for event in all_events:
            result_text = (event.get("result") or "").lower()
            action_text = json.dumps(event.get("action", {})).lower()
            if search_term in result_text or search_term in action_text:
                relevant_event_strings.append(event.get("result", ""))

        unique_events: list[str] = []
        seen: set[str] = set()
        for event_text in relevant_event_strings:
            if event_text and event_text not in seen:
                seen.add(event_text)
                unique_events.append(event_text)

        world_desc = f"{engine.session.world_seed.description}\n\n[Entity Context]\nItem: {item_name}"
        details = await enrich_entity(
            entity_type="item",
            entity_name=item_name,
            current_details={},
            relevant_events=unique_events[:20],
            world_desc=world_desc,
            preferred_language="",
            model=model,
            api_key=api_key,
            api_base=api_base,
        )
        if not details:
            raise HTTPException(502, "Item seed generation returned no content")
        await save_entity_details(
            session_id=req.session_id,
            entity_type="item",
            entity_id=item_name,
            details=details,
            tick=engine.session.tick,
        )

    description = str(details.get("description") or "")
    properties = details.get("properties")
    if not isinstance(properties, list):
        properties = []

    seed = SeedEnvelope.from_item_state(
        item_name,
        description=description,
        origin=str(details.get("origin") or ""),
        properties=[str(prop) for prop in properties],
        significance=str(details.get("significance") or ""),
        source_world=req.session_id,
        lineage=_runtime_lineage(
            engine.session,
            root_name=item_name,
            root_type=SeedType.ITEM.value,
        ),
    )
    return seed.model_dump()


@app.post("/api/assets/extract/location")
async def extract_location_seed(req: ExtractSeedRequest) -> dict:
    """Extract a location from a running session as a reusable seed."""
    engine = await _get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    loc = None
    for l in engine.session.world_seed.locations:
        if l.name == req.target_id:
            loc = l
            break

    if not loc:
        raise HTTPException(404, f"Location not found: {req.target_id}")

    seed = SeedEnvelope.from_location_seed(
        loc,
        source_world=req.session_id,
        lineage=_runtime_lineage(
            engine.session,
            root_name=loc.name,
            root_type=SeedType.LOCATION.value,
        ),
    )
    return seed.model_dump()


@app.post("/api/assets/extract/event")
async def extract_event_seed(req: ExtractSeedRequest) -> dict:
    """Extract an event from a running session as a reusable event seed."""
    engine = await _get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    # Use DB query instead of in-memory scan (events may be windowed)
    event_data = await load_event_by_id(req.session_id, req.target_id)
    if not event_data:
        raise HTTPException(404, f"Event not found: {req.target_id}")

    seed = SeedEnvelope.from_event(
        Event(
            id=str(event_data.get("id") or ""),
            session_id=req.session_id,
            tick=int(event_data.get("tick") or 0),
            agent_id=event_data.get("agent_id"),
            agent_name=event_data.get("agent_name"),
            action_type=str(event_data.get("action_type") or ""),
            action=event_data.get("action") or {},
            result=str(event_data.get("result") or ""),
        ),
        source_world=req.session_id,
        lineage=_runtime_lineage(
            engine.session,
            root_name=str(event_data.get("result") or "")[:60],
            root_type=SeedType.EVENT.value,
        ),
    )
    return seed.model_dump()


@app.post("/api/assets/extract/world")
async def extract_world_seed(req: ExtractSeedRequest) -> dict:
    """Extract the entire world seed from a running session."""
    engine = await _get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    ws = engine.session.world_seed
    seed = SeedEnvelope.from_world_seed(
        ws,
        source_world=ws.name,
        lineage=_runtime_lineage(
            engine.session,
            root_name=ws.name,
            root_type=SeedType.WORLD.value,
        ),
    )
    return seed.model_dump()


# ── Timeline & Memory endpoints ───────────────────────


@app.get("/api/worlds/{session_id}/timeline")
async def get_timeline(
    session_id: str,
    branch: str = "main",
    from_tick: int = 0,
    to_tick: int | None = None,
) -> dict:
    """Get timeline nodes for a session."""
    nodes = await load_timeline(session_id, branch, from_tick, to_tick)
    return {"nodes": nodes, "branch": branch}


@app.get("/api/worlds/{session_id}/snapshots")
async def get_snapshots(session_id: str) -> list[dict]:
    """List all snapshots for a session."""
    return await list_snapshots(session_id)


@app.get("/api/worlds/{session_id}/agents/{agent_id}/memories")
async def get_agent_memories(
    session_id: str,
    agent_id: str,
    category: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """Get structured memories for an agent."""
    return await query_memories(session_id, agent_id, category=category, limit=limit)


class ReconstructRequest(BaseModel):
    tick: int


@app.post("/api/worlds/{session_id}/reconstruct")
async def reconstruct_state(session_id: str, req: ReconstructRequest) -> dict:
    """Reconstruct world state at a given tick using snapshots."""
    snapshot = await load_nearest_snapshot(session_id, req.tick)
    if not snapshot:
        raise HTTPException(404, f"No snapshot found at or before tick {req.tick}")

    # Load events between snapshot tick and target tick
    events = await load_events_filtered(
        session_id=session_id,
        min_tick=snapshot["tick"] + 1,
        limit=500,
    )
    target_events = [e for e in events if e.get("tick", 0) <= req.tick]

    return {
        "tick": req.tick,
        "snapshot_tick": snapshot["tick"],
        "world_seed": snapshot["world_seed"],
        "agent_states": snapshot["agent_states"],
        "events_since_snapshot": target_events,
        "lineage": snapshot.get("lineage", {}),
    }


# ── WebSocket ──────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    if session_id not in _ws_clients:
        _ws_clients[session_id] = set()
    _ws_clients[session_id].add(websocket)

    try:
        # Send current state on connect
        engine = await _get_engine(session_id)
        if engine:
            await websocket.send_text(json.dumps({
                "type": "connected",
                "data": _serialize_state(engine),
            }, ensure_ascii=False))

        # Keep alive — listen for client messages (e.g., ping)
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                continue  # ignore malformed messages
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.get(session_id, set()).discard(websocket)


# ── Helpers ────────────────────────────────────────────

def _serialize_state(engine: Engine) -> dict:
    """Serialize engine state for WebSocket broadcasts and API responses."""
    session = engine.session
    wt = world_time(session.tick, session.world_seed.time)

    # Check if Psyche emotional data is available
    psyche_snapshot = None
    from .decision import PsycheDecisionSource
    if isinstance(engine.decision_source, PsycheDecisionSource) and engine.decision_source.last_snapshot:
        snap = engine.decision_source.last_snapshot
        psyche_snapshot = {
            "chemicals": {
                "DA": snap.chemicals.dopamine,
                "HT": snap.chemicals.serotonin,
                "CORT": snap.chemicals.cortisol,
                "OT": snap.chemicals.oxytocin,
                "NE": snap.chemicals.norepinephrine,
                "END": snap.chemicals.endorphins,
            },
            "autonomic": snap.autonomic.dominant,
            "emotion": snap.dominant_emotion,
            "drives": snap.drives,
        }

    return {
        "session_id": session.id,
        "name": session.world_seed.name,
        "description": session.world_seed.description,
        "tick": session.tick,
        "status": session.status.value,
        "world_time": {"display": wt.display, "period": wt.period, "day": wt.day, "is_night": wt.is_night},
        "locations": [loc.model_dump() for loc in session.world_seed.locations],
        "items": [item.model_dump() for item in session.world_seed.items],
        "rules": session.world_seed.rules,
        "agents": {
            aid: {
                "name": a.name,
                "description": a.description,
                "personality": a.personality,
                "goals": a.goals,
                "location": a.location,
                "inventory": a.inventory,
                "status": a.status.value,
                "memory": a.memory,
                "role": a.role.value,
                "active_goal": a.active_goal.model_dump() if a.active_goal else None,
                "immediate_intent": a.immediate_intent,
                **({"psyche": psyche_snapshot} if psyche_snapshot else {}),
            }
            for aid, a in session.agents.items()
        },
        "recent_events": [_event_dict(e) for e in session.events[-30:]],
        "relations": [r.model_dump() for r in session.relations],
    }


async def _serialize_state_async(engine: Engine) -> dict:
    """Serialize engine state including entity details from DB."""
    state = _serialize_state(engine)
    details_rows = await load_all_entity_details(engine.session.id)
    state["entity_details"] = {
        f"{row['entity_type']}:{row['entity_id']}": row.get("details", {})
        for row in details_rows
    }
    return state
