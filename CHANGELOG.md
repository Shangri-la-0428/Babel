# Changelog

All notable changes to BABEL.

## [Unreleased]

### FORK Backend (Timeline Branching)

- `POST /api/worlds/{session_id}/fork` — create new session from snapshot at target tick
- Reconstructs WorldSeed + AgentState from nearest snapshot, copies relations
- SeedLineage links forked session to parent (source_seed_ref, snapshot_id, branch_id)
- Frontend: `forkWorld()` API client + `handleFork` handler navigates to forked session
- 5 new tests in `test_fork.py`, 442 total passing

### World Report + Publishing + Simplification (Tranche 4b + 5)

**World Report** — significance-driven retrospective, zero LLM calls:
- `report.py`: pure-function report generator aggregating DB events + live session state
- Agent arcs, social dynamics, milestones, axis/action distribution, signal ratio
- `GET /api/worlds/{session_id}/report` endpoint
- `WorldReport.tsx`: full-viewport overlay (Overview, Milestones, Agent Arcs, Social, Axes)
- ControlBar: REPORT toggle button with active glow state
- `/report?session=<id>` — shareable standalone report page

**Architecture simplification** — net deletion, fewer abstractions:
- Deleted `DecisionRequest` + `DefaultDecisionContextPolicy` — shadow types replaced by direct `AgentContext` passthrough
- Deleted `CombinedSocialPolicy` + `CombinedGoalPolicy` + `resolve_*_policies()` — pure-forwarding wrappers, engine now uses projection/mutation directly
- Deleted `SocialPolicy` + `GoalPolicy` combined protocol types
- Deleted `AgentState.memory` field + `update_agent_memory()` — deprecated legacy, never populated
- Deleted `ActionPicker.tsx` — unused component (259 lines)
- Simplified `_event_dict()` — removed 12 hasattr guards, replaced with `model_dump()`
- 25 new i18n keys (CN/EN) for report UI
- 9 new backend tests (`test_report.py`), 439 total passing

### Intervention Unification (Tranche 3)

**4-verb intervention model** — all user intervention mapped to OBSERVE / NUDGE / DIRECT / FORK:
- ControlBar: unified intervention button strip with 4 verb entries
- OBSERVE button toggles Oracle drawer, shows info glow when active
- NUDGE button focuses InjectEvent input bar (`#nudge-input`)
- DIRECT button scrolls to agent panel, shows warning glow when agents are human-controlled
- FORK button conditionally rendered (backend API planned)
- InjectEvent label changed from `// INJECT` to `// NUDGE`
- Backend API section comments aligned to verb names (OBSERVE/NUDGE/DIRECT)
- ARCHITECTURE.md documents 4-verb → API endpoint mapping table
- 4 new i18n keys: `verb_observe`, `verb_nudge`, `verb_direct`, `verb_fork`

### Inspectable Continuity + Quality Baseline (Tranche 2 + 4a)

**Agent intent visibility** — GoalState rich data now surfaces in the UI:
- Active goal section shows strategy, next step, and blockers (warning badges)
- TypeScript `ActiveGoal` interface extended with `strategy`, `next_step`, `success_criteria`, `blockers`, `last_progress_reason`, `drive_affinities`

**Relation deep metrics** — trust/tension sub-metrics visible under each relation:
- TypeScript `RelationData` interface extended with `trust`, `tension`, `familiarity`, `debt_balance`, `leverage`, `last_interaction`
- Relation strength deltas tracked between ticks with +/- indicators (green/red)
- Trust and tension shown as mini progress bars when available

**Design system audit & fixes** (28 components audited):
- Removed 2 `rounded-full` violations (ControlBar ping, sim shockwave ring)
- Standardized all badge padding to `px-2.5 py-0.5` per design system
- Added `font-medium` to 7 secondary buttons that were missing it
- Fixed `disabled:opacity-40` → `disabled:opacity-30` across 26 instances in 14 files
- Added shared `SectionLabel` and `SecondaryButton` components to `ui.tsx`
- Fixed holder badge from `border-info/40` opacity to solid `border-info`

