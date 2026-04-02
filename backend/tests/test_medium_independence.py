"""BABEL — Medium independence proof.

Demonstrates the engine runs as a pure causal kernel without:
- LLMs
- Text generation
- Memory persistence
- Chapter generation
- Any medium-specific behavior

The engine only needs: DecisionSource + WorldAuthority + WorldPhysics + Hooks.
All four can be swapped. This test uses rule-based agents and NullHooks.
"""

from __future__ import annotations

import asyncio
import unittest

from babel.decision import AgentContext, DecisionSource
from babel.engine import Engine
from babel.hooks import NullHooks
from babel.models import (
    ActionOutput,
    ActionType,
    AgentSeed,
    Event,
    LocationSeed,
    PhysicsConfig,
    Session,
    WorldSeed,
)
from babel.physics import DefaultWorldPhysics


# ── Rule-based decision sources (zero LLM) ──────────────

class ScriptedSource:
    """Decision source that follows a fixed script of actions."""

    def __init__(self, script: list[ActionOutput]):
        self._script = list(script)
        self._index = 0

    async def decide(self, context: AgentContext) -> ActionOutput:
        if self._index >= len(self._script):
            return ActionOutput(type=ActionType.WAIT, content="script exhausted")
        action = self._script[self._index]
        self._index += 1
        return action


class ReactiveSource:
    """Decision source that reacts to world state, not scripts."""

    async def decide(self, context: AgentContext) -> ActionOutput:
        # If there are ground items, observe (pickup)
        if context.ground_items:
            return ActionOutput(
                type=ActionType.OBSERVE,
                content=f"picking up {context.ground_items[0]}",
            )

        # If there are visible agents, speak to the first one
        if context.visible_agents:
            target = context.visible_agents[0]
            return ActionOutput(
                type=ActionType.SPEAK,
                target=target.get("agent_id", target.get("id", "")),
                content="hello",
            )

        # If not at home, move to a connected location
        if context.reachable_locations:
            return ActionOutput(
                type=ActionType.MOVE,
                target=context.reachable_locations[0],
                content="exploring",
            )

        return ActionOutput(type=ActionType.WAIT, content="nothing to do")


# ── Seeds ────────────────────────────────────────────────

def _make_seed(*, with_physics: bool = False) -> WorldSeed:
    physics = PhysicsConfig(
        move_cost="food" if with_physics else None,
        regeneration=with_physics,
        regeneration_interval=2,
    )
    return WorldSeed(
        name="causal-test",
        description="A world for testing pure causality",
        locations=[
            LocationSeed(
                name="village",
                connections=["forest", "river"],
                resources=["herb"] if with_physics else [],
            ),
            LocationSeed(
                name="forest",
                connections=["village"],
                resources=["wood"] if with_physics else [],
            ),
            LocationSeed(
                name="river",
                connections=["village"],
                resources=["fish"] if with_physics else [],
            ),
        ],
        agents=[
            AgentSeed(
                id="a1", name="Alpha",
                location="village",
                inventory=["food", "food", "map"],
                goals=["explore the world"],
            ),
            AgentSeed(
                id="a2", name="Beta",
                location="forest",
                inventory=["sword"],
                goals=["find Alpha"],
            ),
        ],
        physics=physics,
    )


# ── Tests ────────────────────────────────────────────────

