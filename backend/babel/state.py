"""BABEL — Shared server state.

Engine instances, WebSocket connections, session locks, and helpers
shared across all route modules.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from .clock import world_time
from .db import (
    load_all_entity_details, load_session, save_event,
    save_seed, save_session,
)
from .engine import Engine
from .hooks import DefaultEngineHooks
from .models import (
    AgentRole, AgentState, AgentStatus, Event, SeedEnvelope,
    SeedLineage, SeedType, Session, SessionStatus, WorldSeed,
)
from .significance import event_score, finalize_event_significance

logger = logging.getLogger(__name__)

# ── Shared state ──────────────────────────────────────

# Active engines keyed by session_id
engines: dict[str, Engine] = {}
# Per-session locks for mutation safety
engine_locks: dict[str, asyncio.Lock] = {}
# Global lock protects engines / engine_locks dicts themselves
global_lock = asyncio.Lock()
# WebSocket connections keyed by session_id
ws_clients: dict[str, set[WebSocket]] = {}

SEEDS_DIR = Path(__file__).parent / "seeds"
SAVED_WORLD_PREFIX = "saved:"


# ── Engine helpers ────────────────────────────────────

def make_engine(session: Session, on_event=None) -> Engine:
    """Create an Engine with full text-world hooks."""
    hooks = DefaultEngineHooks()
    engine = Engine(session=session, hooks=hooks, on_event=on_event)
    hooks.install_facades(engine)
    return engine


def make_event_callback(session_id: str):
    """Create an event callback that broadcasts + persists."""
    async def on_event(event: Event) -> None:
        await save_event(event)
        async with global_lock:
            engine = engines.get(session_id)
        if engine:
            await auto_save_major_event_seed(engine.session, event)
        await broadcast(session_id, "event", event_dict(event))
    return on_event


async def get_engine(session_id: str) -> Engine | None:
    """Get engine from memory, or restore from DB if the server restarted."""
    async with global_lock:
        if session_id in engines:
            return engines[session_id]

    data = await load_session(session_id)
    if not data:
        return None

    world_seed = WorldSeed(**data["world_seed"])
    from .models import Relation
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
            role=AgentRole(role_val) if role_val else AgentRole.MAIN,
        )

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
            structured=e.get("structured") or {},
            location=e.get("location") or "",
            involved_agents=e.get("involved_agents") or [],
            significance=e.get("significance") or {},
            importance=float(e.get("importance") or 0.5),
            node_id=e.get("node_id") or "",
        ))

    engine = make_engine(session, on_event=make_event_callback(session_id))
    async with global_lock:
        engines[session_id] = engine
    return engine


def get_session_lock(session_id: str) -> asyncio.Lock:
    """Get or create a per-session lock."""
    if session_id not in engine_locks:
        engine_locks[session_id] = asyncio.Lock()
    return engine_locks[session_id]


# ── WebSocket ─────────────────────────────────────────

async def broadcast(session_id: str, msg_type: str, data: Any) -> None:
    """Send a message to all WebSocket clients for a session."""
    clients = ws_clients.get(session_id, set())
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


# ── Serialization ─────────────────────────────────────

def event_dict(e: Event) -> dict:
    """Serialize an Event model to a dict for API responses / broadcasts."""
    d = e.model_dump()
    at = e.action_type
    d["action_type"] = at if isinstance(at, str) else at.value
    d["significance"] = e.significance.model_dump()
    return d


def serialize_state(engine: Engine) -> dict:
    """Serialize engine state for WebSocket broadcasts and API responses."""
    session = engine.session
    wt = world_time(session.tick, session.world_seed.time)

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
        "glossary": session.world_seed.glossary,
        "lore": session.world_seed.lore,
        "agents": {
            aid: {
                "name": a.name,
                "description": a.description,
                "personality": a.personality,
                "goals": a.goals,
                "location": a.location,
                "inventory": a.inventory,
                "status": a.status.value,
                "role": a.role.value,
                "active_goal": a.active_goal.model_dump() if a.active_goal else None,
                "immediate_intent": a.immediate_intent,
                **({"psyche": psyche_snapshot} if psyche_snapshot else {}),
            }
            for aid, a in session.agents.items()
        },
        "recent_events": [event_dict(e) for e in session.events[-30:]],
        "relations": [r.model_dump() for r in session.relations],
    }


async def serialize_state_async(engine: Engine) -> dict:
    """Serialize engine state including entity details from DB."""
    state = serialize_state(engine)
    details_rows = await load_all_entity_details(engine.session.id)
    state["entity_details"] = {
        f"{row['entity_type']}:{row['entity_id']}": row.get("details", {})
        for row in details_rows
    }
    return state


# ── Lineage helpers ───────────────────────────────────

def saved_world_ref(seed_id: str) -> str:
    return f"{SAVED_WORLD_PREFIX}{seed_id}"


def runtime_lineage(
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


# ── World event helpers ───────────────────────────────

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


def normalize_world_event_text(text: str) -> str:
    normalized = text.strip()
    if normalized.startswith("[WORLD]"):
        normalized = normalized[len("[WORLD]"):].strip()
    return normalized


def is_major_world_event(event: Event) -> bool:
    action_type = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
    if action_type != "world_event" or event_score(event) < 0.85:
        return False
    text = normalize_world_event_text(str(event.action.get("content") or event.result or ""))
    if not text:
        return False
    lowered = text.lower()
    has_major_keyword = any(keyword in lowered for keyword in MAJOR_EVENT_KEYWORDS)
    has_global_scope = any(keyword in lowered for keyword in GLOBAL_SCOPE_KEYWORDS)
    return has_major_keyword or (has_global_scope and len(text) >= 18)


async def auto_save_major_event_seed(session: Session, event: Event) -> None:
    if not is_major_world_event(event):
        return
    action_type = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
    content = normalize_world_event_text(str(event.action.get("content") or event.result or ""))
    if not content:
        return
    seed = SeedEnvelope.from_event(
        event,
        seed_id=f"auto_event_{session.id}_{event.id}",
        tags=["major", "auto", action_type],
        source_world=session.id,
        lineage=runtime_lineage(session, root_name=content[:60], root_type=SeedType.EVENT.value),
    )
    seed.description = content
    seed.data["content"] = content
    seed.data["major"] = True
    seed.data["auto_saved"] = True
    await save_seed(seed)


async def record_initial_events(session: Session) -> None:
    for text in session.world_seed.initial_events:
        event = Event(
            session_id=session.id,
            tick=0,
            agent_id=None,
            agent_name=None,
            action_type="world_event",
            action={"content": text},
            result=f"[WORLD] {text}",
        )
        finalize_event_significance(event)
        session.events.append(event)
        await save_event(event)
        await auto_save_major_event_seed(session, event)


def oracle_prefers_chinese(language: str | None, message: str) -> bool:
    if any("\u4e00" <= ch <= "\u9fff" for ch in message):
        return True
    normalized = (language or "").strip().lower()
    if normalized in {"cn", "zh", "zh-cn", "zh_cn", "chinese", "simplified chinese"}:
        return True
    return False