**Benchmark scorecard** — `tests/benchmark_scorecard.py`:
- Runs 100-tick simulations on 3 seeds (cyber_bar, apocalypse, iron_throne)
- Metrics: goal completion/stall rate, relation volatility, significance axis distribution, durable event ratio, action entropy
- Comparative summary table across all seeds
- Zero LLM calls (ContextAwareDecisionSource), runnable as standalone script

### Significance Unification (Tranche 1)

**Unified scoring backbone** — `significance.py` is now the single canonical source of event importance:
- Removed circular dependency: `assess_event_significance()` no longer reads `event.importance` back from its own output
- `memory._compute_importance()` derives from `Event.significance.score` + agent-subjective boosts (self-relevance +0.15, involvement +0.1, goal alignment +0.2, relationship +0.15)
- Removed duplicate `IMPORTANCE_MAP` from `memory.py`; `BASE_EVENT_IMPORTANCE` lives only in `significance.py`

**Unified memory path** — all production paths now use structured memory:
- `api.py` chat endpoint uses `retrieve_relevant_memories()` + `get_agent_beliefs()` instead of legacy `agent.memory` list
- `api.py` oracle endpoint no longer sends raw `agent.memory` to narrator
- `engine._replan_goal()` uses `retrieve_relevant_memories()` instead of `agent.memory[-5:]`
- `api.py` inject endpoints no longer call `update_agent_memory()`
- `AgentState.memory` field is effectively deprecated (kept for DB serialization)

**Engine shim cleanup** — removed 4 unused backward-compatible methods:
- Removed `_update_relations()`, `_check_drive_shift()`, `_summarize_tick()`, `_passive_enrichment()`
- Remaining test-facing facades (`_update_goals`, `_event_advances_goal`, `_select_next_goal`, `_build_context`) documented as test API

**Frontend significance visibility**:
- EventFeed now displays significance axis tags (goal/social/state/resource/world/info/ambient)
- Durable events get a `DURABLE` badge and stronger primary-colored left accent
- "KEY" toggle button in event feed header filters to significant events only (`durable || score >= 0.7`)
- 8 new i18n keys (CN/EN) for significance UI

### CI Maintenance
- Upgraded GitHub Actions to Node 24 compatible versions: `actions/checkout@v5`, `actions/setup-python@v6`, `actions/setup-node@v5`
- Workflow file changes now trigger their own backend/frontend CI runs, so pipeline edits are immediately verifiable

### Phase 14: Portal Transformation + Overdrive + Performance

**Portal Transformation** — 47 UI items across 5 batches, making the sim page feel like a portal into another reality:
- World boot scan overlay (full-viewport sweep on run start), world ended overlay (danger scan + glitch text)
- Tick sweep animation on latest tick divider, digit cascade for tick counter
- CRT scanline overlay (`.scanlines`) with flicker animation
- Stagger entrance system (`.stagger-in`, up to 9 children with 40ms offsets)
- Event flash animations (lime for normal, danger for world events, CRT glitch for world events)
- Seed detail spatial entry/exit animations
- Oracle edge scan light (`@property --oracle-scan-y`, CSS Houdini animated gradient)
- Accordion grid collapse with CSS grid-template-rows transition
- Ambient personality: idle messages cycle, void-breathe body animation, hover-glow system
- `AmbientVoid` — global floating particle canvas behind all pages
- `WorldBootOverlay` — boot sequence animation component

**Overdrive A: WebGL Depth Parallax** — `WorldShader` component:
- WebGL2 fragment shader: 5-octave FBM noise, 3 parallax depth layers, mouse-reactive
- Day/night palette shift (warm amber ↔ cool blue), energy response, event ripple pulse
- Half-resolution rendering at ~30fps, `powerPreference: "low-power"`

