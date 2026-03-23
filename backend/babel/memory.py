"""BABEL — Agent memory management (structured retrieval + timeline)."""

from __future__ import annotations

import json
import logging
import random

from .db import (
    delete_memories,
    load_events_filtered,
    query_memories,
    save_memory,
    update_memory_access,
)
from .models import ActionType, AgentState, Event, MemoryEntry, Session

logger = logging.getLogger(__name__)

# ── Constants ──

MAX_MEMORY_LEGACY = 10  # backwards-compat sliding window size
SNAPSHOT_INTERVAL = 10
EPOCH_INTERVAL = 5
BELIEF_INTERVAL = 10  # extract beliefs every N ticks

IMPORTANCE_MAP = {
    "speak": 0.6,
    "trade": 0.8,
    "use_item": 0.7,
    "move": 0.3,
    "observe": 0.5,
    "wait": 0.1,
    "world_event": 0.9,
}

# ── Legacy (kept for backwards compatibility) ──


def update_agent_memory(agent: AgentState, event_summary: str) -> None:
    """Add an event summary to the agent's legacy memory (sliding window)."""
    agent.memory.append(event_summary)
    if len(agent.memory) > MAX_MEMORY_LEGACY:
        agent.memory = agent.memory[-MAX_MEMORY_LEGACY:]


# ── Structured Memory: Create ──


def _compute_importance(
    event: Event, agent: AgentState, session: Session | None = None
) -> float:
    """Compute importance score for a memory based on event type and context."""
    at = event.action_type if isinstance(event.action_type, str) else event.action_type.value
    base = IMPORTANCE_MAP.get(at, 0.5)

    # Boost if event involves an agent mentioned in this agent's goals
    goals_text = " ".join(agent.goals).lower()
    if event.agent_name and event.agent_name.lower() in goals_text:
        base += 0.2

    # Self-involvement: own actions are more important
    if event.agent_id == agent.agent_id:
        base += 0.15

    # Being a target / involved party
    if agent.agent_id in event.involved_agents and event.agent_id != agent.agent_id:
        base += 0.1

    # Resource changes are significant
    if at == "trade":
        base += 0.1

    # Relation-aware: events involving close relations matter more
    if session and event.agent_id and event.agent_id != agent.agent_id:
        rel = session.get_relation(agent.agent_id, event.agent_id)
        if rel and rel.strength > 0.7:
            base += 0.15

    return min(base, 1.0)


def _extract_tags(event: Event, agent: AgentState) -> list[str]:
    """Extract searchable tags from an event."""
    tags: list[str] = []

    # Location tag
    loc = event.location or agent.location
    if loc:
        tags.append(f"location:{loc}")

    # Involved agent tags
    if event.agent_id and event.agent_id != agent.agent_id:
        tags.append(f"agent:{event.agent_id}")
    if event.agent_name:
        tags.append(f"name:{event.agent_name}")

    # Action type tag
    at = event.action_type if isinstance(event.action_type, str) else event.action_type.value
    tags.append(f"action:{at}")

    # Target tag
    target = event.action.get("target")
    if target:
        tags.append(f"target:{target}")

    return tags


def _categorize_event(event: Event) -> str:
    """Determine memory category from event type."""
    at = event.action_type if isinstance(event.action_type, str) else event.action_type.value
    if at == "world_event":
        return "episodic"
    if at == "speak":
        return "social"
    if at in ("trade", "use_item"):
        return "episodic"
    return "episodic"


def _derive_semantic(event: Event, agent: AgentState) -> dict:
    """Derive semantic metadata for a memory from the event's structured field.

    Rule-driven — no LLM. Maps structured event verbs to semantic types.
    """
    structured = event.structured
    if not structured:
        return {}

    verb = structured.get("verb", "")
    semantic: dict = {}

    # Map verb to semantic type
    type_map = {
        "spoke_to": "social_interaction",
        "traded_with": "resource_exchange",
        "moved_to": "movement",
        "used_item": "item_usage",
        "observed": "observation",
        "waited": "idle",
    }
    semantic["type"] = type_map.get(verb, "unknown")

    # Who was involved
    obj = structured.get("object")
    if obj:
        semantic["with"] = obj

    # Sentiment heuristic based on verb
    if verb in ("spoke_to", "traded_with"):
        semantic["sentiment"] = "positive"
    elif verb == "waited":
        semantic["sentiment"] = "neutral"
    else:
        semantic["sentiment"] = "neutral"

    # Topic from content key
    content_key = structured.get("content_key", "")
    if content_key:
        semantic["topic"] = content_key[:80]

    return semantic


