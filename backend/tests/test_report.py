"""Tests for world report generator."""

from unittest.mock import AsyncMock, patch

import pytest

from babel.models import (
    AgentState,
    AgentStatus,
    Event,
    EventSignificance,
    GoalState,
    Relation,
    Session,
    WorldSeed,
)
from babel.report import generate_report


def _make_session() -> Session:
    seed = WorldSeed(name="Test World", description="A test world")
    session = Session(id="s1", world_seed=seed, tick=50)

    alice = AgentState(
        agent_id="alice",
        name="Alice",
        personality="brave",
        location="Bar",
        goals=["survive", "find gold"],
        active_goal=GoalState(text="survive", status="active", progress=0.6),
    )
    bob = AgentState(
        agent_id="bob",
        name="Bob",
        personality="cunning",
        location="Alley",
        status=AgentStatus.DEAD,
        goals=["escape"],
        active_goal=GoalState(text="escape", status="failed", progress=0.2),
    )
    session.agents = {"alice": alice, "bob": bob}
    session.relations = [
        Relation(
            source="alice",
            target="bob",
            type="ally",
            strength=0.8,
            trust=0.75,
            tension=0.1,
            familiarity=0.6,
            last_interaction="traded supplies",
            last_tick=45,
        ),
    ]
    return session


def _make_events() -> list[dict]:
    """Synthetic events as dicts (DB format)."""
    return [
        {
            "id": "e1",
            "tick": 5,
            "agent_id": "alice",
            "agent_name": "Alice",
            "action_type": "speak",
            "result": "Alice greeted Bob warmly.",
            "involved_agents": ["alice", "bob"],
            "significance": {
                "score": 0.6,
                "primary": "social",
                "durable": False,
                "axes": ["social"],
                "reasons": [],
                "delta": {},
            },
        },
        {
            "id": "e2",
            "tick": 10,
            "agent_id": "alice",
            "agent_name": "Alice",
            "action_type": "trade",
            "result": "Alice traded a knife to Bob for medicine.",
            "involved_agents": ["alice", "bob"],
            "significance": {
                "score": 0.85,
                "primary": "resource",
                "durable": True,
                "axes": ["resource", "social"],
                "reasons": ["high-value trade"],
                "delta": {},
            },
        },
        {
            "id": "e3",
            "tick": 20,
            "agent_id": None,
            "agent_name": None,
            "action_type": "world_event",
            "result": "A violent earthquake shook the entire city.",
            "involved_agents": [],
            "significance": {
                "score": 0.95,
                "primary": "world",
                "durable": True,
                "axes": ["world", "state"],
                "reasons": ["catastrophic event"],
                "delta": {},
            },
        },
        {
            "id": "e4",
            "tick": 30,
            "agent_id": "bob",
            "agent_name": "Bob",
            "action_type": "move",
            "result": "Bob moved to Alley.",
            "involved_agents": ["bob"],
            "significance": {
                "score": 0.3,
                "primary": "ambient",
                "durable": False,
                "axes": [],
                "reasons": [],
                "delta": {},
            },
        },
        {
            "id": "e5",
            "tick": 40,
            "agent_id": "alice",
            "agent_name": "Alice",
            "action_type": "observe",
            "result": "Alice scanned the ruins.",
            "involved_agents": ["alice"],
            "significance": {
                "score": 0.5,
                "primary": "information",
                "durable": False,
                "axes": ["information"],
                "reasons": [],
                "delta": {},
            },
        },
    ]


@pytest.mark.asyncio
async def test_report_structure():
    """Report contains all required top-level keys."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    expected_keys = {
        "session_id",
        "name",
        "description",
        "tick",
        "agents_total",
        "agents_alive",
        "agents_dead",
        "total_events",
        "significant_events",
        "durable_events",
        "significance_ratio",
        "action_distribution",
        "axis_distribution",
        "agent_arcs",
        "relation_arcs",
        "milestones",
        "social_highlights",
    }
    assert expected_keys == set(report.keys())


@pytest.mark.asyncio
async def test_report_counts():
    """Counts for agents, events, significance match expected."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    assert report["tick"] == 50
    assert report["agents_total"] == 2
    assert report["agents_alive"] == 1  # Alice alive
    assert report["agents_dead"] == 1  # Bob dead
    assert report["total_events"] == 5
    # Significant: e2 (durable), e3 (durable), both score >= 0.75
    assert report["significant_events"] == 2
    assert report["durable_events"] == 2
    assert report["significance_ratio"] == 0.4  # 2/5


@pytest.mark.asyncio
async def test_report_axis_distribution():
    """Axis counts aggregate correctly across events."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    axes = report["axis_distribution"]
    assert axes["social"] == 2  # e1 + e2
    assert axes["resource"] == 1  # e2
    assert axes["world"] == 1  # e3
    assert axes["state"] == 1  # e3
    assert axes["information"] == 1  # e5


@pytest.mark.asyncio
async def test_report_milestones():
    """Milestones contain only durable events."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    milestones = report["milestones"]
    assert len(milestones) == 2
    assert milestones[0]["tick"] == 10  # trade
    assert milestones[1]["tick"] == 20  # earthquake
    assert all(m["durable"] for m in milestones)


@pytest.mark.asyncio
async def test_report_agent_arcs():
    """Agent arcs contain correct goal and event data."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    arcs = {a["agent_id"]: a for a in report["agent_arcs"]}

    alice = arcs["alice"]
    assert alice["alive"] is True
    assert alice["goal_text"] == "survive"
    assert alice["goal_progress"] == 0.6
    # Alice involved in e2 (significant) — trade
    assert alice["event_count"] >= 1

    bob = arcs["bob"]
    assert bob["alive"] is False
    assert bob["goal_status"] == "failed"


@pytest.mark.asyncio
async def test_report_social_highlights():
    """Alliances detected from high trust / low tension."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    social = report["social_highlights"]
    assert len(social["alliances"]) == 1
    assert "Alice" in social["alliances"][0]["pair"]
    assert social["alliances"][0]["trust"] == 0.75


@pytest.mark.asyncio
async def test_report_relation_arcs():
    """Relation arcs include all sub-metrics."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    rels = report["relation_arcs"]
    assert len(rels) == 1
    rel = rels[0]
    assert rel["source_name"] == "Alice"
    assert rel["target_name"] == "Bob"
    assert rel["type"] == "ally"
    assert rel["trust"] == 0.75
    assert rel["tension"] == 0.1


@pytest.mark.asyncio
async def test_report_empty_world():
    """Report handles a world with zero events gracefully."""
    session = _make_session()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=[]):
        report = await generate_report("s1", session)

    assert report["total_events"] == 0
    assert report["significant_events"] == 0
    assert report["significance_ratio"] == 0.0
    assert report["milestones"] == []


@pytest.mark.asyncio
async def test_report_action_distribution():
    """Action counts are accurate."""
    session = _make_session()
    events = _make_events()

    with patch("babel.report.load_events", new_callable=AsyncMock, return_value=events):
        report = await generate_report("s1", session)

    actions = report["action_distribution"]
    assert actions["speak"] == 1
    assert actions["trade"] == 1
    assert actions["world_event"] == 1
    assert actions["move"] == 1
    assert actions["observe"] == 1
