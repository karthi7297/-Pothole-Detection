import { Router } from 'express';
import { query, run } from '../db.js';
import { MONSOON_RAIN_THRESHOLD_MM } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { assessMonsoonRisk } from '../services/monsoon.js';
import { gradeOf } from '../services/priority.js';
import { weatherLabel } from '../services/weather.js';

const router = Router();
router.use(requireAuth);

const CITY_CENTER = { lat: 11.0168, lon: 76.9558 };

router.get(
  '/weather',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat) || CITY_CENTER.lat;
    const lon = Number(req.query.lon) || CITY_CENTER.lon;
    const risk = await assessMonsoonRisk({ lat, lon, hotspots: query('SELECT * FROM chronic_hotspots') });
    res.json({
      ...risk.forecast,
      days: risk.forecast.days.map((d) => ({ ...d, label: weatherLabel(d.code) })),
      thresholdMm: risk.thresholdMm,
      severity: risk.severity,
      riskActive: risk.riskActive,
      advisory: risk.advisory,
      windowHours: risk.windowHours,
    });
  })
);

/**
 * PRD 4.3 — evaluates every hotspot against the live forecast, persists the
 * monsoon flag, and returns the ranked exposure list.
 */
router.get(
  '/monsoon',
  asyncHandler(async (req, res) => {
    const hotspots = query('SELECT * FROM chronic_hotspots');
    const risk = await assessMonsoonRisk({ hotspots });
    const exposedIds = new Set(risk.exposedHotspots);

    for (const h of hotspots) {
      const flagged = exposedIds.has(h.hotspot_id) ? 1 : 0;
      if (flagged !== h.monsoon_inundation_risk) {
        run('UPDATE chronic_hotspots SET monsoon_inundation_risk = ? WHERE hotspot_id = ?', [flagged, h.hotspot_id]);
      }
    }

    const refreshed = query('SELECT * FROM chronic_hotspots')
      .filter((h) => h.monsoon_inundation_risk)
      .map((h) => ({ ...h, grade: gradeOf(h.priority_score) }))
      .sort((a, b) => b.priority_score - a.priority_score);

    // Cracks are the water-ingress vector. Even when no rain crosses the
    // threshold, the ward needs to know which locations are one storm away
    // from sub-base failure.
    const vulnerable = query('SELECT * FROM chronic_hotspots')
      .filter((h) => h.dominant_class === 'alligator_crack' || h.dominant_class === 'longitudinal_crack')
      .map((h) => ({
        ...h,
        grade: gradeOf(h.priority_score),
        exposed: exposedIds.has(h.hotspot_id),
      }))
      .sort((a, b) => b.priority_score - a.priority_score);

    res.json({
      forecast: risk.forecast,
      severity: risk.severity,
      riskActive: risk.riskActive,
      thresholdMm: risk.thresholdMm,
      windowHours: risk.windowHours,
      advisory: risk.advisory,
      rainyDays: risk.rainyDays,
      exposed: refreshed,
      vulnerable,
    });
  })
);

export default router;
