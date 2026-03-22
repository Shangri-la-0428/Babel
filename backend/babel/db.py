"""BABEL — SQLite persistence layer."""

from __future__ import annotations

import json
from pathlib import Path

import aiosqlite

DB_PATH = Path(__file__).parent.parent / "babel.db"

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

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, tick);
CREATE INDEX IF NOT EXISTS idx_agent_states_session ON agent_states(session_id);
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
