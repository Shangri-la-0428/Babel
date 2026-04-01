"""BABEL — Action validation. Ensures state machine closure (World Authority Layer)."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .models import ActionType, AgentState, AgentStatus, LLMResponse, Session


@runtime_checkable
class WorldAuthority(Protocol):
    """Hard world rules: validate candidate actions and apply legal mutations."""

    def validate(
        self,
        response: LLMResponse,
        agent: AgentState,
        session: Session,
    ) -> list[str]: ...

    def apply(
        self,
        response: LLMResponse,
        agent: AgentState,
        session: Session,
    ) -> str: ...


class DefaultWorldAuthority:
    """Default world authority built from the existing pure validator rules."""

    def validate(
        self,
        response: LLMResponse,
        agent: AgentState,
        session: Session,
    ) -> list[str]:
        return _validate_action(response, agent, session)

    def apply(
        self,
        response: LLMResponse,
        agent: AgentState,
        session: Session,
    ) -> str:
        return _apply_action(response, agent, session)


DEFAULT_WORLD_AUTHORITY = DefaultWorldAuthority()


def _resolve_agent_target(target: str, agent: AgentState, session: Session) -> str | None:
    """Resolve a target string to an agent_id. Handles id, name, or 'id (name)' formats."""
    alive_ids = session.agent_ids
    # Exact ID match
    if target in alive_ids:
        return target
    # Try extracting ID from "id (name)" format
    if "(" in target:
        candidate = target.split("(")[0].strip()
        if candidate in alive_ids:
            return candidate
    # Try matching by name
    for aid in alive_ids:
        if session.agents[aid].name == target:
            return aid
    return None


def _get_inventory_names(agent: AgentState) -> list[str]:
    """Get flat list of item names from agent inventory (handles both str and Resource)."""
    names = []
    for item in agent.inventory:
        if isinstance(item, str):
            names.append(item)
        else:
            names.append(item.name if hasattr(item, "name") else str(item))
    return names


def _validate_action(
    response: LLMResponse,
    agent: AgentState,
    session: Session,
) -> list[str]:
    """Validate an LLM response against current world state. Returns list of errors."""
    errors: list[str] = []
    action = response.action
    changes = response.state_changes
    locations = session.location_names
    alive_ids = session.agent_ids
    inv_names = _get_inventory_names(agent)

    # ── Move — location must exist AND be connected ──
    if action.type == ActionType.MOVE:
        target_loc = changes.location or action.target
        if target_loc and target_loc not in locations:
            errors.append(f"Location does not exist: '{target_loc}'. Valid: {locations}")
        elif target_loc and target_loc == agent.location:
            errors.append(f"Already at '{target_loc}'. Choose a different action or location.")
        elif target_loc:
            # Adjacency check — only enforce if connections are defined
            connections = session.location_connections(agent.location)
            if connections and target_loc not in connections:
                errors.append(
                    f"Cannot move from '{agent.location}' to '{target_loc}' — "
                    f"not connected. Reachable: {connections}"
                )

    # ── Speak / Trade — target must exist, be alive, and be at same location ──
    if action.type in (ActionType.SPEAK, ActionType.TRADE):
        if action.target:
            resolved = _resolve_agent_target(action.target, agent, session)
            if resolved:
                # Block self-interaction
                if resolved == agent.agent_id:
                    errors.append(
                        f"Cannot {action.type.value} with yourself."
                    )

                # Normalize target to the canonical agent_id
                action.target = resolved
                target_agent = session.agents[resolved]

                # Same-location check (skip if self — always same location)
                if resolved != agent.agent_id and target_agent.location != agent.location:
                    errors.append(
                        f"Cannot {action.type.value} with {target_agent.name} — "
                        f"they are at '{target_agent.location}', you are at '{agent.location}'. "
                        f"You must be at the same location."
                    )

                # Trade-specific: block if relation is hostile
                if action.type == ActionType.TRADE:
                    rel = session.get_relation(agent.agent_id, resolved)
                    if rel and rel.type == "hostile":
                        errors.append(
                            f"Cannot trade with {target_agent.name} — "
                            f"hostile relationship (strength: {rel.strength:.2f})."
                        )
            else:
                valid_targets = [
                    f"{aid} ({session.agents[aid].name})"
                    for aid in alive_ids
                    if aid != agent.agent_id
                ]
                errors.append(
                    f"Agent '{action.target}' not found or dead. "
                    f"Valid targets: {valid_targets}"
                )

    # ── Use item — item must be in inventory ──
    if action.type == ActionType.USE_ITEM:
        item = action.target
        if item and item not in inv_names:
            errors.append(
                f"Item '{item}' not in inventory. "
                f"You have: {inv_names}"
            )

    # ── Inventory removal — must have the items ──
    for item in changes.inventory_remove:
        if item not in inv_names:
            errors.append(f"Cannot remove '{item}' — not in inventory: {inv_names}")

    # ── Inventory add — must have valid source (World Authority) ──
    if changes.inventory_add:
        _validate_inventory_add(changes.inventory_add, action, agent, session, errors)

    # ── Location change consistency ──
    if action.type == ActionType.MOVE and changes.location:
        if changes.location not in locations:
            errors.append(f"state_changes.location '{changes.location}' is not a valid location.")
    elif action.type != ActionType.MOVE and changes.location:
        errors.append("state_changes.location should be null for non-move actions.")

    return errors


def validate_action(
    response: LLMResponse,
    agent: AgentState,
    session: Session,
) -> list[str]:
    """Compatibility wrapper around the default world authority."""
    return DEFAULT_WORLD_AUTHORITY.validate(response, agent, session)


def _validate_inventory_add(
    adds: list[str],
    action,
    agent: AgentState,
    session: Session,
    errors: list[str],
) -> None:
    """Validate that inventory additions have a legitimate source.

    Rules:
    - TRADE: items must exist in the target agent's inventory
    - USE_ITEM: limited self-referential add allowed (item effect)
    - Other action types: inventory_add is not allowed (prevents LLM hallucination)
    """
    if action.type == ActionType.TRADE:
        # For trade, added items should come from the target agent
        if action.target and action.target in session.agents:
            target_agent = session.agents[action.target]
            target_inv = _get_inventory_names(target_agent)
            for item in adds:
                if item not in target_inv:
                    errors.append(
                        f"Trade: cannot receive '{item}' — "
                        f"target does not have it. Their inventory: {target_inv}"
                    )
        else:
            # No valid target — strip all adds
            for item in adds:
                errors.append(f"Trade: cannot add '{item}' — no valid trade partner.")
    elif action.type == ActionType.USE_ITEM:
        # Use item may produce something (e.g., crafting). Allow but log.
        pass
    else:
        # All other actions: LLM should NOT add items from nothing
        for item in adds:
            errors.append(
                f"Cannot add '{item}' to inventory — "
                f"items can only be gained through TRADE or USE_ITEM actions."
            )


def _build_structured(
    action: ActionOutput,
    agent: AgentState,
    session: Session,
) -> dict:
    """Build a structured event record from an action (modality-agnostic)."""
    verb_map = {
        ActionType.SPEAK: "spoke_to",
        ActionType.MOVE: "moved_to",
        ActionType.USE_ITEM: "used_item",
        ActionType.TRADE: "traded_with",
        ActionType.OBSERVE: "observed",
        ActionType.WAIT: "waited",
    }
    verb = verb_map.get(action.type, "acted")

    structured: dict = {
        "verb": verb,
        "subject": agent.agent_id,
    }

    if action.target:
        structured["object"] = action.target

    if action.content:
        structured["content_key"] = action.content[:120]

    # Action-specific params
    params: dict = {}
    if action.type == ActionType.MOVE:
        params["destination"] = action.target or ""
    elif action.type == ActionType.TRADE:
        params["content"] = action.content
    elif action.type == ActionType.USE_ITEM:
        params["item"] = action.target or ""

    if params:
        structured["params"] = params

    return structured


def _apply_action(
    response: LLMResponse,
    agent: AgentState,
    session: Session,
) -> str:
    """Apply a validated action to the agent state. Returns a human-readable event summary.

    Also sets response._structured for the caller to attach to the Event.
    """
    action = response.action
    changes = response.state_changes

    # Apply location change
    if changes.location and changes.location in session.location_names:
        old_loc = agent.location
        agent.location = changes.location
        location_note = f" [moved from {old_loc} to {agent.location}]"
    else:
        location_note = ""

    # Apply inventory changes
    for item in changes.inventory_add:
        if item not in agent.inventory:
            agent.inventory.append(item)
    for item in changes.inventory_remove:
        if item in agent.inventory:
            agent.inventory.remove(item)

    # Build structured record
    structured = _build_structured(action, agent, session)

    # Stash structured data on the response for the engine to pick up
    response._structured = structured  # type: ignore[attr-defined]

    # Build event summary — use LLM content directly for novel-like readability
    content = (action.content or "").strip()
    match action.type:
        case ActionType.SPEAK:
            target_name = _resolve_name(action.target, session)
            summary = f'{agent.name} → {target_name}: "{content}"'
        case ActionType.MOVE:
            summary = f"{agent.name}: {content}" if content else f"{agent.name} → {agent.location}"
        case ActionType.USE_ITEM:
            summary = f"{agent.name}: {content}" if content else f"{agent.name} [{action.target}]"
        case ActionType.TRADE:
            target_name = _resolve_name(action.target, session)
            summary = f"{agent.name} ↔ {target_name}: {content}"
        case ActionType.OBSERVE:
            summary = f"{agent.name}: {content}"
        case ActionType.WAIT:
            summary = f"{agent.name}: {content}" if content else f"{agent.name} ..."
        case _:
            summary = f"{agent.name}: {content}"

    return summary + location_note


def apply_action(
    response: LLMResponse,
    agent: AgentState,
    session: Session,
) -> str:
    """Compatibility wrapper around the default world authority."""
    return DEFAULT_WORLD_AUTHORITY.apply(response, agent, session)


def _resolve_name(agent_id: str | None, session: Session) -> str:
    if not agent_id:
        return "nobody"
    agent = session.agents.get(agent_id)
    return agent.name if agent else agent_id


def validate_seed(seed) -> list[str]:
    """Validate a WorldSeed before creating a session. Returns list of errors."""
    errors: list[str] = []

    # Must have at least one agent
    if not seed.agents:
        errors.append("World seed must have at least one agent.")

    # Check duplicate location names
    loc_names = [loc.name for loc in seed.locations]
    seen_locs: set[str] = set()
    for name in loc_names:
        if name in seen_locs:
            errors.append(f"Duplicate location name: '{name}'")
        seen_locs.add(name)

    # Check duplicate agent IDs
    seen_ids: set[str] = set()
    for agent in seed.agents:
        if agent.id in seen_ids:
            errors.append(f"Duplicate agent ID: '{agent.id}'")
        seen_ids.add(agent.id)

    # Auto-deduplicate items by name (keep first occurrence, skip unnamed)
    seen_items: set[str] = set()
    deduped_items = []
    for item in getattr(seed, "items", []) or []:
        normalized = item.name.strip()
        if not normalized:
            continue
        if normalized not in seen_items:
            seen_items.add(normalized)
            deduped_items.append(item)
    if hasattr(seed, "items"):
        seed.items = deduped_items

    # Auto-fix agent locations: if location doesn't exist, assign first location
    first_loc = loc_names[0] if loc_names else ""
    for agent in seed.agents:
        if agent.location and agent.location not in seen_locs:
            agent.location = first_loc

    return errors
