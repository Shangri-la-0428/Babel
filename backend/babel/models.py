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


class SessionStatus(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    ENDED = "ended"


class AgentStatus(str, Enum):
    IDLE = "idle"
    ACTING = "acting"
    DEAD = "dead"
    GONE = "gone"


# ── Seed Models (from YAML) ───────────────────────────

class LocationSeed(BaseModel):
    name: str
    description: str = ""


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


class WorldSeed(BaseModel):
    name: str
    description: str = ""
    rules: list[str] = Field(default_factory=list)
    locations: list[LocationSeed] = Field(default_factory=list)
    resources: list[ResourceSeed] = Field(default_factory=list)
    agents: list[AgentSeed] = Field(default_factory=list)
    initial_events: list[str] = Field(default_factory=list)

    @classmethod
    def from_yaml(cls, path: str) -> WorldSeed:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return cls(**data)


# ── LLM Output Schema ─────────────────────────────────

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

    @classmethod
    def from_seed(cls, seed: AgentSeed) -> AgentState:
        return cls(
            agent_id=seed.id,
            name=seed.name,
            description=seed.description,
            personality=seed.personality,
            goals=list(seed.goals),
            location=seed.location,
            inventory=list(seed.inventory),
        )


class Event(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    session_id: str = ""
    tick: int = 0
    agent_id: str | None = None
    agent_name: str | None = None
    action_type: ActionType | str = ActionType.WAIT
    action: dict[str, Any] = Field(default_factory=dict)
    result: str = ""
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
