"""BABEL — Core simulation engine."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any, Callable

logger = logging.getLogger(__name__)

from pydantic import ValidationError

from .db import (
    get_last_node_id, save_snapshot, save_timeline_node,
    load_entity_details, save_entity_details, load_events,
    load_events_filtered,
)
from .llm import enrich_entity, replan_goal
from .memory import (
    consolidate_memories,
    create_memory_from_event,
    detect_repetition,
    extract_beliefs,
    generate_perturbation,
    get_agent_beliefs,
    get_relevant_events,
    retrieve_relevant_memories,
)
from .models import (
    ActionType,
    AgentRole,
    AgentState,
    AgentStatus,
    Event,
    GoalState,
    IntentState,
    Session,
    SessionStatus,
    TimelineNode,
    WorldSnapshot,
)
from .decision import AgentContext, DecisionSource, LLMDecisionSource
from .policies import (
    DefaultEnrichmentPolicy,
    DefaultMemoryPolicy,
    DefaultPerceptionPolicy,
    DefaultPressurePolicy,
    DefaultProposalPolicy,
    DefaultResolutionPolicy,
    DefaultTimelinePolicy,
    EnrichmentPolicy,
    GoalMutationPolicy,
    DefaultGoalMutationPolicy,
    DefaultGoalProjectionPolicy,
    DefaultSocialMutationPolicy,
    DefaultSocialProjectionPolicy,
    GoalMutationPolicy,
    GoalProjectionPolicy,
    MemoryPolicy,
    PerceptionPolicy,
    PressurePolicy,
    ProposalPolicy,
    ResolutionPolicy,
    SocialMutationPolicy,
    SocialProjectionPolicy,
    TimelinePolicy,
    _build_agent_context,
)
from .significance import finalize_event_significance
from .validator import DefaultWorldAuthority, WorldAuthority

# Max events kept in session.events in-memory
EVENT_WINDOW = 30

# Type for event callback (used by API/WebSocket to push events)
EventCallback = Callable[[Event], Any]

# Default intervals (can be overridden per-engine)
DEFAULT_SNAPSHOT_INTERVAL = 10
DEFAULT_EPOCH_INTERVAL = 5
DEFAULT_BELIEF_INTERVAL = 10


class Engine:
    """World simulation engine. Drives the tick loop.

    All agent decisions go through the DecisionSource protocol.
    Defaults to LLMDecisionSource if none is provided.
    """

    def __init__(
        self,
        session: Session,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        on_event: EventCallback | None = None,
        tick_delay: float = 2.0,
        decision_source: DecisionSource | None = None,
        pressure_policy: PressurePolicy | None = None,
        perception_policy: PerceptionPolicy | None = None,
        resolution_policy: ResolutionPolicy | None = None,
        proposal_policy: ProposalPolicy | None = None,
        social_projection_policy: SocialProjectionPolicy | None = None,
        social_mutation_policy: SocialMutationPolicy | None = None,
        goal_projection_policy: GoalProjectionPolicy | None = None,
        goal_mutation_policy: GoalMutationPolicy | None = None,
        timeline_policy: TimelinePolicy | None = None,
        memory_policy: MemoryPolicy | None = None,
        enrichment_policy: EnrichmentPolicy | None = None,
        world_authority: WorldAuthority | None = None,
        snapshot_interval: int = DEFAULT_SNAPSHOT_INTERVAL,
        epoch_interval: int = DEFAULT_EPOCH_INTERVAL,
        belief_interval: int = DEFAULT_BELIEF_INTERVAL,
    ):
        self.session = session
        self.model = model
        self.api_key = api_key
        self.api_base = api_base
        self.on_event = on_event
        self.tick_delay = tick_delay
        # Always have a decision source — LLM is the default, not a special case
        self.decision_source: DecisionSource = decision_source or LLMDecisionSource(
            model=model, api_key=api_key, api_base=api_base,
        )
        self.pressure_policy: PressurePolicy = pressure_policy or DefaultPressurePolicy()
        self.perception_policy: PerceptionPolicy = perception_policy or DefaultPerceptionPolicy()
        self.resolution_policy: ResolutionPolicy = resolution_policy or DefaultResolutionPolicy()
        self.proposal_policy: ProposalPolicy = proposal_policy or DefaultProposalPolicy()
        self.social_projection_policy = social_projection_policy or DefaultSocialProjectionPolicy()
        self.social_mutation_policy = social_mutation_policy or DefaultSocialMutationPolicy()
        self.goal_projection_policy = goal_projection_policy or DefaultGoalProjectionPolicy()
        self.goal_mutation_policy = goal_mutation_policy or DefaultGoalMutationPolicy()
        self.timeline_policy: TimelinePolicy = timeline_policy or DefaultTimelinePolicy()
        self.memory_policy: MemoryPolicy = memory_policy or DefaultMemoryPolicy()
        self.enrichment_policy: EnrichmentPolicy = enrichment_policy or DefaultEnrichmentPolicy()
        self.world_authority: WorldAuthority = world_authority or DefaultWorldAuthority()
        self._running = False
        self._enrichment_queue: list[tuple[str, str]] = []  # (entity_type, entity_id)
        # Configurable intervals
        self.snapshot_interval = snapshot_interval
        self.epoch_interval = epoch_interval
        self.belief_interval = belief_interval
        # Phase B: per-agent Psyche snapshots for drive tracking
        self._psyche_snapshots: dict[str, Any] = {}      # agent_id → current PsycheSnapshot
        self._prev_psyche_snapshots: dict[str, Any] = {}  # agent_id → previous tick's snapshot

    async def tick(self) -> list[Event]:
        """Execute one tick of the simulation."""
        self.session.tick += 1
        tick_events: list[Event] = []

        # Get alive agents in random order
        alive_ids = list(self.session.agent_ids)
        if not alive_ids:
            return tick_events
        random.shuffle(alive_ids)

        for agent_id in alive_ids:
            agent = self.session.agents[agent_id]

            # Supporting agents skip ~30% of ticks to reduce noise
            if agent.role == AgentRole.SUPPORTING and random.random() > 0.7:
                agent.status = AgentStatus.IDLE
                continue

            agent.status = AgentStatus.ACTING

            tick_events.extend(await self.pressure_policy.before_agent_turn(self, agent))

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

    def start(self) -> None:
        """Mark engine as running. Called before the tick loop."""
        self.session.status = SessionStatus.RUNNING
        self._running = True

    def pause(self) -> None:
        self._running = False
        self.session.status = SessionStatus.PAUSED

    def stop(self) -> None:
        self._running = False
        self.session.status = SessionStatus.ENDED

    @property
    def is_running(self) -> bool:
        return self._running

    def configure(
        self,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        tick_delay: float | None = None,
        on_event: EventCallback | None = None,
    ) -> None:
        """Update engine configuration. Propagates LLM config to decision source."""
        if model is not None:
            self.model = model
        if api_key is not None:
            self.api_key = api_key
        if api_base is not None:
            self.api_base = api_base
        if tick_delay is not None:
            self.tick_delay = tick_delay
        if on_event is not None:
            self.on_event = on_event
        # Sync LLM config to decision source if it's the default LLM type
        if isinstance(self.decision_source, LLMDecisionSource):
            self.decision_source.model = self.model
            self.decision_source.api_key = self.api_key
            self.decision_source.api_base = self.api_base

    def inject_urgent_event(self, content: str) -> None:
        """Queue an urgent event for agents to react to on next tick."""
        self.session.urgent_events.append(content)

    def _append_event(self, event: Event) -> None:
        """Append event to session and enforce rolling window."""
        self.session.events.append(event)
        if len(self.session.events) > EVENT_WINDOW:
            self.session.events = self.session.events[-EVENT_WINDOW:]

    async def _remember_event(self, agent: AgentState, event: Event, memory_text: str | None = None) -> None:
        await create_memory_from_event(agent, event, self.session)

    async def _detect_repetition(self, agent: AgentState) -> bool:
        return await detect_repetition(agent, self.session)

    async def _generate_perturbation(self) -> str:
        return await generate_perturbation(
            self.session,
            model=self.model,
            api_key=self.api_key,
            api_base=self.api_base,
        )

    async def _replan_goal(self, agent: AgentState, goal: GoalState) -> dict:
        # Use structured memory instead of legacy sliding window
        memories = await retrieve_relevant_memories(agent, self.session, limit=5)
        memory_strings = [m["content"] for m in memories]
        return await replan_goal(
            agent_name=agent.name,
            agent_personality=agent.personality,
            current_goals=agent.goals,
            stalled_goal=goal.text,
            agent_memory=memory_strings,
            model=self.model,
            api_key=self.api_key,
            api_base=self.api_base,
            drive_state=self._get_agent_drive_state(agent.agent_id),
        )

    async def _retrieve_relevant_memories(self, agent: AgentState) -> list[dict[str, Any]]:
        return await retrieve_relevant_memories(agent, self.session)

    async def _get_relevant_events(self, agent: AgentState) -> list[str]:
        return await get_relevant_events(agent, self.session)

    async def _get_agent_beliefs(self, agent_id: str, limit: int = 5) -> list[str]:
        return await get_agent_beliefs(self.session.id, agent_id, limit=limit)

    def _build_context(self, agent: AgentState, **overrides) -> AgentContext:
        """Compatibility shim for tests and older callers.

        Canonical context assembly now lives in policies._build_agent_context().
        """
        return _build_agent_context(self, agent, **overrides)

    async def _resolve_agent_action(self, agent: AgentState) -> Event:
        """Resolve agent action via DecisionSource protocol."""
        try:
            return await self._resolve_agent_action_inner(agent)
        except Exception as e:
            logger.warning("Agent action resolve failed for %s: %s", agent.agent_id, e)
            return await self._make_wait_event(agent, f"Resolve error: {e}")

    async def _resolve_agent_action_inner(self, agent: AgentState) -> Event:
        """Inner implementation — any unhandled exception falls back to WAIT."""
        self.goal_mutation_policy.ensure_active_goal(self, agent)

        max_attempts = self.resolution_policy.max_attempts(self, agent)
        last_error = ""

        for attempt in range(max_attempts):
            try:
                # ── Single path: always through DecisionSource ──
                ctx = await self.perception_policy.build_context(self, agent)
                ctx = self.resolution_policy.repair_context(
                    self, agent, ctx, last_error, attempt,
                )
                action_output = await self.decision_source.decide(ctx)
                response = self.proposal_policy.build_response(
                    self, agent, action_output,
                )

                # Validate
                errors = self.world_authority.validate(response, agent, self.session)
                if errors:
                    last_error = "; ".join(errors)
                    if attempt < max_attempts - 1:
                        continue
                    self.goal_mutation_policy.record_blocker(agent, last_error)
                    return await self._make_wait_event(
                        agent,
                        self.resolution_policy.invalid_result(self, agent, last_error),
                    )

                # Valid — apply and record
                goal_before = agent.active_goal.model_copy(deep=True) if agent.active_goal else None
                target_id = response.action.target if response.action.target in self.session.agents else None
                relation_before = None
                if target_id:
                    rel = self.session.get_relation(agent.agent_id, target_id)
                    relation_before = rel.model_copy(deep=True) if rel else None

                summary = self.world_authority.apply(response, agent, self.session)
                at = response.action.type.value

                # Get structured data from validator
                structured = getattr(response, "_structured", {})
                if response.intent.has_content():
                    structured = {
                        **structured,
                        "decision": response.intent.model_dump(),
                    }

                event = Event(
                    session_id=self.session.id,
                    tick=self.session.tick,
                    agent_id=agent.agent_id,
                    agent_name=agent.name,
                    action_type=at,
                    action=response.action.model_dump(),
                    result=summary,
                    structured=structured,
                    location=agent.location,
                    involved_agents=[agent.agent_id],
                )
                # Add target agent to involved list
                if target_id:
                    event.involved_agents.append(target_id)

                # Persist short-horizon continuity so the agent does not "forget" every tick.
                self.goal_mutation_policy.sync_plan_from_intent(agent, response.intent)
                agent.immediate_intent = (
                    response.intent.objective.strip()
                    or (agent.active_goal.text if agent.active_goal else "")
                )
                agent.immediate_approach = response.intent.approach.strip()
                agent.immediate_next_step = response.intent.next_step.strip()
                agent.last_outcome = summary

                # ── Auto-update relations after social interactions ──
                self.social_mutation_policy.apply(self, agent, response, errors=[])

                # ── Update goal progress ──
                await self.goal_mutation_policy.update(self, agent, event)

                relation_after = None
                if target_id:
                    rel = self.session.get_relation(agent.agent_id, target_id)
                    relation_after = rel.model_copy(deep=True) if rel else None
                goal_after = agent.active_goal.model_copy(deep=True) if agent.active_goal else None
                finalize_event_significance(
                    event,
                    goal_before=goal_before,
                    goal_after=goal_after,
                    relation_before=relation_before,
                    relation_after=relation_after,
                )

                self._append_event(event)
                await self._remember_event(agent, event, summary)
                await self._emit(event)

                return event

            except (ValidationError, ValueError, KeyError) as e:
                last_error = str(e)
                if attempt < max_attempts - 1:
                    continue
                return await self._make_wait_event(agent, f"LLM error: {last_error}")

            except Exception as e:
                logger.warning("Unexpected error during agent action for %s: %s", agent.agent_id, e)
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
        )
        finalize_event_significance(event)
        self._append_event(event)
        await self._remember_event(agent, event, summary)
        asyncio.create_task(self._emit_safe(event))
        return event

    async def _post_tick(self, tick_events: list[Event]) -> None:
        """Run post-tick policies."""
        await self.timeline_policy.after_tick(self, tick_events)
        await self.memory_policy.after_tick(self, tick_events)
        await self.enrichment_policy.after_tick(self, tick_events)

    async def _update_goals(self, agent: AgentState, event: Event) -> None:
        """Facade for goal_mutation_policy (used by tests)."""
        await self.goal_mutation_policy.update(self, agent, event)

    def _event_advances_goal(self, event: Event, goal: GoalState) -> bool:
        """Facade for goal_mutation_policy (used by tests)."""
        return self.goal_mutation_policy.event_advances(event, goal)

    def _select_next_goal(
        self, agent: AgentState, drive_state: dict[str, float] | None = None,
    ) -> GoalState | None:
        """Facade for goal_mutation_policy (used by tests)."""
        return self.goal_mutation_policy.select_next_goal(self, agent, drive_state=drive_state)

    def _get_agent_drive_state(self, agent_id: str) -> dict[str, float] | None:
        """Get current Psyche drive state for an agent, if available."""
        snapshot = self._psyche_snapshots.get(agent_id)
        return snapshot.drives if snapshot and snapshot.drives else None

    def update_psyche_snapshot(self, agent_id: str, snapshot: Any) -> None:
        """Update Psyche snapshot for an agent (called by decision source)."""
        self._prev_psyche_snapshots[agent_id] = self._psyche_snapshots.get(agent_id)
        self._psyche_snapshots[agent_id] = snapshot

    async def _get_last_node_id(self) -> str | None:
        return await get_last_node_id(self.session.id)

    async def _save_timeline_node(self, node: TimelineNode) -> None:
        await save_timeline_node(node)

    async def _save_snapshot(self, snapshot: WorldSnapshot) -> None:
        await save_snapshot(snapshot)

    def _dump_agent_states_json(self) -> str:
        return json.dumps(
            {agent_id: agent.model_dump() for agent_id, agent in self.session.agents.items()},
            ensure_ascii=False,
        )

    async def _consolidate_memories(self, agent_id: str) -> None:
        await consolidate_memories(
            self.session,
            agent_id,
            model=self.model,
            api_key=self.api_key,
            api_base=self.api_base,
        )

    async def _extract_beliefs(self, agent_id: str) -> None:
        try:
            await extract_beliefs(agent_id, self.session)
        except Exception as e:
            logger.debug("Belief extraction failed for agent %s: %s", agent_id, e)

    async def _load_entity_details(self, entity_type: str, entity_id: str) -> dict | None:
        return await load_entity_details(self.session.id, entity_type, entity_id)

    async def _save_entity_details(
        self,
        *,
        entity_type: str,
        entity_id: str,
        details: dict,
        tick: int,
    ) -> None:
        await save_entity_details(
            session_id=self.session.id,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
            tick=tick,
        )

    async def _load_events(self, limit: int = 100) -> list[dict]:
        return await load_events(self.session.id, limit=limit)

    async def _load_events_filtered(self, *, agent_id: str, limit: int = 15) -> list[dict]:
        return await load_events_filtered(
            session_id=self.session.id,
            agent_id=agent_id,
            limit=limit,
        )

    async def _enrich_entity(
        self,
        *,
        entity_type: str,
        entity_id: str,
        current_details: dict,
        relevant_events: list[str],
    ) -> dict:
        return await enrich_entity(
            entity_type=entity_type,
            entity_name=entity_id,
            current_details=current_details,
            relevant_events=relevant_events,
            world_desc=self.session.world_seed.description,
            model=self.model,
            api_key=self.api_key,
            api_base=self.api_base,
        )

    async def _emit(self, event: Event) -> None:
        if self.on_event:
            result = self.on_event(event)
            if asyncio.iscoroutine(result):
                await result

    async def _emit_safe(self, event: Event) -> None:
        try:
            await self._emit(event)
        except Exception as e:
            logger.debug("Event emit failed: %s", e)
