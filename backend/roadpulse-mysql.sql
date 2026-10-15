-- RoadPulse MySQL production variant (optional).
-- Default demo uses SQLite (zero setup). Import this only if you have MySQL.
CREATE DATABASE IF NOT EXISTS roadpulse CHARACTER SET utf8mb4;
USE roadpulse;

CREATE TABLE IF NOT EXISTS detections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  vehicle_id VARCHAR(50) DEFAULT 'TNSTC_BUS_CB_104',
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  damage_class VARCHAR(30) NOT NULL,
  confidence DOUBLE NOT NULL,
  bbox_area_ratio DOUBLE NOT NULL,
  image_path VARCHAR(255),
  street_name VARCHAR(100) DEFAULT 'Avinashi Road',
  zone_name VARCHAR(50) DEFAULT 'East Zone',
  road_type VARCHAR(20) DEFAULT 'Arterial',
  status VARCHAR(20) DEFAULT 'Pending',
  INDEX idx_status (status),
  INDEX idx_loc (latitude, longitude)
);

CREATE TABLE IF NOT EXISTS road_segments (
  segment_id VARCHAR(50) PRIMARY KEY,
  street_name VARCHAR(100) NOT NULL,
  zone_name VARCHAR(50) DEFAULT 'East Zone',
  start_lat DOUBLE NOT NULL, start_lon DOUBLE NOT NULL,
  end_lat DOUBLE NOT NULL, end_lon DOUBLE NOT NULL,
  road_type VARCHAR(20) DEFAULT 'Arterial',
  current_pci INT DEFAULT 100,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chronic_hotspots (
  hotspot_id INT AUTO_INCREMENT PRIMARY KEY,
  center_lat DOUBLE NOT NULL, center_lon DOUBLE NOT NULL,
  street_name VARCHAR(100) NOT NULL,
  radius_meters DOUBLE DEFAULT 5.0,
  detection_count INT DEFAULT 1,
  is_chronic TINYINT DEFAULT 0,
  monsoon_inundation_risk TINYINT DEFAULT 0,
  priority_score DOUBLE DEFAULT 0.0,
  estimated_patch_cost_inr DOUBLE DEFAULT 0.0,
  estimated_reconstruct_cost_inr DOUBLE DEFAULT 0.0,
  status VARCHAR(20) DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id INT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hotspot_id INT,
  priority_level VARCHAR(20),
  asphalt_required_tons DOUBLE,
  estimated_budget_inr DOUBLE,
  summary_text TEXT,
  assigned_ward_office VARCHAR(100) DEFAULT 'CMC Ward 32 Office',
  FOREIGN KEY (hotspot_id) REFERENCES chronic_hotspots(hotspot_id)
);
