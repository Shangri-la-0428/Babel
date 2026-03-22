"""BABEL — Action validation. Ensures state machine closure."""

from __future__ import annotations

from .models import ActionType, AgentState, LLMResponse, Session


def validate_action(
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

    # Move — target location must exist
    if action.type == ActionType.MOVE:
        target_loc = changes.location or action.target
        if target_loc and target_loc not in locations:
            errors.append(f"Location does not exist: '{target_loc}'. Valid: {locations}")
        if target_loc and target_loc == agent.location:
            errors.append(f"Already at '{target_loc}'. Choose a different action or location.")

    # Speak / Trade — target agent must exist and be alive
    if action.type in (ActionType.SPEAK, ActionType.TRADE):
        if action.target and action.target not in alive_ids:
            valid_targets = [
                f"{aid} ({session.agents[aid].name})"
                for aid in alive_ids
                if aid != agent.agent_id
            ]
            errors.append(
                f"Agent '{action.target}' not found or dead. "
                f"Valid targets: {valid_targets}"
            )

    # Use item — item must be in inventory
    if action.type == ActionType.USE_ITEM:
        item = action.target
        if item and item not in agent.inventory:
            errors.append(
                f"Item '{item}' not in inventory. "
                f"You have: {agent.inventory}"
            )

    # Inventory removal — must have the items
    for item in changes.inventory_remove:
        if item not in agent.inventory:
            errors.append(f"Cannot remove '{item}' — not in inventory: {agent.inventory}")

    # Location change consistency
    if action.type == ActionType.MOVE and changes.location:
        if changes.location not in locations:
            errors.append(f"state_changes.location '{changes.location}' is not a valid location.")
    elif action.type != ActionType.MOVE and changes.location:
        errors.append("state_changes.location should be null for non-move actions.")

    return errors


def apply_action(
    response: LLMResponse,
    agent: AgentState,
    session: Session,
) -> str:
    """Apply a validated action to the agent state. Returns a human-readable event summary."""
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

    # Build event summary
    match action.type:
        case ActionType.SPEAK:
            target_name = _resolve_name(action.target, session)
            summary = f'{agent.name} said to {target_name}: "{action.content}"'
        case ActionType.MOVE:
            summary = f"{agent.name} moved to {agent.location}"
            if action.content:
                summary += f" — {action.content}"
        case ActionType.USE_ITEM:
            summary = f"{agent.name} used {action.target}: {action.content}"
        case ActionType.TRADE:
            target_name = _resolve_name(action.target, session)
            summary = f"{agent.name} traded with {target_name}: {action.content}"
        case ActionType.OBSERVE:
            summary = f"{agent.name} observed: {action.content}"
        case ActionType.WAIT:
            summary = f"{agent.name} waited — {action.content}" if action.content else f"{agent.name} waited"
        case _:
            summary = f"{agent.name}: {action.content}"

    return summary + location_note


def _resolve_name(agent_id: str | None, session: Session) -> str:
    if not agent_id:
        return "nobody"
    agent = session.agents.get(agent_id)
    return agent.name if agent else agent_id
