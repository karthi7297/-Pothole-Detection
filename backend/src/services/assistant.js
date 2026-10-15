import {
  CONFIDENCE_GATE,
  HOTSPOT_MIN_OBSERVATIONS,
  LLM_MODEL,
  MONSOON_RAIN_THRESHOLD_MM,
  OPENROUTER_KEY,
} from '../config.js';
import { one, query } from '../db.js';
import { gradeOf } from './priority.js';
import { detectionsLast24h, reportSourceCounts, reportStatusCounts } from './ingest.js';
import { fleetRoster, status as simulatorStatus } from './simulator.js';

/**
 * In-app assistant ("RoadPulse Assistant").
 *
 * Scope: the Field Inspector role only. It answers questions about the page the
 * inspector is currently looking at, grounded in the same live rows the page
 * itself renders — no invented numbers.
 *
 * Two answer paths:
 *   1. LLM (OpenRouter) grounded with a page snapshot, when a key is configured
 *      and the provider is reachable. Bounded by a timeout + circuit breaker so
 *      an unreachable provider can never hang the operator.
 *   2. A deterministic, on-page-data answerer that covers the questions this
 *      role actually asks (counts, ranked defects, definitions, how-tos).
 */

const LLM_TIMEOUT_MS = 9000;
let llmDown = false; // circuit breaker: set once the provider fails, never retried

const CLASS_LABEL = {
  pothole: 'Pothole',
  alligator_crack: 'Alligator crack',
  longitudinal_crack: 'Longitudinal crack',
};

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const bullets = (items) => items.filter(Boolean).map((i) => `• ${i}`).join('\n');
const numbered = (items) => items.filter(Boolean).map((i, n) => `${n + 1}. ${i}`).join('\n');

/* --------------------------------------------------------------- glossary -- */
const GLOSSARY = {
  pending: 'Pending — a report that has arrived but has not been reviewed by a field inspector yet.',
  verified: 'Verified — an inspector accepted the report as genuine road damage.',
  rejected: 'Rejected — an inspector declined the report as noise or a duplicate.',
  dispatched: 'Dispatched — a work order has been issued and a repair crew is assigned.',
  repaired: 'Repaired — the repair is complete and the defect is closed.',
  'priority score':
    'Priority score = severity × traffic multiplier + report count + monsoon bonus. Higher means repair sooner.',
  grade: 'Grade — the priority-score band: LOW (<10), MEDIUM (10–22), HIGH (22–35), CRITICAL (≥35).',
  pci: 'PCI (Pavement Condition Index) — a 0–100 road-health score. 100 is a new road; lower is worse.',
  chronic:
    'Chronic defect — a spot reported repeatedly over time that patching no longer fixes; it needs reconstruction.',
  hotspot: `Hotspot — a cluster of at least ${HOTSPOT_MIN_OBSERVATIONS} reports in one small radius.`,
  'confidence gate': `Confidence gate — detections below ${CONFIDENCE_GATE} confidence are treated as noise and held out.`,
  'monsoon risk': `Monsoon risk — a defect that floods. Flagged when the forecast crosses ${MONSOON_RAIN_THRESHOLD_MM} mm.`,
};

/* ------------------------------------------------------------ page guide -- */
const FALLBACK_GUIDE = {
  eyebrow: 'RoadPulse',
  title: 'RoadPulse Console',
  purpose: 'The field-inspector console for verifying reports and working defects to completion.',
  steps: [
    'Review incoming reports in the Report Inbox.',
    'Rank and verify defects in the Triage Queue.',
    'Issue and advance work orders to completion.',
  ],
  suggestions: ['What should I look at first?', 'How many reports are pending?', 'What are the most critical defects?'],
};

