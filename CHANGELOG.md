# Changelog

All notable changes to BABEL.

## [Unreleased]

### Phase 10: Robustness Hardening
- **Concurrency safety**: `asyncio.Lock` per-session + global lock for `_engines` dict — protects inject, take-control, step, tick from race conditions
- **Seed validation**: `validate_seed()` — rejects duplicate agent IDs, duplicate locations, agents at nonexistent locations, empty seeds. Called in `create_world` and `create_from_seed`
- **Self-interaction blocking**: SPEAK/TRADE with yourself now returns validation error
- **Engine safety**: all-agents-dead tick returns immediately; outer try-except in `_resolve_agent_action` prevents any exception from crashing a tick
- **DB safety**: `delete_session` wrapped in explicit transaction for atomicity; narrator message UUIDs lengthened to full 32-char hex
- **WebSocket hardening**: malformed JSON in WebSocket handler no longer crashes; broadcast copies client set before iteration
- 20 new robustness tests (`test_robustness.py`), 188 total passing

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
