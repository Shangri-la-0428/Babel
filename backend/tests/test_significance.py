from __future__ import annotations

from babel.models import Event, GoalState, Relation
from babel.significance import assess_event_significance, event_is_significant, finalize_event_significance


def test_world_event_significance_is_world_and_durable():
    event = Event(
        session_id="sess",
        tick=1,
        action_type="world_event",
        action={"content": "A district-wide blackout hits the harbor."},
        result="[WORLD] A district-wide blackout hits the harbor.",
    )

    finalize_event_significance(event)

    assert event.significance.primary == "world"
    assert event.significance.durable is True
    assert event.significance.score >= 0.9
    assert event_is_significant(event) is True


def test_goal_progress_raises_event_significance():
    event = Event(
        session_id="sess",
        tick=2,
        agent_id="a1",
        agent_name="Alice",
        action_type="observe",
        action={"content": "Checks the dock records"},
        result="Alice finds the dock records she needed.",
    )

    significance = assess_event_significance(
        event,
        goal_before=GoalState(text="find the dock records", progress=0.0),
        goal_after=GoalState(text="find the dock records", progress=0.22),
    )

    assert significance.primary == "goal"
    assert significance.delta["goal_progress"] == 0.22
    assert significance.durable is True


def test_social_tension_shift_becomes_durable_social_event():
    event = Event(
        session_id="sess",
        tick=3,
        agent_id="a1",
        agent_name="Alice",
        action_type="speak",
        action={"target": "a2", "content": "accuses Bob of hiding supplies"},
        result="Alice publicly accuses Bob of hiding supplies.",
    )

    significance = assess_event_significance(
        event,
        relation_before=Relation(source="a1", target="a2", strength=0.6, trust=0.6, tension=0.2),
        relation_after=Relation(source="a1", target="a2", strength=0.52, trust=0.5, tension=0.32),
    )

    assert significance.primary == "social"
    assert significance.delta["tension"] == 0.12
    assert significance.durable is True