**Overdrive B: Reactive Atmosphere** — state-driven visual layer:
- Tension vignette — red radial gradient at viewport edges when agents die (opacity = dead/total ratio)
- Shader ripple — momentary brightness pulse on new events (600ms decay)
- Night mode detection from world time, energy boost when running

**Overdrive C: Spring Physics** — `lib/spring.ts`:
- `useSpring` hook: mass-spring-damper solver (tension, friction, mass, precision)
- Render throttle: skip setState when delta < 0.005 (reduces re-renders by ~80%)
- `prefers-reduced-motion` instant-snap, configurable `from` initial value
- Applied to Modal open/close (bouncy open, snappy close, spring-driven exit detection)

**Performance Optimization** — 12 targeted fixes from comprehensive audit:
- **`lib/raf.ts`** (new) — Shared RAF scheduler: single `requestAnimationFrame` loop for all canvas components (WorldShader, ParticleField, WorldRadar). Reduces per-frame overhead from N rAF registrations to 1
- **WorldShader DPR fix** — `Math.min(dpr * 0.5, 1)` on 2x Retina = no downsampling; fixed to `Math.floor(clientWidth * 0.5)` for true half-res
- **Spring render throttle** — `lastRendered` ref skips `setValue()` when delta < 0.005 threshold
- **ParticleField O(1) removal** — Replaced `Array.splice(i, 1)` with swap-and-pop pattern; cap enforcement via `ps.length = CAP - 50`
- **WorldRadar layout cache** — Position map recomputed only on resize/location-count change, not every frame
- **WorldRadar idle throttle** — ~15fps when paused (66ms interval), 60fps when running
- **WorldRadar pulse swap-and-pop** — O(1) pulse removal replacing O(n) splice
- **Scanline containment** — `contain: strict` on `.scanlines::before/::after` pseudo-elements
- **Glow blur reduction** — `pulse-glow` box-shadow reduced from `24px 6px` to `8px 2px`
- **DecodeText array join** — Replaced O(n²) string concatenation with `chars.push()` + `join("")`
- **EventFeed content-visibility** — `content-visibility: auto` on tick group divs for off-screen rendering skip
- **Highlight timer self-cleaning Set** — `highlightTimers` changed from growing array to self-cleaning `Set`

### Phase 13: Psyche Phase B — Drive-Goal Mapping + Augmented Decision Source
- **`PsycheAugmentedDecisionSource`** — New DecisionSource that uses Psyche to enrich LLM context (emotional state, drives) rather than replacing it. Autonomic gating as post-filter: dorsal-vagal=freeze, sympathetic=flight, ventral-vagal=pass-through
- **`drive_mapping.py`** (new) — Pure-function drive-goal affinity inference via keyword classification (bilingual CN/EN). 5 Maslow drives × bilingual keyword sets
- **Drive-weighted goal selection** — `_select_next_goal` scores goals by inverse drive satisfaction; depleted drives prioritize goals that address them
- **Drive-shift replanning** — >30% drive shift triggers goal reconsideration via `_check_drive_shift`
- **Emotional context injection** — `[Your Emotional State]` section in LLM prompt when Psyche is active (emotional descriptors from chemicals + autonomic state)
- **`replan_goal` drive-awareness** — Stalled goal replanning now includes unsatisfied/satisfied drive context
- **`stimulus.py` enhancement** — Drive state context (low drives < 40) included in stimulus text
- **Model extensions** — `GoalState.drive_affinities`, `AgentContext.emotional_context`, `AgentContext.drive_state` (all with defaults, zero breaking changes)
- 27 new tests: `test_drive_mapping.py` (20 tests: affinity inference, scoring, weighted selection) + `test_psyche_bridge.py` augmented source tests (7 tests: LLM delegation, emotional context injection, autonomic gating, fallback, protocol conformance)
- 360 total tests passing

