"""BABEL — World lifecycle router."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import (
    delete_seeds_by_source_worlds,
    delete_session,
    get_seed,
    is_seed_ref_hidden,
    list_sessions,
    load_events,
    save_event,
    save_seed,
    save_session,
)
from ..llm import detect_new_character
from ..memory import create_memory_from_event
from ..models import (
    AgentRole,
    AgentSeed,
    AgentState,
    AgentStatus,
    Event,
    SeedEnvelope,
    SeedLineage,
    SeedType,
    Session,
    WorldSeed,
)
from ..significance import finalize_event_significance
from ..state import (
    SAVED_WORLD_PREFIX,
    SEEDS_DIR,
    auto_save_major_event_seed,
    broadcast,
    engines,
    event_dict,
    get_engine,
    get_session_lock,
    global_lock,
    make_engine,
    make_event_callback,
    record_initial_events,
    saved_world_ref,
    serialize_state,
    serialize_state_async,
)
from ..validator import validate_seed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/worlds", tags=["worlds"])


# ── Request models ───────────────────────────────────────

class CreateWorldRequest(BaseModel):
    name: str
    description: str = ""
    lore: list[str] = []
    locations: list[dict[str, Any]] = []
    glossary: dict[str, str] = {}
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


class DaemonRequest(BaseModel):
    tick_interval: float = 5.0
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


class InjectEventRequest(BaseModel):
    content: str


class PatchWorldSeedRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    lore: list[str] | None = None
    locations: list[dict[str, Any]] | None = None


class PatchAgentRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    personality: str | None = None
    goals: list[str] | None = None


class CommandRequest(BaseModel):
    text: str
    language: str | None = None
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


# ── Local helpers ────────────────────────────────────────

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


async def _run_and_save(engine, max_ticks: int | None = None) -> None:
    """Run engine and save state periodically. max_ticks=None means run forever (daemon)."""
    try:
        engine.start()

        while engine.is_running and (max_ticks is None or engine.session.tick < max_ticks):
            events = await engine.tick()
            # Save state after each tick
            await save_session(engine.session)
            # Broadcast tick update
            await broadcast(engine.session.id, "tick", {
                "tick": engine.session.tick,
                "status": engine.session.status.value,
            })
            # Broadcast state update
            await broadcast(engine.session.id, "state_update", serialize_state(engine))
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


async def _inject_event_inner(engine, session_id: str, req: InjectEventRequest) -> dict:
    event = Event(
        session_id=session_id,
        tick=engine.session.tick,
        agent_id=None,
        agent_name=None,
        action_type="world_event",
        action={"content": req.content},
        result=f"[WORLD] {req.content}",
    )
    finalize_event_significance(event)
    engine._append_event(event)
    await save_event(event)
    await auto_save_major_event_seed(engine.session, event)

    # Mark as urgent so agents react on next tick
    engine.inject_urgent_event(req.content)

    # Write into ALL alive agents' memory so they react to it
    for aid in engine.session.agent_ids:
        agent = engine.session.agents[aid]
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

    await broadcast(session_id, "event", event_dict(event))

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


# ── Endpoints ────────────────────────────────────────────


@router.post("")
async def create_world(req: CreateWorldRequest) -> dict:
    """Create a new world session."""
    try:
        world_seed = WorldSeed(**req.model_dump())
    except Exception as e:
        logger.error("WorldSeed parse error: %s", e)
        raise HTTPException(400, f"Seed parse error: {e}")
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        logger.warning("Seed validation failed: %s", seed_errors)
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
    await record_initial_events(session)
    saved_seed = SeedEnvelope.from_world_seed(
        world_seed,
        tags=["custom"],
        lineage=SeedLineage(root_name=world_seed.name, root_type=SeedType.WORLD.value),
    )
    await save_seed(saved_seed)
    session.seed_lineage.source_seed_ref = saved_world_ref(saved_seed.id)
    await save_session(session)

    # Store engine (not yet running)
    async with global_lock:
        engines[session.id] = make_engine(session, on_event=make_event_callback(session.id))

    return {
        "session_id": session.id,
        "seed_file": saved_world_ref(saved_seed.id),
        "name": world_seed.name,
        "agents": [a.name for a in session.agents.values()],
        "tick": session.tick,
        "status": session.status.value,
    }


@router.post("/from-seed/{filename}")
async def create_from_seed(filename: str) -> dict:
    """Create a world from a seed YAML file or saved custom world."""
    world_seed = await _load_world_seed_from_ref(filename)
    seed_errors = validate_seed(world_seed)
    if seed_errors:
        raise HTTPException(400, f"Invalid seed file '{filename}': {'; '.join(seed_errors)}")
    session = Session(world_seed=world_seed)
    session.init_agents()
    session.seed_lineage = await _session_lineage_from_seed_ref(filename, world_seed, session.id)

    await record_initial_events(session)
    await save_session(session)

    async with global_lock:
        engines[session.id] = make_engine(session, on_event=make_event_callback(session.id))

    return {
        "session_id": session.id,
        "seed_file": filename,
        "name": world_seed.name,
        "agents": [a.name for a in session.agents.values()],
        "tick": session.tick,
        "status": session.status.value,
    }


@router.post("/{session_id}/agents")
async def add_agent(session_id: str, req: AddAgentRequest) -> dict:
    """Add an agent to an existing world."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if engine.is_running:
        raise HTTPException(400, "Cannot add agent while simulation is running")

    seed = AgentSeed(**req.model_dump())
    engine.session.agents[seed.id] = AgentState.from_seed(seed)
    engine.session.world_seed.agents.append(seed)
    await save_session(engine.session)

    return {"agent_id": seed.id, "name": seed.name}


