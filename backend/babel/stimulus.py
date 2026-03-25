"""BABEL — Stimulus Synthesizer.

Maps BABEL's AgentContext to Psyche stimulus text.
Psyche classifies stimuli into 14 types:
  praise, criticism, humor, intellectual, intimacy, conflict,
  neglect, surprise, casual, sarcasm, authority, validation,
  boredom, vulnerability

The synthesizer doesn't classify directly — it generates a natural-language
description of the agent's current situation, which Psyche then classifies.
"""

from __future__ import annotations

from .decision import AgentContext


def synthesize_stimulus(ctx: AgentContext) -> str:
    """Convert an AgentContext into a stimulus description for Psyche.

    Returns a natural-language paragraph describing what the agent
    is currently experiencing, so Psyche can classify the emotional
    stimulus and produce appropriate policy modifiers.
    """
    parts: list[str] = []

    # Location & environment
    parts.append(f"{ctx.agent_name} is at {ctx.agent_location}.")

    # Time context
    if ctx.world_time:
        period = ctx.world_time.get("period", "")
        display = ctx.world_time.get("display", "")
        if display:
            parts.append(f"It is {display} ({period})." if period else f"It is {display}.")

    # Social context — who's nearby
    same_loc = [
        a for a in ctx.visible_agents
        if a.get("location") == ctx.agent_location
    ]
    if same_loc:
        names = [a.get("name", a.get("id", "someone")) for a in same_loc]
        parts.append(f"Nearby: {', '.join(names)}.")
    else:
        parts.append("Nobody else is around.")

    # Recent events — what just happened
    if ctx.recent_events:
        # Take the last 3 most recent events
        recent = ctx.recent_events[-3:]
        parts.append("Recent events: " + "; ".join(recent) + ".")

    # Urgent events — high-priority stimuli
    if ctx.urgent_events:
        parts.append("URGENT: " + "; ".join(ctx.urgent_events) + ".")

    # Relationship context
    if ctx.relations:
        for rel in ctx.relations[:3]:
            target = rel.get("target_name", rel.get("target", ""))
            attitude = rel.get("attitude", "")
            if target and attitude:
                parts.append(f"Relationship with {target}: {attitude}.")

    # Goal pressure
    if ctx.active_goal:
        goal_desc = ctx.active_goal.get("text", ctx.active_goal.get("description", ""))
        goal_progress = ctx.active_goal.get("progress", 0)
        if goal_desc:
            parts.append(f"Current goal: {goal_desc} (progress: {goal_progress}%).")

    # Inventory state
    if ctx.agent_inventory:
        parts.append(f"Carrying: {', '.join(ctx.agent_inventory)}.")

    # Drive state context (Phase B)
    if ctx.drive_state:
        low = [d for d, v in ctx.drive_state.items() if v < 40]
        if low:
            parts.append(f"Feeling unsatisfied in: {', '.join(low)}.")

    # Isolation detection (neglect stimulus)
    if not same_loc and ctx.tick > 5:
        parts.append("Has been without social contact.")

    return " ".join(parts)


def detect_stimulus_hints(ctx: AgentContext) -> list[str]:
    """Detect likely stimulus types from context (heuristic hints).

    These are soft hints — Psyche does the actual classification.
    Useful for logging and debugging.
    """
    hints: list[str] = []

    same_loc = [
        a for a in ctx.visible_agents
        if a.get("location") == ctx.agent_location
    ]

    # Social signals
    if not same_loc and ctx.tick > 5:
        hints.append("neglect")
    if same_loc:
        hints.append("casual")

    # Conflict detection
    if ctx.relations:
        for rel in ctx.relations:
            attitude = str(rel.get("attitude", "")).lower()
            if any(w in attitude for w in ("hostile", "enemy", "distrust", "rival")):
                hints.append("conflict")
                break

    # Urgent = surprise or authority
    if ctx.urgent_events:
        hints.append("surprise")

    # Goal completion → validation
    if ctx.active_goal:
        progress = ctx.active_goal.get("progress", 0)
        if progress >= 80:
            hints.append("validation")

    return hints
