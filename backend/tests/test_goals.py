"""Tests for Phase 3: Goal System."""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from babel.models import (
    ActionType,
    AgentSeed,
    AgentState,
    AgentStatus,
    Event,
    GoalState,
    LocationSeed,
    Relation,
    Session,
    WorldSeed,
)


def _make_session() -> Session:
    ws = WorldSeed(
        name="test",
        description="A test world",
        rules=["rule1"],
        locations=[
            LocationSeed(name="plaza", connections=["market"]),
            LocationSeed(name="market", connections=["plaza"]),
        ],
        agents=[
            AgentSeed(
                id="a1", name="Alice",
                personality="brave",
                goals=["find the artifact", "protect the village"],
                location="plaza",
            ),
            AgentSeed(
                id="a2", name="Bob",
                personality="cautious",
                goals=["trade supplies"],
                location="market",
                inventory=["potion"],
            ),
        ],
    )
    session = Session(world_seed=ws, tick=10)
    session.init_agents()
    return session


def _make_event(
    agent_id="a1", agent_name="Alice", action_type="speak",
    result="", location="plaza", action=None, involved=None,
) -> Event:
    return Event(
        session_id="test",
        tick=10,
        agent_id=agent_id,
        agent_name=agent_name,
        action_type=action_type,
        action=action or {},
        result=result,
        location=location,
        involved_agents=involved or [agent_id],
    )


# ── GoalState Model Tests ──────────────────────────────


class TestGoalStateModel(unittest.TestCase):
    def test_default_values(self):
        g = GoalState(text="find treasure")
        self.assertEqual(g.text, "find treasure")
        self.assertEqual(g.status, "active")
        self.assertEqual(g.started_tick, 0)
        self.assertEqual(g.progress, 0.0)
        self.assertEqual(g.stall_count, 0)
        self.assertEqual(g.strategy, "")
        self.assertEqual(g.next_step, "")
        self.assertEqual(g.success_criteria, "")
        self.assertEqual(g.blockers, [])

    def test_custom_values(self):
        g = GoalState(
            text="build shelter", status="stalled",
            started_tick=5, progress=0.6, stall_count=3,
            strategy="gather dry wood first",
            next_step="inspect the ruined watchtower",
            success_criteria="have a weatherproof sleeping spot",
            blockers=["night is approaching"],
        )
        self.assertEqual(g.status, "stalled")
        self.assertEqual(g.progress, 0.6)
        self.assertEqual(g.stall_count, 3)
        self.assertEqual(g.strategy, "gather dry wood first")
        self.assertIn("night is approaching", g.blockers)

    def test_model_dump(self):
        g = GoalState(text="explore", started_tick=1, progress=0.3)
        d = g.model_dump()
        self.assertEqual(d["text"], "explore")
        self.assertEqual(d["progress"], 0.3)
        self.assertIn("status", d)


# ── AgentState.from_seed Tests ──────────────────────────


class TestFromSeedGoals(unittest.TestCase):
    def test_from_seed_with_goals_initializes_active_goal(self):
        seed = AgentSeed(
            id="a1", name="Alice",
            goals=["find artifact", "protect village"],
            location="plaza",
        )
        state = AgentState.from_seed(seed)
        self.assertIsNotNone(state.active_goal)
        self.assertEqual(state.active_goal.text, "find artifact")
        self.assertEqual(state.active_goal.status, "active")
        self.assertEqual(state.active_goal.started_tick, 0)

    def test_from_seed_without_goals_no_active_goal(self):
        seed = AgentSeed(id="a1", name="Alice", location="plaza")
        state = AgentState.from_seed(seed)
        self.assertIsNone(state.active_goal)

    def test_immediate_intent_default(self):
        seed = AgentSeed(id="a1", name="Alice", location="plaza")
        state = AgentState.from_seed(seed)
        self.assertEqual(state.immediate_intent, "")
        self.assertEqual(state.immediate_approach, "")
        self.assertEqual(state.immediate_next_step, "")
        self.assertEqual(state.last_outcome, "")


# ── _event_advances_goal Tests ──────────────────────────


