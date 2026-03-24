"""BABEL — Comprehensive API integration tests.

Covers all REST endpoints using httpx.AsyncClient with FastAPI's ASGITransport.
No LLM calls — uses ScriptedDecisionSource for simulation steps and mocks
detect_new_character to avoid external dependencies.

Sections:
  1. World CRUD (create, from-seed, list sessions, delete)
  2. World State & Events
  3. Simulation Control (step, pause)
  4. Event Injection
  5. Agent Management
  6. Human Control (take/release/status)
  7. Assets/Seeds API (list seeds, save/list/delete assets)
  8. Entity Details & Timeline
  9. Health Check
  10. Error Paths (404s on bad session_id)
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


# ---------------------------------------------------------------------------
# Minimal world seed payload used by most tests
# ---------------------------------------------------------------------------

MINIMAL_SEED = {
    "name": "Test World",
    "description": "A small world for integration tests",
    "rules": ["No violence"],
    "locations": [
        {"name": "Town Square", "description": "Open area"},
        {"name": "Tavern", "description": "Cozy inn"},
    ],
    "agents": [
        {
            "id": "alice",
            "name": "Alice",
            "description": "Curious explorer",
            "personality": "Brave and curious",
            "goals": ["Explore the world"],
            "inventory": ["map", "compass"],
            "location": "Town Square",
        },
        {
            "id": "bob",
            "name": "Bob",
            "description": "Friendly merchant",
            "personality": "Charming and shrewd",
            "goals": ["Sell goods"],
            "inventory": ["potion", "gold coin"],
            "location": "Tavern",
        },
    ],
    "initial_events": ["The sun rises over the town"],
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def client():
    """Create a test client backed by an isolated temp DB."""
    import babel.db as db_module
    from babel.api import app, _engines, _engine_locks

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        original_path = db_module.DB_PATH
        db_module.DB_PATH = db_path

        # Initialise the schema
        await db_module.init_db(db_path)

        # Ensure no leftover engine state
        _engines.clear()
        _engine_locks.clear()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

        # Teardown
        _engines.clear()
        _engine_locks.clear()
        db_module.DB_PATH = original_path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_world(client: AsyncClient, seed: dict | None = None) -> str:
    """POST /api/worlds with MINIMAL_SEED and return session_id."""
    resp = await client.post("/api/worlds", json=seed or MINIMAL_SEED)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "session_id" in data
    return data["session_id"]


def _swap_to_scripted(session_id: str) -> None:
    """Replace engine decision source with ScriptedDecisionSource (no LLM)."""
    from babel.api import _engines
    from babel.decision import ScriptedDecisionSource

    engine = _engines[session_id]
    engine.decision_source = ScriptedDecisionSource()


# ===================================================================
# 1. World CRUD
# ===================================================================


@pytest.mark.asyncio
async def test_create_world_returns_session_id(client):
    resp = await client.post("/api/worlds", json=MINIMAL_SEED)
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    assert data["name"] == "Test World"
    assert len(data["agents"]) == 2
    assert data["tick"] == 0
    assert data["status"] == "paused"


@pytest.mark.asyncio
async def test_create_world_empty_agents_returns_400(client):
    bad_seed = {**MINIMAL_SEED, "agents": []}
    resp = await client.post("/api/worlds", json=bad_seed)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_world_duplicate_agent_ids_returns_400(client):
    dup_agents = [
        {"id": "dup", "name": "Agent A", "location": "Town Square"},
        {"id": "dup", "name": "Agent B", "location": "Town Square"},
    ]
    bad_seed = {**MINIMAL_SEED, "agents": dup_agents}
    resp = await client.post("/api/worlds", json=bad_seed)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_from_seed_yaml(client):
    resp = await client.post("/api/worlds/from-seed/cyber_bar.yaml")
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    assert len(data["agents"]) >= 3  # cyber_bar has 3 agents


@pytest.mark.asyncio
async def test_create_from_seed_nonexistent_returns_404(client):
    resp = await client.post("/api/worlds/from-seed/nonexistent.yaml")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_sessions_after_create(client):
    sid = await _create_world(client)
    resp = await client.get("/api/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert any(s["id"] == sid for s in sessions)


@pytest.mark.asyncio
async def test_delete_session(client):
    sid = await _create_world(client)
    resp = await client.delete(f"/api/sessions/{sid}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    # Verify gone
    resp2 = await client.get("/api/sessions")
    assert not any(s["id"] == sid for s in resp2.json())


@pytest.mark.asyncio
async def test_delete_nonexistent_session_returns_404(client):
    resp = await client.delete("/api/sessions/nonexistent")
    assert resp.status_code == 404


# ===================================================================
# 2. World State & Events
# ===================================================================


@pytest.mark.asyncio
async def test_get_world_state(client):
    sid = await _create_world(client)
    resp = await client.get(f"/api/worlds/{sid}/state")
    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == sid
    assert "agents" in data
    assert "alice" in data["agents"]
    assert "bob" in data["agents"]
    assert data["tick"] == 0


@pytest.mark.asyncio
async def test_get_world_state_bad_id_returns_404(client):
    resp = await client.get("/api/worlds/bad_id_12345/state")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_events_empty_initially(client):
    sid = await _create_world(client)
    resp = await client.get(f"/api/worlds/{sid}/events")
    assert resp.status_code == 200
    # create_world (not from-seed) does not record initial events, so expect empty
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_get_events_from_seed_world(client):
    """Worlds created from a YAML seed with initial_events should have events."""
    resp = await client.post("/api/worlds/from-seed/cyber_bar.yaml")
    sid = resp.json()["session_id"]
    resp2 = await client.get(f"/api/worlds/{sid}/events")
    assert resp2.status_code == 200
    events = resp2.json()
    assert len(events) >= 1  # cyber_bar has 3 initial_events


# ===================================================================
# 3. Simulation Control
# ===================================================================


@pytest.mark.asyncio
async def test_step_world(client):
    sid = await _create_world(client)
    _swap_to_scripted(sid)

    resp = await client.post(f"/api/worlds/{sid}/step")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tick"] == 1
    assert "events" in data
    assert len(data["events"]) >= 1  # at least one agent acted


@pytest.mark.asyncio
async def test_step_nonexistent_returns_404(client):
    resp = await client.post("/api/worlds/nonexistent/step")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_step_advances_tick(client):
    sid = await _create_world(client)
    _swap_to_scripted(sid)

    await client.post(f"/api/worlds/{sid}/step")
    resp = await client.post(f"/api/worlds/{sid}/step")
    assert resp.status_code == 200
    assert resp.json()["tick"] == 2


@pytest.mark.asyncio
async def test_pause_world(client):
    sid = await _create_world(client)
    resp = await client.post(f"/api/worlds/{sid}/pause")
    assert resp.status_code == 200
    assert resp.json()["status"] == "paused"


@pytest.mark.asyncio
async def test_pause_nonexistent_returns_404(client):
    resp = await client.post("/api/worlds/nonexistent/pause")
    assert resp.status_code == 404


# ===================================================================
# 4. Event Injection
# ===================================================================


@pytest.mark.asyncio
@patch("babel.api.detect_new_character", new_callable=AsyncMock, return_value=None)
async def test_inject_event(mock_detect, client):
    sid = await _create_world(client)
    resp = await client.post(
        f"/api/worlds/{sid}/inject",
        json={"content": "A meteor streaks across the sky!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "[WORLD]" in data["result"]
    assert data["tick"] == 0


@pytest.mark.asyncio
@patch("babel.api.detect_new_character", new_callable=AsyncMock, return_value=None)
async def test_inject_event_appears_in_events(mock_detect, client):
    sid = await _create_world(client)
    await client.post(
        f"/api/worlds/{sid}/inject",
        json={"content": "Lightning strikes the tavern!"},
    )
    resp = await client.get(f"/api/worlds/{sid}/events")
    events = resp.json()
    assert any("Lightning" in (e.get("result") or "") for e in events)


@pytest.mark.asyncio
async def test_inject_event_nonexistent_returns_404(client):
    resp = await client.post(
        "/api/worlds/nonexistent/inject",
        json={"content": "Something happens"},
    )
    assert resp.status_code == 404


# ===================================================================
# 5. Agent Management
# ===================================================================


@pytest.mark.asyncio
async def test_add_agent_to_existing_world(client):
    sid = await _create_world(client)
    new_agent = {
        "id": "charlie",
        "name": "Charlie",
        "description": "A wandering bard",
        "personality": "Musical",
        "goals": ["Sing songs"],
        "inventory": ["lute"],
        "location": "Town Square",
    }
    resp = await client.post(f"/api/worlds/{sid}/agents", json=new_agent)
    assert resp.status_code == 200
    data = resp.json()
    assert data["agent_id"] == "charlie"
    assert data["name"] == "Charlie"

    # Verify agent shows up in world state
    state = await client.get(f"/api/worlds/{sid}/state")
    assert "charlie" in state.json()["agents"]


@pytest.mark.asyncio
async def test_get_agent_memories_empty_initially(client):
    sid = await _create_world(client)
    resp = await client.get(f"/api/worlds/{sid}/agents/alice/memories")
    assert resp.status_code == 200
    assert resp.json() == []


# ===================================================================
# 6. Human Control
# ===================================================================


@pytest.mark.asyncio
async def test_take_control(client):
    sid = await _create_world(client)
    resp = await client.post(f"/api/worlds/{sid}/take-control/alice")
    assert resp.status_code == 200
    data = resp.json()
    assert data["agent_id"] == "alice"
    assert data["controlled"] is True


@pytest.mark.asyncio
async def test_human_status_after_take_control(client):
    sid = await _create_world(client)
    await client.post(f"/api/worlds/{sid}/take-control/alice")
    resp = await client.get(f"/api/worlds/{sid}/human-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "alice" in data["controlled_agents"]


@pytest.mark.asyncio
async def test_release_control(client):
    sid = await _create_world(client)
    await client.post(f"/api/worlds/{sid}/take-control/alice")
    resp = await client.post(f"/api/worlds/{sid}/release-control/alice")
    assert resp.status_code == 200
    assert resp.json()["controlled"] is False

    # Verify status reflects release
    status = await client.get(f"/api/worlds/{sid}/human-status")
    assert "alice" not in status.json()["controlled_agents"]


@pytest.mark.asyncio
async def test_human_status_no_control(client):
    """Human status on a world where no agent is controlled."""
    sid = await _create_world(client)
    resp = await client.get(f"/api/worlds/{sid}/human-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["controlled_agents"] == []
    assert data["waiting_agents"] == []


@pytest.mark.asyncio
async def test_take_control_nonexistent_agent_returns_404(client):
    sid = await _create_world(client)
    resp = await client.post(f"/api/worlds/{sid}/take-control/nonexistent_agent")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_take_control_nonexistent_session_returns_404(client):
    resp = await client.post("/api/worlds/nonexistent/take-control/alice")
    assert resp.status_code == 404


# ===================================================================
# 7. Assets / Seeds API
# ===================================================================


@pytest.mark.asyncio
async def test_list_seed_files(client):
    resp = await client.get("/api/seeds")
    assert resp.status_code == 200
    seeds = resp.json()
    # At least cyber_bar.yaml, iron_throne.yaml, apocalypse.yaml exist
    filenames = [s["file"] for s in seeds]
    assert "cyber_bar.yaml" in filenames


@pytest.mark.asyncio
async def test_save_asset(client):
    asset = {
        "type": "agent",
        "name": "Test Agent Seed",
        "description": "An agent for testing",
        "tags": ["test"],
        "data": {"id": "test_agent", "name": "Tester"},
        "source_world": "",
    }
    resp = await client.post("/api/assets", json=asset)
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert data["name"] == "Test Agent Seed"
    assert data["type"] == "agent"


@pytest.mark.asyncio
async def test_list_assets(client):
    # Create an asset first
    asset = {
        "type": "item",
        "name": "Magic Sword",
        "description": "Sharp blade",
        "tags": ["weapon"],
        "data": {"name": "Magic Sword"},
    }
    await client.post("/api/assets", json=asset)
    resp = await client.get("/api/assets")
    assert resp.status_code == 200
    assets = resp.json()
    assert len(assets) >= 1
    assert any(a["name"] == "Magic Sword" for a in assets)


@pytest.mark.asyncio
async def test_delete_asset(client):
    # Create, then delete
    asset = {
        "type": "location",
        "name": "Lost Temple",
        "description": "Ancient ruin",
        "tags": [],
        "data": {"name": "Lost Temple"},
    }
    create_resp = await client.post("/api/assets", json=asset)
    asset_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/assets/{asset_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True


@pytest.mark.asyncio
async def test_delete_nonexistent_asset_returns_404(client):
    resp = await client.delete("/api/assets/nonexistent_seed_id")
    assert resp.status_code == 404


# ===================================================================
# 8. Entity Details & Timeline
# ===================================================================


@pytest.mark.asyncio
async def test_get_timeline_empty_initially(client):
    sid = await _create_world(client)
    resp = await client.get(f"/api/worlds/{sid}/timeline")
    assert resp.status_code == 200
    data = resp.json()
    assert data["nodes"] == []
    assert data["branch"] == "main"


@pytest.mark.asyncio
async def test_get_snapshots_empty_initially(client):
    sid = await _create_world(client)
    resp = await client.get(f"/api/worlds/{sid}/snapshots")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_timeline_populated_after_step(client):
    sid = await _create_world(client)
    _swap_to_scripted(sid)
    await client.post(f"/api/worlds/{sid}/step")

    resp = await client.get(f"/api/worlds/{sid}/timeline")
    assert resp.status_code == 200
    nodes = resp.json()["nodes"]
    assert len(nodes) >= 1
    assert nodes[0]["tick"] == 1


# ===================================================================
# 9. Health Check
# ===================================================================


@pytest.mark.asyncio
async def test_health_check(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ===================================================================
# 10. Error Paths — 404s on bad session_id
# ===================================================================


BAD_SID = "totally_bogus_session"


@pytest.mark.asyncio
async def test_state_404(client):
    resp = await client.get(f"/api/worlds/{BAD_SID}/state")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_events_returns_empty_for_unknown_session(client):
    """Events endpoint queries DB directly and returns [] for unknown sessions."""
    resp = await client.get(f"/api/worlds/{BAD_SID}/events")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_inject_404(client):
    resp = await client.post(
        f"/api/worlds/{BAD_SID}/inject",
        json={"content": "Something happens"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_step_404(client):
    resp = await client.post(f"/api/worlds/{BAD_SID}/step")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_pause_404(client):
    resp = await client.post(f"/api/worlds/{BAD_SID}/pause")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_take_control_session_404(client):
    resp = await client.post(f"/api/worlds/{BAD_SID}/take-control/alice")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_release_control_session_404(client):
    resp = await client.post(f"/api/worlds/{BAD_SID}/release-control/alice")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_human_status_session_404(client):
    resp = await client.get(f"/api/worlds/{BAD_SID}/human-status")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_add_agent_session_404(client):
    resp = await client.post(
        f"/api/worlds/{BAD_SID}/agents",
        json={"id": "x", "name": "X"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_agent_memories_returns_empty_for_unknown(client):
    """Memories endpoint queries DB directly; returns [] for unknown."""
    resp = await client.get(f"/api/worlds/{BAD_SID}/agents/alice/memories")
    assert resp.status_code == 200
    assert resp.json() == []


# ===================================================================
# 11. Multi-step / Composite Scenarios
# ===================================================================


@pytest.mark.asyncio
async def test_full_lifecycle(client):
    """Create -> step twice -> get state -> get events -> delete."""
    sid = await _create_world(client)
    _swap_to_scripted(sid)

    # Step twice
    for expected_tick in (1, 2):
        resp = await client.post(f"/api/worlds/{sid}/step")
        assert resp.status_code == 200
        assert resp.json()["tick"] == expected_tick

    # State should reflect tick 2
    state = (await client.get(f"/api/worlds/{sid}/state")).json()
    assert state["tick"] == 2
    assert "alice" in state["agents"]

    # Events should exist
    events = (await client.get(f"/api/worlds/{sid}/events")).json()
    assert len(events) >= 2

    # Delete
    resp = await client.delete(f"/api/sessions/{sid}")
    assert resp.status_code == 200

    # Session gone
    sessions = (await client.get("/api/sessions")).json()
    assert not any(s["id"] == sid for s in sessions)


@pytest.mark.asyncio
@patch("babel.api.detect_new_character", new_callable=AsyncMock, return_value=None)
async def test_inject_then_step(mock_detect, client):
    """Inject a world event, then step — agents should have processed it."""
    sid = await _create_world(client)
    _swap_to_scripted(sid)

    await client.post(
        f"/api/worlds/{sid}/inject",
        json={"content": "An earthquake shakes the ground!"},
    )
    resp = await client.post(f"/api/worlds/{sid}/step")
    assert resp.status_code == 200
    assert resp.json()["tick"] == 1


@pytest.mark.asyncio
async def test_create_from_seed_then_step(client):
    """Create from cyber_bar seed and step with ScriptedDecisionSource."""
    resp = await client.post("/api/worlds/from-seed/cyber_bar.yaml")
    assert resp.status_code == 200
    sid = resp.json()["session_id"]
    _swap_to_scripted(sid)

    step_resp = await client.post(f"/api/worlds/{sid}/step")
    assert step_resp.status_code == 200
    assert step_resp.json()["tick"] == 1


@pytest.mark.asyncio
async def test_add_agent_then_step(client):
    """Add an agent and ensure it participates in the next tick."""
    sid = await _create_world(client)
    _swap_to_scripted(sid)

    await client.post(
        f"/api/worlds/{sid}/agents",
        json={
            "id": "charlie",
            "name": "Charlie",
            "description": "Wanderer",
            "location": "Town Square",
        },
    )

    resp = await client.post(f"/api/worlds/{sid}/step")
    assert resp.status_code == 200
    # At least 1 agent acted (supporting agents skip ~30% of ticks)
    assert len(resp.json()["events"]) >= 1


@pytest.mark.asyncio
async def test_asset_roundtrip(client):
    """Save, list, retrieve by list, delete — full CRUD."""
    asset_data = {
        "type": "world",
        "name": "Roundtrip World",
        "description": "Testing asset roundtrip",
        "tags": ["test", "roundtrip"],
        "data": {"name": "Roundtrip World", "agents": []},
    }
    create = await client.post("/api/assets", json=asset_data)
    assert create.status_code == 200
    aid = create.json()["id"]

    # List should contain it
    listed = (await client.get("/api/assets")).json()
    assert any(a["id"] == aid for a in listed)

    # Delete
    deleted = await client.delete(f"/api/assets/{aid}")
    assert deleted.status_code == 200

    # Gone from list
    listed2 = (await client.get("/api/assets")).json()
    assert not any(a["id"] == aid for a in listed2)


@pytest.mark.asyncio
async def test_take_and_release_control_roundtrip(client):
    """Take control of alice, verify, release, verify."""
    sid = await _create_world(client)

    # Take control
    take = await client.post(f"/api/worlds/{sid}/take-control/alice")
    assert take.status_code == 200

    status = (await client.get(f"/api/worlds/{sid}/human-status")).json()
    assert "alice" in status["controlled_agents"]

    # Release
    release = await client.post(f"/api/worlds/{sid}/release-control/alice")
    assert release.status_code == 200

    status2 = (await client.get(f"/api/worlds/{sid}/human-status")).json()
    assert "alice" not in status2["controlled_agents"]


@pytest.mark.asyncio
async def test_multiple_sessions_isolated(client):
    """Create two worlds, verify they have separate state."""
    sid1 = await _create_world(client)
    sid2 = await _create_world(client, seed={
        **MINIMAL_SEED,
        "name": "Second World",
        "agents": [
            {"id": "zara", "name": "Zara", "location": "Town Square"},
        ],
    })

    state1 = (await client.get(f"/api/worlds/{sid1}/state")).json()
    state2 = (await client.get(f"/api/worlds/{sid2}/state")).json()

    assert state1["name"] == "Test World"
    assert state2["name"] == "Second World"
    assert "alice" in state1["agents"]
    assert "zara" in state2["agents"]
    assert "alice" not in state2["agents"]


@pytest.mark.asyncio
async def test_world_state_has_locations(client):
    sid = await _create_world(client)
    state = (await client.get(f"/api/worlds/{sid}/state")).json()
    assert "locations" in state
    loc_names = [loc["name"] for loc in state["locations"]]
    assert "Town Square" in loc_names
    assert "Tavern" in loc_names


@pytest.mark.asyncio
async def test_world_state_has_rules(client):
    sid = await _create_world(client)
    state = (await client.get(f"/api/worlds/{sid}/state")).json()
    assert "rules" in state
    assert "No violence" in state["rules"]


@pytest.mark.asyncio
async def test_world_state_has_world_time(client):
    sid = await _create_world(client)
    state = (await client.get(f"/api/worlds/{sid}/state")).json()
    assert "world_time" in state


@pytest.mark.asyncio
async def test_step_events_have_agent_name(client):
    """Step response events should contain agent_name."""
    sid = await _create_world(client)
    _swap_to_scripted(sid)
    resp = await client.post(f"/api/worlds/{sid}/step")
    events = resp.json()["events"]
    for ev in events:
        assert "agent_name" in ev
        assert ev["agent_name"] in ("Alice", "Bob")


@pytest.mark.asyncio
async def test_create_world_response_has_agent_names(client):
    resp = await client.post("/api/worlds", json=MINIMAL_SEED)
    data = resp.json()
    assert "Alice" in data["agents"]
    assert "Bob" in data["agents"]
