"""BABEL — Core data models."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import yaml
from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────

class ActionType(str, Enum):
    SPEAK = "speak"
    MOVE = "move"
    USE_ITEM = "use_item"
    TRADE = "trade"
    OBSERVE = "observe"
    WAIT = "wait"


class SeedType(str, Enum):
    WORLD = "world"
    AGENT = "agent"
    ITEM = "item"
    LOCATION = "location"
    EVENT = "event"


class SeedLineage(BaseModel):
    root_type: str = "world"
    root_name: str = ""
    source_seed_ref: str = ""
    session_id: str = ""
    tick: int = 0
    branch_id: str = "main"
    node_id: str = ""
    snapshot_id: str = ""

    @classmethod
    def runtime(
        cls,
        *,
        root_name: str,
        source_seed_ref: str = "",
        session_id: str,
        tick: int = 0,
        branch_id: str = "main",
        node_id: str = "",
        snapshot_id: str = "",
        root_type: str = "world",
    ) -> SeedLineage:
        return cls(
            root_type=root_type,
            root_name=root_name,
            source_seed_ref=source_seed_ref,
            session_id=session_id,
            tick=tick,
            branch_id=branch_id,
            node_id=node_id,
            snapshot_id=snapshot_id,
        )


class SessionStatus(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    ENDED = "ended"


class AgentStatus(str, Enum):
    IDLE = "idle"
    ACTING = "acting"
    DEAD = "dead"
    GONE = "gone"


class AgentRole(str, Enum):
    MAIN = "main"
    SUPPORTING = "supporting"


# ── Seed Models (from YAML) ───────────────────────────

class LocationSeed(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    connections: list[str] = Field(default_factory=list)  # adjacent location names


class ResourceSeed(BaseModel):
    name: str
    description: str = ""


class ItemSeed(BaseModel):
    name: str
    description: str = ""
    origin: str = ""
    properties: list[str] = Field(default_factory=list)
    significance: str = ""


class AgentSeed(BaseModel):
    id: str
    name: str
    description: str = ""
    personality: str = ""
    goals: list[str] = Field(default_factory=list)
    inventory: list[str] = Field(default_factory=list)
    location: str = ""


class TimeConfig(BaseModel):
    unit: str = "tick"                    # hour | day | minute | tick
    ticks_per_unit: int = 1               # how many ticks make one time unit
    start: str = ""                       # narrative start time, e.g. "2077-11-15 22:00"
    day_cycle: bool = False               # enable day/night cycle
    day_length: int = 24                  # units per full day
    periods: list[dict[str, Any]] = Field(default_factory=list)
    # periods example: [{"name": "night", "start": 22, "end": 6}, ...]


class NarratorConfig(BaseModel):
    persona: str = ""                # custom persona e.g. "A weary bard"
    auto_commentary: bool = False    # auto-generate commentary
    commentary_interval: int = 5    # every N ticks


class WorldSeed(BaseModel):
    name: str
    description: str = ""
    rules: list[str] = Field(default_factory=list)
    locations: list[LocationSeed] = Field(default_factory=list)
    resources: list[ResourceSeed] = Field(default_factory=list)
    items: list[ItemSeed] = Field(default_factory=list)
    agents: list[AgentSeed] = Field(default_factory=list)
    initial_events: list[str] = Field(default_factory=list)
    time: TimeConfig = Field(default_factory=TimeConfig)
    narrator: NarratorConfig = Field(default_factory=NarratorConfig)

    @classmethod
    def from_yaml(cls, path: str) -> WorldSeed:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return cls(**data)

    def to_seed_payload(self) -> dict[str, Any]:
        """Return the canonical reusable payload for this world."""
        return self.model_dump()


# ── LLM Output Schema ─────────────────────────────────

class Resource(BaseModel):
    """Quantified inventory item."""
    name: str
    quantity: int = 1
    type: str = "item"  # item | currency | consumable


class Relation(BaseModel):
    """Directional relationship between two agents."""
    source: str           # agent_id
    target: str           # agent_id
    type: str = "neutral" # ally | hostile | neutral | rival | trust
    strength: float = 0.5 # 0.0-1.0
    trust: float = 0.5
    tension: float = 0.0
    familiarity: float = 0.1
    debt_balance: float = 0.0  # positive = target owes source, negative = source owes target
    leverage: float = 0.0
    last_interaction: str = ""
    last_tick: int = 0    # tick when last updated

    def refresh_type(self) -> None:
        """Derive a readable posture from richer social state."""
        if self.strength >= 0.8 and self.tension <= 0.35:
            self.type = "ally"
        elif self.strength >= 0.6 and self.tension < 0.5:
            self.type = "trust"
        elif self.strength <= 0.2 or (self.tension >= 0.7 and self.trust <= 0.35):
            self.type = "hostile"
        elif self.strength <= 0.35 or self.tension >= 0.45:
            self.type = "rival"
        else:
            self.type = "neutral"

    def apply_social_shift(
        self,
        *,
        tick: int,
        strength_delta: float = 0.0,
        trust_delta: float | None = None,
        tension_delta: float | None = None,
        familiarity_delta: float | None = None,
        debt_delta: float | None = None,
        leverage_delta: float | None = None,
        note: str = "",
    ) -> None:
        """Apply a generic social update in one place."""
        self.last_tick = tick
        self.strength = max(0.0, min(1.0, self.strength + strength_delta))

        if trust_delta is None:
            trust_delta = strength_delta * 0.8
        if tension_delta is None:
            tension_delta = (-strength_delta * 0.3) if strength_delta > 0 else abs(strength_delta) * 0.6
        if familiarity_delta is None:
            familiarity_delta = 0.04 if any(
                abs(value) > 0
                for value in (strength_delta, trust_delta, tension_delta)
            ) else 0.0
        if debt_delta is None:
            debt_delta = 0.0
        if leverage_delta is None:
            leverage_delta = 0.0

        self.trust = max(0.0, min(1.0, self.trust + trust_delta))
        self.tension = max(0.0, min(1.0, self.tension + tension_delta))
        self.familiarity = max(0.0, min(1.0, self.familiarity + familiarity_delta))
        self.debt_balance = max(-1.0, min(1.0, self.debt_balance + debt_delta))
        self.leverage = max(0.0, min(1.0, self.leverage + leverage_delta))
        if note.strip():
            self.last_interaction = note.strip()
        self.refresh_type()


class ActionOutput(BaseModel):
    type: ActionType
    target: str | None = None
    content: str = ""
    intent: IntentState | None = Field(default=None, exclude=True)


class IntentState(BaseModel):
    objective: str = ""
    approach: str = ""
    next_step: str = ""
    rationale: str = ""

    def has_content(self) -> bool:
        return any(
            value.strip()
            for value in (
                self.objective,
                self.approach,
                self.next_step,
                self.rationale,
            )
        )


class StateChanges(BaseModel):
    location: str | None = None
    inventory_add: list[str] = Field(default_factory=list)
    inventory_remove: list[str] = Field(default_factory=list)


class LLMResponse(BaseModel):
    thinking: str = ""
    intent: IntentState = Field(default_factory=IntentState)
    action: ActionOutput
    state_changes: StateChanges = Field(default_factory=StateChanges)


# ── Runtime State ──────────────────────────────────────


class EventSignificance(BaseModel):
    """Canonical meaning layer carried by every event."""
    primary: str = "ambient"
    score: float = 0.5
    durable: bool = False
    axes: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    delta: dict[str, Any] = Field(default_factory=dict)


class GoalState(BaseModel):
    """Trackable goal with progress and stall detection."""
    text: str
    status: str = "active"   # active | completed | failed | stalled
    started_tick: int = 0
    progress: float = 0.0    # 0.0-1.0
    stall_count: int = 0     # consecutive ticks without progress
    drive_affinities: dict[str, float] = Field(default_factory=dict)  # drive → 0.0-1.0
    strategy: str = ""
    next_step: str = ""
    success_criteria: str = ""
    blockers: list[str] = Field(default_factory=list)
    last_progress_reason: str = ""


class AgentState(BaseModel):
    agent_id: str
    name: str
    description: str = ""
    personality: str = ""
    goals: list[str] = Field(default_factory=list)
    location: str = ""
    inventory: list[str] = Field(default_factory=list)
    status: AgentStatus = AgentStatus.IDLE
    memory: list[str] = Field(default_factory=list)
    role: AgentRole = AgentRole.MAIN
    active_goal: GoalState | None = None
    immediate_intent: str = ""
    immediate_approach: str = ""
    immediate_next_step: str = ""
    last_outcome: str = ""

    @classmethod
    def from_seed(cls, seed: AgentSeed) -> AgentState:
        state = cls(
            agent_id=seed.id,
            name=seed.name,
            description=seed.description,
            personality=seed.personality,
            goals=list(seed.goals),
            location=seed.location,
            inventory=list(seed.inventory),
        )
        if seed.goals:
            state.active_goal = GoalState(text=seed.goals[0], started_tick=0)
        return state


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    session_id: str = ""
    tick: int = 0
    agent_id: str | None = None
    agent_name: str | None = None
    action_type: ActionType | str = ActionType.WAIT
    action: dict[str, Any] = Field(default_factory=dict)
    result: str = ""
    structured: dict[str, Any] = Field(default_factory=dict)
    location: str = ""
    involved_agents: list[str] = Field(default_factory=list)
    significance: EventSignificance = Field(default_factory=EventSignificance)
    importance: float = 0.5
    node_id: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class Session(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    world_seed: WorldSeed
    seed_lineage: SeedLineage = Field(default_factory=SeedLineage)
    agents: dict[str, AgentState] = Field(default_factory=dict)
    events: list[Event] = Field(default_factory=list)
    tick: int = 0
    status: SessionStatus = SessionStatus.PAUSED
    # Transient: injected events that agents must react to on next tick
    urgent_events: list[str] = Field(default_factory=list)
    # Structured agent-to-agent relationships
    relations: list[Relation] = Field(default_factory=list)

    def init_agents(self) -> None:
        for seed in self.world_seed.agents:
            self.agents[seed.id] = AgentState.from_seed(seed)

    @property
    def location_names(self) -> list[str]:
        return [loc.name for loc in self.world_seed.locations]

    @property
    def agent_ids(self) -> list[str]:
        return [
            aid for aid, a in self.agents.items()
            if a.status not in (AgentStatus.DEAD, AgentStatus.GONE)
        ]

    def get_relation(self, source: str, target: str) -> Relation | None:
        """Find a relation from source to target."""
        for r in self.relations:
            if r.source == source and r.target == target:
                return r
        return None

    def update_relation(
        self,
        source: str,
        target: str,
        delta: float,
        tick: int,
        social: dict[str, float] | None = None,
        note: str = "",
    ) -> Relation:
        """Update (or create) a relation's strength by delta. Returns the relation."""
        rel = self.get_relation(source, target)
        if rel is None:
            rel = Relation(source=source, target=target, strength=0.5, last_tick=tick)
            self.relations.append(rel)
        social = social or {}
        rel.apply_social_shift(
            tick=tick,
            strength_delta=delta,
            trust_delta=social.get("trust"),
            tension_delta=social.get("tension"),
            familiarity_delta=social.get("familiarity"),
            debt_delta=social.get("debt"),
            leverage_delta=social.get("leverage"),
            note=note,
        )
        return rel

    def location_connections(self, location_name: str) -> list[str]:
        """Get connected locations for a given location. Empty = all allowed."""
        for loc in self.world_seed.locations:
            if loc.name == location_name:
                return loc.connections
        return []


