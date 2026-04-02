from __future__ import annotations

from babel.models import (
    ActionType,
    AgentSeed,
    AgentState,
    Event,
    LocationSeed,
    SeedEnvelope,
    SeedLineage,
    SeedType,
    WorldSeed,
)


def _world_seed() -> WorldSeed:
    return WorldSeed(
        name="Clockwork Port",
        description="A harbor where time leaks into machinery.",
        lore=["Every promise has a cost."],
        locations=[LocationSeed(name="Docks", description="Salt, brass, and fog.")],
        agents=[
            AgentSeed(
                id="captain",
                name="Captain Ione",
                description="Keeps impossible schedules.",
                personality="Severe but loyal.",
                goals=["Keep the harbor running."],
                inventory=["ledger"],
                location="Docks",
            )
        ],
    )


def test_world_seed_roundtrips_through_seed_envelope():
    world_seed = _world_seed()

    envelope = SeedEnvelope.from_world_seed(
        world_seed,
        seed_id="seed-world-1",
        tags=["custom"],
        source_world="Clockwork Port",
        lineage=SeedLineage.runtime(
            root_name="Clockwork Port",
            session_id="sess-1",
            tick=4,
        ),
    )

    assert envelope.id == "seed-world-1"
    assert envelope.type == SeedType.WORLD
    assert envelope.payload["name"] == "Clockwork Port"
    assert envelope.to_world_seed().name == "Clockwork Port"
    assert envelope.to_world_seed().agents[0].name == "Captain Ione"
    assert envelope.lineage.session_id == "sess-1"
    assert envelope.lineage.tick == 4


def test_agent_state_can_be_reseeded_as_canonical_envelope():
    world_seed = _world_seed()
    agent = AgentState.from_seed(world_seed.agents[0])
    agent.inventory.append("signal flare")

    envelope = SeedEnvelope.from_agent_state(
        agent,
        source_world="session-1",
        lineage=SeedLineage.runtime(
            root_name="Clockwork Port",
            session_id="session-1",
            tick=7,
            root_type=SeedType.AGENT.value,
        ),
    )

    assert envelope.type == SeedType.AGENT
    assert envelope.name == "Captain Ione"
    assert envelope.payload["inventory"] == ["ledger", "signal flare"]
    assert envelope.source_world == "session-1"
    assert envelope.lineage.tick == 7


def test_item_and_event_use_same_seed_envelope_shape():
    item_envelope = SeedEnvelope.from_item_state(
        "Brass Key",
        description="Warm to the touch.",
        origin="Recovered from the tide clock.",
        properties=["opens sealed docks", "hums at midnight"],
        significance="Marks the next harbor shift.",
        source_world="session-2",
        lineage=SeedLineage.runtime(
            root_name="Clockwork Port",
            session_id="session-2",
            tick=3,
            root_type=SeedType.ITEM.value,
        ),
    )
    event_envelope = SeedEnvelope.from_event(
        Event(
            id="evt-1",
            session_id="session-2",
            tick=3,
            agent_id="captain",
            agent_name="Captain Ione",
            action_type=ActionType.USE_ITEM,
            action={"content": "Uses the Brass Key on the tide clock."},
            result="The tide clock unlocks a hidden harbor gate.",
        ),
        source_world="session-2",
        lineage=SeedLineage.runtime(
            root_name="Clockwork Port",
            session_id="session-2",
            tick=3,
            root_type=SeedType.EVENT.value,
        ),
    )

    assert item_envelope.type == SeedType.ITEM
    assert item_envelope.payload["name"] == "Brass Key"
    assert item_envelope.payload["origin"] == "Recovered from the tide clock."

    assert event_envelope.type == SeedType.EVENT
    assert event_envelope.payload["content"] == "The tide clock unlocks a hidden harbor gate."
    assert "use_item" in event_envelope.tags
    assert event_envelope.lineage.session_id == "session-2"
