"""BABEL — Causal kernel.

The engine is a pure causal loop:
  tick → perceive → decide → validate → apply → physics → event

It does not know about LLMs, text, memory, chapters, or any specific medium.
All medium-specific behavior lives in EngineHooks.

The output is state change. Not language. Not narrative. State.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, Callable

from pydantic import ValidationError

from .decision import AgentContext, DecisionSource, LLMDecisionSource
from .hooks import EngineHooks, NullHooks
from .models import (
    ActionOutput,
    ActionType,
    AgentRole,
    AgentState,
    AgentStatus,
    Event,
    LLMResponse,
    Session,
    SessionStatus,
    StateChanges,
)
from .physics import AgentPhysics, DefaultWorldPhysics, NoAgentPhysics, WorldPhysics
from .validator import DefaultWorldAuthority, WorldAuthority

logger = logging.getLogger(__name__)

EVENT_WINDOW = 30
EventCallback = Callable[[Event], Any]
MAX_RESOLVE_ATTEMPTS = 3


class Engine:
    """World simulation engine. Pure causal kernel + pluggable hooks.

    Four protocols define the causal laws:
      - DecisionSource: how agents decide (LLM, rule-based, human, external SDK)
      - WorldAuthority: what actions are legal + how they mutate state
      - WorldPhysics: engine-enforced world consequences (conservation, entropy)
      - AgentPhysics: engine-enforced agent consequences (energy, stress, momentum)

    One hooks object handles everything else:
      - Perception enrichment (memory, goals, relations)
      - Post-event processing (memory creation, goal tracking, significance)
      - Post-tick processing (timeline, chapters, consolidation)
    """

    def __init__(
        self,
        session: Session,
        decision_source: DecisionSource | None = None,
        world_authority: WorldAuthority | None = None,
        world_physics: WorldPhysics | None = None,
        agent_physics: AgentPhysics | None = None,
        hooks: EngineHooks | None = None,
        *,
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

        # Four causal protocols
        self.decision_source: DecisionSource = decision_source or LLMDecisionSource(
            model=model, api_key=api_key, api_base=api_base,
        )
        self.world_authority: WorldAuthority = world_authority or DefaultWorldAuthority()
        self.world_physics: WorldPhysics = world_physics or DefaultWorldPhysics(
            config=session.world_seed.physics,
        )
        self.agent_physics: AgentPhysics = agent_physics or NoAgentPhysics()

        # Everything non-causal
        self.hooks: EngineHooks = hooks or NullHooks()

        self._running = False
        self._frozen_locations: dict[str, str] | None = None

    # ── Tick loop ─────────────────────────────────────────

    async def tick(self) -> list[Event]:
        """One tick of the simulation. Pure causality + hook calls."""
        self.session.tick += 1
        tick_events: list[Event] = []

        alive_ids = list(self.session.agent_ids)
        if not alive_ids:
            return tick_events
        random.shuffle(alive_ids)

        was_running = self._running

        # Freeze locations at tick start (prevents causal contamination)
        self._frozen_locations = {
            aid: self.session.agents[aid].location for aid in alive_ids
        }

        for agent_id in alive_ids:
            agent = self.session.agents[agent_id]

            if agent.role == AgentRole.SUPPORTING and random.random() > 0.7:
                agent.status = AgentStatus.IDLE
                continue

            if was_running and not self._running:
                break

            agent.status = AgentStatus.ACTING

            # Hook: before turn (perturbation, goal setup, etc.)
            tick_events.extend(await self.hooks.before_turn(self, agent))

            # Causal core: perceive → decide → validate → apply → physics → event
            event = await self._resolve(agent)
            tick_events.append(event)

            agent.status = AgentStatus.IDLE

        self._frozen_locations = None
        self.session.urgent_events.clear()

        # Agent physics: per-tick effects (recovery, decay)
        agent_tick_effects: list[str] = []
        for aid in list(self.session.agent_ids):
            agent = self.session.agents[aid]
            agent_tick_effects.extend(self.agent_physics.tick_effects(agent, self.session))

        # World physics: per-tick effects (regeneration, etc.)
        physics_effects = self.world_physics.tick_effects(self.session)
        physics_effects.extend(agent_tick_effects)
        if physics_effects:
            physics_event = Event(
                session_id=self.session.id,
                tick=self.session.tick,
                agent_id=None,
                agent_name=None,
                action_type="world_event",
                action={"type": "physics", "content": "; ".join(physics_effects)},
                result="[PHYSICS] " + "; ".join(physics_effects),
                location="",
            )
            self._append_event(physics_event)
            await self._emit(physics_event)
            tick_events.append(physics_event)

        # Hook: after tick (timeline, chapters, consolidation, etc.)
        await self.hooks.after_tick(self, tick_events)

        return tick_events

    async def step(self) -> list[Event]:
        return await self.tick()

    def start(self) -> None:
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
        if isinstance(self.decision_source, LLMDecisionSource):
            self.decision_source.model = self.model
            self.decision_source.api_key = self.api_key
            self.decision_source.api_base = self.api_base

    def inject_urgent_event(self, content: str) -> None:
        self.session.urgent_events.append(content)

    # ── Causal core ───────────────────────────────────────

    async def _resolve(self, agent: AgentState) -> Event:
        """Resolve one agent's action. The causal core."""
        try:
            return await self._resolve_inner(agent)
        except Exception as e:
            logger.warning("Resolve failed for %s: %s", agent.agent_id, e)
            return self._make_wait_event(agent, f"Resolve error: {e}")

    async def _resolve_inner(self, agent: AgentState) -> Event:
        last_error = ""

        for attempt in range(MAX_RESOLVE_ATTEMPTS):
            try:
                # Perceive (hook builds full context)
                ctx = await self.hooks.build_context(self, agent)
                if last_error and attempt > 0:
                    ctx = self._inject_error(ctx, last_error, attempt)

                # Agent physics: enrich context with internal state
                ap_ctx = self.agent_physics.pre_decide(agent, self.session)
                if ap_ctx:
                    ctx = ctx.model_copy(update=ap_ctx)

                # Decide
                action_output = await self.decision_source.decide(ctx)

                # Propose (wrap into LLMResponse with state_changes)
                response = self._propose(agent, action_output)

                # Validate
                errors = self.world_authority.validate(response, agent, self.session)
                if errors:
                    last_error = "; ".join(errors)
                    if attempt < MAX_RESOLVE_ATTEMPTS - 1:
                        continue
                    return self._make_wait_event(agent, f"Invalid: {last_error}")

                # Apply + Physics (the causal moment)
                summary = self.world_authority.apply(response, agent, self.session)
                effects = self.world_physics.enforce(response.action, agent, self.session)
                agent_effects = self.agent_physics.post_event(response.action, agent, self.session)
                effects.extend(agent_effects)
                if effects:
                    summary += " [" + "; ".join(effects) + "]"

                # Record
                event = self._make_event(agent, response, summary)
                self._append_event(event)
                await self._emit(event)

                # Hook: after event (memory, goals, relations, significance)
                await self.hooks.after_event(self, agent, event, response)

                return event

            except (ValidationError, ValueError, KeyError) as e:
                last_error = str(e)
                if attempt < MAX_RESOLVE_ATTEMPTS - 1:
                    continue
                return self._make_wait_event(agent, f"Error: {last_error}")

            except Exception as e:
                logger.warning("Unexpected error for %s: %s", agent.agent_id, e)
                err_str = str(e)
                if "AuthenticationError" in err_str or "API key" in err_str:
                    return self._make_wait_event(agent, "API Key invalid")
                return self._make_wait_event(agent, f"Unexpected: {e}")

        return self._make_wait_event(agent, "Max retries exceeded")

    # ── Pure helpers (no side effects beyond state) ───────

    @staticmethod
    def _propose(agent: AgentState, action: ActionOutput) -> LLMResponse:
        """Wrap an ActionOutput into LLMResponse with appropriate state_changes."""
        state_changes = StateChanges()
        if action.type == ActionType.MOVE and action.target:
            state_changes.location = action.target
        return LLMResponse(
            thinking="(decision source)",
            intent=action.intent or {},
            action=action,
            state_changes=state_changes,
        )

    def _inject_error(self, ctx: AgentContext, error: str, attempt: int) -> AgentContext:
        """Add error feedback to context for retry."""
        repair = (
            f"\n\n[SYSTEM] Your previous action was INVALID (attempt {attempt}/{MAX_RESOLVE_ATTEMPTS}): "
            f"{error}\nPlease choose a different, valid action."
        )
        patched = ctx.model_copy()
        patched.recent_events = list(ctx.recent_events) + [repair]
        return patched

    def _make_event(self, agent: AgentState, response: LLMResponse, summary: str) -> Event:
        """Build an Event from a validated response."""
        structured = getattr(response, "_structured", {})
        if response.intent.has_content():
            structured = {**structured, "decision": response.intent.model_dump()}

        target_id = response.action.target
        involved = [agent.agent_id]
        if target_id and target_id in self.session.agents:
            involved.append(target_id)

        return Event(
            session_id=self.session.id,
            tick=self.session.tick,
            agent_id=agent.agent_id,
            agent_name=agent.name,
            action_type=response.action.type.value,
            action=response.action.model_dump(),
            result=summary,
            structured=structured,
            location=agent.location,
            involved_agents=involved,
        )

    def _make_wait_event(self, agent: AgentState, reason: str) -> Event:
        """Fallback event when resolution fails."""
        event = Event(
            session_id=self.session.id,
            tick=self.session.tick,
            agent_id=agent.agent_id,
            agent_name=agent.name,
            action_type=ActionType.WAIT.value,
            action={"type": "wait", "content": reason},
            result=f"{agent.name} waited (system: {reason})",
            location=agent.location,
            involved_agents=[agent.agent_id],
        )
        self._append_event(event)
        asyncio.create_task(self._emit_safe(event))
        return event

    def _append_event(self, event: Event) -> None:
        self.session.events.append(event)
        if len(self.session.events) > EVENT_WINDOW:
            self.session.events = self.session.events[-EVENT_WINDOW:]

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