const PAGE_GUIDE = {
  '/reports': {
    eyebrow: 'Verification',
    title: 'Report Inbox',
    purpose:
      'Every road-damage report lands here as Pending. You review each one and accept it (Verify) or decline it (Reject). Accepting feeds the defect into its hotspot and the Triage Queue.',
    steps: [
      'Open the report and check the photo, damage class, confidence and location.',
      'Accept genuine damage with Verify, or Reject noise and duplicates.',
      'Accepted reports join the hotspot and surface in the Triage Queue.',
    ],
    suggestions: [
      'How many reports are pending?',
      'Which report should I review first?',
      'How do I verify a report?',
      'What does the confidence gate mean?',
    ],
  },
  '/triage': {
    eyebrow: 'Verification',
    title: 'Triage Queue',
    purpose:
      'Verified, clustered defects ranked by priority score. This is where you decide what the city repairs first and issue a work order.',
    steps: [
      'Filter the queue by grade, status or chronic flag.',
      'Open a defect to see its evidence, cost estimate and history.',
      'Issue a work order for the defect you want dispatched.',
    ],
    suggestions: [
      'What are the most critical hotspots?',
      'How is the priority score calculated?',
      'How many chronic hotspots are there?',
      'Which defects are at monsoon risk?',
    ],
  },
  '/work-orders': {
    eyebrow: 'Dispatch',
    title: 'Work Orders',
    purpose:
      'The dispatch register. Orders move Issued → Approved → In Progress → Completed; completing one marks the underlying hotspot Repaired.',
    steps: [
      'Pick a verified defect and issue a work order with a ward office.',
      'Approve the order to dispatch the crew.',
      'Advance it to In Progress, then Completed when the road is fixed.',
    ],
    suggestions: [
      'How many work orders are open?',
      'How do I complete a work order?',
      'What is the total committed budget?',
      'Which work orders are in progress?',
    ],
  },
  '/map': {
    eyebrow: 'Geospatial',
    title: 'Map Operations',
    purpose:
      'A live map of every tracked defect and the fleet vehicles reporting them, so you can see where the damage is concentrated.',
    steps: [
      'Zoom to a zone to inspect nearby defects.',
      'Click a marker to open the defect or report behind it.',
      'Cross-check with the fleet vehicles passing through.',
    ],
    suggestions: [
      'How many defects are on the map?',
      'Which zone has the most defects?',
      'What do the marker colours mean?',
    ],
  },
  '/monsoon': {
    eyebrow: 'Predictive maintenance',
    title: 'Monsoon Watch',
    purpose:
      'The rainfall forecast crossed with the defects that flood. When rain is forecast above the threshold, exposed hotspots are flagged for pre-monsoon repair.',
    steps: [
      'Watch the 7-day rainfall forecast against the threshold.',
      'Check which hotspots are flagged for inundation risk.',
      'Prioritise those defects before the rain arrives.',
    ],
    suggestions: [
      'Is monsoon risk active?',
      'Which hotspots flood?',
      'What is the rainfall threshold?',
      'What does monsoon risk mean?',
    ],
  },
  '/fleet': {
    eyebrow: 'Passive ingestion',
    title: 'Fleet & Ingestion',
    purpose:
      'The passive ingestion network — TNSTC buses and CMC trucks with dashcams that stream damage detections automatically, plus the demo simulator.',
    steps: [
      'Check which vehicles are streaming and their latest observations.',
      'Watch the live detection feed and the confidence-gate rejections.',
      'Start or stop the simulator when needed.',
    ],
    suggestions: [
      'Is the simulator running?',
      'How many vehicles are reporting?',
      'How many detections came in today?',
      'What is the confidence gate?',
    ],
  },
  '/overview': {
    eyebrow: 'Oversight',
    title: 'City Overview',
    purpose: 'City-wide road-health and operations KPIs, computed live from the database.',
    steps: [
      'Read the headline KPIs: PCI, active potholes, critical defects.',
      'Follow the trend and class mix charts.',
      'Drill into the Triage Queue for the detail.',
    ],
    suggestions: [
      'What is the city PCI?',
      'How many active potholes are there?',
      'How many critical hotspots?',
    ],
  },
  '/network': {
    eyebrow: 'Asset condition',
    title: 'Corridor Health',
    purpose: 'Per-corridor road condition (PCI) across the city, worst first.',
    steps: ['Scan corridors by PCI.', 'Open a corridor to see its defects.', 'Feed the worst into the Triage Queue.'],
    suggestions: ['Which corridors are worst?', 'What is PCI?', 'How many corridors are there?'],
  },
  '/governance': {
    eyebrow: 'Accountability',
    title: 'Governance & Audit',
    purpose: 'The audit trail of every action officials have taken in the system.',
    steps: ['Filter the log by action or user.', 'Confirm each change is attributable.'],
    suggestions: ['What actions are logged?', 'Who changed things recently?'],
  },
};

