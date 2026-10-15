# RoadPulse Coimbatore v3.0 — Municipal Road Intelligence Platform

Production-grade, end-to-end SaaS for automated road-infrastructure monitoring in
Coimbatore. Passive fleet telemetry (TNSTC buses + CMC trucks) is ingested, deduplicated,
clustered into chronic hotspots, scored for repair priority, and turned into AI-drafted
municipal work orders — all on a live command centre built for the Coimbatore Municipal
Corporation.

```
roadpulse/
├── frontend/                     # React 18 + Vite command centre (light civic theme)
│   ├── .env                      # VITE_API_URL, VITE_MAPBOX_TOKEN
│   └── src/
│       ├── components/           # AppShell, MapView (Mapbox GL), HotspotDrawer, ui, charts
│       ├── lib/                  # api.js, format.js, hooks.js (SSE live feed)
│       ├── pages/                # Overview, MapOps, Triage, WorkOrders, Monsoon,
│       │                         # Network, Fleet, Governance, Login
│       ├── state/AuthContext.jsx # JWT session + role switching
│       └── styles/               # tokens.css (design system) + app.css
├── backend/                      # Express 4 + node:sqlite (zero native build)
│   └── src/
│       ├── config.js             # env loader + PRD tuning constants
│       ├── db.js                 # schema (users, detections, segments, hotspots,
│       │                         #  work_orders, pci_history, audit_log)
│       ├── seed.js               # deterministic Coimbatore dataset
│       ├── index.js              # boot (CORS, routes, SSE)
│       ├── middleware/           # auth (JWT + RBAC), error, logger, rateLimit
│       ├── routes/               # REST + SSE surface under /api
│       └── services/             # ingest, clustering (DBSCAN), priority, pci,
│                                 #  hotspots, monsoon, costing, workOrders, simulator
└── project docs/PRD.md           # product requirements (source of truth)
```

## Run

```bash
npm run install:all     # install backend + frontend deps
npm run seed            # build + populate backend/roadpulse.db
npm run dev             # start API (:8080) and web (:5173) together
```

Then open **http://localhost:5173** and sign in with a demo account (below).

Individual services:

```bash
npm run dev:backend     # Express API on :8080  (reads backend/.env)
npm run dev:frontend    # Vite dev server on :5173 (reads frontend/.env)
npm run build           # production build of the frontend
```

## Demo accounts

All accounts use the password **`roadpulse123`**.

| Role | Email | Access |
|------|-------|--------|
| Executive Engineer | `executive@cmc.gov.in` | Full access, AI dispatch, governance |
| Road Inspector | `inspector@cmc.gov.in` | Triage, work orders, field ops |
| Fleet Driver | `driver@tnstc.in` | Read-only telemetry view |

## What's inside

- **Ingestion pipeline** — confidence gate → road-segment snap → 5 m / 24 h spatial
  dedup → hotspot refresh → PCI recompute → SSE broadcast → audit.
- **Chronic hotspots** — pure-JS DBSCAN (haversine) over the observation history;
  ≥ 3 samples across 180 days marks a site chronic.
- **Priority scoring** — defect severity × traffic multiplier × chronic/monsoon
  weighting, banded into CRITICAL / HIGH / MEDIUM / LOW.
- **PCI (IRC:82)** — defect-based deduction with a capped recurrence penalty and a
  time-series `pci_history` table driving trend charts.
- **Monsoon inundation engine** — live Open-Meteo rainfall vs. drainage-vulnerable
  segments flags flooding exposure.
- **AI work orders** — OpenRouter (Nemotron) drafting with an offline municipal
  template fallback, so the demo never fails without a key.
- **Live telemetry** — Server-Sent Events stream plus a passive fleet simulator.

## Env

`.env` files are gitignored — copy from `.env.example` and edit.

- **Frontend**: `VITE_API_URL` (empty = use the Vite dev proxy `/api → :8080`) and
  `VITE_MAPBOX_TOKEN` (required for the Map Operations basemap; without it the map
  panel shows a token-setup prompt instead of failing silently).
- **Backend**: `PORT`, `SQLITE_PATH`, `CORS_ORIGIN`, `OPENROUTER_KEY`. Weather uses
  the free Open-Meteo API (no key) with a mock fallback.
