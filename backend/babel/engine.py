"""BABEL — Core simulation engine."""

from __future__ import annotations

import asyncio
import json
import random
from typing import Any, Callable

from pydantic import ValidationError

from .db import get_last_node_id, save_snapshot, save_timeline_node
from .llm import get_agent_action
from .memory import (
    EPOCH_INTERVAL,
    IMPORTANCE_MAP,
    SNAPSHOT_INTERVAL,
    consolidate_memories,
    create_memory_from_event,
    detect_repetition,
    generate_perturbation,
    get_relevant_events,
    get_visible_agents,
    retrieve_relevant_memories,
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
    TimelineNode,
    WorldSeed,
    WorldSnapshot,
)
from .validator import apply_action, validate_action

# Max events kept in session.events in-memory
EVENT_WINDOW = 30

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
                importance=IMPORTANCE_MAP.get("world_event", 0.9),
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
            if await detect_repetition(agent, self.session):
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
                    location=agent.location,
                    importance=IMPORTANCE_MAP.get("world_event", 0.9),
                )
                self._append_event(world_event)
                tick_events.append(world_event)
                await self._emit(world_event)
                # Legacy + structured memory
                update_agent_memory(agent, f"[WORLD] {perturbation}")
                await create_memory_from_event(agent, world_event, self.session)

            # Get action from LLM
            event = await self._resolve_agent_action(agent)
            tick_events.append(event)

            agent.status = AgentStatus.IDLE

        # ── Post-tick: timeline node + snapshot + consolidation ──
        await self._post_tick(tick_events)

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

    def _append_event(self, event: Event) -> None:
        """Append event to session and enforce rolling window."""
        self.session.events.append(event)
        if len(self.session.events) > EVENT_WINDOW:
            self.session.events = self.session.events[-EVENT_WINDOW:]

    async def _resolve_agent_action(self, agent: AgentState) -> Event:
        """Call LLM, validate, retry if needed, apply action."""
        visible = get_visible_agents(agent, self.session)

        # Retrieve structured memories + relevant events from DB
        memories = await retrieve_relevant_memories(agent, self.session)
        memory_strings = [m["content"] for m in memories]

        recent = await get_relevant_events(agent, self.session)

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
                    agent_memory=memory_strings if memory_strings else agent.memory,
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
                    return await self._make_wait_event(agent, f"Action invalid: {last_error}")

                # Valid — apply and record
                summary = apply_action(response, agent, self.session)
                at = response.action.type.value
                event = Event(
                    session_id=self.session.id,
                    tick=self.session.tick,
                    agent_id=agent.agent_id,
                    agent_name=agent.name,
                    action_type=at,
                    action=response.action.model_dump(),
                    result=summary,
                    location=agent.location,
                    involved_agents=[agent.agent_id],
                    importance=IMPORTANCE_MAP.get(at, 0.5),
                )
                # Add target agent to involved list
                if response.action.target and response.action.target in self.session.agents:
                    event.involved_agents.append(response.action.target)

                self._append_event(event)
                # Legacy + structured memory
                update_agent_memory(agent, summary)
                await create_memory_from_event(agent, event, self.session)
                await self._emit(event)
                return event

            except (ValidationError, ValueError, KeyError) as e:
                last_error = str(e)
                if attempt < max_attempts - 1:
                    continue
                return await self._make_wait_event(agent, f"LLM error: {last_error}")

            except Exception as e:
                err_str = str(e)
                if "AuthenticationError" in err_str or "API key" in err_str:
                    return await self._make_wait_event(agent, "API Key 无效或未配置，请在 Settings 中检查")
                return await self._make_wait_event(agent, f"Unexpected error: {e}")

        return await self._make_wait_event(agent, "Max retries exceeded")

    async def _make_wait_event(self, agent: AgentState, reason: str) -> Event:
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
            location=agent.location,
            involved_agents=[agent.agent_id],
            importance=IMPORTANCE_MAP.get("wait", 0.1),
        )
        self._append_event(event)
        update_agent_memory(agent, summary)
        await create_memory_from_event(agent, event, self.session)
        asyncio.create_task(self._emit_safe(event))
        return event

    async def _post_tick(self, tick_events: list[Event]) -> None:
        """Create timeline node, snapshot, and run memory consolidation."""
        session = self.session

        # Get parent node
        parent_id = await get_last_node_id(session.id)

        # Create timeline node
        has_significant = any(e.importance >= 0.8 for e in tick_events)
        node = TimelineNode(
            session_id=session.id,
            tick=session.tick,
            parent_id=parent_id,
            summary=self._summarize_tick(tick_events),
            event_count=len(tick_events),
            agent_locations={
                aid: a.location for aid, a in session.agents.items()
            },
            significant=has_significant,
        )

        # Tag events with node_id
        for e in tick_events:
            e.node_id = node.id

        await save_timeline_node(node)

        # Snapshot: every N ticks or on significant events
        if session.tick % SNAPSHOT_INTERVAL == 0 or has_significant:
            snapshot = WorldSnapshot(
                session_id=session.id,
                node_id=node.id,
                tick=session.tick,
                world_seed_json=session.world_seed.model_dump_json(),
                agent_states_json=json.dumps(
                    {aid: a.model_dump() for aid, a in session.agents.items()},
                    ensure_ascii=False,
                ),
            )
            await save_snapshot(snapshot)

        # Memory consolidation: every EPOCH_INTERVAL ticks
        if session.tick % EPOCH_INTERVAL == 0:
            for aid in session.agent_ids:
                await consolidate_memories(session, aid)

    @staticmethod
    def _summarize_tick(events: list[Event]) -> str:
        """Generate a simple tick summary from events (rule-based, no LLM)."""
        parts = []
        for e in events:
            name = e.agent_name or "System"
            at = e.action_type if isinstance(e.action_type, str) else e.action_type.value
            parts.append(f"{name}: {at}")
        return ". ".join(parts)

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
