"""Tests for World Authority Layer (Phase 1).

Covers: validator hardening, relation graph, location topology, inventory source validation.
"""

from __future__ import annotations

import pytest

from babel.models import (
    ActionOutput,
    ActionType,
    AgentSeed,
    AgentState,
    AgentStatus,
    LLMResponse,
    LocationSeed,
    Relation,
    Resource,
    Session,
    SessionStatus,
    StateChanges,
    WorldSeed,
)
from babel.validator import validate_action, apply_action


# ── Fixtures ──────────────────────────────────────────


def _make_session(
    locations: list[dict] | None = None,
    agents: list[dict] | None = None,
) -> Session:
    """Build a minimal Session for testing."""
    locs = locations or [
        {"name": "吧台", "connections": ["VIP包间", "后巷"]},
        {"name": "VIP包间", "connections": ["吧台"]},
        {"name": "后巷", "connections": ["吧台"]},
    ]
    loc_seeds = [LocationSeed(**l) for l in locs]

    agent_seeds = []
    if agents:
        for a in agents:
            agent_seeds.append(AgentSeed(**a))

    ws = WorldSeed(
        name="Test World",
        locations=loc_seeds,
        agents=agent_seeds,
        rules=["No killing"],
    )
    session = Session(world_seed=ws, tick=10)

    # Default agents if none provided
    if not agents:
        session.agents = {
            "a1": AgentState(
                agent_id="a1", name="Alice", location="吧台",
                inventory=["sword", "potion"],
            ),
            "a2": AgentState(
                agent_id="a2", name="Bob", location="吧台",
                inventory=["shield", "gold"],
            ),
            "a3": AgentState(
                agent_id="a3", name="Charlie", location="VIP包间",
                inventory=["dagger"],
            ),
            "dead": AgentState(
                agent_id="dead", name="Ghost", location="吧台",
                status=AgentStatus.DEAD,
            ),
        }
    else:
        session.init_agents()

    return session


def _make_response(
    action_type: ActionType,
    target: str | None = None,
    content: str = "",
    location: str | None = None,
    inv_add: list[str] | None = None,
    inv_remove: list[str] | None = None,
) -> LLMResponse:
    return LLMResponse(
        thinking="test",
        action=ActionOutput(type=action_type, target=target, content=content),
        state_changes=StateChanges(
            location=location,
            inventory_add=inv_add or [],
            inventory_remove=inv_remove or [],
        ),
    )


# ── Model Tests ───────────────────────────────────────


class TestRelationModel:
    def test_create_relation(self):
        r = Relation(source="a1", target="a2", type="ally", strength=0.8)
        assert r.source == "a1"
        assert r.strength == 0.8

    def test_session_get_relation(self):
        session = _make_session()
        session.relations.append(
            Relation(source="a1", target="a2", type="trust", strength=0.7)
        )
        assert session.get_relation("a1", "a2") is not None
        assert session.get_relation("a2", "a1") is None  # directional

    def test_session_update_relation_create(self):
        session = _make_session()
        rel = session.update_relation("a1", "a2", 0.1, tick=5)
        assert rel.strength == 0.6  # 0.5 default + 0.1
        assert rel.type == "trust"  # 0.6 = trust
        assert len(session.relations) == 1

    def test_session_update_relation_existing(self):
        session = _make_session()
        session.relations.append(
            Relation(source="a1", target="a2", strength=0.3)
        )
        rel = session.update_relation("a1", "a2", -0.15, tick=10)
        assert rel.strength == pytest.approx(0.15)
        assert rel.type == "hostile"  # <= 0.2

    def test_session_update_relation_clamp(self):
        session = _make_session()
        session.relations.append(
            Relation(source="a1", target="a2", strength=0.95)
        )
        rel = session.update_relation("a1", "a2", 0.2, tick=10)
        assert rel.strength == 1.0  # clamped

        session2 = _make_session()
        session2.relations.append(
            Relation(source="a1", target="a2", strength=0.05)
        )
        rel2 = session2.update_relation("a1", "a2", -0.2, tick=10)
        assert rel2.strength == 0.0  # clamped

    def test_relation_type_classification(self):
        session = _make_session()
        # ally threshold: >= 0.8
        rel = session.update_relation("a1", "a2", 0.3, tick=1)  # 0.5+0.3=0.8
        assert rel.type == "ally"
        # rival threshold: <= 0.35
        session2 = _make_session()
        rel2 = session2.update_relation("a1", "a2", -0.2, tick=1)  # 0.5-0.2=0.3
        assert rel2.type == "rival"


class TestResourceModel:
    def test_create_resource(self):
        r = Resource(name="gold", quantity=100, type="currency")
        assert r.quantity == 100

    def test_resource_defaults(self):
        r = Resource(name="sword")
        assert r.quantity == 1
        assert r.type == "item"


