"""Tests for event visibility filtering.

Agents should only see information they could plausibly perceive.
- Actor sees full detail.
- Same-location observers see public aspects but not private details.
- Involved agents (trade target, speak target) see full detail.
- Internal actions (observe) are redacted for observers.
"""

from __future__ import annotations

from babel.memory import _filter_event_for_observer
from babel.models import AgentState


# ── Helpers ──


def _make_agent(agent_id: str, name: str, location: str) -> AgentState:
    return AgentState(
        agent_id=agent_id,
        name=name,
        location=location,
        goals=["survive"],
    )


def _make_event(
    agent_id: str | None = "a1",
    agent_name: str = "Alice",
    action_type: str = "speak",
    result: str = "Alice said hello",
    location: str = "Bar",
    involved: list[str] | None = None,
    tick: int = 5,
) -> dict:
    """Create event dict matching load_events_filtered output."""
    return {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "action_type": action_type,
        "result": result,
        "location": location,
        "involved_agents": involved or ([agent_id] if agent_id else []),
        "tick": tick,
    }


# ── Actor sees full detail ──


class TestActorFullVisibility:
    def test_actor_sees_own_speak(self):
        observer = _make_agent("a1", "Alice", "Bar")
        event = _make_event(agent_id="a1", action_type="speak",
                            result='Alice said to Bob: "I have three aces"')
        assert _filter_event_for_observer(event, observer) == event["result"]

    def test_actor_sees_own_trade(self):
        observer = _make_agent("a1", "Alice", "Bar")
        event = _make_event(agent_id="a1", action_type="trade",
                            result="Alice traded sword for shield with Bob")
        assert _filter_event_for_observer(event, observer) == event["result"]

    def test_actor_sees_own_use_item(self):
        observer = _make_agent("a1", "Alice", "Bar")
        event = _make_event(agent_id="a1", action_type="use_item",
                            result="Alice used healing potion: restored 50 HP")
        assert _filter_event_for_observer(event, observer) == event["result"]

    def test_actor_sees_own_observe(self):
        observer = _make_agent("a1", "Alice", "Bar")
        event = _make_event(agent_id="a1", action_type="observe",
                            result="Alice observed: Bob seems nervous")
        assert _filter_event_for_observer(event, observer) == event["result"]


# ── Involved agent sees full detail ──


class TestInvolvedAgentVisibility:
    def test_speak_target_sees_full_message(self):
        observer = _make_agent("a2", "Bob", "Bar")
        event = _make_event(agent_id="a1", action_type="speak",
                            result='Alice said to Bob: "I have three aces"',
                            involved=["a1", "a2"])
        assert _filter_event_for_observer(event, observer) == event["result"]

    def test_trade_target_sees_full_details(self):
        observer = _make_agent("a2", "Bob", "Bar")
        event = _make_event(agent_id="a1", action_type="trade",
                            result="Alice traded sword for shield with Bob",
                            involved=["a1", "a2"])
        assert _filter_event_for_observer(event, observer) == event["result"]


# ── Same-location observer sees filtered view ──


class TestSameLocationObserver:
    def test_speech_is_audible(self):
        """Speech is public — bystanders hear it."""
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", action_type="speak",
                            result='Alice said to Bob: "Nice weather"',
                            location="Bar")
        # Speech is public at same location
        assert _filter_event_for_observer(event, observer) == event["result"]

    def test_trade_details_hidden(self):
        """Bystander sees trade happened but not what was exchanged."""
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", agent_name="Alice",
                            action_type="trade",
                            result="Alice traded 3 gold coins for a dagger with Bob",
                            location="Bar")
        filtered = _filter_event_for_observer(event, observer)
        assert filtered == "Alice traded with someone nearby"
        assert "gold" not in filtered
        assert "dagger" not in filtered

    def test_use_item_hidden(self):
        """Bystander sees item use but not what item."""
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", agent_name="Alice",
                            action_type="use_item",
                            result="Alice used skeleton key: unlocked the vault",
                            location="Bar")
        filtered = _filter_event_for_observer(event, observer)
        assert filtered == "Alice used an item"
        assert "skeleton key" not in filtered
        assert "vault" not in filtered

    def test_observe_is_internal(self):
        """Bystander doesn't know someone is observing."""
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", agent_name="Alice",
                            action_type="observe",
                            result="Alice observed: Bob has a hidden weapon",
                            location="Bar")
        filtered = _filter_event_for_observer(event, observer)
        assert filtered == "Alice looked around quietly"
        assert "weapon" not in filtered

    def test_move_is_visible(self):
        """Movement is public."""
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", action_type="move",
                            result="Alice moved to VIP Room",
                            location="Bar")
        assert _filter_event_for_observer(event, observer) == event["result"]

    def test_wait_is_visible(self):
        """Waiting is public."""
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", action_type="wait",
                            result="Alice waited",
                            location="Bar")
        assert _filter_event_for_observer(event, observer) == event["result"]


# ── World events always visible ──


class TestWorldEventVisibility:
    def test_world_event_full_visibility(self):
        observer = _make_agent("a1", "Alice", "Bar")
        event = _make_event(agent_id=None, agent_name="WORLD",
                            action_type="world_event",
                            result="An earthquake shook the building",
                            location="Bar")
        assert _filter_event_for_observer(event, observer) == event["result"]


# ── Different location ──


class TestDifferentLocationObserver:
    def test_distant_event_minimal(self):
        observer = _make_agent("a3", "Carol", "VIP Room")  # different location
        event = _make_event(agent_id="a1", agent_name="Alice",
                            action_type="speak",
                            result='Alice said to Bob: "Secret plan"',
                            location="Bar")
        filtered = _filter_event_for_observer(event, observer)
        assert filtered == "Alice was active elsewhere"
        assert "Secret" not in filtered


# ── Edge cases ──


class TestEdgeCases:
    def test_empty_result(self):
        observer = _make_agent("a1", "Alice", "Bar")
        event = _make_event(result="")
        assert _filter_event_for_observer(event, observer) == ""

    def test_involved_agents_as_json_string(self):
        """DB returns involved_agents as JSON string."""
        observer = _make_agent("a2", "Bob", "Bar")
        event = _make_event(agent_id="a1", action_type="trade",
                            result="Alice traded with Bob: 5 gold",
                            location="Bar")
        event["involved_agents"] = '["a1", "a2"]'  # JSON string from DB
        filtered = _filter_event_for_observer(event, observer)
        # Bob is involved, so should see full detail
        assert filtered == event["result"]

    def test_unknown_action_type(self):
        observer = _make_agent("a3", "Carol", "Bar")
        event = _make_event(agent_id="a1", agent_name="Alice",
                            action_type="custom_action",
                            result="Alice did something weird",
                            location="Bar")
        filtered = _filter_event_for_observer(event, observer)
        assert filtered == "Alice did something"
