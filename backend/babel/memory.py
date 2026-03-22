"""BABEL — Agent memory management (sliding window)."""

from __future__ import annotations

import logging
import random

from .models import AgentState, Event, Session

logger = logging.getLogger(__name__)

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

# Generic perturbation templates — {location} is filled from the world seed
_PERTURBATION_TEMPLATES = [
    "A stranger arrives, looking around nervously.",
    "A distant rumbling is heard — something is shifting.",
    "An unexpected sound echoes through {location}.",
    "Someone has left a mysterious object near the entrance.",
    "The air grows tense — something is about to happen.",
    "A messenger arrives with urgent but garbled news.",
    "A loud crash is heard from the direction of {location}.",
    "An old secret is whispered among the crowd: someone is not who they claim.",
    "Supplies have gone missing — suspicion spreads.",
    "A previously locked door is found ajar.",
    "The weather shifts dramatically without warning.",
    "A scream echoes from somewhere nearby, then silence.",
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


def _template_perturbation(session: Session | None = None) -> str:
    """Fallback: generate a perturbation from templates."""
    template = random.choice(_PERTURBATION_TEMPLATES)
    if session and session.world_seed.locations:
        loc = random.choice(session.world_seed.locations)
        return template.format(location=loc.name)
    return template.replace(" {location}", "")


async def generate_perturbation(
    session: Session | None = None,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Generate a world event to break repetition loops.

    Tries LLM first; falls back to template selection on failure.
    """
    if session is None:
        return _template_perturbation(session)

    try:
        from .llm import generate_world_event

        recent = [
            f"[Tick {e.tick}] {e.result}"
            for e in session.events[-10:]
        ]
        result = await generate_world_event(
            world_description=session.world_seed.description,
            world_rules=session.world_seed.rules,
            locations=session.location_names,
            recent_events=recent,
            model=model,
            api_key=api_key,
            api_base=api_base,
        )
        if result:
            return result
    except Exception as e:
        logger.warning("LLM perturbation failed, using template fallback: %s", e)

    return _template_perturbation(session)
