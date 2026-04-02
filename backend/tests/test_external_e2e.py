"""BABEL — End-to-end external agent test.

Proves the full loop: create world → connect agent → daemon ticks →
external agent perceives and acts → world state changes.

No LLM. One external agent (Alice), one scripted agent (Bob).
"""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


SEED = {
    "name": "E2E World",
    "description": "Two agents, two locations",
    "lore": ["Be kind"],
    "locations": [
        {"name": "plaza", "description": "Open square", "connections": ["market"]},
        {"name": "market", "description": "Busy market", "connections": ["plaza"]},
    ],
    "agents": [
        {
            "id": "alice", "name": "Alice",
            "personality": "curious", "goals": ["explore"],
            "inventory": ["map"], "location": "plaza",
        },
        {
            "id": "bob", "name": "Bob",
            "personality": "friendly", "goals": ["trade"],
            "inventory": ["potion"], "location": "market",
        },
    ],
}


@pytest_asyncio.fixture
async def client():
    import babel.db as db_module
    from babel.api import app, _engines, _engine_locks

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        original_path = db_module.DB_PATH
        db_module.DB_PATH = db_path
        await db_module.init_db(db_path)
        _engines.clear()
        _engine_locks.clear()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

        _engines.clear()
        _engine_locks.clear()
        db_module.DB_PATH = original_path


async def _create(client: AsyncClient) -> str:
    r = await client.post("/api/worlds", json=SEED)
    assert r.status_code == 200
    return r.json()["session_id"]


def _swap_bob_to_scripted(session_id: str):
    """Bob uses ScriptedDecisionSource as fallback (non-external agents go there)."""
    from babel.api import _engines
    from babel.decision import ScriptedDecisionSource, ExternalDecisionSource

    engine = _engines[session_id]
    # Wrap: external agents → ExternalDecisionSource, rest → Scripted
    if not isinstance(engine.decision_source, ExternalDecisionSource):
        engine.decision_source = ExternalDecisionSource(
            fallback=ScriptedDecisionSource(),
        )


# ── Tests ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connect_and_perceive(client):
    """Connect an agent, start a step, perceive the world context."""
    sid = await _create(client)
    _swap_bob_to_scripted(sid)

    # Connect Alice as external
    r = await client.post(f"/api/worlds/{sid}/agents/alice/connect")
    assert r.status_code == 200
    assert r.json()["connected"] is True

    # Start a single step (not daemon — more predictable for testing)
    # The step will block on Alice's decision, so we run perceive + act concurrently

    async def agent_loop():
        """Alice perceives and acts once."""
        r = await client.get(f"/api/worlds/{sid}/agents/alice/perceive", params={"timeout": 5})
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ready"
        ctx = data["context"]
        assert ctx["agent_id"] == "alice"
        assert ctx["agent_name"] == "Alice"
        assert ctx["agent_location"] == "plaza"
        assert "map" in ctx["agent_inventory"]

        # Alice decides to move to market
        r = await client.post(f"/api/worlds/{sid}/agents/alice/act", json={
            "action_type": "move",
            "target": "market",
            "content": "heading to market",
        })
        assert r.status_code == 200
        assert r.json()["accepted"] is True

    # Step blocks on decide() — agent perceives and acts concurrently
    step_task = asyncio.create_task(
        client.post(f"/api/worlds/{sid}/step", json={"model": "test"})
    )
    await agent_loop()
    step_resp = await step_task
    assert step_resp.status_code == 200, f"step failed: {step_resp.text}"

    # Verify Alice moved
    r = await client.get(f"/api/worlds/{sid}/state")
    assert r.status_code == 200, f"get world failed: {r.status_code} {r.text}"
    state = r.json()
    assert "agents" in state, f"response keys: {list(state.keys())}"
    assert state["agents"]["alice"]["location"] == "market"


@pytest.mark.asyncio
async def test_disconnect_reverts_to_fallback(client):
    sid = await _create(client)

    r = await client.post(f"/api/worlds/{sid}/agents/alice/connect")
    assert r.status_code == 200

    r = await client.delete(f"/api/worlds/{sid}/agents/alice/connect")
    assert r.status_code == 200
    assert r.json()["connected"] is False


@pytest.mark.asyncio
async def test_act_without_connect_fails(client):
    sid = await _create(client)
    r = await client.post(f"/api/worlds/{sid}/agents/alice/act", json={
        "action_type": "observe", "content": "look",
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_multi_tick_external_agent(client):
    """External agent acts across 3 ticks."""
    sid = await _create(client)
    _swap_bob_to_scripted(sid)

    r = await client.post(f"/api/worlds/{sid}/agents/alice/connect")
    assert r.status_code == 200

    actions_taken = []

    for i in range(3):
        # Start step (blocks on Alice's decide)
        step_task = asyncio.create_task(
            client.post(f"/api/worlds/{sid}/step", json={"model": "test"})
        )

        # Alice perceives and acts
        r = await client.get(f"/api/worlds/{sid}/agents/alice/perceive", params={"timeout": 10})
        data = r.json()
        assert data["status"] == "ready", f"tick {i}: perceive failed: {data}"

        if i % 2 == 0:
            action = {"action_type": "observe", "content": f"tick {i}"}
        else:
            action = {"action_type": "move", "target": "market", "content": "exploring"}
        r = await client.post(f"/api/worlds/{sid}/agents/alice/act", json=action)
        assert r.status_code == 200, f"tick {i}: act failed: {r.text}"
        actions_taken.append(action["action_type"])

        # Wait for step to complete
        step_resp = await step_task
        assert step_resp.status_code == 200, f"tick {i}: step failed: {step_resp.text}"

    assert len(actions_taken) == 3

    r = await client.get(f"/api/worlds/{sid}/state")
    assert r.json()["tick"] == 3


@pytest.mark.asyncio
async def test_perceive_timeout_returns_no_turn(client):
    """Perceive with very short timeout returns no_turn if no step is running."""
    sid = await _create(client)
    _swap_bob_to_scripted(sid)

    r = await client.post(f"/api/worlds/{sid}/agents/alice/connect")
    assert r.status_code == 200

    r = await client.get(f"/api/worlds/{sid}/agents/alice/perceive", params={"timeout": 0.1})
    assert r.status_code == 200
    assert r.json()["status"] == "no_turn"
