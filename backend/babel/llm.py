"""BABEL — LLM integration layer via litellm."""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

import litellm
from pydantic import ValidationError

from .models import LLMResponse
from .prompts import (
    SYSTEM_PROMPT,
    build_user_prompt,
    CHAT_SYSTEM_PROMPT,
    build_chat_prompt,
    CHARACTER_DETECT_SYSTEM,
    build_character_detect_prompt,
    PERTURBATION_SYSTEM_PROMPT,
    build_perturbation_prompt,
    ENRICHMENT_SYSTEM,
    build_enrichment_prompt,
    ORACLE_SYSTEM_PROMPT,
    build_oracle_prompt,
    ORACLE_CREATIVE_SYSTEM,
    build_creative_prompt,
    CHAPTER_SYSTEM_PROMPT,
    build_chapter_prompt,
)

# Suppress litellm debug noise
litellm.suppress_debug_info = True

_TIME_PERIOD_PRESETS: dict[str, dict[str, int | str]] = {
    "dawn": {"name": "dawn", "start": 5, "end": 8},
    "morning": {"name": "morning", "start": 8, "end": 12},
    "day": {"name": "day", "start": 8, "end": 18},
    "afternoon": {"name": "afternoon", "start": 12, "end": 17},
    "dusk": {"name": "dusk", "start": 18, "end": 21},
    "evening": {"name": "evening", "start": 18, "end": 22},
    "night": {"name": "night", "start": 21, "end": 5},
}


def _ensure_provider_prefix(model: str, api_base: str | None) -> str:
    """Add 'openai/' prefix when using a custom api_base with a model name
    that litellm would route to OpenAI directly, bypassing api_base."""
    if api_base and "/" not in model:
        return f"openai/{model}"
    return model


def get_model() -> str:
    return os.environ.get("BABEL_MODEL", "gpt-4o-mini")


def get_api_key() -> str | None:
    return os.environ.get("BABEL_API_KEY") or os.environ.get("OPENAI_API_KEY")


def get_api_base() -> str | None:
    return os.environ.get("BABEL_API_BASE") or os.environ.get("OPENAI_API_BASE")


# ── Shared LLM helpers ───────────────────────────────


def _parse_json(text: str) -> dict:
    """Parse JSON from LLM output, stripping markdown code blocks."""
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(l for l in lines if not l.strip().startswith("```"))
    return json.loads(text.strip())


def _normalize_string_list(value: object) -> list[str]:
    """Coerce common LLM list drift into a clean string list."""
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        parts = value.split("\n") if "\n" in value else value.split(",")
        return [part.strip() for part in parts if part.strip()]
    return []


def _normalize_time_periods(periods: object) -> list[dict]:
    """Accept common shorthand like ['Dawn', 'Night'] and expand to dict entries."""
    if not isinstance(periods, list):
        return []

    normalized: list[dict] = []
    for idx, period in enumerate(periods):
        if isinstance(period, dict):
            normalized.append(period)
            continue
        if not isinstance(period, str):
            continue

        key = period.strip().lower()
        if not key:
            continue

        preset = _TIME_PERIOD_PRESETS.get(key)
        if preset:
            normalized.append(dict(preset))
            continue

        normalized.append({
            "name": period.strip(),
            "start": idx,
            "end": idx + 1,
        })
    return normalized


def _normalize_seed_draft(raw: dict) -> dict:
    """Repair common model drift before strict WorldSeed validation."""
    if not isinstance(raw, dict):
        return raw

    normalized = dict(raw)
    normalized["rules"] = _normalize_string_list(normalized.get("rules", []))
    normalized["initial_events"] = _normalize_string_list(normalized.get("initial_events", []))

    locations = []
    for loc in normalized.get("locations", []):
        if not isinstance(loc, dict):
            continue
        next_loc = dict(loc)
        next_loc["tags"] = _normalize_string_list(next_loc.get("tags", []))
        next_loc["connections"] = _normalize_string_list(next_loc.get("connections", []))
        locations.append(next_loc)
    if locations:
        normalized["locations"] = locations

    agents = []
    for agent in normalized.get("agents", []):
        if not isinstance(agent, dict):
            continue
        next_agent = dict(agent)
        next_agent["goals"] = _normalize_string_list(next_agent.get("goals", []))
        next_agent["inventory"] = _normalize_string_list(next_agent.get("inventory", []))
        agents.append(next_agent)
    if agents:
        normalized["agents"] = agents

    time = normalized.get("time")
    if isinstance(time, dict):
        next_time = dict(time)
        next_time["periods"] = _normalize_time_periods(next_time.get("periods", []))
        normalized["time"] = next_time

    return normalized


