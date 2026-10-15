import { Router } from 'express';
import { one } from '../db.js';
import { httpError } from '../middleware/error.js';

const router = Router();

/**
 * Human-readable meaning of each verification state. Shown to the citizen who
 * filed the report — the status trail is the whole point of "track my report".
 */
const STATUS_NOTE = {
  Pending: 'Received. A field officer will verify it shortly.',
  Verified: 'Verified by a field officer and added to the repair network.',
  Rejected: 'Reviewed and closed — the officer did not find road damage here.',
  Dispatched: 'A repair work order has been issued to the ward office.',
  Repaired: 'Repair completed. Thank you for reporting.',
};

/**
 * Public report tracking. No login required.
 *
 * A citizen (or driver) who filed a report can look it up by its numeric id and
 * follow it from "Pending" all the way to "Repaired". Only non-sensitive fields
 * are returned — never the reporter or any account detail.
 */
router.get('/reports/track/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return next(httpError(400, 'Provide a numeric report id, e.g. 1042.', 'VALIDATION_ERROR'));
  }

  const report = one(
    `SELECT id, status, damage_class, confidence, location_name, street_name, zone_name,
            latitude, longitude, image_url, hotspot_id, timestamp
       FROM detections WHERE id = ?`,
    [id]
  );
  if (!report) return next(httpError(404, 'No report found with that id.', 'DETECTION_NOT_FOUND'));

  const hotspot = report.hotspot_id
    ? one(
        'SELECT hotspot_id, street_name, zone_name, status, priority_score FROM chronic_hotspots WHERE hotspot_id = ?',
        [report.hotspot_id]
      )
    : null;

  const workOrder = report.hotspot_id
    ? one(
        `SELECT work_order_id, status, priority_level, assigned_ward_office, created_at
           FROM work_orders WHERE hotspot_id = ? ORDER BY work_order_id DESC LIMIT 1`,
        [report.hotspot_id]
      )
    : null;

  res.json({
    report,
    hotspot,
    workOrder,
    note: STATUS_NOTE[report.status] || '',
    stages: ['Pending', 'Verified', 'Dispatched', 'Repaired'],
  });
});

export default router;
