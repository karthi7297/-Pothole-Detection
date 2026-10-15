import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Crosshair, Layers, MapPinned, Maximize2 } from 'lucide-react';
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

/**
 * Report verification palette.
 *
 * A report is only part of the road record once a field officer has accepted
 * it, so the map is explicit about the difference: green = verified, amber =
 * still waiting for an officer, grey = reviewed and dismissed.
 */
const REPORT_STATE = {
  verified: { color: '#2f9e44', label: 'verified' },
  pending: { color: '#e8590c', label: 'pending review' },
  rejected: { color: '#8a8a86', label: 'rejected' },
};
const stateKey = (status) => String(status || 'Pending').toLowerCase();
const stateColor = (status) => (REPORT_STATE[stateKey(status)] || REPORT_STATE.pending).color;

/** How each report reached us. */
const REPORT_SOURCE = {
  citizen: { label: 'Citizen report', glyph: 'pin' },
  dashcam: { label: 'Dashcam (auto)', glyph: 'cam' },
  simulator: { label: 'Dashcam (auto)', glyph: 'cam' },
  edge: { label: 'Dashcam (auto)', glyph: 'cam' },
  manual: { label: 'Citizen report', glyph: 'pin' },
};
const sourceKey = (source) => (REPORT_SOURCE[source] ? source : 'citizen');
const sourceGlyph = (source) => REPORT_SOURCE[sourceKey(source)].glyph;

const EMPTY = { type: 'FeatureCollection', features: [] };

if (TOKEN) mapboxgl.accessToken = TOKEN;

/* --------------------------------------------------------------- icons -- */

/**
 * Draw a report marker to an offscreen canvas.
 *
 * Shape encodes provenance (a map pin for citizen uploads, a camera for
 * dashcam frames) and colour encodes verification state, so a glance at the
 * map answers both "who found this?" and "is it confirmed yet?".
 */
