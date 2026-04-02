"""BABEL — Decision source abstraction (World Kernel Protocol).

Decouples the 'who decides' from the world engine.
DecisionSource is a Protocol — anything that can produce an ActionOutput
from an AgentContext can drive agents (LLM, human, script, other AI).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

from pydantic import BaseModel, Field

from .models import ActionOutput, ActionType, AgentInternalState


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
    world_lore: list[str] = Field(default_factory=list)
    world_time: dict[str, Any] = Field(default_factory=dict)
    active_goal: dict[str, Any] | None = None
    ongoing_intent: dict[str, str] | None = None
    last_outcome: str = ""
    urgent_events: list[str] | None = None
    tick: int = 0
    # World context: item/location descriptions from seed for richer decisions
    world_description: str = ""
    item_context: dict[str, str] = Field(default_factory=dict)
    location_context: dict[str, str] = Field(default_factory=dict)
    # Physics: items on the ground at this location (from regeneration)
    ground_items: list[str] = Field(default_factory=list)
    # Agent internal state (from AgentPhysics: energy, stress, momentum)
    internal_state: AgentInternalState = Field(default_factory=AgentInternalState)
    # Phase B: Psyche emotional context (optional, for LLM prompt enrichment)
    emotional_context: str = ""
    drive_state: dict[str, float] = Field(default_factory=dict)


@runtime_checkable
class DecisionSource(Protocol):
    """Anything that can decide an agent's next action."""

    async def decide(self, context: AgentContext) -> ActionOutput: ...


@runtime_checkable
class ActionCritic(Protocol):
    """Review or rewrite an action candidate before it leaves the brain layer."""

    async def critique(self, context: AgentContext, action: ActionOutput) -> ActionOutput: ...


class LLMDecisionModel:
    """Default decision model backed by prompts.py + llm.py."""

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

        memory_strings = (
            [m["content"] for m in context.memories] if context.memories else []
        )
        response = await get_agent_action(
            world_lore=context.world_lore,
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
            ongoing_intent=context.ongoing_intent,
            last_outcome=context.last_outcome,
            emotional_context=context.emotional_context,
            item_context=context.item_context or None,
            location_context=context.location_context or None,
            world_description=context.world_description,
        )
        return response.action.model_copy(update={"intent": response.intent})


class PassthroughActionCritic:
    """Default critic: keep the chosen action unchanged."""

    async def critique(self, context: AgentContext, action: ActionOutput) -> ActionOutput:
        return action