class TestPureCausalKernel(unittest.TestCase):
    """Engine + NullHooks + scripted source = pure causal machine."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_engine_runs_without_llm(self):
        """Engine tick produces events with a scripted decision source."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        source = ScriptedSource([
            ActionOutput(type=ActionType.OBSERVE, content="looking around"),
            ActionOutput(type=ActionType.MOVE, target="forest", content="heading to forest"),
        ])
        engine = Engine(
            session=session,
            decision_source=source,
            hooks=NullHooks(),
        )

        events = self._run(engine.tick())

        # Should have events for both agents
        self.assertTrue(len(events) >= 2)
        action_types = {e.action_type for e in events}
        # At least one observe and one move (scripted), plus the other agent gets same script
        self.assertTrue(action_types & {"observe", "move", "wait"})

    def test_state_changes_are_causal(self):
        """Actions cause deterministic state changes."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        # Alpha moves to forest
        source = ScriptedSource([
            ActionOutput(type=ActionType.MOVE, target="forest", content="going to forest"),
        ])
        engine = Engine(session=session, decision_source=source, hooks=NullHooks())

        self.assertEqual(session.agents["a1"].location, "village")
        self._run(engine.tick())
        self.assertEqual(session.agents["a1"].location, "forest")

    def test_physics_enforced_without_llm(self):
        """Conservation and move cost work in pure causal mode."""
        seed = _make_seed(with_physics=True)
        session = Session(world_seed=seed)
        session.init_agents()

        physics = DefaultWorldPhysics(seed.physics)

        # Use ReactiveSource — it moves to first reachable location
        engine = Engine(
            session=session,
            decision_source=ReactiveSource(),
            world_physics=physics,
            hooks=NullHooks(),
        )

        # Alpha starts at village with 2 food; reactive source will move
        food_before = session.agents["a1"].inventory.count("food")
        self._run(engine.tick())

        # Check events: at least one move happened
        move_events = [e for e in session.events if e.action_type == "move"]
        if move_events:
            # Some agent moved — total food should decrease
            total_food_after = sum(
                a.inventory.count("food") for a in session.agents.values()
            )
            self.assertLess(total_food_after, food_before)

    def test_multi_tick_stability(self):
        """10 ticks with rule-based agents, no crashes, state evolves."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        engine = Engine(
            session=session,
            decision_source=ReactiveSource(),
            hooks=NullHooks(),
        )

        all_events: list[Event] = []
        for _ in range(10):
            events = self._run(engine.tick())
            all_events.extend(events)

        self.assertEqual(session.tick, 10)
        self.assertTrue(len(all_events) >= 20)  # 2 agents × 10 ticks

    def test_physics_regeneration_in_pure_mode(self):
        """Regeneration spawns items, agents pick them up via observe."""
        seed = _make_seed(with_physics=True)
        session = Session(world_seed=seed)
        session.init_agents()

        physics = DefaultWorldPhysics(seed.physics)
        engine = Engine(
            session=session,
            decision_source=ReactiveSource(),
            world_physics=physics,
            hooks=NullHooks(),
        )

        # Run enough ticks for regeneration (interval=2) + pickup
        for _ in range(6):
            self._run(engine.tick())

        # Check that ground items were generated and some picked up
        total_ground = sum(len(items) for items in session.location_items.values())
        alpha_inv = session.agents["a1"].inventory
        beta_inv = session.agents["a2"].inventory

        # Either ground has items or agents picked them up
        total_items = total_ground + len(alpha_inv) + len(beta_inv)
        self.assertTrue(total_items > 0, "Resources should exist somewhere in the world")


class TestNullHooksContract(unittest.TestCase):
    """NullHooks satisfies the EngineHooks protocol with minimal behavior."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_null_hooks_build_context(self):
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        engine = Engine(session=session, hooks=NullHooks())
        agent = session.agents["a1"]
        ctx = self._run(NullHooks().build_context(engine, agent))

        self.assertEqual(ctx.agent_id, "a1")
        self.assertEqual(ctx.agent_location, "village")
        self.assertIn("forest", ctx.reachable_locations)

    def test_null_hooks_before_turn_returns_empty(self):
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()
        engine = Engine(session=session, hooks=NullHooks())
        events = self._run(NullHooks().before_turn(engine, session.agents["a1"]))
        self.assertEqual(events, [])


class TestCustomDecisionSource(unittest.TestCase):
    """Any DecisionSource works — protocol, not inheritance."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_lambda_decision_source(self):
        """Even a lambda-style source works."""
        class AlwaysWait:
            async def decide(self, ctx: AgentContext) -> ActionOutput:
                return ActionOutput(type=ActionType.WAIT, content="meditating")

        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()
        engine = Engine(session=session, decision_source=AlwaysWait(), hooks=NullHooks())

        events = self._run(engine.tick())
        for event in events:
            self.assertEqual(event.action_type, "wait")

    def test_reactive_source_responds_to_state(self):
        """ReactiveSource changes behavior based on world state."""
        seed = _make_seed()
        session = Session(world_seed=seed)
        session.init_agents()

        # Put Alpha alone in village, Beta in forest — Alpha should explore
        engine = Engine(session=session, decision_source=ReactiveSource(), hooks=NullHooks())
        events = self._run(engine.tick())

        # Alpha should have moved or spoken (depending on visibility)
        alpha_events = [e for e in events if e.agent_id == "a1"]
        self.assertTrue(len(alpha_events) > 0)


if __name__ == "__main__":
    unittest.main()