function makeReportIcon(glyph, color, size = 26) {
  const ratio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);

  const w = size;
  const h = size;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.fillStyle = color;

  if (glyph === 'pin') {
    // Teardrop map pin with a hollow centre.
    const r = w * 0.255;
    const cx = w / 2;
    const cy = h * 0.37;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI / 2 + 0.55, Math.PI / 2 - 0.55, true);
    ctx.lineTo(cx, cy + r * 2.05);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
  } else {
    // Dashcam body with a lens.
    const bw = w * 0.72;
    const bh = w * 0.5;
    const bx = (w - bw) / 2;
    const by = (h - bh) / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4.5);
    else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(bx + bw * 0.7, by + bh / 2, bh * 0.27, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const ICON_IDS = [];
for (const glyph of ['pin', 'cam']) {
  for (const [key, meta] of Object.entries(REPORT_STATE)) {
    ICON_IDS.push({ id: `report-${glyph}-${key}`, glyph, color: meta.color });
  }
}

function ensureIcons(map) {
  for (const { id, glyph, color } of ICON_IDS) {
    if (!map.hasImage(id)) map.addImage(id, makeReportIcon(glyph, color), { pixelRatio: 2 });
  }
}

/**
 * Mapbox GL map in the RoadPulse light civic theme.
 *
 * This is a **report map**: every pothole report received — from the citizen
 * app or a dashcam — is plotted at the spot on the road where it was recorded,
 * and coloured by whether a field officer has accepted it yet.
 */
export default function MapView({
  segments = [],
  hotspots = [],
  reports = [],
  geofences = EMPTY,
  onSelect,
  onReportSelect,
  focus,
  height = 560,
  basemap = 'light',
  onBasemapChange,
  layers = {},
}) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const boundRef = useRef(false);
  const styleRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  const onReportRef = useRef(onReportSelect);
  const pulseRef = useRef(null);
  const zoneMarkersRef = useRef([]);
  const hoverPopupRef = useRef(null);
  const [missingToken] = useState(!TOKEN);

  onSelectRef.current = onSelect;
  onReportRef.current = onReportSelect;

  /**
   * Latest geofences, readable from callbacks that were created on an earlier
   * render (the Mapbox `load` handler closes over the first render's props, so
   * reading the prop directly there would always see the empty initial value).
   */
  const geofencesRef = useRef(geofences);
  geofencesRef.current = geofences;

  /**
   * Latest report / hotspot rows. The Mapbox click handlers are bound once (on
   * the first `load`), so reading the props directly there would always see the
   * empty initial arrays and the popups would never resolve a row.
   */
  const reportsRef = useRef(reports);
  reportsRef.current = reports;
  const hotspotsRef = useRef(hotspots);
  hotspotsRef.current = hotspots;

  const visible = (id) => layers[id] !== false;

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

  const clusterData = useMemo(
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
        },
      })),
    }),
    [hotspots]
  );

  const reportData = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: reports.slice(0, 800).map((d) => {
        const stat = stateKey(d.status);
        const src = sourceKey(d.source);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [d.longitude, d.latitude] },
          properties: {
            id: d.id,
            src,
            stat,
            icon: `report-${sourceGlyph(d.source)}-${stat}`,
            color: stateColor(d.status),
            cls: d.damage_class,
            conf: Number(d.confidence),
            loc: d.location_name,
            street: d.street_name,
            zone: d.zone_name,
            status: d.status,
            source: d.source,
            ts: d.timestamp,
            pass_count: d.pass_count,
          },
        };
      }),
    }),
    [reports]
  );

  /* --------------------------------------------------------- add layers -- */

  /**
   * Latest feature collections, readable from the one-shot `load` handler.
   *
   * The map is created once, but the data arrives a beat later. `installLayers`
   * therefore builds the sources from these refs (never the first render's
   * empty props) and then re-pushes once more, so the very first paint already
   * carries the full report set instead of waiting for a later interaction.
   */
  const dataRef = useRef({ segmentData, clusterData, reportData });
  dataRef.current = { segmentData, clusterData, reportData };

  const pushData = (map) => {
    const d = dataRef.current;
    map.getSource('segments')?.setData(d.segmentData);
    map.getSource('clusters')?.setData(d.clusterData);
    map.getSource('reports')?.setData(d.reportData);
  };

  const installLayers = (map) => {
    ensureIcons(map);

    if (!map.getSource('geofences')) {
      map.addSource('geofences', { type: 'geojson', data: geofencesRef.current });
      map.addLayer({
        id: 'geofences-fill',
        type: 'fill',
        source: 'geofences',
        paint: { 'fill-color': '#123a5e', 'fill-opacity': 0.05 },
      });
      map.addLayer({
        id: 'geofences-line',
        type: 'line',
        source: 'geofences',
        paint: {
          'line-color': '#123a5e',
          'line-width': 1.2,
          'line-opacity': 0.42,
          'line-dasharray': [2, 2],
        },
      });
    }

    if (!map.getSource('segments')) {
      map.addSource('segments', { type: 'geojson', data: dataRef.current.segmentData });
      map.addLayer({
        id: 'segments-line',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 15, 7],
          'line-opacity': 0.8,
        },
      });
    }

    // Defect clusters render as hollow rings so the reports inside stay legible.
    if (!map.getSource('clusters')) {
      map.addSource('clusters', { type: 'geojson', data: dataRef.current.clusterData });
      map.addLayer({
        id: 'clusters-halo',
        type: 'circle',
        source: 'clusters',
        filter: ['==', ['get', 'grade'], 'CRITICAL'],
        paint: { 'circle-radius': 22, 'circle-color': ['get', 'color'], 'circle-opacity': 0.13 },
      });
      map.addLayer({
        id: 'clusters-ring',
        type: 'circle',
        source: 'clusters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 11, 60, 26],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.09,
          'circle-stroke-width': 1.8,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.75,
        },
      });
    }

    if (!map.getSource('reports')) {
      map.addSource('reports', { type: 'geojson', data: dataRef.current.reportData });

      // A soft ring draws the eye to reports still awaiting an officer.
      map.addLayer({
        id: 'reports-pending-ring',
        type: 'circle',
        source: 'reports',
        filter: ['==', ['get', 'stat'], 'pending'],
        paint: {
          'circle-radius': 13,
          'circle-color': REPORT_STATE.pending.color,
          'circle-opacity': 0.22,
        },
      });

      map.addLayer({
        id: 'reports-icon',
        type: 'symbol',
        source: 'reports',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 13, 0.8, 16, 1.05],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-padding': 2,
        },
      });
    }

    applyVisibility(map);
    bindInteractions(map);
    pushData(map); // pick up anything that arrived while the style was loading
    if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
    pulseRef.current = startPulse(map);
  };

  const applyVisibility = (map) => {
    const layerMap = {
      reports: ['reports-icon', 'reports-pending-ring'],
      corridors: 'segments-line',
      defects: ['clusters-ring', 'clusters-halo'],
      geofences: ['geofences-fill', 'geofences-line'],
    };
    for (const [key, ids] of Object.entries(layerMap)) {
      for (const id of Array.isArray(ids) ? ids : [ids]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', visible(key) ? 'visible' : 'none');
        }
      }
    }
  };

  /* -------------------------------------------------------- interactions -- */
  const bindInteractions = (map) => {
    if (boundRef.current) return;
    boundRef.current = true;

    map.on('click', 'reports-icon', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const target = reportsRef.current.find((r) => String(r.id) === String(p.id));
      new mapboxgl.Popup({ offset: 16, closeButton: true, maxWidth: '310px' })
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          `<b>${p.loc || p.street || 'Unassigned road'}</b><br/>
           <span class="rp-pop-mono" style="color:${stateColor(p.status)}">● ${p.status}</span>
           <span class="rp-pop-mono"> · ${REPORT_SOURCE[sourceKey(p.source)].label}</span><br/>
           <span class="rp-pop-mono">${p.cls} · confidence ${(p.conf * 100).toFixed(0)}%</span><br/>
           <span class="rp-pop-mute">${p.loc && p.street && p.loc !== p.street ? `${p.street} · ` : ''}${p.zone || ''}${p.ts ? ` · ${p.ts}` : ''}</span>`
        )
        .addTo(map);
      if (target) onReportRef.current?.(target);
    });

    map.on('click', 'clusters-ring', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const target = hotspotsRef.current.find((h) => String(h.hotspot_id) === String(p.id));
      new mapboxgl.Popup({ offset: 14, closeButton: true, maxWidth: '300px' })
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          `<b>${p.name}</b><br/>
           <span class="rp-pop-mono">${p.grade} · score ${p.score}</span><br/>
           ${p.count} verified reports · ${p.status}<br/>
           <span class="rp-pop-mute">Opening defect record…</span>`
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
           <span class="rp-pop-mono">PCI ${p.pci}/100 · ${p.band}</span><br/>
           ${p.zone} · ${p.road_type} · ${p.length_km} km`
        )
        .addTo(map);
    });

    for (const layer of ['reports-icon', 'clusters-ring', 'segments-line']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }

    map.on('mousemove', 'reports-icon', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      if (!hoverPopupRef.current) {
        hoverPopupRef.current = new mapboxgl.Popup({
          offset: 14, closeButton: false, closeOnClick: false, maxWidth: '260px', className: 'rp-hover',
        });
      }
      hoverPopupRef.current
        .setLngLat(f.geometry.coordinates)
        .setHTML(
          `<b>${p.cls}</b> <span class="rp-pop-mono" style="color:${stateColor(p.status)}">${p.status}</span><br/>
           <span class="rp-pop-mono">${p.loc || p.street || 'Unnamed location'}</span><br/>
           <span class="rp-pop-mute">${REPORT_SOURCE[sourceKey(p.source)].label} · ${(p.conf * 100).toFixed(0)}% confidence</span>`
        )
        .addTo(map);
    });
    map.on('mouseleave', 'reports-icon', () => hoverPopupRef.current?.remove());
  };

  const startPulse = (map) => {
    let phase = 0;
    const animate = () => {
      if (!mapRef.current || mapRef.current !== map || !readyRef.current) return;
      phase += 0.045;
      const wave = (Math.sin(phase) + 1) / 2;
      try {
        map.setPaintProperty('clusters-halo', 'circle-radius', 19 + wave * 11);
        map.setPaintProperty('clusters-halo', 'circle-opacity', 0.08 + wave * 0.1);
        map.setPaintProperty('reports-pending-ring', 'circle-radius', 10 + wave * 7);
        map.setPaintProperty('reports-pending-ring', 'circle-opacity', 0.14 + wave * 0.16);
      } catch {
        /* layer not present */
      }
      pulseRef.current = requestAnimationFrame(animate);
    };
    return requestAnimationFrame(animate);
  };

  /* -------------------------------------------------------- zone labels -- */
  const syncZoneLabels = (map) => {
    for (const m of zoneMarkersRef.current) m.remove();
    zoneMarkersRef.current = [];

    const geo = geofencesRef.current;
    if (!geo || !visible('geofences')) return;

    for (const f of geo.features || []) {
      const ring = f.geometry?.coordinates?.[0] || [];
      if (!ring.length) continue;
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;

      const el = document.createElement('div');
      el.className = 'map-zone-label';
      el.textContent = f.properties.zone;
      zoneMarkersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([cx, cy]).addTo(map));
    }
  };

  /* ---------------------------------------------------------------- init -- */
  useEffect(() => {
    if (missingToken || !holder.current || mapRef.current) return undefined;

    const initialStyle = STYLES[basemap] || STYLES.light;
    const map = new mapboxgl.Map({
      container: holder.current,
      style: initialStyle,
      center: [CITY.lng, CITY.lat],
      zoom: 12,
      attributionControl: true,
    });
    mapRef.current = map;
    styleRef.current = basemap;
    // Dev-only handle so tooling can inspect rendered layers.
    if (import.meta.env.DEV) window.__rpMap = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // StrictMode tears the first map down again; ignore its late callbacks.
      if (mapRef.current !== map) return;
      readyRef.current = true;
      installLayers(map);
      syncZoneLabels(map);
    });

    return () => {
      readyRef.current = false;
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      for (const m of zoneMarkersRef.current) m.remove();
      zoneMarkersRef.current = [];
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
      if (import.meta.env.DEV) window.__rpMap = null;
      mapRef.current = null; // null first so pending handlers bail out
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingToken]);

  /* --------------------------------------------------------- data sync -- */
  useEffect(() => {
    const map = mapRef.current;
    // Sources are created by installLayers; if they are not there yet the
    // `load`/`styledata` handler will push the latest data via pushData().
    if (!map || !map.getSource('reports')) return;
    pushData(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentData, clusterData, reportData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getSource('geofences')?.setData(geofences);
    syncZoneLabels(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofences]);

  /* ---------------------------------------------------------- visibility -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyVisibility(map);
    syncZoneLabels(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  /* ----------------------------------------------------------- basemap -- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRef.current === basemap) return;
    styleRef.current = basemap;

    hoverPopupRef.current?.remove();
    hoverPopupRef.current = null;
    readyRef.current = false;
    map.setStyle(STYLES[basemap] || STYLES.light);
    map.once('styledata', () => {
      if (mapRef.current !== map) return;
      readyRef.current = true;
      installLayers(map);
      syncZoneLabels(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  /* ------------------------------------------------------------- focus -- */
  useEffect(() => {
    if (!mapRef.current || !focus) return;
    mapRef.current.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 16, duration: 900, essential: true });
  }, [focus]);

  /* ------------------------------------------------------ helicopter view -- */
  const fitToAssets = () => {
    const map = mapRef.current;
    if (!map) return;
    const pts = [
      ...reports.map((r) => [r.longitude, r.latitude]),
      ...segments.flatMap((s) => [[s.start_lon, s.start_lat], [s.end_lon, s.end_lat]]),
    ];
    if (!pts.length) {
      map.flyTo({ center: [CITY.lng, CITY.lat], zoom: 12, duration: 700 });
      return;
    }
    const bounds = pts.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(pts[0], pts[0]));
    map.fitBounds(bounds, { padding: 64, maxZoom: 14.5, duration: 900 });
  };

  /* -------------------------------------------------------------- view -- */
  if (missingToken) {
    return (
      <div className="map" style={{ height, display: 'grid', placeItems: 'center', background: 'var(--paper-2)' }}>
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
        {visible('reports') && (
          <>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Report status</div>
            <div className="map__legend-row"><span className="map__legend-pin" style={{ background: REPORT_STATE.verified.color }} /> verified</div>
            <div className="map__legend-row"><span className="map__legend-pin" style={{ background: REPORT_STATE.pending.color }} /> pending review</div>
            <div className="map__legend-row"><span className="map__legend-pin" style={{ background: REPORT_STATE.rejected.color }} /> rejected</div>
            <div className="eyebrow" style={{ marginTop: 6, marginBottom: 2 }}>Source</div>
            <div className="map__legend-row"><span className="map__legend-glyph">📍</span> citizen app</div>
            <div className="map__legend-row"><span className="map__legend-glyph">📷</span> dashcam (auto)</div>
          </>
        )}
        {visible('defects') && (
          <>
            <div className="eyebrow" style={{ marginTop: 6, marginBottom: 2 }}>Defect clusters</div>
            <div className="map__legend-row"><span className="map__legend-ring" style={{ borderColor: HEX.CRITICAL }} /> critical</div>
            <div className="map__legend-row"><span className="map__legend-ring" style={{ borderColor: HEX.HIGH }} /> high</div>
            <div className="map__legend-row"><span className="map__legend-ring" style={{ borderColor: HEX.MEDIUM }} /> medium</div>
          </>
        )}
        {visible('corridors') && (
          <>
            <div className="eyebrow" style={{ marginTop: 6, marginBottom: 2 }}>Corridor PCI</div>
            <div className="map__legend-row"><span className="map__legend-swatch" style={{ background: HEX.good }} /> ≥ 80 good</div>
            <div className="map__legend-row"><span className="map__legend-swatch" style={{ background: HEX.fair }} /> 50–79 fair</div>
            <div className="map__legend-row"><span className="map__legend-swatch" style={{ background: HEX.poor }} /> &lt; 50 poor</div>
          </>
        )}
      </div>

      <div className="map__tools no-print">
        <button className="map__tool" title="Helicopter view — fit all reports" onClick={fitToAssets}>
          <Maximize2 size={15} />
        </button>
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
