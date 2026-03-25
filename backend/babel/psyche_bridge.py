"""BABEL — Psyche HTTP Bridge.

Async client for the Psyche emotional engine HTTP server.
Psyche runs as a standalone Node.js process exposing REST endpoints:
  POST /process-input   → stimulus classification + policy modifiers
  POST /process-output  → emotional state update after agent acts
  GET  /state           → full PsycheState snapshot
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_PSYCHE_URL = "http://127.0.0.1:3210"
DEFAULT_TIMEOUT = 5.0


@dataclass
class PolicyModifiers:
    """Behavioral constraints from Psyche's emotional state."""

    response_length_factor: float = 1.0
    proactivity: float = 0.5
    risk_tolerance: float = 0.5
    emotional_disclosure: float = 0.5
    compliance: float = 0.5
    require_confirmation: bool = False
    avoid_topics: list[str] = field(default_factory=list)


@dataclass
class ProcessInputResult:
    """Result from Psyche's processInput endpoint."""

    system_context: str = ""
    dynamic_context: str = ""
    stimulus_type: str = ""
    stimulus_confidence: float = 0.0
    policy: PolicyModifiers = field(default_factory=PolicyModifiers)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ChemicalState:
    """6-chemical emotional state snapshot."""

    dopamine: float = 50.0
    serotonin: float = 50.0
    cortisol: float = 50.0
    oxytocin: float = 50.0
    norepinephrine: float = 50.0
    endorphins: float = 50.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ChemicalState:
        return cls(
            dopamine=data.get("DA", data.get("dopamine", 50.0)),
            serotonin=data.get("HT", data.get("serotonin", 50.0)),
            cortisol=data.get("CORT", data.get("cortisol", 50.0)),
            oxytocin=data.get("OT", data.get("oxytocin", 50.0)),
            norepinephrine=data.get("NE", data.get("norepinephrine", 50.0)),
            endorphins=data.get("END", data.get("endorphins", 50.0)),
        )


@dataclass
class AutonomicState:
    """Polyvagal nervous system state."""

    ventral_vagal: float = 0.6
    sympathetic: float = 0.2
    dorsal_vagal: float = 0.2

    @property
    def dominant(self) -> str:
        """Return the dominant autonomic state."""
        states = {
            "ventral_vagal": self.ventral_vagal,
            "sympathetic": self.sympathetic,
            "dorsal_vagal": self.dorsal_vagal,
        }
        return max(states, key=states.get)  # type: ignore[arg-type]


@dataclass
class PsycheSnapshot:
    """Full Psyche state at a point in time."""

    chemicals: ChemicalState = field(default_factory=ChemicalState)
    autonomic: AutonomicState = field(default_factory=AutonomicState)
    dominant_emotion: str = ""
    drives: dict[str, float] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


class PsycheBridge:
    """Async HTTP client for Psyche emotional engine."""

    def __init__(
        self,
        base_url: str = DEFAULT_PSYCHE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                trust_env=False,  # Don't pick up system proxy
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def is_available(self) -> bool:
        """Check if Psyche server is reachable."""
        try:
            client = await self._get_client()
            resp = await client.get("/state")
            return resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            return False

    async def process_input(
        self,
        text: str,
        user_id: str | None = None,
    ) -> ProcessInputResult:
        """Send stimulus text to Psyche, get policy modifiers back.

        This is the main integration point: BABEL sends a synthesized
        description of what the agent perceives, Psyche classifies the
        stimulus and returns behavioral constraints.
        """
        client = await self._get_client()
        payload: dict[str, Any] = {"text": text}
        if user_id:
            payload["userId"] = user_id

        resp = await client.post("/process-input", json=payload)
        resp.raise_for_status()
        data = resp.json()

        # Parse policy modifiers
        pm_raw = data.get("policyModifiers", {})
        policy = PolicyModifiers(
            response_length_factor=pm_raw.get("responseLengthFactor", 1.0),
            proactivity=pm_raw.get("proactivity", 0.5),
            risk_tolerance=pm_raw.get("riskTolerance", 0.5),
            emotional_disclosure=pm_raw.get("emotionalDisclosure", 0.5),
            compliance=pm_raw.get("compliance", 0.5),
            require_confirmation=pm_raw.get("requireConfirmation", False),
            avoid_topics=pm_raw.get("avoidTopics", []),
        )

        stimulus = data.get("stimulus", {})
        return ProcessInputResult(
            system_context=data.get("systemContext", ""),
            dynamic_context=data.get("dynamicContext", ""),
            stimulus_type=stimulus.get("type", ""),
            stimulus_confidence=stimulus.get("confidence", 0.0),
            policy=policy,
            raw=data,
        )

    async def process_output(
        self,
        text: str,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Notify Psyche of agent's action output for state update."""
        client = await self._get_client()
        payload: dict[str, Any] = {"text": text}
        if user_id:
            payload["userId"] = user_id

        resp = await client.post("/process-output", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def get_state(self) -> PsycheSnapshot:
        """Get full Psyche state snapshot."""
        client = await self._get_client()
        resp = await client.get("/state")
        resp.raise_for_status()
        data = resp.json()

        # Parse chemical state
        chem_raw = data.get("current", data.get("chemicals", {}))
        chemicals = ChemicalState.from_dict(chem_raw)

        # Parse autonomic state
        auto_raw = data.get("autonomic", {})
        autonomic = AutonomicState(
            ventral_vagal=auto_raw.get("ventralVagal", 0.6),
            sympathetic=auto_raw.get("sympathetic", 0.2),
            dorsal_vagal=auto_raw.get("dorsalVagal", 0.2),
        )

        # Parse drives
        drives_raw = data.get("drives", {})

        # Detect dominant emotion
        dominant = data.get("dominantEmotion", "")

        return PsycheSnapshot(
            chemicals=chemicals,
            autonomic=autonomic,
            dominant_emotion=dominant,
            drives=drives_raw,
            raw=data,
        )
