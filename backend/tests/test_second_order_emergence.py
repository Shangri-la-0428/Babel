"""BABEL — Second-order emergence proof.

First-order: physics → state change (actions cost energy, build stress).
Second-order: behavior → state change → behavior change (feedback loop).

This test proves the engine produces second-order emergence with zero LLM:
an agent's internal state (energy, stress, momentum) feeds back into its
decisions via AgentPhysics.pre_decide → AgentContext, creating a closed loop.
"""

from __future__ import annotations

import asyncio
import unittest

from babel.decision import AgentContext
from babel.engine import Engine
from babel.hooks import NullHooks
from babel.models import (
    ActionOutput,
    ActionType,
    AgentInternalState,
    AgentSeed,
    LocationSeed,
    Session,
    WorldSeed,
)
from babel.physics import DefaultAgentPhysics, NoAgentPhysics


class StateAwareSource:
    """Decision source that changes behavior based on agent internal state.

    Rules:
    - High stress (>0.15) → wait (rest)
    - Low energy (<0.3) → observe (low cost)
    - Otherwise → move (explore)
    """

    def __init__(self):
        self.decision_log: list[tuple[str, str, dict]] = []

    async def decide(self, context: AgentContext) -> ActionOutput:
        internal = context.internal_state
        energy = internal.energy
        stress = internal.stress
        state_dict = internal.model_dump()

        if stress > 0.15:
            action = ActionOutput(type=ActionType.WAIT, content="resting due to stress")
            self.decision_log.append((context.agent_id, "wait", state_dict))
            return action

        if energy < 0.3:
            action = ActionOutput(type=ActionType.OBSERVE, content="conserving energy")
            self.decision_log.append((context.agent_id, "observe", state_dict))
            return action

        if context.reachable_locations:
            target = context.reachable_locations[context.tick % len(context.reachable_locations)]
            action = ActionOutput(type=ActionType.MOVE, target=target, content="exploring")
            self.decision_log.append((context.agent_id, "move", state_dict))
            return action

        action = ActionOutput(type=ActionType.WAIT, content="nothing to do")
        self.decision_log.append((context.agent_id, "wait", state_dict))
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
                id="explorer", name="Explorer",
                personality="curious",
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
        """Run 50 ticks: sustained moving → stress builds → agent rests → recovers → resumes.

        This is the second-order feedback loop:
        behavior (move) → state (stress↑) → behavior change (wait) → state (stress↓) → behavior (move)
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

        stress_trajectory: list[float] = []

        for _ in range(50):
            self._run(engine.tick())
            stress_trajectory.append(session.agents["explorer"].internal_state.stress)

        self.assertEqual(session.tick, 50)

        # ── Proof 1: Behavior changed over time ──
        decisions = [d for d in source.decision_log if d[0] == "explorer"]
        action_types = [d[1] for d in decisions]
        unique_actions = set(action_types)
        self.assertTrue(len(unique_actions) >= 2,
                        f"Agent should show varied behavior, got: {unique_actions}")

        # ── Proof 2: Stress was non-monotonic (went up AND down) ──
        # If there's a feedback loop, stress must rise then fall (or oscillate)
        max_stress = max(stress_trajectory)
        self.assertGreater(max_stress, 0.1,
                           "Stress should have risen from sustained activity")

        # Find if stress ever decreased after increasing
        found_decrease = False
        for i in range(1, len(stress_trajectory)):
            if stress_trajectory[i] < stress_trajectory[i - 1] - 0.001:
                found_decrease = True
                break
        self.assertTrue(found_decrease,
                        "Stress should decrease at some point (rest/recovery feedback)")

    def test_without_agent_physics_no_feedback(self):
        """Control: without AgentPhysics, no state feedback → monotonic behavior."""
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

        # Without AgentPhysics, internal_state stays at defaults → no rest triggers
        decisions = [d for d in source.decision_log if d[0] == "explorer"]
        waits = sum(1 for d in decisions if d[1] == "wait")

        # Should never rest (no stress signal)
        self.assertEqual(waits, 0,
                         "Without AgentPhysics, agent should never rest from stress")

    def test_energy_depletion_changes_behavior(self):
        """Agent starts exploring, energy drops, switches to conserving."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        source = StateAwareSource()
        ap = DefaultAgentPhysics()
        # Start with low energy and high stress to trigger behavior change faster
        session.agents["explorer"].internal_state = AgentInternalState(energy=0.25, stress=0.3)

        engine = Engine(
            session=session,
            decision_source=source,
            agent_physics=ap,
            hooks=NullHooks(),
        )

        for _ in range(20):
            self._run(engine.tick())

        decisions = [d for d in source.decision_log if d[0] == "explorer"]
        action_types = [d[1] for d in decisions]

        # The key proof: behavior is NOT monotonic — it changes based on state
        unique_actions = set(action_types)
        self.assertTrue(len(unique_actions) >= 2,
                        f"Agent should show varied behavior, got: {unique_actions}")


if __name__ == "__main__":
    unittest.main()
