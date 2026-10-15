import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Crosshair, Layers, MapPinned } from 'lucide-react';
import { pciBand } from '../lib/format.js';

const CITY = { lng: 76.9558, lat: 11.0168 };
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
const STYLES = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
};

/* Mapbox paint expressions need concrete colours (no CSS variables). */
const HEX = {
  good: '#2f9e44',
  fair: '#b8860b',
  poor: '#c92a2a',
  CRITICAL: '#c92a2a',
  HIGH: '#e8590c',
  MEDIUM: '#b8860b',
  LOW: '#2f9e44',
};
const pciHex = (pci) => (pci >= 80 ? HEX.good : pci >= 50 ? HEX.fair : HEX.poor);

const EMPTY = { type: 'FeatureCollection', features: [] };

if (TOKEN) mapboxgl.accessToken = TOKEN;

/**
 * Mapbox GL map in the RoadPulse light civic theme.
 *
 * Corridors render as PCI-coloured lines; tracked defects as severity-coloured
 * circles (sized by priority score, with a pulsing halo on critical sites).
 * Clicking a defect opens the detail drawer.
 */
export default function MapView({
  segments = [],
  hotspots = [],
  detections = [],
  onSelect,
  focus,
  height = 560,
  showDetections = true,
  basemap = 'light',
  onBasemapChange,
}) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const pulseRef = useRef(null);
  const [missingToken] = useState(!TOKEN);

  onSelectRef.current = onSelect;

  /* -------------------------------------------------------------- data -- */
  const segmentData = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: segments.map((s) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[s.start_lon, s.start_lat], [s.end_lon, s.end_lat]] },
        properties: {
          name: s.street_name,
          pci: s.current_pci,
          band: pciBand(s.current_pci),
          color: pciHex(s.current_pci),
          zone: s.zone_name,
          road_type: s.road_type,
          length_km: s.length_km,
        },
      })),
    }),
    [segments]
  );

  const defectData = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: hotspots.map((h) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.center_lon, h.center_lat] },
        properties: {
          id: h.hotspot_id,
          name: h.street_name,
          grade: h.grade,
          score: Number(h.priority_score) || 0,
          color: HEX[h.grade] || HEX.MEDIUM,
          count: h.detection_count,
          status: h.status,
          chronic: h.is_chronic ? 1 : 0,
          monsoon: h.monsoon_inundation_risk ? 1 : 0,
        },
      })),
    }),
    [hotspots]
  );

  const detectionData = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: detections.slice(0, 400).map((d) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.longitude, d.latitude] },
        properties: { cls: d.damage_class, conf: d.confidence, street: d.street_name },
      })),
    }),
    [detections]
  );

  /* --------------------------------------------------------- add layers -- */
  const installLayers = (map) => {
    map.addSource('segments', { type: 'geojson', data: segmentData });
    map.addLayer({
      id: 'segments-line',
      type: 'line',
      source: 'segments',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8],
        'line-opacity': 0.85,
      },
    });

    if (showDetections) {
      map.addSource('detections', { type: 'geojson', data: detectionData });
      map.addLayer({
        id: 'detections-dot',
        type: 'circle',
        source: 'detections',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 4],
          'circle-color': '#3d3f42',
          'circle-opacity': 0.4,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    map.addSource('defects', { type: 'geojson', data: defectData });

    // pulsing halo behind critical defects
    map.addLayer({
      id: 'defects-halo',
      type: 'circle',
      source: 'defects',
      filter: ['==', ['get', 'grade'], 'CRITICAL'],
      paint: {
        'circle-radius': 22,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.16,
      },
    });

    map.addLayer({
      id: 'defects-circle',
      type: 'circle',
      source: 'defects',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 6, 60, 15],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.92,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    /* ------------------------------------------------------ interaction -- */
    map.on('click', 'defects-circle', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const target = hotspots.find((h) => String(h.hotspot_id) === String(p.id));
      new mapboxgl.Popup({ offset: 14, closeButton: true, maxWidth: '300px' })
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          `<b>${p.name}</b><br/>
           <span style="font-family:'IBM Plex Mono',monospace;font-size:11.5px">${p.grade} · score ${p.score}</span><br/>
           ${p.count} observations · ${p.status}<br/>
           <span style="color:#6f6e69;font-size:11px">Full record opening…</span>`
        )
        .addTo(map);
      if (target) onSelectRef.current?.(target);
    });

    map.on('click', 'segments-line', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      new mapboxgl.Popup({ offset: 8, maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<b>${p.name}</b><br/>
           <span style="font-family:'IBM Plex Mono',monospace;font-size:11.5px">PCI ${p.pci}/100 · ${p.band}</span><br/>
           ${p.zone} · ${p.road_type} · ${p.length_km} km`
        )
        .addTo(map);
    });

    for (const layer of ['defects-circle', 'segments-line']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }

    /* ------------------------------------------------- critical pulse -- */
    let phase = 0;
    const animate = () => {
      if (!mapRef.current || !readyRef.current) return;
      phase += 0.05;
      const r = 20 + Math.sin(phase) * 9;
      try {
        map.setPaintProperty('defects-halo', 'circle-radius', r);
        map.setPaintProperty('defects-halo', 'circle-opacity', 0.1 + (Math.sin(phase) + 1) * 0.05);
      } catch {
        /* layer removed */
      }
      pulseRef.current = requestAnimationFrame(animate);
    };
    pulseRef.current = requestAnimationFrame(animate);
  };

  /* ---------------------------------------------------------------- init -- */
  useEffect(() => {
    if (missingToken || !holder.current || mapRef.current) return undefined;

    const map = new mapboxgl.Map({
      container: holder.current,
      style: STYLES.light,
      center: [CITY.lng, CITY.lat],
      zoom: 12,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      readyRef.current = true;
      installLayers(map);
    });

    return () => {
      readyRef.current = false;
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingToken]);

  /* --------------------------------------------------------- data sync -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource('segments')?.setData(segmentData);
    map.getSource('defects')?.setData(defectData);
    map.getSource('detections')?.setData(detectionData);
  }, [segmentData, defectData, detectionData]);

  /* ----------------------------------------------------------- basemap -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => map.setStyle(STYLES[basemap] || STYLES.light);
    if (readyRef.current) {
      readyRef.current = false;
      map.setStyle(STYLES[basemap] || STYLES.light);
      map.once('styledata', () => {
        readyRef.current = true;
        installLayers(map);
      });
    } else {
      apply();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  /* ------------------------------------------------------------- focus -- */
  useEffect(() => {
    if (!mapRef.current || !focus) return;
    mapRef.current.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 16, duration: 900, essential: true });
  }, [focus]);

  /* -------------------------------------------------------------- view -- */
  if (missingToken) {
    return (
      <div
        className="map"
        style={{ height, display: 'grid', placeItems: 'center', background: 'var(--paper-2)' }}
      >
        <div className="empty" style={{ maxWidth: 460 }}>
          <MapPinned size={30} strokeWidth={1.5} />
          <b>Mapbox token required</b>
          <span>
            Add <code className="mono">VITE_MAPBOX_TOKEN=your_token</code> to{' '}
            <code className="mono">frontend/.env</code>, then restart the dev server. Get a free token at
            account.mapbox.com.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="map" style={{ height }}>
      <div className="map__canvas" ref={holder} />
      <div className="map__legend">
        <div className="eyebrow" style={{ marginBottom: 2 }}>Corridor PCI</div>
        <div className="map__legend-row"><span className="map__legend-swatch" style={{ background: HEX.good }} /> ≥ 80 good</div>
        <div className="map__legend-row"><span className="map__legend-swatch" style={{ background: HEX.fair }} /> 50–79 fair</div>
        <div className="map__legend-row"><span className="map__legend-swatch" style={{ background: HEX.poor }} /> &lt; 50 poor</div>
        <div className="eyebrow" style={{ marginTop: 5, marginBottom: 2 }}>Defects</div>
        <div className="map__legend-row"><span className="map__legend-pin" style={{ background: HEX.CRITICAL }} /> critical</div>
        <div className="map__legend-row"><span className="map__legend-pin" style={{ background: HEX.HIGH }} /> high</div>
        <div className="map__legend-row"><span className="map__legend-pin" style={{ background: HEX.MEDIUM }} /> medium</div>
        <div className="map__legend-row"><span className="map__legend-pin" style={{ background: HEX.LOW }} /> low</div>
      </div>
      <div className="map__tools no-print">
        <button
          className="map__tool"
          title="Recentre on Coimbatore"
          onClick={() => mapRef.current?.flyTo({ center: [CITY.lng, CITY.lat], zoom: 12, duration: 700 })}
        >
          <Crosshair size={15} />
        </button>
        <button
          className="map__tool"
          title={basemap === 'light' ? 'Switch to dark basemap' : 'Switch to light basemap'}
          onClick={() => onBasemapChange?.(basemap === 'light' ? 'dark' : 'light')}
        >
          <Layers size={15} />
        </button>
      </div>
    </div>
  );
}