class TestLocationConnections:
    def test_connections_in_seed(self):
        ws = WorldSeed.from_yaml(
            str(__import__("pathlib").Path(__file__).parent.parent / "babel" / "seeds" / "cyber_bar.yaml")
        )
        bar = next(l for l in ws.locations if l.name == "吧台")
        assert "VIP包间" in bar.connections
        assert "后巷" in bar.connections

    def test_session_location_connections(self):
        session = _make_session()
        conns = session.location_connections("吧台")
        assert conns == ["VIP包间", "后巷"]
        assert session.location_connections("VIP包间") == ["吧台"]

    def test_location_connections_empty_for_unknown(self):
        session = _make_session()
        assert session.location_connections("nonexistent") == []


# ── Validator Tests ───────────────────────────────────


class TestMoveValidation:
    def test_move_to_connected_location(self):
        session = _make_session()
        resp = _make_response(ActionType.MOVE, target="VIP包间", location="VIP包间")
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []

    def test_move_to_non_connected_location(self):
        session = _make_session()
        # a1 is at 吧台, VIP包间 connects to 吧台 only, not 后巷
        # a3 is at VIP包间, 后巷 is NOT connected to VIP包间
        resp = _make_response(ActionType.MOVE, target="后巷", location="后巷")
        errors = validate_action(resp, session.agents["a3"], session)
        assert any("not connected" in e for e in errors)

    def test_move_to_same_location(self):
        session = _make_session()
        resp = _make_response(ActionType.MOVE, target="吧台", location="吧台")
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("Already at" in e for e in errors)

    def test_move_nonexistent_location(self):
        session = _make_session()
        resp = _make_response(ActionType.MOVE, target="天台", location="天台")
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("does not exist" in e for e in errors)

    def test_move_no_connections_defined(self):
        """When connections list is empty, all locations are reachable."""
        locs = [
            {"name": "A"},
            {"name": "B"},
        ]
        session = _make_session(locations=locs)
        session.agents = {
            "a1": AgentState(agent_id="a1", name="Alice", location="A"),
        }
        resp = _make_response(ActionType.MOVE, target="B", location="B")
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []


class TestSpeakValidation:
    def test_speak_same_location(self):
        session = _make_session()
        resp = _make_response(ActionType.SPEAK, target="a2", content="hello")
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []

    def test_speak_different_location(self):
        session = _make_session()
        # a1 at 吧台, a3 at VIP包间
        resp = _make_response(ActionType.SPEAK, target="a3", content="hello")
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("same location" in e for e in errors)

    def test_speak_dead_agent(self):
        session = _make_session()
        resp = _make_response(ActionType.SPEAK, target="dead", content="hello")
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("not found or dead" in e for e in errors)

    def test_speak_by_name(self):
        session = _make_session()
        resp = _make_response(ActionType.SPEAK, target="Bob", content="hello")
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []
        assert resp.action.target == "a2"  # resolved to ID


