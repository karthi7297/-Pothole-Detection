/**
 * RoadPulse Coimbatore — deterministic municipal seed.
 *
 * Drives the real pipeline rather than writing derived tables by hand:
 *   corridors → fleet observations → DBSCAN clustering → hotspots
 *   → defect-based PCI → PCI history backfill → monsoon flags → work orders
 *
 * Re-running is safe (schema is rebuilt).   npm run seed
 */
import bcrypt from 'bcryptjs';
import { CHRONIC_MIN_SAMPLES, DEDUP_RADIUS_M } from './config.js';
import { db, one, query, resetSchema, run } from './db.js';
import { audit } from './services/audit.js';
import { centroid, dbscan, dominantClass } from './services/clustering.js';
import { nearestSegment } from './services/geo.js';
import { rebuildHotspots } from './services/hotspots.js';
import { assessMonsoonRisk } from './services/monsoon.js';
import { computePciFromDefects, recomputeAllPci } from './services/pci.js';
import { generateWorkOrder } from './services/workOrders.js';

/* ---------- deterministic RNG: every evaluator sees the same city ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261015);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const lerp = (a, b, t) => a + (b - a) * t;
const DAY = 86_400_000;

/** SQLite-friendly timestamp `daysAgo` in the past. */
const stamp = (daysAgo, hour = 9) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, Math.floor(rand() * 60), 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

/* ---------- 1. Road network: 12 real Coimbatore corridors ---------- */
const SEGMENTS = [
  ['SEG_AVINASHI_01', 'Avinashi Road (HOPE College Stretch)', 'East Zone', 11.0283, 76.9942, 11.0345, 77.0081, 'Arterial', 1.6],
  ['SEG_AVINASHI_02', 'Avinashi Road (Peelamedu Junction)', 'East Zone', 11.0225, 76.9821, 11.0283, 76.9942, 'Arterial', 1.3],
  ['SEG_AVINASHI_03', 'Avinashi Road (Airport - SITRA)', 'East Zone', 11.0345, 77.0081, 11.0421, 77.0224, 'Arterial', 1.8],
  ['SEG_DBROAD_01', 'DB Road (RS Puram Commercial Hub)', 'Central Zone', 11.0084, 76.9525, 11.0152, 76.9541, 'Collector', 0.9],
  ['SEG_DBROAD_02', 'DB Road (Saibaba Colony Link)', 'Central Zone', 11.0152, 76.9541, 11.0218, 76.9522, 'Collector', 0.8],
  ['SEG_METTU_01', 'Mettupalayam Road (Saibaba Colony)', 'North Zone', 11.0251, 76.9482, 11.0388, 76.9451, 'Arterial', 1.5],
  ['SEG_METTU_02', 'Mettupalayam Road (Thudiyalur)', 'North Zone', 11.0388, 76.9451, 11.0512, 76.9389, 'Arterial', 1.7],
  ['SEG_TRICHY_01', 'Trichy Road (Singanallur Junction)', 'South Zone', 10.9981, 76.9924, 11.0025, 77.0112, 'Arterial', 1.9],
  ['SEG_TRICHY_02', 'Trichy Road (Ondipudur Industrial)', 'South Zone', 11.0025, 77.0112, 11.0089, 77.0281, 'Arterial', 1.6],
  ['SEG_SATHY_01', 'Sathy Road (Ganapathy)', 'North Zone', 11.0189, 76.9721, 11.0289, 76.9812, 'Arterial', 1.2],
  ['SEG_POLLACHI_01', 'Pollachi Road (Ukkadam - Eachanari)', 'South Zone', 10.9891, 76.9581, 10.9812, 76.9451, 'Collector', 1.4],
  ['SEG_VILANKURICHI_01', 'Vilankurichi Road (Kalapatti)', 'East Zone', 11.0321, 76.9721, 11.0412, 76.9812, 'Residential', 1.1],
];

/* ---------- 2. Defect sites: recurring sub-base failures ----------
 * [segmentIndex, positionAlong, dominantClass, sightings, spanDays]        */
