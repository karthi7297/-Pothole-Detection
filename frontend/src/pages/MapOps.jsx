import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Crosshair, Layers, ListFilter, MapPin, Search } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, coords, num } from '../lib/format.js';
import { Badge, Button, Card, Chip, GradeBadge, PageHead, SkeletonRows, useToast } from '../components/ui.jsx';
import MapView from '../components/MapView.jsx';
import HotspotDrawer from '../components/HotspotDrawer.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const GRADES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CLASSES = ['pothole', 'alligator_crack', 'longitudinal_crack'];

export default function MapOps() {
  const location = useLocation();
  const toast = useToast();
  const { can } = useAuth();

  const [grade, setGrade] = useState('');
  const [klass, setKlass] = useState('');
  const [q, setQ] = useState('');
  const [chronicOnly, setChronicOnly] = useState(false);
  const [basemap, setBasemap] = useState('light');
  const [focus, setFocus] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data: segments } = usePoll(() => dataApi.segments(), 60000, []);
  const { data: hotspotPayload, loading } = usePoll(() => dataApi.hotspots('?limit=200'), 25000, []);
  const { data: detections } = usePoll(() => dataApi.detections('?limit=200'), 30000, []);

  const hotspots = hotspotPayload?.items || [];

  const filtered = useMemo(() => {
    let rows = hotspots;
    if (grade) rows = rows.filter((h) => h.grade === grade);
    if (klass) rows = rows.filter((h) => h.dominant_class === klass);
    if (chronicOnly) rows = rows.filter((h) => h.is_chronic);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (h) => h.street_name.toLowerCase().includes(needle) || (h.zone_name || '').toLowerCase().includes(needle)
      );
    }
    return rows;
  }, [hotspots, grade, klass, chronicOnly, q]);

  /* Deep link from other pages: { state: { focusId } } */
  useEffect(() => {
    const id = location.state?.focusId;
    if (!id || !hotspots.length) return;
    const target = hotspots.find((h) => h.hotspot_id === id);
    if (target) {
      setFocus({ lat: target.center_lat, lon: target.center_lon, zoom: 16 });
      openHotspot(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, hotspots.length]);

  const openHotspot = async (h) => {
    setSelected(h);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await dataApi.hotspot(h.hotspot_id));
    } catch {
      /* fall back to list row */
    } finally {
      setDetailLoading(false);
    }
  };

  const locate = (h) => {
    setFocus({ lat: h.center_lat, lon: h.center_lon, zoom: 16 });
    openHotspot(h);
  };

  const setStatus = async (h, status) => {
    try {
      const updated = await dataApi.updateHotspot(h.hotspot_id, { status });
      toast.success(`Defect #${h.hotspot_id} → ${status}`);
      setDetail((d) => (d ? { ...d, ...updated } : d));
    } catch (e) {
      toast.error(e.message);
    }
  };

  const generate = async (h) => {
    try {
      const wo = await dataApi.createWorkOrder(h.hotspot_id, h.assigned_ward_office);
      toast.success(`Work order #${wo.work_order_id} issued.`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const counts = useMemo(() => {
    const map = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    hotspots.forEach((h) => { map[h.grade] = (map[h.grade] || 0) + 1; });
    return map;
  }, [hotspots]);

  return (
    <>
      <PageHead
        eyebrow="Geospatial"
        title="Map Operations"
        subtitle="Corridor condition and every tracked defect on one surface. Pins are sized by priority — click for the full record."
      >
        <Button
          icon={Layers}
          size="sm"
          onClick={() => setBasemap((b) => (b === 'light' ? 'dark' : 'light'))}
        >
          {basemap === 'light' ? 'Dark basemap' : 'Light basemap'}
        </Button>
        <Button
          icon={Crosshair}
          size="sm"
          onClick={() => setFocus({ lat: 11.0168, lon: 76.9558, zoom: 12 })}
        >
          Recentre city
        </Button>
      </PageHead>

      <div className="filters">
        <Chip active={!grade} onClick={() => setGrade('')} count={hotspots.length}>All priorities</Chip>
        {GRADES.map((g) => (
          <Chip key={g} active={grade === g} onClick={() => setGrade(grade === g ? '' : g)} count={counts[g] || 0}>
            {g.charAt(0) + g.slice(1).toLowerCase()}
          </Chip>
        ))}
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
        {CLASSES.map((c) => (
          <Chip key={c} active={klass === c} onClick={() => setKlass(klass === c ? '' : c)}>
            {CLASS_LABEL[c]}
          </Chip>
        ))}
        <Chip active={chronicOnly} onClick={() => setChronicOnly((v) => !v)}>Chronic only</Chip>
      </div>

      <div className="grid grid--main" style={{ alignItems: 'start' }}>
        <Card
          flush
          title="Coimbatore road network"
          eyebrow={`${segments?.length || 0} corridors · ${filtered.length} defects shown`}
        >
          <MapView
            segments={segments || []}
            hotspots={filtered}
            detections={detections?.items || []}
            onSelect={openHotspot}
            focus={focus}
            height={640}
            basemap={basemap}
            onBasemapChange={setBasemap}
          />
        </Card>

        <Card
          title="Defect index"
          eyebrow="Filtered list"
          flush
          actions={<Badge tone="neutral">{filtered.length}</Badge>}
        >
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
            <div className="search">
              <Search size={14} />
              <input
                className="input"
                placeholder="Search street or zone…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          {loading && !hotspots.length ? (
            <SkeletonRows rows={6} />
          ) : filtered.length === 0 ? (
            <div className="empty">
              <ListFilter size={26} strokeWidth={1.5} />
              <b>No defects match</b>
              <span>Try clearing a filter or widening the search.</span>
            </div>
          ) : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {filtered.map((h) => (
                <button
                  key={h.hotspot_id}
                  onClick={() => locate(h)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '11px 14px', borderBottom: '1px solid var(--border)',
                    background: selected?.hotspot_id === h.hotspot_id ? 'var(--brand-soft)' : 'transparent',
                    border: 0, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <GradeBadge grade={h.grade} />
                    {h.is_chronic && <Badge tone="chronic">chronic</Badge>}
                    {h.monsoon_inundation_risk && <Badge tone="monsoon">monsoon</Badge>}
                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                      {Number(h.priority_score).toFixed(1)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{h.street_name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--faint)', display: 'flex', gap: 8, marginTop: 2 }}>
                    <span>{h.zone_name}</span>
                    <span>·</span>
                    <span>{num(h.detection_count)} sightings</span>
                    <span>·</span>
                    <span>{CLASS_LABEL[h.dominant_class] || h.dominant_class}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={10} />
                    {coords(h.center_lat, h.center_lon)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <HotspotDrawer
        hotspot={selected}
        detail={detail}
        loading={detailLoading}
        onClose={() => { setSelected(null); setDetail(null); }}
        onLocate={locate}
        onGenerate={generate}
        onSetStatus={setStatus}
        canAct={can('hotspots:verify')}
      />
    </>
  );
}
