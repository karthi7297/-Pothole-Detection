import { Router } from 'express';
import { one, query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { pciBand } from '../services/pci.js';
import { gradeOf } from '../services/priority.js';

const router = Router();
router.use(requireAuth);

router.get('/segments', (req, res) => {
  const { zone, band } = req.query;
  let rows = query('SELECT * FROM road_segments ORDER BY current_pci ASC');
  if (zone) rows = rows.filter((s) => s.zone_name === zone);
  const enriched = rows.map((s) => ({ ...s, band: pciBand(s.current_pci) }));
  res.json(band ? enriched.filter((s) => s.band === band) : enriched);
});

router.get('/segments/:id', (req, res, next) => {
  const segment = one('SELECT * FROM road_segments WHERE segment_id = ?', [req.params.id]);
  if (!segment) return next(httpError(404, 'Road segment not found.', 'SEGMENT_NOT_FOUND'));

  const detections = query(
    'SELECT * FROM detections WHERE segment_id = ? ORDER BY timestamp DESC LIMIT 100',
    [req.params.id]
  );
  const hotspots = query(
    'SELECT * FROM chronic_hotspots WHERE zone_name = ? AND street_name = ? ORDER BY priority_score DESC',
    [segment.zone_name, segment.street_name]
  ).map((h) => ({ ...h, grade: gradeOf(h.priority_score) }));

  res.json({ ...segment, band: pciBand(segment.current_pci), detections, hotspots });
});

export default router;
