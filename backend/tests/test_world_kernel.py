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
import unittest
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from babel.decision import AgentContext, DecisionSource, LLMDecisionSource, ScriptedDecisionSource
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

        # result mentions speaking, structured has spoke_to verb
        assert "said to" in summary
        assert structured["verb"] == "spoke_to"
        # Both reference a2/Bob
        assert "Bob" in summary
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

    def test_engine_default_no_decision_source(self):
        from babel.engine import Engine
        session = _make_session()
        engine = Engine(session)
        assert engine.decision_source is None

    def test_engine_build_context(self):
        from babel.engine import Engine
        session = _make_session()
        engine = Engine(session)
        agent = session.agents["a1"]
        ctx = engine._build_context(agent)
        assert ctx.agent_id == "a1"
        assert ctx.agent_name == "Alice"
        assert ctx.agent_location == "plaza"
        assert "market" in ctx.reachable_locations
        assert len(ctx.available_locations) == 3
        assert len(ctx.world_rules) == 2


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
            assert at in ("observe", "wait"), f"Unexpected action type: {at}"

        # Verify: structured fields are populated
        for event in all_events:
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
