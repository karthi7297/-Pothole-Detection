import { Router } from 'express';
import { z } from 'zod';
import { one, run } from '../db.js';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { generateWorkOrder, getWorkOrder, listWorkOrders } from '../services/workOrders.js';

const router = Router();
router.use(requireAuth);

/** List work orders — executives and inspectors both read the register. */
router.get('/work-orders', requireCapability('workorders:read'), (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.json(listWorkOrders(limit));
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

/** Field officer: issue an AI-assisted dispatch order for a verified defect. */
router.post(
  '/work-orders',
  requireCapability('workorders:manage'),
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

/** Field officer: approve an issued work order and dispatch the hotspot. */
router.patch('/work-orders/:id/approve', requireCapability('workorders:manage'), (req, res, next) => {
  const wo = getWorkOrder(Number(req.params.id));
  if (!wo) return next(httpError(404, 'Work order not found.', 'WORK_ORDER_NOT_FOUND'));

  run("UPDATE work_orders SET status = 'Approved' WHERE work_order_id = ?", [req.params.id]);
  run("UPDATE chronic_hotspots SET status = 'Dispatched' WHERE hotspot_id = ?", [wo.hotspot_id]);

  audit({
    userId: req.user.id, userEmail: req.user.email,
    action: 'workorder.approve', entity: 'work_order', entityId: req.params.id,
  });

  res.json(getWorkOrder(Number(req.params.id)));
});

/** Inspector (and executive): advance the field status of a work order. */
const updateSchema = z.object({
  status: z.enum(['In Progress', 'Completed', 'Paused', 'Cancelled']),
});
router.patch('/work-orders/:id', requireCapability('workorders:update'), (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return next(httpError(400, 'Invalid status.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));

  const wo = getWorkOrder(Number(req.params.id));
  if (!wo) return next(httpError(404, 'Work order not found.', 'WORK_ORDER_NOT_FOUND'));
  if (wo.status === 'Cancelled' || wo.status === 'Completed') {
    return next(httpError(400, `Work order is already ${wo.status}.`, 'INVALID_TRANSITION'));
  }

  run('UPDATE work_orders SET status = ? WHERE work_order_id = ?', [parsed.data.status, req.params.id]);

  // Completing the work repairs the underlying hotspot.
  if (parsed.data.status === 'Completed') {
    run("UPDATE chronic_hotspots SET status = 'Repaired' WHERE hotspot_id = ?", [wo.hotspot_id]);
  }

  audit({
    userId: req.user.id, userEmail: req.user.email,
    action: 'workorder.update', entity: 'work_order', entityId: req.params.id,
    detail: `status=${parsed.data.status}`,
  });

  res.json(getWorkOrder(Number(req.params.id)));
});

export default router;