export function normalizePage(input) {
  let p = String(input || '').trim();
  if (!p) return '/reports';
  p = p.split('?')[0].split('#')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '/') return '/overview';
  return PAGE_GUIDE[p] ? p : '/reports';
}

/* ---------------------------------------------------------------- helpers -- */
const byGrade = (rows) => {
  const out = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const h of rows) out[gradeOf(h.priority_score)] += 1;
  return out;
};

const byStatus = (rows, key = 'status') => {
  const out = {};
  for (const r of rows) out[r[key]] = (out[r[key]] || 0) + 1;
  return out;
};

const openOrder = (w) => !['Completed', 'Cancelled'].includes(w.status);

const describeHotspot = (h) => {
  if (!h) return null;
  const bits = [
    `#${h.hotspot_id} ${h.street_name} (${h.zone_name})`,
    `${gradeOf(h.priority_score)} · priority ${Math.round(Number(h.priority_score) || 0)}`,
    `${h.detection_count} report(s)`,
    h.status,
  ];
  if (h.is_chronic) bits.push('chronic');
  if (h.monsoon_inundation_risk) bits.push('monsoon-risk');
  return bits.join(' — ');
};

const describeReport = (r) =>
  r
    ? `Report #${r.id} — ${CLASS_LABEL[r.damage_class] || r.damage_class} on ${r.street_name} (${r.zone_name}), ${Math.round(
        (Number(r.confidence) || 0) * 100
      )}% confidence, status ${r.status}`
    : null;

const describeWorkOrder = (w) =>
  w
    ? `WO #${w.work_order_id} — ${w.priority_level || '—'} for hotspot #${w.hotspot_id}, status ${w.status}, ${inr(
        w.estimated_budget_inr
      )} budget, ${w.assigned_ward_office || 'ward unassigned'}`
    : null;

/* --------------------------------------------------------------- snapshot -- */
function cityStats() {
  const status = reportStatusCounts();
  const hs = query(
    'SELECT priority_score, is_chronic, monsoon_inundation_risk FROM chronic_hotspots'
  );
  const wos = query('SELECT status FROM work_orders');
  const segs = query('SELECT current_pci FROM road_segments');
  const grades = byGrade(hs);

  return {
    reports: {
      total: status.total,
      Pending: status.Pending || 0,
      Verified: status.Verified || 0,
      Rejected: status.Rejected || 0,
      Dispatched: status.Dispatched || 0,
      Repaired: status.Repaired || 0,
    },
    hotspots: {
      total: hs.length,
      ...grades,
      chronic: hs.filter((h) => h.is_chronic).length,
      monsoon: hs.filter((h) => h.monsoon_inundation_risk).length,
    },
    workOrders: {
      total: wos.length,
      open: wos.filter(openOrder).length,
      byStatus: byStatus(wos),
    },
    segments: segs.length,
    avgPci: segs.length
      ? Math.round(segs.reduce((a, s) => a + s.current_pci, 0) / segs.length)
      : 0,
    fleet: fleetRoster().length,
    detections24h: detectionsLast24h(),
    topHotspots: query(
      'SELECT * FROM chronic_hotspots ORDER BY priority_score DESC LIMIT 6'
    ),
  };
}

