# BABEL Architecture

## Design Philosophy

BABEL is **agent spacetime** — a causal substrate where AI agents are embedded, not observing.

> **Seed（compressed rules）× Physics（causal laws）× Time（irreversible unfolding）× Agent（negative entropy）= Emergent Intelligence**

### Core Belief

**Intelligence is not designed — it is forced by causality.** Given minimal rules and irreversible time, complexity — including intelligence — is inevitable emergence. Not possible. Inevitable.

The architecture follows this belief:

1. **The engine is a pure causal kernel** — It knows nothing about LLMs, text, memory, or narrative. It only enforces: tick → perceive → decide → validate → apply → physics → event
2. **The medium is a replaceable adapter** — Text worlds driven by LLMs are today's hooks. Tomorrow: VR, digital spacetime, four-dimensional manifolds. The engine stays the same
3. **Output is state, not language** — The world model produces state changes. Narrative is an observer's projection
4. **Don't design results, design conditions** — Never design agent behavior. Design the world's physics. Behavior emerges from survival under constraint

### Engineering Principles

5. **World continuity is a first-class invariant** — Characters, relations, intent, memory, and timeline survive across ticks and branches
6. **Seeds are the canonical generative boundary** — A seed is compressed rules. Runtime state is a seed after time has acted on it
7. **Structured data alongside human text** — Every event has both `result` (text) and `structured` (machine-readable), enabling any renderer

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  L3  PRODUCT SHELL                                              │
│      Next.js 14 · Tailwind · WebSocket                          │
│      FastAPI: api.py (127) + state.py (336) + 7 routers         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L2  MEDIUM ADAPTER  (hooks.py — today: text worlds)            │
│      EngineHooks protocol:                                      │
│        before_turn()   — perturbation, goal init                │
│        build_context() — memory, beliefs, relations → prompt    │
│        after_event()   — memory, goals, relations, significance │
│        after_tick()    — timeline, chapters, consolidation      │
│                                                                 │
│      DefaultEngineHooks = full text-world adapter               │
│      NullHooks         = pure causal testing, zero decoration   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L1  PHYSICS  (physics.py)                                      │
│      WorldPhysics protocol — engine-enforced world laws         │
│        conservation: trade transfers, never copies              │
│        entropy: use_item destroys, never restores               │
│        cost: move consumes resource (selection pressure)        │
│        regeneration: locations spawn resources over time         │
│      AgentPhysics protocol — engine-enforced agent laws         │
│        conservation: energy is finite, actions cost energy      │
│        entropy: acting against personality accumulates stress   │
│        cost: changing direction costs momentum (willpower)      │
│        regeneration: rest restores energy, social reduces stress│
│      Together: complete causal constraint set                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  L0  CAUSAL KERNEL  (engine.py — ~370 lines, 0 LLM deps)       │
│      tick() → for each agent:                                   │
│        hooks.before_turn()                                      │
│        ctx = hooks.build_context()                              │
│        ctx += agent_physics.pre_decide(agent)                   │
│        action = decision_source.decide(ctx)                     │
│        response = _propose(action)                              │
│        errors = world_authority.validate(response)              │
│        summary = world_authority.apply(response)                │
│        effects = world_physics.enforce(action)                  │
│        effects += agent_physics.post_event(action)              │
│        event = _make_event(response, summary)                   │
│        hooks.after_event(event)                                 │
│      agent_physics.tick_effects(agent) per agent                │
│      world_physics.tick_effects() → regeneration events         │
│      hooks.after_tick(all_events)                               │
│                                                                 │
│      Four causal protocols:                                     │
│        DecisionSource  — how agents decide                      │
│        WorldAuthority  — what's legal + how it mutates state    │
│        WorldPhysics    — engine-enforced world consequences     │
│        AgentPhysics    — engine-enforced agent consequences     │
└──────┬──────────┬──────────┬──────────┬───────────────────────┘
       │          │          │          │
  ┌────┴────┐ ┌───┴────┐ ┌───┴─────┐ ┌─┴────────┐
  │Decision │ │World   │ │ World   │ │ Agent    │
  │ Source  │ │Authority│ │ Physics │ │ Physics  │
  └─────────┘ └────────┘ └─────────┘ └──────────┘
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
| `AgentState` | Agent runtime (location, inventory, goals) |
| `GoalState` | Trackable goal with progress and stall detection |
| `Relation` | Directional agent-to-agent relationship |
| `Event` | Action record with `result` (text), `structured` (data), and canonical `significance` |
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
  ├── LLMDecisionSource            — thin orchestrator for the default 3-stage brain
  ├── ExternalDecisionSource       — SDK agent gateway (perceive/act via _Turn)
  ├── HumanDecisionSource          — waits for human input via API (decorator pattern)
  ├── ContextAwareDecisionSource   — context-driven actions for stability testing
  ├── PsycheDecisionSource         — Psyche emotional engine (HTTP bridge + autonomic gating)
  ├── PsycheAugmentedDecisionSource — Psyche augments LLM (emotional context + autonomic gating)
  ├── ScriptedDecisionSource       — deterministic testing
  └── [your source here]           — other AI, RL agent, etc.