class TestEventAdvancesGoal(unittest.TestCase):
    """Test the Engine._event_advances_goal method."""

    def setUp(self):
        from babel.engine import Engine
        self.session = _make_session()
        self.engine = Engine(self.session)

    def test_keyword_match_in_result(self):
        goal = GoalState(text="find the artifact")
        event = _make_event(result="Alice found the artifact in the cave")
        self.assertTrue(self.engine._event_advances_goal(event, goal))

    def test_no_keyword_match(self):
        goal = GoalState(text="find the artifact")
        event = _make_event(result="Alice waited patiently")
        self.assertFalse(self.engine._event_advances_goal(event, goal))

    def test_move_to_goal_location(self):
        goal = GoalState(text="go to the market")
        event = _make_event(
            action_type="move", location="market",
            result="Alice moved to market",
        )
        self.assertTrue(self.engine._event_advances_goal(event, goal))

    def test_trade_when_goal_mentions_trade(self):
        goal = GoalState(text="trade supplies with Bob")
        event = _make_event(
            action_type="trade",
            result="Alice traded with Bob",
            action={"type": "trade", "target": "a2"},
        )
        self.assertTrue(self.engine._event_advances_goal(event, goal))

    def test_speak_to_target_in_goal(self):
        goal = GoalState(text="talk to Bob about the plan")
        event = _make_event(
            action_type="speak",
            result="Alice spoke to Bob",
            action={"type": "speak", "target": "a2"},
        )
        self.assertTrue(self.engine._event_advances_goal(event, goal))

    def test_use_item_mentioned_in_goal(self):
        goal = GoalState(text="use the potion to heal")
        event = _make_event(
            action_type="use_item",
            result="Alice used the potion",
            action={"type": "use_item", "target": "potion"},
        )
        self.assertTrue(self.engine._event_advances_goal(event, goal))

    def test_no_result_returns_false(self):
        goal = GoalState(text="find artifact")
        event = _make_event(result="")
        self.assertFalse(self.engine._event_advances_goal(event, goal))

    def test_none_goal_returns_false(self):
        event = _make_event(result="something happened")
        self.assertFalse(self.engine._event_advances_goal(event, None))

    def test_chinese_trade_words(self):
        goal = GoalState(text="获取补给品")
        event = _make_event(
            action_type="trade",
            result="Alice 交易了补给品",
            action={"type": "trade", "target": "a2"},
        )
        self.assertTrue(self.engine._event_advances_goal(event, goal))


# ── _select_next_goal Tests ─────────────────────────────


class TestSelectNextGoal(unittest.TestCase):
    def setUp(self):
        from babel.engine import Engine
        self.session = _make_session()
        self.engine = Engine(self.session)

    def test_selects_next_in_list(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="find the artifact")
        next_goal = self.engine._select_next_goal(agent)
        self.assertIsNotNone(next_goal)
        self.assertEqual(next_goal.text, "protect the village")

    def test_wraps_around(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="protect the village")
        next_goal = self.engine._select_next_goal(agent)
        self.assertEqual(next_goal.text, "find the artifact")

    def test_no_goals_returns_none(self):
        agent = self.session.agents["a1"]
        agent.goals = []
        self.assertIsNone(self.engine._select_next_goal(agent))

    def test_current_not_in_list_defaults_to_first(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="something else entirely")
        next_goal = self.engine._select_next_goal(agent)
        self.assertEqual(next_goal.text, "find the artifact")

    def test_single_goal_returns_same(self):
        agent = self.session.agents["a2"]  # Bob has 1 goal
        agent.active_goal = GoalState(text="trade supplies")
        next_goal = self.engine._select_next_goal(agent)
        self.assertEqual(next_goal.text, "trade supplies")


# ── _update_goals Tests ─────────────────────────────────


