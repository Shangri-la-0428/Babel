"""BABEL — SQLite persistence layer."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

import aiosqlite

DB_PATH = Path(os.environ.get("BABEL_DB_PATH", Path(__file__).parent.parent / "babel.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    world_seed TEXT NOT NULL,
    tick INTEGER DEFAULT 0,
    status TEXT DEFAULT 'paused',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_states (
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    personality TEXT DEFAULT '',
    goals TEXT DEFAULT '[]',
    location TEXT DEFAULT '',
    inventory TEXT DEFAULT '[]',
    status TEXT DEFAULT 'idle',
    memory TEXT DEFAULT '[]',
    PRIMARY KEY (session_id, agent_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    agent_id TEXT,
    agent_name TEXT,
    action_type TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT '{}',
    result TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS saved_seeds (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    data TEXT NOT NULL DEFAULT '{}',
    source_world TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, tick);
CREATE INDEX IF NOT EXISTS idx_agent_states_session ON agent_states(session_id);
CREATE INDEX IF NOT EXISTS idx_seeds_type ON saved_seeds(type);
"""

# ── V2: Timeline + Memory tables ──

SCHEMA_V2 = """
CREATE TABLE IF NOT EXISTS timeline_nodes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    parent_id TEXT,
    branch_id TEXT DEFAULT 'main',
    node_type TEXT DEFAULT 'tick',
    summary TEXT DEFAULT '',
    event_count INTEGER DEFAULT 0,
    agent_locations TEXT DEFAULT '{}',
    significant INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_timeline_session_tick ON timeline_nodes(session_id, tick);
CREATE INDEX IF NOT EXISTS idx_timeline_branch ON timeline_nodes(session_id, branch_id);

CREATE TABLE IF NOT EXISTS world_snapshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    world_seed_json TEXT NOT NULL,
    agent_states_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_session_tick ON world_snapshots(session_id, tick);

CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    tick INTEGER NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'episodic',
    importance REAL DEFAULT 0.5,
    tags TEXT DEFAULT '[]',
    source_event_id TEXT,
    access_count INTEGER DEFAULT 0,
    last_accessed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(session_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON agent_memories(session_id, agent_id, importance DESC);
"""


async def _migrate_v2(db: aiosqlite.Connection) -> None:
    """Add V2 columns to events table if missing."""
    cursor = await db.execute("PRAGMA table_info(events)")
    columns = {row[1] for row in await cursor.fetchall()}
    new_cols = [
        ("location", "TEXT DEFAULT ''"),
        ("involved_agents", "TEXT DEFAULT '[]'"),
        ("importance", "REAL DEFAULT 0.5"),
        ("node_id", "TEXT DEFAULT ''"),
    ]
    for col_name, col_def in new_cols:
        if col_name not in columns:
            await db.execute(f"ALTER TABLE events ADD COLUMN {col_name} {col_def}")
    # Extra indices for events
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_events_location ON events(session_id, location)"
    )
    await db.execute(
        "CREATE INDEX IF NOT EXISTS idx_events_agent ON events(session_id, agent_id, tick DESC)"
    )
    await db.commit()


