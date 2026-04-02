"""Tests for AgentPhysics — engine-enforced causal laws for agent internal state."""

import pytest

from babel.models import ActionOutput, ActionType, AgentState, Session, WorldSeed, LocationSeed
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
        assert agent.internal_state == {}


# ── Law 1: Conservation (energy) ────────────────────────

class TestConservation:
    def test_action_costs_energy(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state["energy"] < 1.0

    def test_wait_costs_nothing(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ap.post_event(_action(ActionType.WAIT), agent, _session())
        assert agent.internal_state["energy"] == 1.0

    def test_move_costs_more_than_observe(self):
        ap = DefaultAgentPhysics()
        mover = _agent()
        observer = _agent()
        ap.post_event(_action(ActionType.MOVE, target="market"), mover, _session())
        ap.post_event(_action(ActionType.OBSERVE), observer, _session())
        assert mover.internal_state["energy"] < observer.internal_state["energy"]

    def test_exhaustion_amplifies_cost(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.15, "stress": 0.0, "momentum": 0.0, "last_action": ""}
        ap.post_event(_action(ActionType.SPEAK), agent, _session())
        # At low energy, cost is 1.5x normal (0.05 * 1.5 = 0.075)
        assert agent.internal_state["energy"] < 0.15 - 0.05

    def test_exhaustion_triggers_effect(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.08, "stress": 0.0, "momentum": 0.0, "last_action": ""}
        effects = ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        assert any("exhausted" in e for e in effects)


# ── Law 2: Entropy (stress) ─────────────────────────────

class TestEntropy:
    def test_cautious_agent_stressed_by_move(self):
        ap = DefaultAgentPhysics()
        agent = _agent(personality="cautious and reserved")
        ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        assert agent.internal_state["stress"] > 0.0

    def test_social_agent_stressed_by_waiting(self):
        ap = DefaultAgentPhysics()
        agent = _agent(personality="social and talkative")
        ap.post_event(_action(ActionType.WAIT), agent, _session())
        assert agent.internal_state["stress"] > 0.0

    def test_cautious_agent_relieved_by_observe(self):
        ap = DefaultAgentPhysics()
        agent = _agent(personality="cautious and careful")
        agent.internal_state = {"energy": 1.0, "stress": 0.2, "momentum": 0.0, "last_action": ""}
        ap.post_event(_action(ActionType.OBSERVE), agent, _session())
        assert agent.internal_state["stress"] < 0.2

    def test_social_agent_relieved_by_speak(self):
        ap = DefaultAgentPhysics()
        agent = _agent(personality="social and friendly")
        agent.internal_state = {"energy": 1.0, "stress": 0.2, "momentum": 0.0, "last_action": ""}
        ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state["stress"] < 0.2

    def test_high_stress_triggers_effect(self):
        ap = DefaultAgentPhysics()
        agent = _agent(personality="cautious and shy")
        agent.internal_state = {"energy": 1.0, "stress": 0.78, "momentum": 0.0, "last_action": ""}
        effects = ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())
        assert any("stress" in e for e in effects)

    def test_chinese_personality_keywords(self):
        ap = DefaultAgentPhysics()
        agent = _agent(personality="谨慎而内向")
        ap.post_event(_action(ActionType.TRADE, target="bob"), agent, _session())
        assert agent.internal_state["stress"] > 0.0


# ── Law 3: Cost (momentum) ──────────────────────────────

class TestMomentum:
    def test_repeated_action_builds_momentum(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        for _ in range(3):
            ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state["momentum"] > 0.3

    def test_direction_change_costs_extra(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        # Build momentum with repeated speaks
        for _ in range(4):
            ap.post_event(_action(ActionType.SPEAK), agent, _session())
        energy_before = agent.internal_state["energy"]
        momentum_before = agent.internal_state["momentum"]

        # Now change direction → momentum cost
        ap.post_event(_action(ActionType.MOVE, target="market"), agent, _session())

        assert agent.internal_state["momentum"] < momentum_before
        # Energy cost should include momentum penalty
        energy_drop = energy_before - agent.internal_state["energy"]
        base_move_cost = DefaultAgentPhysics.ACTION_COST["move"]
        assert energy_drop > base_move_cost

    def test_momentum_decays_per_tick(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 1.0, "stress": 0.0, "momentum": 0.5, "last_action": "speak"}
        ap.tick_effects(agent, _session())
        assert agent.internal_state["momentum"] < 0.5


# ── Law 4: Regeneration ─────────────────────────────────

class TestRegeneration:
    def test_energy_recovers_per_tick(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.5, "stress": 0.0, "momentum": 0.0, "last_action": ""}
        ap.tick_effects(agent, _session())
        assert agent.internal_state["energy"] > 0.5

    def test_stress_decays_per_tick(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 1.0, "stress": 0.5, "momentum": 0.0, "last_action": ""}
        ap.tick_effects(agent, _session())
        assert agent.internal_state["stress"] < 0.5

    def test_high_stress_impedes_recovery(self):
        ap = DefaultAgentPhysics()
        stressed = _agent()
        relaxed = _agent()
        stressed.internal_state = {"energy": 0.5, "stress": 0.8, "momentum": 0.0, "last_action": ""}
        relaxed.internal_state = {"energy": 0.5, "stress": 0.0, "momentum": 0.0, "last_action": ""}
        ap.tick_effects(stressed, _session())
        ap.tick_effects(relaxed, _session())
        assert stressed.internal_state["energy"] < relaxed.internal_state["energy"]

    def test_social_actions_reduce_stress(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 1.0, "stress": 0.5, "momentum": 0.0, "last_action": ""}
        ap.post_event(_action(ActionType.SPEAK), agent, _session())
        assert agent.internal_state["stress"] < 0.5


# ── Second-order effects ────────────────────────────────

class TestSecondOrder:
    def test_extreme_stress_drains_energy(self):
        """Second-order: stress > 0.9 → energy drain per tick."""
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.5, "stress": 0.95, "momentum": 0.0, "last_action": ""}
        effects = ap.tick_effects(agent, _session())
        assert any("draining" in e for e in effects)
        assert agent.internal_state["energy"] < 0.5

    def test_behavior_state_behavior_loop(self):
        """Integration: repeated against-nature actions → stress → energy drain → exhaustion.
        This is the second-order feedback loop: behavior → state → behavior constraint."""
        ap = DefaultAgentPhysics()
        agent = _agent(personality="cautious and shy and reserved")
        session = _session()

        # Force agent to repeatedly act against nature (move + trade)
        for _ in range(15):
            ap.post_event(_action(ActionType.MOVE, target="market"), agent, session)
            ap.post_event(_action(ActionType.TRADE, target="bob"), agent, session)
            ap.tick_effects(agent, session)

        # After many against-nature actions: high stress, low energy
        assert agent.internal_state["stress"] > 0.3
        assert agent.internal_state["energy"] < 0.8

    def test_in_nature_actions_maintain_health(self):
        """Counter-test: acting in nature keeps agent healthy."""
        ap = DefaultAgentPhysics()
        agent = _agent(personality="cautious and careful observer")
        session = _session()

        for _ in range(15):
            ap.post_event(_action(ActionType.OBSERVE), agent, session)
            ap.tick_effects(agent, session)

        # Acting in nature: low stress, good energy
        assert agent.internal_state["stress"] < 0.1
        assert agent.internal_state["energy"] > 0.5


# ── pre_decide context enrichment ───────────────────────

class TestPreDecide:
    def test_returns_internal_state(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ctx = ap.pre_decide(agent, _session())
        assert "internal_state" in ctx
        assert ctx["internal_state"]["energy"] == 1.0

    def test_high_stress_injects_emotional_context(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.5, "stress": 0.8, "momentum": 0.0, "last_action": ""}
        ctx = ap.pre_decide(agent, _session())
        assert "emotional_context" in ctx
        assert "tension" in ctx["emotional_context"].lower()

    def test_low_energy_injects_emotional_context(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.2, "stress": 0.0, "momentum": 0.0, "last_action": ""}
        ctx = ap.pre_decide(agent, _session())
        assert "emotional_context" in ctx
        assert "energy" in ctx["emotional_context"].lower()

    def test_healthy_state_no_emotional_override(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        ctx = ap.pre_decide(agent, _session())
        assert "emotional_context" not in ctx


# ── State initialization ────────────────────────────────

class TestStateInit:
    def test_auto_initializes_state(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        assert agent.internal_state == {}
        ap.pre_decide(agent, _session())
        assert "energy" in agent.internal_state
        assert "stress" in agent.internal_state
        assert "momentum" in agent.internal_state

    def test_preserves_existing_state(self):
        ap = DefaultAgentPhysics()
        agent = _agent()
        agent.internal_state = {"energy": 0.3, "stress": 0.7, "momentum": 0.5, "last_action": "speak"}
        ap.pre_decide(agent, _session())
        assert agent.internal_state["energy"] == 0.3
        assert agent.internal_state["stress"] == 0.7


# ── Protocol compliance ─────────────────────────────────

class TestProtocolCompliance:
    def test_default_is_agent_physics(self):
        from babel.physics import AgentPhysics
        assert isinstance(DefaultAgentPhysics(), AgentPhysics)

    def test_no_is_agent_physics(self):
        from babel.physics import AgentPhysics
        assert isinstance(NoAgentPhysics(), AgentPhysics)
