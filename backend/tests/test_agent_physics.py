"""Tests for AgentPhysics — engine-enforced causal laws for agent internal state."""

import pytest

from babel.models import (
    ActionOutput, ActionType, AgentInternalState, AgentState,
    Session, WorldSeed, LocationSeed,
)
from babel.physics import DefaultAgentPhysics, NoAgentPhysics


# ── Helpers ──────────────────────────────────────────────

def _agent(personality: str = "", inventory: list[str] | None = None) -> AgentState:
    return AgentState(
        agent_id="alice",
        name="Alice",
        personality=personality,
        location="plaza",
        inventory=list(inventory or []),
    )


def _session() -> Session:
    seed = WorldSeed(
        name="test",
        locations=[LocationSeed(name="plaza"), LocationSeed(name="market")],
    )
    return Session(world_seed=seed)


def _action(action_type: ActionType, target: str = "", content: str = "") -> ActionOutput:
    return ActionOutput(type=action_type, target=target, content=content)


def _set_state(agent: AgentState, **kwargs) -> None:
    """Set internal state fields on an agent."""
    for k, v in kwargs.items():
        setattr(agent.internal_state, k, v)


# ── NoAgentPhysics ──────────────────────────────────────

class TestNoAgentPhysics:
    def test_pre_decide_returns_empty(self):
        ap = NoAgentPhysics()
        assert ap.pre_decide(_agent(), _session()) == {}

    def test_post_event_returns_empty(self):
        ap = NoAgentPhysics()
        assert ap.post_event(_action(ActionType.SPEAK), _agent(), _session()) == []

    def test_tick_effects_returns_empty(self):
        ap = NoAgentPhysics()
        assert ap.tick_effects(_agent(), _session()) == []

    def test_agent_state_unchanged(self):
        ap = NoAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        ap.tick_effects(agent, _session())
        # internal_state exists but should be at defaults
        assert agent.internal_state.energy == 1.0
        assert agent.internal_state.stress == 0.0
        assert agent.internal_state.momentum == 0.0


# ── Law 1: Conservation (energy) ────────────────────────

class TestConservation:
    def test_action_costs_energy(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state.energy < 1.0

    def test_wait_costs_nothing(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.WAIT), agent, _session())
        assert agent.internal_state.energy == 1.0

    def test_move_costs_more_than_observe(self):
        ap = DefaultAgentPhysics()
        mover = _agent()
        observer = _agent()
        ap.post_event(_action(ActionType.MOVE, target="market"), mover, _session())
        ap.post_event(_action(ActionType.OBSERVE), observer, _session())
        assert mover.internal_state.energy < observer.internal_state.energy

    def test_exhaustion_amplifies_cost(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, energy=0.15)
        ap.post_event(_action(ActionType.SPEAK), agent, _session())
        # At low energy, cost is 1.5x normal (0.05 * 1.5 = 0.075)
        assert agent.internal_state.energy < 0.15 - 0.05

    def test_exhaustion_triggers_effect(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, energy=0.08)
        effects = ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        assert any("exhausted" in e for e in effects)


# ── Stress as load (pure causal, no personality) ────────

