"""BABEL — Canonical event significance protocol.

Events are not just log lines. They carry a normalized account of:
- which layer of the world they changed most
- how strong that change was
- whether it should persist into long-horizon artifacts
"""

from __future__ import annotations

from typing import Any

from .models import Event, EventSignificance, GoalState, Relation


BASE_EVENT_IMPORTANCE = {
    "speak": 0.6,
    "trade": 0.8,
    "use_item": 0.7,
    "move": 0.3,
    "observe": 0.5,
    "wait": 0.1,
    "world_event": 0.9,
}


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _relation_value(relation: Relation | None, field: str) -> float:
    if relation is None:
        return 0.0
    return float(getattr(relation, field, 0.0) or 0.0)


def event_score(event: Event | dict[str, Any], fallback: float = 0.5) -> float:
    significance = getattr(event, "significance", None) if not isinstance(event, dict) else event.get("significance")
    if significance:
        if hasattr(significance, "score"):
            return float(significance.score)
        if isinstance(significance, dict):
            raw_score = significance.get("score")
            if isinstance(raw_score, (int, float)):
                return float(raw_score)

    raw_importance = getattr(event, "importance", None) if not isinstance(event, dict) else event.get("importance")
    if isinstance(raw_importance, (int, float)):
        return float(raw_importance)

    action_type = getattr(event, "action_type", None) if not isinstance(event, dict) else event.get("action_type")
    if hasattr(action_type, "value"):
        action_type = action_type.value
    return float(BASE_EVENT_IMPORTANCE.get(str(action_type or ""), fallback))


def event_is_significant(event: Event | dict[str, Any], threshold: float = 0.75) -> bool:
    significance = getattr(event, "significance", None) if not isinstance(event, dict) else event.get("significance")
    if significance:
        durable = significance.durable if hasattr(significance, "durable") else significance.get("durable")
        if durable:
            return True
    return event_score(event) >= threshold


def assess_event_significance(
    event: Event,
    *,
    goal_before: GoalState | None = None,
    goal_after: GoalState | None = None,
    relation_before: Relation | None = None,
    relation_after: Relation | None = None,
) -> EventSignificance:
    action_type = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
    base_score = max(float(getattr(event, "importance", 0.0) or 0.0), BASE_EVENT_IMPORTANCE.get(action_type, 0.5))

    primary = "ambient"
    score = base_score
    durable = False
    axes: list[str] = []
    reasons: list[str] = []
    delta: dict[str, Any] = {}

    if action_type == "world_event":
        primary = "world"
        axes.append("world")
        reasons.append("World state shifted for everyone, not just one actor.")
        score = max(score, 0.9)
        durable = True

    if action_type == "move":
        axes.append("state")
        delta["location_changed"] = bool(event.location)
        reasons.append("Changes what the actor can reach next.")
    elif action_type in {"trade", "use_item"}:
        axes.append("resource")
        reasons.append("Changes resources or leverage in the world.")
    elif action_type == "observe":
        axes.append("information")
    elif action_type == "speak":
        axes.append("social")

    if goal_before or goal_after:
        before_progress = goal_before.progress if goal_before else 0.0
        after_progress = goal_after.progress if goal_after else before_progress
        progress_delta = round(after_progress - before_progress, 3)
        if abs(progress_delta) > 0:
            axes.append("goal")
            delta["goal_progress"] = progress_delta
            primary = "goal"
            score = max(score, 0.72 if progress_delta > 0 else 0.6)
            reasons.append("Moves the actor closer to or farther from an active goal.")
            if progress_delta >= 0.18:
                durable = True

        before_status = goal_before.status if goal_before else "active"
        after_status = goal_after.status if goal_after else before_status
        if after_status != before_status:
            axes.append("goal")
            delta["goal_status"] = after_status
            if after_status == "completed":
                primary = "goal"
                score = max(score, 0.92)
                durable = True
                reasons.append("Completes a goal and changes the actor's trajectory.")
            elif after_status == "stalled":
                score = max(score, 0.78)
                durable = True
                reasons.append("Forces a goal replan or reveals a real blocker.")

    if relation_before or relation_after:
        trust_delta = round(_relation_value(relation_after, "trust") - _relation_value(relation_before, "trust"), 3)
        tension_delta = round(_relation_value(relation_after, "tension") - _relation_value(relation_before, "tension"), 3)
        debt_delta = round(_relation_value(relation_after, "debt_balance") - _relation_value(relation_before, "debt_balance"), 3)
        leverage_delta = round(_relation_value(relation_after, "leverage") - _relation_value(relation_before, "leverage"), 3)
        strength_delta = round(_relation_value(relation_after, "strength") - _relation_value(relation_before, "strength"), 3)

        social_shift = any(abs(value) >= 0.03 for value in (
            trust_delta, tension_delta, debt_delta, leverage_delta, strength_delta,
        ))
        if social_shift:
            axes.append("social")
            delta.update({
                "trust": trust_delta,
                "tension": tension_delta,
                "debt": debt_delta,
                "leverage": leverage_delta,
                "relation_strength": strength_delta,
            })
            if primary == "ambient":
                primary = "social"
            if tension_delta >= 0.05 or trust_delta <= -0.05:
                score = max(score, 0.78)
                durable = True
                reasons.append("Alters social tension in a way that can compound over time.")
            else:
                score = max(score, 0.68)
                reasons.append("Changes an ongoing social relationship.")

    if primary == "ambient":
        if "resource" in axes:
            primary = "state"
        elif "information" in axes:
            primary = "information"
        elif "social" in axes:
            primary = "social"
        elif "state" in axes:
            primary = "state"

    if score >= 0.8:
        durable = True

    if not axes:
        axes = ["ambient"]
    if not reasons:
        reasons = ["A local action occurred without broader durable consequences."]

    return EventSignificance(
        primary=primary,
        score=min(max(score, 0.0), 1.0),
        durable=durable,
        axes=_unique(axes),
        reasons=_unique(reasons),
        delta=delta,
    )


def finalize_event_significance(
    event: Event,
    *,
    goal_before: GoalState | None = None,
    goal_after: GoalState | None = None,
    relation_before: Relation | None = None,
    relation_after: Relation | None = None,
) -> Event:
    significance = assess_event_significance(
        event,
        goal_before=goal_before,
        goal_after=goal_after,
        relation_before=relation_before,
        relation_after=relation_after,
    )
    event.significance = significance
    event.importance = significance.score
    return event
