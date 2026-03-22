"""BABEL — FastAPI application with WebSocket support."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .db import init_db, save_session, save_event, load_events, list_sessions, load_session, save_seed, list_seeds, get_seed, delete_seed
from .engine import Engine
from .llm import chat_with_agent
from .models import AgentSeed, AgentState, AgentStatus, Event, SavedSeed, SeedType, Session, SessionStatus, WorldSeed


# ── State ──────────────────────────────────────────────

# Active engines keyed by session_id
_engines: dict[str, Engine] = {}
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


class ExtractSeedRequest(BaseModel):
    session_id: str
    target_id: str = ""  # agent_id, item name, location name, or event_id


# ── WebSocket broadcast ───────────────────────────────

async def broadcast(session_id: str, msg_type: str, data: Any) -> None:
    """Send a message to all WebSocket clients for a session."""
    clients = _ws_clients.get(session_id, set())
    dead: set[WebSocket] = set()
    payload = json.dumps({"type": msg_type, "data": data}, ensure_ascii=False)
    for ws in clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    clients -= dead


def make_event_callback(session_id: str):
    """Create an event callback that broadcasts + persists."""
    async def on_event(event: Event) -> None:
        await save_event(event)
        await broadcast(session_id, "event", {
            "id": event.id,
            "tick": event.tick,
            "agent_id": event.agent_id,
            "agent_name": event.agent_name,
            "action_type": event.action_type if isinstance(event.action_type, str) else event.action_type.value,
            "action": event.action,
            "result": event.result,
        })
    return on_event


# ── Engine recovery from DB ───────────────────────────

async def _get_engine(session_id: str) -> Engine | None:
    """Get engine from memory, or restore from DB if the server restarted."""
    if session_id in _engines:
        return _engines[session_id]

    # Try to restore from DB
    data = await load_session(session_id)
    if not data:
        return None

    # Reconstruct Session
    world_seed = WorldSeed(**data["world_seed"])
    session = Session(
        id=data["id"],
        world_seed=world_seed,
        tick=data["tick"],
        status=SessionStatus(data["status"]) if data["status"] != "running" else SessionStatus.PAUSED,
    )

    # Reconstruct agent states
    for a in data["agents"]:
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
    _engines[session_id] = engine
    return engine


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
            except Exception:
                pass
    return seeds


@app.post("/api/worlds")
async def create_world(req: CreateWorldRequest) -> dict:
    """Create a new world session."""
    world_seed = WorldSeed(**req.model_dump())
    session = Session(world_seed=world_seed)
    session.init_agents()
    await save_session(session)

    # Store engine (not yet running)
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
        )
        session.events.append(event)
        await save_event(event)

    await save_session(session)

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
    from .models import AgentState
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

    # Update engine config
    if req.model:
        engine.model = req.model
    if req.api_key:
        engine.api_key = req.api_key
    if req.api_base:
        engine.api_base = req.api_base
    engine.tick_delay = req.tick_delay
    engine.on_event = make_event_callback(session_id)

    # Run in background
    asyncio.create_task(_run_and_save(engine, req.max_ticks))

    return {"status": "running", "max_ticks": req.max_ticks}


async def _run_and_save(engine: Engine, max_ticks: int) -> None:
    """Run engine and save state periodically."""
    try:
        engine.session.status = engine.session.status.RUNNING
        engine._running = True

        while engine._running and engine.session.tick < max_ticks:
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
        await broadcast(engine.session.id, "error", {"message": str(e)})
    finally:
        engine.session.status = engine.session.status.ENDED
        engine._running = False
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

    if req and req.model:
        engine.model = req.model
    if req and req.api_key:
        engine.api_key = req.api_key
    if req and req.api_base:
        engine.api_base = req.api_base
    engine.on_event = make_event_callback(session_id)

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
    return _serialize_state(engine)


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

    event = Event(
        session_id=session_id,
        tick=engine.session.tick,
        agent_id=None,
        agent_name=None,
        action_type="world_event",
        action={"content": req.content},
        result=f"[WORLD] {req.content}",
    )
    engine.session.events.append(event)
    await save_event(event)
    await broadcast(session_id, "event", {
        "id": event.id,
        "tick": event.tick,
        "agent_id": event.agent_id,
        "agent_name": event.agent_name,
        "action_type": "world_event",
        "action": event.action,
        "result": event.result,
    })

    return {
        "id": event.id,
        "tick": event.tick,
        "result": event.result,
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
    engine = _engines.get(req.session_id)
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
        source_world=engine.session.world_seed.name,
    )
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": "agent"}


@app.post("/api/assets/extract/item")
async def extract_item_seed(req: ExtractSeedRequest) -> dict:
    """Extract an item from a running session as a reusable seed."""
    engine = _engines.get(req.session_id)
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
        source_world=engine.session.world_seed.name,
    )
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": "item"}


@app.post("/api/assets/extract/location")
async def extract_location_seed(req: ExtractSeedRequest) -> dict:
    """Extract a location from a running session as a reusable seed."""
    engine = _engines.get(req.session_id)
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
        source_world=engine.session.world_seed.name,
    )
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": "location"}


@app.post("/api/assets/extract/event")
async def extract_event_seed(req: ExtractSeedRequest) -> dict:
    """Extract an event from a running session as a reusable event seed."""
    engine = _engines.get(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    event = None
    for e in engine.session.events:
        if e.id == req.target_id:
            event = e
            break

    if not event:
        raise HTTPException(404, f"Event not found: {req.target_id}")

    seed = SavedSeed(
        type=SeedType.EVENT,
        name=event.result[:60] if event.result else "Event",
        description="",
        tags=[event.action_type if isinstance(event.action_type, str) else event.action_type.value],
        data={
            "content": event.result,
            "action_type": event.action_type if isinstance(event.action_type, str) else event.action_type.value,
        },
        source_world=engine.session.world_seed.name,
    )
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": "event"}


@app.post("/api/assets/extract/world")
async def extract_world_seed(req: ExtractSeedRequest) -> dict:
    """Extract the entire world seed from a running session."""
    engine = _engines.get(req.session_id)
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
    await save_seed(seed)
    return {"id": seed.id, "name": seed.name, "type": "world"}


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
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.get(session_id, set()).discard(websocket)


# ── Helpers ────────────────────────────────────────────

def _serialize_state(engine: Engine) -> dict:
    session = engine.session
    return {
        "session_id": session.id,
        "name": session.world_seed.name,
        "description": session.world_seed.description,
        "tick": session.tick,
        "status": session.status.value,
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
            }
            for aid, a in session.agents.items()
        },
        "recent_events": [
            {
                "id": e.id,
                "tick": e.tick,
                "agent_id": e.agent_id,
                "agent_name": e.agent_name,
                "action_type": e.action_type if isinstance(e.action_type, str) else e.action_type.value,
                "result": e.result,
            }
            for e in session.events[-30:]
        ],
    }