# ── Seed Envelope (Reusable Generative Boundary) ─────

class SeedEnvelope(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    type: SeedType
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    source_world: str = ""
    lineage: SeedLineage = Field(default_factory=SeedLineage)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    @property
    def payload(self) -> dict[str, Any]:
        """Canonical payload accessor.

        A seed envelope stores reusable metadata plus the compressed payload that
        can unfold into a runtime form again later.
        """
        return self.data

    @classmethod
    def from_world_seed(
        cls,
        world_seed: WorldSeed,
        *,
        seed_id: str | None = None,
        tags: list[str] | None = None,
        source_world: str = "",
        lineage: SeedLineage | None = None,
        created_at: str | None = None,
    ) -> SeedEnvelope:
        return cls(
            id=seed_id or uuid.uuid4().hex[:8],
            type=SeedType.WORLD,
            name=world_seed.name,
            description=world_seed.description,
            tags=list(tags or []),
            data=world_seed.to_seed_payload(),
            source_world=source_world,
            lineage=lineage or SeedLineage(root_name=world_seed.name),
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def from_agent_state(
        cls,
        agent: AgentState,
        *,
        seed_id: str | None = None,
        tags: list[str] | None = None,
        source_world: str = "",
        lineage: SeedLineage | None = None,
        created_at: str | None = None,
    ) -> SeedEnvelope:
        return cls(
            id=seed_id or uuid.uuid4().hex[:8],
            type=SeedType.AGENT,
            name=agent.name,
            description=agent.description,
            tags=list(tags or []),
            data={
                "id": agent.agent_id,
                "name": agent.name,
                "description": agent.description,
                "personality": agent.personality,
                "goals": list(agent.goals),
                "inventory": list(agent.inventory),
                "location": agent.location,
            },
            source_world=source_world,
            lineage=lineage or SeedLineage(root_name=agent.name, root_type=SeedType.AGENT.value),
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def from_item_state(
        cls,
        item_name: str,
        *,
        description: str = "",
        origin: str = "",
        properties: list[str] | None = None,
        significance: str = "",
        seed_id: str | None = None,
        tags: list[str] | None = None,
        source_world: str = "",
        lineage: SeedLineage | None = None,
        created_at: str | None = None,
    ) -> SeedEnvelope:
        payload: dict[str, Any] = {"name": item_name}
        if description:
            payload["description"] = description
        if origin:
            payload["origin"] = origin
        if properties:
            payload["properties"] = list(properties)
        if significance:
            payload["significance"] = significance
        return cls(
            id=seed_id or uuid.uuid4().hex[:8],
            type=SeedType.ITEM,
            name=item_name,
            description=description,
            tags=list(tags or []),
            data=payload,
            source_world=source_world,
            lineage=lineage or SeedLineage(root_name=item_name, root_type=SeedType.ITEM.value),
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def from_location_seed(
        cls,
        location: LocationSeed,
        *,
        seed_id: str | None = None,
        tags: list[str] | None = None,
        source_world: str = "",
        lineage: SeedLineage | None = None,
        created_at: str | None = None,
    ) -> SeedEnvelope:
        merged_tags = list(tags or []) or list(getattr(location, "tags", []) or [])
        return cls(
            id=seed_id or uuid.uuid4().hex[:8],
            type=SeedType.LOCATION,
            name=location.name,
            description=location.description,
            tags=merged_tags,
            data={
                "name": location.name,
                "description": location.description,
            },
            source_world=source_world,
            lineage=lineage or SeedLineage(root_name=location.name, root_type=SeedType.LOCATION.value),
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    @classmethod
    def from_event(
        cls,
        event: Event,
        *,
        seed_id: str | None = None,
        tags: list[str] | None = None,
        source_world: str = "",
        lineage: SeedLineage | None = None,
        created_at: str | None = None,
    ) -> SeedEnvelope:
        action_type = event.action_type.value if hasattr(event.action_type, "value") else str(event.action_type)
        event_tags = list(tags or [])
        if action_type:
            event_tags.append(action_type)
        deduped_tags = list(dict.fromkeys(tag for tag in event_tags if tag))
        return cls(
            id=seed_id or uuid.uuid4().hex[:8],
            type=SeedType.EVENT,
            name=(event.result or "Event")[:60],
            description="",
            tags=deduped_tags,
            data={
                "content": event.result,
                "action_type": action_type,
                **({"event_id": event.id} if event.id else {}),
            },
            source_world=source_world,
            lineage=lineage or SeedLineage(root_name=event.result[:60], root_type=SeedType.EVENT.value),
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    def to_world_seed(self) -> WorldSeed:
        if self.type != SeedType.WORLD:
            raise ValueError("Only world seeds can unfold into WorldSeed")
        return WorldSeed(**self.payload)


# Backward-compatible name retained at the API boundary.
SavedSeed = SeedEnvelope


# ── Timeline & Memory ─────────────────────────────────

class MemoryEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    session_id: str = ""
    agent_id: str = ""
    tick: int = 0
    content: str = ""
    semantic: dict[str, Any] = Field(default_factory=dict)
    category: str = "episodic"  # episodic | semantic | goal | social
    importance: float = 0.5
    tags: list[str] = Field(default_factory=list)
    source_event_id: str | None = None
    access_count: int = 0
    last_accessed: int = 0
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class TimelineNode(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    session_id: str = ""
    tick: int = 0
    parent_id: str | None = None
    branch_id: str = "main"
    node_type: str = "tick"  # tick | epoch | snapshot
    summary: str = ""
    event_count: int = 0
    agent_locations: dict[str, str] = Field(default_factory=dict)
    significant: bool = False
    lineage: SeedLineage = Field(default_factory=SeedLineage)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class WorldSnapshot(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10])
    session_id: str = ""
    node_id: str = ""
    tick: int = 0
    world_seed_json: str = ""
    agent_states_json: str = ""
    lineage: SeedLineage = Field(default_factory=SeedLineage)
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
