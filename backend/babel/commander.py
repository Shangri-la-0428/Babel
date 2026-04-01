"""BABEL — Unified command bar: classify + dispatch."""

from __future__ import annotations

import logging
import re
from typing import Any

from .llm import _complete_json
from .prompts import COMMAND_CLASSIFY_SYSTEM, build_command_classify_prompt

logger = logging.getLogger(__name__)

# ── Keyword shortcuts (bilingual) ─────────────────────

_KEYWORD_MAP: list[tuple[re.Pattern, str, dict]] = [
    # Control: pause
    (re.compile(r"^(暂停|pause|stop)$", re.I), "control", {"action": "pause"}),
    # Control: run / resume
    (re.compile(r"^(运行|run|resume|继续|start)$", re.I), "control", {"action": "run"}),
    # Control: step (single tick)
    (re.compile(r"^(步进|step|next|下一步)$", re.I), "control", {"action": "step"}),
    # Narrate
    (re.compile(r"^(叙述|narrate|讲述|recap)$", re.I), "narrate", {}),
]


def _try_keyword(text: str) -> dict | None:
    """Check if text matches a keyword shortcut. Returns classified dict or None."""
    stripped = text.strip()
    for pattern, intent, params in _KEYWORD_MAP:
        if pattern.match(stripped):
            return {"intent": intent, "params": params}
    return None


# ── LLM classification ────────────────────────────────

