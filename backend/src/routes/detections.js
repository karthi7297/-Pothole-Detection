import { Router } from 'express';
import { z } from 'zod';
import { one, query, run } from '../db.js';
import { DAMAGE_CLASSES, REPORT_SOURCES } from '../config.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { broadcast } from '../services/events.js';
import {
  IngestError,
  ingestDetection,
  linkDetectionToHotspot,
  reportSourceCounts,
  reportStatusCounts,
} from '../services/ingest.js';
import { recomputeSegmentPci } from '../services/pci.js';
import { gradeOf } from '../services/priority.js';

const router = Router();
router.use(requireAuth);

/** Paginated report log with filters.
 * Drivers only see their own reports; Inspectors/Executives see all.
 */
router.get('/detections', (req, res) => {
  const { q, damage_class, zone, status, source, hotspot_id, limit = 60, offset = 0 } = req.query;
  const clauses = [];
  const params = [];

  if (req.user.role === 'driver') {
    clauses.push('vehicle_id = ?');
    params.push(`CITIZEN-${req.user.id}`);
  }

  if (damage_class) { clauses.push('damage_class = ?'); params.push(damage_class); }
  if (zone) { clauses.push('zone_name = ?'); params.push(zone); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (source) { clauses.push('source = ?'); params.push(source); }
  if (hotspot_id) { clauses.push('hotspot_id = ?'); params.push(Number(hotspot_id)); }
  if (q) {
    clauses.push('(street_name LIKE ? OR location_name LIKE ? OR vehicle_id LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = one(`SELECT COUNT(*) AS c FROM detections ${where}`, params).c;
  const items = query(
    `SELECT * FROM detections ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(1000, Number(limit)), Number(offset)]
  );
  res.json({ total, limit: Number(limit), offset: Number(offset), items });
});

/** City-wide report totals by verification status and by source. */
router.get('/reports/summary', (_req, res) => {
  res.json({ status: reportStatusCounts(), sources: reportSourceCounts() });
});

/** Reports awaiting field-officer acceptance. Must precede /detections/:id. */
router.get('/detections/pending', requireCapability('detections:review'), (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const total = one('SELECT COUNT(*) AS c FROM detections WHERE status = ?', ['Pending']).c;
  const items = query(
    'SELECT * FROM detections WHERE status = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    ['Pending', Math.min(200, Number(limit)), Number(offset)]
  );
  res.json({ total, limit: Number(limit), offset: Number(offset), items });
});

router.get('/detections/:id', (req, res, next) => {
  const row = one('SELECT * FROM detections WHERE id = ?', [req.params.id]);
  if (!row) return next(httpError(404, 'Report not found.', 'DETECTION_NOT_FOUND'));
  res.json(row);
});

const ingestSchema = z.object({
  vehicle_id: z.string().trim().min(2).max(60).optional().nullable(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  location_name: z.string().trim().max(140).optional().nullable(),
  damage_class: z.enum(DAMAGE_CLASSES),
  confidence: z.number().gte(0).lte(1),
  bbox_area_ratio: z.number().gt(0).lte(1),
  image_url: z.string().trim().max(400).optional().nullable(),
  source: z.enum(REPORT_SOURCES).optional(),
  timestamp: z.string().trim().max(30).optional(),
});

/**
 * The single write path for road-damage reports.
 *
 * Citizens and dashcams both post here. High-confidence frames are accepted
 * automatically; anything less is held Pending until a field officer accepts it.
 */
router.post('/detections', requireCapability('detections:ingest'), (req, res, next) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return next(
      httpError(400, 'Report payload failed validation.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors)
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
  status: z.enum(['Verified', 'Rejected']),
});

/**
 * Field-officer verification of a single report.
 *
 * Inspectors and executives accept or reject Pending reports. Accepting a
 * report is what actually admits it to the network: it clusters into a hotspot
 * and the segment PCI is recomputed at that moment.
 */
router.patch('/detections/:id', requireCapability('detections:review'), (req, res, next) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return next(httpError(400, 'Invalid status. Use Verified or Rejected.', 'VALIDATION_ERROR'));

  const row = one('SELECT * FROM detections WHERE id = ?', [req.params.id]);
  if (!row) return next(httpError(404, 'Report not found.', 'DETECTION_NOT_FOUND'));

  if (row.status !== 'Pending') {
    return next(httpError(400, `Cannot review a report with status "${row.status}". Only Pending reports can be reviewed.`, 'INVALID_TRANSITION'));
  }

  run('UPDATE detections SET status = ? WHERE id = ?', [parsed.data.status, req.params.id]);

  let hotspot = null;
  if (parsed.data.status === 'Verified') {
    const fresh = one('SELECT * FROM detections WHERE id = ?', [row.id]);
    hotspot = linkDetectionToHotspot(fresh);
    if (fresh.segment_id) recomputeSegmentPci(fresh.segment_id);
  }

  audit({
    userId: req.user.id,
    userEmail: req.user.email,
    action: 'detection.review',
    entity: 'detection',
    entityId: row.id,
    detail: `${parsed.data.status} (${row.source} ${row.damage_class} @ ${(row.confidence * 100).toFixed(0)}% on ${row.street_name})`,
  });

  const updated = one('SELECT * FROM detections WHERE id = ?', [req.params.id]);
  broadcast('detection:review', { ...updated, grade: gradeOf(hotspot?.priority_score ?? 0) });
  res.json(updated);
});

export default router;