const DEFECT_SITES = [
  [0, 0.30, 'pothole', 14, 175], [0, 0.55, 'alligator_crack', 7, 150], [0, 0.80, 'pothole', 5, 120],
  [1, 0.40, 'pothole', 6, 140], [1, 0.75, 'longitudinal_crack', 3, 90],
  [2, 0.50, 'alligator_crack', 4, 110], [2, 0.85, 'longitudinal_crack', 2, 60],
  [3, 0.30, 'alligator_crack', 7, 160], [3, 0.70, 'pothole', 4, 100],
  [4, 0.50, 'longitudinal_crack', 2, 55],
  [5, 0.25, 'pothole', 15, 178], [5, 0.60, 'alligator_crack', 12, 172], [5, 0.90, 'pothole', 4, 95],
  [6, 0.40, 'pothole', 5, 130], [6, 0.80, 'longitudinal_crack', 3, 80],
  [7, 0.30, 'longitudinal_crack', 3, 85], [7, 0.65, 'pothole', 2, 50],
  [8, 0.50, 'alligator_crack', 4, 105], [8, 0.85, 'longitudinal_crack', 2, 45],
  [9, 0.35, 'pothole', 6, 145], [9, 0.70, 'alligator_crack', 3, 75],
  [10, 0.30, 'alligator_crack', 4, 115], [10, 0.70, 'pothole', 7, 155],
  [11, 0.40, 'longitudinal_crack', 2, 40], [11, 0.75, 'pothole', 2, 35],
];

const VEHICLES = ['TNSTC_BUS_CB_101', 'TNSTC_BUS_CB_104', 'TNSTC_BUS_CB_112', 'TNSTC_BUS_CB_207',
  'TNSTC_BUS_CB_215', 'CMC_TRUCK_03', 'CMC_TRUCK_07', 'CMC_TRUCK_11', 'CMC_JEEP_11'];
const CLASS_MIX = ['pothole', 'pothole', 'pothole', 'pothole', 'alligator_crack', 'alligator_crack', 'alligator_crack', 'longitudinal_crack', 'longitudinal_crack', 'longitudinal_crack'];
const STATUS_POOL = ['Pending', 'Pending', 'Pending', 'Verified', 'Verified', 'Dispatched', 'Repaired'];

const USERS = [
  ['executive@cmc.gov.in', 'Arun Kumar', 'executive'],
  ['inspector@cmc.gov.in', 'Priya Rajan', 'inspector'],
  ['driver@tnstc.in', 'Murugan S.', 'driver'],
];
const PASSWORD = 'roadpulse123';

const WARDS = ['CMC Ward 32 Office (East)', 'CMC Ward 12 Office (Central)',
  'CMC Ward 45 Office (North)', 'CMC Ward 28 Office (South)', 'CMC Ward 07 Office (West)'];

/* ---------- PCI history backfill ---------- */
const HISTORY_POINTS = [90, 75, 60, 45, 30, 21, 14, 7];

/**
 * Replay the clustering pipeline at past cut-offs so the dashboard has a real
 * degradation curve instead of a synthetic one.
 */
