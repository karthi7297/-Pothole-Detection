import {
  AUTO_VERIFY_CONFIDENCE,
  CHRONIC_MIN_SAMPLES,
  CHRONIC_WINDOW_DAYS,
  CONFIDENCE_GATE,
  DAMAGE_CLASSES,
  DEDUP_RADIUS_M,
  DEDUP_WINDOW_H,
  HOTSPOT_MIN_OBSERVATIONS,
} from '../config.js';
import { one, query, run } from '../db.js';
import { broadcast } from './events.js';
import { haversineMeters, nearestSegment } from './geo.js';
import { composeRoadName } from './places.js';
import { refreshHotspot } from './hotspots.js';
import { recomputeSegmentPci } from './pci.js';
import { gradeOf, priorityScore } from './priority.js';
import { audit } from './audit.js';

const MAX_SEGMENT_SNAP_M = 400; // detections further than this from the network stay "Unassigned"

/** Coordinates are meaningless to a repair gang — always carry a name too. */
const tidyName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 140) || null;

export class IngestError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const daysAgoStamp = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Who filed the report. Citizens upload through the app (no vehicle); dashcams
 * stream automatically from a fleet vehicle; the simulator replays that stream.
 */
export function reporterId(source, vehicleId, user) {
  if (source === 'citizen') return `CITIZEN-${user?.id ?? 'anon'}`;
  if (vehicleId) return vehicleId;
  if (source === 'dashcam') return 'DASHCAM-UNBOUND';
  return 'EDGE-DEVICE';
}

/**
 * Verification tier for a fresh report.
 *
 *   confidence >= 0.85  → Verified  (accepted automatically)
 *   0.60 – 0.84         → Pending   (held until a field officer accepts it)
 *   < 0.60              → rejected  (below the filter gate — pure noise)
 */
export function verificationTier(confidence) {
  if (confidence >= AUTO_VERIFY_CONFIDENCE) return 'Verified';
  if (confidence >= CONFIDENCE_GATE) return 'Pending';
  return 'Rejected';
}

/**
 * Attach a report to its chronic hotspot (creating one when the site has now
 * been seen enough times). Only **Verified** reports cluster — a Pending report
 * is an unconfirmed claim and must not move PCI or priority until an officer
 * accepts it.
 */
export function linkDetectionToHotspot(row) {
  const nearby = query(
    'SELECT * FROM detections WHERE id != ? AND status = ? AND timestamp >= ?',
    [row.id, 'Verified', daysAgoStamp(CHRONIC_WINDOW_DAYS)]
  ).filter(
    (r) => haversineMeters(row.latitude, row.longitude, r.latitude, r.longitude) <= DEDUP_RADIUS_M * 1.6
  );

  if (nearby.length + 1 < HOTSPOT_MIN_OBSERVATIONS) return null;

  const candidates = query('SELECT * FROM chronic_hotspots');
  let owner = null;
  let bestDistance = Infinity;
  for (const h of candidates) {
    const d = haversineMeters(row.latitude, row.longitude, h.center_lat, h.center_lon);
    if (d <= DEDUP_RADIUS_M * 1.6 && d < bestDistance) {
      owner = h;
      bestDistance = d;
    }
  }

  let hotspotId;
  if (owner) {
    hotspotId = owner.hotspot_id;
  } else {
    const info = run(
      `INSERT INTO chronic_hotspots
         (center_lat, center_lon, street_name, zone_name, road_type, segment_id, detection_count,
          is_chronic, priority_score, dominant_class, first_detected_at, last_detected_at)
       VALUES (?,?,?,?,?,?,?,0,?,?,?,?)`,
      [
        row.latitude, row.longitude,
        row.street_name || 'Unassigned',
        row.zone_name || 'Central Zone',
        row.road_type || 'Arterial',
        row.segment_id || null,
        nearby.length + 1,
        priorityScore({
          bbox_area_ratio: row.bbox_area_ratio,
          confidence: row.confidence,
          road_type: row.road_type,
          reportCount: nearby.length + 1,
        }),
        row.damage_class, row.timestamp, row.timestamp,
      ]
    );
    hotspotId = Number(info.lastInsertRowid);
  }

  run('UPDATE detections SET hotspot_id = ? WHERE id = ?', [hotspotId, row.id]);
  for (const r of nearby) run('UPDATE detections SET hotspot_id = ? WHERE id = ?', [hotspotId, r.id]);

  return refreshHotspot(hotspotId);
}

