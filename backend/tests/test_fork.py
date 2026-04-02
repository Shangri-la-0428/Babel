"""Tests for world fork (timeline branching)."""

from unittest.mock import AsyncMock, patch

import pytest

from babel.models import (
    AgentState,
    AgentStatus,
    Event,
    GoalState,
    Relation,
    Session,
    SessionStatus,
    SeedLineage,
    WorldSeed,
)


def _make_parent_session() -> Session:
    seed = WorldSeed(name="Fork Test", description="Parent world")
    session = Session(id="parent-1", world_seed=seed, tick=50)
    session.seed_lineage = SeedLineage.runtime(
        root_name="Fork Test", session_id="parent-1", tick=0, branch_id="main",
    )

    alice = AgentState(
        agent_id="alice", name="Alice", personality="brave",
        location="Bar", goals=["survive"],
        active_goal=GoalState(text="survive", status="active", progress=0.6),
    )
    bob = AgentState(
        agent_id="bob", name="Bob", personality="cunning",
        location="Alley", goals=["escape"],
        active_goal=GoalState(text="escape", status="active", progress=0.3),
    )
    session.agents = {"alice": alice, "bob": bob}
    session.relations = [
        Relation(source="alice", target="bob", type="ally", strength=0.8, trust=0.75, tension=0.1),
    ]
    return session


def _make_snapshot(session_id: str = "parent-1", tick: int = 25) -> dict:
    """Simulate a snapshot dict as returned by load_nearest_snapshot."""
    return {
        "id": "snap-1",
        "session_id": session_id,
        "node_id": "node-1",
        "tick": tick,
        "world_seed": {
            "name": "Fork Test",
            "description": "Parent world",
            "lore": [],
            "locations": [],
            "agents": [
                {"id": "alice", "name": "Alice", "description": "", "personality": "brave",
                 "goals": ["survive"], "inventory": [], "location": "Bar"},
                {"id": "bob", "name": "Bob", "description": "", "personality": "cunning",
                 "goals": ["escape"], "inventory": [], "location": "Alley"},
            ],
            "initial_events": [],
        },
        "agent_states": {
            "alice": {
                "agent_id": "alice", "name": "Alice", "description": "",
                "personality": "brave", "goals": ["survive"],
                "location": "Bar", "inventory": ["knife"], "status": "idle",
                "role": "main",
            },
            "bob": {
                "agent_id": "bob", "name": "Bob", "description": "",
                "personality": "cunning", "goals": ["escape"],
                "location": "Alley", "inventory": [], "status": "idle",
                "role": "main",
            },
        },
        "lineage": {"branch_id": "main", "session_id": "parent-1"},
    }


@pytest.fixture
def parent_session():
    return _make_parent_session()


@pytest.mark.asyncio
async def test_fork_creates_new_session(parent_session):
    """Fork returns a new session_id different from parent."""
    from babel.api import app
    from httpx import ASGITransport, AsyncClient

    snapshot = _make_snapshot()

    with (
        patch("babel.routes.timeline.load_nearest_snapshot", new_callable=AsyncMock, return_value=snapshot),
        patch("babel.routes.timeline.get_engine", new_callable=AsyncMock) as mock_engine,
        patch("babel.routes.timeline.save_session", new_callable=AsyncMock),
        patch("babel.db.init_db", new_callable=AsyncMock),
    ):
        mock_engine.return_value = type("E", (), {"session": parent_session, "is_running": False, "pause": lambda self: None})()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/worlds/parent-1/fork", json={"tick": 25})

    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] != "parent-1"
    assert data["parent_session_id"] == "parent-1"
    assert data["fork_tick"] == 25
    assert data["name"] == "Fork Test"
    assert "branch_id" in data
    assert data["branch_id"].startswith("fork-")


@pytest.mark.asyncio
async def test_fork_restores_agent_states():
    """Forked session has agents with snapshot state, not seed defaults."""
    from babel.api import app
    from httpx import ASGITransport, AsyncClient

    snapshot = _make_snapshot()

    with (
        patch("babel.routes.timeline.load_nearest_snapshot", new_callable=AsyncMock, return_value=snapshot),
        patch("babel.routes.timeline.get_engine", new_callable=AsyncMock, return_value=None),
        patch("babel.routes.timeline.save_session", new_callable=AsyncMock) as mock_save,
        patch("babel.db.init_db", new_callable=AsyncMock),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/worlds/parent-1/fork", json={"tick": 25})

    assert resp.status_code == 200
    # Verify the saved session has correct agent state
    saved_session = mock_save.call_args[0][0]
    assert "alice" in saved_session.agents
    assert saved_session.agents["alice"].inventory == ["knife"]
    assert saved_session.agents["alice"].location == "Bar"
    assert saved_session.tick == 25


@pytest.mark.asyncio
async def test_fork_copies_relations(parent_session):
    """Forked session inherits parent relations."""
    from babel.api import app
    from httpx import ASGITransport, AsyncClient

    snapshot = _make_snapshot()

    with (
        patch("babel.routes.timeline.load_nearest_snapshot", new_callable=AsyncMock, return_value=snapshot),
        patch("babel.routes.timeline.get_engine", new_callable=AsyncMock) as mock_engine,
        patch("babel.routes.timeline.save_session", new_callable=AsyncMock) as mock_save,
        patch("babel.db.init_db", new_callable=AsyncMock),
    ):
        mock_engine.return_value = type("E", (), {"session": parent_session, "is_running": False, "pause": lambda self: None})()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/worlds/parent-1/fork", json={"tick": 25})

    assert resp.status_code == 200
    saved_session = mock_save.call_args[0][0]
    assert len(saved_session.relations) == 1
    assert saved_session.relations[0].source == "alice"
    assert saved_session.relations[0].trust == 0.75


@pytest.mark.asyncio
async def test_fork_lineage_links_to_parent():
    """Forked session lineage references parent session and snapshot."""
    from babel.api import app
    from httpx import ASGITransport, AsyncClient

    snapshot = _make_snapshot()

    with (
        patch("babel.routes.timeline.load_nearest_snapshot", new_callable=AsyncMock, return_value=snapshot),
        patch("babel.routes.timeline.get_engine", new_callable=AsyncMock, return_value=None),
        patch("babel.routes.timeline.save_session", new_callable=AsyncMock) as mock_save,
        patch("babel.db.init_db", new_callable=AsyncMock),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/worlds/parent-1/fork", json={"tick": 25})

    assert resp.status_code == 200
    saved_session = mock_save.call_args[0][0]
    lineage = saved_session.seed_lineage
    assert lineage.source_seed_ref == "parent-1"
    assert lineage.snapshot_id == "snap-1"
    assert lineage.tick == 25
    assert lineage.branch_id.startswith("fork-")


@pytest.mark.asyncio
async def test_fork_no_snapshot_returns_404():
    """Fork at a tick with no snapshot returns 404."""
    from babel.api import app
    from httpx import ASGITransport, AsyncClient

    with (
        patch("babel.routes.timeline.load_nearest_snapshot", new_callable=AsyncMock, return_value=None),
        patch("babel.db.init_db", new_callable=AsyncMock),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/worlds/parent-1/fork", json={"tick": 5})

    assert resp.status_code == 404