function backfillHistory() {
  const detections = query('SELECT * FROM detections ORDER BY id');
  const segments = query('SELECT * FROM road_segments'); // DB rows: nearestSegment needs column names
  if (!detections.length) return 0;

  let written = 0;
  for (const daysAgo of HISTORY_POINTS) {
    const cutoff = new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 19).replace('T', ' ');
    const visible = detections.filter((d) => d.timestamp <= cutoff);
    if (!visible.length) continue;

    const { clusters } = dbscan(visible, { epsMeters: DEDUP_RADIUS_M, minSamples: CHRONIC_MIN_SAMPLES });
    const perSegment = new Map();

    for (const idxs of clusters) {
      const members = idxs.map((i) => visible[i]);
      const { lat, lon } = centroid(members);
      const near = nearestSegment({ lat, lon }, segments);
      if (!near || near.distance > 400) continue;
      const id = near.segment.segment_id;
      if (!perSegment.has(id)) perSegment.set(id, []);
      perSegment.get(id).push({ dominant_class: dominantClass(members), detection_count: members.length });
    }

    for (const s of segments) {
      const pci = computePciFromDefects({ hotspots: perSegment.get(s.segment_id) || [] });
      run('INSERT INTO pci_history (segment_id, pci, recorded_at) VALUES (?,?,?)', [s.segment_id, pci, cutoff]);
      written += 1;
    }
  }
  return written;
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log('\n  Seeding RoadPulse Coimbatore…\n');
  resetSchema();

  /* 1 — users */
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const insUser = db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?,?,?,?)');
  const userIds = {};
  for (const [email, name, role] of USERS) {
    userIds[role] = Number(insUser.run(email, name, role, hash).lastInsertRowid);
  }
  console.log(`  ✓ ${USERS.length} users (executive / inspector / driver)`);

  /* 2 — corridors */
  const insSeg = db.prepare(
    `INSERT INTO road_segments
       (segment_id, street_name, zone_name, start_lat, start_lon, end_lat, end_lon, road_type, length_km, current_pci)
     VALUES (?,?,?,?,?,?,?,?,?,100)`
  );
  for (const s of SEGMENTS) insSeg.run(...s);
  console.log(`  ✓ ${SEGMENTS.length} corridors across 5 zones`);

  /* 3 — fleet observations */
  const insDet = db.prepare(
    `INSERT INTO detections
       (timestamp, vehicle_id, latitude, longitude, damage_class, confidence, bbox_area_ratio,
        street_name, zone_name, road_type, segment_id, source, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  let detections = 0;
  const JITTER = 0.000028; // ≈ ±3 m — inside the 5 m clustering radius

  for (const [si, t, dom, sightings, span] of DEFECT_SITES) {
    const s = SEGMENTS[si];
    const lat = lerp(s[3], s[5], t);
    const lon = lerp(s[4], s[6], t);

    for (let i = 0; i < sightings; i++) {
      // Oldest sighting first, newest within the last few days.
      const progress = i / Math.max(1, sightings - 1);
      const daysAgo = Math.max(0.2, span * (1 - progress) + between(-2, 2));
      const cls = rand() < 0.8 ? dom : pick(CLASS_MIX);
      insDet.run(
        stamp(daysAgo, Math.floor(between(6, 21))),
        pick(VEHICLES),
        Number((lat + between(-JITTER, JITTER)).toFixed(6)),
        Number((lon + between(-JITTER, JITTER)).toFixed(6)),
        cls,
        Number(between(0.62, 0.97).toFixed(2)),
        Number((cls === 'pothole' ? between(0.07, 0.16) : cls === 'alligator_crack' ? between(0.09, 0.19) : between(0.02, 0.06)).toFixed(3)),
        s[1], s[2], s[7], s[0], 'edge',
        i < sightings - 1 ? pick(['Verified', 'Dispatched']) : 'Pending'
      );
      detections++;
    }
  }

  // Loose one-off observations — the long tail that has not clustered yet.
  for (let i = 0; i < 45; i++) {
    const s = pick(SEGMENTS);
    const t = between(0.05, 0.95);
    insDet.run(
      stamp(between(0.5, 100), Math.floor(between(6, 21))),
      pick(VEHICLES),
      Number((lerp(s[3], s[5], t) + between(-0.0009, 0.0009)).toFixed(6)),
      Number((lerp(s[4], s[6], t) + between(-0.0009, 0.0009)).toFixed(6)),
      pick(CLASS_MIX),
      Number(between(0.61, 0.94).toFixed(2)),
      Number(between(0.02, 0.11).toFixed(3)),
      s[1], s[2], s[7], s[0], 'edge',
      pick(['Pending', 'Pending', 'Verified'])
    );
    detections++;
  }
  console.log(`  ✓ ${detections} fleet observations over 180 days`);

  /* 4 — cluster into hotspots via the live DBSCAN path */
  const clustered = rebuildHotspots();
  console.log(`  ✓ ${clustered.clusters} spatial clusters → ${clustered.hotspots} hotspots`);

  /* 5 — PCI history + current reading */
  const historyRows = backfillHistory();
  recomputeAllPci();
  const pci = one('SELECT ROUND(AVG(current_pci)) AS avg, MIN(current_pci) AS min, MAX(current_pci) AS max FROM road_segments');
  console.log(`  ✓ PCI history (${historyRows} readings) · city avg ${pci.avg} (min ${pci.min}, max ${pci.max})`);

  /* 6 — monsoon exposure */
  const risk = await assessMonsoonRisk({ hotspots: query('SELECT * FROM chronic_hotspots') });
  for (const id of risk.exposedHotspots) {
    run('UPDATE chronic_hotspots SET monsoon_inundation_risk = 1 WHERE hotspot_id = ?', [id]);
  }
  console.log(`  ✓ monsoon assessment (${risk.forecast.source}, peak ${risk.peakRainMm} mm/day) → ${risk.exposedHotspots.length} exposed`);

  /* 7 — operator state + AI work orders */
  const hotspots = query('SELECT * FROM chronic_hotspots ORDER BY priority_score DESC');
  if (hotspots[0]) {
    run('UPDATE chronic_hotspots SET status = ?, assigned_ward_office = ? WHERE hotspot_id = ?',
      ['Dispatched', WARDS[0], hotspots[0].hotspot_id]);
  }
  if (hotspots[1]) run("UPDATE chronic_hotspots SET status = 'Verified' WHERE hotspot_id = ?", [hotspots[1].hotspot_id]);

  let issued = 0;
  for (const h of hotspots.slice(0, 4)) {
    if (!h.is_chronic) continue;
    await generateWorkOrder({
      hotspot: h,
      ward: h.assigned_ward_office || pick(WARDS),
      user: { id: userIds.executive, email: 'executive@cmc.gov.in' },
    });
    issued++;
  }
  console.log(`  ✓ ${issued} AI dispatch work orders issued`);

  /* 8 — governance trail */
  audit({
    userId: userIds.executive, userEmail: 'executive@cmc.gov.in', action: 'system.seed',
    entity: 'database', detail: `Seeded ${SEGMENTS.length} corridors and ${detections} observations`,
  });
  audit({
    userId: userIds.inspector, userEmail: 'inspector@cmc.gov.in', action: 'detection.review',
    entity: 'detection', detail: 'Verified Avinashi Road (HOPE College) cluster',
  });

  const summary = one(`SELECT
      (SELECT COUNT(*) FROM road_segments)                         AS segments,
      (SELECT COUNT(*) FROM detections)                            AS detections,
      (SELECT COUNT(*) FROM chronic_hotspots)                      AS hotspots,
      (SELECT COUNT(*) FROM chronic_hotspots WHERE is_chronic = 1) AS chronic,
      (SELECT COUNT(*) FROM chronic_hotspots WHERE priority_score > 35) AS critical,
      (SELECT COUNT(*) FROM work_orders)                           AS workOrders`);

  console.log('\n  ─────────────────────────────────────────────');
  console.log(`   corridors      ${summary.segments}`);
  console.log(`   detections     ${summary.detections}`);
  console.log(`   hotspots       ${summary.hotspots}  (${summary.chronic} chronic · ${summary.critical} critical)`);
  console.log(`   work orders    ${summary.workOrders}`);
  console.log(`   avg city PCI   ${pci.avg}/100`);
  console.log('  ─────────────────────────────────────────────');
  console.log(`\n  Demo logins — password: ${PASSWORD}`);
  console.log('   executive  executive@cmc.gov.in');
  console.log('   inspector  inspector@cmc.gov.in');
  console.log('   driver     driver@tnstc.in\n');
}

main().catch((err) => {
  console.error('\n  ✗ seed failed:', err);
  process.exit(1);
});
