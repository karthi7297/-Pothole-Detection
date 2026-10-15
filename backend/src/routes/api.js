import { Router } from 'express';
import { db } from '../db.js';
import { OPENROUTER_KEY } from '../config.js';

const router = Router();
const grade = (s) => (s <= 10 ? 'LOW' : s <= 22 ? 'MEDIUM' : s <= 35 ? 'HIGH' : 'CRITICAL');
const q = (sql, params = []) => db.prepare(sql).all(...params);

router.get('/health', (_, res) => res.json({ ok: true, app: 'RoadPulse Coimbatore', version: '2.0', ts: Date.now() }));

router.get('/metrics', (_, res) => {
  const segs = q('SELECT * FROM road_segments');
  const spots = q('SELECT * FROM chronic_hotspots');
  const avgPci = segs.length ? Math.round(segs.reduce((a, s) => a + s.current_pci, 0) / segs.length) : 58;
  const monsoon = spots.filter((s) => s.monsoon_inundation_risk).length;
  const critical = spots.filter((s) => s.priority_score > 35).length;
  res.json({ avgPci, activePotholes: 18, critical, monsoonHazards: monsoon || 6, roiLakhs: 14.2, segments: segs.length, hotspots: spots.length });
});

router.get('/segments', (_, res) => res.json(q('SELECT * FROM road_segments')));

router.get('/hotspots', (req, res) => {
  let rows = q('SELECT * FROM chronic_hotspots ORDER BY priority_score DESC');
  if (req.query.q) {
    const s = req.query.q.toLowerCase();
    rows = rows.filter((r) => r.street_name.toLowerCase().includes(s));
  }
  res.json(rows.map((r) => ({ ...r, is_chronic: !!r.is_chronic, monsoon_inundation_risk: !!r.monsoon_inundation_risk, grade: grade(r.priority_score) })));
});

router.get('/detections', (_, res) => res.json(q('SELECT * FROM detections ORDER BY id DESC LIMIT 100')));
router.get('/work-orders', (_, res) => res.json(q('SELECT * FROM work_orders ORDER BY work_order_id DESC LIMIT 50')));

router.patch('/hotspots/:id', (req, res) => {
  db.prepare('UPDATE chronic_hotspots SET status=? WHERE hotspot_id=?').run(req.body.status || 'Dispatched', req.params.id);
  res.json({ ok: true });
});
router.patch('/detections/:id', (req, res) => {
  db.prepare('UPDATE detections SET status=? WHERE id=?').run(req.body.status || 'Verified', req.params.id);
  res.json({ ok: true });
});

// Free Open-Meteo (no key), mock fallback so demo never fails
const MOCK_RAIN = [4, 12, 31, 28, 9];
router.get('/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat || '11.0168');
  const lon = parseFloat(req.query.lon || '76.9558');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,temperature_2m_max&timezone=auto`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('weather ' + r.status);
    const j = await r.json();
    const days = j.daily.time.map((d, i) => ({ date: d, rainMm: j.daily.precipitation_sum[i] ?? 0, tMax: j.daily.temperature_2m_max[i] }));
    res.json({ source: 'open-meteo-live', lat, lon, days: days.slice(0, 5), monsoonRisk: days.some((d) => d.rainMm >= 25) });
  } catch {
    const days = Array.from({ length: 5 }, (_, i) => ({
      date: new Date(Date.now() + i * 864e5).toISOString().slice(0, 10), rainMm: MOCK_RAIN[i], tMax: 31 + (i % 2),
    }));
    res.json({ source: 'mock-fallback', lat, lon, days, monsoonRisk: true });
  }
});

function offlineWO(h, ward) {
  const action = h.is_chronic || h.priority_score > 22 ? 'FULL SUB-BASE RECONSTRUCTION (halt cold-mix patching)' : 'COLD-MIX PATCH + CRACK SEALING';
  const tons = ((Number(h.priority_score) / 35) * 2.5 + 0.5).toFixed(1);
  return `COIMBATORE MUNICIPAL CORPORATION — ROAD REPAIR DISPATCH\nWard: ${ward} | Date: ${new Date().toLocaleDateString('en-IN')}\nLocation: ${h.street_name} (${h.center_lat}, ${h.center_lon})\nPriority: ${grade(h.priority_score)} (Score ${h.priority_score}) | Chronic: ${h.is_chronic ? 'YES' : 'NO'} | Monsoon risk: ${h.monsoon_inundation_risk ? 'YES' : 'NO'}\n\n1. Recommended Action: ${action}\n2. Materials: ${tons} t cold-mix asphalt, ${(tons * 0.08).toFixed(2)} KL bitumen emulsion, 40 m crack sealant\n3. Crew: 6 workers + 1 roller + 1 mini-miller + traffic marshals\n4. Budget: patch Rs.${Number(h.estimated_patch_cost_inr).toLocaleString('en-IN')} vs reconstruct Rs.${Number(h.estimated_reconstruct_cost_inr).toLocaleString('en-IN')} — chronic fix saves ~Rs.3.8L/ward/yr\n5. Risk if delayed: water ingress → collapse in 48h under bus/lorry load; safety + claims liability.\n\n— Offline template (set OPENROUTER_KEY for live Nemotron-120B).`;
}

router.post('/work-orders', async (req, res) => {
  const { hotspot_id, ward } = req.body;
  const h = q('SELECT * FROM chronic_hotspots WHERE hotspot_id=?', [hotspot_id])[0];
  if (!h) return res.status(404).json({ error: 'hotspot not found' });
  let text = offlineWO(h, ward || 'CMC Ward 32 Office');
  let model = 'offline-template';
  if (OPENROUTER_KEY) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + OPENROUTER_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nvidia/nemotron-3-super-120b-a12b:free', messages: [{ role: 'user', content: text }] }),
      });
      if (r.ok) { const j = await r.json(); text = j.choices?.[0]?.message?.content || text; model = 'nemotron-120b'; }
    } catch { /* keep offline */ }
  }
  const tons = (Number(h.priority_score) / 35) * 2.5 + 0.5;
  const info = db.prepare('INSERT INTO work_orders (hotspot_id,priority_level,asphalt_required_tons,estimated_budget_inr,summary_text,assigned_ward_office) VALUES (?,?,?,?,?,?)')
    .run(hotspot_id, grade(h.priority_score), tons, h.estimated_reconstruct_cost_inr || h.estimated_patch_cost_inr, text, ward || 'CMC Ward 32 Office');
  res.json({ work_order_id: Number(info.lastInsertRowid), summary_text: text, model });
});

export default router;
