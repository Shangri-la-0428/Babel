# BABEL

AI-driven World State Machine. Seed + AI Runtime = emergent text worlds.

## Project Structure

- `design/` — Design system (tokens, components, animations, Tailwind preset)
- `backend/` — Python FastAPI + SQLite + litellm engine
- `frontend/` — Next.js 14 + Tailwind CSS

## Design Context

### Users
Creative worldbuilders — writers, game designers, and AI enthusiasts who use BABEL to seed emergent narratives and observe AI agents interact in simulated worlds. Desktop only (1280px+).

### Brand Personality
**Dark / Electric / Raw** — Cyberpunk energy. Gritty, alive, on the edge. Industrial with a pulse.

### Design Principles
1. **Void-first** — Black is the default state. Content emerges from darkness. Every surface must justify itself.
2. **Signal over decoration** — Every visual element carries information. No ornament. Color = state. Animation = event.
3. **Machine aesthetic** — Clinical precision, tabular data, monospace readouts. Not human-friendly — system-native.
4. **One accent, infinite meaning** — Lime (#C0FE04) is the only warm color. Guard its signal power.
5. **Density over whitespace** — Pack information tight. 1px gaps, compact grids, small type. Mission control density.

### Key Design Rules
- Zero border-radius everywhere. Status dots are the ONLY circular element.
- Monospace-first (JetBrains Mono), all uppercase default, Inter for display.
- Marathon-inspired 1px gap data grids.
- Semantic Tailwind tokens: `text-t-muted`, `border-b-DEFAULT`, `bg-surface-1` (NOT raw Tailwind colors).
- Reference: marathonthegame.com. Anti-reference: rounded SaaS, pastel, Material Design.
