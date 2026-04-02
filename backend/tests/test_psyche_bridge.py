"""Tests for Psyche HTTP bridge and PsycheDecisionSource."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import Any

import pytest

from babel.decision import AgentContext, PsycheDecisionSource
from babel.models import ActionType
from babel.psyche_bridge import (
    ChemicalState,
    AutonomicState,
    PolicyModifiers,
    PsycheBridge,
    PsycheSnapshot,
)
from babel.stimulus import detect_stimulus_hints, synthesize_stimulus


# ── Fixtures: Mock Psyche HTTP server ────────────────────────


class MockPsycheHandler(BaseHTTPRequestHandler):
    """Minimal Psyche HTTP server for testing."""

    # Class-level state for test configuration
    mock_state: dict[str, Any] = {}
    mock_input_result: dict[str, Any] = {}
    mock_output_result: dict[str, Any] = {}
    request_log: list[dict[str, Any]] = []

    mock_overlay: dict[str, Any] = {}

    def do_GET(self) -> None:
        if self.path == "/overlay":
            self._respond(200, self.mock_overlay or _default_overlay())
        elif self.path == "/state":
            self._respond(200, self.mock_state or _default_state())
        elif self.path.startswith("/protocol"):
            self._respond(200, {"protocol": "test protocol"})
        else:
            self._respond(404, {"error": "Not found"})

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}
        MockPsycheHandler.request_log.append({"path": self.path, "body": body})

        if self.path == "/process-input":
            self._respond(200, self.mock_input_result or _default_input_result())
        elif self.path == "/process-output":
            self._respond(200, self.mock_output_result or _default_output_result())
        else:
            self._respond(404, {"error": "Not found"})

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def _respond(self, status: int, data: Any) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format: str, *args: Any) -> None:
        pass  # Suppress server logs during tests


def _default_overlay() -> dict[str, Any]:
    return {"arousal": 0.6, "valence": 0.7, "agency": 0.3, "vulnerability": -0.2}


def _default_state() -> dict[str, Any]:
    return {
        "current": {"DA": 65, "HT": 55, "CORT": 30, "OT": 70, "NE": 25, "END": 45},
        "autonomic": {"ventralVagal": 0.7, "sympathetic": 0.2, "dorsalVagal": 0.1},
        "dominantEmotion": "contentment",
        "drives": {"survival": 80, "safety": 70, "connection": 60, "esteem": 50, "curiosity": 65},
    }


def _default_input_result() -> dict[str, Any]:
    return {
        "systemContext": "Agent is calm and socially oriented.",
        "dynamicContext": "Feeling connected, moderate curiosity.",
        "stimulus": {"type": "casual", "confidence": 0.85},
        "policyModifiers": {
            "responseLengthFactor": 1.0,
            "proactivity": 0.7,
            "riskTolerance": 0.5,
            "emotionalDisclosure": 0.6,
            "compliance": 0.5,
            "requireConfirmation": False,
            "avoidTopics": [],
        },
    }


def _default_output_result() -> dict[str, Any]:
    return {"cleanedText": "Test action executed", "stateChanged": True}


@pytest.fixture()
def mock_server():
    """Start a mock Psyche HTTP server on a random port."""
    server = HTTPServer(("127.0.0.1", 0), MockPsycheHandler)
    port = server.server_address[1]
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # Reset state
    MockPsycheHandler.mock_state = {}
    MockPsycheHandler.mock_overlay = {}
    MockPsycheHandler.mock_input_result = {}
    MockPsycheHandler.mock_output_result = {}
    MockPsycheHandler.request_log = []

    yield f"http://127.0.0.1:{port}"

    server.shutdown()


def _make_context(**overrides: Any) -> AgentContext:
    """Create a test AgentContext with sensible defaults."""
    defaults = {
        "agent_id": "agent_1",
        "agent_name": "TestAgent",
        "agent_personality": "curious and cautious",
        "agent_description": "A test agent",
        "agent_goals": ["explore the area", "find information"],
        "agent_location": "main_hall",
        "agent_inventory": ["flashlight", "notebook"],
        "visible_agents": [
            {"id": "agent_2", "name": "OtherAgent", "location": "main_hall"},
            {"id": "agent_3", "name": "FarAgent", "location": "garden"},
        ],
        "memories": [{"content": "saw something strange earlier"}],
        "beliefs": ["the garden is safe"],
        "relations": [{"target": "agent_2", "target_name": "OtherAgent", "attitude": "friendly"}],
        "reachable_locations": ["main_hall", "garden", "library"],
        "available_locations": ["main_hall", "garden", "library"],
        "recent_events": ["OtherAgent arrived at main_hall", "a door slammed"],
        "world_lore": ["no weapons allowed"],
        "world_time": {"display": "2077-03-25 22:00", "period": "night"},
        "tick": 8,
    }
    defaults.update(overrides)
    return AgentContext(**defaults)


# ── PsycheBridge tests ───────────────────────────────────────


@pytest.mark.asyncio
async def test_bridge_is_available(mock_server: str) -> None:
    bridge = PsycheBridge(base_url=mock_server)
    assert await bridge.is_available()
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_unavailable() -> None:
    bridge = PsycheBridge(base_url="http://127.0.0.1:19999", timeout=0.5)
    assert not await bridge.is_available()
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_process_input(mock_server: str) -> None:
    bridge = PsycheBridge(base_url=mock_server)
    result = await bridge.process_input("Hello, how are you?", user_id="agent_1")

    assert result.system_context == "Agent is calm and socially oriented."
    assert result.stimulus_type == "casual"
    assert result.stimulus_confidence == 0.85
    assert result.policy.proactivity == 0.7
    assert result.policy.risk_tolerance == 0.5
    assert not result.policy.require_confirmation

    # Verify request was received
    assert len(MockPsycheHandler.request_log) == 1
    req = MockPsycheHandler.request_log[0]
    assert req["path"] == "/process-input"
    assert req["body"]["text"] == "Hello, how are you?"
    assert req["body"]["userId"] == "agent_1"
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_process_output(mock_server: str) -> None:
    bridge = PsycheBridge(base_url=mock_server)
    result = await bridge.process_output("Agent spoke to friend", user_id="agent_1")

    assert result["stateChanged"] is True
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_get_state(mock_server: str) -> None:
    bridge = PsycheBridge(base_url=mock_server)
    snapshot = await bridge.get_state()

    assert isinstance(snapshot, PsycheSnapshot)
    assert snapshot.chemicals.dopamine == 65
    assert snapshot.chemicals.cortisol == 30
    assert snapshot.autonomic.ventral_vagal == 0.7
    assert snapshot.autonomic.dominant == "ventral_vagal"
    assert snapshot.dominant_emotion == "contentment"
    assert snapshot.drives.get("curiosity") == 65
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_get_overlay(mock_server: str) -> None:
    """get_overlay returns PsycheOverlay from /overlay endpoint."""
    from babel.models import PsycheOverlay

    bridge = PsycheBridge(base_url=mock_server)
    overlay = await bridge.get_overlay()

    assert isinstance(overlay, PsycheOverlay)
    assert overlay.arousal == 0.6
    assert overlay.valence == 0.7
    assert overlay.agency == 0.3
    assert overlay.vulnerability == -0.2
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_get_overlay_custom(mock_server: str) -> None:
    """get_overlay respects custom mock overlay."""
    from babel.models import PsycheOverlay

    MockPsycheHandler.mock_overlay = {
        "arousal": -0.5, "valence": -0.8, "agency": 0.0, "vulnerability": 1.0,
    }
    bridge = PsycheBridge(base_url=mock_server)
    overlay = await bridge.get_overlay()

    assert overlay.arousal == -0.5
    assert overlay.vulnerability == 1.0
    await bridge.close()


@pytest.mark.asyncio
async def test_bridge_custom_state(mock_server: str) -> None:
    """Test with high-stress state."""
    MockPsycheHandler.mock_state = {
        "current": {"DA": 20, "HT": 25, "CORT": 85, "OT": 15, "NE": 80, "END": 10},
        "autonomic": {"ventralVagal": 0.1, "sympathetic": 0.8, "dorsalVagal": 0.1},
        "dominantEmotion": "anxiety",
        "drives": {"survival": 90, "safety": 30, "connection": 20, "esteem": 40, "curiosity": 15},
    }

    bridge = PsycheBridge(base_url=mock_server)
    snapshot = await bridge.get_state()

    assert snapshot.chemicals.cortisol == 85
    assert snapshot.autonomic.dominant == "sympathetic"
    assert snapshot.dominant_emotion == "anxiety"
    await bridge.close()


# ── ChemicalState tests ──────────────────────────────────────


def test_chemical_state_from_dict() -> None:
    state = ChemicalState.from_dict({"DA": 80, "HT": 60, "CORT": 20, "OT": 70, "NE": 30, "END": 50})
    assert state.dopamine == 80
    assert state.serotonin == 60


def test_chemical_state_defaults() -> None:
    state = ChemicalState.from_dict({})
    assert state.dopamine == 50.0
    assert state.cortisol == 50.0


# ── AutonomicState tests ─────────────────────────────────────


def test_autonomic_dominant_ventral() -> None:
    state = AutonomicState(ventral_vagal=0.7, sympathetic=0.2, dorsal_vagal=0.1)
    assert state.dominant == "ventral_vagal"


def test_autonomic_dominant_sympathetic() -> None:
    state = AutonomicState(ventral_vagal=0.1, sympathetic=0.8, dorsal_vagal=0.1)
    assert state.dominant == "sympathetic"


def test_autonomic_dominant_dorsal() -> None:
    state = AutonomicState(ventral_vagal=0.1, sympathetic=0.1, dorsal_vagal=0.8)
    assert state.dominant == "dorsal_vagal"


# ── StimulusSynthesizer tests ────────────────────────────────


def test_synthesize_basic() -> None:
    ctx = _make_context()
    text = synthesize_stimulus(ctx)

    assert "TestAgent" in text
    assert "main_hall" in text
    assert "OtherAgent" in text
    assert "2077-03-25 22:00" in text
    assert "night" in text


def test_synthesize_alone() -> None:
    ctx = _make_context(
        visible_agents=[{"id": "agent_3", "name": "FarAgent", "location": "garden"}],
        tick=10,
    )
    text = synthesize_stimulus(ctx)

    assert "Nobody else is around" in text
    assert "without social contact" in text


def test_synthesize_urgent() -> None:
    ctx = _make_context(urgent_events=["A fire broke out!"])
    text = synthesize_stimulus(ctx)

    assert "URGENT" in text
    assert "fire" in text


def test_synthesize_with_goal() -> None:
    ctx = _make_context(active_goal={"description": "find the key", "progress": 60})
    text = synthesize_stimulus(ctx)

    assert "find the key" in text
    assert "60%" in text


def test_synthesize_relations() -> None:
    ctx = _make_context(
        relations=[{"target": "a2", "target_name": "Ghost", "attitude": "suspicious"}]
    )
    text = synthesize_stimulus(ctx)

    assert "Ghost" in text
    assert "suspicious" in text


# ── Stimulus hints tests ─────────────────────────────────────


def test_hints_neglect() -> None:
    ctx = _make_context(
        visible_agents=[{"id": "a3", "name": "Far", "location": "garden"}],
        tick=10,
    )
    hints = detect_stimulus_hints(ctx)
    assert "neglect" in hints


def test_hints_conflict() -> None:
    ctx = _make_context(
        relations=[{"target": "a2", "target_name": "Enemy", "attitude": "hostile rival"}]
    )
    hints = detect_stimulus_hints(ctx)
    assert "conflict" in hints


def test_hints_surprise() -> None:
    ctx = _make_context(urgent_events=["explosion!"])
    hints = detect_stimulus_hints(ctx)
    assert "surprise" in hints


def test_hints_validation() -> None:
    ctx = _make_context(active_goal={"description": "test", "progress": 90})
    hints = detect_stimulus_hints(ctx)
    assert "validation" in hints


def test_hints_casual() -> None:
    ctx = _make_context()
    hints = detect_stimulus_hints(ctx)
    assert "casual" in hints


# ── PsycheDecisionSource tests ───────────────────────────────


@pytest.mark.asyncio
async def test_psyche_decision_source_basic(mock_server: str) -> None:
    """PsycheDecisionSource produces valid actions."""
    source = PsycheDecisionSource(psyche_url=mock_server)
    ctx = _make_context()
    action = await source.decide(ctx)

    assert action.type in list(ActionType)
    assert action.content != ""
    # Default mock state is ventral-vagal dominant → social actions likely
    assert source.last_snapshot is not None
    assert source.last_snapshot.dominant_emotion == "contentment"


@pytest.mark.asyncio
async def test_psyche_decision_source_fallback() -> None:
    """Falls back when Psyche is unavailable."""
    from babel.decision import ScriptedDecisionSource
    from babel.models import ActionOutput

    fallback = ScriptedDecisionSource(actions=[
        ActionOutput(type=ActionType.OBSERVE, content="fallback action"),
    ])
    source = PsycheDecisionSource(
        psyche_url="http://127.0.0.1:19999",
        fallback=fallback,
        timeout=0.5,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    assert action.type == ActionType.OBSERVE
    assert "fallback" in action.content


@pytest.mark.asyncio
async def test_psyche_decision_source_no_fallback() -> None:
    """Returns WAIT when Psyche unavailable and no fallback."""
    source = PsycheDecisionSource(
        psyche_url="http://127.0.0.1:19999",
        timeout=0.5,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    assert action.type == ActionType.WAIT
    assert "unavailable" in action.content


@pytest.mark.asyncio
async def test_psyche_decision_sympathetic_state(mock_server: str) -> None:
    """Sympathetic autonomic state → fight-or-flight actions."""
    MockPsycheHandler.mock_state = {
        "current": {"DA": 20, "HT": 25, "CORT": 85, "OT": 15, "NE": 80, "END": 10},
        "autonomic": {"ventralVagal": 0.1, "sympathetic": 0.8, "dorsalVagal": 0.1},
        "dominantEmotion": "anxiety",
        "drives": {},
    }

    source = PsycheDecisionSource(psyche_url=mock_server)
    ctx = _make_context()

    # Run multiple times — should never get SPEAK or TRADE in sympathetic
    actions = set()
    for _ in range(20):
        action = await source.decide(ctx)
        actions.add(action.type)

    assert ActionType.SPEAK not in actions
    assert ActionType.TRADE not in actions


@pytest.mark.asyncio
async def test_psyche_decision_dorsal_vagal_state(mock_server: str) -> None:
    """Dorsal-vagal autonomic state → freeze (only WAIT/OBSERVE)."""
    MockPsycheHandler.mock_state = {
        "current": {"DA": 10, "HT": 15, "CORT": 90, "OT": 5, "NE": 10, "END": 5},
        "autonomic": {"ventralVagal": 0.05, "sympathetic": 0.05, "dorsalVagal": 0.9},
        "dominantEmotion": "despair",
        "drives": {},
    }

    source = PsycheDecisionSource(psyche_url=mock_server)
    ctx = _make_context()

    for _ in range(20):
        action = await source.decide(ctx)
        assert action.type in (ActionType.WAIT, ActionType.OBSERVE)


@pytest.mark.asyncio
async def test_psyche_decision_sends_stimulus(mock_server: str) -> None:
    """Verify stimulus text is sent to Psyche."""
    source = PsycheDecisionSource(psyche_url=mock_server)
    ctx = _make_context()
    await source.decide(ctx)

    # Find process-input request
    input_reqs = [r for r in MockPsycheHandler.request_log if r["path"] == "/process-input"]
    assert len(input_reqs) >= 1
    text = input_reqs[0]["body"]["text"]
    assert "TestAgent" in text
    assert "main_hall" in text


@pytest.mark.asyncio
async def test_psyche_decision_notifies_output(mock_server: str) -> None:
    """Verify chosen action is sent back to Psyche as output."""
    source = PsycheDecisionSource(psyche_url=mock_server)
    ctx = _make_context()
    await source.decide(ctx)

    output_reqs = [r for r in MockPsycheHandler.request_log if r["path"] == "/process-output"]
    assert len(output_reqs) >= 1
    text = output_reqs[0]["body"]["text"]
    assert "TestAgent" in text


@pytest.mark.asyncio
async def test_psyche_decision_alone_agent(mock_server: str) -> None:
    """Agent alone → no SPEAK/TRADE actions."""
    source = PsycheDecisionSource(psyche_url=mock_server)
    ctx = _make_context(visible_agents=[], reachable_locations=["main_hall"])

    actions = set()
    for _ in range(20):
        action = await source.decide(ctx)
        actions.add(action.type)

    assert ActionType.SPEAK not in actions
    assert ActionType.TRADE not in actions


# ── PolicyModifiers tests ────────────────────────────────────


def test_policy_modifiers_defaults() -> None:
    pm = PolicyModifiers()
    assert pm.response_length_factor == 1.0
    assert pm.proactivity == 0.5
    assert pm.risk_tolerance == 0.5
    assert pm.avoid_topics == []


# ── Protocol conformance ─────────────────────────────────────


def test_psyche_decision_source_is_decision_source() -> None:
    """PsycheDecisionSource satisfies the DecisionSource protocol."""
    from babel.decision import DecisionSource

    source = PsycheDecisionSource(psyche_url="http://127.0.0.1:3210")
    assert isinstance(source, DecisionSource)


# ── PsycheAugmentedDecisionSource tests ────────────────────────


@pytest.mark.asyncio
async def test_augmented_source_uses_llm(mock_server: str) -> None:
    """Augmented source delegates to LLM (mocked), not hardcoded pool."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(
        return_value=ActionOutput(type=ActionType.SPEAK, target="agent_2", content="Hello friend!")
    )

    source = PsycheAugmentedDecisionSource(
        psyche_url=mock_server, llm_source=mock_llm,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    # LLM was called
    mock_llm.decide.assert_called_once()
    # Ventral-vagal default → SPEAK passes through
    assert action.type == ActionType.SPEAK
    assert action.content == "Hello friend!"


@pytest.mark.asyncio
async def test_augmented_source_injects_emotional_context(mock_server: str) -> None:
    """Augmented source injects emotional_context into the context passed to LLM."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    captured_ctx = None

    async def capture_decide(context: AgentContext) -> ActionOutput:
        nonlocal captured_ctx
        captured_ctx = context
        return ActionOutput(type=ActionType.OBSERVE, content="observing")

    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(side_effect=capture_decide)

    source = PsycheAugmentedDecisionSource(
        psyche_url=mock_server, llm_source=mock_llm,
    )
    ctx = _make_context()
    await source.decide(ctx)

    assert captured_ctx is not None
    assert captured_ctx.emotional_context != ""
    assert "activated" in captured_ctx.emotional_context  # from overlay arousal > 0.5


@pytest.mark.asyncio
async def test_augmented_gate_dorsal_overrides_speak(mock_server: str) -> None:
    """Dorsal-vagal state forces WAIT even when LLM chose SPEAK."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    MockPsycheHandler.mock_state = {
        "current": {"DA": 10, "HT": 15, "CORT": 90, "OT": 5, "NE": 10, "END": 5},
        "autonomic": {"ventralVagal": 0.05, "sympathetic": 0.05, "dorsalVagal": 0.9},
        "dominantEmotion": "despair",
        "drives": {},
    }

    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(
        return_value=ActionOutput(type=ActionType.SPEAK, target="agent_2", content="Hi")
    )

    source = PsycheAugmentedDecisionSource(
        psyche_url=mock_server, llm_source=mock_llm,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    assert action.type == ActionType.WAIT
    assert "frozen" in action.content


@pytest.mark.asyncio
async def test_augmented_gate_sympathetic_downgrades_trade(mock_server: str) -> None:
    """Sympathetic state downgrades TRADE to MOVE or OBSERVE."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    MockPsycheHandler.mock_state = {
        "current": {"DA": 20, "HT": 25, "CORT": 85, "OT": 15, "NE": 80, "END": 10},
        "autonomic": {"ventralVagal": 0.1, "sympathetic": 0.8, "dorsalVagal": 0.1},
        "dominantEmotion": "anxiety",
        "drives": {},
    }

    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(
        return_value=ActionOutput(type=ActionType.TRADE, target="agent_2", content="offering sword")
    )

    source = PsycheAugmentedDecisionSource(
        psyche_url=mock_server, llm_source=mock_llm,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    assert action.type in (ActionType.MOVE, ActionType.OBSERVE)


@pytest.mark.asyncio
async def test_augmented_gate_ventral_passes_through(mock_server: str) -> None:
    """Ventral-vagal state passes LLM action unchanged."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    # Default mock state is ventral-vagal dominant
    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(
        return_value=ActionOutput(type=ActionType.TRADE, target="agent_2", content="offering gem")
    )

    source = PsycheAugmentedDecisionSource(
        psyche_url=mock_server, llm_source=mock_llm,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    assert action.type == ActionType.TRADE
    assert action.content == "offering gem"


@pytest.mark.asyncio
async def test_augmented_fallback_psyche_down() -> None:
    """When Psyche is unavailable, falls back to pure LLM."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(
        return_value=ActionOutput(type=ActionType.OBSERVE, content="just looking around")
    )

    source = PsycheAugmentedDecisionSource(
        psyche_url="http://127.0.0.1:19999",
        llm_source=mock_llm,
        timeout=0.5,
    )
    ctx = _make_context()
    action = await source.decide(ctx)

    mock_llm.decide.assert_called_once()
    assert action.type == ActionType.OBSERVE
    assert "just looking" in action.content


@pytest.mark.asyncio
async def test_augmented_snapshot_exposed(mock_server: str) -> None:
    """Snapshot is available via last_snapshot for frontend display."""
    from unittest.mock import AsyncMock

    from babel.decision import PsycheAugmentedDecisionSource, LLMDecisionSource
    from babel.models import ActionOutput

    mock_llm = AsyncMock(spec=LLMDecisionSource)
    mock_llm.decide = AsyncMock(
        return_value=ActionOutput(type=ActionType.WAIT, content="waiting")
    )

    source = PsycheAugmentedDecisionSource(
        psyche_url=mock_server, llm_source=mock_llm,
    )
    assert source.last_snapshot is None

    ctx = _make_context()
    await source.decide(ctx)

    assert source.last_snapshot is not None
    assert source.last_snapshot.dominant_emotion == "contentment"


def test_augmented_source_is_decision_source() -> None:
    """PsycheAugmentedDecisionSource satisfies the DecisionSource protocol."""
    from babel.decision import DecisionSource, PsycheAugmentedDecisionSource

    source = PsycheAugmentedDecisionSource(psyche_url="http://127.0.0.1:3210")
    assert isinstance(source, DecisionSource)
