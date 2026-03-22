"""BABEL — Agent memory management (sliding window)."""

from __future__ import annotations

import random

from .models import AgentState, Event, Session

MAX_MEMORY = 10


def update_agent_memory(agent: AgentState, event_summary: str) -> None:
    """Add an event summary to the agent's memory, keeping the window."""
    agent.memory.append(event_summary)
    if len(agent.memory) > MAX_MEMORY:
        agent.memory = agent.memory[-MAX_MEMORY:]


def get_visible_agents(agent: AgentState, session: Session) -> list[dict]:
    """Get agents visible to this agent (same location or adjacent)."""
    visible = []
    for aid, a in session.agents.items():
        if aid == agent.agent_id:
            continue
        if a.status in ("dead", "gone"):
            continue
        # Same location = fully visible
        if a.location == agent.location:
            visible.append({
                "id": aid,
                "name": a.name,
                "location": a.location,
                "description": a.description,
            })
        # Different location = only know they exist somewhere
        else:
            visible.append({
                "id": aid,
                "name": a.name,
                "location": a.location,
            })
    return visible


def get_recent_events(agent: AgentState, session: Session, limit: int = 8) -> list[str]:
    """Get recent event summaries relevant to this agent."""
    relevant = []
    for event in reversed(session.events):
        if len(relevant) >= limit:
            break
        # Include events involving this agent, or events at their location
        if (
            event.agent_id == agent.agent_id
            or event.agent_id is None  # world events
            or event.result  # all events have summaries
        ):
            relevant.append(f"[Tick {event.tick}] {event.result}")
    return list(reversed(relevant))


# ── Anti-loop: repetition detection + perturbation ──

PERTURBATION_EVENTS = [
    "A stranger walks into the bar, looking around nervously.",
    "The lights flicker — power grid instability.",
    "A loud explosion is heard in the distance.",
    "An encrypted broadcast plays on all channels: 'They are watching.'",
    "A drone crashes through the window, sparking on the floor.",
    "Someone left a mysterious package at the entrance.",
    "The rain outside intensifies, flooding the back alley.",
    "A corporate patrol vehicle is spotted outside.",
    "All communication devices emit a burst of static for 5 seconds.",
    "A cat with cybernetic eyes wanders in from the alley.",
]


def detect_repetition(agent: AgentState, session: Session, threshold: int = 3) -> bool:
    """Check if an agent has repeated the same action type N times in a row."""
    agent_events = [
        e for e in session.events
        if e.agent_id == agent.agent_id
    ]
    if len(agent_events) < threshold:
        return False

    recent = agent_events[-threshold:]
    action_types = [e.action_type for e in recent]
    contents = [e.action.get("content", "") for e in recent]

    # Same action type AND similar content
    if len(set(action_types)) == 1 and len(set(contents)) <= 1:
        return True

    return False


def generate_perturbation() -> str:
    """Generate a random world event to break repetition loops."""
    return random.choice(PERTURBATION_EVENTS)
