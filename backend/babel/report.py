"""World report generator — significance-driven narrative aggregation.

A report is a pure projection of significance data: zero LLM calls,
zero new computations. It aggregates what the significance kernel
already tagged during simulation into a structured retrospective.

    events + agents + relations  →  report
"""

from __future__ import annotations

from .db import load_events
from .models import AgentStatus, Session


async def generate_report(session_id: str, session: Session) -> dict:
    """Build a world report from DB events + live session state."""
    raw_events = await load_events(session_id, limit=100_000)

    agents = session.agents
    relations = session.relations
    tick = session.tick
    seed = session.world_seed

    # ── Classify events ───────────────────────────────────
    significant: list[dict] = []
    durable: list[dict] = []
    axis_counts: dict[str, int] = {}
    action_counts: dict[str, int] = {}

    for e in raw_events:
        sig = e.get("significance") or {}
        at = e.get("action_type", "wait")
        action_counts[at] = action_counts.get(at, 0) + 1

        is_sig = sig.get("durable", False) or sig.get("score", 0.5) >= 0.75
        if is_sig:
            significant.append(e)
        if sig.get("durable", False):
            durable.append(e)

        for axis in sig.get("axes", []):
            axis_counts[axis] = axis_counts.get(axis, 0) + 1

    # ── Agent arcs ────────────────────────────────────────
    agent_arcs = _build_agent_arcs(agents, significant)

    # ── Relation arcs ─────────────────────────────────────
    relation_arcs = _build_relation_arcs(relations, agents)

    # ── Social highlights ─────────────────────────────────
    social = _build_social_highlights(relations, agents)

    # ── Milestones (durable events as timeline) ───────────
    milestones = [_event_summary(e) for e in durable]

    total = max(len(raw_events), 1)
    return {
        "session_id": session_id,
        "name": seed.name,
        "description": seed.description,
        "tick": tick,
        "agents_total": len(agents),
        "agents_alive": sum(
            1 for a in agents.values()
            if a.status not in (AgentStatus.DEAD, AgentStatus.GONE)
        ),
        "agents_dead": sum(
            1 for a in agents.values()
            if a.status in (AgentStatus.DEAD, AgentStatus.GONE)
        ),
        "total_events": len(raw_events),
        "significant_events": len(significant),
        "durable_events": len(durable),
        "significance_ratio": round(len(significant) / total, 3),
        "action_distribution": action_counts,
        "axis_distribution": axis_counts,
        "agent_arcs": agent_arcs,
        "relation_arcs": relation_arcs,
        "milestones": milestones,
        "social_highlights": social,
    }


# ── Internal helpers ──────────────────────────────────────


def _build_agent_arcs(
    agents: dict,
    significant_events: list[dict],
) -> list[dict]:
    arcs = []
    for agent in agents.values():
        key_events = [
            e
            for e in significant_events
            if agent.agent_id in e.get("involved_agents", [])
            or e.get("agent_id") == agent.agent_id
        ]

        goal = agent.active_goal
        arcs.append(
            {
                "agent_id": agent.agent_id,
                "name": agent.name,
                "personality": agent.personality,
                "alive": agent.status
                not in (AgentStatus.DEAD, AgentStatus.GONE),
                "location": agent.location,
                "goal_text": goal.text if goal else None,
                "goal_status": goal.status if goal else None,
                "goal_progress": round(goal.progress, 2) if goal else 0,
                "goal_stall_count": goal.stall_count if goal else 0,
                "goals_total": len(agent.goals),
                "key_events": [_event_summary(e) for e in key_events[-8:]],
                "event_count": len(key_events),
            }
        )
    return arcs


def _build_relation_arcs(relations: list, agents: dict) -> list[dict]:
    name_map = {a.agent_id: a.name for a in agents.values()}
    arcs = []
    for rel in relations:
        arcs.append(
            {
                "source": rel.source,
                "target": rel.target,
                "source_name": name_map.get(rel.source, rel.source),
                "target_name": name_map.get(rel.target, rel.target),
                "type": rel.type,
                "strength": round(rel.strength, 2),
                "trust": round(rel.trust, 2),
                "tension": round(rel.tension, 2),
                "familiarity": round(rel.familiarity, 2),
                "last_interaction": rel.last_interaction,
            }
        )
    return arcs


def _build_social_highlights(relations: list, agents: dict) -> dict:
    name_map = {a.agent_id: a.name for a in agents.values()}
    alliances: list[dict] = []
    rivalries: list[dict] = []

    for rel in relations:
        src = name_map.get(rel.source, rel.source)
        tgt = name_map.get(rel.target, rel.target)
        if rel.trust >= 0.7 and rel.tension < 0.3:
            alliances.append(
                {"pair": f"{src} \u2194 {tgt}", "trust": round(rel.trust, 2)}
            )
        elif rel.tension >= 0.5 or rel.type in ("hostile", "rival"):
            rivalries.append(
                {"pair": f"{src} \u2194 {tgt}", "tension": round(rel.tension, 2)}
            )

    alliances.sort(key=lambda x: x["trust"], reverse=True)
    rivalries.sort(key=lambda x: x["tension"], reverse=True)
    return {"alliances": alliances[:5], "rivalries": rivalries[:5]}


def _event_summary(e: dict) -> dict:
    sig = e.get("significance") or {}
    return {
        "tick": e.get("tick", 0),
        "agent_name": e.get("agent_name"),
        "action_type": e.get("action_type", ""),
        "result": e.get("result", ""),
        "score": sig.get("score", 0.5),
        "primary_axis": sig.get("primary", "ambient"),
        "durable": sig.get("durable", False),
        "reasons": sig.get("reasons", []),
    }
