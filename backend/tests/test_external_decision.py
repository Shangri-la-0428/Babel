"""BABEL — ExternalDecisionSource tests.

Tests the SDK agent gateway: connect, perceive/act turn cycle,
timeout, disconnect, fallback delegation.
"""

import asyncio
import unittest

from babel.decision import (
    AgentContext,
    DecisionSource,
    ExternalDecisionSource,
    ScriptedDecisionSource,
)
from babel.models import ActionOutput, ActionType


def _ctx(agent_id: str = "ext_agent", location: str = "plaza") -> AgentContext:
    return AgentContext(
        agent_id=agent_id,
        agent_name="ExternalBot",
        agent_location=location,
        agent_inventory=["map"],
        visible_agents=[{"id": "npc1", "name": "NPC", "location": location}],
        reachable_locations=["market", "plaza"],
        available_locations=["plaza", "market"],
    )


class TestExternalProtocol(unittest.TestCase):
    """ExternalDecisionSource satisfies DecisionSource."""

    def test_is_decision_source(self):
        src = ExternalDecisionSource()
        self.assertIsInstance(src, DecisionSource)


class TestConnectDisconnect(unittest.TestCase):

    def test_connect(self):
        src = ExternalDecisionSource()
        src.connect("a1")
        self.assertIn("a1", src.external_agents)

    def test_disconnect(self):
        src = ExternalDecisionSource()
        src.connect("a1")
        src.disconnect("a1")
        self.assertNotIn("a1", src.external_agents)

    def test_disconnect_nonexistent_safe(self):
        src = ExternalDecisionSource()
        src.disconnect("nobody")

    def test_external_agents_returns_copy(self):
        src = ExternalDecisionSource()
        src.connect("a1")
        agents = src.external_agents
        agents.add("a2")
        self.assertNotIn("a2", src.external_agents)


class TestFallback(unittest.TestCase):

    def test_non_external_delegates_to_fallback(self):
        fallback = ScriptedDecisionSource(actions=[
            ActionOutput(type=ActionType.OBSERVE, content="looking"),
        ])
        src = ExternalDecisionSource(fallback=fallback)
        ctx = _ctx("not_connected")
        result = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        self.assertEqual(result.type, ActionType.OBSERVE)

    def test_no_fallback_returns_wait(self):
        src = ExternalDecisionSource(fallback=None)
        ctx = _ctx("not_connected")
        result = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        self.assertEqual(result.type, ActionType.WAIT)


class TestTurnCycle(unittest.TestCase):
    """The core: decide blocks, perceive returns context, act resolves."""

    def test_full_turn(self):
        src = ExternalDecisionSource(timeout=5.0)
        src.connect("a1")
        ctx = _ctx("a1")

        async def run():
            # Engine starts the turn
            decide_task = asyncio.create_task(src.decide(ctx))
            await asyncio.sleep(0.05)

            # External agent perceives
            perceived = await src.perceive("a1")
            self.assertIsNotNone(perceived)
            self.assertEqual(perceived.agent_id, "a1")
            self.assertEqual(perceived.agent_name, "ExternalBot")

            # External agent acts
            action = ActionOutput(type=ActionType.MOVE, target="market", content="heading out")
            accepted = src.act("a1", action)
            self.assertTrue(accepted)

            # Engine gets the result
            result = await decide_task
            self.assertEqual(result.type, ActionType.MOVE)
            self.assertEqual(result.target, "market")

        asyncio.get_event_loop().run_until_complete(run())

    def test_perceive_waits_for_turn(self):
        """perceive() long-polls until decide() is called."""
        src = ExternalDecisionSource(timeout=5.0)
        src.connect("a1")
        ctx = _ctx("a1")

        async def run():
            # Agent starts perceiving BEFORE engine starts the turn
            perceive_task = asyncio.create_task(src.perceive("a1", timeout=5.0))
            await asyncio.sleep(0.05)

            # Engine starts the turn — should unblock perceive
            decide_task = asyncio.create_task(src.decide(ctx))
            await asyncio.sleep(0.05)

            perceived = await perceive_task
            self.assertIsNotNone(perceived)
            self.assertEqual(perceived.agent_id, "a1")

            # Complete the turn
            src.act("a1", ActionOutput(type=ActionType.WAIT, content="done"))
            await decide_task

        asyncio.get_event_loop().run_until_complete(run())

    def test_perceive_returns_none_on_timeout(self):
        src = ExternalDecisionSource()
        src.connect("a1")

        async def run():
            result = await src.perceive("a1", timeout=0.1)
            self.assertIsNone(result)

        asyncio.get_event_loop().run_until_complete(run())

    def test_act_without_turn_rejected(self):
        src = ExternalDecisionSource()
        src.connect("a1")
        action = ActionOutput(type=ActionType.OBSERVE, content="look")
        self.assertFalse(src.act("a1", action))


class TestTimeout(unittest.TestCase):

    def test_decide_timeout_returns_wait(self):
        src = ExternalDecisionSource(timeout=0.1)
        src.connect("a1")
        ctx = _ctx("a1")
        result = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        self.assertEqual(result.type, ActionType.WAIT)
        self.assertIn("timeout", result.content.lower())

    def test_disconnect_cancels_pending_turn(self):
        src = ExternalDecisionSource(timeout=5.0)
        src.connect("a1")
        ctx = _ctx("a1")

        async def run():
            decide_task = asyncio.create_task(src.decide(ctx))
            await asyncio.sleep(0.05)

            src.disconnect("a1")
            result = await decide_task
            self.assertEqual(result.type, ActionType.WAIT)

        asyncio.get_event_loop().run_until_complete(run())


class TestWithEngine(unittest.TestCase):
    """Integration: ExternalDecisionSource works as engine decision source."""

    def test_engine_accepts_external_source(self):
        from babel.engine import Engine
        from babel.models import Session, WorldSeed

        ws = WorldSeed(
            name="test", description="test world",
            locations=[{"name": "plaza", "description": "a plaza"}],
            agents=[{
                "id": "a1", "name": "Bot",
                "location": "plaza", "personality": "curious",
            }],
        )
        session = Session(world_seed=ws)
        session.init_agents()

        src = ExternalDecisionSource(fallback=ScriptedDecisionSource())
        engine = Engine(session=session, decision_source=src)
        self.assertIsInstance(engine.decision_source, ExternalDecisionSource)


if __name__ == "__main__":
    unittest.main()
