import { WEATHER_TIMEOUT_MS } from '../config.js';

/**
 * Open-Meteo client (free, no API key) with a short-lived cache and a
 * deterministic offline fallback so the dashboard never renders blank.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

/** Coimbatore monsoon climatology — used when the upstream call fails. */
const FALLBACK_RAIN_MM = [3, 11, 34, 27, 8, 2, 0];

function fallback(lat, lon) {
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(Date.now() + i * 86_400_000);
    return {
      date: d.toISOString().slice(0, 10),
      rainMm: FALLBACK_RAIN_MM[i] ?? 0,
      tMax: 30 + (i % 3),
      tMin: 21 + (i % 2),
      code: FALLBACK_RAIN_MM[i] > 20 ? 63 : 2,
    };
  });
  return { source: 'climatology-fallback', live: false, lat, lon, days, peakRainMm: Math.max(...days.map((d) => d.rainMm)) };
}

export async function getForecast(lat = 11.0168, lon = 76.9558) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WEATHER_TIMEOUT_MS);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,weather_code&forecast_days=7&timezone=auto`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = await res.json();
    const days = json.daily.time.slice(0, 7).map((date, i) => ({
      date,
      rainMm: Number(json.daily.precipitation_sum[i] ?? 0),
      tMax: json.daily.temperature_2m_max[i],
      tMin: json.daily.temperature_2m_min[i],
      code: json.daily.weather_code?.[i] ?? 2,
    }));
    value = {
      source: 'open-meteo-live',
      live: true,
      lat,
      lon,
      days,
      peakRainMm: Math.max(...days.map((d) => d.rainMm)),
    };
  } catch {
    value = fallback(lat, lon);
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Human-readable label for a WMO weather code. */
export function weatherLabel(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}
