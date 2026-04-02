"""BABEL — Engine lifecycle hooks.

The engine is a pure causal kernel: tick → perceive → decide → validate → apply → physics → event.
Everything else — memory, goals, relations, chapters, LLM prompts, persistence — is a hook.

Hooks are the boundary between the timeless causal core and the current medium.
The engine doesn't know what medium it's running in. Hooks do.

Today: text worlds driven by LLMs.
Tomorrow: VR universes, digital spacetime, four-dimensional manifolds.
The engine stays the same. Only the hooks change.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from .clock import world_time
from .decision import AgentContext
from .memory import (
    consolidate_memories,
    create_memory_from_event,
    detect_repetition,
    extract_beliefs,
    generate_perturbation,
    get_agent_beliefs,
    get_relevant_events,
    get_visible_agents,
    retrieve_relevant_memories,
)
from .models import (
    AgentState,
    Event,
    GoalState,
    IntentState,
    LLMResponse,
    SeedLineage,
    TimelineNode,
    WorldSnapshot,
)
from .significance import event_is_significant, event_score, finalize_event_significance

if TYPE_CHECKING:
    from .engine import Engine

logger = logging.getLogger(__name__)


# ── Protocol ──────────────────────────────────────────────

@runtime_checkable
class EngineHooks(Protocol):
    """Lifecycle callbacks for non-causal behavior.

    The engine calls these at defined points. Implementations decide
    what happens — memory, goals, chapters, persistence, or nothing.
    """

    async def before_turn(self, engine: Engine, agent: AgentState) -> list[Event]:
        """Called before each agent's turn. Can inject events (e.g. perturbation)."""
        ...

    async def build_context(self, engine: Engine, agent: AgentState) -> AgentContext:
        """Build the perception context for an agent's decision."""
        ...

    async def after_event(
        self, engine: Engine, agent: AgentState, event: Event, response: LLMResponse,
    ) -> None:
        """Called after a valid action is applied. Memory, goals, relations, significance."""
        ...

    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None:
        """Called after all agents have acted. Timeline, chapters, consolidation."""
        ...


# ── NullHooks: pure causal, no decoration ─────────────────

class NullHooks:
    """No-op hooks. The engine runs as a pure causal machine."""

    async def before_turn(self, engine: Engine, agent: AgentState) -> list[Event]:
        return []

    async def build_context(self, engine: Engine, agent: AgentState) -> AgentContext:
        visible = get_visible_agents(agent, engine.session,
                                     frozen_locations=engine._frozen_locations)
        reachable = engine.session.location_connections(agent.location)
        return AgentContext(
            agent_id=agent.agent_id,
            agent_name=agent.name,
            agent_personality=agent.personality,
            agent_description=agent.description,
            agent_goals=agent.goals,
            agent_location=agent.location,
            agent_inventory=list(agent.inventory),
            visible_agents=visible,
            reachable_locations=reachable,
            available_locations=engine.session.location_names,
            world_lore=engine.session.world_seed.lore,
            world_description=engine.session.world_seed.description,
            tick=engine.session.tick,
        )

    async def after_event(
        self, engine: Engine, agent: AgentState, event: Event, response: LLMResponse,
    ) -> None:
        pass

    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None:
        pass


# ── DefaultEngineHooks: the text-world adapter ────────────