async def _complete(
    system: str,
    user: str,
    *,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
    temperature: float = 0.8,
    max_tokens: int = 512,
    json_mode: bool = False,
) -> str:
    """Low-level LLM completion. Returns raw content string."""
    model = model or get_model()
    api_key = api_key or get_api_key()
    api_base = api_base or get_api_base()
    model = _ensure_provider_prefix(model, api_base)

    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base
    if json_mode and ("gpt" in model or "o1" in model or "o3" in model or "o4" in model):
        kwargs["response_format"] = {"type": "json_object"}

    response = await litellm.acompletion(**kwargs)
    return response.choices[0].message.content.strip()


async def _complete_json(
    system: str,
    user: str,
    **kwargs,
) -> dict:
    """LLM completion that returns parsed JSON dict."""
    raw = await _complete(system, user, json_mode=True, **kwargs)
    return _parse_json(raw)


# ── Public API ────────────────────────────────────────


async def get_agent_action(
    world_rules: list[str],
    agent_name: str,
    agent_personality: str,
    agent_goals: list[str],
    agent_location: str,
    agent_inventory: list[str],
    agent_memory: list[str],
    tick: int,
    visible_agents: list[dict],
    recent_events: list[str],
    available_locations: list[str],
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
    urgent_events: list[str] | None = None,
    world_time_display: str = "",
    world_time_period: str = "",
    agent_relations: list[dict] | None = None,
    reachable_locations: list[str] | None = None,
    agent_beliefs: list[str] | None = None,
    active_goal: dict | None = None,
    ongoing_intent: dict | None = None,
    last_outcome: str = "",
    emotional_context: str = "",
    item_context: dict[str, str] | None = None,
    location_context: dict[str, str] | None = None,
    world_description: str = "",
) -> LLMResponse:
    """Get a validated agent action from the LLM."""
    user_prompt = build_user_prompt(
        world_rules=world_rules,
        agent_name=agent_name,
        agent_personality=agent_personality,
        agent_goals=agent_goals,
        agent_location=agent_location,
        agent_inventory=agent_inventory,
        agent_memory=agent_memory,
        tick=tick,
        visible_agents=visible_agents,
        recent_events=recent_events,
        available_locations=available_locations,
        urgent_events=urgent_events,
        world_time_display=world_time_display,
        world_time_period=world_time_period,
        agent_relations=agent_relations,
        reachable_locations=reachable_locations,
        agent_beliefs=agent_beliefs,
        active_goal=active_goal,
        ongoing_intent=ongoing_intent,
        last_outcome=last_outcome,
        emotional_context=emotional_context,
        item_context=item_context,
        location_context=location_context,
        world_description=world_description,
    )

    raw = await _complete_json(
        SYSTEM_PROMPT, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
    )

    try:
        return LLMResponse(**raw)
    except ValidationError:
        # Try to salvage partial response
        if "intent" not in raw:
            raw["intent"] = {
                "objective": str(raw.get("objective", "") or ""),
                "approach": str(raw.get("approach", "") or ""),
                "next_step": str(raw.get("next_step", "") or ""),
                "rationale": str(raw.get("rationale", "") or ""),
            }
        if "action" in raw and isinstance(raw["action"], dict):
            if "type" not in raw["action"]:
                raw["action"]["type"] = "wait"
            return LLMResponse(**raw)
        raise


