# BABEL

AI-driven World State Machine. Seed + AI Runtime = emergent text worlds.

## Project Structure

- `design/` — Design system (tokens, components, animations, Tailwind preset)
- `backend/` — Python FastAPI + SQLite + litellm engine
- `frontend/` — Next.js 14 + Tailwind CSS

## Design Context

### Users
Creative worldbuilders — writers, game designers, and AI enthusiasts who use BABEL to seed emergent narratives and observe AI agents interact in simulated worlds. They approach it like peering into a living terrarium: fascination, wonder, the thrill of unexpected emergent behavior. Their context is desktop (1280px+), likely in a focused creative session, wanting to feel like they're operating a portal into another reality.

### Brand Personality
**Dark / Electric / Raw** — Cyberpunk energy. Gritty, alive, on the edge. Industrial with a pulse. Think abandoned space station control room that just powered on: every indicator hums, every data stream is alive. Not polished consumer software — this is a raw instrument for world observation.

### Aesthetic Direction
- **Primary reference**: [marathonthegame.com](https://marathonthegame.com) — sci-fi industrial minimalism, void-black backgrounds, neon lime accent, brutal grid layouts, uppercase monospace typography, 1px hairline separators
- **Anti-references**: Rounded SaaS dashboards, pastel palettes, Material Design, glassmorphism, bounce/elastic easing, anything "friendly" or "approachable"
- **Theme**: Dark mode only. Pure black void (#000000) with lime (#C0FE04) as the singular accent pulse
- **Typography**: Monospace-first (JetBrains Mono), all uppercase by default, Inter for display/headings only
- **Geometry**: Zero border-radius everywhere (`* { border-radius: 0 }`). Status dots are the ONLY circular element
- **Grid pattern**: Marathon-inspired 1px gap data grids — `gap-px bg-b-DEFAULT` hairlines, not padding
- **Texture**: CRT scanline overlay (`.scanlines::after`) on simulation page

### Design Principles
1. **Void-first** — Black is not a background, it's the default state. Content emerges from darkness. Every surface addition must justify its existence against the void.
2. **Signal over decoration** — Every visual element carries information. No ornamental borders, shadows, or gradients. Color means state change. Animation means something happened.
3. **Machine aesthetic** — The interface should feel like it was designed by the system observing itself. Clinical precision, tabular data, monospace readouts. Human warmth is the wrong tone.
4. **One accent, infinite meaning** — Lime (#C0FE04) is the only warm color. It means: active, alive, primary, selected, running. Guard it — overuse kills its signal power.
5. **Density over whitespace** — Pack information tight. Use 1px gaps, compact grids, and small type. The user wants to see everything at once, like a mission control dashboard.

### Technical Constraints
- **Platform**: Desktop only, 1280px+ viewport
- **Stack**: Next.js 14 (App Router) + Tailwind CSS 3.4 with custom preset (`design/tailwind.preset.js`)
- **i18n**: 210+ translation keys in `lib/i18n.ts`, CN/EN toggle. All user-facing strings use `t()`
- **Accessibility**: MVP — semantic HTML, keyboard nav, `prefers-reduced-motion` respected globally
- **Color tokens**: Semantic naming via Tailwind (`text-t-muted`, `border-b-DEFAULT`, `bg-surface-1`) — NEVER raw Tailwind colors

### Color Palette
| Token | Hex | Usage |
|-------|-----|-------|
| void | #000000 | Default background |
| surface-1 | #0A0A0A | Cards, elevated containers |
| surface-2 | #111111 | Nested surfaces, stat blocks |
| surface-3 | #1C1C1C | Borders, grid gaps |
| surface-4 | #252525 | Hover states on dark surfaces |
| t-DEFAULT | #FFFFFF | Primary text |
| t-secondary | #A0A0A0 | Body text, descriptions |
| t-muted | #8A8A8A | Labels, metadata, inactive nav |
| t-dim | #757575 | Disabled text, ghost content |
| primary | #C0FE04 | Active, running, selected, CTA |
| primary-glow | rgba(192,254,4,0.2) | Subtle glow halos |
| primary-glow-strong | rgba(192,254,4,0.4) | Strong glow (hover, hero) |
| danger | #F24723 | Error, dead agents, world events |
| warning | #FFB800 | Trade actions, caution |
| info | #0EA5E9 | Speak actions, informational |

### Component Patterns

**Primary button**: `bg-primary text-void border border-primary hover:bg-transparent hover:text-primary hover:shadow-[0_0_16px_var(--color-primary-glow-strong)] active:scale-[0.97] disabled:opacity-30 transition-[colors,box-shadow,transform]`

**Secondary button**: `border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary active:scale-[0.97] disabled:opacity-30 transition-[colors,transform]`

**Form inputs**: `h-9 px-3 bg-void border border-b-DEFAULT text-detail text-t-DEFAULT normal-case tracking-normal focus:border-primary focus:outline-none hover:border-b-hover transition-colors`

**Form labels**: `text-micro text-t-muted tracking-widest mb-1.5 block`

**Empty states**: `// COMMENT` label (machine-style code comment) + description + CTA button

**Loading skeletons**: `bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 bg-[length:200%_100%] animate-[shimmer_1.5s_ease_infinite]`

**Badges**: `text-micro tracking-wider px-2.5 py-0.5 border leading-none font-medium` + semantic color class

**Data grids**: `flex flex-col gap-px bg-b-DEFAULT` with `bg-void` children (1px hairline separators)

**Nav breadcrumb**: `← 返回 | BABEL / 世界名称` — BABEL always `text-primary`, world name with lime `drop-shadow` glow

### Animation System

| Animation | Duration | Usage |
|-----------|----------|-------|
| `fade-in` | 300ms | Page content, tab switching (100ms) |
| `slide-up` | 300ms | Card entrance |
| `slide-down` | 150ms | Expand sections, error banners |
| `stagger-in` | 200ms + 40ms delays | List item cascade (up to 9 children) |
| `active:scale-[0.97]` | instant | Button press feedback |
| `event-flash` | 1.2s | New event lime highlight |
| `pulse-glow` | 2s infinite | Running status dot |
| `tick-bump` | 300ms | Tick counter scale pulse |

Glow levels: 8px (subtle) → 12px (medium) → 16px (strong) → 24px (hero), using `--color-primary-glow` / `--color-primary-glow-strong`

All animations respect `prefers-reduced-motion: reduce`. Never use bounce or elastic easing.
