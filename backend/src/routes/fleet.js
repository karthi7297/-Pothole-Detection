import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireCapability, requireRole } from '../middleware/auth.js';
import { httpError } from '../middleware/error.js';
import { audit } from '../services/audit.js';
import { detectionsLast24h } from '../services/ingest.js';
import { fleetRoster, startSimulator, status, stopSimulator, tick } from '../services/simulator.js';
import { fleetStatus, geofences, positions, vehicleSummary } from '../services/vehicles.js';

const router = Router();
router.use(requireAuth);

/** Fleet roster + live ingestion counters. */
router.get('/fleet', requireCapability('fleet:read'), (_req, res) => {
  res.json({
    roster: fleetRoster(),
    detections24h: detectionsLast24h(),
    simulator: status(),
    tracking: fleetStatus(),
  });
});

/** Live vehicle positions with heading, speed and trip-history tracks. */
router.get('/fleet/positions', requireCapability('fleet:read'), (_req, res) => {
  res.json({
    vehicles: positions(),
    summary: vehicleSummary(),
    tracking: fleetStatus(),
    geofences: geofences(),
    generatedAt: new Date().toISOString(),
  });
});

/** Zone geofence polygons (convex hulls of each zone's assets). */
router.get('/fleet/geofences', requireCapability('fleet:read'), (_req, res) => {
  res.json(geofences());
});

const controlSchema = z.object({
  action: z.enum(['start', 'stop', 'tick']),
  intervalMs: z.coerce.number().int().min(1000).max(120_000).optional(),
});

/** Executive-only control over the passive ingestion simulator. */
router.post('/fleet/simulator', requireRole('executive'), (req, res, next) => {
  const parsed = controlSchema.safeParse(req.body);
  if (!parsed.success) return next(httpError(400, 'Unknown simulator action.', 'VALIDATION_ERROR'));

  const { action, intervalMs } = parsed.data;
  let state;
  if (action === 'start') state = startSimulator(intervalMs);
  else if (action === 'stop') state = stopSimulator();
  else {
    const result = tick();
    state = status();
    audit({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'fleet.simulate_tick',
      entity: 'detection',
      entityId: result?.detection_id ?? null,
      detail: result ? `${result.kind} ${result.damage_class || ''}`.trim() : 'no-op',
    });
    return res.json({ ...state, tick: result });
  }

  audit({
    userId: req.user.id,
    userEmail: req.user.email,
    action: `fleet.simulator_${action}`,
    entity: 'simulator',
    detail: intervalMs ? `intervalMs=${intervalMs}` : null,
  });
  res.json(state);
});

export default router;
