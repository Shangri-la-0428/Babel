# BABEL Architecture

## Design Philosophy

BABEL is a **modality-agnostic world model**. Text is the first interface, not the only one.

The architecture follows three principles:

1. **World logic has no I/O assumptions** — State machine + rules engine operate on pure data
2. **Every policy is pluggable** — Decision-making, memory consolidation, and social dynamics can be swapped without touching the kernel
3. **Structured data alongside human text** — Every event has both `result` (text) and `structured` (machine-readable), enabling any renderer

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        PRESENTATION                             │
│   Next.js 14 · Tailwind · WebSocket                            │
│   Components: EventFeed, AssetPanel, OracleDrawer, WorldRadar  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────┴──────────────────────────────────────┐
│                          API FACADE                             │
│   FastAPI · api.py                                              │
│   Routes, WebSocket hub, session lifecycle, serialization       │
└──────────┬──────────────────────────────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────────────┐
│                       ENGINE (Orchestrator)                      │
│   engine.py                                                     │
│                                                                 │
│   tick() → for each agent:                                      │
│     1. Build AgentContext (modality-agnostic world slice)        │
│     2. decision_source.decide(ctx) → ActionOutput               │
│     3. validate_action() → errors or pass                       │
│     4. apply_action() → state mutation + Event                  │
│     5. create_memory_from_event()                               │
│     6. _update_relations() + _update_goals()                    │
│                                                                 │
│   post_tick() → timeline node, snapshot, memory consolidation   │
└──────┬──────────┬───────────┬───────────┬───────────────────────┘
       │          │           │           │
  ┌────┴───┐ ┌───┴────┐ ┌────┴────┐ ┌────┴─────┐
  │Decision│ │Validator│ │ Memory  │ │Persistence│
  │ Source │ │        │ │         │ │           │
  └────────┘ └────────┘ └─────────┘ └───────────┘
```

## Module Responsibilities

### models.py — Pure Data (0 dependencies)
Foundation layer. Pydantic models with no I/O.

| Model | Purpose |
|-------|---------|
| `WorldSeed` | World definition (rules, locations, agents, time) |
| `Session` | Runtime state (agents, events, relations, tick) |
| `AgentState` | Agent runtime (location, inventory, goals, memory) |
| `GoalState` | Trackable goal with progress and stall detection |
| `Relation` | Directional agent-to-agent relationship |
| `Event` | Action record with `result` (text) + `structured` (data) |
| `MemoryEntry` | Persistent memory with `content` (text) + `semantic` (data) |
| `ActionOutput` | Agent decision (type, target, content) |
| `LLMResponse` | Full LLM response wrapping ActionOutput |

### decision.py — Pluggable Decision Protocol
**Extension point.** Any class implementing `async decide(AgentContext) -> ActionOutput` can drive agents.

```
DecisionSource (Protocol)
  ├── LLMDecisionSource           — prompts.py + llm.py pipeline (default)
  ├── HumanDecisionSource         — waits for human input via API (decorator pattern)
  ├── ContextAwareDecisionSource  — context-driven actions for stability testing
  ├── ScriptedDecisionSource      — deterministic testing
  └── [your source here]          — other AI, RL agent, Psyche, etc.
```

`AgentContext` is the modality-agnostic interface between world and brain. It contains everything an agent can perceive: visible agents, memories, beliefs, relations, reachable locations, goals, world rules, time.

**How to add a new decision source:**
1. Implement `async def decide(self, context: AgentContext) -> ActionOutput`
2. Pass it to `Engine(session, decision_source=your_source)`

### validator.py — Pure Rules (depends only on models.py)
Validates and applies actions. Stateless functions on data.

- `validate_action(response, agent, session) -> list[str]` — Returns errors or empty list
- `apply_action(response, agent, session) -> str` — Mutates state, returns summary

Validation rules:
- MOVE: target must be a connected location (if topology defined)
- SPEAK/TRADE: target must be at same location, not dead
- TRADE: hostile relations block trades
- Inventory: only TRADE/USE_ITEM can add items; items must exist on source

### memory.py — Memory Pipeline
Three layers of memory:

1. **Episodic** — Raw event memories with importance scoring
2. **Semantic** — Consolidated summaries (LLM or rule-based compression)
3. **Belief** — High-level conclusions from experience (rule-driven extraction)

Key functions:
- `create_memory_from_event()` — Event → MemoryEntry with importance, tags, semantic metadata
- `retrieve_relevant_memories()` — Scored retrieval by recency, importance, and tag relevance
- `consolidate_memories()` — Compress old episodic memories into semantic summaries
- `extract_beliefs()` — Derive beliefs from relations and event patterns

### engine.py — Orchestrator
Coordinates the tick loop. Key design decisions:

- **Always uses DecisionSource** — No legacy direct-LLM path. `LLMDecisionSource` is the default.
- **Configurable intervals** — `snapshot_interval`, `epoch_interval`, `belief_interval` per-engine
- **Clean API surface** — `start()`, `pause()`, `stop()`, `configure()`, `inject_urgent_event()`
- **Post-tick pipeline** — Timeline nodes, snapshots, memory consolidation, belief extraction, passive enrichment

### llm.py — LLM Integration
litellm wrapper for all LLM calls. Isolated from world logic.

- `get_agent_action()` — Build prompt + call LLM + parse JSON response
- `summarize_memories()` — Compress 3-5 memories into 1-2 sentences
- `replan_goal()` — Generate new sub-goal when current one stalls
- `generate_world_event()` — Break repetition loops with world-consistent events
- `enrich_entity()` — Generate rich descriptions from event history
- `generate_seed_draft()` — Create complete WorldSeed from conversation

### prompts.py — Text Adapter
Converts structured data into natural language prompts. This is the **text modality adapter** — replacing it with a different adapter enables non-text modalities.

### db.py — Persistence (0 internal dependencies)
Async SQLite via aiosqlite. Pure persistence, no business logic.

Tables: `sessions`, `agent_states`, `events`, `agent_memories`, `narrator_messages`, `timeline_nodes`, `world_snapshots`, `entity_details`, `saved_seeds`

### clock.py — Time Simulation
Converts tick numbers into narrative time (day/night cycle, periods, display strings).

## Data Flow

### Agent Decision (per tick)

```
Session state
    │
    ├── get_visible_agents()
    ├── retrieve_relevant_memories()      ← DB query
    ├── get_relevant_events()             ← DB query
    ├── get_agent_beliefs()               ← DB query
    │
    └──► _build_context()
              │
              └──► AgentContext
                      │
                      └──► decision_source.decide()
                                │
                                └──► ActionOutput
                                        │
                                        ├──► validate_action()
                                        │         │ errors? retry
                                        │
                                        ├──► apply_action()
                                        │         │ state mutation
                                        │
                                        ├──► Event (result + structured)
                                        │
                                        ├──► create_memory_from_event()
                                        │
                                        ├──► _update_relations()
                                        │
                                        └──► _update_goals()