async def create_memory_from_event(
    agent: AgentState, event: Event, session: Session
) -> MemoryEntry:
    """Create a structured memory from an event and persist it."""
    importance = _compute_importance(event, agent, session)
    tags = _extract_tags(event, agent)
    category = _categorize_event(event)
    semantic = _derive_semantic(event, agent)

    mem = MemoryEntry(
        session_id=session.id,
        agent_id=agent.agent_id,
        tick=event.tick,
        content=event.result,
        semantic=semantic,
        category=category,
        importance=importance,
        tags=tags,
        source_event_id=event.id,
    )
    await save_memory(mem)
    return mem


# ── Structured Memory: Retrieve ──


def _build_context_tags(agent: AgentState, session: Session) -> list[str]:
    """Build context tags from agent's current state for relevance scoring."""
    tags: list[str] = []

    # Current location
    if agent.location:
        tags.append(f"location:{agent.location}")

    # Visible agents at same location
    for aid, a in session.agents.items():
        if aid == agent.agent_id or a.status.value in ("dead", "gone"):
            continue
        if a.location == agent.location:
            tags.append(f"agent:{aid}")
            tags.append(f"name:{a.name}")

    # Goal keywords (simple extraction)
    for goal in agent.goals:
        for word in goal.split():
            if len(word) > 2:
                tags.append(f"goal:{word}")

    return tags


def _score_memory(
    mem: dict,
    current_tick: int,
    context_tags: list[str],
) -> float:
    """Score a memory by recency, importance, relevance, and access decay."""
    recency = 1.0 / (1 + (current_tick - mem["tick"]) * 0.1)
    importance = mem.get("importance", 0.5)

    # Tag overlap for relevance
    mem_tags = set(mem.get("tags", []))
    ctx_set = set(context_tags)
    overlap = len(mem_tags & ctx_set)
    relevance = overlap / max(len(ctx_set), 1)

    # Access decay — frequently accessed memories score slightly lower
    access_count = mem.get("access_count", 0)
    access_decay = 1.0 / (1 + access_count * 0.05)

    return 0.3 * recency + 0.35 * importance + 0.25 * relevance + 0.1 * access_decay


async def retrieve_relevant_memories(
    agent: AgentState, session: Session, limit: int = 8
) -> list[dict]:
    """Retrieve the most relevant memories for an agent's current context."""
    # Get candidate memories from DB
    candidates = await query_memories(session.id, agent.agent_id, limit=50)
    if not candidates:
        return []

    # Build context tags
    context_tags = _build_context_tags(agent, session)

    # Score each candidate
    scored = []
    for mem in candidates:
        score = _score_memory(mem, session.tick, context_tags)
        scored.append((score, mem))

    # Sort by score descending, take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:limit]

    # Update access count for retrieved memories
    for _, mem in top:
        await update_memory_access(mem["id"], session.tick)

    return [mem for _, mem in top]


# ── Structured Memory: Consolidation ──


