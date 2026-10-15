export const MOCK = {
  metrics: { avgPci: 55, activePotholes: 18, critical: 2, monsoonHazards: 6, roiLakhs: 14.2 },
  segments: [
    { segment_id: 'SEG_AVINASHI_01', street_name: 'Avinashi Road (HOPE College Stretch)', zone_name: 'East Zone', start_lat: 11.0283, start_lon: 76.9942, end_lat: 11.0345, end_lon: 77.0081, road_type: 'Arterial', current_pci: 42 },
    { segment_id: 'SEG_DBROAD_01', street_name: 'DB Road (RS Puram Commercial Hub)', zone_name: 'Central Zone', start_lat: 11.0084, start_lon: 76.9525, end_lat: 11.0152, end_lon: 76.9541, road_type: 'Collector', current_pci: 61 },
    { segment_id: 'SEG_METTUPALAYAM_01', street_name: 'Mettupalayam Road (Saibaba Colony)', zone_name: 'North Zone', start_lat: 11.0251, start_lon: 76.9482, end_lat: 11.0388, end_lon: 76.9451, road_type: 'Arterial', current_pci: 38 },
    { segment_id: 'SEG_TRICHY_01', street_name: 'Trichy Road (Singanallur Junction)', zone_name: 'South Zone', start_lat: 10.9981, start_lon: 76.9924, end_lat: 11.0025, end_lon: 77.0112, road_type: 'Arterial', current_pci: 78 },
  ],
  hotspots: [
    { hotspot_id: 1, center_lat: 11.0295, center_lon: 76.9981, street_name: 'Avinashi Road (HOPE College)', detection_count: 5, is_chronic: true, monsoon_inundation_risk: true, priority_score: 42.5, estimated_patch_cost_inr: 10000, estimated_reconstruct_cost_inr: 85000, status: 'Active', grade: 'CRITICAL' },
    { hotspot_id: 3, center_lat: 11.0312, center_lon: 76.9468, street_name: 'Mettupalayam Road (Saibaba Colony)', detection_count: 6, is_chronic: true, monsoon_inundation_risk: true, priority_score: 39.2, estimated_patch_cost_inr: 12000, estimated_reconstruct_cost_inr: 85000, status: 'Active', grade: 'CRITICAL' },
    { hotspot_id: 6, center_lat: 11.0225, center_lon: 76.9875, street_name: 'Avinashi Road (Peelamedu)', detection_count: 3, is_chronic: true, monsoon_inundation_risk: true, priority_score: 31.7, estimated_patch_cost_inr: 6000, estimated_reconstruct_cost_inr: 72000, status: 'Active', grade: 'HIGH' },
    { hotspot_id: 2, center_lat: 11.0112, center_lon: 76.9532, street_name: 'DB Road (RS Puram)', detection_count: 4, is_chronic: true, monsoon_inundation_risk: false, priority_score: 28.1, estimated_patch_cost_inr: 8000, estimated_reconstruct_cost_inr: 65000, status: 'Active', grade: 'HIGH' },
    { hotspot_id: 4, center_lat: 11.0005, center_lon: 77.0021, street_name: 'Trichy Road (Singanallur)', detection_count: 2, is_chronic: false, monsoon_inundation_risk: false, priority_score: 12.4, estimated_patch_cost_inr: 4000, estimated_reconstruct_cost_inr: 0, status: 'Active', grade: 'MEDIUM' },
  ],
};
export const pciColor = (p) => (p >= 80 ? '#34C759' : p >= 50 ? '#FFD60A' : '#FF3B30');