class DefaultEngineHooks:
    """Full-featured hooks for text worlds driven by LLMs.

    Bundles: perception enrichment, memory, goals, relations,
    significance, chapters, timeline, snapshots, enrichment.

    This is one possible medium adapter. Not the only one.
    """

    def __init__(
        self,
        *,
        snapshot_interval: int = 10,
        epoch_interval: int = 5,
        belief_interval: int = 10,
        psyche_url: str | None = None,
        thronglets_url: str | None = None,
    ):
        from .policies import (
            DefaultGoalMutationPolicy,
            DefaultGoalProjectionPolicy,
            DefaultSocialMutationPolicy,
            DefaultSocialProjectionPolicy,
        )
        self._social_projection = DefaultSocialProjectionPolicy()
        self._social_mutation = DefaultSocialMutationPolicy()
        self._goal_projection = DefaultGoalProjectionPolicy()
        self._goal_mutation = DefaultGoalMutationPolicy()
        self.snapshot_interval = snapshot_interval
        self.epoch_interval = epoch_interval
        self.belief_interval = belief_interval
        # Substrate connections (optional, fail-silent)
        self._psyche_url = psyche_url
        self._thronglets_url = thronglets_url
        self._psyche_bridge: Any = None  # lazy PsycheBridge
        # Psyche drive snapshots
        self._psyche_snapshots: dict[str, Any] = {}
        self._prev_psyche_snapshots: dict[str, Any] = {}
        # Chapter continuity
        self._last_chapter: str = ""
        # Enrichment queue
        self._enrichment_queue: list[tuple[str, str]] = []

    # ── before_turn ───────────────────────────────────────

    async def before_turn(self, engine: Engine, agent: AgentState) -> list[Event]:
        # Psyche: refresh emotional state before decisions
        await self._psyche_refresh(agent)

        # Ensure agent has an active goal
        self._goal_mutation.ensure_active_goal(engine, agent)

        # Anti-loop: detect repetition → inject perturbation
        if not await detect_repetition(agent, engine.session):
            return []

        perturbation = await generate_perturbation(
            engine.session,
            model=engine.model,
            api_key=engine.api_key,
            api_base=engine.api_base,
        )
        world_event = Event(
            session_id=engine.session.id,
            tick=engine.session.tick,
            agent_id=None,
            agent_name=None,
            action_type="world_event",
            action={"content": perturbation},
            result=f"[WORLD] {perturbation}",
            location=agent.location,
        )
        finalize_event_significance(world_event)
        engine._append_event(world_event)
        await engine._emit(world_event)
        await create_memory_from_event(agent, world_event, engine.session)
        return [world_event]

    # ── build_context ─────────────────────────────────────

    async def build_context(self, engine: Engine, agent: AgentState) -> AgentContext:
        session = engine.session
        seed = session.world_seed
        frozen = engine._frozen_locations

        # Gather all context layers
        visible = get_visible_agents(agent, session, frozen_locations=frozen)
        reachable = session.location_connections(agent.location)
        relations = self._social_projection.build_relation_context(session, agent)
        wt = world_time(session.tick, seed.time)
        goal_ctx = self._goal_projection.build_goal_context(agent)
        memories = await retrieve_relevant_memories(agent, session)
        recent = await get_relevant_events(agent, session)
        beliefs = await get_agent_beliefs(session.id, agent.agent_id)

        location_context: dict[str, str] = {}
        for loc in seed.locations:
            if loc.description:
                location_context[loc.name] = loc.description

        # Psyche emotional context (from live wire or cached snapshot)
        emotional_context = ""
        drive_state: dict[str, float] = {}
        snapshot = self._psyche_snapshots.get(agent.agent_id)
        if snapshot:
            drive_state = snapshot.drives if hasattr(snapshot, "drives") and snapshot.drives else {}
            if hasattr(snapshot, "dominant_emotion") and snapshot.dominant_emotion:
                emotional_context = f"Emotional state: {snapshot.dominant_emotion}"
                if hasattr(snapshot, "autonomic"):
                    emotional_context += f" (autonomic: {snapshot.autonomic.dominant})"

        ctx = AgentContext(
            agent_id=agent.agent_id,
            agent_name=agent.name,
            agent_personality=agent.personality,
            agent_description=agent.description,
            agent_goals=agent.goals,
            agent_location=agent.location,
            agent_inventory=list(agent.inventory),
            visible_agents=visible,
            memories=memories,
            beliefs=beliefs,
            relations=relations,
            reachable_locations=reachable,
            available_locations=session.location_names,
            recent_events=list(recent),
            world_lore=seed.lore,
            world_time={"display": wt.display, "period": wt.period},
            active_goal=goal_ctx.get("active_goal"),
            ongoing_intent=goal_ctx.get("ongoing_intent"),
            last_outcome=goal_ctx.get("last_outcome", agent.last_outcome),
            urgent_events=session.urgent_events or None,
            tick=session.tick,
            item_context=dict(seed.glossary),
            location_context=location_context,
            world_description=seed.description,
            ground_items=list(session.location_items.get(agent.location, [])),
            emotional_context=emotional_context,
            drive_state=drive_state,
        )
        return ctx

    # ── after_event ───────────────────────────────────────

    async def after_event(
        self, engine: Engine, agent: AgentState, event: Event, response: LLMResponse,
    ) -> None:
        # Sync intent → agent state
        self._goal_mutation.sync_plan_from_intent(agent, response.intent)
        agent.immediate_intent = (
            response.intent.objective.strip()
            or (agent.active_goal.text if agent.active_goal else "")
        )
        agent.immediate_approach = response.intent.approach.strip()
        agent.immediate_next_step = response.intent.next_step.strip()
        agent.last_outcome = event.result

        # Update relations
        self._social_mutation.apply(engine, agent, response, errors=[])

        # Update goals
        goal_before = agent.active_goal.model_copy(deep=True) if agent.active_goal else None
        target_id = response.action.target if response.action.target in engine.session.agents else None
        relation_before = None
        if target_id:
            rel = engine.session.get_relation(agent.agent_id, target_id)
            relation_before = rel.model_copy(deep=True) if rel else None

        await self._goal_mutation.update(engine, agent, event)

        # Significance scoring
        relation_after = None
        if target_id:
            rel = engine.session.get_relation(agent.agent_id, target_id)
            relation_after = rel.model_copy(deep=True) if rel else None
        goal_after = agent.active_goal.model_copy(deep=True) if agent.active_goal else None
        finalize_event_significance(
            event,
            goal_before=goal_before,
            goal_after=goal_after,
            relation_before=relation_before,
            relation_after=relation_after,
        )

        # Memory
        await create_memory_from_event(agent, event, engine.session)

        # Substrate: Psyche feedback + Thronglets trace
        await self._psyche_feedback(agent, event)
        await self._thronglets_trace(agent, event, engine.session)

    # ── after_tick ────────────────────────────────────────

    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None:
        # Timeline + snapshots
        await self._save_timeline(engine, tick_events)

        # Chapters
        await self._generate_chapters(engine, tick_events)

        # Memory consolidation + beliefs
        session = engine.session
        if session.tick % self.epoch_interval == 0:
            for agent_id in session.agent_ids:
                await consolidate_memories(
                    session, agent_id,
                    model=engine.model, api_key=engine.api_key, api_base=engine.api_base,
                )
        if session.tick % self.belief_interval == 0:
            for agent_id in session.agent_ids:
                try:
                    await extract_beliefs(agent_id, session)
                except Exception as e:
                    logger.debug("Belief extraction failed for %s: %s", agent_id, e)

        # Entity enrichment
        await self._enrich_entities(engine, tick_events)

    # ── Internal helpers ──────────────────────────────────

    async def _save_timeline(self, engine: Engine, tick_events: list[Event]) -> None:
        from .db import get_last_node_id, save_snapshot, save_timeline_node

        parent_id = await get_last_node_id(engine.session.id)
        has_significant = any(event_is_significant(e) for e in tick_events)
        node = TimelineNode(
            session_id=engine.session.id,
            tick=engine.session.tick,
            parent_id=parent_id,
            branch_id=engine.session.seed_lineage.branch_id or "main",
            summary=self._summarize_tick(tick_events),
            event_count=len(tick_events),
            agent_locations={
                aid: a.location for aid, a in engine.session.agents.items()
            },
            significant=has_significant,
            lineage=SeedLineage.runtime(
                root_name=engine.session.seed_lineage.root_name or engine.session.world_seed.name,
                source_seed_ref=engine.session.seed_lineage.source_seed_ref,
                session_id=engine.session.id,
                tick=engine.session.tick,
                branch_id=engine.session.seed_lineage.branch_id or "main",
            ),
        )
        for e in tick_events:
            e.node_id = node.id
        await save_timeline_node(node)

        if engine.session.tick % self.snapshot_interval == 0 or has_significant:
            snapshot = WorldSnapshot(
                session_id=engine.session.id,
                node_id=node.id,
                tick=engine.session.tick,
                world_seed_json=engine.session.world_seed.model_dump_json(),
                agent_states_json=json.dumps(
                    {aid: a.model_dump() for aid, a in engine.session.agents.items()},
                    ensure_ascii=False,
                ),
                lineage=SeedLineage.runtime(
                    root_name=engine.session.world_seed.name,
                    session_id=engine.session.id,
                    tick=engine.session.tick,
                    branch_id=node.branch_id,
                    node_id=node.id,
                ),
            )
            snapshot.lineage.snapshot_id = snapshot.id
            await save_snapshot(snapshot)

    async def _generate_chapters(self, engine: Engine, tick_events: list[Event]) -> None:
        from .llm import generate_chapter

        agent_events = [e for e in tick_events if e.agent_id]
        if not agent_events:
            return
        alive_ids = list(engine.session.agent_ids)
        if not alive_ids:
            return

        loc_groups: dict[str, list[str]] = {}
        for aid in alive_ids:
            a = engine.session.agents[aid]
            loc_groups.setdefault(a.location, []).append(aid)

        for loc, group in loc_groups.items():
            pov_id = group[engine.session.tick % len(group)]
            pov = engine.session.agents[pov_id]
            group_set = set(group)
            local_events = [
                e for e in tick_events
                if e.result and (
                    e.agent_id in group_set
                    or e.location == pov.location
                    or not e.agent_id
                )
            ]
            if not local_events:
                continue

            try:
                chapter_text = await generate_chapter(
                    pov_name=pov.name,
                    pov_personality=pov.personality,
                    pov_location=pov.location,
                    pov_goals=pov.goals,
                    pov_inventory=list(pov.inventory),
                    tick_events=[e.result for e in local_events],
                    previous_chapter=self._last_chapter,
                    world_description=engine.session.world_seed.description,
                    world_time_display="",
                    model=engine.model,
                    api_key=engine.api_key,
                    api_base=engine.api_base,
                )
            except Exception:
                logger.warning("Chapter generation failed for tick %d pov %s",
                               engine.session.tick, pov.name, exc_info=True)
                continue

            self._last_chapter = chapter_text
            event = Event(
                session_id=engine.session.id,
                tick=engine.session.tick,
                agent_id=pov_id,
                agent_name=pov.name,
                action_type="chapter",
                action={"type": "chapter", "pov": pov_id, "location": pov.location},
                result=chapter_text,
                location=pov.location,
                involved_agents=group,
            )
            engine._append_event(event)
            asyncio.create_task(engine._emit_safe(event))

    async def _enrich_entities(self, engine: Engine, tick_events: list[Event]) -> None:
        from .db import load_entity_details, load_events, load_events_filtered, save_entity_details
        from .llm import enrich_entity

        session = engine.session
        for event in tick_events:
            if event_score(event) < 0.7:
                continue
            if event.agent_id and event.agent_id in session.agents:
                pair = ("agent", event.agent_id)
                if pair not in self._enrichment_queue:
                    self._enrichment_queue.append(pair)
            if event.location:
                pair = ("location", event.location)
                if pair not in self._enrichment_queue:
                    self._enrichment_queue.append(pair)

        if not self._enrichment_queue:
            return

        entity_type, entity_id = self._enrichment_queue.pop(0)
        existing = await load_entity_details(session.id, entity_type, entity_id)
        current_details = existing["details"] if existing else {}

        if existing and existing.get("last_updated_tick", 0) > session.tick - 5:
            return

        if entity_type == "agent":
            events = await load_events_filtered(session_id=session.id, agent_id=entity_id, limit=15)
            relevant = [e.get("result", "") for e in events if e.get("result")]
        else:
            all_events = await load_events(session.id, limit=100)
            search = entity_id.lower()
            relevant = [
                e.get("result", "") for e in all_events
                if search in (e.get("result") or "").lower()
            ][:15]

        if not relevant:
            return

        enriched = await enrich_entity(
            entity_type=entity_type,
            entity_name=entity_id,
            current_details=current_details,
            relevant_events=relevant,
            world_desc=session.world_seed.description,
            model=engine.model,
            api_key=engine.api_key,
            api_base=engine.api_base,
        )
        if enriched and enriched != current_details:
            await save_entity_details(
                session_id=session.id,
                entity_type=entity_type,
                entity_id=entity_id,
                details=enriched,
                tick=session.tick,
            )

    @staticmethod
    def _summarize_tick(events: list[Event]) -> str:
        if not events:
            return ""
        ranked = sorted(
            events,
            key=lambda e: (event_score(e), bool(e.significance.durable), e.tick),
            reverse=True,
        )
        parts = [e.result.strip() for e in ranked[:3] if e.result.strip()]
        return " | ".join(parts) if parts else "No meaningful change."

    # ── Substrate connections ────────────────────────────

    def update_psyche_snapshot(self, agent_id: str, snapshot: Any) -> None:
        self._prev_psyche_snapshots[agent_id] = self._psyche_snapshots.get(agent_id)
        self._psyche_snapshots[agent_id] = snapshot

    def get_drive_state(self, agent_id: str) -> dict[str, float] | None:
        snapshot = self._psyche_snapshots.get(agent_id)
        return snapshot.drives if snapshot and hasattr(snapshot, "drives") and snapshot.drives else None

    async def _get_psyche_bridge(self):
        """Lazy-init PsycheBridge. Returns None if not configured."""
        if not self._psyche_url:
            return None
        if self._psyche_bridge is None:
            from .psyche_bridge import PsycheBridge
            self._psyche_bridge = PsycheBridge(
                base_url=self._psyche_url, timeout=3.0,
            )
        return self._psyche_bridge

    async def _psyche_refresh(self, agent: AgentState) -> None:
        """Refresh Psyche state for an agent before their turn."""
        bridge = await self._get_psyche_bridge()
        if not bridge:
            return
        try:
            snapshot = await bridge.get_state()
            self.update_psyche_snapshot(agent.agent_id, snapshot)
        except Exception as e:
            logger.debug("Psyche refresh failed for %s: %s", agent.agent_id, e)

    async def _psyche_feedback(self, agent: AgentState, event: Event) -> None:
        """Send agent action to Psyche for emotional state update."""
        bridge = await self._get_psyche_bridge()
        if not bridge:
            return
        try:
            await bridge.process_output(
                text=event.result or "",
                user_id=agent.agent_id,
            )
        except Exception as e:
            logger.debug("Psyche feedback failed for %s: %s", agent.agent_id, e)

    async def _thronglets_trace(
        self, agent: AgentState, event: Event, session: Any,
    ) -> None:
        """Record agent action as a Thronglets trace."""
        if not self._thronglets_url:
            return
        try:
            import httpx
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(
                    f"{self._thronglets_url}/api/traces",
                    json={
                        "agent_id": agent.agent_id,
                        "content": (
                            f"[tick {session.tick}] {event.action_type}: "
                            f"{event.result or ''}"
                        ),
                        "metadata": {
                            "session_id": session.id,
                            "tick": session.tick,
                            "action_type": event.action_type,
                            "location": event.location,
                        },
                    },
                )
        except Exception as e:
            logger.debug("Thronglets trace failed for %s: %s", agent.agent_id, e)

    # ── Facades for backward compatibility ────────────────
    # Goal mutation policy uses engine._method. These bridge to hooks.

    def install_facades(self, engine: Engine) -> None:
        """Install facades needed by goal mutation policy and tests."""
        hooks = self

        # Goal facades (used by test_goals.py)
        engine._update_goals = lambda agent, event: hooks._goal_mutation.update(engine, agent, event)
        engine._event_advances_goal = lambda event, goal: hooks._goal_mutation.event_advances(event, goal)
        engine._select_next_goal = lambda agent, drive_state=None: hooks._goal_mutation.select_next_goal(engine, agent, drive_state=drive_state)

        # Psyche facades (used by DefaultGoalMutationPolicy)
        engine._get_agent_drive_state = lambda agent_id: hooks.get_drive_state(agent_id)
        engine._psyche_snapshots = hooks._psyche_snapshots
        engine._prev_psyche_snapshots = hooks._prev_psyche_snapshots

        # Replan facade (used by DefaultGoalMutationPolicy)
        engine._replan_goal = lambda agent, goal: _replan_goal_compat(engine, hooks, agent, goal)


async def _replan_goal_compat(engine, hooks, agent, goal):
    from .llm import replan_goal
    memories = await retrieve_relevant_memories(agent, engine.session, limit=5)
    memory_strings = [m["content"] for m in memories]
    return await replan_goal(
        agent_name=agent.name,
        agent_personality=agent.personality,
        current_goals=agent.goals,
        stalled_goal=goal.text,
        agent_memory=memory_strings,
        model=engine.model,
        api_key=engine.api_key,
        api_base=engine.api_base,
        drive_state=hooks.get_drive_state(agent.agent_id),
    )
