# BABEL Architecture

## Design Philosophy

BABEL is a **modality-agnostic world model**. Text is the first interface, not the only one.

Product-wise, BABEL should be treated as a **live-world operating system**, not a pile of simulator features.

That means the architecture should optimize for:

- persistent world continuity over one-off outputs
- reusable protocols over page-specific cases
- clear instance/template boundaries
- multiple projection layers over duplicated product logic
- seed-based compression of domain concepts wherever possible

The architecture follows three principles:

1. **World logic has no I/O assumptions** — State machine + rules engine operate on pure data
2. **Every policy is pluggable** — Decision-making, memory consolidation, and social dynamics can be swapped without touching the kernel
3. **Structured data alongside human text** — Every event has both `result` (text) and `structured` (machine-readable), enabling any renderer

And four long-term engineering constraints:

4. **World continuity is a first-class invariant** — Characters, relations, intent, memory, and timeline state should survive across ticks and branches
5. **Projection layers consume one canonical world** — Home, sim, create, assets, and future publish surfaces should be different views of the same domain model
6. **Instances and templates remain distinct** — Runtime world entities are not the same thing as exported reusable assets
7. **Do not solve strategy with feature accretion** — Prefer new protocols, policies, or domain capabilities over isolated UI controls

And one simplifying abstraction:

8. **Seeds are the canonical generative boundary** — Anything that can be created, evolved, branched, reused, or published should prefer a `seed + time + intervention` model over a new bespoke object type

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
│     1.5 pressure_policy.before_agent_turn()                      │
│     2. decision_source.decide(ctx) → ActionOutput               │
│     3. validate_action() → errors or pass                       │
│     4. apply_action() → state mutation + Event                  │
│     5. create_memory_from_event()                               │
│     6. social_policy.apply() + goal_policy.update()             │
│                                                                 │
│   post_tick() → timeline node, snapshot, memory consolidation   │
└──────┬──────────┬───────────┬───────────┬────────────┬────────────┘
       │          │           │           │            │
  ┌────┴───┐ ┌───┴────┐ ┌────┴────┐ ┌────┴─────┐ ┌────┴──────┐
  │Decision│ │Validator│ │ Memory  │ │Persistence│ │ Policies │
  │ Source │ │        │ │         │ │           │ │ pressure /│
  │        │ │        │ │         │ │           │ │ goals /   │
  │        │ │        │ │         │ │           │ │ social    │
  └────────┘ └────────┘ └─────────┘ └───────────┘ └───────────┘
```

## Module Responsibilities

### models.py — Pure Data (0 dependencies)
Foundation layer. Pydantic models with no I/O.

Architecturally, `WorldSeed` should be read as the canonical pattern, not a special case:

- a seed is a compact generative specification
- runtime state is an unfolded seed
- export is reseeding evolved state for reuse elsewhere

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

The default LLM brain is now internally split into three replaceable stages:

- `DecisionContextPolicy`: project canonical `AgentContext` into a structured model request
- `DecisionModel`: turn that request into an `ActionOutput`
- `ActionCritic`: review or rewrite the action before it reaches the engine

This keeps the outer engine contract stable while making the inside of the brain composable.

```
DecisionSource (Protocol)
  ├── LLMDecisionSource           — thin orchestrator for the default 3-stage brain
  ├── HumanDecisionSource         — waits for human input via API (decorator pattern)
  ├── ContextAwareDecisionSource  — context-driven actions for stability testing
  ├── PsycheDecisionSource        — Psyche emotional engine (HTTP bridge + autonomic gating)
  ├── PsycheAugmentedDecisionSource — Psyche augments LLM (emotional context + autonomic gating)
  ├── ScriptedDecisionSource      — deterministic testing
  └── [your source here]          — other AI, RL agent, etc.
```

```
LLMDecisionSource
  ├── DefaultDecisionContextPolicy
  ├── LLMDecisionModel
  └── PassthroughActionCritic
```

`AgentContext` is the modality-agnostic interface between world and brain. It contains everything an agent can perceive: visible agents, memories, beliefs, relations, reachable locations, goals, world rules, time.

### policies.py — Pluggable World Dynamics
This is the second extension layer after decision-making. Policies answer:

- `pressure_policy`: what extra world pressure or perturbation appears before an agent acts
- `perception_policy`: how memories, beliefs, recent events, and world state become `AgentContext`
- `resolution_policy`: how invalid actions are repaired, retried, and finally downgraded
- `proposal_policy`: how an `ActionOutput` becomes a concrete state-change proposal
- `goal_projection_policy`: how active goal / intent continuity are projected into agent context
- `goal_mutation_policy`: how goals are initialized, evaluated, progressed, and replanned
- `social_projection_policy`: how relations are projected into prompts and agent context
- `social_mutation_policy`: how interactions mutate the social ledger after actions resolve
- `timeline_policy`: how a tick is summarized and when timeline nodes / snapshots are persisted
- `memory_policy`: when consolidation and belief extraction run
- `enrichment_policy`: how high-signal world details are passively enriched over time

Default implementations now hold most of the old engine-specific behavior. The engine orchestrates; policies decide the domain semantics.

`goal_policy` and `social_policy` still exist as legacy combined adapters for compatibility, but the preferred extension points are the explicit read/write pairs.

**How to add a new decision source:**
1. Implement `async def decide(self, context: AgentContext) -> ActionOutput`
2. Pass it to `Engine(session, decision_source=your_source)`

**How to customize the default LLM brain without replacing the whole source:**
1. Implement `DecisionContextPolicy`, `DecisionModel`, or `ActionCritic`
2. Pass them into `LLMDecisionSource(context_policy=..., decision_model=..., action_critic=...)`

**How to swap world dynamics:**
1. Implement the relevant policy protocol in `policies.py`
2. Pass it to `Engine(session, goal_projection_policy=..., goal_mutation_policy=..., social_projection_policy=..., social_mutation_policy=..., pressure_policy=..., perception_policy=..., resolution_policy=..., proposal_policy=...)`

### validator.py — World Authority
Hard world rules live here. The default authority still uses pure functions internally, but the engine now depends on the `WorldAuthority` protocol rather than direct helper calls.

- `validate_action(response, agent, session) -> list[str]` — Returns errors or empty list
- `apply_action(response, agent, session) -> str` — Mutates state, returns summary
- `DefaultWorldAuthority` — Default authority implementation used by the engine

This is the hard boundary after the brain layer:

- `ActionCritic` may reshape an action candidate
- `ProposalPolicy` turns that candidate into a concrete mutation proposal
- `WorldAuthority` decides whether that action is legal in this world
- only legal actions are applied to runtime state

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
  │     → _select_next_goal() (drive-weighted or round-robin)
  │
  ├── stall_count >= 5
  │     status = "stalled"
  │     → replan_goal() (LLM, drive-aware) or _select_next_goal() (fallback)
  │
  └── drive_shift > 30%
        → _check_drive_shift() reconsiders active goal via drive-weighted selection
```

