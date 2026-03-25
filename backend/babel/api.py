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
    save_seed, list_seeds, get_seed, delete_seed, query_memories,
    load_timeline, list_snapshots, load_nearest_snapshot,
    save_entity_details, load_entity_details, load_all_entity_details,
    save_narrator_message, load_narrator_messages,
)
from .clock import world_time
from .engine import Engine
from .llm import chat_with_agent, chat_with_oracle, detect_new_character, enrich_entity, generate_seed_draft
from .memory import create_memory_from_event, update_agent_memory
from .models import AgentRole, AgentSeed, AgentState, AgentStatus, Event, SavedSeed, SeedType, Session, SessionStatus, WorldSeed
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


class SaveSeedRequest(BaseModel):
    type: str
    name: str
    description: str = ""
    tags: list[str] = []
    data: dict[str, Any] = {}
    source_world: str = ""


class EnrichRequest(BaseModel):
    entity_type: str  # "agent", "item", "location"
    entity_id: str    # agent_id, item name, or location name


class ExtractSeedRequest(BaseModel):
    session_id: str
    target_id: str = ""  # agent_id, item name, location name, or event_id


class OracleChatRequest(BaseModel):
    message: str
    mode: str = "narrate"  # "narrate" | "create"
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


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
    """List available world seed files."""
    seeds = []
    if SEEDS_DIR.exists():
        for f in SEEDS_DIR.glob("*.yaml"):
            try:
                ws = WorldSeed.from_yaml(str(f))
                seeds.append({
                    "file": f.name,
                    "name": ws.name,
                    "description": ws.description,
                    "agent_count": len(ws.agents),
                    "location_count": len(ws.locations),
                })
            except Exception as e:
                logger.debug("Failed to parse seed file %s: %s", f.name, e)
    return seeds


@app.get("/api/seeds/{filename}")
async def get_seed_detail(filename: str) -> dict:
    """Get full seed data from a YAML file."""
    path = SEEDS_DIR / filename
    if not path.exists():
        raise HTTPException(404, f"Seed file not found: {filename}")
    ws = WorldSeed.from_yaml(str(path))
    return {
        "file": filename,
        "name": ws.name,
        "description": ws.description,
        "rules": ws.rules,
        "locations": [loc.model_dump() for loc in ws.locations],
        "agents": [a.model_dump() for a in ws.agents],
        "initial_events": ws.initial_events,
    }


@app.post("/api/worlds")
async def create_world(req: CreateWorldRequest) -> dict:
    """Create a new world session."""
    world_seed = WorldSeed(**req.model_dump())
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        raise HTTPException(400, f"Invalid world seed: {'; '.join(seed_errors)}")
    session = Session(world_seed=world_seed)
    session.init_agents()
    await save_session(session)

    # Store engine (not yet running)
    async with _global_lock:
        _engines[session.id] = Engine(
            session=session,
            on_event=make_event_callback(session.id),
        )

    return {
        "session_id": session.id,
        "name": world_seed.name,
        "agents": [a.name for a in session.agents.values()],
        "tick": session.tick,
        "status": session.status.value,
    }


@app.post("/api/worlds/from-seed/{filename}")
async def create_from_seed(filename: str) -> dict:
    """Create a world from a seed YAML file."""
    path = SEEDS_DIR / filename
    if not path.exists():
        raise HTTPException(404, f"Seed file not found: {filename}")

    world_seed = WorldSeed.from_yaml(str(path))
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        raise HTTPException(400, f"Invalid seed file '{filename}': {'; '.join(seed_errors)}")
    session = Session(world_seed=world_seed)
    session.init_agents()

    # Record initial events
    for text in world_seed.initial_events:
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

    await save_session(session)

    async with _global_lock:
        _engines[session.id] = Engine(
            session=session,
            on_event=make_event_callback(session.id),
        )

    return {
        "session_id": session.id,
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
                model=req.model,
                api_key=req.api_key,
                api_base=req.api_base,
            )
            # Persist messages
            await save_narrator_message(session_id, "user", req.message, session.tick)
            import json as _json
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

    # 4. Call enrichment LLM
    enriched = await enrich_entity(
        entity_type=req.entity_type,
        entity_name=req.entity_id,
        current_details=current_details,
        relevant_events=relevant_event_strings,
        world_desc=world_desc,
        model=engine.model,
        api_key=engine.api_key,
        api_base=engine.api_base,
    )

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
    return await list_seeds(seed_type=type)


@app.get("/api/assets/{seed_id}")
async def get_asset(seed_id: str) -> dict:
    """Get a single saved seed."""
    seed = await get_seed(seed_id)
    if not seed:
        raise HTTPException(404, "Seed not found")
    return seed


@app.post("/api/assets")
async def create_asset(req: SaveSeedRequest) -> dict:
    """Save a new seed to the asset library."""
    seed = SavedSeed(
        type=SeedType(req.type),
        name=req.name,
        description=req.description,
        tags=req.tags,
        data=req.data,
        source_world=req.source_world,
    )
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": seed.type.value}


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

    seed = SavedSeed(
        type=SeedType.AGENT,
        name=agent.name,
        description=agent.description,
        tags=[],
        data={
            "id": agent.agent_id,
            "name": agent.name,
            "description": agent.description,
            "personality": agent.personality,
            "goals": agent.goals,
            "inventory": agent.inventory,
            "location": agent.location,
        },
        source_world=req.session_id,
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

    seed = SavedSeed(
        type=SeedType.ITEM,
        name=item_name,
        description="",
        tags=[],
        data={"name": item_name},
        source_world=req.session_id,
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

    seed = SavedSeed(
        type=SeedType.LOCATION,
        name=loc.name,
        description=loc.description,
        tags=getattr(loc, "tags", []),
        data={"name": loc.name, "description": loc.description},
        source_world=req.session_id,
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

    at = event_data.get("action_type", "")
    seed = SavedSeed(
        type=SeedType.EVENT,
        name=(event_data.get("result", "") or "Event")[:60],
        description="",
        tags=[at] if at else [],
        data={
            "content": event_data.get("result", ""),
            "action_type": at,
        },
        source_world=req.session_id,
    )
    return seed.model_dump()


@app.post("/api/assets/extract/world")
async def extract_world_seed(req: ExtractSeedRequest) -> dict:
    """Extract the entire world seed from a running session."""
    engine = await _get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    ws = engine.session.world_seed
    seed = SavedSeed(
        type=SeedType.WORLD,
        name=ws.name,
        description=ws.description,
        tags=[],
        data=ws.model_dump(),
        source_world=ws.name,
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
    state["entity_details"] = await load_all_entity_details(engine.session.id)
    return state
