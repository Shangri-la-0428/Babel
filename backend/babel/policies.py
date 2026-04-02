"""BABEL — Domain policies for social ledger and goal lifecycle.

These policies hold the default domain logic for:
- social ledger updates and relation projection
- goal lifecycle and progress evaluation

The engine is a pure causal kernel. Hooks are the medium adapter.
Policies are reusable domain logic that hooks compose internally.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

from .models import (
    ActionType,
    AgentState,
    Event,
    GoalState,
    IntentState,
    LLMResponse,
)

if TYPE_CHECKING:
    from .engine import Engine
    from .models import Session


# ── Protocols ────────────────────────────────────────────

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


# ── Default implementations ─────────────────────────────

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
