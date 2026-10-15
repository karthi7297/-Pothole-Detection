import {
  CHRONIC_MIN_SAMPLES,
  CHRONIC_WINDOW_DAYS,
  DEDUP_RADIUS_M,
  DEDUP_WINDOW_H,
  HOTSPOT_MIN_OBSERVATIONS,
} from '../config.js';
import { one, query, run, tx } from '../db.js';
import { centroid, dbscan, dominantClass } from './clustering.js';
import { annualisedSaving, reconstructionCost, sunkPatchSpend } from './costing.js';
import { haversineMeters, nearestSegment } from './geo.js';
import { gradeOf, priorityScore } from './priority.js';

const MAX_SNAP_M = 400;

/** Authoritative road-segment attribution for a coordinate. */
function segmentIdFor(lat, lon, segments) {
  const near = nearestSegment({ lat, lon }, segments);
  return near && near.distance <= MAX_SNAP_M ? near.segment.segment_id : null;
}

/**
 * Distinct vehicles that reported within `radius` metres.
 *
 * PRD 4.2 defines report count as unique fleet observations within 5 m — the
 * 24 h window applies only to same-vehicle deduplication. Scoping this to a
 * single day would zero it out for historical data, so we use the chronic
 * window here.
 */
function reportCountNear(lat, lon, hours = CHRONIC_WINDOW_DAYS * 24, radius = DEDUP_RADIUS_M) {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = query(
    'SELECT vehicle_id, latitude, longitude FROM detections WHERE timestamp >= ?',
    [since]
  );
  const vehicles = new Set();
  for (const r of rows) {
    if (haversineMeters(lat, lon, r.latitude, r.longitude) <= radius) vehicles.add(r.vehicle_id);
  }
  return Math.max(1, vehicles.size);
}

function hydrate(row, reportCount) {
  const monsoon = !!row.monsoon_inundation_risk;
  const score = priorityScore({
    bbox_area_ratio: row.bbox_area_ratio ?? 0.08,
    confidence: row.confidence ?? 0.8,
    road_type: row.road_type,
    reportCount,
    monsoon,
  });
  return { score, grade: gradeOf(score) };
}

/** Find the hotspot that already owns this location, if any. */
function findHotspotNear(lat, lon, radius = DEDUP_RADIUS_M * 1.6) {
  const rows = query('SELECT * FROM chronic_hotspots');
  let best = null;
  for (const h of rows) {
    const d = haversineMeters(lat, lon, h.center_lat, h.center_lon);
    if (d <= radius && (!best || d < best.distance)) best = { hotspot: h, distance: d };
  }
  return best?.hotspot || null;
}

/**
 * Recompute a single hotspot from the detections that fall inside it.
 * Called on every ingestion so the map updates in real time.
 */
export function refreshHotspot(hotspotId) {
  const members = query('SELECT * FROM detections WHERE hotspot_id = ?', [hotspotId]);
  if (!members.length) {
    run('DELETE FROM chronic_hotspots WHERE hotspot_id = ?', [hotspotId]);
    return null;
  }

  const latest = members.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
  const { lat, lon } = centroid(members);
  const cls = dominantClass(members);
  const reportCount = reportCountNear(lat, lon);
  const { score, grade } = hydrate({ ...latest, road_type: latest.road_type }, reportCount);
  const chronic = members.length >= CHRONIC_MIN_SAMPLES ? 1 : 0;
  const first = members.reduce((a, b) => (a.timestamp < b.timestamp ? a : b));
  const segmentId = segmentIdFor(lat, lon, query('SELECT * FROM road_segments'));

  run(
    `UPDATE chronic_hotspots SET
       center_lat = ?, center_lon = ?, detection_count = ?, is_chronic = ?,
       priority_score = ?, dominant_class = ?, road_type = ?, segment_id = ?,
       estimated_patch_cost_inr = ?, estimated_reconstruct_cost_inr = ?,
       first_detected_at = ?, last_detected_at = ?
     WHERE hotspot_id = ?`,
    [
      lat, lon, members.length, chronic,
      score, cls, latest.road_type || 'Arterial', segmentId,
      sunkPatchSpend(members.length), reconstructionCost(latest.road_type),
      first.timestamp, latest.timestamp, hotspotId,
    ]
  );

  return { hotspot_id: hotspotId, priority_score: score, grade, is_chronic: !!chronic, detection_count: members.length };
}

