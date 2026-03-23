"""BABEL — Core simulation engine."""

from __future__ import annotations

import asyncio
import json
import random
from typing import Any, Callable

from pydantic import ValidationError

from .db import (
    get_last_node_id, save_snapshot, save_timeline_node,
    load_entity_details, save_entity_details, load_events,
    load_events_filtered,
)
from .clock import world_time
from .llm import get_agent_action, enrich_entity
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
    AgentRole,
    AgentState,
    AgentStatus,
    Event,
    Session,
    SessionStatus,
    TimelineNode,
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
        self._enrichment_queue: list[tuple[str, str]] = []  # (entity_type, entity_id)

    async def tick(self) -> list[Event]:
        """Execute one tick of the simulation."""
        self.session.tick += 1
        tick_events: list[Event] = []

        # Get alive agents in random order
        alive_ids = list(self.session.agent_ids)
        random.shuffle(alive_ids)

        for agent_id in alive_ids:
            agent = self.session.agents[agent_id]

            # Supporting agents skip ~30% of ticks to reduce noise
            if agent.role == AgentRole.SUPPORTING and random.random() > 0.7:
                agent.status = AgentStatus.IDLE
                continue

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

            # Respect mid-tick pause — stop processing remaining agents
            if not self._running:
                break

        # Clear urgent events after all agents have processed them
        self.session.urgent_events.clear()

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

                # Compute world time
                wt = world_time(self.session.tick, self.session.world_seed.time)

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
                    urgent_events=self.session.urgent_events or None,
                    world_time_display=wt.display,
                    world_time_period=wt.period,
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

        # ── Passive enrichment: enrich entities from high-importance events ──
        await self._passive_enrichment(tick_events)

    @staticmethod
    def _summarize_tick(events: list[Event]) -> str:
        """Generate a simple tick summary from events (rule-based, no LLM)."""
        parts = []
        for e in events:
            name = e.agent_name or "System"
            at = e.action_type if isinstance(e.action_type, str) else e.action_type.value
            parts.append(f"{name}: {at}")
        return ". ".join(parts)

    async def _passive_enrichment(self, tick_events: list[Event]) -> None:
        """Best-effort: enrich one entity per tick from high-importance events."""
        try:
            session = self.session

            # Scan tick events for entities involved in high-importance events
            for event in tick_events:
                if event.importance < 0.7:
                    continue
                # Queue agents involved
                if event.agent_id and event.agent_id in session.agents:
                    pair = ("agent", event.agent_id)
                    if pair not in self._enrichment_queue:
                        self._enrichment_queue.append(pair)
                # Queue locations mentioned
                if event.location:
                    pair = ("location", event.location)
                    if pair not in self._enrichment_queue:
                        self._enrichment_queue.append(pair)

            # Process at most 1 enrichment per tick
            if not self._enrichment_queue:
                return

            entity_type, entity_id = self._enrichment_queue.pop(0)

            # Load existing details
            existing = await load_entity_details(session.id, entity_type, entity_id)
            current_details = existing["details"] if existing else {}

            # Skip if recently updated (within last 5 ticks)
            if existing and existing.get("last_updated_tick", 0) > session.tick - 5:
                return

            # Gather relevant events
            relevant_event_strings: list[str] = []
            if entity_type == "agent":
                events = await load_events_filtered(
                    session_id=session.id,
                    agent_id=entity_id,
                    limit=15,
                )
                relevant_event_strings = [e.get("result", "") for e in events if e.get("result")]
            else:
                all_events = await load_events(session.id, limit=100)
                search_term = entity_id.lower()
                for e in all_events:
                    result_text = (e.get("result") or "").lower()
                    if search_term in result_text:
                        relevant_event_strings.append(e.get("result", ""))
                relevant_event_strings = relevant_event_strings[:15]

            if not relevant_event_strings:
                return

            # Call enrichment LLM
            enriched = await enrich_entity(
                entity_type=entity_type,
                entity_name=entity_id,
                current_details=current_details,
                relevant_events=relevant_event_strings,
                world_desc=session.world_seed.description,
                model=self.model,
                api_key=self.api_key,
                api_base=self.api_base,
            )

            # Save to DB
            if enriched and enriched != current_details:
                await save_entity_details(
                    session_id=session.id,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    details=enriched,
                    tick=session.tick,
                )
        except Exception:
            pass  # Best-effort — never block simulation

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
