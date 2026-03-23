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


async def call_llm(
    user_prompt: str,
    model: str | None = None,
    api_key: str | None = None,
    api_base: str | None = None,
    temperature: float = 0.8,
) -> dict:
    """Call LLM and return raw parsed JSON dict."""
    model = model or get_model()
    api_key = api_key or get_api_key()
    api_base = api_base or get_api_base()
    model = _ensure_provider_prefix(model, api_base)

    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": 512,
    }

    if api_key:
        kwargs["api_key"] = api_key

    if api_base:
        kwargs["api_base"] = api_base

    # Force JSON output where supported
    if "gpt" in model or "o1" in model or "o3" in model or "o4" in model:
        kwargs["response_format"] = {"type": "json_object"}

    response = await litellm.acompletion(**kwargs)
    content = response.choices[0].message.content.strip()

    # Parse JSON — handle markdown code blocks
    if content.startswith("```"):
        lines = content.split("\n")
        # Remove first and last lines (```json and ```)
        content = "\n".join(
            line for line in lines
            if not line.strip().startswith("```")
        )

    return json.loads(content)


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
    )

    raw = await call_llm(user_prompt, model=model, api_key=api_key, api_base=api_base)

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
    model = model or get_model()
    api_key = api_key or get_api_key()
    api_base = api_base or get_api_base()
    model = _ensure_provider_prefix(model, api_base)

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

    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": CHAT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.9,
        "max_tokens": 512,
    }

    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base

    response = await litellm.acompletion(**kwargs)
    return response.choices[0].message.content.strip()


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
    model = model or get_model()
    api_key = api_key or get_api_key()
    api_base = api_base or get_api_base()
    model = _ensure_provider_prefix(model, api_base)

    user_prompt = build_perturbation_prompt(
        world_description=world_description,
        world_rules=world_rules,
        locations=locations,
        recent_events=recent_events,
    )

    kwargs: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": PERTURBATION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 1.0,
        "max_tokens": 256,
    }

    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base

    response = await litellm.acompletion(**kwargs)
    content = response.choices[0].message.content.strip()
    # Strip any accidental quotes or markdown
    content = content.strip('"\'`')
    return content


def _strip_json(text: str) -> str:
    """Strip markdown code block wrappers from JSON text."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(
            line for line in lines
            if not line.strip().startswith("```")
        )
    return text.strip()


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
        model = model or get_model()
        api_key = api_key or get_api_key()
        api_base = api_base or get_api_base()
        model = _ensure_provider_prefix(model, api_base)

        user_prompt = build_character_detect_prompt(
            content=content,
            existing_names=existing_names,
            locations=locations,
            world_desc=world_desc,
        )

        kwargs: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": CHARACTER_DETECT_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 256,
        }

        if api_key:
            kwargs["api_key"] = api_key
        if api_base:
            kwargs["api_base"] = api_base

        # Force JSON output where supported
        if "gpt" in model or "o1" in model or "o3" in model or "o4" in model:
            kwargs["response_format"] = {"type": "json_object"}

        response = await litellm.acompletion(**kwargs)
        raw = _strip_json(response.choices[0].message.content.strip())
        data = json.loads(raw)

        result = data.get("result")
        if result is None:
            return None

        # Validate required fields
        if not isinstance(result, dict):
            return None
        if not result.get("name"):
            return None

        return {
            "name": result["name"],
            "description": result.get("description", ""),
            "personality": result.get("personality", ""),
            "location": result.get("location", ""),
        }
    except Exception:
        return None


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
        model = model or get_model()
        api_key = api_key or get_api_key()
        api_base = api_base or get_api_base()
        model = _ensure_provider_prefix(model, api_base)

        user_prompt = build_enrichment_prompt(
            entity_type=entity_type,
            entity_name=entity_name,
            current_details=current_details,
            relevant_events=relevant_events,
            world_desc=world_desc,
        )

        kwargs: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": ENRICHMENT_SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 512,
        }

        if api_key:
            kwargs["api_key"] = api_key
        if api_base:
            kwargs["api_base"] = api_base

        # Force JSON output where supported
        if "gpt" in model or "o1" in model or "o3" in model or "o4" in model:
            kwargs["response_format"] = {"type": "json_object"}

        response = await litellm.acompletion(**kwargs)
        raw = _strip_json(response.choices[0].message.content.strip())
        return json.loads(raw)
    except Exception:
        return current_details or {}