### Phase 12: GitHub Actions CI/CD
- Backend workflow: pytest 302+ tests on Python 3.11/3.12
- Frontend workflow: `npm run build` (type check) + `npm run lint`
- CI badges added to README

### Phase 11: Psyche Bridge Integration
- **`psyche_bridge.py`** — Async HTTP client for Psyche emotional engine (processInput/processOutput/getState)
- **`stimulus.py`** — StimulusSynthesizer: maps AgentContext to natural-language stimulus for Psyche classification
- **`PsycheDecisionSource`** — New DecisionSource implementation: emotional state → weighted action selection with autonomic gating (ventral-vagal/sympathetic/dorsal-vagal)
- **Frontend**: Agent panel shows Psyche emotional state (neurochemistry bars, autonomic badge, dominant emotion, drives) when Psyche is active
- **API**: `_serialize_state` includes Psyche snapshot when PsycheDecisionSource is in use
- 14 i18n keys for Psyche UI (chemicals, autonomic states, drives)
- 31 new tests (`test_psyche_bridge.py`): mock HTTP server, bridge client, stimulus synthesis, decision source behavior, autonomic gating
- 333 total tests passing

### Phase 10: Robustness Hardening
- **Concurrency safety**: `asyncio.Lock` per-session + global lock for `_engines` dict — protects inject, take-control, step, tick from race conditions
- **Seed validation**: `validate_seed()` — rejects duplicate agent IDs, duplicate locations, agents at nonexistent locations, empty seeds. Called in `create_world` and `create_from_seed`
- **Self-interaction blocking**: SPEAK/TRADE with yourself now returns validation error
- **Engine safety**: all-agents-dead tick returns immediately; outer try-except in `_resolve_agent_action` prevents any exception from crashing a tick
- **DB safety**: `delete_session` wrapped in explicit transaction for atomicity; narrator message UUIDs lengthened to full 32-char hex
- **WebSocket hardening**: malformed JSON in WebSocket handler no longer crashes; broadcast copies client set before iteration
- 20 new robustness tests (`test_robustness.py`), 188 total passing

### Phase 10b: Test Coverage Hardening
- **API integration tests** (`test_api_integration.py`, 59 tests) — full HTTP endpoint coverage via httpx AsyncClient: CRUD, inject, human control, assets, 404 errors, multi-step composite flows
- **DB roundtrip tests** (`test_db_roundtrip.py`, 28 tests) — save/load for all 8 DB tables, cascade delete, pagination, filtering, migration idempotency
- **Engine lifecycle tests** (`test_engine_lifecycle.py`, 27 tests) — start/stop/pause, tick mechanics, dead agent filtering, event callbacks, urgent events, decision source switching, error recovery fallback
- **Bug fix**: `_event_dict()` now serializes `structured`, `location`, `importance` fields (Phase 4 data was invisible to frontend)
- 302 total tests passing

### Phase 9: Psyche Integration Assessment
- Technical assessment document (`backend/docs/PSYCHE_ASSESSMENT.md`)
- Mapped Psyche virtual endocrine (6 hormones), innate drives (5 Maslow levels), autonomic states to BABEL interfaces
- Designed `PsycheDecisionSource` architecture: stimulus synthesis → HTTP bridge → weighted action pool
- Conclusion: integration feasible, HTTP bridge as next step, no engine changes needed

### Phase 8: Human Decision Source + "Play as Agent" Mode
- `HumanDecisionSource` — decorator pattern wrapping any DecisionSource, routes human-controlled agents to wait for API input
- API endpoints: `POST take-control/{agent_id}`, `POST release-control/{agent_id}`, `POST human-action`, `GET human-status`
- WebSocket broadcasts: `waiting_for_human` (with full agent context), `human_control` (on/off)
- Timeout + cancel handling, fallback delegation, auto-unwrap on last release
- Frontend `ActionPicker` component — context strip (location, inventory, nearby, reachable) + 6-action grid + target/content inputs
- Agent panel: CONTROL/RELEASE button per agent, HUMAN badge when controlled
- 20+ new i18n keys (CN/EN) for human control
- 17 new backend tests, 168 total passing, frontend build clean

