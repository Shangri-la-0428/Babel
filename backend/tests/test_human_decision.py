"""BABEL — HumanDecisionSource tests.

Tests the human control flow: take control, submit actions, release control,
timeout behavior, and fallback delegation.
"""

import asyncio
import unittest

from babel.decision import (
    AgentContext,
    ContextAwareDecisionSource,
    DecisionSource,
    HumanDecisionSource,
    LLMDecisionSource,
    ScriptedDecisionSource,
)
from babel.models import ActionOutput, ActionType


def _make_context(agent_id: str = "test_agent", location: str = "plaza") -> AgentContext:
    return AgentContext(
        agent_id=agent_id,
        agent_name="Tester",
        agent_location=location,
        agent_inventory=["sword"],
        visible_agents=[
            {"id": "npc1", "name": "NPC", "location": location},
        ],
        reachable_locations=["market", "plaza"],
        available_locations=["plaza", "market", "dungeon"],
    )


class TestHumanDecisionSourceProtocol(unittest.TestCase):
    """HumanDecisionSource satisfies the DecisionSource protocol."""

    def test_is_decision_source(self):
        src = HumanDecisionSource()
        self.assertIsInstance(src, DecisionSource)

    def test_has_fallback(self):
        fallback = ScriptedDecisionSource()
        src = HumanDecisionSource(fallback=fallback)
        self.assertIs(src._fallback, fallback)


class TestHumanControlManagement(unittest.TestCase):
    """Take/release control and status tracking."""

    def test_take_control(self):
        src = HumanDecisionSource()
        src.take_control("agent_1")
        self.assertIn("agent_1", src.human_agents)

    def test_release_control(self):
        src = HumanDecisionSource()
        src.take_control("agent_1")
        src.release_control("agent_1")
        self.assertNotIn("agent_1", src.human_agents)

    def test_release_nonexistent_is_safe(self):
        src = HumanDecisionSource()
        src.release_control("nobody")  # Should not raise

    def test_human_agents_returns_copy(self):
        src = HumanDecisionSource()
        src.take_control("agent_1")
        agents = src.human_agents
        agents.add("agent_2")
        self.assertNotIn("agent_2", src.human_agents)

    def test_not_waiting_initially(self):
        src = HumanDecisionSource()
        src.take_control("agent_1")
        self.assertFalse(src.is_waiting("agent_1"))


class TestHumanDecisionDelegation(unittest.TestCase):
    """Non-human agents delegate to fallback."""

    def test_non_human_delegates_to_fallback(self):
        fallback = ScriptedDecisionSource(actions=[
            ActionOutput(type=ActionType.OBSERVE, content="looking around"),
        ])
        src = HumanDecisionSource(fallback=fallback)
        # agent_1 is NOT human-controlled
        ctx = _make_context("agent_1")
        result = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        self.assertEqual(result.type, ActionType.OBSERVE)

    def test_no_fallback_returns_wait(self):
        src = HumanDecisionSource(fallback=None)
        ctx = _make_context("agent_1")
        result = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        self.assertEqual(result.type, ActionType.WAIT)


class TestHumanDecisionSubmit(unittest.TestCase):
    """Submitting actions for human-controlled agents."""

    def test_submit_action_accepted(self):
        src = HumanDecisionSource(timeout=5.0)
        src.take_control("agent_1")
        ctx = _make_context("agent_1")

        async def run():
            # Start the decide coroutine (will block waiting for input)
            decide_task = asyncio.create_task(src.decide(ctx))

            # Give it a moment to start waiting
            await asyncio.sleep(0.05)

            # Should be waiting now
            assert src.is_waiting("agent_1")

            # Context should be available
            pending_ctx = src.get_pending_context("agent_1")
            assert pending_ctx is not None
            assert pending_ctx.agent_id == "agent_1"

            # Submit the action
            action = ActionOutput(type=ActionType.SPEAK, target="npc1", content="hello")
            accepted = src.submit_action("agent_1", action)
            assert accepted

            # Get the result
            result = await decide_task
            assert result.type == ActionType.SPEAK
            assert result.target == "npc1"
            assert result.content == "hello"

        asyncio.get_event_loop().run_until_complete(run())

    def test_submit_to_non_waiting_agent_rejected(self):
        src = HumanDecisionSource()
        src.take_control("agent_1")
        action = ActionOutput(type=ActionType.OBSERVE, content="look")
        self.assertFalse(src.submit_action("agent_1", action))

    def test_submit_to_unknown_agent_rejected(self):
        src = HumanDecisionSource()
        action = ActionOutput(type=ActionType.OBSERVE, content="look")
        self.assertFalse(src.submit_action("nobody", action))


class TestHumanDecisionTimeout(unittest.TestCase):
    """Timeout behavior when human doesn't respond."""

    def test_timeout_returns_wait(self):
        src = HumanDecisionSource(timeout=0.1)
        src.take_control("agent_1")
        ctx = _make_context("agent_1")

        result = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        self.assertEqual(result.type, ActionType.WAIT)
        self.assertIn("human", result.content.lower())

    def test_release_cancels_pending(self):
        src = HumanDecisionSource(timeout=5.0)
        src.take_control("agent_1")
        ctx = _make_context("agent_1")

        async def run():
            decide_task = asyncio.create_task(src.decide(ctx))
            await asyncio.sleep(0.05)
            assert src.is_waiting("agent_1")

            # Release control while waiting
            src.release_control("agent_1")

            result = await decide_task
            # Should return wait action due to cancel
            assert result.type == ActionType.WAIT

        asyncio.get_event_loop().run_until_complete(run())


class TestHumanDecisionCallback(unittest.TestCase):
    """on_waiting callback is invoked when human agent starts waiting."""

    def test_on_waiting_called(self):
        calls = []

        async def on_waiting(agent_id, context):
            calls.append((agent_id, context.agent_name))

        src = HumanDecisionSource(timeout=0.1, on_waiting=on_waiting)
        src.take_control("agent_1")
        ctx = _make_context("agent_1")

        asyncio.get_event_loop().run_until_complete(src.decide(ctx))

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], ("agent_1", "Tester"))

    def test_on_waiting_not_called_for_non_human(self):
        calls = []

        async def on_waiting(agent_id, context):
            calls.append(agent_id)

        fallback = ScriptedDecisionSource()
        src = HumanDecisionSource(fallback=fallback, on_waiting=on_waiting)
        ctx = _make_context("agent_1")

        asyncio.get_event_loop().run_until_complete(src.decide(ctx))

        self.assertEqual(len(calls), 0)


class TestHumanDecisionWithEngine(unittest.TestCase):
    """Integration: HumanDecisionSource works as engine decision source."""

    def test_engine_accepts_human_source(self):
        from babel.engine import Engine
        from babel.models import Session, WorldSeed

        ws = WorldSeed(
            name="test", description="test world",
            locations=[{"name": "plaza", "description": "a plaza"}],
            agents=[{
                "id": "a1", "name": "Alice",
                "location": "plaza", "personality": "kind",
            }],
        )
        session = Session(world_seed=ws)
        session.init_agents()

        src = HumanDecisionSource(
            fallback=ScriptedDecisionSource(),
        )
        engine = Engine(session=session, decision_source=src)
        self.assertIsInstance(engine.decision_source, HumanDecisionSource)


if __name__ == "__main__":
    unittest.main()
