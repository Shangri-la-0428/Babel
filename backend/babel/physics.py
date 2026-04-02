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
from typing import Protocol, runtime_checkable

from .models import ActionOutput, ActionType, AgentState, PhysicsConfig, Session

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
    """Four causal laws for agent internal state.

    Conservation: energy is finite — every action costs energy.
    Entropy: acting against personality accumulates stress.
    Cost: changing direction costs willpower (momentum resistance).
    Regeneration: rest restores energy, social interaction reduces stress.

    Internal state fields (all 0.0-1.0):
      energy    — fuel for action. Depleted by acting, restored by rest.
      stress    — friction from fighting one's nature. Decays slowly.
      momentum  — tendency to repeat. Builds with consistency, breaks with change.
    """

    # Action energy costs by type
    ACTION_COST: dict[str, float] = {
        "speak": 0.05,
        "observe": 0.03,
        "wait": 0.0,
        "move": 0.08,
        "trade": 0.07,
        "use_item": 0.06,
    }

    # Actions that build vs break momentum
    SOCIAL_ACTIONS = frozenset({"speak", "trade"})
    ACTIVE_ACTIONS = frozenset({"move", "use_item", "trade"})

    def _ensure_state(self, agent: AgentState) -> dict:
        """Initialize internal state if missing."""
        s = agent.internal_state
        if "energy" not in s:
            s["energy"] = 1.0
        if "stress" not in s:
            s["stress"] = 0.0
        if "momentum" not in s:
            s["momentum"] = 0.0
        if "last_action" not in s:
            s["last_action"] = ""
        return s

    def pre_decide(self, agent: AgentState, session: Session) -> dict:
        """Expose internal state to decision context."""
        s = self._ensure_state(agent)
        ctx: dict = {"internal_state": dict(s)}

        # High stress → inject stress signal into emotional context
        if s["stress"] > 0.7:
            ctx["emotional_context"] = (
                f"Internal tension is high ({s['stress']:.0%}). "
                f"Energy at {s['energy']:.0%}."
            )
        elif s["energy"] < 0.3:
            ctx["emotional_context"] = (
                f"Running low on energy ({s['energy']:.0%}). "
                f"Feeling the need to rest."
            )
        return ctx

    def post_event(
        self,
        action: ActionOutput,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        """Update internal state after action. Four laws applied."""
        s = self._ensure_state(agent)
        effects: list[str] = []
        action_type = action.type.value if hasattr(action.type, "value") else str(action.type)

        # Law 1: Conservation — energy cost
        cost = self.ACTION_COST.get(action_type, 0.05)
        if s["energy"] < 0.2:
            cost *= 1.5  # exhaustion amplifies cost
        s["energy"] = max(0.0, s["energy"] - cost)
        if s["energy"] < 0.1:
            effects.append(f"{agent.name} is exhausted")

        # Law 2: Entropy — stress from acting against nature
        stress_delta = self._compute_stress(action_type, agent)
        if stress_delta != 0:
            s["stress"] = max(0.0, min(1.0, s["stress"] + stress_delta))
            if s["stress"] > 0.8:
                effects.append(f"{agent.name} is under severe stress")

        # Law 3: Cost — momentum resistance (direction change costs extra energy)
        prev = s.get("last_action", "")
        if prev and prev != action_type:
            # Breaking momentum costs willpower (extra energy)
            momentum_cost = s["momentum"] * 0.05
            s["energy"] = max(0.0, s["energy"] - momentum_cost)
            s["momentum"] = max(0.0, s["momentum"] - 0.3)
        else:
            # Continuing same pattern builds momentum
            s["momentum"] = min(1.0, s["momentum"] + 0.15)

        # Law 4: Regeneration — social actions reduce stress
        if action_type in self.SOCIAL_ACTIONS:
            s["stress"] = max(0.0, s["stress"] - 0.05)

        s["last_action"] = action_type
        return effects

    def tick_effects(self, agent: AgentState, session: Session) -> list[str]:
        """Per-tick: passive recovery and decay."""
        s = self._ensure_state(agent)
        effects: list[str] = []

        # Energy regeneration (rest: small passive recovery each tick)
        recovery = 0.08
        if s["stress"] > 0.5:
            recovery *= 0.5  # stress impedes recovery
        s["energy"] = min(1.0, s["energy"] + recovery)

        # Stress decay (slow natural recovery)
        s["stress"] = max(0.0, s["stress"] - 0.03)

        # Momentum decay (without reinforcement, habits fade)
        s["momentum"] = max(0.0, s["momentum"] - 0.05)

        # Second-order effect: extreme stress triggers energy drain
        if s["stress"] > 0.9:
            s["energy"] = max(0.0, s["energy"] - 0.05)
            effects.append(f"{agent.name}'s stress is draining energy")

        return effects

    @staticmethod
    def _compute_stress(action_type: str, agent: AgentState) -> float:
        """Stress from acting against personality.

        Personality keywords map to preferred action types.
        Acting outside preference → stress. Acting in preference → stress relief.
        """
        personality = (agent.personality or "").lower()

        # Personality → preferred actions (simple keyword matching)
        prefers_social = any(w in personality for w in (
            "social", "friendly", "charismatic", "talkative",
            "外向", "社交", "健谈", "热情",
        ))
        prefers_cautious = any(w in personality for w in (
            "cautious", "careful", "quiet", "reserved", "shy",
            "谨慎", "小心", "安静", "内向", "害羞",
        ))
        prefers_active = any(w in personality for w in (
            "adventurous", "bold", "restless", "energetic", "brave",
            "冒险", "大胆", "活跃", "勇敢", "好动",
        ))

        # Acting against nature → stress
        if prefers_cautious and action_type in ("move", "trade", "use_item"):
            return 0.06
        if prefers_social and action_type in ("wait", "observe"):
            return 0.04
        if prefers_active and action_type == "wait":
            return 0.05

        # Acting in nature → slight stress relief (returned as negative)
        if prefers_social and action_type == "speak":
            return -0.03
        if prefers_cautious and action_type == "observe":
            return -0.02
        if prefers_active and action_type == "move":
            return -0.02

        return 0.0


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
