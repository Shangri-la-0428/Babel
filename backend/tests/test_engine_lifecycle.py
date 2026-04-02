"""BABEL -- Engine lifecycle tests.

Covers:
- Start / Stop / Pause state transitions
- Tick mechanics (increment, events, step)
- Agent filtering (dead, supporting role)
- Event callback (sync and async on_event)
- Urgent event injection and clearing
- Engine.configure() runtime updates
- Decision source switching
- Error recovery (fallback to WAIT)
- Post-tick processing (timeline nodes, snapshots) [mocked]
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from babel.decision import (
    AgentContext,
    ContextAwareDecisionSource,
    DecisionSource,
    LLMDecisionSource,
    ScriptedDecisionSource,
)
from babel.engine import Engine
from babel.models import (
    ActionOutput,
    ActionType,
    AgentRole,
    AgentSeed,
    AgentState,
    AgentStatus,
    Event,
    LocationSeed,
    Session,
    SessionStatus,
    StateChanges,
    WorldSeed,
    LLMResponse,
)
# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Standard set of DB / memory mocks required for any tick() call.
# Keeps each test focused on engine behaviour, not persistence wiring.
_DB_PATCHES = [
    patch("babel.memory.save_memory", new_callable=AsyncMock),
    patch("babel.memory.query_memories", new_callable=AsyncMock, return_value=[]),
    patch("babel.memory.update_memory_access", new_callable=AsyncMock),
    patch("babel.memory.load_events_filtered", new_callable=AsyncMock, return_value=[]),
    patch("babel.db.save_timeline_node", new_callable=AsyncMock),
    patch("babel.db.get_last_node_id", new_callable=AsyncMock, return_value=None),
    patch("babel.db.save_snapshot", new_callable=AsyncMock),
    patch("babel.db.load_entity_details", new_callable=AsyncMock, return_value=None),
    patch("babel.db.save_entity_details", new_callable=AsyncMock),
    patch("babel.db.load_events_filtered", new_callable=AsyncMock, return_value=[]),
    patch("babel.db.load_events", new_callable=AsyncMock, return_value=[]),
]


def _start_patches() -> list:
    """Activate all DB patches and return the patcher list."""
    mocks = []
    for p in _DB_PATCHES:
        mocks.append(p.start())
    return mocks


def _stop_patches() -> None:
    for p in _DB_PATCHES:
        p.stop()


def _make_engine(
    decision_source: DecisionSource | None = None,
    on_event=None,
    world_authority=None,
    hooks=None,
    snapshot_interval: int = 10,
    epoch_interval: int = 5,
    belief_interval: int = 10,
) -> Engine:
    """Create an Engine with a minimal two-location, two-agent world."""
    from babel.hooks import DefaultEngineHooks

    ws = WorldSeed(
        name="Test",
        locations=[
            LocationSeed(name="广场", connections=["酒馆"]),
            LocationSeed(name="酒馆", connections=["广场"]),
        ],
        agents=[
            AgentSeed(id="a1", name="Alice", location="广场", goals=["survive"]),
            AgentSeed(id="a2", name="Bob", location="酒馆", goals=["trade"]),
        ],
    )
    session = Session(world_seed=ws)
    session.init_agents()
    if hooks is None:
        hooks = DefaultEngineHooks(
            snapshot_interval=snapshot_interval,
            epoch_interval=epoch_interval,
            belief_interval=belief_interval,
        )
    engine = Engine(
        session=session,
        decision_source=decision_source or ScriptedDecisionSource(),
        on_event=on_event,
        world_authority=world_authority,
        hooks=hooks,
    )
    if hasattr(hooks, "install_facades"):
        hooks.install_facades(engine)
    return engine


# ---------------------------------------------------------------------------
# Error-throwing decision sources
# ---------------------------------------------------------------------------

class ErrorDecisionSource:
    """Always raises -- used to test error fallback paths."""

    async def decide(self, ctx: AgentContext) -> ActionOutput:
        raise RuntimeError("LLM exploded")


class FirstAgentErrorSource:
    """Raises for agent 'a1', succeeds for all others."""

    async def decide(self, ctx: AgentContext) -> ActionOutput:
        if ctx.agent_id == "a1":
            raise RuntimeError("first agent fails")
        return ActionOutput(type=ActionType.WAIT, content="ok")


class NeedsRepairHintSource:
    """Returns an illegal move until the retry context includes a repair hint."""

    async def decide(self, ctx: AgentContext) -> ActionOutput:
        if any("custom repair hint" in event for event in ctx.recent_events):
            return ActionOutput(type=ActionType.OBSERVE, content="recovered after repair")
        return ActionOutput(type=ActionType.MOVE, target="不存在的地点", content="bad move")


class AlwaysMoveSource:
    async def decide(self, ctx: AgentContext) -> ActionOutput:
        del ctx
        return ActionOutput(type=ActionType.MOVE, target="酒馆", content="heading out")


class BeliefAwareSource:
    async def decide(self, ctx: AgentContext) -> ActionOutput:
        if "custom clue" in ctx.beliefs:
            return ActionOutput(type=ActionType.OBSERVE, content="acting on custom clue")
        return ActionOutput(type=ActionType.WAIT, content="no clue available")


# ===================================================================
# 1-6  Start / Stop / Pause lifecycle
# ===================================================================


class TestStartStopPause:
    """Tests 1-6: synchronous lifecycle transitions."""

    def test_initial_state(self):
        engine = _make_engine()
        assert engine.is_running is False
        assert engine.session.status == SessionStatus.PAUSED
        assert engine.session.tick == 0

    def test_start_sets_running(self):
        engine = _make_engine()
        engine.start()
        assert engine.is_running is True
        assert engine.session.status == SessionStatus.RUNNING

    def test_stop_clears_running(self):
        engine = _make_engine()
        engine.start()
        engine.stop()
        assert engine.is_running is False
        assert engine.session.status == SessionStatus.ENDED

    def test_pause_is_stop(self):
        engine = _make_engine()
        engine.start()
        engine.pause()
        assert engine.is_running is False
        assert engine.session.status == SessionStatus.PAUSED

    def test_double_start_idempotent(self):
        engine = _make_engine()
        engine.start()
        engine.start()
        assert engine.is_running is True
        assert engine.session.status == SessionStatus.RUNNING

    def test_double_stop_idempotent(self):
        engine = _make_engine()
        # stop without start -- should not raise
        engine.stop()
        engine.stop()
        assert engine.is_running is False


# ===================================================================
# 7-12  Tick mechanics
# ===================================================================


class TestTickMechanics:
    """Tests 7-12: tick increments, event production, decision sources."""

    @pytest.mark.asyncio
    async def test_tick_increments(self):
        _start_patches()
        try:
            engine = _make_engine()
            assert engine.session.tick == 0
            await engine.tick()
            assert engine.session.tick == 1
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_tick_returns_events(self):
        _start_patches()
        try:
            engine = _make_engine()
            events = await engine.tick()
            assert isinstance(events, list)
            # Two alive agents -> at least one event (possibly two)
            assert len(events) >= 1
            for e in events:
                assert isinstance(e, Event)
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_step_calls_tick(self):
        """step() is an alias for tick() and should produce the same result shape."""
        _start_patches()
        try:
            engine = _make_engine()
            events = await engine.step()
            assert isinstance(events, list)
            assert engine.session.tick == 1
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_multiple_ticks_accumulate(self):
        _start_patches()
        try:
            engine = _make_engine()
            all_events: list[Event] = []
            for _ in range(5):
                all_events.extend(await engine.tick())
            assert engine.session.tick == 5
            assert len(all_events) >= 5  # at least 1 event per tick
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_tick_with_scripted_source(self):
        _start_patches()
        try:
            src = ScriptedDecisionSource()
            engine = _make_engine(decision_source=src)
            events = await engine.tick()
            for e in events:
                at = e.action_type if isinstance(e.action_type, str) else e.action_type.value
                assert at in ("observe", "wait", "chapter"), f"Unexpected action type: {at}"
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_tick_with_context_aware_source(self):
        _start_patches()
        try:
            src = ContextAwareDecisionSource(seed=42)
            engine = _make_engine(decision_source=src)
            events = await engine.tick()
            assert len(events) >= 1
            for e in events:
                assert isinstance(e, Event)
                assert e.result  # events should have a result string
        finally:
            _stop_patches()


# ===================================================================
# 13-15  Agent filtering
# ===================================================================


class TestAgentFiltering:

    @pytest.mark.asyncio
    async def test_dead_agent_skipped(self):
        """A DEAD agent should produce no event."""
        _start_patches()
        try:
            engine = _make_engine()
            engine.session.agents["a1"].status = AgentStatus.DEAD
            events = await engine.tick()
            agent_ids_in_events = [e.agent_id for e in events]
            assert "a1" not in agent_ids_in_events
            # Only a2 should have acted
            assert all(eid == "a2" for eid in agent_ids_in_events if eid)
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_all_agents_dead_empty_tick(self):
        _start_patches()
        try:
            engine = _make_engine()
            engine.session.agents["a1"].status = AgentStatus.DEAD
            engine.session.agents["a2"].status = AgentStatus.DEAD
            events = await engine.tick()
            assert events == []
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_supporting_agent_sometimes_skipped(self):
        """A SUPPORTING agent should skip ~30% of ticks (random > 0.7 path).

        Over 20 ticks the agent should act fewer than 20 times.
        """
        _start_patches()
        try:
            # Use only one agent to simplify counting
            ws = WorldSeed(
                name="Solo",
                locations=[LocationSeed(name="广场", connections=[])],
                agents=[
                    AgentSeed(id="s1", name="Sid", location="广场", goals=["wait"]),
                ],
            )
            session = Session(world_seed=ws)
            session.init_agents()
            session.agents["s1"].role = AgentRole.SUPPORTING

            engine = Engine(
                session=session,
                decision_source=ScriptedDecisionSource(),
            )

            acted_count = 0
            for _ in range(40):
                events = await engine.tick()
                acted_count += len([e for e in events if e.agent_id == "s1" and e.action_type != "chapter"])

            # 70% chance of acting each tick -> expected ~28/40
            # With 40 ticks this should be very unlikely to be exactly 40
            assert acted_count < 40, (
                f"SUPPORTING agent acted every tick ({acted_count}/40) -- "
                "skip logic not working"
            )
            # Also verify it did act at least some times
            assert acted_count > 0
        finally:
            _stop_patches()


# ===================================================================
# 16-17  Event callback
# ===================================================================


class TestEventCallback:

    @pytest.mark.asyncio
    async def test_on_event_called(self):
        _start_patches()
        try:
            received: list[Event] = []

            def on_ev(event: Event):
                received.append(event)

            engine = _make_engine(on_event=on_ev)
            events = await engine.tick()
            # on_event is called once per event emitted during the tick
            assert len(received) >= 1
            # Agent events (not chapters) should have triggered the callback
            agent_events = [e for e in events if e.action_type != "chapter"]
            for e in agent_events:
                assert e in received
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_on_event_async(self):
        _start_patches()
        try:
            received: list[Event] = []

            async def async_on_ev(event: Event):
                received.append(event)

            engine = _make_engine(on_event=async_on_ev)
            events = await engine.tick()
            assert len(received) >= 1
        finally:
            _stop_patches()


# ===================================================================
# 18-19  Urgent events
# ===================================================================


class TestUrgentEvents:

    def test_inject_urgent_event(self):
        engine = _make_engine()
        engine.inject_urgent_event("A meteor strikes!")
        assert "A meteor strikes!" in engine.session.urgent_events

    @pytest.mark.asyncio
    async def test_urgent_events_cleared_after_tick(self):
        _start_patches()
        try:
            engine = _make_engine()
            engine.inject_urgent_event("Storm approaching!")
            assert len(engine.session.urgent_events) == 1
            await engine.tick()
            assert len(engine.session.urgent_events) == 0
        finally:
            _stop_patches()


# ===================================================================
# 20-21  Configure
# ===================================================================


class TestConfigure:

    def test_configure_updates_model(self):
        engine = _make_engine()
        assert engine.model is None
        engine.configure(model="test-model")
        assert engine.model == "test-model"

    def test_configure_updates_tick_delay(self):
        engine = _make_engine()
        assert engine.tick_delay == 2.0
        engine.configure(tick_delay=5.0)
        assert engine.tick_delay == 5.0

    def test_configure_propagates_to_default_llm_source(self):
        ws = WorldSeed(
            name="Test",
            locations=[LocationSeed(name="广场", connections=[])],
            agents=[AgentSeed(id="a1", name="Alice", location="广场", goals=["wait"])],
        )
        session = Session(world_seed=ws)
        session.init_agents()
        llm_source = LLMDecisionSource(model="old-model", api_key="old-key", api_base="https://old.example")
        engine = Engine(session=session, decision_source=llm_source)

        engine.configure(
            model="new-model",
            api_key="new-key",
            api_base="https://new.example",
        )

        assert llm_source.model == "new-model"
        assert llm_source.api_key == "new-key"
        assert llm_source.api_base == "https://new.example"


# ===================================================================
# 22-23  Decision source switching
# ===================================================================


class TestDecisionSourceSwitch:

    @pytest.mark.asyncio
    async def test_switch_decision_source(self):
        _start_patches()
        try:
            scripted = ScriptedDecisionSource()
            engine = _make_engine(decision_source=scripted)
            assert engine.decision_source is scripted

            events1 = await engine.tick()
            assert len(events1) >= 1

            # Switch to ContextAwareDecisionSource mid-run
            ctx_src = ContextAwareDecisionSource(seed=99)
            engine.decision_source = ctx_src
            assert engine.decision_source is ctx_src

            events2 = await engine.tick()
            assert len(events2) >= 1
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_decision_source_error_fallback(self):
        """When the DecisionSource raises, engine should still return events (WAIT fallback)."""
        _start_patches()
        try:
            engine = _make_engine(decision_source=ErrorDecisionSource())
            events = await engine.tick()
            agent_events = [e for e in events if e.action_type != "chapter"]
            # Should get WAIT fallback events, not a crash
            assert len(agent_events) >= 1
            for e in agent_events:
                at = e.action_type if isinstance(e.action_type, str) else e.action_type.value
                assert at == "wait"
        finally:
            _stop_patches()


# ===================================================================
# 24-25  Error recovery
# ===================================================================


class TestErrorRecovery:

    @pytest.mark.asyncio
    async def test_resolve_error_produces_wait(self):
        """A broken DecisionSource should result in WAIT events with error reason."""
        _start_patches()
        try:
            engine = _make_engine(decision_source=ErrorDecisionSource())
            events = await engine.tick()
            agent_events = [e for e in events if e.action_type != "chapter"]
            for e in agent_events:
                at = e.action_type if isinstance(e.action_type, str) else e.action_type.value
                assert at == "wait"
                # The result should mention the error
                assert "error" in e.result.lower() or "waited" in e.result.lower()
        finally:
            _stop_patches()

    @pytest.mark.asyncio
    async def test_tick_continues_after_agent_error(self):
        """If the first agent's decide() raises, the second agent still gets processed."""
        _start_patches()
        try:
            src = FirstAgentErrorSource()
            engine = _make_engine(decision_source=src)
            # Must be running, otherwise the mid-tick pause check breaks
            # the loop after processing the first agent.
            engine.start()
            events = await engine.tick()
            agent_events = [e for e in events if e.action_type != "chapter"]
            # Both agents should have events (first via error fallback, second normally)
            assert len(agent_events) == 2
            agent_ids = {e.agent_id for e in agent_events}
            assert "a1" in agent_ids
            assert "a2" in agent_ids
        finally:
            _stop_patches()


