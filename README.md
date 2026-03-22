# BABEL

AI-driven World State Machine. Define a world seed with rules, locations, and agents — then watch AI autonomously drive emergent narratives through a tick-based simulation loop.

## Architecture

```
backend/     Python FastAPI + SQLite + litellm
frontend/    Next.js 14 + Tailwind CSS
design/      Design tokens, components, Tailwind preset
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- An LLM API key (OpenAI, Anthropic, or any litellm-compatible provider)

### Install

```bash
git clone https://github.com/Shangri-la-0428/babel.git
cd babel
./install.sh
```

### Run

```bash
babel
```

Open http://localhost:3000 → click **Settings** → configure your API Key → done.
Settings are saved in your browser — only need to configure once. `Ctrl+C` to stop.

### Docker

```bash
# Set your API key
export BABEL_API_KEY="sk-..."
export BABEL_API_BASE="https://..."  # optional

docker compose up --build
```

Backend: http://localhost:8000 | Frontend: http://localhost:3000

## How It Works

1. **Seed** — Define a world: name, description, rules, locations, and agents with personalities/goals
2. **Launch** — The engine initializes agent states and records initial events
3. **Tick Loop** — Each tick, every agent receives context (world rules + own state + recent events + visible agents) and the LLM returns a structured JSON action
4. **Validate** — Actions are validated (items/locations/targets must exist), with retry + fallback on failure
5. **Evolve** — State changes are applied, events are recorded, and the world moves forward

### Anti-Loop Protection

If an agent repeats the same action 3 times consecutively, the engine injects a random world event to break the cycle.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/seeds` | List available seed files |
| POST | `/api/worlds` | Create world from JSON |
| POST | `/api/worlds/from-seed/{file}` | Create world from YAML seed |
| POST | `/api/worlds/{id}/run` | Start simulation |
| POST | `/api/worlds/{id}/pause` | Pause simulation |
| POST | `/api/worlds/{id}/step` | Execute single tick |
| GET | `/api/worlds/{id}/state` | Get current world state |
| GET | `/api/worlds/{id}/events` | Get event history |
| GET | `/api/sessions` | List all sessions |
| WS | `/ws/{id}` | Real-time event stream |

### WebSocket Messages

```json
{"type": "connected",     "data": {/* full state */}}
{"type": "event",         "data": {/* agent action */}}
{"type": "tick",          "data": {"tick": 42, "status": "running"}}
{"type": "state_update",  "data": {/* full state */}}
{"type": "stopped",       "data": {"tick": 50}}
```

## Seed Format

```yaml
name: "World Name"
description: "World description"
rules:
  - "Rule 1"
  - "Rule 2"
locations:
  - name: "Location A"
    description: "Description"
agents:
  - id: "agent_1"
    name: "Agent Name"
    description: "Who they are"
    personality: "Traits"
    goals:
      - "Goal 1"
    inventory:
      - "Item 1"
    location: "Location A"
initial_events:
  - "Something just happened"
```

Three seeds are included: `cyber_bar.yaml`, `apocalypse.yaml`, `iron_throne.yaml`.

## LLM Configuration

BABEL uses [litellm](https://github.com/BerriAI/litellm) — supports OpenAI, Anthropic, Azure, Ollama, and 100+ providers.

Configure via environment variables or the Settings panel in the UI:

| Variable | Description | Default |
|----------|-------------|---------|
| `BABEL_API_KEY` | LLM API key | — |
| `BABEL_MODEL` | Model identifier | `gpt-4o-mini` |
| `BABEL_API_BASE` | Custom API endpoint | — |

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | FastAPI + uvicorn |
| Database | SQLite (aiosqlite) |
| LLM | litellm |
| Frontend | Next.js 14 (App Router) |
| Styling | Tailwind CSS + custom design preset |
| Real-time | WebSocket |
| Validation | Pydantic v2 |