/**
 * The single write path for road-damage reports.
 *
 * Pipeline (PRD 4.1 → 4.6):
 *   validate → confidence tier → snap to segment → spatial dedup
 *   → persist → (if verified) cluster into hotspot → recompute PCI
 *   → broadcast → audit
 */
export function ingestDetection(input, { user = null, holdBelowGate = false } = {}) {
  const {
    vehicle_id = null, latitude, longitude, damage_class, confidence,
    bbox_area_ratio, image_url = null, source = 'edge', timestamp = null,
    location_name = null,
  } = input;

  if (!DAMAGE_CLASSES.includes(damage_class)) {
    throw new IngestError(422, `Unknown damage_class "${damage_class}".`, 'INVALID_CLASS', {
      allowed: DAMAGE_CLASSES,
    });
  }

  // PRD 4.1 — the filter gate. On the automatic edge/dashcam stream anything
  // below it is discarded as noise. A human-filed report (citizen app, field
  // upload) is `holdBelowGate`: the frame may simply be unclear, and the report
  // page promises such a photo is *held for an officer*, never thrown away. The
  // measured confidence is still stored as-is, so the officer sees the flag.
  const belowGate = confidence < CONFIDENCE_GATE;
  if (belowGate && !holdBelowGate) {
    throw new IngestError(
      422,
      `Report discarded: confidence ${confidence.toFixed(2)} is below the ${CONFIDENCE_GATE} gate.`,
      'BELOW_CONFIDENCE_GATE',
      { confidence, gate: CONFIDENCE_GATE }
    );
  }

  const status = belowGate ? 'Pending' : verificationTier(confidence);

  // PRD 4.6 — sanity check on box geometry.
  if (bbox_area_ratio <= 0 || bbox_area_ratio > 0.6) {
    throw new IngestError(422, 'Report discarded: bounding-box ratio is not road-anomaly shaped.', 'INVALID_BBOX', {
      bbox_area_ratio,
    });
  }

  const reporter = reporterId(source, vehicle_id, user);
  const ts = timestamp || nowStamp();

  // Snap to the nearest road segment so street/zone/road-type are authoritative.
  const segments = query('SELECT * FROM road_segments');
  const near = nearestSegment({ lat: latitude, lon: longitude }, segments);
  const snapped = near && near.distance <= MAX_SEGMENT_SNAP_M ? near.segment : null;

  // A report must always carry a human-readable place, not just a coordinate
  // pair: the citizen's own label wins, otherwise we name it from the corridor
  // it snapped to ("Cross Cut Road, Central Zone").
  const placeName =
    tidyName(location_name) || composeRoadName(snapped?.street_name, snapped?.zone_name);

  // PRD 4.6 — same reporter re-reporting the same spot: bump pass_count only.
  const recent = query(
    'SELECT * FROM detections WHERE vehicle_id = ? AND damage_class = ? AND timestamp >= ?',
    [reporter, damage_class, daysAgoStamp(DEDUP_WINDOW_H / 24)]
  );
  const duplicate = recent.find(
    (r) => haversineMeters(latitude, longitude, r.latitude, r.longitude) <= DEDUP_RADIUS_M
  );

  if (duplicate) {
    // A confident repeat can promote a previously-unconfirmed report.
    const promote = status === 'Verified' && duplicate.status !== 'Verified';
    run('UPDATE detections SET pass_count = pass_count + 1, timestamp = ?, status = ? WHERE id = ?', [
      ts,
      promote ? 'Verified' : duplicate.status,
      duplicate.id,
    ]);

    // A later report can name a spot the first one left unnamed.
    if (placeName && !duplicate.location_name) {
      run('UPDATE detections SET location_name = ? WHERE id = ?', [placeName, duplicate.id]);
    }

    let hotspot = null;
    if (promote) {
      const fresh = one('SELECT * FROM detections WHERE id = ?', [duplicate.id]);
      hotspot = linkDetectionToHotspot(fresh);
      if (fresh.segment_id) recomputeSegmentPci(fresh.segment_id);
    } else if (duplicate.hotspot_id) {
      hotspot = refreshHotspot(duplicate.hotspot_id);
    }

    const payload = {
      kind: 'pass',
      detection_id: duplicate.id,
      vehicle_id: reporter,
      source,
      damage_class,
      confidence,
      status: promote ? 'Verified' : duplicate.status,
      promoted: promote,
      location_name: placeName || duplicate.location_name || null,
      street_name: duplicate.street_name,
      zone_name: duplicate.zone_name,
      pass_count: duplicate.pass_count + 1,
      hotspot,
      below_gate: belowGate,
      timestamp: ts,
    };
    broadcast('detection', payload);
    return { deduplicated: true, ...payload };
  }

  const inserted = run(
    `INSERT INTO detections
       (timestamp, vehicle_id, latitude, longitude, location_name, damage_class, confidence,
        bbox_area_ratio, image_url, street_name, zone_name, road_type, segment_id, source, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ts, reporter, latitude, longitude, placeName, damage_class, confidence, bbox_area_ratio,
      image_url,
      snapped?.street_name || 'Unassigned',
      snapped?.zone_name || 'Central Zone',
      snapped?.road_type || 'Arterial',
      snapped?.segment_id || null,
      source,
      status,
    ]
  );
  const id = Number(inserted.lastInsertRowid);
  const row = one('SELECT * FROM detections WHERE id = ?', [id]);

  // Only accepted reports shape the network; Pending ones wait for an officer.
  let hotspot = null;
  if (status === 'Verified') {
    hotspot = linkDetectionToHotspot(row);
    if (snapped) recomputeSegmentPci(snapped.segment_id);
  }

  audit({
    userId: user?.id ?? null,
    userEmail: user?.email ?? `${source}:${reporter}`,
    action: 'detection.ingest',
    entity: 'detection',
    entityId: id,
    detail: `${source} ${damage_class} @ ${(confidence * 100).toFixed(0)}% → ${status}${belowGate ? ' (below gate — held for review)' : ''} on ${snapped?.street_name || 'unassigned road'}`,
  });

  const payload = {
    kind: 'new',
    detection_id: id,
    vehicle_id: reporter,
    source,
    status,
    damage_class,
    confidence,
    bbox_area_ratio,
    latitude,
    longitude,
    location_name: placeName,
    street_name: snapped?.street_name || 'Unassigned',
    zone_name: snapped?.zone_name || 'Central Zone',
    road_type: snapped?.road_type || 'Arterial',
    segment_id: snapped?.segment_id || null,
    grade: gradeOf(hotspot?.priority_score ?? 0),
    becomes_chronic: (hotspot?.detection_count ?? 1) >= CHRONIC_MIN_SAMPLES,
    hotspot,
    below_gate: belowGate,
    timestamp: ts,
  };
  broadcast('detection', payload);
  return { deduplicated: false, ...payload };
}

/** Count of detections in the trailing 24 h — used by the live header chip. */
export function detectionsLast24h() {
  return one('SELECT COUNT(*) AS c FROM detections WHERE timestamp >= ?', [daysAgoStamp(1)]).c;
}

/** Report counts grouped by verification status — drives the map legend. */
export function reportStatusCounts() {
  const rows = query('SELECT status, COUNT(*) AS c FROM detections GROUP BY status');
  const out = { total: 0, Pending: 0, Verified: 0, Rejected: 0 };
  for (const r of rows) {
    out[r.status] = r.c;
    out.total += r.c;
  }
  return out;
}

/** Report counts grouped by where they came from — citizens vs dashcams. */
export function reportSourceCounts() {
  const rows = query('SELECT source, COUNT(*) AS c FROM detections GROUP BY source ORDER BY c DESC');
  return rows.map((r) => ({ source: r.source, count: r.c }));
}
