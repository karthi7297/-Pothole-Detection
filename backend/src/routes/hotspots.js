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

/**
 * Enrich a stored hotspot row with its derived presentation fields.
 * Grade and the 0–100 priority index are both functions of priority_score,
 * so they are computed on read rather than stored.
 */
const decorate = (row) => {
  if (!row) return row;
  const score = Number(row.priority_score) || 0;
  return { ...row, grade: gradeOf(score), priority_index: priorityIndex(score) };
};

/** List hotspots — inspectors and executives. */
router.get('/hotspots', requireCapability('hotspots:read'), (req, res) => {
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

router.get('/hotspots/:id', requireCapability('hotspots:read'), (req, res, next) => {
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

const inspectorPatchSchema = z.object({
  status: z.enum(['Verified', 'Rejected', 'Dispatched']).optional(),
  assigned_ward_office: z.string().trim().max(120).optional(),
});

/** Inspector verification / dispatch: Active → Verified/Rejected/Dispatched */
router.patch('/hotspots/:id', requireCapability('hotspots:verify'), (req, res, next) => {
  const parsed = inspectorPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(httpError(400, 'Invalid hotspot update. Allowed: Verified, Rejected, Dispatched', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));
  }
  const existing = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [req.params.id]);
  if (!existing) return next(httpError(404, 'Hotspot not found.', 'HOTSPOT_NOT_FOUND'));

  const allowedFrom = ['Active', 'Verified'];
  if (!allowedFrom.includes(existing.status)) {
    return next(httpError(400, `Cannot change status from "${existing.status}".`, 'INVALID_TRANSITION'));
  }

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
    action: 'hotspot.update.inspector',
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

/** Field officer: create a hotspot manually. */
const createHotspotSchema = z.object({
  center_lat: z.number().gte(-90).lte(90),
  center_lon: z.number().gte(-180).lte(180),
  street_name: z.string().trim().min(2).max(120),
  zone_name: z.string().trim().max(80).optional(),
  road_type: z.enum(['Arterial', 'Collector', 'Residential']).optional(),
  segment_id: z.string().optional(),
  radius_meters: z.number().positive().optional(),
});
router.post('/hotspots', requireCapability('hotspots:manage'), (req, res, next) => {
  const parsed = createHotspotSchema.safeParse(req.body);
  if (!parsed.success) return next(httpError(400, 'Invalid hotspot data.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));

  const info = run(
    `INSERT INTO chronic_hotspots
       (center_lat, center_lon, street_name, zone_name, road_type, segment_id, radius_meters, detection_count, is_chronic, priority_score, dominant_class, first_detected_at, last_detected_at)
     VALUES (?,?,?,?,?,?,?,0,0,0,'pothole',datetime('now'),datetime('now'))`,
    [
      parsed.data.center_lat, parsed.data.center_lon,
      parsed.data.street_name,
      parsed.data.zone_name || 'Central Zone',
      parsed.data.road_type || 'Arterial',
      parsed.data.segment_id || null,
      parsed.data.radius_meters || 5,
    ]
  );
  const hotspot = decorate(one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [info.lastInsertRowid]));
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'hotspot.create', entity: 'hotspot', entityId: hotspot.hotspot_id });
  broadcast('hotspot', hotspot);
  res.status(201).json(hotspot);
});

/** Field officer: delete hotspot. */
router.delete('/hotspots/:id', requireCapability('hotspots:manage'), (req, res, next) => {
  const existing = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [req.params.id]);
  if (!existing) return next(httpError(404, 'Hotspot not found.', 'HOTSPOT_NOT_FOUND'));
  run('DELETE FROM chronic_hotspots WHERE hotspot_id = ?', [req.params.id]);
  run('UPDATE detections SET hotspot_id = NULL WHERE hotspot_id = ?', [req.params.id]);
  audit({ userId: req.user.id, userEmail: req.user.email, action: 'hotspot.delete', entity: 'hotspot', entityId: req.params.id });
  broadcast('hotspot:deleted', { hotspot_id: Number(req.params.id) });
  res.status(204).send();
});

export default router;
