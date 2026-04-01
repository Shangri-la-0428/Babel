"""Tests for Phase 4: World Kernel Protocol.

Covers:
- DecisionSource interface and implementations (LLMDecisionSource, ScriptedDecisionSource)
- AgentContext construction
- Event.structured field generation
- MemoryEntry.semantic derivation
- ScriptedDecisionSource runs 10 ticks without LLM
"""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from unittest.mock import AsyncMock, patch, MagicMock
from pathlib import Path

import pytest

import babel.db as db_module
from babel.decision import (
    ActionCritic,
    AgentContext,
    DecisionSource,
    LLMDecisionSource,
    ScriptedDecisionSource,
)
from babel.memory import _derive_semantic
from babel.models import (
    ActionOutput,
    ActionType,
    AgentSeed,
    AgentState,
    AgentStatus,
    Event,
    GoalState,
    LLMResponse,
    LocationSeed,
    MemoryEntry,
    Relation,
    Session,
    StateChanges,
    WorldSeed,
)
from babel.validator import apply_action, _build_structured


# ── Test DB Isolation ─────────────────────────────────


@pytest.fixture(autouse=True)
def isolated_db():
    """Run world-kernel tests against a pristine temp DB, not the developer's local babel.db."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "test.db"
        original = db_module.DB_PATH
        db_module.DB_PATH = path
        setup_loop = asyncio.new_event_loop()
        setup_loop.run_until_complete(db_module.init_db(path))
        setup_loop.close()
        test_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(test_loop)
        try:
            yield path
        finally:
            test_loop.close()
            asyncio.set_event_loop(None)
            db_module.DB_PATH = original


# ── Fixtures ──────────────────────────────────────────


def _make_session() -> Session:
    ws = WorldSeed(
        name="test",
        description="A test world",
        rules=["rule1", "rule2"],
        locations=[
            LocationSeed(name="plaza", connections=["market", "dock"]),
            LocationSeed(name="market", connections=["plaza"]),
            LocationSeed(name="dock", connections=["plaza"]),
        ],
        agents=[
            AgentSeed(
                id="a1", name="Alice",
                personality="brave",
                goals=["find the artifact", "protect the village"],
                location="plaza",
                inventory=["sword", "potion"],
            ),
            AgentSeed(
                id="a2", name="Bob",
                personality="cautious",
                goals=["trade supplies"],
                location="plaza",
                inventory=["shield", "gold"],
            ),
            AgentSeed(
                id="a3", name="Carol",
                personality="curious",
                goals=["explore"],
                location="market",
            ),
        ],
    )
    session = Session(world_seed=ws, tick=5)
    session.init_agents()
    return session


def _make_event(
    agent_id="a1", agent_name="Alice", action_type="speak",
    result="Alice said hello", tick=5, structured=None,
    location="plaza", action=None,
) -> Event:
    return Event(
        session_id="test",
        tick=tick,
        agent_id=agent_id,
        agent_name=agent_name,
        action_type=action_type,
        action=action or {},
        result=result,
        structured=structured or {},
        location=location,
        involved_agents=[agent_id],
    )


# ── Tests: AgentContext ──────────────────────────────


class TestAgentContext(unittest.TestCase):
    def test_create_context(self):
        ctx = AgentContext(
            agent_id="a1",
            agent_name="Alice",
            agent_location="plaza",
            tick=10,
        )
        assert ctx.agent_id == "a1"
        assert ctx.tick == 10
        assert ctx.memories == []
        assert ctx.beliefs == []

    def test_context_with_all_fields(self):
        ctx = AgentContext(
            agent_id="a1",
            agent_name="Alice",
            agent_personality="brave",
            agent_goals=["find artifact"],
            agent_location="plaza",
            agent_inventory=["sword"],
            visible_agents=[{"id": "a2", "name": "Bob", "location": "plaza"}],
            memories=[{"content": "something happened"}],
            beliefs=["Bob is dangerous"],
            relations=[{"name": "Bob", "type": "rival", "strength": 0.3}],
            reachable_locations=["market"],
            available_locations=["plaza", "market"],
            recent_events=["[Tick 4] Bob waited"],
            world_rules=["no killing"],
            world_time={"display": "Day 1, 10:00", "period": "morning"},
            active_goal={"text": "find artifact", "progress": 0.3},
            tick=10,
        )
        assert len(ctx.visible_agents) == 1
        assert len(ctx.memories) == 1
        assert ctx.world_time["display"] == "Day 1, 10:00"


# ── Tests: DecisionSource Protocol ──────────────────


class TestDecisionSourceProtocol(unittest.TestCase):
    def test_scripted_is_decision_source(self):
        src = ScriptedDecisionSource()
        assert isinstance(src, DecisionSource)

    def test_llm_is_decision_source(self):
        src = LLMDecisionSource()
        assert isinstance(src, DecisionSource)

    @patch("babel.llm.get_agent_action", new_callable=AsyncMock)
    def test_llm_preserves_intent_metadata(self, mock_get_agent_action):
        src = LLMDecisionSource()
        mock_get_agent_action.return_value = LLMResponse(
            thinking="keep pressing Bob",
            intent={
                "objective": "earn Bob's trust",
                "approach": "share useful intel",
                "next_step": "start a cautious conversation",
                "rationale": "he looks uncertain right now",
            },
            action=ActionOutput(type=ActionType.SPEAK, target="a2", content="I know who was at the dock."),
            state_changes=StateChanges(),
        )
        ctx = AgentContext(agent_id="a1", agent_name="Alice", agent_location="plaza")

        action = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action.type == ActionType.SPEAK
        assert action.intent is not None
        assert action.intent.objective == "earn Bob's trust"

    def test_llm_source_supports_pluggable_pipeline(self):
        class StubDecisionModel:
            def __init__(self):
                self.seen: AgentContext | None = None

            async def decide(self, context: AgentContext) -> ActionOutput:
                self.seen = context
                return ActionOutput(type=ActionType.OBSERVE, content="baseline read")

        class StubActionCritic:
            def __init__(self):
                self.seen_context: AgentContext | None = None
                self.seen_action: ActionOutput | None = None

            async def critique(self, context: AgentContext, action: ActionOutput) -> ActionOutput:
                self.seen_context = context
                self.seen_action = action
                return action.model_copy(update={"content": f"{action.content} -> approved"})

        decision_model = StubDecisionModel()
        action_critic = StubActionCritic()
        src = LLMDecisionSource(
            decision_model=decision_model,
            action_critic=action_critic,
        )
        ctx = AgentContext(agent_id="a1", agent_name="Alice", agent_location="plaza", tick=7)

        action = asyncio.get_event_loop().run_until_complete(src.decide(ctx))

        assert decision_model.seen is not None
        assert decision_model.seen.agent_name == "Alice"
        assert action_critic.seen_context == ctx
        assert action_critic.seen_action is not None
        assert action.content == "baseline read -> approved"

    def test_pipeline_components_follow_runtime_protocols(self):
        assert isinstance(ScriptedDecisionSource(), DecisionSource)
        assert isinstance(LLMDecisionSource(), DecisionSource)
        assert isinstance(type("Critic", (), {"critique": AsyncMock(side_effect=lambda ctx, action: action)})(), ActionCritic)


# ── Tests: ScriptedDecisionSource ────────────────────


class TestScriptedDecisionSource(unittest.TestCase):
    def test_default_actions_cycle(self):
        src = ScriptedDecisionSource()
        ctx = AgentContext(agent_id="a1", agent_location="plaza")

        action1 = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action1.type == ActionType.OBSERVE

        action2 = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action2.type == ActionType.WAIT

        action3 = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action3.type == ActionType.OBSERVE  # cycles back

    def test_custom_actions(self):
        actions = [
            ActionOutput(type=ActionType.WAIT, content="idle"),
            ActionOutput(type=ActionType.OBSERVE, content="looking"),
        ]
        src = ScriptedDecisionSource(actions=actions)
        ctx = AgentContext(agent_id="a1", agent_location="plaza")

        a1 = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert a1.type == ActionType.WAIT
        a2 = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert a2.type == ActionType.OBSERVE

    def test_speak_with_valid_target(self):
        actions = [
            ActionOutput(type=ActionType.SPEAK, content="hello", target="a2"),
        ]
        src = ScriptedDecisionSource(actions=actions)
        ctx = AgentContext(
            agent_id="a1",
            agent_location="plaza",
            visible_agents=[{"id": "a2", "name": "Bob", "location": "plaza"}],
        )
        action = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action.type == ActionType.SPEAK
        assert action.target == "a2"

    def test_speak_no_target_falls_back(self):
        actions = [
            ActionOutput(type=ActionType.SPEAK, content="hello"),
        ]
        src = ScriptedDecisionSource(actions=actions)
        ctx = AgentContext(agent_id="a1", agent_location="plaza", visible_agents=[])
        action = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action.type == ActionType.OBSERVE  # fallback

    def test_move_picks_reachable(self):
        actions = [
            ActionOutput(type=ActionType.MOVE, content="going somewhere"),
        ]
        src = ScriptedDecisionSource(actions=actions)
        ctx = AgentContext(
            agent_id="a1",
            agent_location="plaza",
            reachable_locations=["market", "dock"],
        )
        action = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action.type == ActionType.MOVE
        assert action.target in ["market", "dock"]

    def test_move_no_destinations_falls_back(self):
        actions = [
            ActionOutput(type=ActionType.MOVE, content="going somewhere"),
        ]
        src = ScriptedDecisionSource(actions=actions)
        ctx = AgentContext(
            agent_id="a1",
            agent_location="plaza",
            reachable_locations=[],
            available_locations=[],
        )
        action = asyncio.get_event_loop().run_until_complete(src.decide(ctx))
        assert action.type == ActionType.OBSERVE  # fallback


# ── Tests: Event.structured ──────────────────────────


class TestEventStructured(unittest.TestCase):
    def test_structured_field_exists_on_event(self):
        e = Event()
        assert hasattr(e, "structured")
        assert e.structured == {}

    def test_structured_populated_by_validator(self):
        session = _make_session()
        agent = session.agents["a1"]
        resp = LLMResponse(
            thinking="test",
            action=ActionOutput(type=ActionType.SPEAK, target="a2", content="hey there"),
            state_changes=StateChanges(),
        )
        summary = apply_action(resp, agent, session)
        structured = getattr(resp, "_structured", {})
        assert structured["verb"] == "spoke_to"
        assert structured["subject"] == "a1"
        assert structured["object"] == "a2"
        assert "content_key" in structured

    def test_build_structured_move(self):
        session = _make_session()
        agent = session.agents["a1"]
        action = ActionOutput(type=ActionType.MOVE, target="market", content="heading to market")
        structured = _build_structured(action, agent, session)
        assert structured["verb"] == "moved_to"
        assert structured["object"] == "market"
        assert structured["params"]["destination"] == "market"

    def test_build_structured_trade(self):
        session = _make_session()
        agent = session.agents["a1"]
        action = ActionOutput(type=ActionType.TRADE, target="a2", content="sword for gold")
        structured = _build_structured(action, agent, session)
        assert structured["verb"] == "traded_with"
        assert structured["object"] == "a2"
        assert structured["params"]["content"] == "sword for gold"

    def test_build_structured_use_item(self):
        session = _make_session()
        agent = session.agents["a1"]
        action = ActionOutput(type=ActionType.USE_ITEM, target="potion", content="drank it")
        structured = _build_structured(action, agent, session)
        assert structured["verb"] == "used_item"
        assert structured["params"]["item"] == "potion"

    def test_build_structured_observe(self):
        session = _make_session()
        agent = session.agents["a1"]
        action = ActionOutput(type=ActionType.OBSERVE, content="looking at the sky")
        structured = _build_structured(action, agent, session)
        assert structured["verb"] == "observed"
        assert "content_key" in structured

    def test_build_structured_wait(self):
        session = _make_session()
        agent = session.agents["a1"]
        action = ActionOutput(type=ActionType.WAIT, content="resting")
        structured = _build_structured(action, agent, session)
        assert structured["verb"] == "waited"

    def test_structured_matches_result_semantics(self):
        """Event.structured should be semantically consistent with Event.result."""
        session = _make_session()
        agent = session.agents["a1"]
        resp = LLMResponse(
            thinking="test",
            action=ActionOutput(type=ActionType.SPEAK, target="a2", content="hello Bob"),
            state_changes=StateChanges(),
        )
        summary = apply_action(resp, agent, session)
        structured = getattr(resp, "_structured", {})

        # result references target and content, structured has spoke_to verb
        assert "Bob" in summary and "hello Bob" in summary
        assert structured["verb"] == "spoke_to"
        assert structured["object"] == "a2"


# ── Tests: MemoryEntry.semantic ──────────────────────


class TestMemorySemantic(unittest.TestCase):
    def test_semantic_field_exists_on_memory(self):
        m = MemoryEntry()
        assert hasattr(m, "semantic")
        assert m.semantic == {}

    def test_derive_semantic_from_structured(self):
        event = _make_event(
            structured={
                "verb": "spoke_to",
                "subject": "a1",
                "object": "a2",
                "content_key": "hello Bob",
            }
        )
        agent = AgentState(agent_id="a1", name="Alice", location="plaza")
        semantic = _derive_semantic(event, agent)
        assert semantic["type"] == "social_interaction"
        assert semantic["with"] == "a2"
        assert semantic["sentiment"] == "positive"
        assert "topic" in semantic

    def test_derive_semantic_trade(self):
        event = _make_event(
            action_type="trade",
            structured={
                "verb": "traded_with",
                "subject": "a1",
                "object": "a2",
                "content_key": "sword for gold",
            }
        )
        agent = AgentState(agent_id="a1", name="Alice", location="plaza")
        semantic = _derive_semantic(event, agent)
        assert semantic["type"] == "resource_exchange"

    def test_derive_semantic_move(self):
        event = _make_event(
            action_type="move",
            structured={
                "verb": "moved_to",
                "subject": "a1",
                "object": "market",
            }
        )
        agent = AgentState(agent_id="a1", name="Alice", location="plaza")
        semantic = _derive_semantic(event, agent)
        assert semantic["type"] == "movement"

    def test_derive_semantic_empty_structured(self):
        event = _make_event(structured={})
        agent = AgentState(agent_id="a1", name="Alice", location="plaza")
        semantic = _derive_semantic(event, agent)
        assert semantic == {}

    def test_create_memory_fills_semantic(self):
        from babel.memory import create_memory_from_event

        session = _make_session()
        agent = session.agents["a1"]
        event = _make_event(
            structured={
                "verb": "spoke_to",
                "subject": "a1",
                "object": "a2",
                "content_key": "hello",
            }
        )
        with patch("babel.memory.save_memory", new_callable=AsyncMock):
            mem = asyncio.get_event_loop().run_until_complete(
                create_memory_from_event(agent, event, session)
            )
        assert mem.semantic.get("type") == "social_interaction"
        assert mem.semantic.get("with") == "a2"


# ── Tests: Engine with DecisionSource ────────────────


class TestEngineDecisionSource(unittest.TestCase):
    def test_engine_accepts_decision_source(self):
        from babel.engine import Engine
        session = _make_session()
        src = ScriptedDecisionSource()
        engine = Engine(session, decision_source=src)
        assert engine.decision_source is src

    def test_engine_accepts_custom_policies(self):
        from babel.engine import Engine

        class NoopPressure:
            async def before_agent_turn(self, engine, agent):
                return []

        class NoopSocial:
            def build_relation_context(self, session, agent):
                return []

            def apply(self, engine, agent, response, errors):
                return None

        class NoopGoal:
            def build_goal_context(self, agent):
                return {
                    "active_goal": None,
                    "ongoing_intent": None,
                    "last_outcome": agent.last_outcome,
                }

            def ensure_active_goal(self, engine, agent):
                return None

            def sync_plan_from_intent(self, agent, intent):
                return None

            def record_blocker(self, agent, blocker):
                return None

            async def update(self, engine, agent, event):
                return None

            def event_advances(self, event, goal):
                return False

            def select_next_goal(self, engine, agent, drive_state=None):
                return None

            def check_drive_shift(self, engine, agent):
                return None

        class NoopTimeline:
            async def after_tick(self, engine, tick_events):
                return None

        class NoopMemory:
            async def after_tick(self, engine, tick_events):
                return None

        class NoopEnrichment:
            async def after_tick(self, engine, tick_events):
                return None

        session = _make_session()
        engine = Engine(
            session,
            pressure_policy=NoopPressure(),
            social_projection_policy=NoopSocial(),
            social_mutation_policy=NoopSocial(),
            goal_projection_policy=NoopGoal(),
            goal_mutation_policy=NoopGoal(),
            timeline_policy=NoopTimeline(),
            memory_policy=NoopMemory(),
            enrichment_policy=NoopEnrichment(),
        )
        assert engine.pressure_policy.__class__.__name__ == "NoopPressure"
        assert engine.social_projection_policy.__class__.__name__ == "NoopSocial"
        assert engine.social_mutation_policy.__class__.__name__ == "NoopSocial"
        assert engine.goal_projection_policy.__class__.__name__ == "NoopGoal"
        assert engine.goal_mutation_policy.__class__.__name__ == "NoopGoal"
        assert engine.timeline_policy.__class__.__name__ == "NoopTimeline"
        assert engine.memory_policy.__class__.__name__ == "NoopMemory"
        assert engine.enrichment_policy.__class__.__name__ == "NoopEnrichment"

    def test_engine_default_uses_llm_decision_source(self):
        from babel.engine import Engine
        session = _make_session()
        engine = Engine(session)
        assert isinstance(engine.decision_source, LLMDecisionSource)

    def test_engine_accepts_split_social_policies(self):
        from babel.engine import Engine

        class ProjectionOnly:
            def build_relation_context(self, session, agent):
                del session, agent
                return [{"name": "Bob", "type": "watchful"}]

        class MutationOnly:
            def apply(self, engine, agent, response, errors):
                del engine, agent, response, errors
                return None

        session = _make_session()
        engine = Engine(
            session,
            social_projection_policy=ProjectionOnly(),
            social_mutation_policy=MutationOnly(),
        )
        ctx = engine._build_context(session.agents["a1"])
        assert ctx.relations[0]["type"] == "watchful"

    def test_engine_accepts_split_goal_policies(self):
        from babel.engine import Engine

        class ProjectionOnly:
            def build_goal_context(self, agent):
                del agent
                return {
                    "active_goal": {"text": "split projection"},
                    "ongoing_intent": {"objective": "move first"},
                    "last_outcome": "projection owned",
                }

        class MutationOnly:
            def ensure_active_goal(self, engine, agent):
                return None

            def sync_plan_from_intent(self, agent, intent):
                return None

            def record_blocker(self, agent, blocker):
                return None

            async def update(self, engine, agent, event):
                return None

            def event_advances(self, event, goal):
                return False

            def select_next_goal(self, engine, agent, drive_state=None):
                return None

            def check_drive_shift(self, engine, agent):
                return None

        session = _make_session()
        engine = Engine(
            session,
            goal_projection_policy=ProjectionOnly(),
            goal_mutation_policy=MutationOnly(),
        )
        ctx = engine._build_context(session.agents["a1"])
        assert ctx.active_goal["text"] == "split projection"
        assert ctx.ongoing_intent["objective"] == "move first"
        assert ctx.last_outcome == "projection owned"


class TestPolicyResolvers(unittest.TestCase):
    def test_engine_build_context(self):
        from babel.engine import Engine
        session = _make_session()
        engine = Engine(session)
        agent = session.agents["a1"]
        agent.immediate_intent = "gain Bob's confidence"
        agent.immediate_approach = "act helpful before asking questions"
        agent.immediate_next_step = "speak to Bob calmly"
        agent.last_outcome = "Alice saw Bob hiding a package."
        ctx = engine._build_context(agent)
        assert ctx.agent_id == "a1"
        assert ctx.agent_name == "Alice"
        assert ctx.agent_location == "plaza"
        assert "market" in ctx.reachable_locations
        assert len(ctx.available_locations) == 3
        assert len(ctx.world_rules) == 2
        assert ctx.ongoing_intent["objective"] == "gain Bob's confidence"
        assert ctx.last_outcome == "Alice saw Bob hiding a package."

    def test_engine_build_context_respects_goal_policy_projection(self):
        from babel.engine import Engine

        class CustomGoalProjection:
            def build_goal_context(self, agent):
                return {
                    "active_goal": {"text": "shadow Bob", "progress": 0.5},
                    "ongoing_intent": {
                        "objective": "corner Bob privately",
                        "approach": "stay out of sight",
                        "next_step": "follow him to the market",
                    },
                    "last_outcome": "Bob noticed a tail.",
                }

            def ensure_active_goal(self, engine, agent):
                return None

            def sync_plan_from_intent(self, agent, intent):
                return None

            def record_blocker(self, agent, blocker):
                return None

            async def update(self, engine, agent, event):
                return None

            def event_advances(self, event, goal):
                return False

            def select_next_goal(self, engine, agent, drive_state=None):
                return None

            def check_drive_shift(self, engine, agent):
                return None

        session = _make_session()
        custom = CustomGoalProjection()
        engine = Engine(session, goal_projection_policy=custom, goal_mutation_policy=custom)
        agent = session.agents["a1"]
        ctx = engine._build_context(agent)

        assert ctx.active_goal["text"] == "shadow Bob"
        assert ctx.ongoing_intent["objective"] == "corner Bob privately"
        assert ctx.last_outcome == "Bob noticed a tail."

    @patch("babel.engine.create_memory_from_event", new_callable=AsyncMock)
    def test_engine_syncs_goal_plan_from_intent(self, mock_create_memory):
        from babel.engine import Engine

        class IntentSource:
            async def decide(self, context):
                return ActionOutput(
                    type=ActionType.OBSERVE,
                    content="studying Bob's reactions",
                    intent={
                        "objective": "win Bob's trust",
                        "approach": "offer useful insight before asking questions",
                        "next_step": "watch how Bob reacts to the mention of the dock",
                        "rationale": "he looks ready to slip away",
                    },
                )

        session = _make_session()
        engine = Engine(session, decision_source=IntentSource())
        agent = session.agents["a1"]
        engine._running = True

        event = asyncio.get_event_loop().run_until_complete(engine._resolve_agent_action(agent))
        assert event.action_type == "observe"
        assert agent.active_goal is not None
        assert agent.active_goal.strategy == "offer useful insight before asking questions"
        assert agent.active_goal.next_step == "watch how Bob reacts to the mention of the dock"
        assert agent.immediate_intent == "win Bob's trust"

    @patch("babel.engine.create_memory_from_event", new_callable=AsyncMock)
    def test_engine_finalizes_event_significance_after_goal_mutation(self, mock_create_memory):
        from babel.engine import Engine

        class IntentSource:
            async def decide(self, context):
                del context
                return ActionOutput(
                    type=ActionType.OBSERVE,
                    content="spots a meaningful clue",
                    intent={
                        "objective": "investigate the smuggling route",
                        "approach": "trace the suspicious movement first",
                        "next_step": "inspect the dock manifests",
                    },
                )

        class GoalMutationOnly:
            def ensure_active_goal(self, engine, agent):
                del engine
                if not agent.active_goal:
                    agent.active_goal = GoalState(text="investigate the smuggling route")

            def sync_plan_from_intent(self, agent, intent):
                del agent, intent
                return None

            def record_blocker(self, agent, blocker):
                del agent, blocker
                return None

            async def update(self, engine, agent, event):
                del engine
                assert event.result
                if not agent.active_goal:
                    agent.active_goal = GoalState(text="investigate the smuggling route")
                agent.active_goal.progress = 0.3
                agent.active_goal.last_progress_reason = event.result

            def event_advances(self, event, goal):
                del event, goal
                return True

            def select_next_goal(self, engine, agent, drive_state=None):
                del engine, agent, drive_state
                return None

            def check_drive_shift(self, engine, agent):
                del engine, agent
                return None

        session = _make_session()
        engine = Engine(
            session,
            decision_source=IntentSource(),
            goal_mutation_policy=GoalMutationOnly(),
        )
        agent = session.agents["a1"]
        engine._running = True

        event = asyncio.get_event_loop().run_until_complete(engine._resolve_agent_action(agent))
        assert event.significance.primary == "goal"
        assert event.significance.delta["goal_progress"] == pytest.approx(0.3, abs=0.001)
        assert event.importance == pytest.approx(event.significance.score, abs=0.001)


# ── Integration: ScriptedDecisionSource runs 10 ticks ──


class TestScriptedTenTicks(unittest.TestCase):
    """Run 10 ticks with ScriptedDecisionSource — no LLM calls needed."""

    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.update_memory_access", new_callable=AsyncMock)
    @patch("babel.memory.load_events_filtered", new_callable=AsyncMock)
    @patch("babel.engine.save_timeline_node", new_callable=AsyncMock)
    @patch("babel.engine.get_last_node_id", new_callable=AsyncMock)
    @patch("babel.engine.save_snapshot", new_callable=AsyncMock)
    @patch("babel.engine.load_entity_details", new_callable=AsyncMock)
    @patch("babel.engine.save_entity_details", new_callable=AsyncMock)
    @patch("babel.engine.load_events_filtered", new_callable=AsyncMock)
    @patch("babel.engine.load_events", new_callable=AsyncMock)
    def test_ten_ticks_no_llm(
        self,
        mock_load_events,
        mock_engine_events_filtered,
        mock_save_details,
        mock_load_details,
        mock_save_snapshot,
        mock_get_last_node,
        mock_save_node,
        mock_mem_events_filtered,
        mock_update_access,
        mock_query_memories,
        mock_save_memory,
    ):
        # Configure mocks
        mock_query_memories.return_value = []
        mock_mem_events_filtered.return_value = []
        mock_engine_events_filtered.return_value = []
        mock_load_events.return_value = []
        mock_get_last_node.return_value = None
        mock_load_details.return_value = None

        from babel.engine import Engine

        session = _make_session()
        # Use observe + wait cycle — always valid
        actions = [
            ActionOutput(type=ActionType.OBSERVE, content="looking around"),
            ActionOutput(type=ActionType.WAIT, content="waiting"),
        ]
        src = ScriptedDecisionSource(actions=actions)
        engine = Engine(session, decision_source=src)

        # Run 10 ticks
        all_events = []
        for _ in range(10):
            tick_events = asyncio.get_event_loop().run_until_complete(engine.tick())
            all_events.extend(tick_events)

        # Verify: 10 ticks completed
        assert session.tick == 15  # started at 5, ran 10

        # Verify: events were created (3 agents per tick, some may skip)
        assert len(all_events) > 0

        # Verify: all events have valid action types
        for event in all_events:
            at = event.action_type if isinstance(event.action_type, str) else event.action_type.value
            assert at in ("observe", "wait", "chapter"), f"Unexpected action type: {at}"

        # Verify: structured fields are populated (skip chapter events)
        for event in all_events:
            if event.action_type == "chapter":
                continue
            assert event.structured, f"Event {event.id} has empty structured"
            assert "verb" in event.structured

        # Verify: no LLM was called (we'd get an error if it tried)
        # The fact that we reached here without any LLM mock means success


# ── Tests: Oracle Creative Mode ──────────────────────


class TestOracleCreativePrompt(unittest.TestCase):
    def test_creative_system_prompt_exists(self):
        from babel.prompts import ORACLE_CREATIVE_SYSTEM
        assert "WorldSeed" in ORACLE_CREATIVE_SYSTEM
        assert "JSON" in ORACLE_CREATIVE_SYSTEM

    def test_build_creative_prompt(self):
        from babel.prompts import build_creative_prompt
        prompt = build_creative_prompt("A space station world")
        assert "A space station world" in prompt
        assert "WorldSeed JSON" in prompt

    def test_build_creative_prompt_with_history(self):
        from babel.prompts import build_creative_prompt
        history = [
            {"role": "user", "content": "I want a fantasy world"},
            {"role": "oracle", "content": "Tell me more about the setting"},
        ]
        prompt = build_creative_prompt("Medieval, with dragons", conversation_history=history)
        assert "Medieval, with dragons" in prompt
        assert "fantasy world" in prompt


class TestGenerateSeedDraft(unittest.TestCase):
    @patch("babel.llm._complete_json", new_callable=AsyncMock)
    def test_generate_seed_valid(self, mock_json):
        from babel.llm import generate_seed_draft

        mock_json.return_value = {
            "name": "Lost Colony",
            "description": "A colony on a distant planet",
            "rules": ["survival is key"],
            "locations": [
                {"name": "Base Camp", "description": "The main camp", "tags": [], "connections": ["Forest"]},
                {"name": "Forest", "description": "Dense woods", "tags": [], "connections": ["Base Camp"]},
            ],
            "agents": [
                {
                    "id": "commander",
                    "name": "Commander Voss",
                    "description": "A stern leader",
                    "personality": "authoritative",
                    "goals": ["maintain order"],
                    "inventory": ["radio"],
                    "location": "Base Camp",
                }
            ],
            "initial_events": ["The colony ship has crash-landed"],
        }

        result = asyncio.get_event_loop().run_until_complete(
            generate_seed_draft("A colony on a distant planet")
        )
        assert result["name"] == "Lost Colony"
        assert len(result["locations"]) == 2
        assert len(result["agents"]) == 1

    @patch("babel.llm._complete_json", new_callable=AsyncMock)
    def test_generate_seed_invalid_location_ref(self, mock_json):
        from babel.llm import generate_seed_draft

        mock_json.return_value = {
            "name": "Bad World",
            "description": "Test",
            "locations": [
                {"name": "A", "connections": ["Nonexistent"]},
            ],
            "agents": [],
        }

        with pytest.raises(ValueError, match="does not exist"):
            asyncio.get_event_loop().run_until_complete(
                generate_seed_draft("A bad world")
            )

    @patch("babel.llm._complete_json", new_callable=AsyncMock)
    def test_generate_seed_invalid_agent_location(self, mock_json):
        from babel.llm import generate_seed_draft

        mock_json.return_value = {
            "name": "Bad World",
            "description": "Test",
            "locations": [
                {"name": "A", "connections": []},
            ],
            "agents": [
                {"id": "x", "name": "X", "location": "Nonexistent", "goals": []},
            ],
        }

        with pytest.raises(ValueError, match="does not exist"):
            asyncio.get_event_loop().run_until_complete(
                generate_seed_draft("Another bad world")
            )

    def test_world_seed_model_validate(self):
        """Ensure WorldSeed.model_validate works with the expected output shape."""
        from babel.models import WorldSeed
        data = {
            "name": "Test World",
            "description": "A test",
            "rules": ["be nice"],
            "locations": [
                {"name": "Town", "description": "A town", "connections": ["Forest"]},
                {"name": "Forest", "description": "Woods", "connections": ["Town"]},
            ],
            "agents": [
                {"id": "hero", "name": "Hero", "location": "Town", "goals": ["save"]},
            ],
            "initial_events": ["Dawn breaks"],
        }
        seed = WorldSeed.model_validate(data)
        assert seed.name == "Test World"
        assert len(seed.locations) == 2


if __name__ == "__main__":
    unittest.main()