```

### ExternalDecisionSource — Agent Gateway
The `_Turn` abstraction: one decision cycle, context in, action out. Two asyncio primitives (Event + Future).

```
Engine.tick()
  └─ decide(ctx)           ← blocks, creates _Turn
                                  ↓
SDK Agent:                  perceive()  ← long-polls until _Turn exists
  brain decides...
                            act(action) ← resolves _Turn.future
                                  ↓
  └─ returns ActionOutput   ← engine continues
```

### client.py — BabelAgent
Async context manager + async iterator for SDK agents:

```python
async with BabelAgent(url, session_id, agent_id) as agent:
    async for world in agent:   # perceive
        await agent.act(...)    # act
```

```
LLMDecisionSource
  ├── DefaultDecisionContextPolicy
  ├── LLMDecisionModel
  └── PassthroughActionCritic
```

`AgentContext` is the modality-agnostic interface between world and brain. It contains everything an agent can perceive: visible agents, memories, beliefs, relations, reachable locations, goals, world rules, time.

### hooks.py — Medium Adapter (EngineHooks)
The boundary between the timeless causal core and the current medium.

The `EngineHooks` protocol defines 4 lifecycle callbacks:

| Hook | When | What |
|------|------|------|
| `before_turn(engine, agent)` | Before each agent's turn | Perturbation, goal init |
| `build_context(engine, agent)` | Perception phase | Memory, beliefs, relations → AgentContext |
| `after_event(engine, agent, event, response)` | After valid action applied | Memory creation, goal/relation mutation, significance |
| `after_tick(engine, tick_events)` | After all agents acted | Timeline, chapters, consolidation, enrichment |

Implementations:
- `NullHooks` — No-op. Engine runs as pure causal machine. Used for testing
- `DefaultEngineHooks` — Full text-world adapter (memory, goals, relations, chapters, timeline, enrichment). Uses policy classes from `policies.py` internally

**How to change the medium:**
1. Implement `EngineHooks` (4 async methods)
2. Pass to `Engine(session, hooks=your_hooks)`

**How to add a new decision source:**
1. Implement `async def decide(self, context: AgentContext) -> ActionOutput`
2. Pass to `Engine(session, decision_source=your_source)`

### policies.py — Domain Policies (Social + Goals)
Used internally by `DefaultEngineHooks`. Not directly wired to the engine.

Four policy classes: `DefaultSocialProjectionPolicy`, `DefaultSocialMutationPolicy`, `DefaultGoalProjectionPolicy`, `DefaultGoalMutationPolicy`

These are reusable domain logic that hooks compose internally. The 7 redundant policy classes (Pressure, Perception, Resolution, Proposal, Timeline, Memory, Enrichment) were eliminated — their behavior lives directly in hooks.py.

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

1. **Episodic** — Raw event memories scored from canonical `Event.significance` + agent-subjective boosts (self-relevance, goal alignment, relationship strength)
2. **Semantic** — Consolidated summaries (LLM or rule-based compression)
3. **Belief** — High-level conclusions from experience (rule-driven extraction)

Importance scoring is single-sourced: `significance.py` owns the world-objective score; `memory.py` adds agent-subjective boosts on top. No parallel scoring systems.

Key functions:
- `create_memory_from_event()` — Event → MemoryEntry with importance derived from significance score + agent boosts
- `retrieve_relevant_memories()` — Scored retrieval by recency, importance, and tag relevance
- `consolidate_memories()` — Compress old episodic memories into semantic summaries
- `extract_beliefs()` — Derive beliefs from relations and event patterns

### engine.py — Pure Causal Kernel (~370 lines)
The engine is a causal loop. Nothing else. It does not know about LLMs, text, memory, chapters, or any medium.

Four causal protocols define the laws:
- `DecisionSource` — how agents decide (LLM, rule-based, human, external SDK)
- `WorldAuthority` — what actions are legal + how they mutate state
- `WorldPhysics` — engine-enforced world consequences (conservation, entropy)
- `AgentPhysics` — engine-enforced agent consequences (energy, stress, momentum)

One hooks object handles everything else:
- `EngineHooks` — perception enrichment, post-event processing, post-tick processing

Key design decisions:
- **Zero LLM imports** — Engine has no dependency on llm.py, prompts.py, memory.py, or db.py
- **Medium-agnostic** — Swap `hooks=DefaultEngineHooks()` for any other adapter
- **Clean API** — `start()`, `pause()`, `stop()`, `configure()`, `inject_urgent_event()`

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

### api.py + state.py + routes/ — Product Shell

The product layer is decomposed into clean modules:

| Module | Lines | Purpose |
|--------|-------|---------|
| `api.py` | 127 | Thin shell: app, middleware, lifespan, WebSocket, router mounting |
| `state.py` | 336 | Shared state: engine cache, locks, WebSocket pool, serialization, helpers |
| `routes/seeds.py` | 248 | Seed library CRUD (list, detail, update, delete) |
| `routes/worlds.py` | 616 | World lifecycle (create, run, step, pause, inject, command) |
| `routes/agents.py` | 244 | Human control + external SDK gateway |
| `routes/oracle.py` | 269 | Oracle narrator + agent chat + oracle draft |
| `routes/assets.py` | 402 | Asset library + seed extraction (agent, item, location, event, world) |
| `routes/timeline.py` | 217 | Timeline, replay, fork, report, memories |
| `routes/enrichment.py` | 179 | Progressive entity detail enrichment |

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
  └── stall_count >= 5
        status = "stalled"
        → replan_goal() (LLM, drive-aware) or _select_next_goal() (fallback)
```

