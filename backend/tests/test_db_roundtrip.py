"""Comprehensive DB roundtrip tests for babel.db persistence layer.

Every test uses an isolated temporary SQLite file via aiosqlite.
Target: 28 tests covering all CRUD paths.
"""

from __future__ import annotations

import json
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio

import babel.db as db_module
from babel.models import (
    ActionType,
    AgentSeed,
    AgentState,
    AgentStatus,
    Event,
    EventSignificance,
    GoalState,
    LocationSeed,
    MemoryEntry,
    Relation,
    SavedSeed,
    SeedLineage,
    SeedType,
    Session,
    SessionStatus,
    TimelineNode,
    WorldSeed,
    WorldSnapshot,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_path():
    """Create an isolated test DB in a temp directory."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "test.db"
        original = db_module.DB_PATH
        db_module.DB_PATH = path
        await db_module.init_db(path)
        yield path
        db_module.DB_PATH = original


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_world_seed(name: str = "Test World") -> WorldSeed:
    return WorldSeed(
        name=name,
        locations=[
            LocationSeed(name="Tavern", description="A cozy tavern"),
            LocationSeed(name="Market", description="A busy market"),
        ],
        agents=[
            AgentSeed(
                id="a1",
                name="Alice",
                location="Tavern",
                goals=["find the key"],
                inventory=["torch"],
            ),
            AgentSeed(id="a2", name="Bob", location="Market"),
        ],
    )


def _make_session(
    session_id: str | None = None,
    tick: int = 5,
    with_relations: bool = True,
) -> Session:
    ws = _make_world_seed()
    s = Session(
        id=session_id or uuid.uuid4().hex[:12],
        world_seed=ws,
        seed_lineage=SeedLineage.runtime(
            root_name=ws.name,
            source_seed_ref="saved:seed-root-1",
            session_id=session_id or "temp",
            tick=tick,
            branch_id="main",
        ),
        tick=tick,
    )
    s.seed_lineage.session_id = s.id
    s.init_agents()
    if with_relations:
        s.relations = [
            Relation(source="a1", target="a2", type="trust", strength=0.7, last_tick=3),
        ]
    return s


def _make_event(
    session_id: str,
    tick: int = 1,
    agent_id: str = "a1",
    agent_name: str = "Alice",
    location: str = "Tavern",
    action_type: ActionType = ActionType.SPEAK,
    event_id: str | None = None,
) -> Event:
    return Event(
        id=event_id or uuid.uuid4().hex[:8],
        session_id=session_id,
        tick=tick,
        agent_id=agent_id,
        agent_name=agent_name,
        action_type=action_type,
        action={"content": f"event at tick {tick}"},
        result=f"result-{tick}",
        location=location,
        involved_agents=[agent_id],
        importance=0.5 + tick * 0.01,
    )


def _make_memory(
    session_id: str,
    agent_id: str = "a1",
    tick: int = 5,
    category: str = "episodic",
    importance: float = 0.7,
    mem_id: str | None = None,
) -> MemoryEntry:
    return MemoryEntry(
        id=mem_id or uuid.uuid4().hex[:8],
        session_id=session_id,
        agent_id=agent_id,
        tick=tick,
        content=f"Memory at tick {tick}",
        semantic={"type": "observation"},
        category=category,
        importance=importance,
        tags=["visual"],
        source_event_id="evt1",
        access_count=0,
        last_accessed=0,
    )


def _make_timeline_node(
    session_id: str,
    tick: int,
    parent_id: str | None = None,
    node_id: str | None = None,
) -> TimelineNode:
    return TimelineNode(
        id=node_id or uuid.uuid4().hex[:10],
        session_id=session_id,
        tick=tick,
        parent_id=parent_id,
        branch_id="main",
        node_type="tick",
        summary=f"Tick {tick} summary",
        event_count=2,
        agent_locations={"a1": "Tavern", "a2": "Market"},
        significant=tick % 5 == 0,
        lineage=SeedLineage.runtime(
            root_name="Test World",
            session_id=session_id,
            tick=tick,
            branch_id="main",
        ),
    )


def _make_snapshot(
    session_id: str,
    tick: int,
    node_id: str = "node-0",
    snap_id: str | None = None,
) -> WorldSnapshot:
    return WorldSnapshot(
        id=snap_id or uuid.uuid4().hex[:10],
        session_id=session_id,
        node_id=node_id,
        tick=tick,
        world_seed_json=json.dumps({"name": "Test World"}),
        agent_states_json=json.dumps([{"agent_id": "a1", "location": "Tavern"}]),
        lineage=SeedLineage.runtime(
            root_name="Test World",
            session_id=session_id,
            tick=tick,
            branch_id="main",
            node_id=node_id,
            snapshot_id=snap_id or "",
        ),
    )


# ===================================================================
# Session CRUD
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_load_session(db_path):
    """1. Roundtrip: create Session, save, load — all fields match."""
    session = _make_session(tick=5)
    await db_module.save_session(session)

    loaded = await db_module.load_session(session.id)
    assert loaded is not None

    # Top-level fields
    assert loaded["id"] == session.id
    assert loaded["tick"] == 5
    assert loaded["status"] == SessionStatus.PAUSED.value

    # World seed
    assert loaded["world_seed"]["name"] == "Test World"
    assert len(loaded["world_seed"]["locations"]) == 2
    assert loaded["seed_lineage"]["root_name"] == "Test World"
    assert loaded["seed_lineage"]["source_seed_ref"] == "saved:seed-root-1"

    # Relations (V6)
    assert len(loaded["relations"]) == 1
    assert loaded["relations"][0]["source"] == "a1"
    assert loaded["relations"][0]["target"] == "a2"
    assert loaded["relations"][0]["type"] == "trust"
    assert loaded["relations"][0]["strength"] == 0.7

    # Agent states
    agents_by_id = {a["agent_id"]: a for a in loaded["agents"]}
    assert "a1" in agents_by_id
    assert "a2" in agents_by_id

    alice = agents_by_id["a1"]
    assert alice["name"] == "Alice"
    assert alice["location"] == "Tavern"
    assert alice["inventory"] == ["torch"]
    assert alice["goals"] == ["find the key"]
    assert alice["memory"] == []
    # active_goal roundtrip
    assert alice["active_goal"] is not None
    assert alice["active_goal"]["text"] == "find the key"


@pytest.mark.asyncio
async def test_save_session_updates_existing(db_path):
    """2. Saving twice with different tick updates the row."""
    session = _make_session(tick=3)
    await db_module.save_session(session)

    session.tick = 10
    session.status = SessionStatus.RUNNING
    await db_module.save_session(session)

    loaded = await db_module.load_session(session.id)
    assert loaded["tick"] == 10
    assert loaded["status"] == "running"


@pytest.mark.asyncio
async def test_list_sessions(db_path):
    """3. Save 3 sessions, list_sessions returns all 3."""
    ids = []
    for i in range(3):
        s = _make_session(session_id=f"sess-{i}", tick=i)
        await db_module.save_session(s)
        ids.append(s.id)

    rows = await db_module.list_sessions()
    returned_ids = {r["id"] for r in rows}
    for sid in ids:
        assert sid in returned_ids


@pytest.mark.asyncio
async def test_delete_session_cascades(db_path):
    """4. Delete session removes events, memories, timeline, narrator msgs."""
    session = _make_session(session_id="del-me", tick=1)
    await db_module.save_session(session)

    # Add related data
    evt = _make_event(session.id, tick=1)
    await db_module.save_event(evt)

    mem = _make_memory(session.id)
    await db_module.save_memory(mem)

    node = _make_timeline_node(session.id, tick=1)
    await db_module.save_timeline_node(node)

    snap = _make_snapshot(session.id, tick=1, node_id=node.id)
    await db_module.save_snapshot(snap)

    await db_module.save_narrator_message(session.id, "user", "hello", 1)

    await db_module.save_entity_details(session.id, "agent", "a1", {"bio": "x"}, 1)

    # Delete
    result = await db_module.delete_session(session.id)
    assert result is True

    # Everything gone
    assert await db_module.load_session(session.id) is None
    assert await db_module.load_events(session.id) == []
    assert await db_module.query_memories(session.id, "a1") == []
    assert await db_module.load_timeline(session.id) == []
    assert await db_module.list_snapshots(session.id) == []
    assert await db_module.load_narrator_messages(session.id) == []
    assert await db_module.load_all_entity_details(session.id) == []


# ===================================================================
# Event CRUD
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_load_events(db_path):
    """5. Save 5 events, load_events returns them in desc tick order."""
    sid = "evt-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    for t in range(1, 6):
        await db_module.save_event(_make_event(sid, tick=t))

    rows = await db_module.load_events(sid)
    assert len(rows) == 5
    ticks = [r["tick"] for r in rows]
    # load_events returns DESC order
    assert ticks == sorted(ticks, reverse=True)


@pytest.mark.asyncio
async def test_load_events_pagination(db_path):
    """6. Save 10 events, load with limit=3 offset=2."""
    sid = "page-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    for t in range(1, 11):
        await db_module.save_event(_make_event(sid, tick=t))

    rows = await db_module.load_events(sid, limit=3, offset=2)
    assert len(rows) == 3


@pytest.mark.asyncio
async def test_load_events_filtered_by_agent(db_path):
    """7. Filter events by agent_id."""
    sid = "agent-filter"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    await db_module.save_event(_make_event(sid, tick=1, agent_id="a1", agent_name="Alice"))
    await db_module.save_event(_make_event(sid, tick=2, agent_id="a2", agent_name="Bob"))
    await db_module.save_event(_make_event(sid, tick=3, agent_id="a1", agent_name="Alice"))

    rows = await db_module.load_events_filtered(sid, agent_id="a1", limit=50)
    # All returned should be a1 or agent_id IS NULL
    for r in rows:
        assert r["agent_id"] in ("a1", None)


@pytest.mark.asyncio
async def test_load_events_filtered_by_location(db_path):
    """8. Filter events by location."""
    sid = "loc-filter"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    await db_module.save_event(
        _make_event(sid, tick=1, location="Tavern", agent_id="a1")
    )
    await db_module.save_event(
        _make_event(sid, tick=2, location="Market", agent_id="a2")
    )
    await db_module.save_event(
        _make_event(sid, tick=3, location="Tavern", agent_id="a1")
    )

    rows = await db_module.load_events_filtered(sid, location="Tavern", limit=50)
    for r in rows:
        assert r["location"] == "Tavern" or r["agent_id"] is None


@pytest.mark.asyncio
async def test_load_event_by_id(db_path):
    """9. Save event, load by ID, verify fields."""
    sid = "evt-by-id"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    evt = _make_event(sid, tick=7, event_id="myevt01")
    await db_module.save_event(evt)

    loaded = await db_module.load_event_by_id(sid, "myevt01")
    assert loaded is not None
    assert loaded["id"] == "myevt01"
    assert loaded["tick"] == 7
    assert loaded["session_id"] == sid
    assert loaded["agent_id"] == "a1"
    assert isinstance(loaded["action"], dict)
    assert loaded["action"]["content"] == "event at tick 7"


@pytest.mark.asyncio
async def test_event_significance_roundtrip(db_path):
    """9b. Event significance is preserved through save/load."""
    sid = "evt-significance"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    evt = _make_event(sid, tick=4, event_id="sigevt01")
    evt.significance = EventSignificance(
        primary="goal",
        score=0.83,
        durable=True,
        axes=["goal", "information"],
        reasons=["Reveals useful information and advances the plan."],
        delta={"goal_progress": 0.22},
    )
    evt.importance = evt.significance.score
    await db_module.save_event(evt)

    loaded = await db_module.load_event_by_id(sid, "sigevt01")
    assert loaded is not None
    assert loaded["significance"]["primary"] == "goal"
    assert loaded["significance"]["durable"] is True
    assert loaded["significance"]["delta"]["goal_progress"] == pytest.approx(0.22, abs=0.001)


@pytest.mark.asyncio
async def test_load_event_nonexistent(db_path):
    """10. load_event_by_id with bad ID returns None."""
    sid = "noevt-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    result = await db_module.load_event_by_id(sid, "does-not-exist")
    assert result is None


# ===================================================================
# Memory CRUD
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_query_memories(db_path):
    """11. Save 5 memories, query returns them sorted by importance DESC."""
    sid = "mem-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    importances = [0.3, 0.9, 0.1, 0.7, 0.5]
    for imp in importances:
        await db_module.save_memory(_make_memory(sid, importance=imp))

    rows = await db_module.query_memories(sid, "a1")
    assert len(rows) == 5
    returned_imp = [r["importance"] for r in rows]
    assert returned_imp == sorted(returned_imp, reverse=True)


@pytest.mark.asyncio
async def test_query_memories_by_category(db_path):
    """12. Save episodic + belief memories, filter by category."""
    sid = "cat-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    await db_module.save_memory(_make_memory(sid, category="episodic", importance=0.5))
    await db_module.save_memory(_make_memory(sid, category="episodic", importance=0.6))
    await db_module.save_memory(_make_memory(sid, category="semantic", importance=0.8))

    episodic = await db_module.query_memories(sid, "a1", category="episodic")
    assert len(episodic) == 2
    for m in episodic:
        assert m["category"] == "episodic"

    semantic = await db_module.query_memories(sid, "a1", category="semantic")
    assert len(semantic) == 1
    assert semantic[0]["category"] == "semantic"


@pytest.mark.asyncio
async def test_update_memory_access(db_path):
    """13. Save memory, update access, verify access_count incremented."""
    sid = "acc-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    mem = _make_memory(sid, mem_id="mem-acc")
    await db_module.save_memory(mem)

    await db_module.update_memory_access("mem-acc", tick=10)
    await db_module.update_memory_access("mem-acc", tick=15)

    rows = await db_module.query_memories(sid, "a1")
    target = [r for r in rows if r["id"] == "mem-acc"]
    assert len(target) == 1
    assert target[0]["access_count"] == 2
    assert target[0]["last_accessed"] == 15


@pytest.mark.asyncio
async def test_delete_memories(db_path):
    """14. Save 3 memories, delete 2, verify only 1 remains."""
    sid = "del-mem"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    ids = []
    for i in range(3):
        mid = f"mem-{i}"
        await db_module.save_memory(_make_memory(sid, mem_id=mid, importance=0.5 + i * 0.1))
        ids.append(mid)

    await db_module.delete_memories([ids[0], ids[1]])

    remaining = await db_module.query_memories(sid, "a1")
    assert len(remaining) == 1
    assert remaining[0]["id"] == ids[2]


# ===================================================================
# Timeline & Snapshots
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_load_timeline(db_path):
    """15. Save 3 timeline nodes, load returns them in tick order."""
    sid = "tl-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    for t in [3, 1, 2]:
        await db_module.save_timeline_node(_make_timeline_node(sid, tick=t))

    rows = await db_module.load_timeline(sid)
    assert len(rows) == 3
    ticks = [r["tick"] for r in rows]
    assert ticks == [1, 2, 3]
    # agent_locations deserialized
    assert isinstance(rows[0]["agent_locations"], dict)
    assert rows[0]["agent_locations"]["a1"] == "Tavern"
    assert rows[0]["lineage"]["session_id"] == sid
    assert rows[0]["lineage"]["tick"] == 1


@pytest.mark.asyncio
async def test_get_last_node_id(db_path):
    """16. Save nodes, get_last_node_id returns the one with highest tick."""
    sid = "last-node"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    n1 = _make_timeline_node(sid, tick=1, node_id="node-1")
    n2 = _make_timeline_node(sid, tick=5, node_id="node-5")
    n3 = _make_timeline_node(sid, tick=3, node_id="node-3")
    await db_module.save_timeline_node(n1)
    await db_module.save_timeline_node(n2)
    await db_module.save_timeline_node(n3)

    last = await db_module.get_last_node_id(sid)
    assert last == "node-5"


@pytest.mark.asyncio
async def test_save_and_load_snapshot(db_path):
    """17. Save snapshot with world_seed_json + agent_states_json, load it."""
    sid = "snap-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    snap = _make_snapshot(sid, tick=10, node_id="n10", snap_id="snap-1")
    await db_module.save_snapshot(snap)

    loaded = await db_module.load_nearest_snapshot(sid, tick=10)
    assert loaded is not None
    assert loaded["tick"] == 10
    assert loaded["node_id"] == "n10"
    # Deserialized JSON fields
    assert loaded["world_seed"]["name"] == "Test World"
    assert loaded["agent_states"][0]["agent_id"] == "a1"
    assert loaded["lineage"]["session_id"] == sid
    assert loaded["lineage"]["node_id"] == "n10"


@pytest.mark.asyncio
async def test_load_nearest_snapshot_before_tick(db_path):
    """18. Snapshots at tick 5 and 15 — nearest to tick 10 returns tick 5."""
    sid = "near-snap"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    await db_module.save_snapshot(_make_snapshot(sid, tick=5, snap_id="s5"))
    await db_module.save_snapshot(_make_snapshot(sid, tick=15, snap_id="s15"))

    loaded = await db_module.load_nearest_snapshot(sid, tick=10)
    assert loaded is not None
    assert loaded["tick"] == 5

    # tick=15 should return tick 15
    loaded2 = await db_module.load_nearest_snapshot(sid, tick=20)
    assert loaded2 is not None
    assert loaded2["tick"] == 15


@pytest.mark.asyncio
async def test_list_snapshots(db_path):
    """19. Save 3 snapshots, list_snapshots returns all in tick order."""
    sid = "list-snap"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    for t in [10, 5, 20]:
        await db_module.save_snapshot(_make_snapshot(sid, tick=t))

    rows = await db_module.list_snapshots(sid)
    assert len(rows) == 3
    ticks = [r["tick"] for r in rows]
    assert ticks == [5, 10, 20]
    assert rows[0]["lineage"]["session_id"] == sid


# ===================================================================
# Entity Details
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_load_entity_details(db_path):
    """20. Save details for an agent entity, load it back."""
    sid = "ent-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    details = {"bio": "A wandering merchant", "traits": ["cunning", "brave"]}
    await db_module.save_entity_details(sid, "agent", "a1", details, tick=3)

    loaded = await db_module.load_entity_details(sid, "agent", "a1")
    assert loaded is not None
    assert loaded["details"]["bio"] == "A wandering merchant"
    assert loaded["details"]["traits"] == ["cunning", "brave"]
    assert loaded["last_updated_tick"] == 3


@pytest.mark.asyncio
async def test_save_entity_details_updates(db_path):
    """21. Save twice with different tick — verify updated."""
    sid = "ent-upd"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    await db_module.save_entity_details(sid, "agent", "a1", {"v": 1}, tick=1)
    await db_module.save_entity_details(sid, "agent", "a1", {"v": 2}, tick=5)

    loaded = await db_module.load_entity_details(sid, "agent", "a1")
    assert loaded["details"]["v"] == 2
    assert loaded["last_updated_tick"] == 5


@pytest.mark.asyncio
async def test_load_all_entity_details(db_path):
    """22. Save details for 3 entities, load_all returns all."""
    sid = "ent-all"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    await db_module.save_entity_details(sid, "agent", "a1", {"x": 1}, tick=1)
    await db_module.save_entity_details(sid, "agent", "a2", {"x": 2}, tick=2)
    await db_module.save_entity_details(sid, "location", "Tavern", {"x": 3}, tick=3)

    rows = await db_module.load_all_entity_details(sid)
    assert len(rows) == 3
    types = {r["entity_type"] for r in rows}
    assert "agent" in types
    assert "location" in types


# ===================================================================
# Narrator Messages
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_load_narrator_messages(db_path):
    """23. Save 3 messages, load returns them in chronological order."""
    sid = "narr-sess"
    s = _make_session(session_id=sid)
    await db_module.save_session(s)

    id1 = await db_module.save_narrator_message(sid, "user", "Hello oracle", 1)
    id2 = await db_module.save_narrator_message(sid, "assistant", "Greetings", 1)
    id3 = await db_module.save_narrator_message(sid, "user", "What next?", 2)

    rows = await db_module.load_narrator_messages(sid)
    assert len(rows) == 3
    # Chronological order (reversed from DESC query)
    assert rows[0]["content"] == "Hello oracle"
    assert rows[1]["content"] == "Greetings"
    assert rows[2]["content"] == "What next?"
    # IDs returned by save
    assert isinstance(id1, str)
    assert isinstance(id2, str)
    assert isinstance(id3, str)


# ===================================================================
# Seeds / Assets
# ===================================================================


@pytest.mark.asyncio
async def test_save_and_list_seeds(db_path):
    """24. Save 2 seeds, list_seeds returns both."""
    seed1 = SavedSeed(
        type=SeedType.AGENT,
        name="Warrior",
        description="A strong warrior",
        tags=["combat"],
        data={"strength": 10},
        source_world="world-1",
    )
    seed2 = SavedSeed(
        type=SeedType.LOCATION,
        name="Dark Forest",
        description="A mysterious forest",
        tags=["nature"],
        data={"danger_level": 5},
        source_world="world-1",
    )
    await db_module.save_seed(seed1)
    await db_module.save_seed(seed2)

    rows = await db_module.list_seeds()
    assert len(rows) == 2
    names = {r["name"] for r in rows}
    assert "Warrior" in names
    assert "Dark Forest" in names


@pytest.mark.asyncio
async def test_list_seeds_by_type(db_path):
    """25. Save seeds of different types, filter by type."""
    await db_module.save_seed(
        SavedSeed(type=SeedType.AGENT, name="A1", data={})
    )
    await db_module.save_seed(
        SavedSeed(type=SeedType.AGENT, name="A2", data={})
    )
    await db_module.save_seed(
        SavedSeed(type=SeedType.LOCATION, name="L1", data={})
    )

    agents = await db_module.list_seeds(seed_type="agent")
    assert len(agents) == 2
    for r in agents:
        assert r["type"] == "agent"

    locations = await db_module.list_seeds(seed_type="location")
    assert len(locations) == 1
    assert locations[0]["name"] == "L1"


@pytest.mark.asyncio
async def test_get_seed(db_path):
    """26. Save seed, get_seed returns it with deserialized fields."""
    seed = SavedSeed(
        id="seed-get",
        type=SeedType.ITEM,
        name="Magic Sword",
        description="Glows blue",
        tags=["weapon", "magic"],
        data={"damage": 15, "element": "ice"},
        source_world="world-x",
    )
    await db_module.save_seed(seed)

    loaded = await db_module.get_seed("seed-get")
    assert loaded is not None
    assert loaded["name"] == "Magic Sword"
    assert loaded["description"] == "Glows blue"
    assert loaded["tags"] == ["weapon", "magic"]
    assert loaded["data"]["damage"] == 15
    assert loaded["source_world"] == "world-x"
    assert loaded["lineage"]["root_name"] == ""


@pytest.mark.asyncio
async def test_delete_seed(db_path):
    """27. Save seed, delete_seed, verify gone."""
    seed = SavedSeed(
        id="seed-del",
        type=SeedType.EVENT,
        name="Earthquake",
        data={"magnitude": 7},
    )
    await db_module.save_seed(seed)
    assert await db_module.get_seed("seed-del") is not None

    deleted = await db_module.delete_seed("seed-del")
    assert deleted is True

    assert await db_module.get_seed("seed-del") is None

    # Deleting non-existent returns False
    assert await db_module.delete_seed("seed-del") is False


# ===================================================================
# Migration Safety
# ===================================================================


@pytest.mark.asyncio
async def test_init_db_idempotent(db_path):
    """28. Calling init_db twice on the same file causes no error."""
    # init_db was already called once in the fixture; call again
    await db_module.init_db(db_path)
    await db_module.init_db(db_path)

    # DB should still be functional after double-init
    s = _make_session(session_id="idem-test")
    await db_module.save_session(s)
    loaded = await db_module.load_session("idem-test")
    assert loaded is not None
    assert loaded["tick"] == 5