class LLMDecisionSource:
    """Decision source wrapping the existing prompts.py + llm.py pipeline."""

    def __init__(
        self,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        *,
        decision_model: LLMDecisionModel | None = None,
        action_critic: ActionCritic | None = None,
    ):
        self._decision_model = decision_model or LLMDecisionModel(
            model=model,
            api_key=api_key,
            api_base=api_base,
        )
        self._action_critic = action_critic or PassthroughActionCritic()

    @property
    def model(self) -> str | None:
        return getattr(self._decision_model, "model", None)

    @model.setter
    def model(self, value: str | None) -> None:
        if hasattr(self._decision_model, "model"):
            setattr(self._decision_model, "model", value)

    @property
    def api_key(self) -> str | None:
        return getattr(self._decision_model, "api_key", None)

    @api_key.setter
    def api_key(self, value: str | None) -> None:
        if hasattr(self._decision_model, "api_key"):
            setattr(self._decision_model, "api_key", value)

    @property
    def api_base(self) -> str | None:
        return getattr(self._decision_model, "api_base", None)

    @api_base.setter
    def api_base(self, value: str | None) -> None:
        if hasattr(self._decision_model, "api_base"):
            setattr(self._decision_model, "api_base", value)

    async def decide(self, context: AgentContext) -> ActionOutput:
        action = await self._decision_model.decide(context)
        return await self._action_critic.critique(context, action)


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
        self._fallback = fallback
        self._timeout = timeout
        self._on_waiting = on_waiting  # async callback(agent_id, context)
        self._human_agents: set[str] = set()
        self._pending: dict[str, asyncio.Future[ActionOutput]] = {}
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
        fut = self._pending.pop(agent_id, None)
        if fut and not fut.done():
            fut.cancel()
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
        fut: asyncio.Future[ActionOutput] = asyncio.get_running_loop().create_future()
        self._pending[agent_id] = fut
        self._pending_contexts[agent_id] = context

        # Notify that we're waiting (so frontend can show action picker)
        if self._on_waiting:
            try:
                await self._on_waiting(agent_id, context)
            except Exception as e:
                logger.debug("on_waiting callback failed for agent %s: %s", agent_id, e)

        try:
            return await asyncio.wait_for(fut, timeout=self._timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return ActionOutput(type=ActionType.WAIT, content="awaiting human input")
        finally:
            self._pending.pop(agent_id, None)
            self._pending_contexts.pop(agent_id, None)


class PsycheDecisionSource:
    """Decision source powered by the Psyche emotional engine.

    Uses Psyche's hormonal/autonomic state to weight action selection.
    Requires a running Psyche HTTP server (default: localhost:3210).

    Architecture:
      AgentContext → StimulusSynthesizer → Psyche HTTP → PolicyModifiers
                                                              ↓
                                                   ActionPool (weighted)
                                                              ↓
                                                        ActionOutput
    """

    def __init__(
        self,
        psyche_url: str = "http://127.0.0.1:3210",
        fallback: DecisionSource | None = None,
        timeout: float = 5.0,
    ):
        from .psyche_bridge import PsycheBridge

        self._bridge = PsycheBridge(base_url=psyche_url, timeout=timeout)
        self._fallback = fallback
        self._last_snapshot: Any = None  # PsycheSnapshot, exposed for frontend

    @property
    def last_snapshot(self) -> Any:
        """Most recent PsycheSnapshot (for frontend display)."""
        return self._last_snapshot

    async def decide(self, context: AgentContext) -> ActionOutput:
        from .psyche_bridge import PsycheBridge  # noqa: F811
        from .stimulus import synthesize_stimulus

        # Check Psyche availability; fall back if down
        if not await self._bridge.is_available():
            logger.warning("Psyche server unavailable, falling back")
            if self._fallback:
                return await self._fallback.decide(context)
            return ActionOutput(type=ActionType.WAIT, content="psyche unavailable")

        # Synthesize stimulus from world context
        stimulus_text = synthesize_stimulus(context)

        # Send to Psyche, get policy modifiers
        try:
            result = await self._bridge.process_input(
                text=stimulus_text,
                user_id=context.agent_id,
            )
            snapshot = await self._bridge.get_state()
            self._last_snapshot = snapshot
        except Exception as e:
            logger.error("Psyche bridge error: %s", e)
            if self._fallback:
                return await self._fallback.decide(context)
            return ActionOutput(type=ActionType.WAIT, content="psyche error")

        # Build action pool weighted by emotional state
        action = self._select_action(context, result.policy, snapshot)

        # Notify Psyche of the chosen action (state update)
        try:
            action_desc = f"{context.agent_name} chose to {action.type.value}: {action.content}"
            await self._bridge.process_output(text=action_desc, user_id=context.agent_id)
        except Exception as e:
            logger.debug("Psyche output notification failed: %s", e)

        return action

    def _select_action(
        self,
        context: AgentContext,
        policy: Any,
        snapshot: Any,
    ) -> ActionOutput:
        """Select action weighted by Psyche's emotional state."""
        import random

        same_loc = [
            a for a in context.visible_agents
            if a.get("location") == context.agent_location
        ]
        other_locations = [
            loc for loc in (context.reachable_locations or context.available_locations)
            if loc != context.agent_location
        ]

        pool: list[tuple[float, ActionOutput]] = []

        # Autonomic gating
        dominant = snapshot.autonomic.dominant if snapshot else "ventral_vagal"

        if dominant == "dorsal_vagal":
            # Freeze state — only observe/wait
            pool.append((3.0, ActionOutput(type=ActionType.WAIT, content="frozen, overwhelmed")))
            pool.append((2.0, ActionOutput(type=ActionType.OBSERVE, content="numbly watching")))
        elif dominant == "sympathetic":
            # Fight-or-flight — prefer movement, avoid social
            pool.append((1.0, ActionOutput(type=ActionType.OBSERVE, content="scanning for threats")))
            if other_locations:
                dest = random.choice(other_locations)
                pool.append((4.0, ActionOutput(type=ActionType.MOVE, target=dest, content=f"fleeing to {dest}")))
            if context.agent_inventory:
                item = random.choice(context.agent_inventory)
                pool.append((2.0, ActionOutput(type=ActionType.USE_ITEM, target=item, content=f"readying {item}")))
        else:
            # Ventral-vagal (safe, social) — full action range
            pool.append((1.0, ActionOutput(type=ActionType.OBSERVE, content="calmly observing")))

            # Social actions weighted by proactivity
            if same_loc:
                target = random.choice(same_loc)
                social_weight = 2.0 + policy.proactivity * 3.0
                pool.append((social_weight, ActionOutput(
                    type=ActionType.SPEAK,
                    target=target["id"],
                    content=f"engaging with {target.get('name', target['id'])}",
                )))

                # Trade weighted by risk tolerance
                if context.agent_inventory:
                    item = random.choice(context.agent_inventory)
                    pool.append((policy.risk_tolerance * 2.0, ActionOutput(
                        type=ActionType.TRADE,
                        target=target["id"],
                        content=f"offering {item}",
                    )))

            # Movement weighted by exploration
            if other_locations:
                dest = random.choice(other_locations)
                explore_weight = 1.5 if not same_loc else 0.5
                pool.append((explore_weight, ActionOutput(
                    type=ActionType.MOVE,
                    target=dest,
                    content=f"heading to {dest}",
                )))

            # Item use
            if context.agent_inventory:
                item = random.choice(context.agent_inventory)
                pool.append((0.5, ActionOutput(
                    type=ActionType.USE_ITEM,
                    target=item,
                    content=f"using {item}",
                )))

        if not pool:
            return ActionOutput(type=ActionType.WAIT, content="no options available")

        # Weighted random selection
        total = sum(w for w, _ in pool)
        r = random.uniform(0, total)
        cumulative = 0.0
        for weight, action in pool:
            cumulative += weight
            if r <= cumulative:
                return action
        return pool[-1][1]


class PsycheAugmentedDecisionSource:
    """Psyche augments LLM decisions rather than replacing them.

    Unlike PsycheDecisionSource (which replaces LLM with a weighted action pool),
    this source uses Psyche to enrich the LLM's context with emotional state,
    then applies autonomic gating as a post-filter on the LLM's output.

    Flow:
      1. Send stimulus to Psyche → get emotional state + policy modifiers
      2. Build emotional context string and inject into AgentContext
      3. LLM generates narrative-quality action with emotional awareness
      4. Autonomic gating filters the action if needed
      5. Notify Psyche of the chosen action for state update
    """

    def __init__(
        self,
        psyche_url: str = "http://127.0.0.1:3210",
        llm_source: LLMDecisionSource | None = None,
        model: str | None = None,
        api_key: str | None = None,
        api_base: str | None = None,
        timeout: float = 5.0,
    ):
        from .psyche_bridge import PsycheBridge

        self._bridge = PsycheBridge(base_url=psyche_url, timeout=timeout)
        self._llm = llm_source or LLMDecisionSource(
            model=model, api_key=api_key, api_base=api_base,
        )
        self._last_snapshot: Any = None

    @property
    def last_snapshot(self) -> Any:
        """Most recent PsycheSnapshot (for frontend display)."""
        return self._last_snapshot

    async def decide(self, context: AgentContext) -> ActionOutput:
        from .psyche_bridge import PsycheBridge  # noqa: F811
        from .stimulus import synthesize_stimulus

        # 1. Check Psyche availability — fall back to pure LLM
        if not await self._bridge.is_available():
            logger.debug("Psyche unavailable, using pure LLM")
            return await self._llm.decide(context)

        # 2. Synthesize stimulus and get emotional state
        stimulus_text = synthesize_stimulus(context)
        try:
            result = await self._bridge.process_input(
                text=stimulus_text, user_id=context.agent_id,
            )
            snapshot = await self._bridge.get_state()
            self._last_snapshot = snapshot
        except Exception as e:
            logger.error("Psyche bridge error: %s", e)
            return await self._llm.decide(context)

        # 3. Build emotional context for the LLM prompt
        emotional_ctx = _build_emotional_context(snapshot, result.policy)

        # 4. Augment context with emotional information
        augmented = context.model_copy(update={
            "emotional_context": emotional_ctx,
            "drive_state": snapshot.drives,
        })

        # 5. LLM decides with emotional awareness
        action = await self._llm.decide(augmented)

        # 6. Autonomic gating (post-filter)
        action = self._autonomic_gate(action, snapshot, context)

        # 7. Notify Psyche of the chosen action
        try:
            desc = f"{context.agent_name} chose to {action.type.value}: {action.content}"
            await self._bridge.process_output(text=desc, user_id=context.agent_id)
        except Exception as e:
            logger.debug("Psyche output notification failed: %s", e)

        return action

    @staticmethod
    def _autonomic_gate(
        action: ActionOutput,
        snapshot: Any,
        context: AgentContext,
    ) -> ActionOutput:
        """Post-filter: override LLM action if autonomic state demands it."""
        dominant = snapshot.autonomic.dominant if snapshot else "ventral_vagal"

        if dominant == "dorsal_vagal" and action.type not in (ActionType.WAIT, ActionType.OBSERVE):
            return ActionOutput(type=ActionType.WAIT, content="frozen, unable to act")

        if dominant == "sympathetic" and action.type in (ActionType.SPEAK, ActionType.TRADE):
            # Downgrade social actions to movement/observation
            other_locs = [
                loc for loc in (context.reachable_locations or context.available_locations)
                if loc != context.agent_location
            ]
            if other_locs:
                import random
                return ActionOutput(
                    type=ActionType.MOVE, target=random.choice(other_locs),
                    content="instinct to flee",
                )
            return ActionOutput(type=ActionType.OBSERVE, content="scanning for threats")

        return action  # ventral-vagal: pass through


def _build_emotional_context(snapshot: Any, policy: Any) -> str:
    """Build a natural-language description of the agent's emotional state."""
    parts: list[str] = []

    # Dominant emotion
    if snapshot.dominant_emotion:
        parts.append(f"You are feeling {snapshot.dominant_emotion}.")

    # Autonomic state
    dominant = snapshot.autonomic.dominant if snapshot else "ventral_vagal"
    state_desc = {
        "ventral_vagal": "You feel safe and socially open.",
        "sympathetic": "You feel on edge, alert to danger. Your body wants to move or act.",
        "dorsal_vagal": "You feel overwhelmed and shut down. Action feels impossible.",
    }
    parts.append(state_desc.get(dominant, ""))

    # Key chemical signals
    chem = snapshot.chemicals
    if chem.cortisol > 70:
        parts.append("Stress is high — you're anxious and hypervigilant.")
    if chem.dopamine < 30:
        parts.append("Motivation is low — nothing feels rewarding.")
    if chem.oxytocin > 70:
        parts.append("You feel a strong sense of trust and connection.")
    elif chem.oxytocin < 30:
        parts.append("You feel isolated and mistrustful.")

    # Unsatisfied drives
    if snapshot.drives:
        low = [d for d, v in snapshot.drives.items() if v < 40]
        if low:
            parts.append(f"You feel a deep need for: {', '.join(low)}.")

    # Policy constraints
    if policy.proactivity < 0.3:
        parts.append("You're inclined to be passive and reactive.")
    elif policy.proactivity > 0.7:
        parts.append("You feel driven to take initiative.")

    if policy.risk_tolerance < 0.3:
        parts.append("You're cautious and want to avoid risks.")

    return " ".join(p for p in parts if p)


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


# ── External Agent Gateway ─────────────────────────────


class _Turn:
    """One decision cycle: context in, action out."""

    __slots__ = ("context", "action")

    def __init__(self, context: AgentContext):
        self.context = context
        self.action: asyncio.Future[ActionOutput] = asyncio.get_running_loop().create_future()


class ExternalDecisionSource:
    """Gateway for SDK agents to inhabit a Babel world.

    The engine pushes AgentContext via decide().
    The external agent pulls it via perceive(), thinks, and pushes back via act().

    One Turn per agent per tick. That's the whole protocol.
    """

    def __init__(
        self,
        fallback: DecisionSource | None = None,
        timeout: float = 60.0,
    ):
        self._fallback = fallback
        self._timeout = timeout
        self._agents: set[str] = set()
        self._turns: dict[str, _Turn] = {}
        self._turn_ready: dict[str, asyncio.Event] = {}

    @property
    def external_agents(self) -> set[str]:
        return self._agents.copy()

    def connect(self, agent_id: str) -> None:
        """Mark an agent as externally controlled."""
        self._agents.add(agent_id)

    def disconnect(self, agent_id: str) -> None:
        """Release external control. Cancels any pending turn."""
        self._agents.discard(agent_id)
        turn = self._turns.pop(agent_id, None)
        if turn and not turn.action.done():
            turn.action.cancel()
        evt = self._turn_ready.pop(agent_id, None)
        if evt:
            evt.set()

    async def decide(self, context: AgentContext) -> ActionOutput:
        """Called by engine. Pushes context, blocks until external agent responds."""
        aid = context.agent_id
        if aid not in self._agents:
            if self._fallback:
                return await self._fallback.decide(context)
            return ActionOutput(type=ActionType.WAIT, content="no decision source")

        turn = _Turn(context)
        self._turns[aid] = turn

        # Unblock anyone waiting in perceive()
        evt = self._turn_ready.pop(aid, None)
        if evt:
            evt.set()

        try:
            return await asyncio.wait_for(turn.action, timeout=self._timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return ActionOutput(type=ActionType.WAIT, content="external agent timeout")
        finally:
            self._turns.pop(aid, None)

    async def perceive(self, agent_id: str, timeout: float = 30.0) -> AgentContext | None:
        """Called by API. Long-polls until the engine starts this agent's turn."""
        turn = self._turns.get(agent_id)
        if turn:
            return turn.context

        evt = asyncio.Event()
        self._turn_ready[agent_id] = evt
        try:
            await asyncio.wait_for(evt.wait(), timeout=timeout)
            turn = self._turns.get(agent_id)
            return turn.context if turn else None
        except asyncio.TimeoutError:
            return None
        finally:
            self._turn_ready.pop(agent_id, None)

    def act(self, agent_id: str, action: ActionOutput) -> bool:
        """Called by API. Resolves the pending turn."""
        turn = self._turns.get(agent_id)
        if turn and not turn.action.done():
            turn.action.set_result(action)
            return True
        return False