async def classify_command(
    user_text: str,
    agent_names: dict[str, str] | None = None,
    location_names: list[str] | None = None,
    world_status: str = "paused",
    tick: int = 0,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> dict:
    """Classify a command bar input into intent + params.

    First tries keyword shortcuts, then falls back to LLM classification.
    Returns {"intent": "...", "params": {...}}.
    """
    # Fast path: keyword shortcut
    kw = _try_keyword(user_text)
    if kw:
        return kw

    # LLM classification
    user_prompt = build_command_classify_prompt(
        user_text=user_text,
        agent_names=agent_names,
        location_names=location_names,
        world_status=world_status,
        tick=tick,
    )
    result = await _complete_json(
        COMMAND_CLASSIFY_SYSTEM,
        user_prompt,
        model=model,
        api_key=api_key,
        api_base=api_base,
        temperature=0.1,
        max_tokens=256,
    )
    # Ensure structure
    if "intent" not in result:
        result = {"intent": "oracle", "params": {"message": user_text}}
    if "params" not in result:
        result["params"] = {}
    return result


# ── Dispatch ──────────────────────────────────────────

async def execute_command(
    intent: str,
    params: dict[str, Any],
    session_id: str,
    engine: Any,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
    language: str | None = None,
) -> dict:
    """Dispatch a classified intent to the appropriate handler.

    Returns {"ok": True, "data": ...} or {"ok": False, "error": "..."}.
    """
    try:
        handler = _HANDLERS.get(intent)
        if not handler:
            return {"ok": False, "error": f"Unknown intent: {intent}"}
        return await handler(
            params=params,
            session_id=session_id,
            engine=engine,
            model=model,
            api_key=api_key,
            api_base=api_base,
            language=language,
        )
    except Exception as e:
        logger.exception("Command dispatch failed for intent=%s", intent)
        return {"ok": False, "error": str(e)}


# ── Handler implementations ───────────────────────────


async def _handle_inject(*, params, session_id, engine, **kw) -> dict:
    from .api import _inject_event_inner, InjectEventRequest
    req = InjectEventRequest(content=params.get("content", ""))
    result = await _inject_event_inner(engine, session_id, req)
    return {"ok": True, "data": result}


async def _handle_oracle(*, params, session_id, engine, model, api_key, api_base, language, **kw) -> dict:
    from .llm import chat_with_oracle
    from .db import load_narrator_messages, save_narrator_message, load_all_entity_details
    from .clock import world_time

    session = engine.session

    history = await load_narrator_messages(session_id, limit=20)
    conv_history = [{"role": m["role"], "content": m["content"]} for m in history]

    details_rows = await load_all_entity_details(session_id)
    enriched = {
        f"{r['entity_type']}:{r['entity_id']}": r.get("details", {})
        for r in details_rows
    }

    agents_dict = {
        aid: {
            "name": a.name, "personality": a.personality,
            "goals": a.goals, "location": a.location,
            "inventory": a.inventory,
            "status": a.status.value if hasattr(a.status, "value") else a.status,
            "role": a.role.value if hasattr(a.role, "value") else a.role,
        }
        for aid, a in session.agents.items()
    }

    recent = [
        f"[T{e.tick}] {e.agent_name or 'WORLD'}: {e.result}"
        for e in session.events[-15:]
    ]

    wt = world_time(session.tick, session.world_seed.time)
    time_display = wt.display if wt.display and not wt.display.startswith("Tick") else ""
    persona = session.world_seed.narrator.persona if session.world_seed.narrator else ""

    message = params.get("message", "")
    reply = await chat_with_oracle(
        world_name=session.world_seed.name,
        world_description=session.world_seed.description,
        world_rules=session.world_seed.rules,
        agents=agents_dict,
        recent_events=recent,
        enriched_details=enriched,
        conversation_history=conv_history,
        user_message=message,
        narrator_persona=persona,
        world_time_display=time_display,
        preferred_language=language or "",
        model=model, api_key=api_key, api_base=api_base,
    )
    await save_narrator_message(session_id, "user", message, session.tick)
    msg_id = await save_narrator_message(session_id, "oracle", reply, session.tick)
    return {"ok": True, "data": {"reply": reply, "message_id": msg_id}}


async def _handle_agent_chat(*, params, session_id, engine, model, api_key, api_base, language, **kw) -> dict:
    from .llm import chat_with_agent
    from .db import save_narrator_message, query_memories, load_narrator_messages
    from .memory import retrieve_relevant_memories, get_agent_beliefs

    agent_id = params.get("agent_id", "")
    agent = engine.session.agents.get(agent_id)
    if not agent:
        return {"ok": False, "error": f"Agent not found: {agent_id}"}

    memories = await retrieve_relevant_memories(agent, engine.session, limit=8)
    beliefs = await get_agent_beliefs(engine.session.id, agent.agent_id, limit=5)
    memory_strings = [m["content"] for m in memories] + beliefs

    message = params.get("message", "")
    reply = await chat_with_agent(
        agent_name=agent.name,
        agent_personality=agent.personality,
        agent_goals=agent.goals,
        agent_location=agent.location,
        agent_inventory=agent.inventory,
        agent_memory=memory_strings,
        agent_description=agent.description,
        user_message=message,
        preferred_language=language or "",
        model=model, api_key=api_key, api_base=api_base,
    )
    prefix = f"chat:{agent_id}"
    await save_narrator_message(session_id, f"{prefix}:creator", message, engine.session.tick)
    await save_narrator_message(session_id, f"{prefix}:agent", reply, engine.session.tick)
    return {"ok": True, "data": {"agent_id": agent_id, "reply": reply}}


async def _handle_patch_agent(*, params, session_id, engine, **kw) -> dict:
    from .db import save_session

    agent_id = params.get("agent_id", "")
    agent = engine.session.agents.get(agent_id)
    if not agent:
        return {"ok": False, "error": f"Agent not found: {agent_id}"}

    if params.get("name") is not None:
        agent.name = params["name"]
    if params.get("personality") is not None:
        agent.personality = params["personality"]
    if params.get("goals") is not None:
        agent.goals = params["goals"]

    await save_session(engine.session)
    return {"ok": True, "data": {"agent_id": agent_id}}


async def _handle_patch_world(*, params, session_id, engine, **kw) -> dict:
    from .db import save_session
    from .models import LocationSeed

    ws = engine.session.world_seed
    if params.get("name") is not None:
        ws.name = params["name"]
    if params.get("description") is not None:
        ws.description = params["description"]
    if params.get("rules") is not None:
        ws.rules = params["rules"]

    await save_session(engine.session)
    return {"ok": True, "data": {"world_name": ws.name}}


async def _handle_fork(*, params, session_id, engine, **kw) -> dict:
    from .db import load_nearest_snapshot, save_session
    from .models import Session, SessionStatus, WorldSeed, AgentState, SeedLineage, SeedType
    import uuid

    tick = params.get("tick", engine.session.tick)
    snapshot = await load_nearest_snapshot(session_id, tick)
    if not snapshot:
        return {"ok": False, "error": f"No snapshot at or before tick {tick}"}

    world_seed = WorldSeed(**snapshot["world_seed"])
    agent_states = {}
    for aid, adata in snapshot["agent_states"].items():
        adata.pop("memory", None)
        agent_states[aid] = AgentState(**adata)

    branch_id = f"fork-{uuid.uuid4().hex[:6]}"
    new_session = Session(
        world_seed=world_seed,
        agents=agent_states,
        tick=snapshot["tick"],
        status=SessionStatus.PAUSED,
    )
    new_session.seed_lineage = SeedLineage.runtime(
        root_name=world_seed.name,
        source_seed_ref=session_id,
        session_id=new_session.id,
        tick=snapshot["tick"],
        branch_id=branch_id,
        snapshot_id=snapshot["id"],
        root_type=SeedType.WORLD.value,
    )
    await save_session(new_session)
    return {"ok": True, "data": {"new_session_id": new_session.id, "forked_at_tick": snapshot["tick"]}}


async def _handle_control(*, params, session_id, engine, model, api_key, api_base, **kw) -> dict:
    """Delegate to the same logic as the REST endpoints."""
    action = params.get("action", "pause")

    if action == "pause":
        engine.pause()
        return {"ok": True, "data": {"reply": "已暂停", "status": "paused", "tick": engine.session.tick}}

    elif action == "run":
        if engine.is_running:
            return {"ok": False, "error": "Already running"}
        from .api import make_event_callback, _run_and_save
        import asyncio
        engine.configure(
            model=model or None,
            api_key=api_key or None,
            api_base=api_base or None,
            on_event=make_event_callback(session_id),
        )
        asyncio.create_task(_run_and_save(engine, params.get("max_ticks", 50)))
        return {"ok": True, "data": {"reply": "模拟已启动", "status": "running"}}

    elif action == "step":
        if engine.is_running:
            return {"ok": False, "error": "Cannot step while running"}
        from .api import make_event_callback
        from .db import save_session
        engine.configure(
            model=model or None,
            api_key=api_key or None,
            api_base=api_base or None,
            on_event=make_event_callback(session_id),
        )
        events = await engine.step()
        await save_session(engine.session)
        return {"ok": True, "data": {"reply": f"已推进一步，产生 {len(events)} 个事件", "status": "stepping"}}

    return {"ok": False, "error": f"Unknown control action: {action}"}


async def _handle_narrate(*, params, session_id, engine, model, api_key, api_base, language, **kw) -> dict:
    """Auto-narrate recent events via Oracle."""
    # Reuse oracle handler with a narration prompt
    use_cn = (language or "").strip().lower() in {"cn", "zh", "zh-cn", "zh_cn", "chinese"}
    narrate_msg = (
        "请用生动简洁的语言叙述这个世界最近发生的事件。"
        if use_cn else
        "Narrate what has happened recently in this world. Be vivid and concise."
    )
    return await _handle_oracle(
        params={"message": narrate_msg},
        session_id=session_id,
        engine=engine,
        model=model,
        api_key=api_key,
        api_base=api_base,
        language=language,
    )


# ── Handler registry ──────────────────────────────────

_HANDLERS = {
    "inject": _handle_inject,
    "oracle": _handle_oracle,
    "agent_chat": _handle_agent_chat,
    "patch_agent": _handle_patch_agent,
    "patch_world": _handle_patch_world,
    "fork": _handle_fork,
    "control": _handle_control,
    "narrate": _handle_narrate,
}
