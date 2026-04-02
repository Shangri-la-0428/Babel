"""BABEL — Second-order emergence proof.

First-order: physics → behavior differentiation (same actions, different stress).
Second-order: behavior → state change → behavior change → state change (feedback loop).

This test proves the engine produces second-order emergence with zero LLM:
an agent's internal state (energy, stress, momentum) feeds back into its
decisions via AgentPhysics.pre_decide → AgentContext, creating a closed loop.
"""

from __future__ import annotations

import asyncio
import unittest
from typing import Any

from babel.decision import AgentContext
from babel.engine import Engine
from babel.hooks import NullHooks
from babel.models import (
    ActionOutput,
    ActionType,
    AgentSeed,
    LocationSeed,
    Session,
    WorldSeed,
)
from babel.physics import DefaultAgentPhysics, DefaultWorldPhysics, NoAgentPhysics


class StateAwareSource:
    """Decision source that changes behavior based on agent internal state.

    This is the key to second-order emergence: the agent's internal state
    (injected by AgentPhysics.pre_decide) changes its decisions.

    Rules:
    - High stress (>0.6) → wait (rest)
    - Low energy (<0.3) → observe (low cost)
    - Otherwise → move (explore)
    """

    def __init__(self):
        self.decision_log: list[tuple[str, str, dict]] = []

    async def decide(self, context: AgentContext) -> ActionOutput:
        internal = context.internal_state
        energy = internal.get("energy", 1.0)
        stress = internal.get("stress", 0.0)

        if stress > 0.6:
            action = ActionOutput(type=ActionType.WAIT, content="resting due to stress")
            self.decision_log.append((context.agent_id, "wait", dict(internal)))
            return action

        if energy < 0.3:
            action = ActionOutput(type=ActionType.OBSERVE, content="conserving energy")
            self.decision_log.append((context.agent_id, "observe", dict(internal)))
            return action

        if context.reachable_locations:
            target = context.reachable_locations[context.tick % len(context.reachable_locations)]
            action = ActionOutput(type=ActionType.MOVE, target=target, content="exploring")
            self.decision_log.append((context.agent_id, "move", dict(internal)))
            return action

        action = ActionOutput(type=ActionType.WAIT, content="nothing to do")
        self.decision_log.append((context.agent_id, "wait", dict(internal)))
        return action


def _make_seed() -> WorldSeed:
    return WorldSeed(
        name="emergence-test",
        locations=[
            LocationSeed(name="plaza", connections=["market", "temple"]),
            LocationSeed(name="market", connections=["plaza"]),
            LocationSeed(name="temple", connections=["plaza"]),
        ],
        agents=[
            AgentSeed(
                id="cautious", name="Cautious Agent",
                personality="extremely cautious, shy, reserved, and anxious",
                location="plaza",
                goals=["survive"],
            ),
            AgentSeed(
                id="bold", name="Bold Agent",
                personality="adventurous, bold, fearless explorer",
                location="plaza",
                goals=["explore everything"],
            ),
        ],
    )


class TestSecondOrderEmergence(unittest.TestCase):
    """50-tick no-LLM test proving behavior→state→behavior feedback loop."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_feedback_loop_50_ticks(self):
        """Run 50 ticks with state-aware source + DefaultAgentPhysics.

        Proves:
        1. Cautious agent accumulates stress from moving → switches to resting
        2. Bold agent doesn't accumulate stress → keeps moving
        3. Both agents' behavior changes over time based on internal state
        """
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        source = StateAwareSource()
        ap = DefaultAgentPhysics()

        engine = Engine(
            session=session,
            decision_source=source,
            agent_physics=ap,
            hooks=NullHooks(),
        )

        # Track state evolution
        cautious_states: list[dict] = []
        bold_states: list[dict] = []

        for _ in range(50):
            self._run(engine.tick())
            cautious_states.append(dict(session.agents["cautious"].internal_state))
            bold_states.append(dict(session.agents["bold"].internal_state))

        self.assertEqual(session.tick, 50)

        # ── Proof 1: Cautious agent's stress trajectory is higher ──
        cautious_max_stress = max(s["stress"] for s in cautious_states)
        bold_max_stress = max(s["stress"] for s in bold_states)
        self.assertGreater(cautious_max_stress, bold_max_stress,
                           "Cautious agent should experience more stress from moving")

        # ── Proof 2: Behavior changed over time (second-order) ──
        # Count decision types per agent
        cautious_decisions = [d for d in source.decision_log if d[0] == "cautious"]
        bold_decisions = [d for d in source.decision_log if d[0] == "bold"]

        cautious_waits = sum(1 for d in cautious_decisions if d[1] == "wait")
        bold_waits = sum(1 for d in bold_decisions if d[1] == "wait")

        # Cautious agent should have rested more (stress → wait)
        self.assertGreater(cautious_waits, bold_waits,
                           "Cautious agent should rest more due to stress feedback")

        # ── Proof 3: Bold agent moved more (low stress → keep exploring) ──
        cautious_moves = sum(1 for d in cautious_decisions if d[1] == "move")
        bold_moves = sum(1 for d in bold_decisions if d[1] == "move")
        self.assertGreater(bold_moves, cautious_moves,
                           "Bold agent should explore more — no stress penalty")

    def test_without_agent_physics_no_differentiation(self):
        """Control: without AgentPhysics, both agents behave identically.
        This proves the differentiation comes from AgentPhysics, not the source."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        source = StateAwareSource()

        engine = Engine(
            session=session,
            decision_source=source,
            agent_physics=NoAgentPhysics(),
            hooks=NullHooks(),
        )

        for _ in range(50):
            self._run(engine.tick())

        # Without AgentPhysics, internal_state is empty → both behave the same
        cautious_decisions = [d for d in source.decision_log if d[0] == "cautious"]
        bold_decisions = [d for d in source.decision_log if d[0] == "bold"]

        cautious_waits = sum(1 for d in cautious_decisions if d[1] == "wait")
        bold_waits = sum(1 for d in bold_decisions if d[1] == "wait")

        # Neither agent should rest (no stress signal without AgentPhysics)
        cautious_moves = sum(1 for d in cautious_decisions if d[1] == "move")
        bold_moves = sum(1 for d in bold_decisions if d[1] == "move")

        # With no physics, the only difference is tick-based location cycling
        # Both should have similar move counts (no stress-induced divergence)
        self.assertAlmostEqual(cautious_moves, bold_moves, delta=5,
                               msg="Without AgentPhysics, agents should behave similarly")

    def test_energy_depletion_changes_behavior(self):
        """Agent starts exploring, runs out of energy, switches to observing."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()
        # Only one agent for simplicity
        del session.agents["bold"]

        source = StateAwareSource()
        ap = DefaultAgentPhysics()
        # Start with low energy to see the transition faster
        session.agents["cautious"].internal_state = {
            "energy": 0.4, "stress": 0.0, "momentum": 0.0, "last_action": "",
        }

        engine = Engine(
            session=session,
            decision_source=source,
            agent_physics=ap,
            hooks=NullHooks(),
        )

        for _ in range(20):
            self._run(engine.tick())

        decisions = [d for d in source.decision_log if d[0] == "cautious"]
        action_types = [d[1] for d in decisions]

        # Should have a mix of moves, observes, and waits
        # The key proof: behavior is NOT monotonic — it changes based on state
        unique_actions = set(action_types)
        self.assertTrue(len(unique_actions) >= 2,
                        f"Agent should show varied behavior, got: {unique_actions}")


if __name__ == "__main__":
    unittest.main()
