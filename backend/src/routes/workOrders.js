import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { requireAuth, requireCapability, requireRole } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { generateWorkOrder, getWorkOrder, listWorkOrders } from '../services/workOrders.js';

const router = Router();
router.use(requireAuth);

router.get('/work-orders', requireCapability('workorders:read'), (req, res) => {
  res.json(listWorkOrders(Math.min(200, Number(req.query.limit) || 50)));
});

router.get('/work-orders/:id', requireCapability('workorders:read'), (req, res, next) => {
  const wo = getWorkOrder(Number(req.params.id));
  if (!wo) return next(httpError(404, 'Work order not found.', 'WORK_ORDER_NOT_FOUND'));
  res.json(wo);
});

const createSchema = z.object({
  hotspot_id: z.coerce.number().int().positive(),
  ward: z.string().trim().max(120).optional(),
});

/** Executive-only: issue an AI-assisted dispatch order. */
router.post(
  '/work-orders',
  requireRole('executive'),
  asyncHandler(async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(httpError(400, 'hotspot_id is required.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));
    }
    const hotspot = one('SELECT * FROM chronic_hotspots WHERE hotspot_id = ?', [parsed.data.hotspot_id]);
    if (!hotspot) return next(httpError(404, 'Hotspot not found.', 'HOTSPOT_NOT_FOUND'));

    const result = await generateWorkOrder({
      hotspot,
      ward: parsed.data.ward || hotspot.assigned_ward_office || 'CMC Ward 32 Office',
      user: req.user,
    });
    res.status(201).json(result);
  })
);

export default router;
