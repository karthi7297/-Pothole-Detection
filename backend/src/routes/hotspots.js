import { Router } from 'express';
import { z } from 'zod';
import { one, query, run } from '../db.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { broadcast } from '../services/events.js';
import { priorityIndex, gradeOf } from '../services/priority.js';

const router = Router();
router.use(requireAuth);

const decorate = (h) => ({
  ...h,
  is_chronic: !!h.is_chronic,
  monsoon_inundation_risk: !!h.monsoon_inundation_risk,
  grade: gradeOf(h.priority_score),
  priority_index: priorityIndex(h.priority_score),
});

/** Filterable, sortable triage queue. */
router.get('/hotspots', (req, res) => {
  const { q, grade, zone, chronic, monsoon, status, sort = 'priority', limit } = req.query;
  let rows = query('SELECT * FROM chronic_hotspots').map(decorate);

  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter(
      (h) =>
        h.street_name.toLowerCase().includes(needle) ||
        (h.zone_name || '').toLowerCase().includes(needle) ||
        (h.dominant_class || '').toLowerCase().includes(needle)
    );
  }
  if (grade) rows = rows.filter((h) => h.grade === String(grade).toUpperCase());
  if (zone) rows = rows.filter((h) => h.zone_name === zone);
  if (chronic === 'true') rows = rows.filter((h) => h.is_chronic);
  if (chronic === 'false') rows = rows.filter((h) => !h.is_chronic);
  if (monsoon === 'true') rows = rows.filter((h) => h.monsoon_inundation_risk);
  if (status) rows = rows.filter((h) => h.status === status);

  const sorters = {
    priority: (a, b) => b.priority_score - a.priority_score,
    reports: (a, b) => b.detection_count - a.detection_count,
    recent: (a, b) => String(b.last_detected_at).localeCompare(String(a.last_detected_at)),
    street: (a, b) => a.street_name.localeCompare(b.street_name),
  };
  rows.sort(sorters[sort] || sorters.priority);
  if (limit) rows = rows.slice(0, Number(limit));

  res.json({ total: rows.length, items: rows });
});

router.get('/hotspots/:id', (req, res, next) => {
  const hotspot = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [req.params.id]);
  if (!hotspot) return next(httpError(404, 'Hotspot not found.', 'HOTSPOT_NOT_FOUND'));
  const detections = query(
    'SELECT * FROM detections WHERE hotspot_id = ? ORDER BY timestamp DESC LIMIT 100',
    [hotspot.hotspot_id]
  );
  const workOrders = query(
    'SELECT work_order_id, created_at, priority_level, status, assigned_ward_office, model FROM work_orders WHERE hotspot_id = ? ORDER BY work_order_id DESC',
    [hotspot.hotspot_id]
  );
  res.json({ ...decorate(hotspot), detections, workOrders });
});

const patchSchema = z.object({
  status: z.enum(['Active', 'Verified', 'Rejected', 'Dispatched', 'Repaired']).optional(),
  assigned_ward_office: z.string().trim().max(120).optional(),
});

/** Inspector verification / executive dispatch. */
router.patch('/hotspots/:id', requireCapability('hotspots:verify'), (req, res, next) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(httpError(400, 'Invalid hotspot update.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));
  }
  const existing = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [req.params.id]);
  if (!existing) return next(httpError(404, 'Hotspot not found.', 'HOTSPOT_NOT_FOUND'));

  const { status, assigned_ward_office } = parsed.data;
  run(
    `UPDATE chronic_hotspots SET
       status = COALESCE(?, status),
       assigned_ward_office = COALESCE(?, assigned_ward_office)
     WHERE hotspot_id = ?`,
    [status || null, assigned_ward_office || null, req.params.id]
  );

  audit({
    userId: req.user.id,
    userEmail: req.user.email,
    action: 'hotspot.update',
    entity: 'hotspot',
    entityId: req.params.id,
    detail: [status && `status=${status}`, assigned_ward_office && `ward=${assigned_ward_office}`]
      .filter(Boolean)
      .join(' '),
  });

  const updated = decorate(one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [req.params.id]));
  broadcast('hotspot', updated);
  res.json(updated);
});

export default router;
