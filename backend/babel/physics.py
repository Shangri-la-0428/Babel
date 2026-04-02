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
