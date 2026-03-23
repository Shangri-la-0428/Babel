"""BABEL — LLM integration layer via litellm."""

from __future__ import annotations

import json
import os

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
)

# Suppress litellm debug noise
litellm.suppress_debug_info = True


def _ensure_provider_prefix(model: str, api_base: str | None) -> str:
    """Add 'openai/' prefix when using a custom api_base with a model name
    that litellm would route to OpenAI directly, bypassing api_base."""
    if api_base and "/" not in model:
        return f"openai/{model}"
    return model


def get_model() -> str:
    return os.environ.get("BABEL_MODEL", "gpt-5.4")


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
    )

    raw = await _complete_json(
        SYSTEM_PROMPT, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
    )

    try:
        return LLMResponse(**raw)
    except ValidationError:
        # Try to salvage partial response
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
    except Exception:
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
    )
    return await _complete(
        ORACLE_SYSTEM_PROMPT, user_prompt,
        model=model, api_key=api_key, api_base=api_base,
        temperature=0.85, max_tokens=1024,
    )


async def enrich_entity(
    entity_type: str,
    entity_name: str,
    current_details: dict,
    relevant_events: list[str],
    world_desc: str,
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
        )
        return await _complete_json(
            ENRICHMENT_SYSTEM, user_prompt,
            model=model, api_key=api_key, api_base=api_base,
            temperature=0.7,
        )
    except Exception:
        return current_details or {}
