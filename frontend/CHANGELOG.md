# Changelog

## Phase 15 — 2026-03-26

### Step 3: Timeline Replay
- **SeekBar**: Scrub to any past tick to view reconstructed world state
- **Replay mode**: REPLAY badge on ControlBar, Run/Step/Inject disabled
- **LIVE button**: Exit replay and return to real-time state
- **WS gating**: WebSocket stays connected during replay, live updates resume on exit
- New hook: `use-replay.ts` with debounced seek + AbortController
- API: `getTimeline()`, `reconstructAtTick()` — no backend changes
- 8 i18n keys, 6 unit tests, 4 E2E tests

### Step 2: Seed Export/Import
- **Export**: Download `.babel.json` from SeedDetail modal footer
- **Import**: Upload `.babel.json` on Assets page with validation (type/name/data shape, 1MB limit)
- 5 i18n keys, 6 E2E tests

### Step 1: Polish
- **WorldRadar collapse**: TACTICAL toggle (already existed, verified)
- **ControlBar density**: Removed model name + session ID from toolbar
- **Disabled button reasons**: Hover tooltips show `// SIM_RUNNING` / `// REQUIRES: API_KEY`
- **Uppercase rules**: Skipped (system already balanced)

### Step 0: Phase 14 Commit
- Overdrive (WebGL shaders, spring physics) + performance optimizations
- 89 E2E + 114 unit tests passing

## Test Coverage

| Suite | Count |
|-------|-------|
| Unit (Vitest) | 121 |
| E2E (Playwright) | 103 |
