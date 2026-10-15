import { DatabaseSync } from 'node:sqlite';
import { SQLITE_PATH } from './config.js';

export { SQLITE_PATH };

export const db = new DatabaseSync(SQLITE_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/** Thin, typed-ish helpers so route code stays declarative. */
export const query = (sql, params = []) => db.prepare(sql).all(...params);
export const one = (sql, params = []) => db.prepare(sql).get(...params);
export const run = (sql, params = []) => db.prepare(sql).run(...params);

/** Atomic multi-statement write. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('executive','inspector','driver')),
  password_hash TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
  vehicle_id      TEXT NOT NULL,
  latitude        REAL NOT NULL,
  longitude       REAL NOT NULL,
  damage_class    TEXT NOT NULL,
  confidence      REAL NOT NULL,
  bbox_area_ratio REAL NOT NULL,
  image_url       TEXT,
  street_name     TEXT DEFAULT 'Unassigned',
  zone_name       TEXT DEFAULT 'Central Zone',
  road_type       TEXT DEFAULT 'Arterial',
  segment_id      TEXT,
  hotspot_id      INTEGER,
  pass_count      INTEGER DEFAULT 1,
  report_count    INTEGER DEFAULT 1,
  source          TEXT DEFAULT 'edge',
  status          TEXT DEFAULT 'Pending',
  FOREIGN KEY (segment_id) REFERENCES road_segments(segment_id),
  FOREIGN KEY (hotspot_id) REFERENCES chronic_hotspots(hotspot_id)
);
CREATE INDEX IF NOT EXISTS idx_det_ts      ON detections(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_det_segment ON detections(segment_id);
CREATE INDEX IF NOT EXISTS idx_det_hotspot ON detections(hotspot_id);

CREATE TABLE IF NOT EXISTS road_segments (
  segment_id   TEXT PRIMARY KEY,
  street_name  TEXT NOT NULL,
  zone_name    TEXT DEFAULT 'Central Zone',
  start_lat    REAL NOT NULL,
  start_lon    REAL NOT NULL,
  end_lat      REAL NOT NULL,
  end_lon      REAL NOT NULL,
  road_type    TEXT DEFAULT 'Arterial',
  length_km    REAL DEFAULT 1.0,
  current_pci  INTEGER DEFAULT 100,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chronic_hotspots (
  hotspot_id                INTEGER PRIMARY KEY AUTOINCREMENT,
  center_lat                REAL NOT NULL,
  center_lon                REAL NOT NULL,
  street_name               TEXT NOT NULL,
  zone_name                 TEXT DEFAULT 'Central Zone',
  road_type                 TEXT DEFAULT 'Arterial',
  segment_id                TEXT,
  radius_meters             REAL DEFAULT 5.0,
  detection_count           INTEGER DEFAULT 1,
  is_chronic                INTEGER DEFAULT 0,
  monsoon_inundation_risk   INTEGER DEFAULT 0,
  priority_score            REAL DEFAULT 0.0,
  dominant_class            TEXT DEFAULT 'pothole',
  estimated_patch_cost_inr  REAL DEFAULT 0.0,
  estimated_reconstruct_cost_inr REAL DEFAULT 0.0,
  status                    TEXT DEFAULT 'Active',
  assigned_ward_office      TEXT,
  first_detected_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_detected_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  hotspot_id            INTEGER,
  priority_level        TEXT,
  asphalt_required_tons REAL,
  estimated_budget_inr  REAL,
  summary_text          TEXT,
  assigned_ward_office  TEXT DEFAULT 'CMC Ward 32 Office',
  status                TEXT DEFAULT 'Issued',
  model                 TEXT,
  created_by            INTEGER,
  FOREIGN KEY (hotspot_id) REFERENCES chronic_hotspots(hotspot_id)
);

CREATE TABLE IF NOT EXISTS pci_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id  TEXT NOT NULL,
  pci         INTEGER NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pci_seg ON pci_history(segment_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_id    INTEGER,
  user_email TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(created_at DESC);
`;

export function initSchema() {
  db.exec(SCHEMA);
}

/** Wipes every table — used by the seed script only. */
export function resetSchema() {
  db.exec(`
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS pci_history;
    DROP TABLE IF EXISTS work_orders;
    DROP TABLE IF EXISTS detections;
    DROP TABLE IF EXISTS chronic_hotspots;
    DROP TABLE IF EXISTS road_segments;
    DROP TABLE IF EXISTS users;
  `);
  initSchema();
}
