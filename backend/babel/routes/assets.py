"""BABEL — Assets router (seed library CRUD + extraction)."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import (
    delete_seed,
    get_seed,
    list_seeds,
    list_hidden_seed_refs,
    list_sessions,
    load_entity_details,
    load_event_by_id,
    load_events,
    save_entity_details,
    save_seed,
)
from ..llm import enrich_entity
from ..models import (
    Event,
    SeedEnvelope,
    SeedLineage,
    SeedType,
    WorldSeed,
)
from ..state import get_engine, runtime_lineage, SEEDS_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assets", tags=["assets"])


# ── Request models ───────────────────────────────────

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


class ExtractSeedRequest(BaseModel):
    session_id: str
    target_id: str = ""
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


# ── Helpers ──────────────────────────────────────────

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


# ── CRUD endpoints ───────────────────────────────────

@router.get("")
async def get_assets(type: str | None = None) -> list[dict]:
    """List saved seeds, optionally filtered by type."""
    assets = await list_seeds(seed_type=type)
    stale_ids = await _stale_asset_ids(assets)
    if stale_ids:
        for stale_id in stale_ids:
            await delete_seed(stale_id)
        assets = [asset for asset in assets if asset.get("id") not in stale_ids]
    return assets


@router.get("/{seed_id}")
async def get_asset(seed_id: str) -> dict:
    """Get a single saved seed."""
    seed = await get_seed(seed_id)
    if not seed:
        raise HTTPException(404, "Seed not found")
    if seed.get("id") in await _stale_asset_ids([seed]):
        await delete_seed(seed_id)
        raise HTTPException(404, "Seed not found")
    return seed


@router.post("")
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


@router.patch("/{seed_id}")
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


@router.delete("/{seed_id}")
async def delete_asset(seed_id: str) -> dict:
    """Delete a saved seed."""
    deleted = await delete_seed(seed_id)
    if not deleted:
        raise HTTPException(404, "Seed not found")
    return {"deleted": True}


# ── Extraction endpoints ─────────────────────────────

@router.post("/extract/agent")
async def extract_agent_seed(req: ExtractSeedRequest) -> dict:
    """Extract an agent from a running session as a reusable seed."""
    engine = await get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    agent = engine.session.agents.get(req.target_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {req.target_id}")

    seed = SeedEnvelope.from_agent_state(
        agent,
        source_world=req.session_id,
        lineage=runtime_lineage(
            engine.session,
            root_name=agent.name,
            root_type=SeedType.AGENT.value,
        ),
    )
    return seed.model_dump()


@router.post("/extract/item")
async def extract_item_seed(req: ExtractSeedRequest) -> dict:
    """Extract an item from a running session as a reusable seed."""
    engine = await get_engine(req.session_id)
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
        lineage=runtime_lineage(
            engine.session,
            root_name=item_name,
            root_type=SeedType.ITEM.value,
        ),
    )
    return seed.model_dump()


@router.post("/extract/location")
async def extract_location_seed(req: ExtractSeedRequest) -> dict:
    """Extract a location from a running session as a reusable seed."""
    engine = await get_engine(req.session_id)
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
        lineage=runtime_lineage(
            engine.session,
            root_name=loc.name,
            root_type=SeedType.LOCATION.value,
        ),
    )
    return seed.model_dump()


@router.post("/extract/event")
async def extract_event_seed(req: ExtractSeedRequest) -> dict:
    """Extract an event from a running session as a reusable event seed."""
    engine = await get_engine(req.session_id)
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
            structured=event_data.get("structured") or {},
            location=str(event_data.get("location") or ""),
            involved_agents=event_data.get("involved_agents") or [],
            significance=event_data.get("significance") or {},
            importance=float(event_data.get("importance") or 0.5),
            node_id=str(event_data.get("node_id") or ""),
        ),
        source_world=req.session_id,
        lineage=runtime_lineage(
            engine.session,
            root_name=str(event_data.get("result") or "")[:60],
            root_type=SeedType.EVENT.value,
        ),
    )
    return seed.model_dump()


@router.post("/extract/world")
async def extract_world_seed(req: ExtractSeedRequest) -> dict:
    """Extract the entire world seed from a running session."""
    engine = await get_engine(req.session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    ws = engine.session.world_seed
    seed = SeedEnvelope.from_world_seed(
        ws,
        source_world=ws.name,
        lineage=runtime_lineage(
            engine.session,
            root_name=ws.name,
            root_type=SeedType.WORLD.value,
        ),
    )
    return seed.model_dump()