async def _migrate_v3(db: aiosqlite.Connection) -> None:
    """Add role column to agent_states table if missing."""
    cursor = await db.execute("PRAGMA table_info(agent_states)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "role" not in columns:
        await db.execute(
            "ALTER TABLE agent_states ADD COLUMN role TEXT DEFAULT 'main'"
        )
        await db.commit()


# ── V4: Entity Details table ──

SCHEMA_V4 = """
CREATE TABLE IF NOT EXISTS entity_details (
    session_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    last_updated_tick INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, entity_type, entity_id)
);
"""


async def _migrate_v4(db: aiosqlite.Connection) -> None:
    """Create entity_details table if it doesn't exist."""
    await db.executescript(SCHEMA_V4)
    await db.commit()


# ── V5: Narrator Messages table ──

SCHEMA_V5 = """
CREATE TABLE IF NOT EXISTS narrator_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tick INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_narrator_session ON narrator_messages(session_id, created_at);
"""


async def _migrate_v5(db: aiosqlite.Connection) -> None:
    """Create narrator_messages table if it doesn't exist."""
    await db.executescript(SCHEMA_V5)
    await db.commit()


async def _migrate_v6(db: aiosqlite.Connection) -> None:
    """Add relations column to sessions table if missing."""
    cursor = await db.execute("PRAGMA table_info(sessions)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "relations" not in columns:
        await db.execute(
            "ALTER TABLE sessions ADD COLUMN relations TEXT DEFAULT '[]'"
        )
        await db.commit()


async def _migrate_v7(db: aiosqlite.Connection) -> None:
    """Add active_goal column to agent_states table."""
    cursor = await db.execute("PRAGMA table_info(agent_states)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "active_goal" not in columns:
        await db.execute(
            "ALTER TABLE agent_states ADD COLUMN active_goal TEXT DEFAULT NULL"
        )
        await db.commit()


async def _migrate_v8(db: aiosqlite.Connection) -> None:
    """Add structured field to events and semantic field to agent_memories."""
    cursor = await db.execute("PRAGMA table_info(events)")
    event_cols = {row[1] for row in await cursor.fetchall()}
    if "structured" not in event_cols:
        await db.execute(
            "ALTER TABLE events ADD COLUMN structured TEXT DEFAULT '{}'"
        )

    cursor = await db.execute("PRAGMA table_info(agent_memories)")
    mem_cols = {row[1] for row in await cursor.fetchall()}
    if "semantic" not in mem_cols:
        await db.execute(
            "ALTER TABLE agent_memories ADD COLUMN semantic TEXT DEFAULT '{}'"
        )
    await db.commit()


# ── V9: Hidden World Seeds ──

SCHEMA_V9 = """
CREATE TABLE IF NOT EXISTS hidden_seed_refs (
    seed_ref TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


async def _migrate_v9(db: aiosqlite.Connection) -> None:
    """Create hidden_seed_refs table if it doesn't exist."""
    await db.executescript(SCHEMA_V9)
    await db.commit()


async def init_db(db_path: str | Path | None = None) -> None:
    path = str(db_path or DB_PATH)
    async with aiosqlite.connect(path) as db:
        await db.executescript(SCHEMA)
        await db.executescript(SCHEMA_V2)
        await _migrate_v2(db)
        await _migrate_v3(db)
        await _migrate_v4(db)
        await _migrate_v5(db)
        await _migrate_v6(db)
        await _migrate_v7(db)
        await _migrate_v8(db)
        await _migrate_v9(db)
        await db.commit()


async def save_session(session) -> None:
    """Save/update a session and its agent states."""
    # Serialize relations
    relations_json = json.dumps(
        [r.model_dump() for r in session.relations],
        ensure_ascii=False,
    ) if hasattr(session, "relations") else "[]"

    async with aiosqlite.connect(str(DB_PATH)) as db:
        # Upsert session (with relations)
        await db.execute(
            """INSERT INTO sessions (id, world_seed, tick, status, relations)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET tick=?, status=?, relations=?""",
            (
                session.id,
                session.world_seed.model_dump_json(),
                session.tick,
                session.status.value,
                relations_json,
                session.tick,
                session.status.value,
                relations_json,
            ),
        )

        # Upsert agent states
        for aid, agent in session.agents.items():
            role_val = agent.role.value if hasattr(agent.role, "value") else agent.role
            active_goal_json = (
                json.dumps(agent.active_goal.model_dump(), ensure_ascii=False)
                if agent.active_goal else None
            )
            await db.execute(
                """INSERT INTO agent_states
                   (session_id, agent_id, name, description, personality, goals,
                    location, inventory, status, memory, role, active_goal)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(session_id, agent_id) DO UPDATE SET
                    location=?, inventory=?, status=?, memory=?, role=?,
                    active_goal=?""",
                (
                    session.id,
                    aid,
                    agent.name,
                    agent.description,
                    agent.personality,
                    json.dumps(agent.goals, ensure_ascii=False),
                    agent.location,
                    json.dumps(agent.inventory, ensure_ascii=False),
                    agent.status.value,
                    json.dumps(agent.memory, ensure_ascii=False),
                    role_val,
                    active_goal_json,
                    # ON CONFLICT updates:
                    agent.location,
                    json.dumps(agent.inventory, ensure_ascii=False),
                    agent.status.value,
                    json.dumps(agent.memory, ensure_ascii=False),
                    role_val,
                    active_goal_json,
                ),
            )

        await db.commit()


async def save_event(event) -> None:
    """Save a single event (with V2 fields + structured)."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        at = event.action_type if isinstance(event.action_type, str) else event.action_type.value
        structured_json = json.dumps(
            event.structured if hasattr(event, "structured") else {},
            ensure_ascii=False,
        )
        await db.execute(
            """INSERT OR IGNORE INTO events
               (id, session_id, tick, agent_id, agent_name, action_type,
                action, result, structured, location, involved_agents, importance, node_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.id,
                event.session_id,
                event.tick,
                event.agent_id,
                event.agent_name,
                at,
                json.dumps(event.action, ensure_ascii=False),
                event.result,
                structured_json,
                event.location,
                json.dumps(event.involved_agents, ensure_ascii=False),
                event.importance,
                event.node_id,
            ),
        )
        await db.commit()


async def load_events(session_id: str, limit: int = 200, offset: int = 0) -> list[dict]:
    """Load events for a session."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM events WHERE session_id = ?
               ORDER BY tick DESC, rowid DESC LIMIT ? OFFSET ?""",
            (session_id, limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def load_events_filtered(
    session_id: str,
    agent_id: str | None = None,
    location: str | None = None,
    min_tick: int = 0,
    limit: int = 8,
) -> list[dict]:
    """Load events filtered by agent, location, or tick range."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        conditions = ["session_id = ?", "tick >= ?"]
        params: list = [session_id, min_tick]

        if agent_id and location:
            conditions.append("(agent_id = ? OR agent_id IS NULL OR location = ?)")
            params.extend([agent_id, location])
        elif agent_id:
            conditions.append("(agent_id = ? OR agent_id IS NULL)")
            params.append(agent_id)
        elif location:
            conditions.append("(location = ? OR agent_id IS NULL)")
            params.append(location)

        where = " AND ".join(conditions)
        cursor = await db.execute(
            f"SELECT * FROM events WHERE {where} ORDER BY tick DESC, rowid DESC LIMIT ?",
            (*params, limit),
        )
        rows = await cursor.fetchall()
        result = []
        for r in rows:
            e = dict(r)
            if "action" in e and isinstance(e["action"], str):
                e["action"] = json.loads(e["action"])
            if "involved_agents" in e and isinstance(e["involved_agents"], str):
                e["involved_agents"] = json.loads(e["involved_agents"])
            result.append(e)
        result.reverse()
        return result


async def load_event_by_id(session_id: str, event_id: str) -> dict | None:
    """Load a single event by ID."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM events WHERE id = ? AND session_id = ?",
            (event_id, session_id),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        e = dict(row)
        if isinstance(e.get("action"), str):
            e["action"] = json.loads(e["action"])
        return e


async def list_sessions() -> list[dict]:
    """List all sessions."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        visible_sessions: list[dict] = []
        for row in rows:
            session = dict(row)
            try:
                world_seed = json.loads(session.get("world_seed") or "{}")
                if world_seed.get("name") == "__ORACLE_DRAFT__":
                    continue
            except Exception:
                pass
            visible_sessions.append(session)
        return visible_sessions


async def delete_session(session_id: str) -> bool:
    """Delete a session and all related data (events, agents, timeline, snapshots, memories)."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not await cursor.fetchone():
            return False
        # All deletes in a single transaction for atomicity
        await db.execute("BEGIN")
        try:
            await db.execute("DELETE FROM events WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM agent_states WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM timeline_nodes WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM world_snapshots WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM agent_memories WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM entity_details WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM narrator_messages WHERE session_id = ?", (session_id,))
            await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            await db.commit()
        except Exception as e:
            logger.warning("Session delete failed, rolling back session %s: %s", session_id, e)
            await db.rollback()
            raise
        return True


async def load_session(session_id: str) -> dict | None:
    """Load a full session (with agents and recent events) from DB."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        session = dict(row)
        session["world_seed"] = json.loads(session["world_seed"])
        # Deserialize relations (V6+)
        if session.get("relations"):
            session["relations"] = json.loads(session["relations"])
        else:
            session["relations"] = []

        cursor = await db.execute(
            "SELECT * FROM agent_states WHERE session_id = ?", (session_id,)
        )
        agents = []
        for r in await cursor.fetchall():
            a = dict(r)
            a["goals"] = json.loads(a["goals"])
            a["inventory"] = json.loads(a["inventory"])
            a["memory"] = json.loads(a["memory"])
            if a.get("active_goal"):
                a["active_goal"] = json.loads(a["active_goal"])
            else:
                a["active_goal"] = None
            agents.append(a)
        session["agents"] = agents

        cursor = await db.execute(
            """SELECT * FROM events WHERE session_id = ?
               ORDER BY tick DESC, rowid DESC LIMIT 50""",
            (session_id,),
        )
        events = []
        for r in await cursor.fetchall():
            e = dict(r)
            e["action"] = json.loads(e["action"])
            events.append(e)
        events.reverse()
        session["events"] = events

        return session


# ── Saved Seeds (Asset Library) ──


async def save_seed(seed) -> None:
    """Save a seed to the asset library."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT INTO saved_seeds (id, type, name, description, tags, data, source_world)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                name=?, description=?, tags=?, data=?""",
            (
                seed.id,
                seed.type.value if hasattr(seed.type, "value") else seed.type,
                seed.name,
                seed.description,
                json.dumps(seed.tags, ensure_ascii=False),
                json.dumps(seed.data, ensure_ascii=False),
                seed.source_world,
                seed.name,
                seed.description,
                json.dumps(seed.tags, ensure_ascii=False),
                json.dumps(seed.data, ensure_ascii=False),
            ),
        )
        await db.commit()


async def list_seeds(seed_type: str | None = None) -> list[dict]:
    """List saved seeds, optionally filtered by type."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        if seed_type:
            cursor = await db.execute(
                "SELECT * FROM saved_seeds WHERE type = ? ORDER BY created_at DESC",
                (seed_type,),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM saved_seeds ORDER BY created_at DESC"
            )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["tags"] = json.loads(d["tags"])
            d["data"] = json.loads(d["data"])
            results.append(d)
        return results


async def get_seed(seed_id: str) -> dict | None:
    """Get a single saved seed."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM saved_seeds WHERE id = ?", (seed_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["tags"] = json.loads(d["tags"])
        d["data"] = json.loads(d["data"])
        return d


async def delete_seed(seed_id: str) -> bool:
    """Delete a saved seed. Returns True if deleted."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "DELETE FROM saved_seeds WHERE id = ?", (seed_id,)
        )
        await db.commit()
        return cursor.rowcount > 0


async def delete_seeds_by_source_worlds(source_worlds: list[str]) -> int:
    """Delete all saved seeds whose source_world belongs to the provided values."""
    unique_sources = [value.strip() for value in source_worlds if isinstance(value, str) and value.strip()]
    unique_sources = list(dict.fromkeys(unique_sources))
    if not unique_sources:
        return 0

    placeholders = ",".join("?" for _ in unique_sources)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            f"DELETE FROM saved_seeds WHERE source_world IN ({placeholders})",
            tuple(unique_sources),
        )
        await db.commit()
        return cursor.rowcount


async def hide_seed_ref(seed_ref: str) -> None:
    """Hide a world seed reference from the library list."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            "INSERT OR IGNORE INTO hidden_seed_refs (seed_ref) VALUES (?)",
            (seed_ref,),
        )
        await db.commit()


async def is_seed_ref_hidden(seed_ref: str) -> bool:
    """Return True if a world seed reference was hidden by the user."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT 1 FROM hidden_seed_refs WHERE seed_ref = ?",
            (seed_ref,),
        )
        return await cursor.fetchone() is not None


async def list_hidden_seed_refs() -> list[str]:
    """List hidden world seed references."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            "SELECT seed_ref FROM hidden_seed_refs ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [row[0] for row in rows]


# ── Agent Memories (Structured) ──


async def save_memory(mem) -> None:
    """Save a structured memory entry (with semantic field)."""
    semantic_json = json.dumps(
        mem.semantic if hasattr(mem, "semantic") else {},
        ensure_ascii=False,
    )
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT OR IGNORE INTO agent_memories
               (id, session_id, agent_id, tick, content, semantic, category,
                importance, tags, source_event_id, access_count, last_accessed)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                mem.id,
                mem.session_id,
                mem.agent_id,
                mem.tick,
                mem.content,
                semantic_json,
                mem.category,
                mem.importance,
                json.dumps(mem.tags, ensure_ascii=False),
                mem.source_event_id,
                mem.access_count,
                mem.last_accessed,
            ),
        )
        await db.commit()


