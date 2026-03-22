"""BABEL — SQLite persistence layer."""

from __future__ import annotations

import json
import os
from pathlib import Path

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


async def init_db(db_path: str | Path | None = None) -> None:
    path = str(db_path or DB_PATH)
    async with aiosqlite.connect(path) as db:
        await db.executescript(SCHEMA)
        await db.commit()


async def get_db(db_path: str | Path | None = None) -> aiosqlite.Connection:
    path = str(db_path or DB_PATH)
    db = await aiosqlite.connect(path)
    db.row_factory = aiosqlite.Row
    return db


async def save_session(session) -> None:
    """Save/update a session and its agent states."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        # Upsert session
        await db.execute(
            """INSERT INTO sessions (id, world_seed, tick, status)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET tick=?, status=?""",
            (
                session.id,
                session.world_seed.model_dump_json(),
                session.tick,
                session.status.value,
                session.tick,
                session.status.value,
            ),
        )

        # Upsert agent states
        for aid, agent in session.agents.items():
            await db.execute(
                """INSERT INTO agent_states
                   (session_id, agent_id, name, description, personality, goals,
                    location, inventory, status, memory)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(session_id, agent_id) DO UPDATE SET
                    location=?, inventory=?, status=?, memory=?""",
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
                    # ON CONFLICT updates:
                    agent.location,
                    json.dumps(agent.inventory, ensure_ascii=False),
                    agent.status.value,
                    json.dumps(agent.memory, ensure_ascii=False),
                ),
            )

        await db.commit()


async def save_event(event) -> None:
    """Save a single event."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT OR IGNORE INTO events
               (id, session_id, tick, agent_id, agent_name, action_type, action, result)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                event.id,
                event.session_id,
                event.tick,
                event.agent_id,
                event.agent_name,
                event.action_type if isinstance(event.action_type, str) else event.action_type.value,
                json.dumps(event.action, ensure_ascii=False),
                event.result,
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


async def list_sessions() -> list[dict]:
    """List all sessions."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def load_session(session_id: str) -> dict | None:
    """Load a full session (with agents and recent events) from DB.

    Returns a dict with keys: id, world_seed, tick, status, created_at,
    agents (list of dicts), events (list of dicts, last 50 by tick ASC).
    """
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row

        # Session row
        cursor = await db.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        session = dict(row)
        session["world_seed"] = json.loads(session["world_seed"])

        # Agent states
        cursor = await db.execute(
            "SELECT * FROM agent_states WHERE session_id = ?", (session_id,)
        )
        agents = []
        for r in await cursor.fetchall():
            a = dict(r)
            a["goals"] = json.loads(a["goals"])
            a["inventory"] = json.loads(a["inventory"])
            a["memory"] = json.loads(a["memory"])
            agents.append(a)
        session["agents"] = agents

        # Recent events (last 50, chronological)
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
        events.reverse()  # chronological
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
                # ON CONFLICT updates:
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
