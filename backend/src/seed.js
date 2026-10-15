import { db, initSchema } from './db.js';
initSchema();

const corridors = [
  ['SEG_AVINASHI_01','Avinashi Road (HOPE College Stretch)','East Zone',11.0283,76.9942,11.0345,77.0081,'Arterial',42],
  ['SEG_DBROAD_01','DB Road (RS Puram Commercial Hub)','Central Zone',11.0084,76.9525,11.0152,76.9541,'Collector',61],
  ['SEG_METTUPALAYAM_01','Mettupalayam Road (Saibaba Colony)','North Zone',11.0251,76.9482,11.0388,76.9451,'Arterial',38],
  ['SEG_TRICHY_01','Trichy Road (Singanallur Junction)','South Zone',10.9981,76.9924,11.0025,77.0112,'Arterial',78],
];
const hotspots = [
  [11.0295,76.9981,'Avinashi Road (HOPE College)',5,1,1,42.5,10000,85000],
  [11.0112,76.9532,'DB Road (RS Puram)',4,1,0,28.1,8000,65000],
  [11.0312,76.9468,'Mettupalayam Road (Saibaba Colony)',6,1,1,39.2,12000,85000],
  [11.0005,77.0021,'Trichy Road (Singanallur)',2,0,0,12.4,4000,0],
  [11.0180,76.9550,'DB Road (RS Puram Interior)',1,0,0,6.8,2000,0],
  [11.0225,76.9875,'Avinashi Road (Peelamedu)',3,1,1,31.7,6000,72000],
];
const detections = [
  ['TNSTC_BUS_CB_104',11.0295,76.9981,'pothole',0.91,0.084,'Avinashi Road (HOPE College)','East Zone','Arterial','Pending'],
  ['TNSTC_BUS_CB_212',11.0296,76.9983,'pothole',0.87,0.071,'Avinashi Road (HOPE College)','East Zone','Arterial','Pending'],
  ['CMC_TRUCK_07',11.0112,76.9532,'alligator_crack',0.84,0.12,'DB Road (RS Puram)','Central Zone','Collector','Pending'],
  ['TNSTC_BUS_CB_104',11.0312,76.9468,'pothole',0.88,0.093,'Mettupalayam Road (Saibaba Colony)','North Zone','Arterial','Verified'],
  ['CMC_TRUCK_03',11.0005,77.0021,'longitudinal_crack',0.72,0.041,'Trichy Road (Singanallur)','South Zone','Arterial','Pending'],
];

db.exec('DELETE FROM road_segments; DELETE FROM chronic_hotspots; DELETE FROM detections; DELETE FROM work_orders;');
const s1 = db.prepare(`INSERT INTO road_segments (segment_id,street_name,zone_name,start_lat,start_lon,end_lat,end_lon,road_type,current_pci) VALUES (?,?,?,?,?,?,?,?,?)`);
for (const c of corridors) s1.run(...c);
const s2 = db.prepare(`INSERT INTO chronic_hotspots (center_lat,center_lon,street_name,detection_count,is_chronic,monsoon_inundation_risk,priority_score,estimated_patch_cost_inr,estimated_reconstruct_cost_inr) VALUES (?,?,?,?,?,?,?,?,?)`);
for (const h of hotspots) s2.run(...h);
const s3 = db.prepare(`INSERT INTO detections (vehicle_id,latitude,longitude,damage_class,confidence,bbox_area_ratio,street_name,zone_name,road_type,status) VALUES (?,?,?,?,?,?,?,?,?,?)`);
for (const d of detections) s3.run(...d);
console.log('Seeded: 4 segments, 6 hotspots, 5 detections');
