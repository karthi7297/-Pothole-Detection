import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { pciColor } from '../lib/data.js';

// Owns the Leaflet instance. Parent passes mapHandle (a ref) to call setView for "Locate".
export default function MapView({ segments, spots, onSelect, mapHandle }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const m = L.map(divRef.current).setView([11.0168, 76.9558], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    mapRef.current = m;
    if (mapHandle) mapHandle.current = m;
    return () => { m.remove(); mapRef.current = null; };
  }, [mapHandle]);

  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    const layers = [];
    segments.forEach((s) => {
      layers.push(L.polyline([[s.start_lat, s.start_lon], [s.end_lat, s.end_lon]], { color: pciColor(s.current_pci), weight: 6 })
        .bindPopup(`<b>${s.street_name}</b><br>PCI ${s.current_pci} · ${s.zone_name}`).addTo(m));
    });
    spots.forEach((h) => {
      const c = h.priority_score > 35 ? '#FF3B30' : h.monsoon_inundation_risk ? '#FF9500' : h.is_chronic ? '#AF52DE' : '#FFD60A';
      layers.push(L.circleMarker([h.center_lat, h.center_lon], { radius: 10, color: c, fillColor: c, fillOpacity: 0.9 })
        .bindPopup(`<b>${h.street_name}</b><br>Score ${h.priority_score} · ${h.grade || ''}`).addTo(m)
        .on('click', () => onSelect(h)));
    });
    return () => layers.forEach((l) => m.removeLayer(l));
  }, [segments, spots, onSelect]);

  return <div id="map" ref={divRef} style={{ marginTop: 8 }} />;
}
