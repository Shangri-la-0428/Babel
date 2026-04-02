"""BABEL — World Physics. Engine-enforced causal laws.

Three laws, like DNA's four bases — complexity from combination, not quantity:

1. Conservation — trade transfers items, never duplicates
2. Irreversibility — used items are consumed (entropy)
3. Cost — movement consumes resources (selection pressure)

Plus one generative law:

4. Regeneration — locations spawn resources from their seed definition

Physics runs AFTER WorldAuthority.apply() to handle cross-agent effects
that the single-agent state_changes pipeline cannot express.
"""

from __future__ import annotations

import logging
import random
import re
from typing import Any, Protocol, runtime_checkable

from .models import ActionOutput, ActionType, AgentInternalState, AgentState, PhysicsConfig, Session

logger = logging.getLogger(__name__)


@runtime_checkable
class WorldPhysics(Protocol):
    """Engine-enforced causal laws."""

    def enforce(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Per-action enforcement. Returns list of effect descriptions."""
        ...

    def tick_effects(self, session: Session) -> list[str]:
        """Per-tick effects (e.g. regeneration). Called once after all agents act."""
        ...


class NoPhysics:
    """Null physics — no enforcement. Backward compatible."""

    def enforce(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        return []

    def tick_effects(self, session: Session) -> list[str]:
        return []


# ── Agent Physics ────────────────────────────────────────
#
# WorldPhysics governs the world. AgentPhysics governs the agent.
# Together they form the complete causal constraint set.
#
# WorldPhysics: conservation, entropy, cost, regeneration (of items/locations)
# AgentPhysics: conservation, entropy, cost, regeneration (of internal state)
#
# The agent is not a weightless cursor. It has mass — internal state
# that constrains and shapes what it can do next.

@runtime_checkable
class AgentPhysics(Protocol):
    """Engine-enforced causal laws for agent internal state."""

    def pre_decide(self, agent: AgentState, session: Session) -> dict:
        """Before decision: compute constraints from internal state.
        Returns dict to merge into AgentContext fields."""
        ...

    def post_event(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """After action: update agent internal state. Returns effect descriptions."""
        ...

    def tick_effects(self, agent: AgentState, session: Session) -> list[str]:
        """Per-tick agent effects (decay, recovery). Called once per agent per tick."""
        ...


class NoAgentPhysics:
    """Null agent physics — agents are weightless cursors."""

    def pre_decide(self, agent: AgentState, session: Session) -> dict:
        return {}

    def post_event(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        return []

    def tick_effects(self, agent: AgentState, session: Session) -> list[str]:
        return []


class DefaultAgentPhysics:
    """Three causal laws for agent internal state. Pure physics, no personality.

    Conservation: energy is finite — every action costs energy.
    Inertia: momentum resists direction change — switching costs extra energy.
    Recovery: energy regenerates per tick; stress decays; stress impedes recovery.

    Stress in this implementation is pure load accumulation (sustained activity
    without rest). Personality-driven stress is NOT physics — it belongs in
    PsycheAgentPhysics, which maps Psyche's four dimensions to internal state.
    """

    # ── Invariants ───────────────────────────────────────
    # Constants derive from physical invariants, not tuning.

    # Action energy costs — ordered by cognitive/physical complexity.
    # wait < observe < speak < use_item < trade < move
    # This ordering is causal: wait needs zero attention, move needs full coordination.
    ACTION_COST: dict[str, float] = {
        "wait": 0.0,
        "observe": 0.03,
        "speak": 0.05,
        "use_item": 0.06,
        "trade": 0.07,
        "move": 0.08,
    }

    # Invariant: an agent at full rest recovers all energy in N ticks.
    FULL_REST_TICKS: int = 25
    RECOVERY_PER_TICK: float = 1.0 / FULL_REST_TICKS  # 0.04

    # Stress per action = action_cost × STRESS_RATIO.
    # The ratio creates a natural threshold at STRESS_DECAY / STRESS_RATIO = 0.06:
    #   actions costing > 0.06 (move, trade) accumulate stress under sustained use,
    #   actions costing < 0.06 (observe, speak) dissipate stress naturally.
    STRESS_DECAY: float = 0.03
    STRESS_RATIO: float = 0.5

    # Invariant: after N repeated actions, switching costs as much as a move.
    # momentum = N × MOMENTUM_BUILD, switch_cost = momentum × MOMENTUM_SWITCH_RATIO
    # At N=5: 5 × 0.2 = 1.0, switch cost = 1.0 × 0.08 = 0.08 = move cost. ∎
    MOMENTUM_BUILD: float = 0.2
    MOMENTUM_SWITCH_RATIO: float = ACTION_COST["move"]  # 0.08
    MOMENTUM_DECAY: float = 0.05

    def pre_decide(self, agent: AgentState, session: Session) -> dict:
        """Expose internal state to decision context."""
        s = agent.internal_state
        ctx: dict = {"internal_state": s.model_copy()}

        # Extreme states → inject signal into emotional context
        if s.stress > 0.7:
            ctx["emotional_context"] = (
                f"Internal load is high ({s.stress:.0%}). "
                f"Energy at {s.energy:.0%}."
            )
        elif s.energy < 0.3:
            ctx["emotional_context"] = (
                f"Running low on energy ({s.energy:.0%}). "
                f"Need to conserve."
            )
        return ctx

    def post_event(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Update internal state after action. Three laws applied."""
        s = agent.internal_state
        effects: list[str] = []
        action_type = action.type.value if hasattr(action.type, "value") else str(action.type)

        # Law 1: Conservation — energy cost
        cost = self.ACTION_COST.get(action_type, 0.05)
        if s.energy < 0.2:
            cost *= 1.5  # exhaustion amplifies cost
        s.energy = max(0.0, s.energy - cost)
        if s.energy < 0.1:
            effects.append(f"{agent.name} is exhausted")

        # Law 1b: Stress as load — proportional to action cost
        if cost > 0:
            s.stress = min(1.0, s.stress + cost * self.STRESS_RATIO)
            if s.stress > 0.8:
                effects.append(f"{agent.name} is under heavy load")

        # Law 2: Inertia — momentum resistance
        if s.last_action and s.last_action != action_type:
            # Breaking momentum costs energy proportional to accumulated inertia.
            # At full momentum (1.0), switching costs as much as a move.
            momentum_cost = s.momentum * self.MOMENTUM_SWITCH_RATIO
            s.energy = max(0.0, s.energy - momentum_cost)
            s.momentum = max(0.0, s.momentum - 0.3)
        else:
            # Continuing same pattern builds momentum
            s.momentum = min(1.0, s.momentum + self.MOMENTUM_BUILD)

        s.last_action = action_type
        return effects

    def tick_effects(self, agent: AgentState, session: Session) -> list[str]:
        """Per-tick: passive recovery and decay."""
        s = agent.internal_state
        effects: list[str] = []

        # Law 3: Recovery — energy regenerates passively.
        # Derived from invariant: full rest → full energy in FULL_REST_TICKS.
        recovery = self.RECOVERY_PER_TICK
        if s.stress > 0.5:
            recovery *= 0.5  # stress impedes recovery (coupling)
        s.energy = min(1.0, s.energy + recovery)

        # Stress decay (slow natural dissipation)
        s.stress = max(0.0, s.stress - self.STRESS_DECAY)

        # Momentum decay (without reinforcement, inertia fades)
        s.momentum = max(0.0, s.momentum - self.MOMENTUM_DECAY)

        # Second-order: extreme stress drains energy
        if s.stress > 0.9:
            s.energy = max(0.0, s.energy - 0.05)
            effects.append(f"{agent.name}'s stress is draining energy")

        return effects


class PsycheAgentPhysics(DefaultAgentPhysics):
    """AgentPhysics modulated by Psyche's overlay.

    Psyche provides 4 signals via PsycheOverlay. Each modulates one
    physics constant — overlay never touches internal state directly.

    arousal       → STRESS_RATIO multiplier   (activation = faster load buildup)
    valence       → RECOVERY_PER_TICK mult.   (positive = faster healing)
    agency        → ACTION_COST multiplier    (capable = cheaper actions)
    vulnerability → stress damage threshold   (fragile = hurt at lower stress)

    When overlay is zero-vector, behavior is identical to DefaultAgentPhysics.
    When Psyche is unavailable, falls back to pure causal.
    """

    # Coupling strengths — how much Psyche can influence each constant.
    # These are the only free parameters in the bridge.
    AROUSAL_COUPLING: float = 1.0    # arousal=1 → 2x stress rate
    VALENCE_COUPLING: float = 0.5    # valence=1 → 1.5x recovery
    AGENCY_COUPLING: float = 0.3     # agency=1 → 0.7x action cost
    VULNERABILITY_COUPLING: float = 0.3  # vulnerability=1 → stress hurts at 0.6 not 0.9

    def __init__(self, psyche_url: str | None = None):
        self._psyche_url = psyche_url
        self._bridge: Any = None
        # Per-agent overlays (current + previous for shift detection)
        self.overlays: dict[str, Any] = {}
        self.prev_overlays: dict[str, Any] = {}
        # Full snapshots kept for decision sources (PsycheDecisionSource etc.)
        self.snapshots: dict[str, Any] = {}
        self.prev_snapshots: dict[str, Any] = {}

    def _get_overlay(self, agent_id: str):
        """Get cached overlay for agent, or default zero-vector."""
        from .models import PsycheOverlay
        return self.overlays.get(agent_id) or PsycheOverlay()

    async def _get_bridge(self):
        if not self._psyche_url:
            return None
        if self._bridge is None:
            from .psyche_bridge import PsycheBridge
            self._bridge = PsycheBridge(base_url=self._psyche_url, timeout=3.0)
        return self._bridge

    def pre_decide(self, agent: AgentState, session: Session) -> dict:
        """Pure causal base + overlay-derived emotional context."""
        ctx = super().pre_decide(agent, session)

        overlay = self._get_overlay(agent.agent_id)

        # Build emotional context from overlay signals
        parts: list[str] = []
        if overlay.arousal > 0.5:
            parts.append("You feel highly activated and alert.")
        elif overlay.arousal < -0.5:
            parts.append("You feel sluggish and withdrawn.")
        if overlay.valence > 0.5:
            parts.append("Things feel good — positive momentum.")
        elif overlay.valence < -0.5:
            parts.append("Something feels wrong — negative undertone.")
        if overlay.agency < -0.5:
            parts.append("You feel powerless, constrained.")
        if overlay.vulnerability > 0.5:
            parts.append("You feel exposed and fragile.")

        if parts:
            ctx["emotional_context"] = " ".join(parts)

        # Expose drive state from snapshot (for goal mutation, decision sources)
        snapshot = self.snapshots.get(agent.agent_id)
        if snapshot and hasattr(snapshot, "drives") and snapshot.drives:
            ctx["drive_state"] = snapshot.drives

        return ctx

    def post_event(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Overlay-modulated post_event: agency reduces cost, arousal amplifies stress."""
        s = agent.internal_state
        effects: list[str] = []
        action_type = action.type.value if hasattr(action.type, "value") else str(action.type)
        overlay = self._get_overlay(agent.agent_id)

        # Law 1: Conservation — energy cost, modulated by agency
        cost = self.ACTION_COST.get(action_type, 0.05)
        cost *= (1.0 - overlay.agency * self.AGENCY_COUPLING)
        if s.energy < 0.2:
            cost *= 1.5
        s.energy = max(0.0, s.energy - cost)
        if s.energy < 0.1:
            effects.append(f"{agent.name} is exhausted")

        # Law 1b: Stress as load — ratio modulated by arousal
        if cost > 0:
            effective_ratio = self.STRESS_RATIO * (1.0 + overlay.arousal * self.AROUSAL_COUPLING)
            s.stress = min(1.0, s.stress + cost * max(0.0, effective_ratio))
            if s.stress > 0.8:
                effects.append(f"{agent.name} is under heavy load")

        # Law 2: Inertia — unchanged by overlay
        if s.last_action and s.last_action != action_type:
            momentum_cost = s.momentum * self.MOMENTUM_SWITCH_RATIO
            s.energy = max(0.0, s.energy - momentum_cost)
            s.momentum = max(0.0, s.momentum - 0.3)
        else:
            s.momentum = min(1.0, s.momentum + self.MOMENTUM_BUILD)

        s.last_action = action_type
        return effects

    def tick_effects(self, agent: AgentState, session: Session) -> list[str]:
        """Overlay-modulated tick: valence improves recovery, vulnerability lowers damage threshold."""
        s = agent.internal_state
        effects: list[str] = []
        overlay = self._get_overlay(agent.agent_id)

        # Law 3: Recovery — modulated by valence
        recovery = self.RECOVERY_PER_TICK * (1.0 + overlay.valence * self.VALENCE_COUPLING)
        if s.stress > 0.5:
            recovery *= 0.5
        s.energy = min(1.0, s.energy + max(0.0, recovery))

        # Stress decay
        s.stress = max(0.0, s.stress - self.STRESS_DECAY)

        # Momentum decay
        s.momentum = max(0.0, s.momentum - self.MOMENTUM_DECAY)

        # Second-order: stress drains energy — threshold lowered by vulnerability
        threshold = 0.9 - overlay.vulnerability * self.VULNERABILITY_COUPLING
        if s.stress > threshold:
            s.energy = max(0.0, s.energy - 0.05)
            effects.append(f"{agent.name}'s stress is draining energy")

        return effects

    async def refresh(self, agent: AgentState) -> None:
        """Fetch latest Psyche overlay + snapshot. Called from hooks.before_turn."""
        bridge = await self._get_bridge()
        if not bridge:
            return
        try:
            overlay = await bridge.get_overlay()
            self.prev_overlays[agent.agent_id] = self.overlays.get(agent.agent_id)
            self.overlays[agent.agent_id] = overlay
        except Exception as e:
            logger.debug("Psyche overlay fetch failed for %s: %s", agent.agent_id, e)
        try:
            snapshot = await bridge.get_state()
            self.prev_snapshots[agent.agent_id] = self.snapshots.get(agent.agent_id)
            self.snapshots[agent.agent_id] = snapshot
        except Exception as e:
            logger.debug("Psyche snapshot fetch failed for %s: %s", agent.agent_id, e)

    async def feedback(self, agent: AgentState, event_result: str) -> None:
        """Feed agent action result to Psyche for emotional update."""
        bridge = await self._get_bridge()
        if not bridge:
            return
        try:
            await bridge.process_output(text=event_result, user_id=agent.agent_id)
        except Exception as e:
            logger.debug("Psyche feedback failed for %s: %s", agent.agent_id, e)

    def get_drive_state(self, agent_id: str) -> dict[str, float] | None:
        snapshot = self.snapshots.get(agent_id)
        return snapshot.drives if snapshot and hasattr(snapshot, "drives") and snapshot.drives else None


class DefaultWorldPhysics:
    """Four causal laws: conservation, irreversibility, cost, regeneration.

    Conservation: TRADE moves one item from actor to target.
    Irreversibility: USE_ITEM destroys the item from inventory.
    Cost: MOVE consumes a resource from inventory.
    Regeneration: locations spawn resources from their seed definition.

    Reads PhysicsConfig from seed — each law can be toggled per world.
    """

    def __init__(self, config: PhysicsConfig | None = None):
        self.config = config or PhysicsConfig()

    def enforce(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        match action.type:
            case ActionType.TRADE if self.config.conservation:
                return self._enforce_conservation(action, agent, session)
            case ActionType.USE_ITEM if self.config.entropy:
                return self._enforce_irreversibility(action, agent, session)
            case ActionType.MOVE if self.config.move_cost:
                return self._enforce_move_cost(action, agent, session)
            case ActionType.OBSERVE if self.config.regeneration:
                return self._enforce_pickup(action, agent, session)
            case _:
                return []

    def tick_effects(self, session: Session) -> list[str]:
        """Per-tick physics: resource regeneration."""
        if not self.config.regeneration:
            return []
        if session.tick % self.config.regeneration_interval != 0:
            return []
        return self._regenerate(session)

    # ── Conservation ─────────────────────────────────────

    def _enforce_conservation(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Trade transfers: actor loses item, target gains item."""
        effects: list[str] = []

        target = session.agents.get(action.target or "")
        if not target:
            return effects

        offered = _extract_offered_item(action.content, agent.inventory)
        if not offered:
            return effects

        if offered in agent.inventory:
            agent.inventory.remove(offered)
            target.inventory.append(offered)
            effects.append(f"{agent.name} gave {offered} to {target.name}")
            logger.debug("Physics: %s → %s: %s", agent.name, target.name, offered)
        else:
            logger.debug("Physics: %s tried to trade %s but doesn't have it", agent.name, offered)

        return effects

    # ── Irreversibility ──────────────────────────────────

    def _enforce_irreversibility(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Use item: consumed and destroyed."""
        item = action.target
        if not item:
            return []

        if item in agent.inventory:
            agent.inventory.remove(item)
            return [f"{agent.name} consumed {item}"]
        return []

    # ── Move cost ────────────────────────────────────────

    def _enforce_move_cost(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Movement consumes a resource. Selection pressure: plan your travel."""
        cost = self.config.move_cost
        if not cost:
            return []

        if cost in agent.inventory:
            agent.inventory.remove(cost)
            return [f"{agent.name} spent {cost} to travel"]
        else:
            return [f"{agent.name} traveled without {cost} (exhausting)"]

    # ── Pickup ────────────────────────────────────────────

    def _enforce_pickup(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Observe at a location with ground items → pick up one."""
        ground = session.location_items.get(agent.location, [])
        if not ground:
            return []
        item = ground.pop(0)
        agent.inventory.append(item)
        return [f"{agent.name} found {item}"]

    # ── Regeneration ─────────────────────────────────────

    def _regenerate(self, session: Session) -> list[str]:
        """Locations spawn resources from their seed definition."""
        effects: list[str] = []
        for loc in session.world_seed.locations:
            if not loc.resources:
                continue
            item = random.choice(loc.resources)
            if loc.name not in session.location_items:
                session.location_items[loc.name] = []
            session.location_items[loc.name].append(item)
            effects.append(f"{item} appeared at {loc.name}")
            logger.debug("Regeneration: %s spawned at %s", item, loc.name)
        return effects


def _extract_offered_item(content: str, inventory: list[str]) -> str | None:
    """Extract the offered item name from trade action content.

    Strategies (in order):
    1. Pattern match: "offering {item} to ..."
    2. First inventory item mentioned in content
    """
    if not content or not inventory:
        return None

    # Strategy 1: "offering X to Y"
    m = re.search(r"offering\s+(.+?)\s+to\s+", content, re.IGNORECASE)
    if m:
        candidate = m.group(1).strip()
        if candidate in inventory:
            return candidate

    # Strategy 2: scan content for any inventory item name
    content_lower = content.lower()
    for item in inventory:
        if item.lower() in content_lower:
            return item

    return None
