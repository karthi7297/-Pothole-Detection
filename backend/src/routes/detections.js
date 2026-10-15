import { Router } from 'express';
import { z } from 'zod';
import { one, query, run } from '../db.js';
import { DAMAGE_CLASSES } from '../config.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { broadcast } from '../services/events.js';
import { IngestError, ingestDetection } from '../services/ingest.js';
import { refreshHotspot } from '../services/hotspots.js';
import { recomputeSegmentPci } from '../services/pci.js';
import { gradeOf } from '../services/priority.js';

const router = Router();
router.use(requireAuth);

/** Paginated detection log with filters. */
router.get('/detections', (req, res) => {
  const { q, damage_class, zone, status, source, limit = 60, offset = 0 } = req.query;
  const clauses = [];
  const params = [];
  if (damage_class) { clauses.push('damage_class = ?'); params.push(damage_class); }
  if (zone) { clauses.push('zone_name = ?'); params.push(zone); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (q) {
    clauses.push('(street_name LIKE ? OR vehicle_id LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = one(`SELECT COUNT(*) AS c FROM detections ${where}`, params).c;
  const items = query(
    `SELECT * FROM detections ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(500, Number(limit)), Number(offset)]
  );
  res.json({ total, limit: Number(limit), offset: Number(offset), items });
});

router.get('/detections/:id', (req, res, next) => {
  const row = one('SELECT * FROM detections WHERE id = ?', [req.params.id]);
  if (!row) return next(httpError(404, 'Detection not found.', 'DETECTION_NOT_FOUND'));
  res.json(row);
});

const ingestSchema = z.object({
  vehicle_id: z.string().trim().min(2).max(60),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  damage_class: z.enum(DAMAGE_CLASSES),
  confidence: z.number().gte(0).lte(1),
  bbox_area_ratio: z.number().gt(0).lte(1),
  image_url: z.string().trim().max(400).optional().nullable(),
  source: z.enum(['edge', 'simulator', 'manual']).optional(),
  timestamp: z.string().trim().max(30).optional(),
});

/** The single write path for road-damage observations. */
router.post('/detections', requireCapability('detections:ingest'), (req, res, next) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(
      httpError(400, 'Detection payload failed validation.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors)
    );
  }
  try {
    const result = ingestDetection(parsed.data, { user: req.user });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof IngestError) {
      return next(httpError(err.status, err.message, err.code, err.details));
    }
    next(err);
  }
});

const reviewSchema = z.object({
  status: z.enum(['Pending', 'Verified', 'Rejected', 'Dispatched', 'Repaired']),
});

/** Field verification of an individual observation. */
router.patch('/detections/:id', requireCapability('detections:review'), (req, res, next) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return next(httpError(400, 'Invalid status.', 'VALIDATION_ERROR'));

  const row = one('SELECT * FROM detections WHERE id = ?', [req.params.id]);
  if (!row) return next(httpError(404, 'Detection not found.', 'DETECTION_NOT_FOUND'));

  run('UPDATE detections SET status = ? WHERE id = ?', [parsed.data.status, req.params.id]);

  const hotspot = row.hotspot_id ? refreshHotspot(row.hotspot_id) : null;
  if (row.segment_id) recomputeSegmentPci(row.segment_id);

  audit({
    userId: req.user.id,
    userEmail: req.user.email,
    action: 'detection.review',
    entity: 'detection',
    entityId: row.id,
    detail: `status=${parsed.data.status} (${row.damage_class} on ${row.street_name})`,
  });

  const updated = one('SELECT * FROM detections WHERE id = ?', [req.params.id]);
  broadcast('detection:review', { ...updated, grade: gradeOf(hotspot?.priority_score ?? 0) });
  res.json(updated);
});

export default router;
