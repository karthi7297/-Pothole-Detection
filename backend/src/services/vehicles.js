import { query } from '../db.js';
import { broadcast } from './events.js';
import { haversineMeters } from './geo.js';

/**
 * Live fleet vehicle tracking.
 *
 * Samsara-style telematics maps are alive: assets glide along their routes,
 * chevrons point the way they are travelling, and a short breadcrumb trail
 * shows where they have just been. The PRD's passive fleet is exactly this —
 * TNSTC buses and CMC waste trucks continuously sensing the network — so we
 * model their motion explicitly here and stream it over SSE.
 *
 * Vehicles ping-pong along a road segment (A→B→A), which gives believable
 * headings, and keep a rolling track buffer for trip-history playback.
 */

const FLEET = [
  { id: 'TNSTC_BUS_CB_101', kind: 'bus', route: 'TNSTC route 101 · Gandhipuram ⇄ Ukkadam' },
  { id: 'TNSTC_BUS_CB_104', kind: 'bus', route: 'TNSTC route 104 · Avinashi Rd ⇄ Singanallur' },
  { id: 'TNSTC_BUS_CB_112', kind: 'bus', route: 'TNSTC route 112 · Saibaba Colony ⇄ Peelamedu' },
  { id: 'TNSTC_BUS_CB_207', kind: 'bus', route: 'TNSTC route 207 · Thudiyalur ⇄ Town Hall' },
  { id: 'TNSTC_BUS_CB_215', kind: 'bus', route: 'TNSTC route 215 · Saravanampatti ⇄ Gandhipuram' },
  { id: 'CMC_TRUCK_03', kind: 'truck', route: 'CMC waste · East Zone collection beat' },
  { id: 'CMC_TRUCK_07', kind: 'truck', route: 'CMC waste · North Zone collection beat' },
  { id: 'CMC_TRUCK_11', kind: 'truck', route: 'CMC waste · South Zone collection beat' },
];

const SPEED = { bus: { min: 22, max: 44 }, truck: { min: 14, max: 30 } };
const TICK_MS = 2000;
const TRACK_MAX = 26;
const IDLE_CHANCE = 0.12;

const R = 6_371_008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Initial bearing (compass degrees, 0 = north) from A to B. */
function bearing(aLat, aLon, bLat, bLon) {
  const φ1 = toRad(aLat), φ2 = toRad(bLat);
  const Δλ = toRad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Deterministic small PRNG so the demo opens the same way every time. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x5eed5a);

const state = {
  vehicles: [],
  segments: [],
  ready: false,
  timer: null,
  startedAt: null,
};

function loadSegments() {
  const rows = query('SELECT * FROM road_segments');
  state.segments = rows.map((s) => ({
    ...s,
    lengthM: Math.max(250, haversineMeters(s.start_lat, s.start_lon, s.end_lat, s.end_lon)),
  }));
}

/** Spread buses over arterial corridors and trucks over the collector network. */
function assignRoutes() {
  const arterials = state.segments.filter((s) => /arterial|collector/i.test(s.road_type));
  const pool = arterials.length >= 4 ? arterials : state.segments;
  state.vehicles = FLEET.map((f, i) => {
    const seg = pool[i % pool.length];
    const dir = i % 2 === 0 ? 1 : -1;
    return {
      id: f.id,
      kind: f.kind,
      route: f.route,
      segment_id: seg?.segment_id ?? null,
      street_name: seg?.street_name ?? null,
      zone_name: seg?.zone_name ?? null,
      t: 0.12 + rnd() * 0.7,
      dir,
      speedKph: 0,
      status: 'moving',
      lat: seg ? seg.start_lat : 0,
      lon: seg ? seg.start_lon : 0,
      heading: dir === 1 ? 0 : 180,
      track: [],
      lastFixAt: null,
    };
  });
}

function segmentFor(v) {
  return state.segments.find((s) => s.segment_id === v.segment_id) || state.segments[0];
}

function positionAt(seg, t) {
  return {
    lat: seg.start_lat + (seg.end_lat - seg.start_lat) * t,
    lon: seg.start_lon + (seg.end_lon - seg.start_lon) * t,
  };
}

