"""Tests for WorldPhysics — engine-enforced causal laws."""

import pytest

from babel.models import ActionOutput, ActionType, AgentState, PhysicsConfig, Session, WorldSeed, LocationSeed
from babel.physics import DefaultWorldPhysics, NoPhysics, _extract_offered_item


# ── Helpers ──────────────────────────────────────────────

def _make_session(agent_a_inv: list[str], agent_b_inv: list[str]) -> Session:
    seed = WorldSeed(
        name="physics-test",
        locations=[
            LocationSeed(name="plaza", connections=["market"]),
            LocationSeed(name="market", connections=["plaza"]),
        ],
        agents=[],
    )
    session = Session(world_seed=seed)
    session.agents["alice"] = AgentState(
        agent_id="alice", name="Alice", location="plaza", inventory=list(agent_a_inv),
    )
    session.agents["bob"] = AgentState(
        agent_id="bob", name="Bob", location="plaza", inventory=list(agent_b_inv),
    )
    return session


# ── Conservation (TRADE) ────────────────────────────────

class TestConservation:
    def test_trade_transfers_item(self):
        session = _make_session(["waterskin", "herb pouch"], ["ore chunk"])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.TRADE, target="bob", content="offering waterskin to Bob")
        alice = session.agents["alice"]
        bob = session.agents["bob"]

        effects = physics.enforce(action, alice, session)

        assert "waterskin" not in alice.inventory
        assert "waterskin" in bob.inventory
        assert len(effects) == 1
        assert "gave waterskin to Bob" in effects[0]

    def test_trade_total_items_conserved(self):
        session = _make_session(["waterskin", "waterskin"], ["ore chunk", "ore chunk"])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.TRADE, target="bob", content="offering waterskin to Bob")
        alice = session.agents["alice"]

        total_before = len(alice.inventory) + len(session.agents["bob"].inventory)
        physics.enforce(action, alice, session)
        total_after = len(alice.inventory) + len(session.agents["bob"].inventory)

        assert total_before == total_after

    def test_trade_no_target_no_effect(self):
        session = _make_session(["waterskin"], [])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.TRADE, target="nobody", content="offering waterskin")
        alice = session.agents["alice"]

        effects = physics.enforce(action, alice, session)

        assert effects == []
        assert alice.inventory == ["waterskin"]

    def test_trade_item_not_in_inventory(self):
        session = _make_session([], ["ore chunk"])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.TRADE, target="bob", content="offering waterskin to Bob")
        alice = session.agents["alice"]

        effects = physics.enforce(action, alice, session)

        assert effects == []

    def test_trade_removes_only_one_copy(self):
        session = _make_session(["waterskin", "waterskin", "waterskin"], [])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.TRADE, target="bob", content="offering waterskin to Bob")
        alice = session.agents["alice"]

        physics.enforce(action, alice, session)

        assert alice.inventory.count("waterskin") == 2
        assert session.agents["bob"].inventory.count("waterskin") == 1


# ── Irreversibility (USE_ITEM) ──────────────────────────

class TestIrreversibility:
    def test_use_item_consumed(self):
        session = _make_session(["waterskin", "herb pouch"], [])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.USE_ITEM, target="waterskin", content="drinking water")
        alice = session.agents["alice"]

        effects = physics.enforce(action, alice, session)

        assert "waterskin" not in alice.inventory
        assert "herb pouch" in alice.inventory
        assert len(effects) == 1
        assert "consumed waterskin" in effects[0]

    def test_use_item_not_in_inventory(self):
        session = _make_session([], [])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.USE_ITEM, target="waterskin", content="drinking water")
        alice = session.agents["alice"]

        effects = physics.enforce(action, alice, session)

        assert effects == []

    def test_use_item_removes_only_one(self):
        session = _make_session(["waterskin", "waterskin"], [])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=ActionType.USE_ITEM, target="waterskin", content="drinking water")
        alice = session.agents["alice"]

        physics.enforce(action, alice, session)

        assert alice.inventory.count("waterskin") == 1


# ── NoPhysics ───────────────────────────────────────────

class TestNoPhysics:
    def test_no_physics_no_effects(self):
        session = _make_session(["waterskin"], ["ore chunk"])
        physics = NoPhysics()
        action = ActionOutput(type=ActionType.TRADE, target="bob", content="offering waterskin to Bob")
        alice = session.agents["alice"]

        effects = physics.enforce(action, alice, session)

        assert effects == []
        assert alice.inventory == ["waterskin"]


# ── Non-physical actions pass through ───────────────────

class TestPassthrough:
    @pytest.mark.parametrize("action_type", [ActionType.SPEAK, ActionType.MOVE, ActionType.OBSERVE, ActionType.WAIT])
    def test_non_physical_actions_no_effects(self, action_type):
        session = _make_session(["waterskin"], [])
        physics = DefaultWorldPhysics()
        action = ActionOutput(type=action_type, target="somewhere", content="doing something")
        alice = session.agents["alice"]
        inv_before = list(alice.inventory)

        effects = physics.enforce(action, alice, session)

        assert effects == []
        assert alice.inventory == inv_before


# ── Item extraction ─────────────────────────────────────

class TestExtractOfferedItem:
    def test_offering_pattern(self):
        assert _extract_offered_item("offering waterskin to Bob", ["waterskin", "herb pouch"]) == "waterskin"

    def test_fallback_scan(self):
        assert _extract_offered_item("I want to give my herb pouch", ["waterskin", "herb pouch"]) == "herb pouch"

    def test_no_match(self):
        assert _extract_offered_item("hello there", ["waterskin"]) is None

    def test_empty_inventory(self):
        assert _extract_offered_item("offering waterskin to Bob", []) is None

    def test_empty_content(self):
        assert _extract_offered_item("", ["waterskin"]) is None


