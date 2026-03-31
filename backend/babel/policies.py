"""BABEL — Pluggable simulation policies.

These policies hold the default domain logic for:
- pressure / perturbation handling
- invalid-action repair / retry semantics
- action proposal assembly before world validation
- context / perception assembly before a brain sees the world
- social ledger updates and relation projection
- goal lifecycle and progress evaluation

Engine orchestrates. Policies decide *how* these subsystems behave.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

from .clock import world_time
from .memory import get_visible_agents
from .decision import AgentContext
from .models import (
    ActionOutput,
    ActionType,
    AgentState,
    Event,
    GoalState,
    IntentState,
    LLMResponse,
    SeedLineage,
    StateChanges,
    TimelineNode,
    WorldSnapshot,
)
from .significance import event_is_significant, event_score, finalize_event_significance

if TYPE_CHECKING:
    from .engine import Engine
    from .models import LLMResponse, Session


class PressurePolicy(Protocol):
    async def before_agent_turn(self, engine: Engine, agent: AgentState) -> list[Event]: ...


class PerceptionPolicy(Protocol):
    async def build_context(self, engine: Engine, agent: AgentState) -> AgentContext: ...


class ResolutionPolicy(Protocol):
    def max_attempts(self, engine: Engine, agent: AgentState) -> int: ...
    def repair_context(
        self,
        engine: Engine,
        agent: AgentState,
        context: AgentContext,
        last_error: str,
        attempt: int,
    ) -> AgentContext: ...
    def invalid_result(self, engine: Engine, agent: AgentState, error: str) -> str: ...


class ProposalPolicy(Protocol):
    def build_response(
        self,
        engine: Engine,
        agent: AgentState,
        action: ActionOutput,
    ) -> LLMResponse: ...


class SocialProjectionPolicy(Protocol):
    def build_relation_context(self, session: Session, agent: AgentState) -> list[dict[str, Any]]: ...


class SocialMutationPolicy(Protocol):
    def apply(self, engine: Engine, agent: AgentState, response: LLMResponse, errors: list[str]) -> None: ...


class GoalProjectionPolicy(Protocol):
    def build_goal_context(self, agent: AgentState) -> dict[str, Any]: ...


class GoalMutationPolicy(Protocol):
    def ensure_active_goal(self, engine: Engine, agent: AgentState) -> None: ...
    def sync_plan_from_intent(self, agent: AgentState, intent: IntentState) -> None: ...
    def record_blocker(self, agent: AgentState, blocker: str) -> None: ...
    async def update(self, engine: Engine, agent: AgentState, event: Event) -> None: ...
    def event_advances(self, event: Event, goal: GoalState | None) -> bool: ...
    def select_next_goal(
        self,
        engine: Engine,
        agent: AgentState,
        drive_state: dict[str, float] | None = None,
    ) -> GoalState | None: ...
    def check_drive_shift(self, engine: Engine, agent: AgentState) -> None: ...


class TimelinePolicy(Protocol):
    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None: ...


class MemoryPolicy(Protocol):
    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None: ...


class EnrichmentPolicy(Protocol):
    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None: ...


class DefaultPressurePolicy:
    async def before_agent_turn(self, engine: Engine, agent: AgentState) -> list[Event]:
        if not await engine._detect_repetition(agent):
            return []

        perturbation = await engine._generate_perturbation()
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
        await engine._remember_event(agent, world_event, f"[WORLD] {perturbation}")
        return [world_event]


def _build_agent_context(engine: Engine, agent: AgentState, **overrides) -> AgentContext:
    visible = get_visible_agents(agent, engine.session)
    reachable = engine.session.location_connections(agent.location)
    agent_relations = engine.social_projection_policy.build_relation_context(engine.session, agent)
    wt = world_time(engine.session.tick, engine.session.world_seed.time)
    goal_context = engine.goal_projection_policy.build_goal_context(agent)

    # Extract item/location descriptions from seed for richer LLM context
    seed = engine.session.world_seed
    item_context: dict[str, str] = {}
    for item in seed.items:
        if item.description:
            item_context[item.name] = item.description
    for res in seed.resources:
        if res.description:
            item_context[res.name] = res.description
    location_context: dict[str, str] = {}
    for loc in seed.locations:
        if loc.description:
            location_context[loc.name] = loc.description

    context = AgentContext(
        agent_id=agent.agent_id,
        agent_name=agent.name,
        agent_personality=agent.personality,
        agent_description=agent.description,
        agent_goals=agent.goals,
        agent_location=agent.location,
        agent_inventory=list(agent.inventory),
        visible_agents=visible,
        relations=agent_relations,
        reachable_locations=reachable,
        available_locations=engine.session.location_names,
        world_rules=engine.session.world_seed.rules,
        world_time={"display": wt.display, "period": wt.period},
        active_goal=goal_context.get("active_goal"),
        ongoing_intent=goal_context.get("ongoing_intent"),
        last_outcome=goal_context.get("last_outcome", agent.last_outcome),
        urgent_events=engine.session.urgent_events or None,
        tick=engine.session.tick,
        item_context=item_context,
        location_context=location_context,
    )

    for key, value in overrides.items():
        if hasattr(context, key):
            setattr(context, key, value)

    return context


class DefaultPerceptionPolicy:
    async def build_context(self, engine: Engine, agent: AgentState) -> AgentContext:
        memories = await engine._retrieve_relevant_memories(agent)
        recent_events = await engine._get_relevant_events(agent)
        beliefs = await engine._get_agent_beliefs(agent.agent_id)
        return _build_agent_context(
            engine,
            agent,
            memories=memories,
            beliefs=beliefs,
            recent_events=list(recent_events),
        )


class DefaultResolutionPolicy:
    def max_attempts(self, engine: Engine, agent: AgentState) -> int:
        del engine, agent
        return 2

    def repair_context(
        self,
        engine: Engine,
        agent: AgentState,
        context: AgentContext,
        last_error: str,
        attempt: int,
    ) -> AgentContext:
        del engine, agent
        if not last_error:
            return context
        retry_note = (
            f"[SYSTEM] Previous action was invalid: {last_error}. "
            f"Try again with a legal action. Attempt {attempt + 1}."
        )
        return context.model_copy(update={
            "recent_events": [*context.recent_events, retry_note],
        })

    def invalid_result(self, engine: Engine, agent: AgentState, error: str) -> str:
        del engine, agent
        return f"Action invalid: {error}"


class DefaultProposalPolicy:
    def build_response(
        self,
        engine: Engine,
        agent: AgentState,
        action: ActionOutput,
    ) -> LLMResponse:
        del engine, agent
        state_changes = StateChanges()
        if action.type == ActionType.MOVE and action.target:
            state_changes.location = action.target
        return LLMResponse(
            thinking="(decision source)",
            intent=action.intent or {},
            action=action,
            state_changes=state_changes,
        )


class DefaultTimelinePolicy:
    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None:
        parent_id = await engine._get_last_node_id()
        has_significant = any(event_is_significant(event) for event in tick_events)
        node = TimelineNode(
            session_id=engine.session.id,
            tick=engine.session.tick,
            parent_id=parent_id,
            branch_id=engine.session.seed_lineage.branch_id or "main",
            summary=self.summarize_tick(tick_events),
            event_count=len(tick_events),
            agent_locations={
                agent_id: agent.location
                for agent_id, agent in engine.session.agents.items()
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

        for event in tick_events:
            event.node_id = node.id

        await engine._save_timeline_node(node)

        if engine.session.tick % engine.snapshot_interval == 0 or has_significant:
            snapshot = WorldSnapshot(
                session_id=engine.session.id,
                node_id=node.id,
                tick=engine.session.tick,
                world_seed_json=engine.session.world_seed.model_dump_json(),
                agent_states_json=engine._dump_agent_states_json(),
                lineage=SeedLineage.runtime(
                    root_name=engine.session.world_seed.name,
                    session_id=engine.session.id,
                    tick=engine.session.tick,
                    branch_id=node.branch_id,
                    node_id=node.id,
                ),
            )
            snapshot.lineage.snapshot_id = snapshot.id
            await engine._save_snapshot(snapshot)

    @staticmethod
    def summarize_tick(events: list[Event]) -> str:
        if not events:
            return ""
        ranked = sorted(
            events,
            key=lambda event: (event_score(event), bool(event.significance.durable), event.tick),
            reverse=True,
        )
        picked = ranked[:3]
        parts = [event.result.strip() for event in picked if event.result.strip()]
        return " | ".join(parts) if parts else "No meaningful change."


class DefaultMemoryPolicy:
    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None:
        del tick_events
        session = engine.session
        if session.tick % engine.epoch_interval == 0:
            for agent_id in session.agent_ids:
                await engine._consolidate_memories(agent_id)

        if session.tick % engine.belief_interval == 0:
            for agent_id in session.agent_ids:
                await engine._extract_beliefs(agent_id)


class DefaultEnrichmentPolicy:
    async def after_tick(self, engine: Engine, tick_events: list[Event]) -> None:
        session = engine.session

        for event in tick_events:
            if event_score(event) < 0.7:
                continue
            if event.agent_id and event.agent_id in session.agents:
                pair = ("agent", event.agent_id)
                if pair not in engine._enrichment_queue:
                    engine._enrichment_queue.append(pair)
            if event.location:
                pair = ("location", event.location)
                if pair not in engine._enrichment_queue:
                    engine._enrichment_queue.append(pair)

        if not engine._enrichment_queue:
            return

        entity_type, entity_id = engine._enrichment_queue.pop(0)
        existing = await engine._load_entity_details(entity_type, entity_id)
        current_details = existing["details"] if existing else {}

        if existing and existing.get("last_updated_tick", 0) > session.tick - 5:
            return

        relevant_event_strings: list[str] = []
        if entity_type == "agent":
            events = await engine._load_events_filtered(agent_id=entity_id, limit=15)
            relevant_event_strings = [event.get("result", "") for event in events if event.get("result")]
        else:
            all_events = await engine._load_events(limit=100)
            search_term = entity_id.lower()
            for event in all_events:
                result_text = (event.get("result") or "").lower()
                if search_term in result_text:
                    relevant_event_strings.append(event.get("result", ""))
            relevant_event_strings = relevant_event_strings[:15]

        if not relevant_event_strings:
            return

        enriched = await engine._enrich_entity(
            entity_type=entity_type,
            entity_id=entity_id,
            current_details=current_details,
            relevant_events=relevant_event_strings,
        )
        if enriched and enriched != current_details:
            await engine._save_entity_details(
                entity_type=entity_type,
                entity_id=entity_id,
                details=enriched,
                tick=session.tick,
            )


class DefaultSocialProjectionPolicy:
    def build_relation_context(self, session: Session, agent: AgentState) -> list[dict[str, Any]]:
        agent_relations: list[dict[str, Any]] = []
        for rel in session.relations:
            if rel.source != agent.agent_id:
                continue
            target_agent = session.agents.get(rel.target)
            if not target_agent:
                continue
            if target_agent.status.value in {"dead", "gone"}:
                continue
            agent_relations.append({
                "name": target_agent.name,
                "type": rel.type,
                "strength": rel.strength,
                "trust": rel.trust,
                "tension": rel.tension,
                "familiarity": rel.familiarity,
                "debt_balance": rel.debt_balance,
                "leverage": rel.leverage,
                "last_interaction": rel.last_interaction,
            })
        return agent_relations


class DefaultSocialMutationPolicy:
    def apply(self, engine: Engine, agent: AgentState, response: LLMResponse, errors: list[str]) -> None:
        target_id = response.action.target
        if not target_id or target_id not in engine.session.agents:
            return

        tick = engine.session.tick
        action_type = response.action.type

        social: dict[str, float] | None = None
        if action_type == ActionType.SPEAK:
            delta = 0.04
            social = {
                "trust": 0.03,
                "tension": -0.02,
                "familiarity": 0.08,
            }
        elif action_type == ActionType.TRADE:
            gave_more_than_received = (
                len(response.state_changes.inventory_remove)
                > len(response.state_changes.inventory_add)
            )
            if not errors:
                delta = 0.08
                social = {
                    "trust": 0.06,
                    "tension": -0.03,
                    "familiarity": 0.05,
                    "debt": 0.12 if gave_more_than_received else 0.0,
                }
            else:
                delta = -0.05
                social = {
                    "trust": -0.08,
                    "tension": 0.08,
                    "familiarity": 0.02,
                }
        else:
            return

        note = response.action.content or action_type.value
        engine.session.update_relation(
            agent.agent_id, target_id, delta, tick,
            social=social, note=note,
        )
        mirror_social = dict(social or {})
        if "debt" in mirror_social:
            mirror_social["debt"] = -mirror_social["debt"]
        engine.session.update_relation(
            target_id, agent.agent_id, delta, tick,
            social=mirror_social, note=note,
        )


class DefaultGoalProjectionPolicy:
    def build_goal_context(self, agent: AgentState) -> dict[str, Any]:
        active_goal = agent.active_goal.model_dump() if agent.active_goal else None
        ongoing_intent = None
        if any(
            value.strip()
            for value in (
                agent.immediate_intent,
                agent.immediate_approach,
                agent.immediate_next_step,
            )
        ):
            ongoing_intent = {
                "objective": agent.immediate_intent,
                "approach": agent.immediate_approach,
                "next_step": agent.immediate_next_step,
            }
        return {
            "active_goal": active_goal,
            "ongoing_intent": ongoing_intent,
            "last_outcome": agent.last_outcome,
        }


class DefaultGoalMutationPolicy:
    def ensure_active_goal(self, engine: Engine, agent: AgentState) -> None:
        if agent.goals and not agent.active_goal:
            agent.active_goal = GoalState(
                text=agent.goals[0],
                started_tick=engine.session.tick,
            )
            agent.active_goal.success_criteria = self.infer_success_criteria(agent.active_goal.text)

    @staticmethod
    def infer_success_criteria(goal_text: str) -> str:
        text = goal_text.strip()
        lower = text.lower()
        if not text:
            return ""
        if any(token in lower for token in ("find", "discover", "locate", "search", "找到", "发现", "调查")):
            return "You uncover concrete evidence, information, or the target itself."
        if any(token in lower for token in ("talk", "convince", "speak", "ask", "说服", "交涉", "谈")):
            return "You have a meaningful exchange that changes the situation."
        if any(token in lower for token in ("trade", "obtain", "acquire", "get", "获取", "交易", "得到")):
            return "You secure the resource, item, or agreement you need."
        if any(token in lower for token in ("protect", "defend", "guard", "守护", "保护")):
            return "The threatened person or place becomes safer than before."
        return "The world state changes in a clear way toward this goal."

    @staticmethod
    def _relevant_goal_text(goal: GoalState) -> str:
        return " ".join(
            part for part in (
                goal.text,
                goal.strategy,
                goal.next_step,
                goal.success_criteria,
                " ".join(goal.blockers),
            ) if part
        ).strip()

    @staticmethod
    def _extract_goal_terms(text: str) -> set[str]:
        stopwords = {
            "the", "a", "an", "is", "to", "of", "in", "and", "or",
            "for", "at", "on", "by", "it", "be", "do", "your", "you",
            "this", "that", "with", "from", "into", "toward", "towards",
            "的", "了", "在", "是", "和", "与", "把", "让", "被", "一个",
        }
        return {
            token for token in text.lower().replace('"', " ").split()
            if len(token) >= 2 and token not in stopwords
        }

    def sync_plan_from_intent(self, agent: AgentState, intent: IntentState) -> None:
        goal = agent.active_goal
        if not goal or not intent.has_content():
            return
        if not goal.success_criteria:
            goal.success_criteria = self.infer_success_criteria(goal.text)
        if intent.approach.strip():
            goal.strategy = intent.approach.strip()
        if intent.next_step.strip():
            goal.next_step = intent.next_step.strip()

    def record_blocker(self, agent: AgentState, blocker: str) -> None:
        goal = agent.active_goal
        blocker = blocker.strip()
        if not goal or not blocker:
            return
        if blocker not in goal.blockers:
            goal.blockers = [*goal.blockers[:2], blocker]

    def progress_increment(self, event: Event, goal: GoalState | None) -> float:
        if not goal or not event.result:
            return 0.0

        core_goal_text = goal.text.strip()
        goal_text = self._relevant_goal_text(goal)
        # Check both result and action content for goal alignment
        action_content = str(event.action.get("content", "") or "").lower()
        search_text = f"{event.result.lower()} {action_content}"
        core_terms = self._extract_goal_terms(core_goal_text)
        matches = sum(1 for term in core_terms if term in search_text)
        threshold = max(1, len(core_terms) // 4) if core_terms else 0

        action_type = event.action_type if isinstance(event.action_type, str) else event.action_type.value
        action_target = str(event.action.get("target", "") or "").lower()
        goal_lower = goal_text.lower()

        if action_type == "wait":
            return 0.0
        if matches >= threshold and threshold > 0:
            return 0.22
        if action_type == "move":
            move_target = action_target or (event.location or "").lower()
            if move_target and move_target in goal_lower:
                return 0.18
        if action_type == "speak":
            social_words = ("talk", "speak", "convince", "ask", "ally", "trust", "说", "谈", "说服", "信任")
            if action_target and action_target in goal_lower:
                return 0.18
            if any(word in goal_lower for word in social_words):
                return 0.12
        if action_type == "trade":
            trade_words = ("trade", "exchange", "obtain", "get", "acquire", "buy", "sell", "交易", "获取", "得到", "交换")
            if any(word in goal_lower for word in trade_words):
                return 0.18
        if action_type == "use_item" and action_target and action_target in goal_lower:
            return 0.18
        if action_type == "observe":
            investigation_words = ("find", "search", "observe", "investigate", "learn", "look", "notice", "查", "找", "观察", "调查", "发现")
            if any(word in goal_lower for word in investigation_words):
                return 0.1
        return 0.0

    def event_advances(self, event: Event, goal: GoalState | None) -> bool:
        return self.progress_increment(event, goal) > 0

    async def update(self, engine: Engine, agent: AgentState, event: Event) -> None:
        goal = agent.active_goal
        if not goal:
            return
        if goal.status in ("completed", "failed"):
            return
        if not goal.success_criteria:
            goal.success_criteria = self.infer_success_criteria(goal.text)

        progress_delta = self.progress_increment(event, goal)
        if progress_delta > 0:
            goal.progress = min(goal.progress + progress_delta, 1.0)
            goal.stall_count = 0
            goal.last_progress_reason = event.result
            if goal.next_step and goal.next_step.lower() in event.result.lower():
                goal.next_step = ""
        else:
            goal.stall_count += 1

        if goal.progress >= 0.95:
            goal.status = "completed"
            drive_state = engine._get_agent_drive_state(agent.agent_id)
            agent.active_goal = self.select_next_goal(engine, agent, drive_state=drive_state)
            agent.immediate_intent = agent.active_goal.text if agent.active_goal else ""
            agent.immediate_approach = ""
            agent.immediate_next_step = ""
            return

        if goal.stall_count >= 8:
            goal.status = "stalled"
            drive_state = engine._get_agent_drive_state(agent.agent_id)
            try:
                goal_plan = await engine._replan_goal(agent, goal)
                new_text = goal_plan.get("text", goal.text)
                # Preserve progress if the core goal hasn't changed
                preserved_progress = goal.progress if new_text == goal.text else max(goal.progress * 0.5, 0.0)
                agent.active_goal = GoalState(
                    text=new_text,
                    started_tick=engine.session.tick,
                    progress=preserved_progress,
                    strategy=goal_plan.get("strategy", ""),
                    next_step=goal_plan.get("next_step", ""),
                    success_criteria=goal_plan.get("success_criteria", ""),
                    blockers=goal_plan.get("blockers", []),
                )
                if not agent.active_goal.success_criteria:
                    agent.active_goal.success_criteria = self.infer_success_criteria(agent.active_goal.text)
                agent.immediate_intent = agent.active_goal.text
                agent.immediate_approach = ""
                agent.immediate_next_step = ""
            except Exception:
                agent.active_goal = self.select_next_goal(engine, agent, drive_state=drive_state)
                if agent.active_goal and not agent.active_goal.success_criteria:
                    agent.active_goal.success_criteria = self.infer_success_criteria(agent.active_goal.text)
                agent.immediate_intent = agent.active_goal.text if agent.active_goal else ""
                agent.immediate_approach = ""
                agent.immediate_next_step = ""

        self.check_drive_shift(engine, agent)

    def select_next_goal(
        self,
        engine: Engine,
        agent: AgentState,
        drive_state: dict[str, float] | None = None,
    ) -> GoalState | None:
        if not agent.goals:
            return None
        if drive_state:
            from .drive_mapping import score_goal_by_drives

            scored = [(score_goal_by_drives(goal, drive_state), goal) for goal in agent.goals]
            scored.sort(key=lambda item: item[0], reverse=True)
            picked = GoalState(text=scored[0][1], started_tick=engine.session.tick)
            picked.success_criteria = self.infer_success_criteria(picked.text)
            return picked

        current_text = agent.active_goal.text if agent.active_goal else ""
        try:
            idx = agent.goals.index(current_text)
            next_idx = (idx + 1) % len(agent.goals)
        except ValueError:
            next_idx = 0
        picked = GoalState(text=agent.goals[next_idx], started_tick=engine.session.tick)
        picked.success_criteria = self.infer_success_criteria(picked.text)
        return picked

    def check_drive_shift(self, engine: Engine, agent: AgentState) -> None:
        if not agent.active_goal or agent.active_goal.status != "active":
            return
        current = engine._psyche_snapshots.get(agent.agent_id)
        previous = engine._prev_psyche_snapshots.get(agent.agent_id)
        if not current or not previous or not current.drives or not previous.drives:
            return

        drives = ("survival", "safety", "connection", "esteem", "curiosity")
        max_shift = max(
            abs(current.drives.get(drive, 50) - previous.drives.get(drive, 50))
            for drive in drives
        )
        if max_shift <= 30:
            return

        new_goal = self.select_next_goal(engine, agent, drive_state=current.drives)
        if new_goal and new_goal.text != agent.active_goal.text:
            agent.active_goal = new_goal