## World Physics — Engine-Enforced Causal Laws

`babel/physics.py` — the `WorldPhysics` protocol enforces causal constraints that create selection pressure. Per-action enforcement runs AFTER `WorldAuthority.apply()`. Per-tick effects (regeneration) run after all agents act.

```
Per action:  validate → apply(state_changes) → physics.enforce(action) → event
Per tick:    all agents done → physics.tick_effects() → hooks.after_tick()
```

### Four Laws

| Law | Action | Engine Effect | Status |
|-----|--------|---------------|--------|
| **Conservation** | TRADE | Remove item from actor, add to target | ✓ Proven |
| **Irreversibility** | USE_ITEM | Destroy item from inventory | ✓ Proven |
| **Cost** | MOVE | Consume resource from inventory (selection pressure) | ✓ Proven |
| **Regeneration** | per-tick | Locations spawn resources from seed definition | ✓ Proven |

OBSERVE at a location with ground items → physics picks up one item (resource flow: regeneration → ground → observe → inventory → use/trade → consumed).

### Protocol

```python
class WorldPhysics(Protocol):
    def enforce(self, action, agent, session) -> list[str]: ...
    def tick_effects(self, session) -> list[str]: ...
```

Implementations:
- `DefaultWorldPhysics` — all four laws, controlled per-seed via PhysicsConfig
- `NoPhysics` — null implementation for backward compatibility

### PhysicsConfig (declared in seed)

```python
class PhysicsConfig(BaseModel):
    conservation: bool = True           # trade transfers, never copies
    entropy: bool = True                # use_item destroys
    move_cost: str | None = None        # resource consumed on MOVE
    regeneration: bool = False          # locations spawn resources
    regeneration_interval: int = 5      # ticks between spawns
```

### LocationSeed.resources

Locations declare what they produce: `resources: ["herb", "wood"]`. Physics regeneration spawns from this list. Items appear as `session.location_items` (ground items), visible in agent context as `ground_items`.

## Agent Physics — Engine-Enforced Agent Laws

`babel/physics.py` — the `AgentPhysics` protocol gives agents "mass" — internal state that constrains and shapes behavior. WorldPhysics governs the world; AgentPhysics governs the agent. Together they form the complete causal constraint set.

### Four Laws (mirroring WorldPhysics)

| Law | Mechanism | Engine Effect |
|-----|-----------|---------------|
| **Conservation** | Energy is finite | Every action costs energy; exhaustion amplifies cost |
| **Entropy** | Personality friction | Acting against personality accumulates stress |
| **Cost** | Momentum resistance | Changing direction costs extra energy (willpower) |
| **Regeneration** | Passive recovery | Rest restores energy; social actions reduce stress |

### Protocol

```python
class AgentPhysics(Protocol):
    def pre_decide(self, agent, session) -> dict: ...      # internal state → context
    def post_event(self, action, agent, session) -> list[str]: ...  # action → state update
    def tick_effects(self, agent, session) -> list[str]: ...  # per-tick decay/recovery
```