class TestUpdateGoals(unittest.TestCase):
    def setUp(self):
        from babel.engine import Engine
        self.session = _make_session()
        self.engine = Engine(self.session)

    def test_progress_increases_on_advancing_event(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="find the artifact")
        event = _make_event(result="Alice found the artifact nearby")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        self.assertAlmostEqual(agent.active_goal.progress, 0.22)
        self.assertEqual(agent.active_goal.stall_count, 0)
        self.assertEqual(agent.active_goal.last_progress_reason, "Alice found the artifact nearby")

    def test_stall_count_increases_on_non_advancing_event(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="find the artifact")
        event = _make_event(result="Alice waited around doing nothing")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        self.assertEqual(agent.active_goal.progress, 0.0)
        self.assertEqual(agent.active_goal.stall_count, 1)

    def test_goal_completed_at_95_percent(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="find the artifact", progress=0.90)
        event = _make_event(result="Alice found the artifact in the ruins")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        # Should have switched to next goal
        self.assertIsNotNone(agent.active_goal)
        self.assertEqual(agent.active_goal.text, "protect the village")
        self.assertEqual(agent.active_goal.status, "active")

    @patch("babel.engine.retrieve_relevant_memories", new_callable=AsyncMock, return_value=[])
    @patch("babel.engine.replan_goal", new_callable=AsyncMock)
    def test_stall_triggers_replan(self, mock_replan, _mock_mem):
        mock_replan.return_value = {
            "text": "search the eastern cave for clues",
            "strategy": "follow the smugglers' trail",
            "next_step": "question the sentry at the cave mouth",
            "success_criteria": "find evidence that narrows the artifact's location",
            "blockers": ["the sentry does not trust Alice"],
        }
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(
            text="find the artifact", stall_count=7,
        )
        event = _make_event(result="Alice waited")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        mock_replan.assert_called_once()
        self.assertEqual(agent.active_goal.text, "search the eastern cave for clues")
        self.assertEqual(agent.active_goal.strategy, "follow the smugglers' trail")
        self.assertEqual(agent.active_goal.next_step, "question the sentry at the cave mouth")
        self.assertEqual(agent.active_goal.status, "active")

    @patch("babel.engine.retrieve_relevant_memories", new_callable=AsyncMock, return_value=[])
    @patch("babel.engine.replan_goal", new_callable=AsyncMock)
    def test_stall_replan_failure_selects_next(self, mock_replan, _mock_mem):
        mock_replan.side_effect = Exception("LLM error")
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(
            text="find the artifact", stall_count=7,
        )
        event = _make_event(result="Alice waited")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        # Should fall back to next core goal
        self.assertEqual(agent.active_goal.text, "protect the village")

    def test_no_active_goal_does_nothing(self):
        agent = self.session.agents["a1"]
        agent.active_goal = None
        event = _make_event(result="something happened")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        self.assertIsNone(agent.active_goal)

    def test_completed_goal_skipped(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(
            text="old goal", status="completed",
        )
        event = _make_event(result="old goal related event")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        # Should not change
        self.assertEqual(agent.active_goal.status, "completed")

    def test_progress_capped_at_1(self):
        agent = self.session.agents["a1"]
        agent.active_goal = GoalState(text="find the artifact", progress=0.93)
        # 0.93 + 0.15 = 1.08, should cap at 1.0, and >= 0.95 → completed
        event = _make_event(result="Alice discovered the artifact")
        asyncio.get_event_loop().run_until_complete(
            self.engine._update_goals(agent, event)
        )
        # Goal should be completed and switched
        self.assertEqual(agent.active_goal.text, "protect the village")


# ── Prompt Integration Tests ────────────────────────────


class TestGoalPromptIntegration(unittest.TestCase):
    def test_active_goal_rendered_in_prompt(self):
        from babel.prompts import build_user_prompt

        prompt = build_user_prompt(
            world_rules=["rule1"],
            agent_name="Alice",
            agent_personality="brave",
            agent_goals=["find artifact", "protect village"],
            agent_location="plaza",
            agent_inventory=[],
            agent_memory=[],
            tick=10,
            visible_agents=[],
            recent_events=[],
            available_locations=["plaza", "market"],
            active_goal={
                "text": "find artifact",
                "progress": 0.3,
                "status": "active",
                "stall_count": 0,
                "started_tick": 1,
                "strategy": "ask around before moving",
                "next_step": "speak to Bob first",
                "success_criteria": "learn where the artifact was seen last",
                "blockers": ["Bob is hiding something"],
            },
        )
        self.assertIn("Core Goals:", prompt)
        self.assertIn("Active Goal (your current focus):", prompt)
        self.assertIn('"find artifact"', prompt)
        self.assertIn("progress: 30%", prompt)
        self.assertIn("Current strategy: ask around before moving", prompt)
        self.assertIn("Next step to make progress: speak to Bob first", prompt)
        self.assertIn("Success looks like: learn where the artifact was seen last", prompt)
        self.assertIn("advance your active goal", prompt)

    def test_stalled_goal_shows_stall_info(self):
        from babel.prompts import build_user_prompt

        prompt = build_user_prompt(
            world_rules=["rule1"],
            agent_name="Alice",
            agent_personality="brave",
            agent_goals=["find artifact"],
            agent_location="plaza",
            agent_inventory=[],
            agent_memory=[],
            tick=10,
            visible_agents=[],
            recent_events=[],
            available_locations=["plaza"],
            active_goal={
                "text": "find artifact",
                "progress": 0.15,
                "status": "active",
                "stall_count": 3,
                "started_tick": 1,
            },
        )
        self.assertIn("stalled 3 ticks", prompt)

    def test_no_active_goal_shows_regular_goals(self):
        from babel.prompts import build_user_prompt

        prompt = build_user_prompt(
            world_rules=["rule1"],
            agent_name="Alice",
            agent_personality="brave",
            agent_goals=["find artifact"],
            agent_location="plaza",
            agent_inventory=[],
            agent_memory=[],
            tick=10,
            visible_agents=[],
            recent_events=[],
            available_locations=["plaza"],
        )
        self.assertIn("Goals:", prompt)
        self.assertNotIn("Core Goals:", prompt)
        self.assertNotIn("Active Goal", prompt)
        self.assertNotIn("advance your active goal", prompt)

    def test_ongoing_intent_rendered_in_prompt(self):
        from babel.prompts import build_user_prompt

        prompt = build_user_prompt(
            world_rules=["rule1"],
            agent_name="Alice",
            agent_personality="brave",
            agent_goals=["find artifact"],
            agent_location="plaza",
            agent_inventory=[],
            agent_memory=[],
            tick=10,
            visible_agents=[],
            recent_events=[],
            available_locations=["plaza"],
            ongoing_intent={
                "objective": "win Bob's trust",
                "approach": "offer useful information first",
                "next_step": "start a careful conversation",
            },
            last_outcome="Alice noticed Bob hesitating near the market gate.",
        )
        self.assertIn("[Your Ongoing Intent]", prompt)
        self.assertIn("win Bob's trust", prompt)
        self.assertIn("offer useful information first", prompt)
        self.assertIn("start a careful conversation", prompt)
        self.assertIn("[What Happened Last Time]", prompt)


# ── Engine Init Goal Test ───────────────────────────────


class TestEngineInitGoal(unittest.TestCase):
    """Test that engine auto-initializes active_goal if missing."""

    def test_init_agents_sets_active_goal(self):
        session = _make_session()
        alice = session.agents["a1"]
        # from_seed already sets it
        self.assertIsNotNone(alice.active_goal)
        self.assertEqual(alice.active_goal.text, "find the artifact")

    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.engine.retrieve_relevant_memories", new_callable=AsyncMock)
    @patch("babel.engine.get_relevant_events", new_callable=AsyncMock)
    @patch("babel.engine.get_agent_beliefs", new_callable=AsyncMock)
    def test_resolve_initializes_missing_active_goal(
        self, mock_beliefs, mock_events, mock_memories,
        mock_save_memory,
    ):
        from babel.engine import Engine
        from babel.decision import ScriptedDecisionSource
        from babel.models import ActionOutput

        session = _make_session()
        # Use ScriptedDecisionSource (no LLM needed)
        src = ScriptedDecisionSource(actions=[
            ActionOutput(type=ActionType.WAIT, content="waiting"),
        ])
        engine = Engine(session, decision_source=src)
        alice = session.agents["a1"]
        alice.active_goal = None  # simulate loaded session without goal

        mock_memories.return_value = []
        mock_events.return_value = []
        mock_beliefs.return_value = []

        asyncio.get_event_loop().run_until_complete(
            engine._resolve_agent_action(alice)
        )
        # active_goal should have been initialized
        self.assertIsNotNone(alice.active_goal)
        self.assertEqual(alice.active_goal.text, "find the artifact")


if __name__ == "__main__":
    unittest.main()
