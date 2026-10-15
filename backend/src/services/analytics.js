import { query } from '../db.js';
import { gradeOf } from './priority.js';

const dayKey = (offsetDays) =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Detections per day, split by damage class — powers the trend chart. */
export function trendSeries(days = 30) {
  const rows = query(
    `SELECT substr(timestamp,1,10) AS day, damage_class, COUNT(*) AS count
       FROM detections WHERE timestamp >= ? GROUP BY day, damage_class`,
    [new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')]
  );

  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, pothole: 0, alligator_crack: 0, longitudinal_crack: 0, total: 0 });
    const entry = byDay.get(r.day);
    entry[r.damage_class] = (entry[r.damage_class] || 0) + r.count;
    entry.total += r.count;
  }

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(i);
    series.push(byDay.get(key) || { day: key, pothole: 0, alligator_crack: 0, longitudinal_crack: 0, total: 0 });
  }
  return series;
}

/** Share of each damage class across the network. */
export function classMix() {
  const rows = query(
    'SELECT damage_class, COUNT(*) AS count FROM detections GROUP BY damage_class ORDER BY count DESC'
  );
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  return rows.map((r) => ({ ...r, sharePct: Math.round((r.count / total) * 100) }));
}

/** Per-zone health roll-up. */
export function zoneHealth() {
  const zones = query('SELECT DISTINCT zone_name FROM road_segments ORDER BY zone_name');
  return zones.map(({ zone_name }) => {
    const segs = query('SELECT current_pci FROM road_segments WHERE zone_name = ?', [zone_name]);
    const spots = query('SELECT priority_score, monsoon_inundation_risk FROM chronic_hotspots WHERE zone_name = ?', [zone_name]);
    const dets = query(
      `SELECT COUNT(*) AS c FROM detections WHERE zone_name = ? AND timestamp >= ?`,
      [zone_name, new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')]
    )[0].c;
    const avgPci = segs.length ? Math.round(segs.reduce((a, s) => a + s.current_pci, 0) / segs.length) : 0;
    return {
      zone_name,
      avgPci,
      segments: segs.length,
      hotspots: spots.length,
      critical: spots.filter((s) => gradeOf(s.priority_score) === 'CRITICAL').length,
      monsoonRisk: spots.filter((s) => s.monsoon_inundation_risk).length,
      detections30d: dets,
    };
  });
}

/** Grade histogram across hotspots. */
export function priorityDistribution() {
  const spots = query('SELECT priority_score FROM chronic_hotspots');
  const buckets = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const s of spots) buckets[gradeOf(s.priority_score)] += 1;
  return Object.entries(buckets).map(([grade, count]) => ({ grade, count }));
}

/** Highest-priority defects, newest state included. */
export function topHotspots(limit = 8) {
  return query(
    'SELECT * FROM chronic_hotspots ORDER BY priority_score DESC LIMIT ?',
    [limit]
  ).map((h) => ({ ...h, grade: gradeOf(h.priority_score) }));
}

/** Fleet utilisation — which vehicles are producing detections. */
export function fleetSummary() {
  return query(
    `SELECT vehicle_id,
            COUNT(*) AS detections,
            MAX(timestamp) AS last_seen,
            ROUND(AVG(confidence), 3) AS avg_confidence
       FROM detections GROUP BY vehicle_id ORDER BY detections DESC`
  );
}
