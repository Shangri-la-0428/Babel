"""BABEL — Core simulation engine."""

from __future__ import annotations

import asyncio
import random
from typing import Any, Callable

from pydantic import ValidationError

from .llm import get_agent_action
from .memory import (
    detect_repetition,
    generate_perturbation,
    get_recent_events,
    get_visible_agents,
    update_agent_memory,
)
from .models import (
    ActionType,
    AgentState,
    AgentStatus,
    Event,
    LLMResponse,
    Session,
    SessionStatus,
    WorldSeed,
)
from .validator import apply_action, validate_action

# Type for event callback (used by API/WebSocket to push events)
EventCallback = Callable[[Event], Any]


class Engine:
    """World simulation engine. Drives the tick loop."""

    def __init__(
        self,
        session: Session,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        on_event: EventCallback | None = None,
        tick_delay: float = 2.0,
    ):
        self.session = session
        self.model = model
        self.api_key = api_key
        self.api_base = api_base
        self.on_event = on_event
        self.tick_delay = tick_delay
        self._running = False

    @classmethod
    def from_seed(
        cls,
        world_seed: WorldSeed,
        **kwargs: Any,
    ) -> Engine:
        session = Session(world_seed=world_seed)
        session.init_agents()
        # Record initial events
        for text in world_seed.initial_events:
            event = Event(
                session_id=session.id,
                tick=0,
                agent_id=None,
                agent_name=None,
                action_type="world_event",
                action={"content": text},
                result=f"[WORLD] {text}",
            )
            session.events.append(event)
        return cls(session=session, **kwargs)

    async def run(self, max_ticks: int = 50) -> None:
        """Run the simulation loop."""
        self._running = True
        self.session.status = SessionStatus.RUNNING

        while self._running and self.session.tick < max_ticks:
            await self.tick()
            if not self._running:
                break
            await asyncio.sleep(self.tick_delay)

        self.session.status = SessionStatus.ENDED
        self._running = False

    async def tick(self) -> list[Event]:
        """Execute one tick of the simulation."""
        self.session.tick += 1
        tick_events: list[Event] = []

        # Get alive agents in random order
        alive_ids = list(self.session.agent_ids)
        random.shuffle(alive_ids)

        for agent_id in alive_ids:
            agent = self.session.agents[agent_id]
            agent.status = AgentStatus.ACTING

            # Check for repetition — inject perturbation if needed
            if detect_repetition(agent, self.session):
                perturbation = await generate_perturbation(
                    self.session,
                    model=self.model,
                    api_key=self.api_key,
                    api_base=self.api_base,
                )
                world_event = Event(
                    session_id=self.session.id,
                    tick=self.session.tick,
                    agent_id=None,
                    agent_name=None,
                    action_type="world_event",
                    action={"content": perturbation},
                    result=f"[WORLD] {perturbation}",
                )
                self.session.events.append(world_event)
                tick_events.append(world_event)
                await self._emit(world_event)
                # Also add to this agent's memory
                update_agent_memory(agent, f"[WORLD] {perturbation}")

            # Get action from LLM
            event = await self._resolve_agent_action(agent)
            tick_events.append(event)

            agent.status = AgentStatus.IDLE

        return tick_events

    async def step(self) -> list[Event]:
        """Execute a single tick (for manual stepping)."""
        return await self.tick()

    def pause(self) -> None:
        self._running = False
        self.session.status = SessionStatus.PAUSED

    def stop(self) -> None:
        self._running = False
        self.session.status = SessionStatus.ENDED

    @property
    def is_running(self) -> bool:
        return self._running

    async def _resolve_agent_action(self, agent: AgentState) -> Event:
        """Call LLM, validate, retry if needed, apply action."""
        visible = get_visible_agents(agent, self.session)
        recent = get_recent_events(agent, self.session)

        max_attempts = 2
        last_error = ""

        for attempt in range(max_attempts):
            try:
                # Build extra context for retry
                extra_events = list(recent)
                if last_error:
                    extra_events.append(f"[SYSTEM] Previous action was invalid: {last_error}. Try again.")

                response = await get_agent_action(
                    world_rules=self.session.world_seed.rules,
                    agent_name=agent.name,
                    agent_personality=agent.personality,
                    agent_goals=agent.goals,
                    agent_location=agent.location,
                    agent_inventory=agent.inventory,
                    agent_memory=agent.memory,
                    tick=self.session.tick,
                    visible_agents=visible,
                    recent_events=extra_events,
                    available_locations=self.session.location_names,
                    model=self.model,
                    api_key=self.api_key,
                    api_base=self.api_base,
                )

                # Validate
                errors = validate_action(response, agent, self.session)
                if errors:
                    last_error = "; ".join(errors)
                    if attempt < max_attempts - 1:
                        continue
                    # Final attempt failed — fallback to wait
                    return self._make_wait_event(agent, f"Action invalid: {last_error}")

                # Valid — apply and record
                summary = apply_action(response, agent, self.session)
                event = Event(
                    session_id=self.session.id,
                    tick=self.session.tick,
                    agent_id=agent.agent_id,
                    agent_name=agent.name,
                    action_type=response.action.type.value,
                    action=response.action.model_dump(),
                    result=summary,
                )
                self.session.events.append(event)
                update_agent_memory(agent, summary)
                await self._emit(event)
                return event

            except (ValidationError, ValueError, KeyError) as e:
                last_error = str(e)
                if attempt < max_attempts - 1:
                    continue
                return self._make_wait_event(agent, f"LLM error: {last_error}")

            except Exception as e:
                return self._make_wait_event(agent, f"Unexpected error: {e}")

        return self._make_wait_event(agent, "Max retries exceeded")

    def _make_wait_event(self, agent: AgentState, reason: str) -> Event:
        """Create a fallback wait event when action resolution fails."""
        summary = f"{agent.name} waited (system: {reason})"
        event = Event(
            session_id=self.session.id,
            tick=self.session.tick,
            agent_id=agent.agent_id,
            agent_name=agent.name,
            action_type=ActionType.WAIT.value,
            action={"type": "wait", "content": reason},
            result=summary,
        )
        self.session.events.append(event)
        update_agent_memory(agent, summary)
        asyncio.create_task(self._emit_safe(event))
        return event

    async def _emit(self, event: Event) -> None:
        if self.on_event:
            result = self.on_event(event)
            if asyncio.iscoroutine(result):
                await result

    async def _emit_safe(self, event: Event) -> None:
        try:
            await self._emit(event)
        except Exception:
            pass