### Phase 7: 100-Tick Stability Test
- `ContextAwareDecisionSource` — smart decision source that picks context-appropriate actions (speak to visible, move when alone, trade when has items)
- 100-tick stability test harness (`test_stability.py`, 21 tests) — validates item conservation, relation evolution, memory, goals, structured data, no crashes

### Architecture
- **Engine always uses DecisionSource** — removed legacy dual-path; LLMDecisionSource is the default, not a special case
- **Clean Engine API boundary** — `engine.start()`, `engine.configure()`, `engine.inject_urgent_event()` replace direct field mutation
- **Configurable intervals** — snapshot, epoch, belief intervals are per-engine, not module constants

## [0.1.0] — 2026-03-24

### Phase 6: Oracle Creative Co-pilot
- Conversational world creation via Oracle `mode=create`
- `generate_seed_draft()` — LLM generates complete WorldSeed from natural language
- Seed validation (connections consistency, location references)
- Frontend: mode toggle (narrate/create), SeedCard preview, one-click world creation
- `ORACLE_CREATIVE_SYSTEM` prompt for structured seed generation

### Phase 5: Frontend Sync
- Agent goal progress bar (active goal, status badge, stall count)
- Dynamic relations panel (type badge, strength bar, color-coded)
- EventFeed relation change indicators (trade success/fail arrows)
- 30+ new i18n keys (CN/EN) for goals, beliefs, relations, oracle

### Phase 4: World Kernel Protocol
- `DecisionSource` protocol — pluggable agent decision interface
- `LLMDecisionSource` — wraps prompts.py + llm.py pipeline
- `ScriptedDecisionSource` — deterministic testing without LLM
- `AgentContext` — modality-agnostic world slice for decision-making
- `Event.structured` — machine-readable action records alongside human text
- `MemoryEntry.semantic` — structured metadata derived from events
- 10-tick scripted simulation test (zero LLM calls)

### Phase 3: Goal System
- `GoalState` model — status lifecycle (active/completed/stalled/failed)
- Progress tracking — rule-driven keyword matching against event results
- Stall detection — 5 consecutive non-advancing ticks trigger LLM replan
- `_select_next_goal()` — round-robin through core goals on completion
- Goal-aware prompts — active goal with progress, stall info in agent context

### Phase 2: Memory System v2
- Belief extraction — rule-driven (hostile relation = "dangerous", ally = "trusted")
- LLM semantic compression — `summarize_memories()` replaces string concatenation
- High-importance memory protection (>= 0.8 never compressed)
- Improved importance scoring — self-involvement, relation strength, resource changes
- Agent-grouped consolidation — memories about same entity compressed together

### Phase 1: World Authority Layer
- `Relation` model — directional, auto-classified (ally/trust/neutral/rival/hostile)
- Location topology — `connections` define adjacency, move validation enforced
- Inventory source validation — only TRADE/USE_ITEM can add items
- SPEAK/TRADE same-location requirement + hostile trade blocking
- Relation auto-update — SPEAK +0.05, TRADE success +0.1, failure -0.05
- Relations injected into agent prompts
- DB V6 migration (relations persistence)

### Foundation
- ORACLE omniscient narrator — side drawer, waveform visualizer, particle effects
- Simulation mechanics — pause/resume, urgent events, auto-agent detection, entity enrichment
- Design system — void-black, lime accent, zero border-radius, monospace-first, CRT overlay
- Seed asset system — extract/save agents, items, locations, events from simulations
- Agent chat — 1:1 conversation with any agent in the world
- Event injection — inject custom world events, agents react immediately
- Bilingual UI — CN/EN toggle, 250+ translation keys
- Docker deployment — compose with persistent SQLite volume
- Global `babel` command — one-step install, auto-browser-open