@router.patch("/{session_id}/seed")
async def patch_world_seed(session_id: str, req: PatchWorldSeedRequest) -> dict:
    """Update the world seed of a running or paused world."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    ws = engine.session.world_seed
    if req.name is not None:
        ws.name = req.name
    if req.description is not None:
        ws.description = req.description
    if req.lore is not None:
        ws.lore = req.lore
    if req.locations is not None:
        from ..models import LocationSeed
        ws.locations = [LocationSeed(**loc) for loc in req.locations]
    await save_session(engine.session)
    return {"ok": True}


@router.patch("/{session_id}/agents/{agent_id}")
async def patch_agent(session_id: str, agent_id: str, req: PatchAgentRequest) -> dict:
    """Update editable fields of an agent in a running or paused world."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    agent = engine.session.agents.get(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    if req.name is not None:
        agent.name = req.name
    if req.description is not None:
        agent.description = req.description
    if req.personality is not None:
        agent.personality = req.personality
    if req.goals is not None:
        agent.goals = req.goals

    await save_session(engine.session)
    return {"ok": True}


@router.post("/{session_id}/run")
async def run_world(session_id: str, req: RunRequest) -> dict:
    """Start or resume the simulation."""
    engine = await get_engine(session_id)
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


@router.post("/{session_id}/daemon")
async def start_daemon(session_id: str, req: DaemonRequest) -> dict:
    """Start autonomous heartbeat — world ticks forever until stopped."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if engine.is_running:
        raise HTTPException(400, "Already running")

    engine.configure(
        model=req.model or None,
        api_key=req.api_key or None,
        api_base=req.api_base or None,
        tick_delay=req.tick_interval,
        on_event=make_event_callback(session_id),
    )

    asyncio.create_task(_run_and_save(engine, max_ticks=None))

    return {"status": "daemon", "tick_interval": req.tick_interval}


@router.post("/{session_id}/step")
async def step_world(session_id: str, req: RunRequest | None = None) -> dict:
    """Execute a single tick."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if engine.is_running:
        raise HTTPException(400, "Cannot step while running — pause first")
    lock = get_session_lock(session_id)
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


@router.post("/{session_id}/pause")
async def pause_world(session_id: str) -> dict:
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    engine.pause()
    return {"status": "paused", "tick": engine.session.tick}


@router.get("/{session_id}/state")
async def get_world_state(session_id: str) -> dict:
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    return await serialize_state_async(engine)


@router.get("/{session_id}/events")
async def get_events(session_id: str, limit: int = 100, offset: int = 0) -> list[dict]:
    return await load_events(session_id, limit=limit, offset=offset)


@router.post("/{session_id}/inject")
async def inject_event(session_id: str, req: InjectEventRequest) -> dict:
    """Inject a user-authored world event into the session."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    lock = get_session_lock(session_id)
    async with lock:
        return await _inject_event_inner(engine, session_id, req)


@router.post("/{session_id}/command")
async def command_endpoint(session_id: str, req: CommandRequest) -> dict:
    """Unified command bar: classify natural-language input and dispatch."""
    from ..commander import classify_command, execute_command

    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    session = engine.session

    # Build context for classification
    agent_names = {
        aid: a.name
        for aid, a in session.agents.items()
        if a.status not in (AgentStatus.DEAD, AgentStatus.GONE)
    }

    classified = await classify_command(
        user_text=req.text,
        agent_names=agent_names,
        location_names=session.location_names,
        world_status=session.status.value,
        tick=session.tick,
        model=req.model,
        api_key=req.api_key,
        api_base=req.api_base,
    )

    intent = classified["intent"]
    params = classified.get("params", {})

    lock = get_session_lock(session_id)
    async with lock:
        result = await execute_command(
            intent=intent,
            params=params,
            session_id=session_id,
            engine=engine,
            model=req.model,
            api_key=req.api_key,
            api_base=req.api_base,
            language=req.language,
        )

    resp = {
        "intent": intent,
        "params": params,
    }
    if result.get("ok"):
        data = result.get("data", {})
        resp["data"] = data
        resp["reply"] = data.get("reply")
    else:
        resp["error"] = result.get("error", "Unknown error")

    return resp


# ── Session-level endpoints (non-/api/worlds prefix) ──

aux_router = APIRouter(tags=["sessions"])


@aux_router.get("/api/sessions")
async def get_sessions() -> list[dict]:
    return await list_sessions()


@aux_router.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: str) -> dict:
    """Delete a session and all its data."""
    if session_id in engines:
        engines[session_id].stop()
        del engines[session_id]
    deleted = await delete_session(session_id)
    if not deleted:
        raise HTTPException(404, "Session not found")
    await delete_seeds_by_source_worlds([session_id])
    return {"deleted": True}
