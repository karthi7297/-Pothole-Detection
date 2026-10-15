# RoadPulse Coimbatore v3.0 — Municipal Road Intelligence Platform

Production-grade, end-to-end SaaS for automated road-infrastructure monitoring in
Coimbatore. Pothole reports arrive from the **citizen app** and from **dashcams**
automatically; each one is confidence-gated, snapped to the road, deduplicated,
clustered into chronic hotspots, scored for repair priority, and turned into
AI-drafted municipal work orders — all on a live command centre built for the
Coimbatore Municipal Corporation.

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
│                                 #  hotspots, monsoon, costing, workOrders,
│                                 #  simulator, vehicles (zone geofences)
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
| Executive Engineer | `executive@cmc.gov.in` | Oversight, AI dispatch, governance (read-only on reports) |
| Field Officer (Road Inspector) | `inspector@cmc.gov.in` | Accept/reject pending reports, triage, work orders, field ops |
| Fleet Driver | `driver@tnstc.in` | Read-only view of their own submitted reports |

## What's inside

- **Report intake** — every pothole report (citizen app or dashcam) is
  confidence-gated → snapped to the nearest road segment → 5 m / 24 h spatial
  dedup → persisted → clustered (verified only) → PCI recompute → SSE broadcast →
  audit.
- **Three-tier verification** — a detection is only part of the road record once a
  field officer accepts it:

  | Confidence | Result |
  |---|---|
  | ≥ 0.85 | **Verified** — auto-accepted into the road record |
  | 0.60 – 0.84 | **Pending** — held for a field officer to accept or reject |
  | < 0.60 | **Rejected** — treated as sensor noise |

  A confident repeat of a pending report promotes it automatically, so a real
  defect is never stuck waiting.
- **Named locations** — every report carries a human-readable **place name**, not
  just a coordinate pair. The citizen's own label wins; otherwise the name is
  resolved automatically via `GET /api/geo/reverse?lat&lon` (Mapbox reverse
  geocoding when `MAPBOX_TOKEN` is set, falling back to the nearest corridor's
  street + zone — so a report is never nameless, even offline).
- **Chronic hotspots** — pure-JS DBSCAN (haversine) over the **verified**
  observation history; ≥ 3 samples across 180 days marks a site chronic.
- **Priority scoring** — defect severity × traffic multiplier × chronic/monsoon
  weighting, banded into CRITICAL / HIGH / MEDIUM / LOW.
- **PCI (IRC:82)** — defect-based deduction with a capped recurrence penalty and a
  time-series `pci_history` table driving trend charts.
- **Monsoon inundation engine** — live Open-Meteo rainfall vs. drainage-vulnerable
  segments flags flooding exposure.
- **AI work orders** — OpenRouter (Nemotron) drafting with an offline municipal
  template fallback, so the demo never fails without a key.
- **Live intake** — Server-Sent Events stream plus a passive ingestion simulator
  that emits citizen + dashcam frames.

## The map

Map Operations is a **report map**, not a vehicle tracker: every pothole report
received is plotted at the spot on the road where it was recorded, and nothing
else moves. Shape encodes provenance, colour encodes verification state — so a
glance answers both *"who found this?"* and *"has an officer confirmed it yet?"*.

| Capability | Detail |
|---|---|
| **Report markers** | 📍 pin = citizen app upload, 📷 camera = dashcam frame. Plotted at the recorded lat/lng. |
| **Verification colour** | Green = verified, amber = pending review, grey = rejected. Pending markers pulse so they read as a work queue. |
| **Defect clusters** | Hollow rings sized by priority score, tinted by grade; critical sites get a breathing halo. |
| **Zone geofences** | Convex hulls (Andrew's monotone chain) of each zone, with HTML zone labels. |
| **Corridor PCI** | Road segments coloured by PCI band (≥ 80 good · 50–79 fair · < 50 poor). |
| **Smart overlays** | Toggle Reports · Corridors · Defects · Geofences. The legend adapts to what is visible. |
| **Officer triage in place** | Filter to *Pending review*, then Accept or Reject a report straight from the map — accepting links it into its hotspot and recomputes the corridor PCI. |
| **Helicopter view** | One click fits the camera to every report on the network. |
| **Hover + click cards** | Hover shows class, source and confidence; clicking opens the report record. |

The map is built on Mapbox GL (`light-v11` / `dark-v11`) and driven entirely by
live API data. Zone geofences are computed in `backend/src/services/vehicles.js`;
the Fleet & Ingestion page carries the same report-source and verification
breakdown as summary cards.

## Env

`.env` files are gitignored — copy from `.env.example` and edit.

- **Frontend**: `VITE_API_URL` (empty = use the Vite dev proxy `/api → :8080`) and
  `VITE_MAPBOX_TOKEN` (required for the Map Operations basemap; without it the map
  panel shows a token-setup prompt instead of failing silently).
- **Backend**: `PORT`, `SQLITE_PATH`, `CORS_ORIGIN`, `OPENROUTER_KEY`. Weather uses
  the free Open-Meteo API (no key) with a mock fallback. `MAPBOX_TOKEN` is optional —
  it upgrades report location names from the road-network fallback to real Mapbox
  place names.
