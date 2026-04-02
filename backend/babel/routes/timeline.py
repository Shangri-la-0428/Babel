"""Timeline / Fork / Replay router — extracted from api.py."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import (
    load_events,
    load_events_filtered,
    load_nearest_snapshot,
    load_timeline,
    list_snapshots,
    query_memories,
    save_session,
)
from ..models import (
    AgentState,
    SeedLineage,
    SeedType,
    Session,
    SessionStatus,
    WorldSeed,
)
from ..report import generate_report
from ..state import (
    get_engine,
    engines,
    global_lock,
    make_engine,
    make_event_callback,
    broadcast,
)

router = APIRouter(tags=["timeline"])


# ── Feature 4: Session replay ─────────────────────────


@router.get("/api/worlds/{session_id}/replay")
async def get_replay(session_id: str, limit: int = 500, offset: int = 0) -> dict:
    """Return full event history and initial state for session replay."""
    engine = await get_engine(session_id)
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


# ── OBSERVE: World Report ─────────────────────────────


@router.get("/api/worlds/{session_id}/report")
async def get_world_report(session_id: str) -> dict:
    """Generate a significance-driven world report. Zero LLM calls."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    return await generate_report(session_id, engine.session)


# ── Timeline & Memory endpoints ───────────────────────


@router.get("/api/worlds/{session_id}/timeline")
async def get_timeline(
    session_id: str,
    branch: str = "main",
    from_tick: int = 0,
    to_tick: int | None = None,
) -> dict:
    """Get timeline nodes for a session."""
    nodes = await load_timeline(session_id, branch, from_tick, to_tick)
    return {"nodes": nodes, "branch": branch}


@router.get("/api/worlds/{session_id}/snapshots")
async def get_snapshots(session_id: str) -> list[dict]:
    """List all snapshots for a session."""
    return await list_snapshots(session_id)


@router.get("/api/worlds/{session_id}/agents/{agent_id}/memories")
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


@router.post("/api/worlds/{session_id}/reconstruct")
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


# ── FORK: branch a new world from a snapshot ─────────


class ForkRequest(BaseModel):
    tick: int


@router.post("/api/worlds/{session_id}/fork")
async def fork_world(session_id: str, req: ForkRequest) -> dict:
    """Create a new world session branching from a snapshot at the given tick."""
    # 1. Load nearest snapshot
    snapshot = await load_nearest_snapshot(session_id, req.tick)
    if not snapshot:
        raise HTTPException(404, f"No snapshot found at or before tick {req.tick}")

    # 2. Reconstruct world seed and agent states from snapshot
    world_seed = WorldSeed(**snapshot["world_seed"])
    agent_states: dict[str, AgentState] = {}
    for aid, adata in snapshot["agent_states"].items():
        adata.pop("memory", None)  # legacy field
        agent_states[aid] = AgentState(**adata)

    # 3. Create new session at the snapshot tick
    branch_id = f"fork-{uuid.uuid4().hex[:6]}"
    new_session = Session(
        world_seed=world_seed,
        agents=agent_states,
        tick=snapshot["tick"],
        status=SessionStatus.PAUSED,
    )
    new_session.seed_lineage = SeedLineage.runtime(
        root_name=world_seed.name,
        source_seed_ref=session_id,  # parent session
        session_id=new_session.id,
        tick=snapshot["tick"],
        branch_id=branch_id,
        snapshot_id=snapshot["id"],
        root_type=SeedType.WORLD.value,
    )

    # 4. Copy relations from parent at fork point; pause parent so it doesn't advance
    parent_engine = await get_engine(session_id)
    if parent_engine:
        if parent_engine.is_running:
            parent_engine.pause()
            await save_session(parent_engine.session)
            await broadcast(session_id, "status", {"status": "paused"})
        new_session.relations = [r.model_copy() for r in parent_engine.session.relations]

    await save_session(new_session)

    # 5. Register engine
    async with global_lock:
        engines[new_session.id] = make_engine(new_session, on_event=make_event_callback(new_session.id))

    return {
        "session_id": new_session.id,
        "parent_session_id": session_id,
        "fork_tick": snapshot["tick"],
        "branch_id": branch_id,
        "name": world_seed.name,
        "agents": [a.name for a in new_session.agents.values()],
        "tick": new_session.tick,
        "status": new_session.status.value,
    }