class TestStressAsLoad:
    def test_non_rest_action_accumulates_stress(self):
        """Any action except wait adds stress (pure load accumulation)."""
        ap = DefaultAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        assert agent.internal_state.stress > 0.0

    def test_wait_does_not_add_stress(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.WAIT), agent, _session())
        assert agent.internal_state.stress == 0.0

    def test_sustained_activity_builds_stress(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        for _ in range(10):
            ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state.stress > 0.15

    def test_high_stress_triggers_effect(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, stress=0.79)
        effects = ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        assert any("load" in e for e in effects)

    def test_stress_is_personality_independent(self):
        """Same actions, different personalities → same stress. Physics, not preference."""
        ap = DefaultAgentPhysics()
        cautious = _agent(personality="cautious and shy")
        bold = _agent(personality="adventurous and bold")
        for _ in range(5):
            ap.post_event(_action(ActionType.MOVE, target="market"), cautious, _session())
            ap.post_event(_action(ActionType.MOVE, target="market"), bold, _session())
        assert cautious.internal_state.stress == bold.internal_state.stress


# ── Law 2: Inertia (momentum) ──────────────────────────

class TestMomentum:
    def test_repeated_action_builds_momentum(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        for _ in range(3):
            ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state.momentum > 0.3

    def test_direction_change_costs_extra(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        # Build momentum with repeated speaks
        for _ in range(4):
            ap.post_event(_action(ActionType.SPEAK), agent, _session())
        energy_before = agent.internal_state.energy
        momentum_before = agent.internal_state.momentum

        # Now change direction → momentum cost
        ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())

        assert agent.internal_state.momentum < momentum_before
        # Energy cost should include momentum penalty
        energy_drop = energy_before - agent.internal_state.energy
        base_move_cost = DefaultAgentPhysics.ACTION_COST["move"]
        assert energy_drop > base_move_cost

    def test_momentum_decays_per_tick(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, momentum=0.5, last_action="speak")
        ap.tick_effects(agent, _session())
        assert agent.internal_state.momentum < 0.5


# ── Law 3: Recovery ─────────────────────────────────────

class TestRecovery:
    def test_energy_recovers_per_tick(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, energy=0.5)
        ap.tick_effects(agent, _session())
        assert agent.internal_state.energy > 0.5

    def test_stress_decays_per_tick(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, stress=0.5)
        ap.tick_effects(agent, _session())
        assert agent.internal_state.stress < 0.5

    def test_high_stress_impedes_recovery(self):
        ap = DefaultAgentPhysics()
        stressed = _agent()
        relaxed = _agent()
        _set_state(stressed, energy=0.5, stress=0.8)
        _set_state(relaxed, energy=0.5, stress=0.0)
        ap.tick_effects(stressed, _session())
        ap.tick_effects(relaxed, _session())
        assert stressed.internal_state.energy < relaxed.internal_state.energy


# ── Second-order effects ────────────────────────────────

class TestSecondOrder:
    def test_extreme_stress_drains_energy(self):
        """Second-order: stress > 0.9 → energy drain per tick."""
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, energy=0.5, stress=0.95)
        effects = ap.tick_effects(agent, _session())
        assert any("draining" in e for e in effects)
        assert agent.internal_state.energy < 0.5

    def test_sustained_activity_loop(self):
        """Integration: sustained non-rest actions → stress → energy drain.
        Second-order feedback loop: behavior → state → constraint."""
        ap = DefaultAgentPhysics()
        agent = _agent()
        session = _session()

        for _ in range(20):
            ap.post_event(_action(ActionType.MOVE, target="market"), agent, session)
            ap.post_event(_action(ActionType.TRADE, target="bob"), agent, session)
            ap.tick_effects(agent, session)

        # After sustained activity: stress accumulated, energy depleted
        assert agent.internal_state.stress >= 0.19
        assert agent.internal_state.energy < 0.9

    def test_rest_maintains_health(self):
        """Counter-test: resting keeps agent healthy."""
        ap = DefaultAgentPhysics()
        agent = _agent()
        session = _session()

        for _ in range(20):
            ap.post_event(_action(ActionType.OBSERVE), agent, session)
            ap.tick_effects(agent, session)

        # Low-cost actions + recovery = healthy state
        assert agent.internal_state.stress < 0.1
        assert agent.internal_state.energy > 0.5


# ── pre_decide context enrichment ───────────────────────

class TestPreDecide:
    def test_returns_internal_state(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ctx = ap.pre_decide(agent, _session())
        assert "internal_state" in ctx
        assert ctx["internal_state"].energy == 1.0

    def test_high_stress_injects_emotional_context(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, stress=0.8, energy=0.5)
        ctx = ap.pre_decide(agent, _session())
        assert "emotional_context" in ctx
        assert "load" in ctx["emotional_context"].lower()

    def test_low_energy_injects_emotional_context(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        _set_state(agent, energy=0.2)
        ctx = ap.pre_decide(agent, _session())
        assert "emotional_context" in ctx
        assert "energy" in ctx["emotional_context"].lower()

    def test_healthy_state_no_emotional_override(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ctx = ap.pre_decide(agent, _session())
        assert "emotional_context" not in ctx


# ── AgentInternalState schema ───────────────────────────

class TestSchema:
    def test_default_state(self):
        s = AgentInternalState()
        assert s.energy == 1.0
        assert s.stress == 0.0
        assert s.momentum == 0.0
        assert s.last_action == ""

    def test_agent_has_typed_state(self):
        agent = _agent()
        assert isinstance(agent.internal_state, AgentInternalState)

    def test_state_serializes(self):
        s = AgentInternalState(energy=0.5, stress=0.3, momentum=0.2, last_action="speak")
        d = s.model_dump()
        assert d == {"energy": 0.5, "stress": 0.3, "momentum": 0.2, "last_action": "speak"}

    def test_state_roundtrips(self):
        s = AgentInternalState(energy=0.5, stress=0.3, momentum=0.2, last_action="speak")
        s2 = AgentInternalState(**s.model_dump())
        assert s == s2


# ── Protocol compliance ─────────────────────────────────

class TestProtocolCompliance:
    def test_default_is_agent_physics(self):
        from babel.physics import AgentPhysics
        assert isinstance(DefaultAgentPhysics(), AgentPhysics)

    def test_no_is_agent_physics(self):
        from babel.physics import AgentPhysics
        assert isinstance(NoAgentPhysics(), AgentPhysics)

    def test_psyche_is_agent_physics(self):
        from babel.physics import AgentPhysics, PsycheAgentPhysics
        assert isinstance(PsycheAgentPhysics(), AgentPhysics)
