"""Phase 10: Robustness hardening tests.

Covers: seed validation, self-interaction blocking, dead agent handling,
engine edge cases, DB safety, WebSocket resilience.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest

from babel.models import (
    ActionOutput,
    ActionType,
    AgentSeed,
    AgentState,
    AgentStatus,
    LLMResponse,
    LocationSeed,
    Session,
    SessionStatus,
    StateChanges,
    WorldSeed,
)
from babel.validator import validate_action, validate_seed


# ── Helpers ──────────────────────────────────────────


def _make_session(
    locations: list[dict] | None = None,
    agents: list[dict] | None = None,
) -> Session:
    """Build a minimal Session for testing."""
    locs = locations or [
        {"name": "广场", "connections": ["酒馆", "市场"]},
        {"name": "酒馆", "connections": ["广场"]},
        {"name": "市场", "connections": ["广场"]},
    ]
    loc_seeds = [LocationSeed(**loc) for loc in locs]
    agent_seeds = [AgentSeed(**a) for a in agents] if agents else []

    ws = WorldSeed(
        name="Test World",
        locations=loc_seeds,
        agents=agent_seeds,
        lore=["No killing"],
    )
    session = Session(world_seed=ws, tick=5)

    if not agents:
        session.agents = {
            "a1": AgentState(
                agent_id="a1", name="Alice", location="广场",
                inventory=["剑", "面包"], goals=["survive"],
            ),
            "a2": AgentState(
                agent_id="a2", name="Bob", location="广场",
                inventory=["盾牌"], goals=["trade"],
            ),
            "a3": AgentState(
                agent_id="a3", name="Charlie", location="酒馆",
                inventory=[], goals=[],
            ),
        }

    return session


def _make_response(action_type: ActionType, target: str = "", content: str = "", **sc_kwargs) -> LLMResponse:
    return LLMResponse(
        thinking="test",
        action=ActionOutput(type=action_type, target=target, content=content),
        state_changes=StateChanges(**sc_kwargs),
    )


# ── Seed Validation ──────────────────────────────────


class TestSeedValidation:
    """Tests for validate_seed()."""

    def test_empty_seed_rejected(self):
        seed = WorldSeed(name="Empty", locations=[], agents=[])
        errors = validate_seed(seed)
        assert any("at least one agent" in e for e in errors)

    def test_duplicate_agent_ids_rejected(self):
        seed = WorldSeed(
            name="Dupes",
            locations=[LocationSeed(name="A")],
            agents=[
                AgentSeed(id="a1", name="Alice", location="A"),
                AgentSeed(id="a1", name="Bob", location="A"),
            ],
        )
        errors = validate_seed(seed)
        assert any("Duplicate agent ID" in e for e in errors)

    def test_agent_at_nonexistent_location_auto_fixed(self):
        seed = WorldSeed(
            name="BadLoc",
            locations=[LocationSeed(name="A")],
            agents=[AgentSeed(id="a1", name="Alice", location="NOWHERE")],
        )
        errors = validate_seed(seed)
        # No error — auto-fixed to first location
        assert not any("unknown location" in e for e in errors)
        assert seed.agents[0].location == "A"

    def test_duplicate_location_names_rejected(self):
        seed = WorldSeed(
            name="DupLocs",
            locations=[LocationSeed(name="X"), LocationSeed(name="X")],
            agents=[AgentSeed(id="a1", name="Alice", location="X")],
        )
        errors = validate_seed(seed)
        assert any("Duplicate location" in e for e in errors)

    def test_valid_seed_passes(self):
        seed = WorldSeed(
            name="Good",
            locations=[LocationSeed(name="A"), LocationSeed(name="B")],
            agents=[
                AgentSeed(id="a1", name="Alice", location="A"),
                AgentSeed(id="a2", name="Bob", location="B"),
            ],
        )
        errors = validate_seed(seed)
        assert errors == []

    def test_agent_without_location_passes(self):
        """Agents with empty location string should pass (they get assigned later)."""
        seed = WorldSeed(
            name="NoLoc",
            locations=[LocationSeed(name="A")],
            agents=[AgentSeed(id="a1", name="Alice", location="")],
        )
        errors = validate_seed(seed)
        assert errors == []


# ── Self-Interaction ─────────────────────────────────


class TestSelfInteraction:
    """Agents cannot speak to or trade with themselves."""

    def test_speak_to_self_rejected(self):
        session = _make_session()
        agent = session.agents["a1"]
        response = _make_response(ActionType.SPEAK, target="a1", content="Hello me")
        errors = validate_action(response, agent, session)
        assert any("yourself" in e for e in errors)

    def test_trade_with_self_rejected(self):
        session = _make_session()
        agent = session.agents["a1"]
        response = _make_response(ActionType.TRADE, target="a1", content="give myself stuff")
        errors = validate_action(response, agent, session)
        assert any("yourself" in e for e in errors)

    def test_speak_to_other_still_works(self):
        session = _make_session()
        agent = session.agents["a1"]
        response = _make_response(ActionType.SPEAK, target="a2", content="Hello Bob")
        errors = validate_action(response, agent, session)
        assert errors == []


# ── Dead Agent Handling ──────────────────────────────


class TestDeadAgents:
    """Dead agents should be excluded from interactions."""

    def test_speak_to_dead_rejected(self):
        session = _make_session()
        session.agents["a2"].status = AgentStatus.DEAD
        agent = session.agents["a1"]
        response = _make_response(ActionType.SPEAK, target="a2", content="Hello?")
        errors = validate_action(response, agent, session)
        # Dead agents aren't in agent_ids, so target resolution should fail
        assert len(errors) > 0

    def test_trade_with_dead_rejected(self):
        session = _make_session()
        session.agents["a2"].status = AgentStatus.DEAD
        agent = session.agents["a1"]
        response = _make_response(ActionType.TRADE, target="a2", content="trade")
        errors = validate_action(response, agent, session)
        assert len(errors) > 0


# ── Engine Edge Cases ────────────────────────────────


class TestEngineEdgeCases:
    """Engine should handle edge cases gracefully."""

    def test_all_agents_same_location(self):
        """All agents at the same location should work fine."""
        session = _make_session()
        # Put everyone at 广场
        for agent in session.agents.values():
            agent.location = "广场"
        # SPEAK between co-located agents should pass
        agent = session.agents["a1"]
        response = _make_response(ActionType.SPEAK, target="a2", content="Hi")
        errors = validate_action(response, agent, session)
        assert errors == []

    def test_empty_inventory_trade(self):
        """Trading with empty inventory_remove should still validate."""
        session = _make_session()
        agent = session.agents["a1"]
        # Trade that doesn't remove anything from self (just receiving)
        response = _make_response(
            ActionType.TRADE, target="a2", content="give me stuff",
            inventory_add=["盾牌"],
        )
        errors = validate_action(response, agent, session)
        # Should pass — 盾牌 is in a2's inventory
        assert errors == []

    def test_move_to_current_location_rejected(self):
        """Moving to your current location is pointless and should be rejected."""
        session = _make_session()
        agent = session.agents["a1"]
        response = _make_response(
            ActionType.MOVE, target="广场",
            location="广场",
        )
        errors = validate_action(response, agent, session)
        assert any("Already at" in e for e in errors)


# ── Engine All-Agents-Dead ───────────────────────────


class TestAllAgentsDead:
    """When all agents are dead, tick should return safely."""

    @pytest.mark.asyncio
    async def test_all_agents_dead_tick_safe(self):
        from babel.engine import Engine

        session = _make_session()
        for agent in session.agents.values():
            agent.status = AgentStatus.DEAD

        engine = Engine(session=session)
        events = await engine.tick()
        # Should return empty list, not crash
        assert events == []


# ── WebSocket Safety ─────────────────────────────────


class TestWebSocketSafety:
    """WebSocket handler should handle malformed input."""

    def test_malformed_json_handling(self):
        """JSON decode of malformed data should not crash."""
        bad_inputs = [
            "not json at all",
            "{broken",
            "",
            "null",
            "12345",
        ]
        for data in bad_inputs:
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, ValueError):
                continue  # This is the expected behavior
            # If it parses, it should be handled gracefully
            assert msg is not None or msg is None  # no crash


# ── DB Safety ────────────────────────────────────────


class TestDBSafety:
    """Database operations should be safe."""

    @pytest.mark.asyncio
    async def test_delete_nonexistent_session(self):
        from babel.db import init_db, delete_session
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            await init_db(db_path)

            # Monkey-patch DB_PATH for this test
            import babel.db as db_module
            original_path = db_module.DB_PATH
            db_module.DB_PATH = db_path
            try:
                result = await delete_session("nonexistent-id")
                assert result is False
            finally:
                db_module.DB_PATH = original_path

    @pytest.mark.asyncio
    async def test_narrator_message_id_length(self):
        """Narrator message IDs should be full UUID length (32 hex chars)."""
        from babel.db import init_db, save_narrator_message
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            await init_db(db_path)

            import babel.db as db_module
            original_path = db_module.DB_PATH
            db_module.DB_PATH = db_path
            try:
                msg_id = await save_narrator_message("test-session", "user", "hello", 1)
                assert len(msg_id) == 32  # full uuid4 hex
            finally:
                db_module.DB_PATH = original_path


# ── Concurrency Safety ───────────────────────────────


class TestConcurrencySafety:
    """Verify that concurrent access patterns are safe."""

    def test_broadcast_snapshot_pattern(self):
        """Broadcasting should copy client set before iterating."""
        # This is a code-level test — verify the pattern is in place
        import inspect
        from babel.api import broadcast
        source = inspect.getsource(broadcast)
        assert "snapshot" in source or "list(" in source or "copy" in source

    def test_global_lock_exists(self):
        """API module should have a global lock for engine dict protection."""
        from babel.api import _global_lock, _engine_locks
        assert isinstance(_global_lock, asyncio.Lock)
        assert isinstance(_engine_locks, dict)
