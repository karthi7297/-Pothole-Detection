import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import {
  classMix,
  fleetSummary,
  priorityDistribution,
  topHotspots,
  trendSeries,
  zoneHealth,
} from '../services/analytics.js';
import { computeMetrics } from '../services/metrics.js';
import { recentAudit } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

/** Headline KPIs — every value derived from live rows. */
router.get('/metrics', (_req, res) => res.json(computeMetrics()));

router.get('/analytics/trend', (req, res) => {
  const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));
  res.json({ days, series: trendSeries(days) });
});

router.get('/analytics/class-mix', (_req, res) => res.json(classMix()));
router.get('/analytics/zones', (_req, res) => res.json(zoneHealth()));
router.get('/analytics/priority', (_req, res) => res.json(priorityDistribution()));
router.get('/analytics/top-hotspots', (req, res) =>
  res.json(topHotspots(Math.min(50, Number(req.query.limit) || 8)))
);
router.get('/analytics/fleet', (_req, res) => res.json(fleetSummary()));

/** Governance: recent privileged actions. */
router.get('/audit', (req, res) =>
  res.json(recentAudit(Math.min(200, Number(req.query.limit) || 60)))
);

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    res.json({
      metrics: computeMetrics(),
      trend: trendSeries(30),
      zones: zoneHealth(),
      classMix: classMix(),
      priority: priorityDistribution(),
      topHotspots: topHotspots(6),
    });
  })
);

export default router;