## Extension Points

| What | Where | How |
|------|-------|-----|
| Agent brain | `decision.py` | Implement `DecisionSource` protocol |
| Context shaping | `decision.py` | Implement `DecisionContextPolicy` |
| Model bridge | `decision.py` | Implement `DecisionModel` |
| Action review | `decision.py` | Implement `ActionCritic` |
| Hard world rules | `validator.py` | Implement `WorldAuthority` |
| Action types | `models.py` + `validator.py` | Add to `ActionType` enum + validation rules |
| Memory retrieval | `memory.py` | Replace `_score_memory()` or `retrieve_relevant_memories()` |
| Memory consolidation | `memory.py` | Replace `consolidate_memories()` |
| Social dynamics | `policies.py` | Implement `SocialPolicy` |
| Goal advancement | `policies.py` | Implement `GoalPolicy` |
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
  EventFeed      — Real-time event log with content-visibility optimization
  AssetPanel     — Agent/item/location panels with goals, relations, beliefs
  OracleDrawer   — Narrator interface (narrate + create modes)
  ControlBar     — Run/Pause/Step controls
  WorldRadar     — Canvas radar visualization (layout-cached, idle-throttled)
  WorldShader    — WebGL2 procedural terrain (FBM noise, parallax depth, day/night)
  ParticleField  — Canvas particle system (status-reactive, event bursts)
  AmbientVoid    — Global floating particle background
  Modal          — Spring-physics animated modal (useSpring driven)

lib/
  api.ts           — REST + WebSocket client
  locale-context   — i18n provider (CN/EN)
  i18n.ts          — 330+ translation keys
  raf.ts           — Shared RAF scheduler (single loop for all canvas components)
  spring.ts        — Spring physics hook (mass-spring-damper solver)

design/
  tokens.css         — CSS custom properties
  tailwind.preset.js — Theme (void-black, lime accent, zero radius)
  base.css           — Reset + typography
  animations.css     — Keyframe definitions
```

### Canvas Rendering Architecture

All canvas components (WorldShader, ParticleField, WorldRadar) share a single `requestAnimationFrame` loop via `lib/raf.ts`. Each component subscribes a tick callback and manages its own frame throttling internally:

```
raf.ts (shared loop — 1 rAF registration)
  ├── WorldShader.loop()   — ~30fps (33ms throttle), WebGL2 draw
  ├── ParticleField.loop() — 60fps, Canvas 2D particles
  └── WorldRadar.loop()    — 60fps running / ~15fps idle, Canvas 2D radar
```

Performance patterns:
- **Swap-and-pop** — O(1) particle/pulse removal instead of Array.splice
- **Layout caching** — WorldRadar recomputes positions only on resize/location change
- **Render throttling** — Spring hook skips setState when value delta < 0.005
- **content-visibility** — EventFeed tick groups skip off-screen rendering

State flows through WebSocket: `connected → event → tick → state_update → stopped`

## Testing

360 backend tests across 12 files:

| File | Coverage |
|------|----------|
| `test_world_authority.py` | Validator, relations, topology, inventory |
| `test_memory_v2.py` | Importance scoring, beliefs, consolidation |
| `test_goals.py` | GoalState lifecycle, progress, replanning |
| `test_world_kernel.py` | DecisionSource, structured events, semantic memory, Oracle |
| `test_stability.py` | 100-tick stability (item conservation, relations, memory, goals) |
| `test_human_decision.py` | HumanDecisionSource protocol, control, timeout, engine integration |
| `test_robustness.py` | Seed validation, self-interaction blocking, dead agents, concurrency, DB/WS safety |
| `test_api_integration.py` | All API endpoints (CRUD, inject, human control, assets, 404 errors, composite flows) |
| `test_db_roundtrip.py` | Save/load roundtrip for all 8 DB tables, cascade delete, pagination, migration |
| `test_engine_lifecycle.py` | Start/stop/pause, tick mechanics, agent filtering, error recovery, decision source switching |
| `test_psyche_bridge.py` | Psyche HTTP bridge, stimulus synthesis, PsycheDecisionSource, PsycheAugmentedDecisionSource, autonomic gating |
| `test_drive_mapping.py` | Drive-goal affinity inference, drive-weighted scoring, goal selection |

Run: `cd backend && .venv/bin/python -m pytest tests/ -v`