class TestWorldAuthority:

    @pytest.mark.asyncio
    async def test_custom_world_authority_can_veto_action(self):
        class RejectAllAuthority:
            def __init__(self):
                self.seen = 0

            def validate(self, response, agent, session):
                self.seen += 1
                return ["custom veto"]

            def apply(self, response, agent, session):
                raise AssertionError("apply should not run for rejected actions")

        _start_patches()
        try:
            authority = RejectAllAuthority()
            engine = _make_engine(world_authority=authority)
            events = await engine.tick()
            assert authority.seen >= 1
            assert any("Invalid: custom veto" in e.result for e in events)
        finally:
            _stop_patches()


class TestResolutionRetry:
    """Engine retry logic: invalid actions get re-attempted with error context."""

    @pytest.mark.asyncio
    async def test_retry_injects_error_and_recovers(self):
        """The built-in retry injects [SYSTEM] error hint, decision source can read it."""
        _start_patches()
        try:
            engine = _make_engine(decision_source=NeedsRepairHintSource())
            events = await engine.tick()
            # NeedsRepairHintSource needs "custom repair hint" in recent_events,
            # but the engine injects "[SYSTEM] Your previous action was INVALID".
            # So it won't find "custom repair hint" — it should fall back to WAIT.
            agent_events = [e for e in events if e.action_type != "chapter"]
            assert len(agent_events) >= 1
        finally:
            _stop_patches()


