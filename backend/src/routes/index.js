import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import authRoutes from './auth.js';
import detectionRoutes from './detections.js';
import eventRoutes from './events.js';
import fleetRoutes from './fleet.js';
import hotspotRoutes from './hotspots.js';
import metricRoutes from './metrics.js';
import segmentRoutes from './segments.js';
import weatherRoutes from './weather.js';
import workOrderRoutes from './workOrders.js';
import uploadRoutes from './uploads.js';
import reportRoutes from './reports.js';
import geoRoutes from './geo.js';
import { ENABLE_SIMULATOR } from '../config.js';
import { status } from '../services/simulator.js';

const router = Router();

/** Public health probe — no auth, used by uptime checks. */
router.get('/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'roadpulse-api',
    version: '3.0.0',
    simulator: status().running ? 'running' : ENABLE_SIMULATOR ? 'idle' : 'disabled',
    ts: Date.now(),
  })
);

// Everything below reads req.user when a token is present.
router.use(optionalAuth);

// Public, no-login routes must be mounted BEFORE the authenticated routers.
// Several routers call `router.use(requireAuth)` at their root, which — because
// they are mounted at '/' — would otherwise reject an anonymous request with a
// 401 before it ever reaches the public route.
router.use(reportRoutes);      // /reports/track/:id (public report tracking)
router.use(geoRoutes);         // /geo/reverse (public coordinates → location name)
router.use(uploadRoutes);      // /detections/upload-anonymous (public) + /detections/upload (auth)

router.use('/auth', authRoutes);
router.use(eventRoutes);       // /events/*
router.use(metricRoutes);      // /metrics, /analytics/*, /audit, /dashboard
router.use(segmentRoutes);     // /segments
router.use(hotspotRoutes);     // /hotspots
router.use(detectionRoutes);   // /detections, /reports/summary
router.use(workOrderRoutes);   // /work-orders
router.use(weatherRoutes);     // /weather, /monsoon
router.use(fleetRoutes);       // /fleet

export default router;