async def query_memories(
    session_id: str,
    agent_id: str,
    category: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Query structured memories for an agent."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        if category:
            cursor = await db.execute(
                """SELECT * FROM agent_memories
                   WHERE session_id = ? AND agent_id = ? AND category = ?
                   ORDER BY importance DESC, tick DESC LIMIT ?""",
                (session_id, agent_id, category, limit),
            )
        else:
            cursor = await db.execute(
                """SELECT * FROM agent_memories
                   WHERE session_id = ? AND agent_id = ?
                   ORDER BY importance DESC, tick DESC LIMIT ?""",
                (session_id, agent_id, limit),
            )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["tags"] = json.loads(d["tags"])
            if "semantic" in d and isinstance(d["semantic"], str):
                d["semantic"] = json.loads(d["semantic"])
            elif "semantic" not in d:
                d["semantic"] = {}
            results.append(d)
        return results


async def update_memory_access(memory_id: str, tick: int) -> None:
    """Update access count and last_accessed tick for a memory."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """UPDATE agent_memories
               SET access_count = access_count + 1, last_accessed = ?
               WHERE id = ?""",
            (tick, memory_id),
        )
        await db.commit()


async def delete_memories(memory_ids: list[str]) -> None:
    """Delete memories by IDs."""
    if not memory_ids:
        return
    async with aiosqlite.connect(str(DB_PATH)) as db:
        placeholders = ",".join("?" * len(memory_ids))
        await db.execute(
            f"DELETE FROM agent_memories WHERE id IN ({placeholders})",
            memory_ids,
        )
        await db.commit()


# ── Timeline Nodes ──


async def save_timeline_node(node) -> None:
    """Save a timeline node."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT OR IGNORE INTO timeline_nodes
               (id, session_id, tick, parent_id, branch_id, node_type,
                summary, event_count, agent_locations, significant)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                node.id,
                node.session_id,
                node.tick,
                node.parent_id,
                node.branch_id,
                node.node_type,
                node.summary,
                node.event_count,
                json.dumps(node.agent_locations, ensure_ascii=False),
                1 if node.significant else 0,
            ),
        )
        await db.commit()


