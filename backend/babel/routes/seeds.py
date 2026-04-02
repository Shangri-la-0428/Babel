"""BABEL — Seeds CRUD router."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import (
    delete_seed,
    delete_seeds_by_source_worlds,
    delete_session,
    get_seed,
    hide_seed_ref,
    is_seed_ref_hidden,
    list_hidden_seed_refs,
    list_seeds,
    list_sessions,
    save_seed,
)
from ..models import SeedEnvelope, SeedLineage, SeedType, WorldSeed
from ..state import (
    SAVED_WORLD_PREFIX,
    SEEDS_DIR,
    broadcast,
    engine_locks,
    engines,
    global_lock,
    serialize_state,
    ws_clients,
)
from ..validator import validate_seed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/seeds", tags=["seeds"])


# ── Request models ───────────────────────────────────────

class CreateWorldRequest(BaseModel):
    name: str = ""
    description: str = ""
    lore: list[str] = []
    locations: list[dict[str, Any]] = []
    glossary: dict[str, str] = {}
    agents: list[dict[str, Any]] = []
    initial_events: list[str] = []


# ── Helpers ──────────────────────────────────────────────

def _saved_world_ref(seed_id: str) -> str:
    return f"{SAVED_WORLD_PREFIX}{seed_id}"


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
    """Delete sessions AND child seeds linked to a world name."""
    session_ids = await _list_session_ids_for_world_name(world_name)

    # Delete all sessions spawned from this world
    for sid in session_ids:
        # Remove from in-memory engines
        async with global_lock:
            engine = engines.pop(sid, None)
            if engine:
                engine.pause()
            engine_locks.pop(sid, None)
        # Remove from WebSocket clients
        ws_clients.pop(sid, None)
        # Delete from DB (events, agents, timeline, snapshots, memories)
        await delete_session(sid)

    # Delete child seeds (extracted agent/world seeds)
    source_worlds = [world_name, *session_ids]
    return await delete_seeds_by_source_worlds(source_worlds)


# ── Endpoints ────────────────────────────────────────────

@router.get("")
async def get_seeds() -> list[dict]:
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
                logger.debug("Failed to parse %s: %s", f.name, e)
    return seeds


@router.get("/{filename}")
async def get_seed_detail(filename: str) -> dict:
    ws = await _load_world_seed_from_ref(filename)
    return {
        "file": filename,
        "name": ws.name,
        "description": ws.description,
        "lore": ws.lore,
        "locations": [loc.model_dump() for loc in ws.locations],
        "glossary": ws.glossary,
        "agents": [a.model_dump() for a in ws.agents],
        "initial_events": ws.initial_events,
    }


@router.delete("/{filename:path}")
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


@router.patch("/{filename:path}")
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

    # Sync updated seed to any active sessions
    seed_ref = filename
    for sid, engine in engines.items():
        if getattr(engine.session, "seed_lineage", None) and engine.session.seed_lineage.source_seed_ref == seed_ref:
            engine.session.world_seed = world_seed
            for agent_seed in world_seed.agents:
                if agent_seed.id in engine.session.agents:
                    agent = engine.session.agents[agent_seed.id]
                    agent.description = agent_seed.description
                    agent.personality = agent_seed.personality
                    agent.goals = agent_seed.goals
            from ..db import save_session
            await save_session(engine.session)
            logger.info("Synced seed update to session %s", sid)

    return _serialize_seed_summary(filename, world_seed)
