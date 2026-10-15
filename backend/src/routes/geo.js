import { Router } from 'express';
import { httpError } from '../middleware/error.js';
import { reverseGeocode } from '../services/places.js';

const router = Router();

/**
 * Coordinates → location name.
 *
 * Public on purpose: a citizen filing a report is not signed in, and the report
 * form needs the place name before it can be submitted.
 *
 *   GET /api/geo/reverse?lat=11.0168&lon=76.9558
 *   → { name: "Cross Cut Road, Gandhipuram", source: "mapbox", street_name, … }
 */
router.get('/geo/reverse', async (req, res, next) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon ?? req.query.lng);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return next(httpError(400, 'Provide a valid ?lat= between -90 and 90.', 'VALIDATION_ERROR'));
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return next(httpError(400, 'Provide a valid ?lon= between -180 and 180.', 'VALIDATION_ERROR'));
  }

  try {
    res.json(await reverseGeocode(lat, lon));
  } catch (err) {
    next(err);
  }
});

export default router;