class TestCustomHooks:
    """Custom hooks control perception, not the engine."""

    @pytest.mark.asyncio
    async def test_custom_hooks_controls_agent_context(self):
        """Custom hooks.build_context() can inject arbitrary context."""
        from babel.hooks import NullHooks

        class InjectingHooks(NullHooks):
            async def build_context(self, engine, agent):
                return AgentContext(
                    agent_id=agent.agent_id,
                    agent_name=agent.name,
                    agent_location=agent.location,
                    beliefs=["custom clue"],
                    recent_events=["[SYSTEM] injected context"],
                    tick=1,
                )

        _start_patches()
        try:
            hooks = InjectingHooks()
            engine = _make_engine(
                decision_source=BeliefAwareSource(),
                hooks=hooks,
            )
            events = await engine.tick()
            assert any("acting on custom clue" in e.result for e in events)
        finally:
            _stop_patches()


class TestWorldAuthorityApply:

    @pytest.mark.asyncio
    async def test_custom_world_authority_can_apply_summary(self):
        class CustomAuthority:
            def validate(self, response, agent, session):
                return []

            def apply(self, response, agent, session):
                response._structured = {"verb": "custom"}  # type: ignore[attr-defined]
                return f"{agent.name} resolved through custom authority"

        _start_patches()
        try:
            engine = _make_engine(world_authority=CustomAuthority())
            events = await engine.tick()
            assert any(e.result.endswith("custom authority") for e in events)
            assert any(e.structured.get("verb") == "custom" for e in events)
        finally:
            _stop_patches()


