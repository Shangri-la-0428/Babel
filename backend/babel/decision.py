"""BABEL — Decision source abstraction (World Kernel Protocol).

Decouples the 'who decides' from the world engine.
DecisionSource is a Protocol — anything that can produce an ActionOutput
from an AgentContext can drive agents (LLM, human, script, other AI).
"""

from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

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


class HumanDecisionSource:
    """Decision source that waits for human input via API.

    Wraps a fallback DecisionSource. Agents marked as human-controlled
    block until a human submits an action; all others delegate to fallback.

    Usage:
        human_src = HumanDecisionSource(fallback=LLMDecisionSource())
        human_src.take_control("agent_1")

        # In API handler:
        human_src.submit_action("agent_1", ActionOutput(...))
    """

    def __init__(
        self,
        fallback: DecisionSource | None = None,
        timeout: float = 120.0,
        on_waiting: Any | None = None,
    ):
        import asyncio as _asyncio
        self._asyncio = _asyncio
        self._fallback = fallback
        self._timeout = timeout
        self._on_waiting = on_waiting  # async callback(agent_id, context)
        self._human_agents: set[str] = set()
        self._pending: dict[str, _asyncio.Future[ActionOutput]] = {}
        self._pending_contexts: dict[str, AgentContext] = {}

    @property
    def human_agents(self) -> set[str]:
        return self._human_agents.copy()

    def take_control(self, agent_id: str) -> None:
        """Mark an agent as human-controlled."""
        self._human_agents.add(agent_id)

    def release_control(self, agent_id: str) -> None:
        """Release human control of an agent."""
        self._human_agents.discard(agent_id)
        # Cancel any pending wait
        future = self._pending.pop(agent_id, None)
        if future and not future.done():
            future.cancel()
        self._pending_contexts.pop(agent_id, None)

    def is_waiting(self, agent_id: str) -> bool:
        """Check if an agent is waiting for human input."""
        future = self._pending.get(agent_id)
        return future is not None and not future.done()

    def get_pending_context(self, agent_id: str) -> AgentContext | None:
        """Get the context for a pending agent (so frontend can display it)."""
        return self._pending_contexts.get(agent_id)

    def submit_action(self, agent_id: str, action: ActionOutput) -> bool:
        """Submit an action for a pending human-controlled agent.

        Returns True if the action was accepted, False if agent wasn't waiting.
        """
        future = self._pending.get(agent_id)
        if future and not future.done():
            future.set_result(action)
            return True
        return False

    async def decide(self, context: AgentContext) -> ActionOutput:
        agent_id = context.agent_id

        # Non-human agents: delegate to fallback
        if agent_id not in self._human_agents:
            if self._fallback:
                return await self._fallback.decide(context)
            return ActionOutput(type=ActionType.WAIT, content="no decision source")

        # Human-controlled: wait for input
        loop = self._asyncio.get_running_loop()
        future: self._asyncio.Future[ActionOutput] = loop.create_future()
        self._pending[agent_id] = future
        self._pending_contexts[agent_id] = context

        # Notify that we're waiting (so frontend can show action picker)
        if self._on_waiting:
            try:
                await self._on_waiting(agent_id, context)
            except Exception as e:
                logger.debug("on_waiting callback failed for agent %s: %s", agent_id, e)

        try:
            return await self._asyncio.wait_for(future, timeout=self._timeout)
        except (self._asyncio.TimeoutError, self._asyncio.CancelledError):
            return ActionOutput(type=ActionType.WAIT, content="awaiting human input")
        finally:
            self._pending.pop(agent_id, None)
            self._pending_contexts.pop(agent_id, None)


class ContextAwareDecisionSource:
    """Smart decision source that picks actions based on context.

    Used for stability testing — exercises all action types realistically
    without LLM calls. Agents speak to visible agents, move when alone,
    trade when they have items, and observe otherwise.
    """

    def __init__(self, seed: int = 42):
        import random as _rng
        self._rng = _rng.Random(seed)
        self._tick_actions: dict[str, int] = {}  # agent_id → action counter

    async def decide(self, context: AgentContext) -> ActionOutput:
        agent_id = context.agent_id
        count = self._tick_actions.get(agent_id, 0)
        self._tick_actions[agent_id] = count + 1

        same_loc_agents = [
            a for a in context.visible_agents
            if a.get("location") == context.agent_location
        ]
        other_locations = [
            loc for loc in context.reachable_locations
            if loc != context.agent_location
        ] if context.reachable_locations else [
            loc for loc in context.available_locations
            if loc != context.agent_location
        ]

        # Build a weighted action pool based on context
        pool: list[ActionOutput] = []

        # Always can observe or wait
        pool.append(ActionOutput(type=ActionType.OBSERVE, content="scanning surroundings"))

        # Speak to someone nearby (weighted heavily — social drives the simulation)
        if same_loc_agents:
            target = self._rng.choice(same_loc_agents)
            pool.append(ActionOutput(
                type=ActionType.SPEAK, target=target["id"],
                content=f"talking to {target.get('name', target['id'])}",
            ))
            pool.append(ActionOutput(
                type=ActionType.SPEAK, target=target["id"],
                content=f"discussing plans with {target.get('name', target['id'])}",
            ))
            # Trade if both have items
            if context.agent_inventory:
                item = self._rng.choice(context.agent_inventory)
                pool.append(ActionOutput(
                    type=ActionType.TRADE, target=target["id"],
                    content=f"offering {item}",
                ))

        # Move if alone or periodically
        if other_locations:
            dest = self._rng.choice(other_locations)
            # More likely to move when alone
            weight = 3 if not same_loc_agents else 1
            for _ in range(weight):
                pool.append(ActionOutput(
                    type=ActionType.MOVE, target=dest,
                    content=f"heading to {dest}",
                ))

        # Use item occasionally
        if context.agent_inventory and count % 7 == 3:
            item = self._rng.choice(context.agent_inventory)
            pool.append(ActionOutput(
                type=ActionType.USE_ITEM, target=item,
                content=f"using {item}",
            ))

        return self._rng.choice(pool)


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
