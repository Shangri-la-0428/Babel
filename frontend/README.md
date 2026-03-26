# BABEL Frontend

Next.js 14 frontend for BABEL — AI World State Machine.

## Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS 3.4 with custom design preset (`../design/tailwind.preset.js`)
- **Typography**: JetBrains Mono (monospace) + Inter (headings)
- **i18n**: Built-in CN/EN toggle, 330+ translation keys in `lib/i18n.ts`

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — browse world seeds, view details, launch simulations |
| `/create` | Create a custom world with agents, rules, locations, events |
| `/sim?id=<session_id>` | Live simulation — event feed, agent panel, chat, Oracle narrator drawer, controls |
| `/assets` | Saved asset library — agents, items, locations, events |

## Development

```bash
npm install
npm run dev
```

Requires the BABEL backend running at `http://localhost:8000` (configurable via `NEXT_PUBLIC_API_URL`).

## Build & Deploy

```bash
npm run build    # Production build
npm start        # Start production server

# Docker
docker build -t babel-frontend .
docker run -p 3000:3000 babel-frontend
```

## Testing

```bash
npm test            # Run Playwright E2E tests
npm run test:ui     # Run with Playwright UI
npm run test:report # Show HTML report
npm run test:unit   # Run Vitest unit tests
```

E2E tests require the dev server and backend running. Unit tests run standalone.

## Architecture

### Canvas Rendering (`lib/raf.ts`)

All canvas components share a single `requestAnimationFrame` loop via the shared RAF scheduler. Each component subscribes a tick callback and manages its own frame throttling:

| Component | FPS | Renderer | Purpose |
|-----------|-----|----------|---------|
| `WorldShader` | ~30 | WebGL2 | Procedural terrain with FBM noise, parallax depth, day/night palette |
| `ParticleField` | 60 | Canvas 2D | Status-reactive particles, event burst spawning |
| `WorldRadar` | 60/15 | Canvas 2D | Tactical radar with location nodes, agent dots, sweep line |
| `AmbientVoid` | 60 | Canvas 2D | Global floating particles behind all pages |

Performance patterns: swap-and-pop removal (O(1)), layout caching, render throttling, idle frame skipping.

### Spring Physics (`lib/spring.ts`)

`useSpring(target, config, from)` — mass-spring-damper solver for natural motion. Render-throttled (skips setState when delta < 0.005). Respects `prefers-reduced-motion` with instant snap. Used by Modal for bouncy open / snappy close.

### Shared UI Components (`components/ui.tsx`)

Reusable primitives aligned to the design system:

- `StatusDot` — Semantic status indicator (the only circular element)
- `Badge` — Color-coded label with variants (default, warning, info, danger, primary)
- `ErrorBanner` — Header or inline error display with dismiss
- `EmptyState` — Machine-style `// COMMENT` empty state
- `SkeletonLine` — Shimmer loading placeholder
- `GlitchReveal` — Glitch decode animation for display titles
- `DecodeText` — Progressive text reveal with glitch characters
- `FormLabel` — Standard form/section label
- `DetailSection` — Bordered label + content section

### Oracle Drawer (`components/Oracle*.tsx`)

Split into focused sub-components:

- `OracleDrawer` — Container with state management, input form
- `OracleHeader` — Mode toggle (narrate/create), tick counter, close
- `OracleChat` — Message list, suggestions, loading/error states
- `OracleSeedCard` — Creative mode seed preview with stats and launch
- `OracleWaveform` — Signal visualizer canvas (idle/thinking/received states)
- `OracleParticles` — Floating terminal glyph overlay

### Accessibility

- Skip-to-content link targeting `#main-content`
- Focus trap + restore in Modal
- Background scroll lock when Modal is open
- `prefers-reduced-motion` respected globally (all canvas components, spring hook, CSS animations)
- `<html lang>` synced to active locale (zh-CN / en)
- Semantic `<button>` elements (no `div[role=button]`)
- `aria-label` on icon-only buttons
- `aria-live` regions for dynamic content

## Design System

Dark cyberpunk aesthetic — void-black (#000), lime accent (#C0FE04), zero border-radius, uppercase monospace, machine voice. See `../design/` and `CLAUDE.md` for full design tokens and component patterns.
