"""BABEL — Oracle / Chat router."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..clock import world_time
from ..db import (
    load_all_entity_details,
    load_events,
    load_narrator_messages,
    save_narrator_message,
    save_seed,
)
from ..llm import chat_with_agent, chat_with_oracle, generate_seed_draft
from ..memory import get_agent_beliefs, retrieve_relevant_memories
from ..models import Event, SeedEnvelope, SeedLineage, SeedType, WorldSeed
from ..state import get_engine, oracle_prefers_chinese, event_dict, serialize_state

logger = logging.getLogger(__name__)

router = APIRouter(tags=["oracle"])


# ── Request models ────────────────────────────────────

class ChatRequest(BaseModel):
    agent_id: str
    message: str
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    language: str | None = None


class OracleChatRequest(BaseModel):
    message: str
    mode: str = "narrate"
    model: str | None = None
    api_key: str | None = None
    api_base: str | None = None
    language: str | None = None


# ── OBSERVE: Chat with agent ──────────────────────────

@router.post("/api/worlds/{session_id}/chat")
async def chat_with_agent_endpoint(session_id: str, req: ChatRequest) -> dict:
    """Chat with an agent. Persisted and injected as world event."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    agent = engine.session.agents.get(req.agent_id)
    if not agent:
        raise HTTPException(404, f"Agent not found: {req.agent_id}")

    # Use structured memory instead of legacy sliding window
    memories = await retrieve_relevant_memories(agent, engine.session, limit=8)
    beliefs = await get_agent_beliefs(engine.session.id, agent.agent_id, limit=5)
    memory_strings = [m["content"] for m in memories] + beliefs

    reply = await chat_with_agent(
        agent_name=agent.name,
        agent_personality=agent.personality,
        agent_goals=agent.goals,
        agent_location=agent.location,
        agent_inventory=agent.inventory,
        agent_memory=memory_strings,
        agent_description=agent.description,
        user_message=req.message,
        preferred_language=req.language or "",
        model=req.model,
        api_key=req.api_key,
        api_base=req.api_base,
    )

    # Persist chat messages
    chat_role_prefix = f"chat:{req.agent_id}"
    await save_narrator_message(session_id, f"{chat_role_prefix}:creator", req.message, engine.session.tick)
    await save_narrator_message(session_id, f"{chat_role_prefix}:agent", reply, engine.session.tick)

    return {
        "agent_id": req.agent_id,
        "agent_name": agent.name,
        "reply": reply,
    }


@router.get("/api/worlds/{session_id}/chat-history/{agent_id}")
async def get_chat_history(session_id: str, agent_id: str, limit: int = 50) -> list[dict]:
    """Get chat history with a specific agent."""
    messages = await load_narrator_messages(session_id, limit=200)
    prefix = f"chat:{agent_id}:"
    result = []
    for m in messages:
        if m["role"].startswith(prefix):
            role_type = m["role"].split(":")[-1]  # "creator" or "agent"
            result.append({
                "role": role_type,
                "text": m["content"],
                "tick": m.get("tick", 0),
                "id": m.get("id", ""),
            })
    return result[-limit:]


# ── OBSERVE: Oracle (omniscient narrator) ─────────────

@router.post("/api/worlds/{session_id}/oracle")
async def oracle_chat_endpoint(session_id: str, req: OracleChatRequest) -> dict:
    """Chat with the omniscient Oracle narrator.

    mode="narrate" (default): Omniscient narrator conversation.
    mode="create": Creative co-pilot — generate a WorldSeed JSON from conversation.
    """
    engine = await get_engine(session_id)
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
            if oracle_prefers_chinese(req.language, req.message):
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
        world_lore=session.world_seed.lore,
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


@router.get("/api/worlds/{session_id}/oracle/history")
async def oracle_history_endpoint(session_id: str, limit: int = 50) -> list[dict]:
    """Load Oracle conversation history for a session."""
    return await load_narrator_messages(session_id, limit=limit)
