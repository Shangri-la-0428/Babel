# BABEL Frontend

Next.js 14 frontend for BABEL — AI World State Machine.

## Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS 3.4 with custom design preset (`../design/tailwind.preset.js`)
- **Typography**: JetBrains Mono (monospace) + Inter (headings)
- **i18n**: Built-in CN/EN toggle, 210+ translation keys in `lib/i18n.ts`

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — browse world seeds, view details, launch simulations |
| `/create` | Create a custom world with agents, rules, locations, events |
| `/sim?id=<session_id>` | Live simulation — event feed, agent panel, chat, controls |
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

## Design System

Dark cyberpunk aesthetic — void-black (#000), lime accent (#C0FE04), zero border-radius, uppercase monospace, machine voice. See `../design/` and `CLAUDE.md` for full design tokens and component patterns.
