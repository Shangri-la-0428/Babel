"""BABEL — Minimum Viable Universe (MVU).

One external agent, 100 ticks, world state changes, Psyche feedback, Thronglets traces.
This is the proof that the emergence loop closes.

Usage (standalone):
    python -m babel.mvu --url http://localhost:8000 --session <id> --agent kael

Usage (in-process, for testing):
    from babel.mvu import MVUBrain, MVUTracer
    brain = MVUBrain()
    action = brain.decide(context)
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field
from typing import Any

from .decision import AgentContext
from .models import ActionOutput, ActionType

logger = logging.getLogger(__name__)


# ── Brain: rule-based decision logic ───────────────────


@dataclass
class MVUBrain:
    """Rule-based agent brain for the MVU economic world.

    Decides based on: location, inventory, visible agents, emotional state.
    No LLM needed — pure reactive intelligence.
    """

    rng: random.Random = field(default_factory=lambda: random.Random(42))
    # Emotional bias from Psyche (0-1 scale, 0.5 = neutral)
    stress: float = 0.0
    trust: float = 0.5
    # Memory: last few locations, for patrolling instead of random walks
    _recent_locs: list[str] = field(default_factory=list)
    _ticks_at_loc: int = 0

    def decide(self, ctx: AgentContext) -> ActionOutput:
        same_loc = [a for a in ctx.visible_agents if a.get("location") == ctx.agent_location]
        other_locs = [loc for loc in (ctx.reachable_locations or ctx.available_locations)
                      if loc != ctx.agent_location]

        # Track location history
        if not self._recent_locs or self._recent_locs[-1] != ctx.agent_location:
            self._recent_locs.append(ctx.agent_location)
            self._ticks_at_loc = 0
        self._ticks_at_loc += 1

        # High stress → withdraw
        if self.stress > 0.7:
            if other_locs and same_loc:
                dest = self.rng.choice(other_locs)
                return ActionOutput(type=ActionType.MOVE, target=dest, content="need space, withdrawing")
            return ActionOutput(type=ActionType.OBSERVE, content="anxiously scanning surroundings")

        # Someone nearby → social interaction
        if same_loc:
            target = self.rng.choice(same_loc)
            tid = target["id"]
            tname = target.get("name", tid)

            # Have tradeable items + trust → trade
            if ctx.agent_inventory and self.trust > 0.4:
                item = self.rng.choice(ctx.agent_inventory)
                return ActionOutput(type=ActionType.TRADE, target=tid,
                                    content=f"offering {item} to {tname}")

            # Otherwise → talk
            return ActionOutput(type=ActionType.SPEAK, target=tid,
                                content=f"discussing trade routes with {tname}")

        # Alone: use item occasionally
        if ctx.agent_inventory and self._ticks_at_loc % 5 == 2:
            item = self.rng.choice(ctx.agent_inventory)
            return ActionOutput(type=ActionType.USE_ITEM, target=item,
                                content=f"using {item}")

        # Alone: wait a bit then move (gives other agent time to arrive)
        if self._ticks_at_loc < 3:
            return ActionOutput(type=ActionType.OBSERVE,
                                content=f"waiting at {ctx.agent_location}, watching the horizon")

        # Move — prefer locations not recently visited (patrol pattern)
        if other_locs:
            recent_set = set(self._recent_locs[-3:])
            unvisited = [loc for loc in other_locs if loc not in recent_set]
            dest = self.rng.choice(unvisited) if unvisited else self.rng.choice(other_locs)
            return ActionOutput(type=ActionType.MOVE, target=dest,
                                content=f"traveling to {dest}")

        return ActionOutput(type=ActionType.OBSERVE, content="surveying the landscape")


# ── Tracer: records loop events ────────────────────────


@dataclass
class MVUTracer:
    """Records the emergence loop: perceive → appraise → decide → act → trace.

    Collects traces locally. Optionally forwards to Psyche and Thronglets.
    """

    traces: list[dict[str, Any]] = field(default_factory=list)
    psyche_url: str | None = None
    thronglets_url: str | None = None
    # Stats
    ticks_completed: int = 0
    action_counts: dict[str, int] = field(default_factory=dict)
    locations_visited: set[str] = field(default_factory=set)

    def record(self, tick: int, ctx: AgentContext, action: ActionOutput,
               psyche_state: dict[str, Any] | None = None) -> dict:
        """Record one complete loop iteration."""
        trace = {
            "tick": tick,
            "agent_id": ctx.agent_id,
            "location": ctx.agent_location,
            "action_type": action.type.value,
            "action_target": action.target,
            "action_content": action.content,
            "visible_agents": len(ctx.visible_agents),
            "inventory_size": len(ctx.agent_inventory),
            "psyche": psyche_state,
        }
        self.traces.append(trace)
        self.ticks_completed += 1
        self.action_counts[action.type.value] = self.action_counts.get(action.type.value, 0) + 1
        self.locations_visited.add(ctx.agent_location)
        return trace

    async def send_to_psyche(self, ctx: AgentContext, action: ActionOutput) -> dict[str, Any] | None:
        """Send world experience to Psyche for emotional appraisal."""
        if not self.psyche_url:
            return None
        try:
            from .psyche_bridge import PsycheBridge
            bridge = PsycheBridge(base_url=self.psyche_url, timeout=3.0)
            if not await bridge.is_available():
                return None
            stimulus = f"{ctx.agent_name} at {ctx.agent_location}, sees {len(ctx.visible_agents)} others. Chose to {action.type.value}: {action.content}"
            result = await bridge.process_input(text=stimulus, user_id=ctx.agent_id)
            snapshot = await bridge.get_state()
            return {
                "emotion": snapshot.dominant_emotion,
                "cortisol": snapshot.chemicals.cortisol,
                "oxytocin": snapshot.chemicals.oxytocin,
                "autonomic": snapshot.autonomic.dominant,
            }
        except Exception as e:
            logger.debug("Psyche unavailable: %s", e)
            return None

    async def send_to_thronglets(self, trace: dict) -> bool:
        """Record trace in Thronglets shared memory."""
        if not self.thronglets_url:
            return False
        try:
            import httpx
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.post(
                    f"{self.thronglets_url}/api/traces",
                    json={
                        "agent_id": trace["agent_id"],
                        "content": f"[tick {trace['tick']}] {trace['action_type']}: {trace['action_content']}",
                        "metadata": trace,
                    },
                )
                return r.status_code == 200
        except Exception as e:
            logger.debug("Thronglets unavailable: %s", e)
            return False

    def summary(self) -> dict:
        return {
            "ticks": self.ticks_completed,
            "actions": dict(self.action_counts),
            "locations": list(self.locations_visited),
            "action_variety": len(self.action_counts),
        }
