import { PCI_DEDUCTION } from '../config.js';
import { one, query, run } from '../db.js';

/**
 * PRD 4.5 — Pavement Condition Index (IRC:82 style surface rating, 0–100).
 *
 * Modelling note: the PRD expresses the deduction per *occurrence*, but a raw
 * detection is only one observation of a defect — the fleet passes the same
 * pothole dozens of times. Deducting per observation drives every corridor to
 * 0 within a week. We therefore deduct per **defect** (a clustered hotspot),
 * with a capped recurrence penalty so a repeatedly-reported defect scores
 * worse than a fresh one without saturating the scale.
 */
const UNCLUSTERED_DEDUCTION = 1;
const UNCLUSTERED_CAP = 10;
const RECURRENCE_CAP = 6;

export function pciBand(pci) {
  if (pci >= 80) return 'GOOD';
  if (pci >= 50) return 'FAIR';
  return 'POOR';
}

/** Deduction for a single physical defect. */
export function defectDeduction(hotspot) {
  const base = PCI_DEDUCTION[hotspot.dominant_class] ?? 4;
  const recurrence = Math.min(RECURRENCE_CAP, Math.floor((hotspot.detection_count || 1) / 2));
  return base + recurrence;
}

/** Pure: turn a defect inventory into a PCI score. */
export function computePciFromDefects({ hotspots = [], looseDetections = 0 }) {
  let pci = 100;
  for (const h of hotspots) pci -= defectDeduction(h);
  pci -= Math.min(UNCLUSTERED_CAP, looseDetections * UNCLUSTERED_DEDUCTION);
  return Math.max(0, Math.min(100, Math.round(pci)));
}

/** Every defect and stray observation currently attributed to a segment. */
export function segmentDefects(segmentId) {
  const hotspots = query('SELECT * FROM chronic_hotspots WHERE segment_id = ?', [segmentId]);
  const loose = one(
    'SELECT COUNT(*) AS c FROM detections WHERE segment_id = ? AND hotspot_id IS NULL AND status != ?',
    [segmentId, 'Repaired']
  ).c;
  return { hotspots, loose };
}

export function computeSegmentPci(segmentId) {
  const { hotspots, loose } = segmentDefects(segmentId);
  return computePciFromDefects({ hotspots, looseDetections: loose });
}

/**
 * Recompute one corridor and record the reading in `pci_history`
 * (pass `record: false` when back-filling historical points).
 */
export function recomputeSegmentPci(segmentId, { record = true, at = null } = {}) {
  const pci = computeSegmentPci(segmentId);
  run('UPDATE road_segments SET current_pci = ?, last_updated = CURRENT_TIMESTAMP WHERE segment_id = ?', [
    pci,
    segmentId,
  ]);
  if (record) {
    run('INSERT INTO pci_history (segment_id, pci, recorded_at) VALUES (?,?,COALESCE(?, CURRENT_TIMESTAMP))', [
      segmentId,
      pci,
      at,
    ]);
  }
  return pci;
}

export function recomputeAllPci(opts = {}) {
  const segments = query('SELECT segment_id FROM road_segments');
  for (const s of segments) recomputeSegmentPci(s.segment_id, opts);
  return segments.length;
}

/** Network-average PCI as it stood `daysAgo`, read from recorded history. */
export function pciAt(daysAgo) {
  const segments = query('SELECT segment_id FROM road_segments');
  if (!segments.length) return null;
  const cutoff = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

  let sum = 0;
  let counted = 0;
  for (const s of segments) {
    const row = one(
      'SELECT pci FROM pci_history WHERE segment_id = ? AND recorded_at <= ? ORDER BY recorded_at DESC LIMIT 1',
      [s.segment_id, cutoff]
    );
    if (row) {
      sum += row.pci;
      counted += 1;
    }
  }
  return counted ? Math.round(sum / counted) : null;
}

/** Per-corridor trend series for charts: [{ segment_id, street_name, points: [{date, pci}] }] */
export function pciTrend(days = 90) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const segments = query('SELECT segment_id, street_name, zone_name FROM road_segments');
  return segments.map((s) => ({
    ...s,
    points: query(
      `SELECT substr(recorded_at,1,10) AS date, ROUND(AVG(pci)) AS pci
         FROM pci_history WHERE segment_id = ? AND recorded_at >= ?
        GROUP BY date ORDER BY date`,
      [s.segment_id, since]
    ),
  }));
}