async def load_timeline(
    session_id: str,
    branch: str = "main",
    from_tick: int = 0,
    to_tick: int | None = None,
) -> list[dict]:
    """Load timeline nodes for a session."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        if to_tick is not None:
            cursor = await db.execute(
                """SELECT * FROM timeline_nodes
                   WHERE session_id = ? AND branch_id = ? AND tick >= ? AND tick <= ?
                   ORDER BY tick ASC""",
                (session_id, branch, from_tick, to_tick),
            )
        else:
            cursor = await db.execute(
                """SELECT * FROM timeline_nodes
                   WHERE session_id = ? AND branch_id = ? AND tick >= ?
                   ORDER BY tick ASC""",
                (session_id, branch, from_tick),
            )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["agent_locations"] = json.loads(d["agent_locations"])
            d["significant"] = bool(d["significant"])
            results.append(d)
        return results


async def get_last_node_id(session_id: str, branch: str = "main") -> str | None:
    """Get the ID of the most recent timeline node."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        cursor = await db.execute(
            """SELECT id FROM timeline_nodes
               WHERE session_id = ? AND branch_id = ?
               ORDER BY tick DESC LIMIT 1""",
            (session_id, branch),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


# ── World Snapshots ──


async def save_snapshot(snapshot) -> None:
    """Save a world snapshot."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT OR IGNORE INTO world_snapshots
               (id, session_id, node_id, tick, world_seed_json, agent_states_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                snapshot.id,
                snapshot.session_id,
                snapshot.node_id,
                snapshot.tick,
                snapshot.world_seed_json,
                snapshot.agent_states_json,
            ),
        )
        await db.commit()


async def load_nearest_snapshot(session_id: str, tick: int) -> dict | None:
    """Load the nearest snapshot at or before a given tick."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM world_snapshots
               WHERE session_id = ? AND tick <= ?
               ORDER BY tick DESC LIMIT 1""",
            (session_id, tick),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["world_seed"] = json.loads(d["world_seed_json"])
        d["agent_states"] = json.loads(d["agent_states_json"])
        return d


async def list_snapshots(session_id: str) -> list[dict]:
    """List all snapshots for a session."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, session_id, node_id, tick, created_at
               FROM world_snapshots WHERE session_id = ?
               ORDER BY tick ASC""",
            (session_id,),
        )
        return [dict(row) for row in await cursor.fetchall()]


# ── Entity Details (Progressive Enrichment) ──


async def save_entity_details(
    session_id: str, entity_type: str, entity_id: str, details: dict, tick: int
) -> None:
    """Save or update enriched details for a world entity."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT INTO entity_details (session_id, entity_type, entity_id, details, last_updated_tick)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(session_id, entity_type, entity_id) DO UPDATE SET
                details=?, last_updated_tick=?""",
            (
                session_id,
                entity_type,
                entity_id,
                json.dumps(details, ensure_ascii=False),
                tick,
                json.dumps(details, ensure_ascii=False),
                tick,
            ),
        )
        await db.commit()


async def load_entity_details(
    session_id: str, entity_type: str, entity_id: str
) -> dict | None:
    """Load enriched details for a single entity. Returns None if not found."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM entity_details
               WHERE session_id = ? AND entity_type = ? AND entity_id = ?""",
            (session_id, entity_type, entity_id),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["details"] = json.loads(d["details"])
        return d


async def load_all_entity_details(session_id: str) -> list[dict]:
    """Load all enriched entity details for a session."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM entity_details WHERE session_id = ?
               ORDER BY entity_type, entity_id""",
            (session_id,),
        )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            d = dict(row)
            d["details"] = json.loads(d["details"])
            results.append(d)
        return results


# ── Narrator Messages (Oracle) ──


async def save_narrator_message(
    session_id: str, role: str, content: str, tick: int
) -> str:
    """Save a narrator message. Returns the message ID."""
    import uuid

    msg_id = uuid.uuid4().hex
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT INTO narrator_messages (id, session_id, role, content, tick)
               VALUES (?, ?, ?, ?, ?)""",
            (msg_id, session_id, role, content, tick),
        )
        await db.commit()
    return msg_id


async def load_narrator_messages(
    session_id: str, limit: int = 20
) -> list[dict]:
    """Load recent narrator messages for a session."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM narrator_messages
               WHERE session_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (session_id, limit),
        )
        rows = await cursor.fetchall()
        results = [dict(row) for row in rows]
        results.reverse()
        return results