/**
 * Full DBSCAN pass over the chronic window — used by the seed script and the
 * periodic maintenance job. Existing hotspots are matched by proximity so
 * operator state (status, assigned ward) survives the rebuild.
 */
export function rebuildHotspots() {
  const since = new Date(Date.now() - CHRONIC_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const rows = query('SELECT * FROM detections WHERE timestamp >= ? ORDER BY id', [since]);
  if (!rows.length) return { clusters: 0, hotspots: 0 };

  const { clusters } = dbscan(rows, { epsMeters: DEDUP_RADIUS_M, minSamples: HOTSPOT_MIN_OBSERVATIONS });
  const existing = query('SELECT * FROM chronic_hotspots');
  const segments = query('SELECT * FROM road_segments');
  const claimed = new Set();

  return tx(() => {
    let created = 0;
    for (const idxs of clusters) {
      const members = idxs.map((i) => rows[i]);
      const { lat, lon } = centroid(members);
      const cls = dominantClass(members);
      const latest = members.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
      const reportCount = reportCountNear(lat, lon);
      const { score } = hydrate({ ...latest, road_type: latest.road_type }, reportCount);
      const chronic = members.length >= CHRONIC_MIN_SAMPLES ? 1 : 0;
      const segmentId = segmentIdFor(lat, lon, segments);

      // Match to a pre-existing hotspot within ~1.6× the dedup radius.
      let target = null;
      for (const h of existing) {
        if (claimed.has(h.hotspot_id)) continue;
        if (haversineMeters(lat, lon, h.center_lat, h.center_lon) <= DEDUP_RADIUS_M * 1.6) {
          target = h;
          break;
        }
      }

      let id;
      if (target) {
        id = target.hotspot_id;
        claimed.add(id);
        run(
          `UPDATE chronic_hotspots SET center_lat=?, center_lon=?, detection_count=?, is_chronic=?,
             priority_score=?, dominant_class=?, road_type=?, segment_id=?, estimated_patch_cost_inr=?,
             estimated_reconstruct_cost_inr=?, last_detected_at=? WHERE hotspot_id=?`,
          [
            lat, lon, members.length, chronic, score, cls, latest.road_type, segmentId,
            sunkPatchSpend(members.length), reconstructionCost(latest.road_type),
            latest.timestamp, id,
          ]
        );
      } else {
        const info = run(
          `INSERT INTO chronic_hotspots
             (center_lat, center_lon, street_name, zone_name, road_type, segment_id, detection_count,
              is_chronic, priority_score, dominant_class, estimated_patch_cost_inr,
              estimated_reconstruct_cost_inr, first_detected_at, last_detected_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            lat, lon, latest.street_name, latest.zone_name, latest.road_type, segmentId, members.length,
            chronic, score, cls, sunkPatchSpend(members.length),
            reconstructionCost(latest.road_type), members[0].timestamp, latest.timestamp,
          ]
        );
        id = Number(info.lastInsertRowid);
        created += 1;
      }

      for (const m of members) run('UPDATE detections SET hotspot_id = ? WHERE id = ?', [id, m.id]);
    }

    // Drop hotspots that no longer have any supporting detections.
    for (const h of existing) {
      if (claimed.has(h.hotspot_id)) continue;
      const live = one('SELECT COUNT(*) AS c FROM detections WHERE hotspot_id = ?', [h.hotspot_id]);
      if (!live || live.c === 0) run('DELETE FROM chronic_hotspots WHERE hotspot_id = ?', [h.hotspot_id]);
    }

    return { clusters: clusters.length, hotspots: created };
  });
}

/** Aggregate savings + sunk-cost figures across chronic hotspots. */
export function savingsSummary() {
  const chronic = query('SELECT * FROM chronic_hotspots WHERE is_chronic = 1');
  const all = query('SELECT * FROM chronic_hotspots');
  return {
    chronicCount: chronic.length,
    annualSavingsInr: chronic.reduce(
      (a, h) => a + annualisedSaving({ detectionCount: h.detection_count, roadType: h.road_type }),
      0
    ),
    sunkPatchSpendInr: all.reduce((a, h) => a + sunkPatchSpend(h.detection_count), 0),
    reconstructionBacklogInr: chronic.reduce((a, h) => a + reconstructionCost(h.road_type), 0),
  };
}
