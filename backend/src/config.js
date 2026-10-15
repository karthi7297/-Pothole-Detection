import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const csv = (v, fallback) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

/* ---------- runtime ---------- */
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = Number(process.env.PORT || 8080);

/* ---------- persistence ---------- */
const rawDb = process.env.SQLITE_PATH || './roadpulse.db';
export const SQLITE_PATH = path.isAbsolute(rawDb) ? rawDb : path.resolve(ROOT, rawDb);

/* ---------- security ---------- */
export const CORS_ORIGIN = csv(process.env.CORS_ORIGIN, [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
export const JWT_SECRET = process.env.JWT_SECRET || 'roadpulse-dev-secret-change-me';
export const JWT_TTL = process.env.JWT_TTL || '12h';

/* ---------- domain tuning (mirrors PRD section 4) ---------- */
export const CONFIDENCE_GATE = 0.6;          // 4.1 filter gate — reject below this
export const DEDUP_RADIUS_M = 5;             // 4.6 spatial deduplication radius
export const DEDUP_WINDOW_H = 24;            // 4.6 same-vehicle dedup window
export const HOTSPOT_MIN_OBSERVATIONS = 2;   // observations before a site becomes a hotspot
export const CHRONIC_MIN_SAMPLES = 3;        // 4.4 DBSCAN min_samples
export const CHRONIC_WINDOW_DAYS = 180;      // 4.4 chronic business rule
export const MONSOON_RAIN_THRESHOLD_MM = 25; // 4.3 rainfall trigger

export const GRADES = { LOW: 10, MEDIUM: 22, HIGH: 35 };

export const TRAFFIC_MULTIPLIER = {
  Arterial: 2.0,
  Collector: 1.5,
  Residential: 1.0,
};

export const PCI_DEDUCTION = {
  pothole: 15,
  alligator_crack: 8,
  longitudinal_crack: 3,
};

export const DAMAGE_CLASSES = ['pothole', 'alligator_crack', 'longitudinal_crack'];

/* ---------- integrations ---------- */
export const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
export const LLM_MODEL =
  process.env.LLM_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
export const WEATHER_TIMEOUT_MS = Number(process.env.WEATHER_TIMEOUT_MS || 4500);

/* ---------- fleet simulator (replaces the old fake frontend feed) ---------- */
export const ENABLE_SIMULATOR = process.env.ENABLE_SIMULATOR !== 'false';
export const SIMULATOR_INTERVAL_MS = Number(process.env.SIMULATOR_INTERVAL_MS || 9000);