# ── Move Cost ──────────────────────────────────────────

def _make_session_with_physics(config: PhysicsConfig) -> Session:
    seed = WorldSeed(
        name="physics-test",
        locations=[
            LocationSeed(name="village", connections=["forest"], resources=["herb"]),
            LocationSeed(name="forest", connections=["village"], resources=["wood", "berry"]),
        ],
        agents=[],
        physics=config,
    )
    session = Session(world_seed=seed)
    session.agents["alice"] = AgentState(
        agent_id="alice", name="Alice", location="village", inventory=["food", "map"],
    )
    session.agents["bob"] = AgentState(
        agent_id="bob", name="Bob", location="village", inventory=["sword"],
    )
    return session


class TestMoveCost:
    def test_move_consumes_resource(self):
        config = PhysicsConfig(move_cost="food")
        session = _make_session_with_physics(config)
        physics = DefaultWorldPhysics(config)
        alice = session.agents["alice"]

        action = ActionOutput(type=ActionType.MOVE, target="forest")
        effects = physics.enforce(action, alice, session)

        assert "Alice spent food to travel" in effects[0]
        assert "food" not in alice.inventory

    def test_move_without_resource_still_moves(self):
        config = PhysicsConfig(move_cost="gold")
        session = _make_session_with_physics(config)
        physics = DefaultWorldPhysics(config)
        alice = session.agents["alice"]

        action = ActionOutput(type=ActionType.MOVE, target="forest")
        effects = physics.enforce(action, alice, session)

        assert "without gold" in effects[0]

    def test_move_free_when_no_cost(self):
        config = PhysicsConfig(move_cost=None)
        session = _make_session_with_physics(config)
        physics = DefaultWorldPhysics(config)
        alice = session.agents["alice"]

        action = ActionOutput(type=ActionType.MOVE, target="forest")
        effects = physics.enforce(action, alice, session)

        assert effects == []


# ── Regeneration ───────────────────────────────────────

class TestRegeneration:
    def test_regeneration_spawns_resources(self):
        config = PhysicsConfig(regeneration=True, regeneration_interval=1)
        session = _make_session_with_physics(config)
        session.tick = 1
        physics = DefaultWorldPhysics(config)

        effects = physics.tick_effects(session)

        assert len(effects) >= 2
        village_items = session.location_items.get("village", [])
        forest_items = session.location_items.get("forest", [])
        assert "herb" in village_items
        assert any(i in ("wood", "berry") for i in forest_items)

    def test_no_regeneration_when_disabled(self):
        config = PhysicsConfig(regeneration=False)
        session = _make_session_with_physics(config)
        session.tick = 5
        physics = DefaultWorldPhysics(config)

        assert physics.tick_effects(session) == []

    def test_regeneration_respects_interval(self):
        config = PhysicsConfig(regeneration=True, regeneration_interval=5)
        session = _make_session_with_physics(config)
        physics = DefaultWorldPhysics(config)

        session.tick = 3
        assert physics.tick_effects(session) == []

        session.tick = 5
        assert len(physics.tick_effects(session)) > 0

    def test_no_tick_effects_for_no_physics(self):
        physics = NoPhysics()
        session = _make_session_with_physics(PhysicsConfig())
        assert physics.tick_effects(session) == []


# ── Pickup ─────────────────────────────────────────────

class TestPickup:
    def test_observe_picks_up_ground_item(self):
        config = PhysicsConfig(regeneration=True)
        session = _make_session_with_physics(config)
        session.location_items["village"] = ["herb", "berry"]
        physics = DefaultWorldPhysics(config)
        alice = session.agents["alice"]

        action = ActionOutput(type=ActionType.OBSERVE, target="")
        effects = physics.enforce(action, alice, session)

        assert "Alice found herb" in effects[0]
        assert "herb" in alice.inventory
        assert session.location_items["village"] == ["berry"]

    def test_observe_no_ground_items(self):
        config = PhysicsConfig(regeneration=True)
        session = _make_session_with_physics(config)
        physics = DefaultWorldPhysics(config)
        alice = session.agents["alice"]

        action = ActionOutput(type=ActionType.OBSERVE, target="")
        effects = physics.enforce(action, alice, session)

        assert effects == []


# ── Selection Pressure (integration) ───────────────────

class TestSelectionPressure:
    def test_full_cycle_move_regen_pickup(self):
        """Move costs food → regen spawns resources → observe picks up."""
        config = PhysicsConfig(
            move_cost="food",
            regeneration=True,
            regeneration_interval=1,
        )
        session = _make_session_with_physics(config)
        physics = DefaultWorldPhysics(config)
        alice = session.agents["alice"]

        # Move: consumes food
        move = ActionOutput(type=ActionType.MOVE, target="forest")
        effects = physics.enforce(move, alice, session)
        assert "spent food" in effects[0]
        assert "food" not in alice.inventory

        # Regeneration
        session.tick = 1
        regen = physics.tick_effects(session)
        assert len(regen) > 0

        # Pickup at forest
        alice.location = "forest"
        observe = ActionOutput(type=ActionType.OBSERVE, target="")
        pickup = physics.enforce(observe, alice, session)
        assert len(pickup) > 0
        assert any(i in alice.inventory for i in ("wood", "berry"))
