import { SIMULATOR_INTERVAL_MS } from '../config.js';
import { query } from '../db.js';
import { broadcast } from './events.js';
import { IngestError, ingestDetection } from './ingest.js';
import { jitter } from './geo.js';

/**
 * Passive fleet ingestion simulator.
 *
 * The PRD turns TNSTC buses and CMC waste trucks into passive road inspectors.
 * Real hardware is out of scope here, so this module replays that data stream:
 * it walks a road segment, emits a plausible detection, and pushes it through
 * the exact same ingestion pipeline the real edge devices would use.
 *
 * Every row it writes is tagged `source = 'simulator'`, so simulated and real
 * observations are never confused.
 */

const FLEET = [
  { id: 'TNSTC_BUS_CB_101', kind: 'bus' },
  { id: 'TNSTC_BUS_CB_104', kind: 'bus' },
  { id: 'TNSTC_BUS_CB_112', kind: 'bus' },
  { id: 'TNSTC_BUS_CB_207', kind: 'bus' },
  { id: 'CMC_TRUCK_03', kind: 'truck' },
  { id: 'CMC_TRUCK_07', kind: 'truck' },
  { id: 'CMC_TRUCK_11', kind: 'truck' },
  { id: 'TNSTC_BUS_CB_215', kind: 'bus' },
];

const CLASS_WEIGHTS = [
  ['pothole', 0.55],
  ['alligator_crack', 0.27],
  ['longitudinal_crack', 0.18],
];

function pickClass() {
  const r = Math.random();
  let acc = 0;
  for (const [cls, weight] of CLASS_WEIGHTS) {
    acc += weight;
    if (r <= acc) return cls;
  }
  return 'pothole';
}

function pointOnSegment(seg) {
  const t = 0.15 + Math.random() * 0.7;
  return {
    lat: seg.start_lat + (seg.end_lat - seg.start_lat) * t,
    lon: seg.start_lon + (seg.end_lon - seg.start_lon) * t,
  };
}

const state = {
  running: false,
  timer: null,
  intervalMs: SIMULATOR_INTERVAL_MS,
  emitted: 0,
  rejected: 0,
  deduplicated: 0,
  startedAt: null,
  lastEvent: null,
};

/** One tick: choose a location (existing hotspot 45% of the time to grow chronic counts). */
export function tick() {
  const segments = query('SELECT * FROM road_segments');
  if (!segments.length) return null;

  const hotspots = query('SELECT * FROM chronic_hotspots');
  const revisit = hotspots.length > 0 && Math.random() < 0.45;

  let lat, lon;
  if (revisit) {
    const h = hotspots[Math.floor(Math.random() * hotspots.length)];
    lat = h.center_lat + jitter(0.00005);
    lon = h.center_lon + jitter(0.00005);
  } else {
    const seg = segments[Math.floor(Math.random() * segments.length)];
    const p = pointOnSegment(seg);
    lat = p.lat + jitter(0.00012);
    lon = p.lon + jitter(0.00012);
  }

  const vehicle = FLEET[Math.floor(Math.random() * FLEET.length)];

  // ~65% automatic dashcam frames from a fleet vehicle, ~35% citizen app uploads.
  const citizen = Math.random() < 0.35;
  const source = citizen ? 'citizen' : 'dashcam';

  // Dashcams are usually confident; hand-held citizen photos less so, which
  // routes more of them to the field-officer queue.
  const autoVerifyFloor = citizen ? 0.52 : 0.6;
  const belowGate = Math.random() < (citizen ? 0.14 : 0.05);
  const confidence = belowGate
    ? Math.round((0.31 + Math.random() * 0.27) * 100) / 100
    : Math.round((autoVerifyFloor + Math.random() * (0.98 - autoVerifyFloor)) * 100) / 100;

  const input = {
    vehicle_id: citizen ? null : vehicle.id,
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lon.toFixed(6)),
    damage_class: pickClass(),
    confidence,
    bbox_area_ratio: Math.round((0.03 + Math.random() * 0.15) * 1000) / 1000,
    source,
  };

  try {
    const result = ingestDetection(input, { user: null });
    state.emitted += 1;
    if (result.deduplicated) state.deduplicated += 1;
    state.lastEvent = { at: new Date().toISOString(), vehicle_id: result.vehicle_id, ...result };
    return result;
  } catch (err) {
    if (err instanceof IngestError) {
      state.rejected += 1;
      const payload = {
        kind: 'rejected',
        vehicle_id: citizen ? 'CITIZEN-anon' : vehicle.id,
        source,
        damage_class: input.damage_class,
        confidence: input.confidence,
        reason: err.code,
        message: err.message,
        latitude: input.latitude,
        longitude: input.longitude,
      };
      state.lastEvent = { at: new Date().toISOString(), ...payload };
      broadcast('detection', payload);
      return payload;
    }
    console.warn('[simulator] tick failed:', err.message);
    return null;
  }
}

export function startSimulator(intervalMs) {
  if (state.running) return status();
  if (intervalMs) state.intervalMs = Number(intervalMs);
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.warn('[simulator] tick error:', err.message);
    }
  }, state.intervalMs);
  console.log(`[simulator] fleet ingestion started (every ${state.intervalMs} ms)`);
  broadcast('simulator', { running: true, intervalMs: state.intervalMs });
  return status();
}

export function stopSimulator() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.running = false;
  broadcast('simulator', { running: false });
  return status();
}

export function status() {
  return {
    running: state.running,
    intervalMs: state.intervalMs,
    emitted: state.emitted,
    rejected: state.rejected,
    deduplicated: state.deduplicated,
    startedAt: state.startedAt,
    lastEvent: state.lastEvent,
    fleetSize: FLEET.length,
  };
}

export const fleetRoster = () =>
  FLEET.map((f) => ({ ...f, route: f.kind === 'bus' ? 'TNSTC city service' : 'CMC waste collection' }));