function buildSnapshot(page) {
  const city = cityStats();
  const snap = { city };

  if (page === '/reports') {
    snap.pendingTotal = one("SELECT COUNT(*) c FROM detections WHERE status = 'Pending'").c;
    snap.pending = query(
      `SELECT id, street_name, zone_name, damage_class, confidence, source, status, timestamp
         FROM detections WHERE status = 'Pending' ORDER BY timestamp DESC LIMIT 8`
    );
    snap.sources = reportSourceCounts();
  }

  if (page === '/triage') {
    const hs = query('SELECT * FROM chronic_hotspots');
    snap.total = hs.length;
    snap.byGrade = byGrade(hs);
    snap.byStatus = byStatus(hs);
    snap.chronic = hs.filter((h) => h.is_chronic).length;
    snap.monsoon = hs.filter((h) => h.monsoon_inundation_risk).length;
    snap.top = [...hs].sort((a, b) => b.priority_score - a.priority_score).slice(0, 6);
  }

  if (page === '/work-orders') {
    const wos = query('SELECT * FROM work_orders ORDER BY work_order_id DESC');
    snap.total = wos.length;
    snap.byStatus = byStatus(wos);
    snap.budget = wos.reduce((a, w) => a + (Number(w.estimated_budget_inr) || 0), 0);
    snap.open = wos.filter(openOrder).slice(0, 6);
  }

  if (page === '/map') {
    const hs = query('SELECT is_chronic FROM chronic_hotspots');
    snap.hotspots = hs.length;
    snap.chronic = hs.filter((h) => h.is_chronic).length;
    snap.zones = query(
      'SELECT zone_name, COUNT(*) c FROM chronic_hotspots GROUP BY zone_name ORDER BY c DESC'
    );
    snap.segments = one('SELECT COUNT(*) c FROM road_segments').c;
    snap.fleet = city.fleet;
  }

  if (page === '/monsoon') {
    const exposed = query(
      'SELECT * FROM chronic_hotspots WHERE monsoon_inundation_risk = 1 ORDER BY priority_score DESC'
    );
    snap.thresholdMm = MONSOON_RAIN_THRESHOLD_MM;
    snap.exposedCount = exposed.length;
    snap.exposed = exposed.slice(0, 6);
  }

  if (page === '/fleet') {
    snap.simulator = simulatorStatus();
    snap.fleetSize = city.fleet;
    snap.detections24h = city.detections24h;
    snap.sources = reportSourceCounts();
  }

  if (page === '/overview' || page === '/network') {
    const segs = query('SELECT * FROM road_segments ORDER BY current_pci ASC');
    snap.segments = segs.length;
    snap.avgPci = city.avgPci;
    snap.worst = segs.slice(0, 6);
  }

  if (page === '/governance') {
    snap.total = one('SELECT COUNT(*) c FROM audit_log').c;
    snap.recent = query(
      'SELECT action, entity, entity_id, user_email, created_at FROM audit_log ORDER BY id DESC LIMIT 5'
    );
  }

  return snap;
}

