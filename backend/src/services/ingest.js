import {
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
import { refreshHotspot } from './hotspots.js';
import { recomputeSegmentPci } from './pci.js';
import { gradeOf, priorityScore } from './priority.js';
import { audit } from './audit.js';

const MAX_SEGMENT_SNAP_M = 400; // detections further than this from the network stay "Unassigned"

export class IngestError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The single write path for road-damage observations.
 *
 * Pipeline (PRD 4.1 → 4.6):
 *   validate → confidence gate → snap to segment → spatial dedup
 *   → persist → refresh hotspot → recompute PCI → broadcast → audit
 */
export function ingestDetection(input, { user = null } = {}) {
  const {
    vehicle_id, latitude, longitude, damage_class, confidence,
    bbox_area_ratio, image_url = null, source = 'edge', timestamp = null,
  } = input;

  if (!DAMAGE_CLASSES.includes(damage_class)) {
    throw new IngestError(422, `Unknown damage_class "${damage_class}".`, 'INVALID_CLASS', {
      allowed: DAMAGE_CLASSES,
    });
  }

  // PRD 4.1 — edge filter gate.
  if (confidence < CONFIDENCE_GATE) {
    throw new IngestError(
      422,
      `Detection rejected: confidence ${confidence.toFixed(2)} is below the ${CONFIDENCE_GATE} gate.`,
      'BELOW_CONFIDENCE_GATE',
      { confidence, gate: CONFIDENCE_GATE }
    );
  }

  // PRD 4.6 — edge sanity check on box geometry.
  const aspect = bbox_area_ratio;
  if (aspect <= 0 || aspect > 0.6) {
    throw new IngestError(422, 'Detection rejected: bounding-box ratio is not road-anomaly shaped.', 'INVALID_BBOX', {
      bbox_area_ratio: aspect,
    });
  }

  // Snap to the nearest road segment so street/zone/road-type are authoritative.
  const segments = query('SELECT * FROM road_segments');
  const near = nearestSegment({ lat: latitude, lon: longitude }, segments);
  const snapped = near && near.distance <= MAX_SEGMENT_SNAP_M ? near.segment : null;

  const ts = timestamp || new Date().toISOString().slice(0, 19).replace('T', ' ');

  // PRD 4.6 — same vehicle re-reporting the same spot: bump pass_count only.
  const since = new Date(Date.now() - DEDUP_WINDOW_H * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  const recent = query(
    'SELECT * FROM detections WHERE vehicle_id = ? AND damage_class = ? AND timestamp >= ?',
    [vehicle_id, damage_class, since]
  );
  const duplicate = recent.find(
    (r) => haversineMeters(latitude, longitude, r.latitude, r.longitude) <= DEDUP_RADIUS_M
  );

  if (duplicate) {
    run(
      `UPDATE detections SET pass_count = pass_count + 1, timestamp = ?
       WHERE id = ?`,
      [ts, duplicate.id]
    );
    const hotspot = duplicate.hotspot_id ? refreshHotspot(duplicate.hotspot_id) : null;
    const payload = {
      kind: 'pass',
      detection_id: duplicate.id,
      vehicle_id,
      damage_class,
      confidence,
      street_name: duplicate.street_name,
      zone_name: duplicate.zone_name,
      pass_count: duplicate.pass_count + 1,
      hotspot,
      timestamp: ts,
    };
    broadcast('detection', payload);
    return { deduplicated: true, ...payload };
  }

  const inserted = run(
    `INSERT INTO detections
       (timestamp, vehicle_id, latitude, longitude, damage_class, confidence,
        bbox_area_ratio, image_url, street_name, zone_name, road_type, segment_id, source, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'Pending')`,
    [
      ts, vehicle_id, latitude, longitude, damage_class, confidence, bbox_area_ratio,
      image_url,
      snapped?.street_name || 'Unassigned',
      snapped?.zone_name || 'Central Zone',
      snapped?.road_type || 'Arterial',
      snapped?.segment_id || null,
      source,
    ]
  );
  const id = Number(inserted.lastInsertRowid);

  // Recurring-defect rule: a location becomes a tracked hotspot once it has
  // accumulated >= HOTSPOT_MIN_OBSERVATIONS sightings inside the chronic window.
  const chronicSince = new Date(Date.now() - CHRONIC_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const nearby = query(
    'SELECT * FROM detections WHERE id != ? AND timestamp >= ?',
    [id, chronicSince]
  ).filter(
    (r) => haversineMeters(latitude, longitude, r.latitude, r.longitude) <= DEDUP_RADIUS_M * 1.6
  );

  let hotspot = null;
  if (nearby.length + 1 >= HOTSPOT_MIN_OBSERVATIONS) {
    const candidates = query('SELECT * FROM chronic_hotspots');
    let owner = null;
    let bestDistance = Infinity;
    for (const h of candidates) {
      const d = haversineMeters(latitude, longitude, h.center_lat, h.center_lon);
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
          latitude, longitude,
          snapped?.street_name || 'Unassigned',
          snapped?.zone_name || 'Central Zone',
          snapped?.road_type || 'Arterial',
          snapped?.segment_id || null,
          nearby.length + 1,
          priorityScore({ bbox_area_ratio, confidence, road_type: snapped?.road_type, reportCount: 1 }),
          damage_class, ts, ts,
        ]
      );
      hotspotId = Number(info.lastInsertRowid);
    }

    run('UPDATE detections SET hotspot_id = ? WHERE id = ?', [hotspotId, id]);
    for (const r of nearby) run('UPDATE detections SET hotspot_id = ? WHERE id = ?', [hotspotId, r.id]);
    hotspot = refreshHotspot(hotspotId);
  }

  if (snapped) recomputeSegmentPci(snapped.segment_id);

  audit({
    userId: user?.id ?? null,
    userEmail: user?.email ?? `fleet:${vehicle_id}`,
    action: 'detection.ingest',
    entity: 'detection',
    entityId: id,
    detail: `${damage_class} @ ${(confidence * 100).toFixed(0)}% on ${snapped?.street_name || 'unassigned road'}`,
  });

  const payload = {
    kind: 'new',
    detection_id: id,
    vehicle_id,
    damage_class,
    confidence,
    bbox_area_ratio,
    latitude,
    longitude,
    street_name: snapped?.street_name || 'Unassigned',
    zone_name: snapped?.zone_name || 'Central Zone',
    road_type: snapped?.road_type || 'Arterial',
    segment_id: snapped?.segment_id || null,
    grade: gradeOf(hotspot?.priority_score ?? 0),
    becomes_chronic: (hotspot?.detection_count ?? 1) >= CHRONIC_MIN_SAMPLES,
    hotspot,
    timestamp: ts,
  };
  broadcast('detection', payload);
  return { deduplicated: false, ...payload };
}

/** Count of detections in the trailing 24 h — used by the live header chip. */
export function detectionsLast24h() {
  const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  return one('SELECT COUNT(*) AS c FROM detections WHERE timestamp >= ?', [since]).c;
}
