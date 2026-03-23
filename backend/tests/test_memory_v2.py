"""Tests for Memory System v2 (Phase 2).

Covers: beliefs extraction, improved importance scoring,
consolidation with high-importance protection, summarize_memories mock.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from babel.memory import (
    BELIEF_INTERVAL,
    _compute_importance,
    extract_beliefs,
    get_agent_beliefs,
    consolidate_memories,
)
from babel.models import (
    ActionType,
    AgentSeed,
    AgentState,
    AgentStatus,
    Event,
    LocationSeed,
    MemoryEntry,
    Relation,
    Session,
    WorldSeed,
)


# ── Fixtures ──────────────────────────────────────────


def _make_session(
    agents: list[dict] | None = None,
    relations: list[dict] | None = None,
) -> Session:
    """Build a minimal Session for testing."""
    locs = [
        {"name": "吧台", "connections": ["VIP包间"]},
        {"name": "VIP包间", "connections": ["吧台"]},
    ]
    loc_seeds = [LocationSeed(**l) for l in locs]
    agent_defs = agents or [
        {"id": "a1", "name": "Alice", "location": "吧台", "goals": ["survive"]},
        {"id": "a2", "name": "Bob", "location": "吧台", "goals": ["trade"]},
        {"id": "a3", "name": "Carol", "location": "VIP包间", "goals": ["escape"]},
    ]
    agent_seeds = [AgentSeed(**a) for a in agent_defs]
    ws = WorldSeed(name="Test World", locations=loc_seeds, agents=agent_seeds)
    session = Session(world_seed=ws, tick=20)
    session.init_agents()

    if relations:
        for r in relations:
            session.relations.append(Relation(**r))

    return session


def _make_event(
    agent_id: str = "a1",
    agent_name: str = "Alice",
    action_type: str = "speak",
    result: str = "Alice said hello",
    tick: int = 5,
    involved: list[str] | None = None,
    location: str = "吧台",
) -> Event:
    return Event(
        session_id="test",
        tick=tick,
        agent_id=agent_id,
        agent_name=agent_name,
        action_type=action_type,
        result=result,
        location=location,
        involved_agents=involved or [agent_id],
    )


# ── Tests: Importance Scoring ──────────────────────────


class TestImportanceScoring:
    """Test improved _compute_importance with session-aware scoring."""

    def test_base_importance(self):
        session = _make_session()
        agent = session.agents["a1"]
        event = _make_event(action_type="speak")
        score = _compute_importance(event, agent, session)
        # speak base=0.6, self-involvement=+0.15 (agent_id matches)
        assert score == pytest.approx(0.75, abs=0.01)

    def test_self_involvement_boost(self):
        session = _make_session()
        agent = session.agents["a1"]
        # Event by a2, not involving a1
        event = _make_event(agent_id="a2", agent_name="Bob")
        score_other = _compute_importance(event, agent, session)
        # Event by a1
        event_self = _make_event(agent_id="a1", agent_name="Alice")
        score_self = _compute_importance(event_self, agent, session)
        assert score_self > score_other

    def test_involved_but_not_actor(self):
        session = _make_session()
        agent = session.agents["a1"]
        # a2 acts, but a1 is involved
        event = _make_event(
            agent_id="a2", agent_name="Bob",
            involved=["a2", "a1"],
        )
        score = _compute_importance(event, agent, session)
        # speak=0.6 + involved=0.1 = 0.7
        assert score >= 0.7

    def test_trade_boost(self):
        session = _make_session()
        agent = session.agents["a1"]
        event = _make_event(action_type="trade")
        score = _compute_importance(event, agent, session)
        # trade base=0.8 + self=0.15 + trade_boost=0.1 = capped at 1.0
        assert score == 1.0

    def test_relation_strength_boost(self):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "ally", "strength": 0.9},
        ])
        agent = session.agents["a1"]
        # Event by a2 — strong relation should boost
        event = _make_event(agent_id="a2", agent_name="Bob")
        score = _compute_importance(event, agent, session)
        # speak=0.6 + relation=0.15 = 0.75
        assert score >= 0.75

    def test_no_relation_no_boost(self):
        session = _make_session()  # no relations
        agent = session.agents["a1"]
        event = _make_event(agent_id="a2", agent_name="Bob")
        score = _compute_importance(event, agent, session)
        # speak=0.6, no self, no relation
        assert score == pytest.approx(0.6, abs=0.01)

    def test_goal_text_boost(self):
        session = _make_session()
        agent = session.agents["a2"]  # goals=["trade"]
        # Agent name in goals doesn't match, but let's test with matching
        agent.goals = ["find Bob and trade"]
        event = _make_event(agent_id="a2", agent_name="Bob")
        score = _compute_importance(event, agent, session)
        # speak=0.6 + self=0.15 + goal_match=0.2 = 0.95
        assert score >= 0.9

    def test_capped_at_one(self):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "ally", "strength": 0.9},
        ])
        agent = session.agents["a1"]
        agent.goals = ["trade with Bob"]
        event = _make_event(
            agent_id="a1", agent_name="Alice",
            action_type="trade",
            involved=["a1", "a2"],
        )
        score = _compute_importance(event, agent, session)
        assert score == 1.0

    def test_no_session_backwards_compat(self):
        """_compute_importance works without session (backward compat)."""
        session = _make_session()
        agent = session.agents["a1"]
        event = _make_event()
        score = _compute_importance(event, agent)  # no session
        assert 0.0 <= score <= 1.0


# ── Tests: Beliefs Extraction ──────────────────────────


class TestBeliefsExtraction:
    """Test rule-driven belief extraction from relations and memories."""

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_hostile_relation_generates_belief(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "hostile", "strength": 0.15},
        ])
        # No existing beliefs
        mock_query.return_value = []

        beliefs = await extract_beliefs("a1", session)

        assert len(beliefs) == 1
        assert "dangerous" in beliefs[0].content.lower() or "untrustworthy" in beliefs[0].content.lower()
        assert beliefs[0].category == "belief"
        mock_save.assert_called()

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_ally_relation_generates_belief(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "ally", "strength": 0.85},
        ])
        mock_query.return_value = []

        beliefs = await extract_beliefs("a1", session)

        assert len(beliefs) == 1
        assert "ally" in beliefs[0].content.lower() or "trusted" in beliefs[0].content.lower()

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_neutral_relation_no_belief(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "neutral", "strength": 0.5},
        ])
        mock_query.return_value = []

        beliefs = await extract_beliefs("a1", session)

        # Neutral relations don't generate beliefs
        assert len(beliefs) == 0

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_existing_belief_updated_not_duplicated(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "ally", "strength": 0.85},
        ])
        # Existing belief about Bob
        mock_query.side_effect = [
            # 1st: existing beliefs
            [{"id": "old1", "content": "Belief: Bob — dangerous and untrustworthy", "category": "belief"}],
            # 2nd: social memories
            [],
            # 3rd: episodic (trade pattern)
            [],
            # 4th: episodic (location pattern)
            [],
        ]

        beliefs = await extract_beliefs("a1", session)

        # Should delete old and create new
        mock_delete.assert_called()
        assert len(beliefs) == 1
        assert "ally" in beliefs[0].content.lower() or "trusted" in beliefs[0].content.lower()

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_trade_pattern_belief(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session()
        # Mock: no existing beliefs, no social, but 3+ trade episodics
        trade_mems = [
            {"id": f"t{i}", "content": f"traded with Bob (trade {i})",
             "category": "episodic", "tags": ["action:trade", "target:a2"],
             "importance": 0.6, "tick": i}
            for i in range(4)
        ]
        mock_query.side_effect = [
            [],           # existing beliefs
            [],           # social
            trade_mems,   # episodic (for trade pattern)
            [],           # episodic (for location pattern)
        ]

        beliefs = await extract_beliefs("a1", session)

        trade_beliefs = [b for b in beliefs if "trade" in b.content.lower()]
        assert len(trade_beliefs) == 1
        assert "Bob" in trade_beliefs[0].content

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_location_instability_belief(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session()
        world_event_mems = [
            {"id": f"w{i}", "content": f"world event at 吧台",
             "category": "episodic",
             "tags": ["action:world_event", "location:吧台"],
             "importance": 0.9, "tick": i}
            for i in range(3)
        ]
        mock_query.side_effect = [
            [],                # existing beliefs
            [],                # social
            [],                # episodic (trade pattern)
            world_event_mems,  # episodic (location pattern)
        ]

        beliefs = await extract_beliefs("a1", session)

        loc_beliefs = [b for b in beliefs if "吧台" in b.content]
        assert len(loc_beliefs) == 1
        assert "unstable" in loc_beliefs[0].content.lower()

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_dead_agent_no_belief(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session(relations=[
            {"source": "a1", "target": "a2", "type": "ally", "strength": 0.85},
        ])
        session.agents["a2"].status = AgentStatus.DEAD
        mock_query.return_value = []

        beliefs = await extract_beliefs("a1", session)

        # Dead agents don't generate beliefs
        assert len(beliefs) == 0

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    async def test_get_agent_beliefs(self, mock_query):
        mock_query.return_value = [
            {"content": "Belief: Bob — trusted ally"},
            {"content": "Belief: 吧台 — unstable"},
        ]

        beliefs = await get_agent_beliefs("test-session", "a1")

        assert len(beliefs) == 2
        assert "Bob" in beliefs[0]
        assert "吧台" in beliefs[1]

    @pytest.mark.asyncio
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    async def test_nonexistent_agent_returns_empty(
        self, mock_delete, mock_save, mock_query
    ):
        session = _make_session()
        beliefs = await extract_beliefs("nonexistent", session)
        assert beliefs == []


# ── Tests: Memory Consolidation v2 ────────────────────


class TestConsolidationV2:
    """Test improved consolidation with LLM summaries and importance protection."""

    @pytest.mark.asyncio
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    async def test_high_importance_protected(
        self, mock_query, mock_save, mock_delete
    ):
        session = _make_session()
        # All memories have high importance — none should be compressed
        high_importance = [
            {"id": f"h{i}", "content": f"critical event {i}",
             "category": "episodic", "importance": 0.9,
             "tags": ["agent:a2"], "tick": i}
            for i in range(8)
        ]
        mock_query.return_value = high_importance

        await consolidate_memories(session, "a1")

        # Nothing should be saved or deleted — all protected
        mock_save.assert_not_called()
        mock_delete.assert_not_called()

    @pytest.mark.asyncio
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    async def test_low_importance_compressed(
        self, mock_query, mock_save, mock_delete
    ):
        session = _make_session()
        # Mix of low and high importance
        mems = [
            {"id": f"l{i}", "content": f"mundane event {i}",
             "category": "episodic", "importance": 0.3,
             "tags": ["agent:a2", "name:Bob"], "tick": i}
            for i in range(6)
        ] + [
            {"id": "h0", "content": "CRITICAL", "category": "episodic",
             "importance": 0.9, "tags": ["agent:a2"], "tick": 100}
        ]
        mock_query.return_value = mems

        # Mock LLM summarization to fail — should fall back to concat
        with patch("babel.llm.summarize_memories", side_effect=Exception("fail")):
            await consolidate_memories(session, "a1")

        # Save was called for the semantic memory
        assert mock_save.call_count >= 1
        saved = mock_save.call_args_list[0][0][0]
        assert saved.category == "semantic"
        # Protected memory should NOT be in deleted list
        deleted_ids = mock_delete.call_args_list[0][0][0]
        assert "h0" not in deleted_ids

    @pytest.mark.asyncio
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    async def test_llm_summarization_used(
        self, mock_query, mock_save, mock_delete
    ):
        session = _make_session()
        mems = [
            {"id": f"l{i}", "content": f"Bob did thing {i}",
             "category": "episodic", "importance": 0.3,
             "tags": ["agent:a2", "name:Bob"], "tick": i}
            for i in range(6)
        ]
        mock_query.return_value = mems

        # Mock successful LLM summarization
        with patch(
            "babel.llm.summarize_memories",
            new_callable=AsyncMock,
            return_value="Bob performed multiple actions over time."
        ):
            await consolidate_memories(session, "a1")

        saved = mock_save.call_args_list[0][0][0]
        assert "Bob performed multiple actions" in saved.content
        assert saved.category == "semantic"

    @pytest.mark.asyncio
    @patch("babel.memory.delete_memories", new_callable=AsyncMock)
    @patch("babel.memory.save_memory", new_callable=AsyncMock)
    @patch("babel.memory.query_memories", new_callable=AsyncMock)
    async def test_too_few_memories_skipped(
        self, mock_query, mock_save, mock_delete
    ):
        session = _make_session()
        mock_query.return_value = [
            {"id": "l0", "content": "event", "category": "episodic",
             "importance": 0.3, "tags": [], "tick": 0}
        ]

        await consolidate_memories(session, "a1")

        mock_save.assert_not_called()
        mock_delete.assert_not_called()


# ── Tests: Constants ──────────────────────────────────


class TestConstants:
    def test_belief_interval_is_positive(self):
        assert BELIEF_INTERVAL > 0
        assert BELIEF_INTERVAL == 10
