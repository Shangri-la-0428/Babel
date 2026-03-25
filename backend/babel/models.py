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
    agents: list[AgentSeed] = Field(default_factory=list)
    initial_events: list[str] = Field(default_factory=list)
    time: TimeConfig = Field(default_factory=TimeConfig)
    narrator: NarratorConfig = Field(default_factory=NarratorConfig)

    @classmethod
    def from_yaml(cls, path: str) -> WorldSeed:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return cls(**data)


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
    last_tick: int = 0    # tick when last updated


class ActionOutput(BaseModel):
    type: ActionType
    target: str | None = None
    content: str = ""


class StateChanges(BaseModel):
    location: str | None = None
    inventory_add: list[str] = Field(default_factory=list)
    inventory_remove: list[str] = Field(default_factory=list)


class LLMResponse(BaseModel):
    thinking: str = ""
    action: ActionOutput
    state_changes: StateChanges = Field(default_factory=StateChanges)


# ── Runtime State ──────────────────────────────────────

class GoalState(BaseModel):
    """Trackable goal with progress and stall detection."""
    text: str
    status: str = "active"   # active | completed | failed | stalled
    started_tick: int = 0
    progress: float = 0.0    # 0.0-1.0
    stall_count: int = 0     # consecutive ticks without progress
    drive_affinities: dict[str, float] = Field(default_factory=dict)  # drive → 0.0-1.0


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
    importance: float = 0.5
    node_id: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class Session(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    world_seed: WorldSeed
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
        self, source: str, target: str, delta: float, tick: int
    ) -> Relation:
        """Update (or create) a relation's strength by delta. Returns the relation."""
        rel = self.get_relation(source, target)
        if rel is None:
            rel = Relation(source=source, target=target, strength=0.5, last_tick=tick)
            self.relations.append(rel)
        rel.strength = max(0.0, min(1.0, rel.strength + delta))
        rel.last_tick = tick
        # Auto-classify type based on strength
        if rel.strength >= 0.8:
            rel.type = "ally"
        elif rel.strength >= 0.6:
            rel.type = "trust"
        elif rel.strength <= 0.2:
            rel.type = "hostile"
        elif rel.strength <= 0.35:
            rel.type = "rival"
        else:
            rel.type = "neutral"
        return rel

    def location_connections(self, location_name: str) -> list[str]:
        """Get connected locations for a given location. Empty = all allowed."""
        for loc in self.world_seed.locations:
            if loc.name == location_name:
                return loc.connections
        return []


# ── Saved Seed (Asset Library) ───────────────────────

class SavedSeed(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    type: SeedType
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)
    source_world: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


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
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