Implementations:
- `DefaultAgentPhysics` — all four laws, personality-aware stress, second-order feedback
- `NoAgentPhysics` — null implementation (agents are weightless cursors)

### Internal State (AgentState.internal_state)

Medium-agnostic dict with default fields:
- `energy` (0.0-1.0) — fuel for action
- `stress` (0.0-1.0) — friction from fighting nature
- `momentum` (0.0-1.0) — tendency to repeat patterns
- `last_action` — previous action type

### Second-Order Emergence

The feedback loop: **behavior → state change → behavior change → state change**.

Example: a cautious agent forced to move repeatedly accumulates stress → stress above threshold triggers rest behavior → rest reduces stress → agent resumes exploring. Different personalities produce different trajectories from identical initial conditions.

This is proven by `test_second_order_emergence.py`: 50 ticks, zero LLM, state-aware decision source.

## Extension Points

| What | Where | How |
|------|-------|-----|
| **Entire medium** | `hooks.py` | Implement `EngineHooks` (4 methods) — replaces text world with any medium |
| Agent brain | `decision.py` | Implement `DecisionSource` protocol |
| External agent | `decision.py` | Use `ExternalDecisionSource` (perceive/act) |
| SDK client | `client.py` | Use `BabelAgent` context manager |
| Hard world rules | `validator.py` | Implement `WorldAuthority` |
| World physics | `physics.py` | Implement `WorldPhysics` (or use `NoPhysics`) |
| Agent physics | `physics.py` | Implement `AgentPhysics` (or use `NoAgentPhysics`) |
| Context shaping | `decision.py` | Implement `DecisionContextPolicy` |
| Model bridge | `decision.py` | Implement `DecisionModel` |
| Action review | `decision.py` | Implement `ActionCritic` |
| Action types | `models.py` + `validator.py` | Add to `ActionType` enum + validation rules |
| Time model | `clock.py` | Modify `world_time()` |
| Persistence | `db.py` | Swap SQLite for another backend |

## Frontend Architecture

```
app/
  page.tsx        → Home (seed browser, session list)
  sim/page.tsx    → Simulation dashboard (state machine)
  report/page.tsx → Shareable world report (?session=<id>)
  create/page.tsx → World creator
  assets/page.tsx → Asset library

components/
  EventFeed      — Real-time event log with significance axes, durable markers, and Highlights filter
  AssetPanel     — Agent/item/location panels with goals, relations, beliefs
  OracleDrawer   — Narrator interface (narrate + create modes)
  ControlBar     — Run/Pause/Step + 4 intervention verbs (OBSERVE/NUDGE/DIRECT/FORK)
  InjectEvent    — NUDGE input bar (event injection)
  WorldReport    — Full-viewport report overlay (significance aggregation, agent arcs, social dynamics)
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

### Intervention Model — 4 Verbs

All user intervention into a live world maps to exactly 4 verbs:

| Verb | UI Entry | Backend API | Description |
|------|----------|-------------|-------------|
| **OBSERVE** | Oracle drawer, Agent chat | `POST /oracle`, `POST /chat`, `GET /memories` | Read-only observation — does not alter world state |
| **NUDGE** | InjectEvent bar | `POST /inject` + auto `POST /step` | Insert a world event; agents react on next tick |
| **DIRECT** | Agent panel CONTROL button | `POST /take-control`, `POST /human-action`, `POST /release-control` | Assume an agent's decision-making |
| **FORK** | ControlBar FORK button | `POST /fork` | Branch timeline from snapshot — backend + frontend wired |

ControlBar groups these 4 verbs in a unified button strip. FORK renders conditionally (only when `onFork` handler is provided).

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

~540 backend tests across 19 files:

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
| `test_report.py` | World report generator: structure, counts, axes, milestones, agent arcs, social highlights |
| `test_fork.py` | Fork endpoint: snapshot reconstruction, seed lineage, relation copy, error cases |
| `test_external_decision.py` | ExternalDecisionSource protocol, Turn cycle, timeout, disconnect, fallback |
| `test_external_e2e.py` | Full API integration: connect, perceive, act, disconnect, multi-tick |
| `test_mvu.py` | MVU 100-tick proof: external agent, action variety, location traversal, emotional feedback |
| `test_agent_physics.py` | AgentPhysics: 4 laws (energy, stress, momentum, recovery), protocol compliance, second-order effects |
| `test_second_order_emergence.py` | 50-tick feedback loop proof: behavior→state→behavior, personality differentiation, control test |
| `benchmark_scorecard.py` | 100-tick x 3 seeds benchmark (goal/relation/significance/entropy metrics) |

Run: `cd backend && python -m pytest tests/ -v`
