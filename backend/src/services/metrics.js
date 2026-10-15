import { one, query } from '../db.js';
import { pciAt, pciBand } from './pci.js';
import { gradeOf } from './priority.js';
import { savingsSummary } from './hotspots.js';
import { detectionsLast24h } from './ingest.js';

const sinceISO = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

/** Every headline KPI, computed from live rows — nothing hardcoded. */
export function computeMetrics() {
  const segments = query('SELECT * FROM road_segments');
  const hotspots = query('SELECT * FROM chronic_hotspots');

  const avgPci = segments.length
    ? Math.round(segments.reduce((a, s) => a + s.current_pci, 0) / segments.length)
    : 0;

  const activePotholes = one(
    "SELECT COUNT(*) AS c FROM detections WHERE damage_class = 'pothole' AND status != 'Repaired'"
  ).c;

  const criticalHotspots = hotspots.filter((h) => gradeOf(h.priority_score) === 'CRITICAL');
  const monsoonHazards = hotspots.filter((h) => h.monsoon_inundation_risk);
  const monsoonVulnerable = hotspots.filter(
    (h) => h.dominant_class === 'alligator_crack' || h.dominant_class === 'longitudinal_crack'
  );

  const det7 = one('SELECT COUNT(*) AS c FROM detections WHERE timestamp >= ?', [sinceISO(7)]).c;
  const det7prev = one(
    'SELECT COUNT(*) AS c FROM detections WHERE timestamp >= ? AND timestamp < ?',
    [sinceISO(14), sinceISO(7)]
  ).c;

  const total = one('SELECT COUNT(*) AS c FROM detections').c;
  const savings = savingsSummary();

  const pciNow = avgPci;
  const pciPrev = pciAt(7);
  const pciDelta = pciPrev == null ? null : pciNow - pciPrev;

  const gradeDistribution = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((grade) => ({
    grade,
    count: hotspots.filter((h) => gradeOf(h.priority_score) === grade).length,
  }));

  const lastIngest = one('SELECT MAX(timestamp) AS ts FROM detections');

  const statusCounts = { Pending: 0, Verified: 0, Rejected: 0, Dispatched: 0, Repaired: 0 };
  for (const r of query('SELECT status, COUNT(*) AS c FROM detections GROUP BY status')) {
    statusCounts[r.status] = r.c;
  }

  return {
    avgPci,
    pciBand: pciBand(avgPci),
    pciDelta,
    segments: segments.length,
    activePotholes,
    criticalHotspots: criticalHotspots.length,
    criticalHotspotIds: criticalHotspots.map((h) => h.hotspot_id),
    monsoonHazards: monsoonHazards.length,
    monsoonVulnerable: monsoonVulnerable.length,
    hotspots: hotspots.length,
    chronicCount: savings.chronicCount,
    annualSavingsInr: savings.annualSavingsInr,
    sunkPatchSpendInr: savings.sunkPatchSpendInr,
    reconstructionBacklogInr: savings.reconstructionBacklogInr,
    detections24h: detectionsLast24h(),
    detections7d: det7,
    detectionsTotal: total,
    pendingReports: statusCounts.Pending,
    verifiedReports: statusCounts.Verified,
    rejectedReports: statusCounts.Rejected,
    dispatchedReports: statusCounts.Dispatched,
    repairedReports: statusCounts.Repaired,
    detectionTrendPct: det7prev > 0 ? Math.round(((det7 - det7prev) / det7prev) * 100) : null,
    gradeDistribution,
    lastIngestAt: lastIngest?.ts || null,
    generatedAt: new Date().toISOString(),
  };
}