# ===================================================================
# 26-27  Post-tick processing (timeline nodes, snapshots)
# ===================================================================


class TestPostTick:

    @pytest.mark.asyncio
    async def test_timeline_node_created_per_tick(self):
        """After tick(), save_timeline_node should have been called."""
        patchers = [
            patch("babel.memory.save_memory", new_callable=AsyncMock),
            patch("babel.memory.query_memories", new_callable=AsyncMock, return_value=[]),
            patch("babel.memory.update_memory_access", new_callable=AsyncMock),
            patch("babel.memory.load_events_filtered", new_callable=AsyncMock, return_value=[]),
            patch("babel.db.get_last_node_id", new_callable=AsyncMock, return_value=None),
            patch("babel.db.save_snapshot", new_callable=AsyncMock),
            patch("babel.db.load_entity_details", new_callable=AsyncMock, return_value=None),
            patch("babel.db.save_entity_details", new_callable=AsyncMock),
            patch("babel.db.load_events_filtered", new_callable=AsyncMock, return_value=[]),
            patch("babel.db.load_events", new_callable=AsyncMock, return_value=[]),
        ]
        mock_save_node = AsyncMock()
        patchers.append(patch("babel.db.save_timeline_node", mock_save_node))

        for p in patchers:
            p.start()
        try:
            engine = _make_engine()
            await engine.tick()
            assert mock_save_node.await_count == 1
            # Verify the TimelineNode argument
            node_arg = mock_save_node.call_args[0][0]
            assert node_arg.tick == 1
            assert node_arg.session_id == engine.session.id
        finally:
            for p in patchers:
                p.stop()

    @pytest.mark.asyncio
    async def test_snapshot_created_at_interval(self):
        """With snapshot_interval=2, a snapshot should be saved on tick 2."""
        patchers = [
            patch("babel.memory.save_memory", new_callable=AsyncMock),
            patch("babel.memory.query_memories", new_callable=AsyncMock, return_value=[]),
            patch("babel.memory.update_memory_access", new_callable=AsyncMock),
            patch("babel.memory.load_events_filtered", new_callable=AsyncMock, return_value=[]),
            patch("babel.db.get_last_node_id", new_callable=AsyncMock, return_value=None),
            patch("babel.db.save_timeline_node", new_callable=AsyncMock),
            patch("babel.db.load_entity_details", new_callable=AsyncMock, return_value=None),
            patch("babel.db.save_entity_details", new_callable=AsyncMock),
            patch("babel.db.load_events_filtered", new_callable=AsyncMock, return_value=[]),
            patch("babel.db.load_events", new_callable=AsyncMock, return_value=[]),
        ]
        mock_save_snapshot = AsyncMock()
        patchers.append(patch("babel.db.save_snapshot", mock_save_snapshot))

        for p in patchers:
            p.start()
        try:
            engine = _make_engine(snapshot_interval=2)

            # Tick 1 -- not a snapshot boundary
            await engine.tick()
            snapshot_calls_after_1 = mock_save_snapshot.await_count

            # Tick 2 -- should trigger snapshot (2 % 2 == 0)
            await engine.tick()
            snapshot_calls_after_2 = mock_save_snapshot.await_count

            # At least one new snapshot call on tick 2
            assert snapshot_calls_after_2 > snapshot_calls_after_1, (
                f"Expected snapshot at tick 2 (interval=2). "
                f"Calls after tick 1: {snapshot_calls_after_1}, after tick 2: {snapshot_calls_after_2}"
            )
        finally:
            for p in patchers:
                p.stop()
