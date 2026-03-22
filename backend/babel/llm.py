"""BABEL — LLM integration layer via litellm."""

from __future__ import annotations

import json
import os

import litellm
from pydantic import ValidationError

from .models import LLMResponse
from .prompts import SYSTEM_PROMPT, build_user_prompt

# Suppress litellm debug noise
litellm.suppress_debug_info = True


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