/* ------------------------------------------------------- deterministic Q&A -- */
function lookupById(page, snap, message) {
  const m = message.toLowerCase();
  const woM = m.match(/\b(?:wo|work\s*order)\s*#?\s*(\d+)/);
  const hsM = m.match(/\b(?:hotspot|hs|defect)\s*#?\s*(\d+)/);
  const rpM = m.match(/\b(?:report|detection)\s*#?\s*(\d+)/);
  const hashM = m.match(/#\s*(\d+)/);

  if (woM) {
    const w = one('SELECT * FROM work_orders WHERE work_order_id = ?', [Number(woM[1])]);
    return w ? describeWorkOrder(w) : `I couldn't find a work order #${woM[1]} in the register.`;
  }
  if (hsM) {
    const h = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [Number(hsM[1])]);
    return h ? describeHotspot(h) : `I couldn't find a hotspot #${hsM[1]}.`;
  }
  if (rpM) {
    const r = one('SELECT * FROM detections WHERE id = ?', [Number(rpM[1])]);
    return r ? describeReport(r) : `I couldn't find a report #${rpM[1]}.`;
  }
  if (hashM) {
    const id = Number(hashM[1]);
    const h = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [id]);
    if (h) return describeHotspot(h);
    const r = one('SELECT * FROM detections WHERE id = ?', [id]);
    if (r) return describeReport(r);
    const w = one('SELECT * FROM work_orders WHERE work_order_id = ?', [id]);
    if (w) return describeWorkOrder(w);
    return `I couldn't find anything with the id #${id}.`;
  }
  return null;
}

function countAnswer(snap, m) {
  const c = snap.city;

  if (/\b(in the last 24|today|last 24|24 h|24h)\b/.test(m)) {
    return `${c.detections24h} detections arrived in the last 24 hours.`;
  }
  if (/\bpending\b/.test(m)) {
    return `${c.reports.Pending} report(s) are Pending review right now.`;
  }
  if (/\bverified\b/.test(m)) return `${c.reports.Verified} reports are Verified.`;
  if (/\brejected\b/.test(m)) return `${c.reports.Rejected} reports are Rejected.`;
  if (/\brepaired\b/.test(m)) return `${c.reports.Repaired} reports are Repaired; ${c.workOrders.byStatus.Completed || 0} work orders are Completed.`;
  if (/\bdispatched\b/.test(m)) return `${c.reports.Dispatched} reports are Dispatched.`;
  if (/\bchronic\b/.test(m)) return `${c.hotspots.chronic} hotspots are flagged chronic — patching no longer fixes them.`;
  if (/\b(monsoon|flood|inundat)\b/.test(m)) return `${c.hotspots.monsoon} hotspots are at monsoon inundation risk.`;
  if (/\bcritical\b/.test(m)) return `${c.hotspots.CRITICAL} hotspots are CRITICAL grade.`;
  if (/\bhigh\b/.test(m)) return `${c.hotspots.HIGH} hotspots are HIGH grade.`;
  if (/\bwork\s*orders?\b|\bwo\b/.test(m)) {
    if (/\b(open|active|in progress|pending)\b/.test(m)) {
      return `${c.workOrders.open} work orders are open (not yet Completed or Cancelled).`;
    }
    const parts = Object.entries(c.workOrders.byStatus).map(([k, v]) => `${v} ${k}`);
    return `${c.workOrders.total} work orders in the register — ${parts.join(', ')}.`;
  }
  if (/\bvehicles?\b|\bbuses?\b|\btrucks?\b|\bfleet\b/.test(m)) {
    return `${c.fleet} fleet vehicles are in the passive-ingestion network.`;
  }
  if (/\breports?\b|\bdetections?\b/.test(m)) {
    return `${c.reports.total} reports in total — ${c.reports.Pending} Pending, ${c.reports.Verified} Verified, ${c.reports.Rejected} Rejected.`;
  }
  if (/\bhotspots?\b|\bdefects?\b/.test(m)) {
    return `${c.hotspots.total} tracked hotspots — ${c.hotspots.CRITICAL} CRITICAL, ${c.hotspots.HIGH} HIGH, ${c.hotspots.chronic} chronic.`;
  }
  if (/\bsegments?\b|\bcorridors?\b|\broads?\b/.test(m)) {
    return `${c.segments} road corridors are monitored; average city PCI is ${c.avgPci}/100.`;
  }
  return `Current picture: ${c.reports.total} reports (${c.reports.Pending} pending), ${c.hotspots.total} hotspots (${c.hotspots.CRITICAL} critical), ${c.workOrders.open} open work orders.`;
}

function glossaryAnswer(m) {
  for (const [key, value] of Object.entries(GLOSSARY)) {
    if (m.includes(key)) return value;
  }
  return null;
}

function queueAnswer(page, snap) {
  if (page === '/reports' && snap.pending?.length) {
    return `You have ${snap.pendingTotal} report(s) to review in the Report Inbox.\nNewest:\n${bullets(
      snap.pending.slice(0, 3).map(describeReport)
    )}\n\nOpen them in the Report Inbox — Verify genuine damage, Reject noise.`;
  }
  if (page === '/triage' && snap.top?.length) {
    return `Top of the Triage Queue:\n${bullets(
      snap.top.slice(0, 4).map(describeHotspot)
    )}\n\nOpen a defect to verify it and issue a work order.`;
  }
  if (page === '/work-orders' && snap.open?.length) {
    return `Open work orders:\n${bullets(snap.open.slice(0, 4).map(describeWorkOrder))}`;
  }
  return `Highest-priority defects right now:\n${bullets(
    snap.city.topHotspots.slice(0, 4).map(describeHotspot)
  )}`;
}

function ruleAnswer(message, page, snap, guide) {
  const m = message.toLowerCase().trim();

  if (/^\s*(hi|hii|hello|hey|yo|namaste|good (morning|afternoon|evening))\b/.test(m)) {
    return `Hello — I'm your RoadPulse assistant for field inspectors. You're on the ${guide.title} page. ${guide.purpose}\n\nTry asking:\n${bullets(
      guide.suggestions.slice(0, 3)
    )}`;
  }

  const byId = lookupById(page, snap, message);
  if (byId) return byId;

  if (/\b(help|what can you|what do you do|who are you|what is this page|what'?s this page|guide me|how do i use)\b/.test(m)) {
    return `${guide.title} — ${guide.purpose}\n\nHow to work this page:\n${numbered(
      guide.steps
    )}\n\nAsk me about any number, a specific defect, or a term on this page.`;
  }

  if (/\b(how many|how much|count|number of|total)\b/.test(m)) {
    return countAnswer(snap, m);
  }

  if (/\b(how do i|how to|how can i|what do i do|steps|process|workflow)\b/.test(m)) {
    return `On the ${guide.title} page:\n${numbered(guide.steps)}`;
  }

  if (
    /\b(what does|what is|what'?s|meaning|mean|explain|define|definition)\b/.test(m) ||
    /how (?:is|are|does|do)\b.*\b(calculated|computed|derived|defined|works?)\b/.test(m) ||
    /\bformula\b/.test(m)
  ) {
    const g = glossaryAnswer(m);
    if (g) return g;
  }

  if (/\b(monsoon|rain|flood|inundat|waterlog)\b/.test(m)) {
    if (page === '/monsoon' && snap.exposed) {
      return `Monsoon risk triggers when the forecast crosses ${snap.thresholdMm} mm. ${snap.exposedCount} hotspot(s) are flagged as flooding.\n${bullets(
        snap.exposed.slice(0, 4).map(describeHotspot)
      )}`;
    }
    return `${snap.city.hotspots.monsoon} hotspots are flagged at monsoon inundation risk. Open Monsoon Watch to see them against the ${MONSOON_RAIN_THRESHOLD_MM} mm threshold.`;
  }

  if (/\b(fleet|vehicles?|buses|trucks|simulator|dashcam|camera|ingest)\b/.test(m)) {
    if (page === '/fleet' && snap.simulator) {
      const s = snap.simulator;
      return `The ingestion network has ${snap.fleetSize} vehicles. The simulator is ${
        s.running ? `running every ${Math.round(s.intervalMs / 1000)}s` : 'stopped'
      }; it has emitted ${s.emitted} detections and rejected ${s.rejected}. ${snap.detections24h} detections arrived in the last 24 h.`;
    }
    return `The passive-ingestion network runs ${snap.city.fleet} dashcam vehicles (TNSTC buses + CMC trucks); ${snap.city.detections24h} detections arrived in the last 24 h.`;
  }

  if (/\b(cost|budget|money|saving|spend|rupee|inr|₹|crore|lakh)\b/.test(m)) {
    if (page === '/work-orders' && snap.budget != null) {
      return `${inr(snap.budget)} is committed across ${snap.total} work orders; ${snap.city.workOrders.open} are open.`;
    }
    return `Work orders carry cost estimates per defect. Open a hotspot in the Triage Queue or a Work Order to see its estimated patch and reconstruction cost.`;
  }

  if (/\b(pci|pavement|corridor|network|condition)\b/.test(m)) {
    if ((page === '/overview' || page === '/network') && snap.worst) {
      return `Average city PCI is ${snap.avgPci}/100 across ${snap.segments} corridors. Worst corridors:\n${bullets(
        snap.worst.map((s) => `${s.street_name} (${s.zone_name}) — PCI ${s.current_pci}`)
      )}`;
    }
    return `PCI (Pavement Condition Index) scores road health 0–100; the city average is ${snap.city.avgPci}/100 across ${snap.city.segments} corridors.`;
  }

  if (/\b(zones?|wards?|streets?|where|location|area)\b/.test(m)) {
    if (page === '/map' && snap.zones) {
      return `Defects by zone:\n${bullets(
        snap.zones.map((z) => `${z.zone_name} — ${z.c} hotspot(s)`)
      )}`;
    }
    const zones = query(
      'SELECT zone_name, COUNT(*) c FROM chronic_hotspots GROUP BY zone_name ORDER BY c DESC LIMIT 6'
    );
    return `Defects by zone:\n${bullets(zones.map((z) => `${z.zone_name} — ${z.c} hotspot(s)`))}`;
  }

  if (/\b(pending|queue|backlog|today|next|should i|start with|first)\b/.test(m)) {
    return queueAnswer(page, snap);
  }

  if (/\b(top|worst|most critical|highest|rank|priority|critical)\b/.test(m)) {
    return `Highest-priority defects right now:\n${bullets(
      snap.city.topHotspots.map(describeHotspot)
    )}`;
  }

  if (m.split(/\s+/).length <= 4) {
    const g = glossaryAnswer(m);
    if (g) return g;
  }

  return `${guide.title} — ${guide.purpose}\n\nHere's the live picture: ${snap.city.reports.Pending} reports pending, ${snap.city.hotspots.CRITICAL} critical hotspots, ${snap.city.workOrders.open} open work orders.\n\nAsk me about any of these, a specific report/hotspot/work-order id, or a term like "priority score".`;
}

/* ------------------------------------------------------------------ LLM -- */
function renderSnapshot(page, snap) {
  const c = snap.city;
  const L = [];
  L.push(
    `Reports: ${c.reports.total} total — ${c.reports.Pending} Pending, ${c.reports.Verified} Verified, ${c.reports.Rejected} Rejected, ${c.reports.Dispatched} Dispatched, ${c.reports.Repaired} Repaired.`
  );
  L.push(
    `Hotspots: ${c.hotspots.total} total — ${c.hotspots.CRITICAL} CRITICAL, ${c.hotspots.HIGH} HIGH, ${c.hotspots.MEDIUM} MEDIUM, ${c.hotspots.LOW} LOW; ${c.hotspots.chronic} chronic; ${c.hotspots.monsoon} at monsoon risk.`
  );
  L.push(
    `Work orders: ${c.workOrders.total} total, ${c.workOrders.open} open (${Object.entries(c.workOrders.byStatus)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}).`
  );
  L.push(
    `Network: ${c.segments} corridors, avg PCI ${c.avgPci}/100. Fleet: ${c.fleet} vehicles. Detections last 24h: ${c.detections24h}.`
  );
  L.push(`Top hotspots: ${c.topHotspots.map(describeHotspot).join(' | ')}`);

  if (page === '/reports' && snap.pending?.length) {
    L.push(`Newest pending reports: ${snap.pending.map(describeReport).join(' | ')}`);
  }
  if (page === '/work-orders' && snap.open?.length) {
    L.push(`Open work orders: ${snap.open.map(describeWorkOrder).join(' | ')}`);
  }
  if (page === '/monsoon' && snap.exposed) {
    L.push(
      `Monsoon threshold ${snap.thresholdMm} mm; exposed hotspots: ${snap.exposed.map(describeHotspot).join(' | ') || 'none'}`
    );
  }
  if (page === '/fleet' && snap.simulator) {
    L.push(
      `Simulator ${snap.simulator.running ? `running every ${Math.round(snap.simulator.intervalMs / 1000)}s` : 'stopped'}; emitted ${snap.simulator.emitted}, rejected ${snap.simulator.rejected}.`
    );
  }
  if (page === '/map' && snap.zones) {
    L.push(`Hotspots by zone: ${snap.zones.map((z) => `${z.zone_name} ${z.c}`).join(', ')}`);
  }
  return L.join('\n');
}

function buildSystemPrompt(guide, snap, page) {
  return [
    'You are "RoadPulse Assistant", embedded in a municipal road-maintenance web app.',
    'You are helping a FIELD INSPECTOR for Coimbatore Municipal Corporation.',
    `They are currently on the "${guide.title}" page. Purpose of this page: ${guide.purpose}`,
    '',
    'Rules:',
    '- Answer only questions about RoadPulse and this page. If asked something unrelated, briefly redirect to what this page covers.',
    '- Use ONLY the LIVE DATA below. Never invent numbers, names or IDs. If a figure is not listed, say you do not have it and point to where in the app to look.',
    '- Be concise: 2–5 sentences or a short list. Plain text, no markdown symbols.',
    '- Refer to the user as the field inspector.',
    '',
    'GLOSSARY:',
    ...Object.entries(GLOSSARY).map(([k, v]) => `- ${k}: ${v}`),
    '',
    'LIVE DATA:',
    renderSnapshot(page, snap),
  ].join('\n');
}

async function callLlm(messages, timeoutMs = LLM_TIMEOUT_MS) {
  if (!OPENROUTER_KEY || llmDown) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const hardStop = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs + 750));

  try {
    const work = (async () => {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 500, temperature: 0.2 }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() || null;
    })();

    const text = await Promise.race([work, hardStop]);
    if (!text) llmDown = true; // provider answered nothing — stop retrying
    return text;
  } catch {
    llmDown = true;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Warm the provider once at startup. If OpenRouter is unreachable, the circuit
 * breaker opens in the background so the inspector's first question is answered
 * instantly from live data instead of waiting for a timeout. Fire-and-forget.
 */
if (OPENROUTER_KEY) {
  callLlm([{ role: 'user', content: 'ping' }], 4000).catch(() => {});
}

/* -------------------------------------------------------------- public API -- */
export async function answer({ message, page, history = [], user }) {
  const p = normalizePage(page);
  const guide = PAGE_GUIDE[p] || FALLBACK_GUIDE;
  const snap = buildSnapshot(p);

  if (OPENROUTER_KEY && !llmDown) {
    const messages = [
      { role: 'system', content: buildSystemPrompt(guide, snap, p) },
      ...history
        .slice(-6)
        .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content)
        .map((h) => ({ role: h.role, content: String(h.content).slice(0, 2000) })),
      { role: 'user', content: message },
    ];
    const text = await callLlm(messages);
    if (text) {
      return { reply: text, source: 'ai', page: p, title: guide.title, suggestions: guide.suggestions };
    }
  }

  return {
    reply: ruleAnswer(message, p, snap, guide),
    source: 'live',
    page: p,
    title: guide.title,
    suggestions: guide.suggestions,
  };
}

/** Page-specific greeting, starter questions and headline facts for the panel. */
export function pageIntro(page, user) {
  const p = normalizePage(page);
  const guide = PAGE_GUIDE[p] || FALLBACK_GUIDE;
  const snap = buildSnapshot(p);
  const c = snap.city;

  const fact = (label, value) => ({ label, value: String(value) });
  let facts = [];

  switch (p) {
    case '/reports':
      facts = [
        fact('Pending', c.reports.Pending),
        fact('Verified', c.reports.Verified),
        fact('Rejected', c.reports.Rejected),
      ];
      break;
    case '/triage':
      facts = [
        fact('Hotspots', c.hotspots.total),
        fact('Critical', c.hotspots.CRITICAL),
        fact('Chronic', c.hotspots.chronic),
      ];
      break;
    case '/work-orders':
      facts = [
        fact('Orders', c.workOrders.total),
        fact('Open', c.workOrders.open),
        fact('Committed', inr(snap.budget || 0)),
      ];
      break;
    case '/map':
      facts = [fact('Hotspots', c.hotspots.total), fact('Zones', snap.zones?.length || 0), fact('Fleet', c.fleet)];
      break;
    case '/monsoon':
      facts = [
        fact('Risk hotspots', snap.exposedCount || 0),
        fact('Threshold', `${MONSOON_RAIN_THRESHOLD_MM} mm`),
      ];
      break;
    case '/fleet':
      facts = [
        fact('Vehicles', c.fleet),
        fact('Last 24h', c.detections24h),
        fact('Simulator', snap.simulator?.running ? 'running' : 'stopped'),
      ];
      break;
    case '/network':
      facts = [fact('Corridors', c.segments), fact('Avg PCI', `${c.avgPci}/100`)];
      break;
    case '/governance':
      facts = [fact('Log entries', snap.total || 0)];
      break;
    default:
      facts = [
        fact('Avg PCI', `${c.avgPci}/100`),
        fact('Hotspots', c.hotspots.total),
        fact('Critical', c.hotspots.CRITICAL),
      ];
  }

  return {
    page: p,
    title: guide.title,
    eyebrow: guide.eyebrow,
    purpose: guide.purpose,
    greeting: `Hi ${user?.name?.split(' ')[0] || 'there'} — I'm your RoadPulse assistant. Ask me anything about the ${guide.title} page; I answer from live data.`,
    suggestions: guide.suggestions,
    facts,
    aiEnabled: !!OPENROUTER_KEY && !llmDown,
  };
}