```

### Memory Lifecycle

```
Event → MemoryEntry (episodic, importance-scored)
  │
  ├── [every epoch_interval ticks]
  │     consolidate_memories()
  │       │ group by agent tag
  │       │ protect importance >= 0.8
  │       └──► semantic summary (LLM or fallback concat)
  │
  └── [every belief_interval ticks]
        extract_beliefs()
          │ scan relations → "X is dangerous"
          │ scan trade patterns → "X is reliable partner"
          └──► belief memories (category="belief")
```

### Goal Lifecycle

```
AgentSeed.goals[0] → GoalState(status="active", progress=0.0)
  │
  ├── _event_advances_goal() → True
  │     progress += 0.15
  │     stall_count = 0
  │
  ├── _event_advances_goal() → False
  │     stall_count += 1
  │
  ├── progress >= 0.95
  │     status = "completed"
  │     → _select_next_goal() (round-robin)
  │
  └── stall_count >= 5
        status = "stalled"
        → replan_goal() (LLM) or _select_next_goal() (fallback)
```

## Extension Points

| What | Where | How |
|------|-------|-----|
| Agent brain | `decision.py` | Implement `DecisionSource` protocol |
| Action types | `models.py` + `validator.py` | Add to `ActionType` enum + validation rules |
| Memory retrieval | `memory.py` | Replace `_score_memory()` or `retrieve_relevant_memories()` |
| Memory consolidation | `memory.py` | Replace `consolidate_memories()` |
| Social dynamics | `engine.py` | Override `_update_relations()` |
| Goal advancement | `engine.py` | Override `_event_advances_goal()` |
| Time model | `clock.py` | Modify `world_time()` |
| Presentation | `prompts.py` | Replace with non-text adapter |
| Persistence | `db.py` | Swap SQLite for another backend |

## Frontend Architecture

```
app/
  page.tsx        → Home (seed browser, session list)
  sim/page.tsx    → Simulation dashboard (state machine)
  create/page.tsx → World creator
  assets/page.tsx → Asset library

components/
  EventFeed     — Real-time event log
  AssetPanel    — Agent/item/location panels with goals, relations, beliefs
  OracleDrawer  — Narrator interface (narrate + create modes)
  ControlBar    — Run/Pause/Step controls
  WorldRadar    — Canvas agent/location visualization

lib/
  api.ts          — REST + WebSocket client
  locale-context  — i18n provider (CN/EN)
  i18n.ts         — 250+ translation keys

design/
  tokens.css         — CSS custom properties
  tailwind.preset.js — Theme (void-black, lime accent, zero radius)
  base.css           — Reset + typography
  animations.css     — Keyframe definitions
```

State flows through WebSocket: `connected → event → tick → state_update → stopped`

## Testing

188 backend tests across 7 files:

| File | Coverage |
|------|----------|
| `test_world_authority.py` | Validator, relations, topology, inventory |
| `test_memory_v2.py` | Importance scoring, beliefs, consolidation |
| `test_goals.py` | GoalState lifecycle, progress, replanning |
| `test_world_kernel.py` | DecisionSource, structured events, semantic memory, Oracle |
| `test_stability.py` | 100-tick stability (item conservation, relations, memory, goals) |
| `test_human_decision.py` | HumanDecisionSource protocol, control, timeout, engine integration |
| `test_robustness.py` | Seed validation, self-interaction blocking, dead agents, concurrency, DB/WS safety |

Run: `cd backend && .venv/bin/python -m pytest tests/ -v`
