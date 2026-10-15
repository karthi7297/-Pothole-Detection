import { DatabaseSync } from 'node:sqlite';
import { SQLITE_PATH } from './config.js';

export { SQLITE_PATH };

export const db = new DatabaseSync(SQLITE_PATH);

export function initSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    vehicle_id VARCHAR(50) DEFAULT 'TNSTC_BUS_CB_104',
    latitude REAL NOT NULL, longitude REAL NOT NULL,
    damage_class VARCHAR(30) NOT NULL,
    confidence REAL NOT NULL, bbox_area_ratio REAL NOT NULL,
    image_path VARCHAR(255),
    street_name VARCHAR(100) DEFAULT 'Avinashi Road',
    zone_name VARCHAR(50) DEFAULT 'East Zone',
    road_type VARCHAR(20) DEFAULT 'Arterial',
    status VARCHAR(20) DEFAULT 'Pending'
  );
  CREATE TABLE IF NOT EXISTS road_segments (
    segment_id VARCHAR(50) PRIMARY KEY,
    street_name VARCHAR(100) NOT NULL,
    zone_name VARCHAR(50) DEFAULT 'East Zone',
    start_lat REAL NOT NULL, start_lon REAL NOT NULL,
    end_lat REAL NOT NULL, end_lon REAL NOT NULL,
    road_type VARCHAR(20) DEFAULT 'Arterial',
    current_pci INTEGER DEFAULT 100,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS chronic_hotspots (
    hotspot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    center_lat REAL NOT NULL, center_lon REAL NOT NULL,
    street_name VARCHAR(100) NOT NULL,
    radius_meters REAL DEFAULT 5.0,
    detection_count INTEGER DEFAULT 1,
    is_chronic INTEGER DEFAULT 0,
    monsoon_inundation_risk INTEGER DEFAULT 0,
    priority_score REAL DEFAULT 0.0,
    estimated_patch_cost_inr REAL DEFAULT 0.0,
    estimated_reconstruct_cost_inr REAL DEFAULT 0.0,
    status VARCHAR(20) DEFAULT 'Active'
  );
  CREATE TABLE IF NOT EXISTS work_orders (
    work_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    hotspot_id INTEGER,
    priority_level VARCHAR(20),
    asphalt_required_tons REAL,
    estimated_budget_inr REAL,
    summary_text TEXT,
    assigned_ward_office VARCHAR(100) DEFAULT 'CMC Ward 32 Office'
  );`);
}