async def consolidate_memories(
    session: Session,
    agent_id: str,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> None:
    """Consolidate episodic memories into semantic memories.

    Improvements over v1:
    - High-importance memories (>= 0.8) are protected — never compressed.
    - Uses LLM summarization for semantic compression (falls back to concat).
    - Groups by agent tag for coherent summaries.
    """
    episodic = await query_memories(
        session.id, agent_id, category="episodic", limit=100
    )
    if len(episodic) < 6:
        return

    # Protect high-importance memories from compression
    compressible = [m for m in episodic if m.get("importance", 0.5) < 0.8]
    if len(compressible) < 5:
        return

    # Group by agent tag
    agent_groups: dict[str, list[dict]] = {}
    for mem in compressible:
        tags = mem.get("tags", [])
        for tag in tags:
            if tag.startswith("agent:") or tag.startswith("name:"):
                agent_groups.setdefault(tag, []).append(mem)

    for tag, mems in agent_groups.items():
        if len(mems) < 3:
            continue

        # Take oldest memories about this agent
        mems.sort(key=lambda m: m["tick"])
        to_merge = mems[:5]  # up to 5 for richer summaries
        max_importance = max(m.get("importance", 0.5) for m in to_merge)
        contents = [m["content"] for m in to_merge]

        # Try LLM summarization, fall back to string concat
        try:
            from .llm import summarize_memories
            summary = await summarize_memories(
                contents,
                world_desc=session.world_seed.description,
                model=model,
                api_key=api_key,
                api_base=api_base,
            )
        except Exception:
            # Fallback: original concat approach
            entity = tag.split(":", 1)[1] if ":" in tag else tag
            summary = f"[Summary about {entity}] " + " | ".join(
                c[:80] for c in contents
            )

        # Collect all tags from merged memories
        all_tags: set[str] = set()
        for m in to_merge:
            all_tags.update(m.get("tags", []))

        semantic = MemoryEntry(
            session_id=session.id,
            agent_id=agent_id,
            tick=session.tick,
            content=summary,
            category="semantic",
            importance=min(max_importance + 0.1, 1.0),
            tags=list(all_tags),
        )
        await save_memory(semantic)

        # Delete merged episodic memories
        ids_to_delete = [m["id"] for m in to_merge]
        await delete_memories(ids_to_delete)


# ── Belief Extraction (rule-driven, zero LLM cost) ──


async def extract_beliefs(agent_id: str, session: Session) -> list[MemoryEntry]:
    """Extract beliefs from recent memories and relations. Rule-driven, no LLM.

    Belief patterns:
    1. Hostile relation → "{name} is dangerous / untrustworthy"
    2. Ally/trust relation → "{name} is a reliable ally"
    3. Repeated trade success with same agent → "{name} is a good trade partner"
    4. World events at a location → "{location} is unstable"
    5. Repeated successful actions at a location → "{location} is resourceful"
    """
    agent = session.agents.get(agent_id)
    if not agent:
        return []

    # Load existing beliefs to avoid duplicates
    existing_beliefs = await query_memories(
        session.id, agent_id, category="belief", limit=50
    )
    existing_subjects = set()
    existing_ids_by_subject: dict[str, str] = {}
    for b in existing_beliefs:
        # Extract subject from content like "Belief: {subject} — ..."
        content = b.get("content", "")
        if " — " in content:
            subj = content.split(" — ")[0].replace("Belief: ", "")
            existing_subjects.add(subj)
            existing_ids_by_subject[subj] = b["id"]

    new_beliefs: list[MemoryEntry] = []

    # ── Pattern 1 & 2: Relation-derived beliefs ──
    for rel in session.relations:
        if rel.source != agent_id:
            continue
        target = session.agents.get(rel.target)
        if not target or target.status.value in ("dead", "gone"):
            continue

        subject = target.name
        if rel.type == "hostile" and rel.strength <= 0.2:
            belief_text = f"Belief: {subject} — dangerous and untrustworthy"
        elif rel.type == "rival" and rel.strength <= 0.35:
            belief_text = f"Belief: {subject} — rival, approach with caution"
        elif rel.type == "ally" and rel.strength >= 0.8:
            belief_text = f"Belief: {subject} — trusted ally"
        elif rel.type == "trust" and rel.strength >= 0.6:
            belief_text = f"Belief: {subject} — reliable, can be trusted"
        else:
            continue

        if subject in existing_subjects:
            # Update existing belief if relation changed
            old_id = existing_ids_by_subject.get(subject)
            if old_id:
                await delete_memories([old_id])
        existing_subjects.add(subject)

        mem = MemoryEntry(
            session_id=session.id,
            agent_id=agent_id,
            tick=session.tick,
            content=belief_text,
            category="belief",
            importance=0.7,
            tags=[f"belief:agent", f"target:{rel.target}", f"name:{subject}"],
        )
        await save_memory(mem)
        new_beliefs.append(mem)

    # ── Pattern 3: Trade-derived beliefs (from social memories) ──
    social = await query_memories(session.id, agent_id, category="social", limit=30)
    trade_mems = [
        m for m in await query_memories(session.id, agent_id, category="episodic", limit=50)
        if any(t.startswith("action:trade") for t in m.get("tags", []))
    ]

    # Count trades per target agent
    trade_counts: dict[str, int] = {}
    for m in trade_mems:
        for tag in m.get("tags", []):
            if tag.startswith("target:"):
                target_id = tag.split(":", 1)[1]
                trade_counts[target_id] = trade_counts.get(target_id, 0) + 1

    for target_id, count in trade_counts.items():
        if count < 3:
            continue
        target = session.agents.get(target_id)
        if not target:
            continue
        subject = f"{target.name} (trade)"
        if subject in existing_subjects:
            continue
        existing_subjects.add(subject)

        mem = MemoryEntry(
            session_id=session.id,
            agent_id=agent_id,
            tick=session.tick,
            content=f"Belief: {target.name} — frequent trade partner",
            category="belief",
            importance=0.6,
            tags=[f"belief:trade", f"target:{target_id}", f"name:{target.name}"],
        )
        await save_memory(mem)
        new_beliefs.append(mem)

    # ── Pattern 4: Location instability (world_events at specific locations) ──
    episodic = await query_memories(session.id, agent_id, category="episodic", limit=50)
    loc_events: dict[str, int] = {}
    for m in episodic:
        tags = m.get("tags", [])
        is_world_event = any(t == "action:world_event" for t in tags)
        if not is_world_event:
            continue
        for tag in tags:
            if tag.startswith("location:"):
                loc_name = tag.split(":", 1)[1]
                loc_events[loc_name] = loc_events.get(loc_name, 0) + 1

    for loc_name, count in loc_events.items():
        if count < 2:
            continue
        subject = f"{loc_name} (stability)"
        if subject in existing_subjects:
            continue
        existing_subjects.add(subject)

        mem = MemoryEntry(
            session_id=session.id,
            agent_id=agent_id,
            tick=session.tick,
            content=f"Belief: {loc_name} — unstable, frequent disturbances",
            category="belief",
            importance=0.6,
            tags=[f"belief:location", f"location:{loc_name}"],
        )
        await save_memory(mem)
        new_beliefs.append(mem)

    return new_beliefs


async def get_agent_beliefs(
    session_id: str, agent_id: str, limit: int = 5
) -> list[str]:
    """Retrieve belief content strings for prompt injection."""
    beliefs = await query_memories(session_id, agent_id, category="belief", limit=limit)
    return [b["content"] for b in beliefs]


# ── Event Retrieval (location-filtered, replaces get_recent_events) ──


async def get_relevant_events(
    agent: AgentState, session: Session, limit: int = 8
) -> list[str]:
    """Get recent events relevant to this agent (by location + involvement).

    Returns formatted strings for prompt inclusion.
    """
    # Calculate lookback window
    min_tick = max(0, session.tick - 10)

    events = await load_events_filtered(
        session_id=session.id,
        agent_id=agent.agent_id,
        location=agent.location,
        min_tick=min_tick,
        limit=limit,
    )

    return [f"[Tick {e['tick']}] {e['result']}" for e in events if e.get("result")]


# ── Visibility (unchanged logic) ──


def get_visible_agents(agent: AgentState, session: Session) -> list[dict]:
    """Get agents visible to this agent (same location or elsewhere)."""
    visible = []
    for aid, a in session.agents.items():
        if aid == agent.agent_id:
            continue
        if a.status.value in ("dead", "gone"):
            continue
        if a.location == agent.location:
            visible.append({
                "id": aid,
                "name": a.name,
                "location": a.location,
                "description": a.description,
            })
        else:
            visible.append({
                "id": aid,
                "name": a.name,
                "location": a.location,
            })
    return visible


# ── Anti-loop: repetition detection + perturbation ──

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


async def detect_repetition(
    agent: AgentState, session: Session, threshold: int = 3
) -> bool:
    """Check if an agent has repeated the same action type N times in a row (DB query)."""
    events = await load_events_filtered(
        session_id=session.id,
        agent_id=agent.agent_id,
        limit=threshold,
    )
    if len(events) < threshold:
        return False

    action_types = [e.get("action_type", "") for e in events]
    contents = []
    for e in events:
        action = e.get("action", {})
        if isinstance(action, str):
            action = json.loads(action)
        contents.append(action.get("content", ""))

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
    """Generate a world event to break repetition loops."""
    if session is None:
        return _template_perturbation(session)

    try:
        from .llm import generate_world_event

        recent = await get_relevant_events_for_perturbation(session)
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


async def get_relevant_events_for_perturbation(session: Session) -> list[str]:
    """Get recent events for perturbation context (DB query)."""
    events = await load_events_filtered(
        session_id=session.id,
        min_tick=max(0, session.tick - 10),
        limit=10,
    )
    return [f"[Tick {e['tick']}] {e['result']}" for e in events if e.get("result")]