/** Advance every vehicle by `dtMs` of simulated travel. */
export function advance(dtMs = TICK_MS) {
  if (!state.ready) return;

  for (const v of state.vehicles) {
    const seg = segmentFor(v);
    if (!seg) continue;

    // Occasional stop-and-go, exactly like a city bus at a halt.
    const idle = rnd() < IDLE_CHANCE;
    v.status = idle ? 'idle' : 'moving';

    const band = SPEED[v.kind] || SPEED.bus;
    const target = idle ? 0 : band.min + rnd() * (band.max - band.min);
    v.speedKph = Math.round((v.speedKph * 0.6 + target * 0.4) * 10) / 10;

    const metres = (v.speedKph / 3.6) * (dtMs / 1000);
    v.t += (metres / seg.lengthM) * v.dir;

    if (v.t >= 1) {
      v.t = 1 - (v.t - 1);
      v.dir = -1;
    } else if (v.t <= 0) {
      v.t = -v.t;
      v.dir = 1;
    }

    const a = positionAt(seg, v.t);
    const b = positionAt(seg, Math.min(1, Math.max(0, v.t + v.dir * 0.02)));
    v.lat = Number(a.lat.toFixed(6));
    v.lon = Number(a.lon.toFixed(6));
    if (haversineMeters(a.lat, a.lon, b.lat, b.lon) > 1) {
      v.heading = Math.round(bearing(a.lat, a.lon, b.lat, b.lon));
    }
    v.lastFixAt = new Date().toISOString();

    v.track.push([v.lon, v.lat]);
    if (v.track.length > TRACK_MAX) v.track.shift();
  }
}

/** Public snapshot for the API and the SSE feed. */
export function positions() {
  return state.vehicles.map((v) => ({
    id: v.id,
    kind: v.kind,
    route: v.route,
    status: v.status,
    lat: v.lat,
    lon: v.lon,
    heading: v.heading,
    speedKph: v.speedKph,
    street_name: v.street_name,
    zone_name: v.zone_name,
    segment_id: v.segment_id,
    track: v.track.slice(-TRACK_MAX),
    lastFixAt: v.lastFixAt,
  }));
}

export function vehicleSummary() {
  const v = state.vehicles;
  return {
    total: v.length,
    moving: v.filter((x) => x.status === 'moving').length,
    idle: v.filter((x) => x.status === 'idle').length,
    avgSpeedKph: v.length ? Math.round((v.reduce((s, x) => s + x.speedKph, 0) / v.length) * 10) / 10 : 0,
  };
}

/* ------------------------------------------------------------- geofences -- */

/** Andrew's monotone-chain convex hull over [lon, lat] pairs. */
function convexHull(points) {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Padded hull so the fence visibly surrounds the zone's assets. */
function padHull(hull, deg = 0.004) {
  if (!hull.length) return hull;
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  return hull.map(([lon, lat]) => [
    lon + Math.sign(lon - cx || 1) * deg,
    lat + Math.sign(lat - cy || 1) * deg,
  ]);
}

export function geofences() {
  const rows = query(`
    SELECT s.zone_name AS zone,
           s.start_lon AS lon, s.start_lat AS lat
      FROM road_segments s
     UNION ALL
    SELECT s.zone_name AS zone,
           s.end_lon AS lon, s.end_lat AS lat
      FROM road_segments s
     UNION ALL
    SELECT h.zone_name AS zone,
           h.center_lon AS lon, h.center_lat AS lat
      FROM chronic_hotspots h
  `);

  const byZone = new Map();
  for (const r of rows) {
    if (!r.zone) continue;
    if (!byZone.has(r.zone)) byZone.set(r.zone, []);
    byZone.get(r.zone).push([r.lon, r.lat]);
  }

  const features = [];
  for (const [zone, pts] of byZone) {
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const ring = padHull(hull);
    ring.push(ring[0]);
    features.push({
      type: 'Feature',
      properties: { zone },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/* ------------------------------------------------------------- lifecycle -- */

export function initVehicles() {
  loadSegments();
  if (!state.segments.length) {
    console.warn('[vehicles] no road segments — tracking disabled');
    return;
  }
  assignRoutes();
  // Seed a few breadcrumbs so trails are visible on first paint.
  for (let i = 0; i < 6; i += 1) advance(TICK_MS * 2);
  state.ready = true;
  state.startedAt = new Date().toISOString();

  state.timer = setInterval(() => {
    advance(TICK_MS);
    broadcast('fleet', { vehicles: positions(), summary: vehicleSummary() });
  }, TICK_MS);
  state.timer.unref?.();

  console.log(`[vehicles] tracking ${state.vehicles.length} fleet assets every ${TICK_MS} ms`);
}

export function refreshRoutes() {
  if (!state.ready) return;
  loadSegments();
  assignRoutes();
}

export const fleetStatus = () => ({
  ready: state.ready,
  startedAt: state.startedAt,
  tickMs: TICK_MS,
  ...vehicleSummary(),
});