async def chat_with_agent(
    agent_name: str,
    agent_personality: str,
    agent_goals: list[str],
    agent_location: str,
    agent_inventory: list[str],
    agent_memory: list[str],
    agent_description: str,
    user_message: str,
    preferred_language: str = "",
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Have an agent reply to a user message in character."""
    user_prompt = build_chat_prompt(
        agent_name=agent_name,
        agent_personality=agent_personality,
        agent_goals=agent_goals,
        agent_location=agent_location,
        agent_inventory=agent_inventory,
        agent_memory=agent_memory,
        agent_description=agent_description,
        user_message=user_message,
        preferred_language=preferred_language,
    )
    return await _complete(
        CHAT_SYSTEM_PROMPT, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
        temperature=0.9,
    )


async def generate_world_event(
    world_description: str,
    world_rules: list[str],
    locations: list[str],
    recent_events: list[str],
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Use LLM to generate a world event for perturbation."""
    user_prompt = build_perturbation_prompt(
        world_description=world_description,
        world_rules=world_rules,
        locations=locations,
        recent_events=recent_events,
    )
    content = await _complete(
        PERTURBATION_SYSTEM_PROMPT, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
        temperature=1.0, max_tokens=256,
    )
    return content.strip('"\'`')


async def detect_new_character(
    content: str,
    existing_names: list[str],
    locations: list[str],
    world_desc: str,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> dict | None:
    """Detect whether an injected event introduces a new named character.

    Returns dict with {name, description, personality, location} or None.
    Never raises — failures are silently swallowed so injection is not blocked.
    """
    try:
        user_prompt = build_character_detect_prompt(
            content=content,
            existing_names=existing_names,
            locations=locations,
            world_desc=world_desc,
        )
        data = await _complete_json(
            CHARACTER_DETECT_SYSTEM, user_prompt,
            model=model, api_key=api_key, api_base=api_base,
            temperature=0.3, max_tokens=256,
        )
        result = data.get("result")
        if not isinstance(result, dict) or not result.get("name"):
            return None
        return {
            "name": result["name"],
            "description": result.get("description", ""),
            "personality": result.get("personality", ""),
            "location": result.get("location", ""),
        }
    except Exception as e:
        logger.debug("Character detection failed: %s", e)
        return None


async def chat_with_oracle(
    world_name: str,
    world_description: str,
    world_rules: list[str],
    agents: dict,
    recent_events: list[str],
    enriched_details: dict,
    conversation_history: list[dict],
    user_message: str,
    narrator_persona: str = "",
    world_time_display: str = "",
    preferred_language: str = "",
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Have the omniscient Oracle narrator respond to the user."""
    user_prompt = build_oracle_prompt(
        world_name=world_name,
        world_description=world_description,
        world_rules=world_rules,
        agents=agents,
        recent_events=recent_events,
        enriched_details=enriched_details,
        conversation_history=conversation_history,
        user_message=user_message,
        narrator_persona=narrator_persona,
        world_time_display=world_time_display,
        preferred_language=preferred_language,
    )
    return await _complete(
        ORACLE_SYSTEM_PROMPT, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
        temperature=0.85, max_tokens=1024,
    )


MEMORY_SUMMARIZE_SYSTEM = """\
You are a memory consolidation engine for an AI agent in a simulated world. \
Your job is to compress multiple episodic memories into a concise semantic summary.

Rules:
- Output 1-2 sentences ONLY. No markdown, no bullet points.
- Preserve: key facts, names, relationships, outcomes, emotional impact.
- Discard: timestamps, repeated details, filler.
- Write from the agent's perspective (third person is fine).
- Output plain text, nothing else.\
"""


async def summarize_memories(
    memories: list[str],
    world_desc: str = "",
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Compress 3-5 episodic memories into a 1-2 sentence semantic summary."""
    items = "\n".join(f"- {m}" for m in memories)
    user = f"[World]\n{world_desc}\n\n[Memories to consolidate]\n{items}"

    return await _complete(
        MEMORY_SUMMARIZE_SYSTEM, user,
        model=model, api_key=api_key, api_base=api_base,
        temperature=0.3, max_tokens=128,
    )


GOAL_REPLAN_SYSTEM = """\
You are a goal replanning engine for an AI agent in a simulated world. \
An agent's current goal has stalled (no progress for several turns). Suggest a new, more achievable goal plan.

Rules:
- Output ONLY valid JSON matching the schema below.
- The goal should be more specific and actionable than the stalled one.
- It should still relate to the agent's core personality and motivations.
- Consider what actions are actually available (speak, move, use_item, trade, observe, wait).
- Keep blockers short and concrete.

Output JSON schema:
{
  "text": "short goal statement",
  "strategy": "how the agent plans to pursue it",
  "next_step": "the next immediate step",
  "success_criteria": "what would count as meaningful progress or success",
  "blockers": ["optional blocker 1", "optional blocker 2"]
}\
"""


def _normalize_goal_plan(raw: object, fallback_goal: str) -> dict:
    """Coerce replanning output into a structured goal plan."""
    if isinstance(raw, str):
        text = raw.strip() or fallback_goal
        return {
            "text": text,
            "strategy": "",
            "next_step": "",
            "success_criteria": "",
            "blockers": [],
        }

    if not isinstance(raw, dict):
        return _normalize_goal_plan("", fallback_goal)

    text = str(raw.get("text", "") or "").strip() or fallback_goal
    strategy = str(raw.get("strategy", "") or "").strip()
    next_step = str(raw.get("next_step", "") or "").strip()
    success_criteria = str(raw.get("success_criteria", "") or "").strip()
    blockers = _normalize_string_list(raw.get("blockers", []))

    return {
        "text": text,
        "strategy": strategy,
        "next_step": next_step,
        "success_criteria": success_criteria,
        "blockers": blockers,
    }


async def replan_goal(
    agent_name: str,
    agent_personality: str,
    current_goals: list[str],
    stalled_goal: str,
    agent_memory: list[str],
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
    drive_state: dict[str, float] | None = None,
) -> dict:
    """Suggest a new sub-goal when current goal is stalled."""
    goals_text = "\n".join(f"- {g}" for g in current_goals) if current_goals else "(none)"
    memory_text = "\n".join(f"- {m}" for m in agent_memory[-5:]) if agent_memory else "(no memories)"

    drive_section = ""
    if drive_state:
        low = [f"{d}: {int(v)}" for d, v in drive_state.items() if v < 40]
        high = [f"{d}: {int(v)}" for d, v in drive_state.items() if v >= 70]
        if low or high:
            parts = []
            if low:
                parts.append(f"Unsatisfied: {', '.join(low)}")
            if high:
                parts.append(f"Satisfied: {', '.join(high)}")
            drive_section = f"\n[Emotional Drives]\n" + "\n".join(parts) + "\n"

    user = f"""\
[Agent]
Name: {agent_name}
Personality: {agent_personality}

[Core Goals]
{goals_text}

[Stalled Goal]
"{stalled_goal}"

[Recent Memory]
{memory_text}
{drive_section}
[Instruction]
This goal has stalled. Suggest a new, more achievable goal plan as JSON."""

    try:
        content = await _complete_json(
            GOAL_REPLAN_SYSTEM, user,
            model=model, api_key=api_key, api_base=api_base,
            temperature=0.7, max_tokens=256,
        )
    except Exception:
        fallback = await _complete(
            GOAL_REPLAN_SYSTEM, user,
            model=model, api_key=api_key, api_base=api_base,
            temperature=0.7, max_tokens=128,
        )
        return _normalize_goal_plan(fallback.strip('"\'`'), stalled_goal)

    return _normalize_goal_plan(content, stalled_goal)


async def enrich_entity(
    entity_type: str,
    entity_name: str,
    current_details: dict,
    relevant_events: list[str],
    world_desc: str,
    preferred_language: str = "",
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> dict:
    """Generate or update rich narrative details for a world entity.

    Returns the enriched details dict. Never raises — returns current_details
    (or empty dict) on failure.
    """
    try:
        user_prompt = build_enrichment_prompt(
            entity_type=entity_type,
            entity_name=entity_name,
            current_details=current_details,
            relevant_events=relevant_events,
            world_desc=world_desc,
            preferred_language=preferred_language,
        )
        return await _complete_json(
            ENRICHMENT_SYSTEM, user_prompt,
            model=model, api_key=api_key, api_base=api_base,
            temperature=0.7,
        )
    except Exception as e:
        logger.debug("Entity enrichment failed for %s/%s: %s", entity_type, entity_name, e)
        return current_details or {}


async def generate_seed_draft(
    user_message: str,
    conversation_history: list[dict] | None = None,
    preferred_language: str = "",
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> dict:
    """Generate a WorldSeed JSON draft from a user's world idea.

    Output is validated against WorldSeed.model_validate() before returning.
    Raises ValueError if the LLM output cannot be parsed into a valid WorldSeed.
    """
    from .models import WorldSeed

    user_prompt = build_creative_prompt(
        user_message=user_message,
        conversation_history=conversation_history,
        preferred_language=preferred_language,
    )

    raw = await _complete_json(
        ORACLE_CREATIVE_SYSTEM, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
        temperature=0.85, max_tokens=2048,
    )
    raw = _normalize_seed_draft(raw)

    # Validate: must parse into a valid WorldSeed
    try:
        seed = WorldSeed.model_validate(raw)
    except Exception as e:
        logger.warning("Generated seed failed validation: %s", e)
        raise ValueError(f"Generated seed failed validation: {e}") from e

    # Verify bidirectional connections
    location_names = {loc.name for loc in seed.locations}
    for loc in seed.locations:
        for conn in loc.connections:
            if conn not in location_names:
                raise ValueError(
                    f"Location '{loc.name}' connects to '{conn}' which does not exist"
                )

    # Verify agent locations
    for agent in seed.agents:
        if agent.location and agent.location not in location_names:
            raise ValueError(
                f"Agent '{agent.name}' is at '{agent.location}' which does not exist"
            )

    return seed.model_dump()


# ── Chapter narrator ────────────────────────────────────

async def generate_chapter(
    pov_name: str,
    pov_personality: str,
    pov_location: str,
    pov_goals: list[str],
    pov_inventory: list[str],
    tick_events: list[str],
    previous_chapter: str = "",
    world_description: str = "",
    world_time_display: str = "",
    *,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
) -> str:
    """Generate a novel chapter from one character's POV after a tick."""
    user_prompt = build_chapter_prompt(
        pov_name=pov_name,
        pov_personality=pov_personality,
        pov_location=pov_location,
        pov_goals=pov_goals,
        pov_inventory=pov_inventory,
        tick_events=tick_events,
        previous_chapter=previous_chapter,
        world_description=world_description,
        world_time_display=world_time_display,
    )
    return await _complete(
        CHAPTER_SYSTEM_PROMPT,
        user_prompt,
        model=model,
        api_key=api_key,
        api_base=api_base,
        temperature=0.85,
        max_tokens=1024,
    )
