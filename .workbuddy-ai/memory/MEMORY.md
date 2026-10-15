# RoadPulse Coimbatore — project memory

Long-lived facts and conventions for this repo. Update as the project evolves.

## What this is
Municipal road-infrastructure intelligence SaaS for Coimbatore Municipal Corporation.
Passive fleet telemetry (TNSTC buses + CMC waste trucks) → dedup → DBSCAN hotspot
clustering → priority scoring → AI work orders.

## Stack & conventions
- **Frontend**: React 18 + Vite, `react-router-dom` v7, `recharts` v3, `lucide-react`,
  `mapbox-gl` v3. Entry `frontend/src/main.jsx`; only `styles/tokens.css` + `styles/app.css`
  are imported (no other global CSS).
- **Backend**: Express 4 + `node:sqlite` (`DatabaseSync`, zero native build). ESM
  (`"type": "module"`). Services under `backend/src/services/`, routes under `routes/`.
- **Auth**: JWT + `bcryptjs`, RBAC capability matrix in `middleware/auth.js`.
  Executive holds `['*']`.
- **Design system**: "Civic Instrument" **light** theme — warm paper `#f5f4f0`,
  municipal ink navy `#123a5e`, hi-vis accent `#e8590c`. CSS custom properties in
  `tokens.css`. Never a full dark UI (user preference).
- **Currency**: ₹ / INR (`inr()` in `lib/format.js`).
- **Fonts**: self-hosted via `frontend/public/fonts/fonts.css` (Archivo, IBM Plex Sans,
  IBM Plex Mono). No CDN link tags.

## Demo logins — password `roadpulse123`
- `executive@cmc.gov.in` (full access) · `inspector@cmc.gov.in` · `driver@tnstc.in`

## Key algorithms
- `services/priority.js` — `severityOf` = `bbox_area_ratio * confidence * 100` (the ×100
  matters: PRD grade bands are 10/22/35, so ×10 never reaches CRITICAL).
- `services/pci.js` — defect-based PCI (not per-observation) + `pci_history` table.
- `services/hotspots.js` — DBSCAN; `reportCountNear` uses the chronic window (180 d),
  not 24 h.
- `services/vision.js` — **upload detector v2**, pure JS (`jpeg-js` + `pngjs`). Two-scale
  local-mean dark-blob extraction + Sobel rim/interior edge ratio classify pothole /
  alligator crack / seam crack and derive confidence + `bbox_area_ratio` from the
  pixels. Calibrated: clear pothole ≥ 0.85 (auto-Verified), vague 0.60–0.84 (Pending),
  junk < 0.60. Focus is measured on native-resolution crops, not the downsampled work
  canvas, so confidence does not drift with camera megapixels. Undecodable formats
  (video/WebP/HEIC) fall back to `metadata-fallback` @ 0.62 = Pending.
- `routes/uploads.js` `resolveDetection()` maps frame + metadata onto that verdict;
  a manual label keeps the claimed class but weights confidence by image evidence.
- `services/ingest.js` `{ holdBelowGate: true }` (citizen/field uploads only) stores an
  unconfirmable human report as Pending **with its real confidence** instead of
  discarding it; the edge/dashcam stream still hard-rejects sub-gate frames (PRD 4.1).
- `services/vehicles.js` — zone geofence convex hulls (Andrew's monotone chain). Also
  holds an unused-by-UI live vehicle-motion model; the report map only needs `geofences()`.

## Running
- `npm run dev` → `scripts/dev.mjs` launches API (:8080) + web (:5173) together.
- `npm run seed` → deterministic dataset (mulberry32). Re-seed after schema changes.
- `frontend/.env` needs `VITE_MAPBOX_TOKEN` or the map panel shows a setup prompt.

## Map (Mapbox GL) — REPORT map
Plots every pothole report received (citizen app or dashcam) at its road location.
No live vehicle tracking.
- **Shape = source**: pin bitmap for citizen uploads, camera bitmap for dashcam frames.
- **Colour = verification state**: verified `#2f9e44`, pending review `#e8590c`,
  rejected `#8a8a86`. Pending markers pulse (animated ring).
- Three-tier gate (`config.js`): ≥ 0.85 auto-`Verified`, 0.60–0.84 `Pending` (officer
  must accept), < 0.60 `Rejected`. Only Verified reports cluster / affect PCI.
- Layers: `reports-pending-ring`, `reports-icon`, `clusters-ring`/`clusters-halo`,
  `segments-line`, `geofences-fill`/`geofences-line`.
- Overlays toggled via `layers` prop; legend adapts to visible layers.
- Zone labels are HTML `Marker`s (avoids Mapbox `text-font` availability issues).
- Field officers Accept/Reject a pending report straight from the map list.

## Report locations carry a NAME (not just coordinates)
Every report has `detections.location_name` — a coordinate pair alone is useless to
a repair gang.
- Resolution order: the citizen's own typed label → else `GET /api/geo/reverse?lat&lon`
  → Mapbox (`MAPBOX_TOKEN`) → else nearest corridor `"<street>, <zone>"`.
- `services/places.js`: `reverseGeocode()`, `nearestRoad()`, `composeRoadName()`.
- `routes/geo.js` is **public** and mounted before the authenticated routers.
- Seed style: citizen reports = `"Near <landmark>, <street>"`, dashcam = `"<street>, <zone>"`.
- `db.js` has an idempotent `ADDED_COLUMNS` migration — add new columns there, not just
  in `SCHEMA`, or an existing DB will not upgrade.

## Gotchas
- **React StrictMode double-mounts** Mapbox. Guard every async map callback with
  `mapRef.current !== map`, and null `mapRef.current` *before* `map.remove()`.
- Layer-scoped `map.on('click', layerId, …)` handlers survive `setStyle`; never
  re-bind them on basemap change or popups will double.
- **Mapbox `load` handlers close over the FIRST render's props.** Anything the
  handler reads must come from a ref (e.g. `geofencesRef`, `dataRef`, `reportsRef`),
  and a `readyRef`-style guard on a data-sync effect will never re-run — guard on
  `map.getSource(id)` instead.
- Vite's `emptyDir` can hang on the `safe-delete` shim; move `dist/` aside and rebuild.
- The Vite dev proxy forwards `/api` → `:8080` when `VITE_API_URL` is empty.
