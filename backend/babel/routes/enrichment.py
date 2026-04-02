"""Entity enrichment router — progressive detail generation for world entities."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..state import get_engine
from ..db import (
    load_events,
    load_events_filtered,
    load_entity_details,
    load_all_entity_details,
    save_entity_details,
)
from ..llm import enrich_entity
from ..models import Event
from ..clock import world_time

router = APIRouter(tags=["enrichment"])


# ── Request models ───────────────────────────────────────

class EnrichRequest(BaseModel):
    entity_type: str
    entity_id: str
    language: str | None = None
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None


class SaveEntityDetailsRequest(BaseModel):
    entity_type: str
    entity_id: str
    details: dict[str, Any] = {}


# ── Endpoints ────────────────────────────────────────────

@router.post("/api/worlds/{session_id}/enrich")
async def enrich_entity_endpoint(session_id: str, req: EnrichRequest) -> dict:
    """Generate or update rich narrative details for a world entity."""
    engine = await get_engine(session_id)
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


@router.get("/api/worlds/{session_id}/entity-details")
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


@router.patch("/api/worlds/{session_id}/entity-details")
async def save_entity_details_endpoint(session_id: str, req: SaveEntityDetailsRequest) -> dict:
    """Persist manually edited local details for a world entity."""
    engine = await get_engine(session_id)
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
