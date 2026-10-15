# RoadPulse Coimbatore v2.0 — Fullstack (React + Express + SQLite)

```
roadpulse/
├── frontend/               # React (Vite) + Leaflet command center
│   ├── .env / .env.example # VITE_API_URL (empty = dev proxy /api -> :8080)
│   └── src/
│       ├── components/     # MapView, ErrorBoundary
│       ├── lib/            # api.js (base-url helper), data.js (mock + PCI)
│       ├── App.jsx / main.jsx / styles.css
├── backend/                # Express + SQLite (node:sqlite, zero native build)
│   ├── .env / .env.example # PORT, SQLITE_PATH, CORS_ORIGIN, OPENROUTER_KEY
│   └── src/
│       ├── config.js       # env loader (dotenv)
│       ├── db.js           # schema
│       ├── seed.js         # Coimbatore corridors + hotspots
│       ├── index.js        # boot (CORS from env)
│       └── routes/api.js   # metrics, segments, hotspots, weather, work-orders
├── legacy-prototype/       # vanilla fallback demo (emergency)
└── project docs/PRD.md
```

## Run
```bash
npm run install:all
npm run seed
npm run dev:backend      # :8080  (reads backend/.env)
npm run dev:frontend     # :5173  (reads frontend/.env)
```

## Env
- Copy `.env.example` → `.env` in each folder and edit. `.env` files are gitignored.
- Frontend: set `VITE_API_URL=http://localhost:8080` to bypass the Vite proxy, or leave empty for proxy.
- Backend: `OPENROUTER_KEY` enables live Nemotron-120B work orders; without it the offline municipal template is used (demo never fails).
- Weather is free Open-Meteo (no key) with mock fallback.
