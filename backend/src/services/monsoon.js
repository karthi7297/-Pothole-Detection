import { MONSOON_RAIN_THRESHOLD_MM } from '../config.js';
import { getForecast } from './weather.js';

/**
 * PRD 4.3 — Monsoon Inundation & Sub-Base Erosion Engine.
 *
 * Water enters unsealed cracks and, under heavy-vehicle load, strips the
 * asphalt binder from the sub-base. We therefore treat *cracked* pavement as
 * the hazard when rainfall crosses the threshold, not every defect.
 */
export async function assessMonsoonRisk({ lat = 11.0168, lon = 76.9558, hotspots = [] } = {}) {
  const forecast = await getForecast(lat, lon);
  const rainyDays = forecast.days.filter((d) => d.rainMm >= MONSOON_RAIN_THRESHOLD_MM);
  const riskActive = rainyDays.length > 0;
  const peak = forecast.peakRainMm ?? 0;

  const severity = peak >= 60 ? 'SEVERE' : peak >= MONSOON_RAIN_THRESHOLD_MM ? 'ELEVATED' : 'NORMAL';

  const exposed = hotspots.filter((h) => {
    const cracked = h.dominant_class === 'alligator_crack' || h.dominant_class === 'longitudinal_crack';
    const wet = riskActive || h.monsoon_inundation_risk;
    return cracked && wet;
  });

  return {
    forecast,
    thresholdMm: MONSOON_RAIN_THRESHOLD_MM,
    riskActive,
    severity,
    peakRainMm: peak,
    rainyDays: rainyDays.map((d) => ({ date: d.date, rainMm: d.rainMm })),
    windowHours: riskActive ? 48 : null,
    exposedHotspots: exposed.map((h) => h.hotspot_id),
    advisory: buildAdvisory({ severity, rainyDays, exposed }),
  };
}

function buildAdvisory({ severity, rainyDays, exposed }) {
  if (!rainyDays.length) {
    return 'No threshold rainfall forecast in the next 7 days. Maintain routine patrol frequency.';
  }
  const when = rainyDays[0].date;
  const peak = Math.max(...rainyDays.map((d) => d.rainMm)).toFixed(0);
  const target =
    exposed.length > 0
      ? `${exposed.length} cracked location${exposed.length > 1 ? 's' : ''} require crack sealing within 48 h of ${when}`
      : 'no cracked segments currently expose the sub-base';
  const action =
    severity === 'SEVERE'
      ? 'Mobilise emergency crack-sealing crews and pre-position cold-mix stock.'
      : 'Schedule crack-sealing before the wet window opens.';
  return `${severity} monsoon window from ${when} (peak ${peak} mm/day) — ${target}. ${action}`;
}
