"""BABEL — Decision source abstraction (World Kernel Protocol).

Decouples the 'who decides' from the world engine.
DecisionSource is a Protocol — anything that can produce an ActionOutput
from an AgentContext can drive agents (LLM, human, script, other AI).
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from .models import ActionOutput, ActionType


class AgentContext(BaseModel):
    """Modality-agnostic slice of the world visible to an agent at decision time."""

    agent_id: str = ""
    agent_name: str = ""
    agent_personality: str = ""
    agent_description: str = ""
    agent_goals: list[str] = Field(default_factory=list)
    agent_location: str = ""
    agent_inventory: list[str] = Field(default_factory=list)
    visible_agents: list[dict[str, Any]] = Field(default_factory=list)
    memories: list[dict[str, Any]] = Field(default_factory=list)
    beliefs: list[str] = Field(default_factory=list)
    relations: list[dict[str, Any]] = Field(default_factory=list)
    reachable_locations: list[str] = Field(default_factory=list)
    available_locations: list[str] = Field(default_factory=list)
    recent_events: list[str] = Field(default_factory=list)
    world_rules: list[str] = Field(default_factory=list)
    world_time: dict[str, Any] = Field(default_factory=dict)
    active_goal: dict[str, Any] | None = None
    urgent_events: list[str] | None = None
    tick: int = 0


@runtime_checkable
class DecisionSource(Protocol):
    """Anything that can decide an agent's next action."""

    async def decide(self, context: AgentContext) -> ActionOutput: ...


class LLMDecisionSource:
    """Decision source wrapping the existing prompts.py + llm.py pipeline."""

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
    ):
        self.model = model
        self.api_key = api_key
        self.api_base = api_base

    async def decide(self, context: AgentContext) -> ActionOutput:
        from .llm import get_agent_action

        memory_strings = [m["content"] for m in context.memories] if context.memories else []

        response = await get_agent_action(
            world_rules=context.world_rules,
            agent_name=context.agent_name,
            agent_personality=context.agent_personality,
            agent_goals=context.agent_goals,
            agent_location=context.agent_location,
            agent_inventory=context.agent_inventory,
            agent_memory=memory_strings,
            tick=context.tick,
            visible_agents=context.visible_agents,
            recent_events=context.recent_events,
            available_locations=context.available_locations,
            model=self.model,
            api_key=self.api_key,
            api_base=self.api_base,
            urgent_events=context.urgent_events,
            world_time_display=context.world_time.get("display", ""),
            world_time_period=context.world_time.get("period", ""),
            agent_relations=context.relations or None,
            reachable_locations=context.reachable_locations or None,
            agent_beliefs=context.beliefs or None,
            active_goal=context.active_goal,
        )
        return response.action


class ScriptedDecisionSource:
    """Deterministic decision source for testing. Cycles through predefined actions."""

    def __init__(self, actions: list[ActionOutput] | None = None):
        self._actions = actions or [
            ActionOutput(type=ActionType.OBSERVE, content="looking around"),
            ActionOutput(type=ActionType.WAIT, content="waiting patiently"),
        ]
        self._index = 0

    async def decide(self, context: AgentContext) -> ActionOutput:
        action = self._actions[self._index % len(self._actions)]
        self._index += 1

        # For speak/trade, ensure target is valid
        if action.type in (ActionType.SPEAK, ActionType.TRADE):
            if context.visible_agents:
                same_loc = [
                    a for a in context.visible_agents
                    if a.get("location") == context.agent_location
                ]
                if same_loc:
                    action = ActionOutput(
                        type=action.type,
                        target=same_loc[0]["id"],
                        content=action.content,
                    )
                else:
                    # Fallback to observe if no valid target at same location
                    action = ActionOutput(
                        type=ActionType.OBSERVE,
                        content="no valid target nearby",
                    )
            else:
                # No visible agents at all — fallback to observe
                action = ActionOutput(
                    type=ActionType.OBSERVE,
                    content="nobody around to interact with",
                )

        # For move, pick a reachable location
        if action.type == ActionType.MOVE:
            if context.reachable_locations:
                targets = [
                    loc for loc in context.reachable_locations
                    if loc != context.agent_location
                ]
                if targets:
                    action = ActionOutput(
                        type=ActionType.MOVE,
                        target=targets[0],
                        content=action.content,
                    )
                else:
                    action = ActionOutput(
                        type=ActionType.OBSERVE,
                        content="nowhere to go",
                    )
            elif context.available_locations:
                targets = [
                    loc for loc in context.available_locations
                    if loc != context.agent_location
                ]
                if targets:
                    action = ActionOutput(
                        type=ActionType.MOVE,
                        target=targets[0],
                        content=action.content,
                    )
                else:
                    action = ActionOutput(
                        type=ActionType.OBSERVE,
                        content="nowhere to go",
                    )
            else:
                # No locations at all — fallback to observe
                action = ActionOutput(
                    type=ActionType.OBSERVE,
                    content="nowhere to go",
                )

        return action