class TestTradeValidation:
    def test_trade_same_location(self):
        session = _make_session()
        resp = _make_response(
            ActionType.TRADE, target="a2", content="offer sword for gold",
            inv_add=["gold"], inv_remove=["sword"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []

    def test_trade_different_location(self):
        session = _make_session()
        resp = _make_response(
            ActionType.TRADE, target="a3", content="trade",
            inv_add=["dagger"], inv_remove=["sword"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("same location" in e for e in errors)

    def test_trade_hostile_relation(self):
        session = _make_session()
        session.relations.append(
            Relation(source="a1", target="a2", type="hostile", strength=0.1)
        )
        resp = _make_response(
            ActionType.TRADE, target="a2", content="trade",
            inv_add=["gold"], inv_remove=["sword"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("hostile" in e.lower() for e in errors)


class TestInventoryAddValidation:
    def test_trade_add_item_target_has(self):
        """Trade: adding items the target actually has should pass."""
        session = _make_session()
        resp = _make_response(
            ActionType.TRADE, target="a2", content="trade",
            inv_add=["shield"], inv_remove=["sword"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []

    def test_trade_add_item_target_lacks(self):
        """Trade: adding items the target does NOT have should fail."""
        session = _make_session()
        resp = _make_response(
            ActionType.TRADE, target="a2", content="trade",
            inv_add=["laser_gun"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("target does not have it" in e for e in errors)

    def test_speak_cannot_add_items(self):
        """Speak: should not allow inventory_add."""
        session = _make_session()
        resp = _make_response(
            ActionType.SPEAK, target="a2", content="hello",
            inv_add=["magic_item"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("TRADE or USE_ITEM" in e for e in errors)

    def test_observe_cannot_add_items(self):
        """Observe: should not allow inventory_add."""
        session = _make_session()
        resp = _make_response(
            ActionType.OBSERVE, content="looking around",
            inv_add=["found_treasure"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("TRADE or USE_ITEM" in e for e in errors)

    def test_wait_cannot_add_items(self):
        """Wait: should not allow inventory_add."""
        session = _make_session()
        resp = _make_response(
            ActionType.WAIT, content="waiting",
            inv_add=["appeared_from_thin_air"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("TRADE or USE_ITEM" in e for e in errors)

    def test_move_cannot_add_items(self):
        """Move: should not allow inventory_add."""
        session = _make_session()
        resp = _make_response(
            ActionType.MOVE, target="VIP包间", location="VIP包间",
            inv_add=["picked_up_something"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("TRADE or USE_ITEM" in e for e in errors)

    def test_use_item_can_add_items(self):
        """Use item: inventory_add is allowed (crafting, effects)."""
        session = _make_session()
        resp = _make_response(
            ActionType.USE_ITEM, target="potion", content="brew result",
            inv_add=["health_buff"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert errors == []

    def test_inventory_remove_nonexistent(self):
        """Removing items not in inventory should fail."""
        session = _make_session()
        resp = _make_response(
            ActionType.WAIT, content="waiting",
            inv_remove=["nonexistent_item"],
        )
        errors = validate_action(resp, session.agents["a1"], session)
        assert any("Cannot remove" in e for e in errors)


class TestApplyAction:
    def test_apply_move(self):
        session = _make_session()
        agent = session.agents["a1"]
        resp = _make_response(ActionType.MOVE, target="VIP包间", location="VIP包间")
        summary = apply_action(resp, agent, session)
        assert agent.location == "VIP包间"
        assert "moved to" in summary

    def test_apply_trade(self):
        session = _make_session()
        agent = session.agents["a1"]
        resp = _make_response(
            ActionType.TRADE, target="a2", content="sword for gold",
            inv_add=["gold"], inv_remove=["sword"],
        )
        apply_action(resp, agent, session)
        assert "gold" in agent.inventory
        assert "sword" not in agent.inventory

    def test_apply_speak(self):
        session = _make_session()
        agent = session.agents["a1"]
        resp = _make_response(ActionType.SPEAK, target="a2", content="hey there")
        summary = apply_action(resp, agent, session)
        assert "said to Bob" in summary


class TestRelationAutoUpdate:
    """Test the relation update logic (tested via Session.update_relation)."""

    def test_speak_strengthens_relation(self):
        session = _make_session()
        # Simulate speak: both directions +0.05
        session.update_relation("a1", "a2", 0.05, tick=10)
        session.update_relation("a2", "a1", 0.05, tick=10)
        r1 = session.get_relation("a1", "a2")
        r2 = session.get_relation("a2", "a1")
        assert r1.strength == pytest.approx(0.55)
        assert r2.strength == pytest.approx(0.55)

    def test_trade_success_strengthens_more(self):
        session = _make_session()
        session.update_relation("a1", "a2", 0.1, tick=10)
        r = session.get_relation("a1", "a2")
        assert r.strength == pytest.approx(0.6)

    def test_repeated_interactions_build_trust(self):
        session = _make_session()
        for i in range(10):
            session.update_relation("a1", "a2", 0.05, tick=i)
        r = session.get_relation("a1", "a2")
        assert r.strength == 1.0  # clamped at max
        assert r.type == "ally"

    def test_social_ledger_updates_metrics(self):
        session = _make_session()
        r = session.update_relation(
            "a1", "a2", 0.08, tick=10,
            social={"trust": 0.06, "tension": -0.03, "familiarity": 0.05, "debt": 0.12},
            note="shared a scarce ration",
        )
        assert r.trust > 0.5
        assert r.familiarity > 0.1
        assert r.debt_balance == pytest.approx(0.12)
        assert r.last_interaction == "shared a scarce ration"


class TestPromptRelations:
    """Test that prompt builder includes relations."""

    def test_relations_in_prompt(self):
        from babel.prompts import build_user_prompt

        prompt = build_user_prompt(
            world_rules=["no killing"],
            agent_name="Alice",
            agent_personality="brave",
            agent_goals=["survive"],
            agent_location="吧台",
            agent_inventory=["sword"],
            agent_memory=[],
            tick=10,
            visible_agents=[],
            recent_events=[],
            available_locations=["吧台", "VIP包间"],
            agent_relations=[
                {"name": "Bob", "type": "ally", "strength": 0.9, "trust": 0.8, "tension": 0.1, "familiarity": 0.7, "debt_balance": 0.2},
                {"name": "Charlie", "type": "hostile", "strength": 0.1, "trust": 0.2, "tension": 0.8, "familiarity": 0.4},
            ],
        )
        assert "[Your Relationships]" in prompt
        assert "Bob: ally" in prompt
        assert "Charlie: hostile" in prompt
        assert "trust: 0.8" in prompt
        assert "tension: 0.8" in prompt

    def test_reachable_locations_in_prompt(self):
        from babel.prompts import build_user_prompt

        prompt = build_user_prompt(
            world_rules=[],
            agent_name="Alice",
            agent_personality="",
            agent_goals=[],
            agent_location="吧台",
            agent_inventory=[],
            agent_memory=[],
            tick=1,
            visible_agents=[],
            recent_events=[],
            available_locations=["吧台", "VIP包间", "后巷"],
            reachable_locations=["VIP包间", "后巷"],
        )
        assert "Reachable Locations" in prompt
        assert "VIP包间" in prompt
        assert "后巷" in prompt
