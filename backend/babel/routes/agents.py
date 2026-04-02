"""BABEL — Agent control router.

Human agent control ("Play as Agent") and external SDK agent connections.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..decision import HumanDecisionSource, ExternalDecisionSource
from ..models import ActionOutput, ActionType
from ..state import get_engine, get_session_lock, broadcast

router = APIRouter(tags=["agents"])


# ── Request Models ────────────────────────────────────


class HumanActionRequest(BaseModel):
    agent_id: str
    action_type: str  # "speak", "move", "trade", "observe", "wait", "use_item"
    target: str = ""
    content: str = ""


class ExternalActionRequest(BaseModel):
    action_type: str  # "speak", "move", "trade", "observe", "wait", "use_item"
    target: str = ""
    content: str = ""


# ── DIRECT: Human agent control ("Play as Agent") ─────


@router.post("/api/worlds/{session_id}/take-control/{agent_id}")
async def take_control(session_id: str, agent_id: str) -> dict:
    """Take human control of an agent. Its decisions will wait for human input."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if agent_id not in engine.session.agents:
        raise HTTPException(404, f"Agent not found: {agent_id}")
    lock = get_session_lock(session_id)
    async with lock:
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


@router.post("/api/worlds/{session_id}/release-control/{agent_id}")
async def release_control(session_id: str, agent_id: str) -> dict:
    """Release human control of an agent. It returns to AI decisions."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    lock = get_session_lock(session_id)
    async with lock:
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


@router.post("/api/worlds/{session_id}/human-action")
async def submit_human_action(session_id: str, req: HumanActionRequest) -> dict:
    """Submit an action for a human-controlled agent."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

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


@router.get("/api/worlds/{session_id}/human-status")
async def get_human_status(session_id: str) -> dict:
    """Get human control status — which agents are controlled, which are waiting."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

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


# ── EXTERNAL: SDK agent gateway ────────────────────────


@router.post("/api/worlds/{session_id}/agents/{agent_id}/connect")
async def connect_external_agent(session_id: str, agent_id: str) -> dict:
    """Connect an SDK agent to inhabit this world."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")
    if agent_id not in engine.session.agents:
        raise HTTPException(404, f"Agent not found: {agent_id}")

    lock = get_session_lock(session_id)
    async with lock:
        if not isinstance(engine.decision_source, ExternalDecisionSource):
            engine.decision_source = ExternalDecisionSource(
                fallback=engine.decision_source,
            )
        engine.decision_source.connect(agent_id)

    await broadcast(session_id, "external_agent", {
        "agent_id": agent_id, "connected": True,
    })
    return {"agent_id": agent_id, "connected": True}


@router.delete("/api/worlds/{session_id}/agents/{agent_id}/connect")
async def disconnect_external_agent(session_id: str, agent_id: str) -> dict:
    """Disconnect an SDK agent. It returns to AI decisions."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    lock = get_session_lock(session_id)
    async with lock:
        if isinstance(engine.decision_source, ExternalDecisionSource):
            engine.decision_source.disconnect(agent_id)
            if not engine.decision_source.external_agents and engine.decision_source._fallback:
                engine.decision_source = engine.decision_source._fallback

    await broadcast(session_id, "external_agent", {
        "agent_id": agent_id, "connected": False,
    })
    return {"agent_id": agent_id, "connected": False}


@router.get("/api/worlds/{session_id}/agents/{agent_id}/perceive")
async def perceive(session_id: str, agent_id: str, timeout: float = 30.0) -> dict:
    """Long-poll until the engine starts this agent's turn, then return world context."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    if not isinstance(engine.decision_source, ExternalDecisionSource):
        raise HTTPException(400, "Agent is not externally controlled")
    if agent_id not in engine.decision_source.external_agents:
        raise HTTPException(400, f"Agent {agent_id} is not externally connected")

    ctx = await engine.decision_source.perceive(agent_id, timeout=min(timeout, 60.0))
    if ctx is None:
        return {"status": "no_turn", "context": None}
    return {"status": "ready", "context": ctx.model_dump()}


@router.post("/api/worlds/{session_id}/agents/{agent_id}/act")
async def act(session_id: str, agent_id: str, req: ExternalActionRequest) -> dict:
    """Submit an action for an externally controlled agent."""
    engine = await get_engine(session_id)
    if not engine:
        raise HTTPException(404, "Session not found")

    if not isinstance(engine.decision_source, ExternalDecisionSource):
        raise HTTPException(400, "Agent is not externally controlled")

    try:
        action_type = ActionType(req.action_type)
    except ValueError:
        raise HTTPException(400, f"Invalid action type: {req.action_type}")

    action = ActionOutput(
        type=action_type,
        target=req.target or None,
        content=req.content or "",
    )
    accepted = engine.decision_source.act(agent_id, action)
    if not accepted:
        raise HTTPException(400, "No pending turn — agent may have timed out")

    return {"accepted": True, "agent_id": agent_id, "action_type": req.action_type}
