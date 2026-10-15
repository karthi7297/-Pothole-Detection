import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Camera, CheckCircle2, Crosshair, Layers, ListFilter, MapPin, Search, SlidersHorizontal,
  Smartphone, XCircle,
} from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, coords, num, relTime } from '../lib/format.js';
import { Badge, Button, Card, Chip, GradeBadge, PageHead, SkeletonRows, useToast } from '../components/ui.jsx';
import MapView from '../components/MapView.jsx';
import HotspotDrawer from '../components/HotspotDrawer.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const GRADES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CLASSES = ['pothole', 'alligator_crack', 'longitudinal_crack'];

/** Every layer on the report map can be toggled on the surface. */
const OVERLAYS = [
  { key: 'reports', label: 'Reports' },
  { key: 'defects', label: 'Defect clusters' },
  { key: 'corridors', label: 'Corridors' },
  { key: 'geofences', label: 'Zone geofences' },
];

const REPORT_STATUSES = [
  { key: '', label: 'All reports' },
  { key: 'Verified', label: 'Verified' },
  { key: 'Pending', label: 'Pending review' },
  { key: 'Rejected', label: 'Rejected' },
];

const SOURCES = [
  { key: '', label: 'Any source' },
  { key: 'citizen', label: 'Citizen app' },
  { key: 'dashcam', label: 'Dashcam' },
];

const STATUS_TONE = {
  Verified: 'low',
  Pending: 'medium',
  Rejected: 'neutral',
  Dispatched: 'brand',
  Repaired: 'low',
};

const sourceLabel = (s) => (s === 'citizen' ? 'Citizen' : 'Dashcam');

export default function MapOps() {
  const location = useLocation();
  const toast = useToast();
  const { can } = useAuth();

  const [grade, setGrade] = useState('');
  const [klass, setKlass] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [chronicOnly, setChronicOnly] = useState(false);
  const [basemap, setBasemap] = useState('light');
  const [focus, setFocus] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showOverlays, setShowOverlays] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [overlays, setOverlays] = useState({
    reports: true,
    defects: true,
    corridors: true,
    geofences: true,
  });

  const { data: segments } = usePoll(() => dataApi.segments(), 60000, []);
  const { data: hotspotPayload, loading } = usePoll(() => dataApi.hotspots('?limit=200'), 25000, []);
  const { data: reportPayload, refresh: refreshReports } = usePoll(
    () => dataApi.detections('?limit=800'),
    20000,
    []
  );
  const { data: summary } = usePoll(() => dataApi.reportsSummary(), 20000, []);
  const { data: geofences } = usePoll(() => dataApi.zoneGeofences(), 300000, []);

  const hotspots = hotspotPayload?.items || [];
  const allReports = reportPayload?.items || [];

  /** Client-side filtering keeps the map and the list perfectly in step. */
  const reports = useMemo(() => {
    let rows = allReports;
    if (reportStatus) rows = rows.filter((r) => r.status === reportStatus);
    if (source) rows = rows.filter((r) => r.source === source);
    if (klass) rows = rows.filter((r) => r.damage_class === klass);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.location_name || '').toLowerCase().includes(needle) ||
          (r.street_name || '').toLowerCase().includes(needle) ||
          (r.zone_name || '').toLowerCase().includes(needle)
      );
    }
    return rows;
  }, [allReports, reportStatus, source, klass, q]);

  const filteredClusters = useMemo(() => {
    let rows = hotspots;
    if (grade) rows = rows.filter((h) => h.grade === grade);
    if (chronicOnly) rows = rows.filter((h) => h.is_chronic);
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (h) => h.street_name.toLowerCase().includes(needle) || (h.zone_name || '').toLowerCase().includes(needle)
      );
    }
    return rows;
  }, [hotspots, grade, chronicOnly, q]);

  const counts = useMemo(() => {
    const base = summary?.status || {};
    return {
      total: base.total || 0,
      Verified: base.Verified || 0,
      Pending: base.Pending || 0,
      Rejected: base.Rejected || 0,
      citizen: (summary?.sources || []).find((s) => s.source === 'citizen')?.count || 0,
      dashcam: (summary?.sources || []).find((s) => s.source === 'dashcam')?.count || 0,
    };
  }, [summary]);

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

  const locateReport = (r) => {
    setFocus({ lat: r.latitude, lon: r.longitude, zoom: 17 });
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

  /** Field-officer acceptance — the report only joins the record once accepted. */
  const review = async (r, status) => {
    setBusyId(r.id);
    try {
      await dataApi.reviewDetection(r.id, status);
      toast.success(
        status === 'Verified'
          ? `Report #${r.id} accepted — added to the road record.`
          : `Report #${r.id} rejected.`
      );
      refreshReports();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const pendingVisible = reports.filter((r) => r.status === 'Pending').length;

  return (
    <>
      <PageHead
        eyebrow="Geospatial"
        title="Report Map"
        subtitle="Every pothole report received — from the citizen app and from dashcams — plotted where it was recorded. Low-confidence reports stay pending until a field officer accepts them."
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

      <div className="report-strip">
        <span className="report-strip__chip"><span className="report-strip__dot" style={{ background: '#8a8a86' }} />{num(counts.total)} reports</span>
        <span className="report-strip__chip"><span className="report-strip__dot" style={{ background: '#2f9e44' }} />{num(counts.Verified)} verified</span>
        <span className="report-strip__chip"><span className="report-strip__dot" style={{ background: '#e8590c' }} />{num(counts.Pending)} pending review</span>
        <span className="report-strip__chip"><span className="report-strip__dot" style={{ background: '#c92a2a' }} />{num(counts.Rejected)} rejected</span>
        <span className="report-strip__sep" />
        <span className="report-strip__chip"><Smartphone size={12} />{num(counts.citizen)} citizen</span>
        <span className="report-strip__chip"><Camera size={12} />{num(counts.dashcam)} dashcam</span>
      </div>

      <div className="filters">
        {REPORT_STATUSES.map((s) => (
          <Chip
            key={s.key || 'all'}
            active={reportStatus === s.key}
            onClick={() => setReportStatus(s.key)}
            count={s.key === 'Verified' ? counts.Verified : s.key === 'Pending' ? counts.Pending : s.key === 'Rejected' ? counts.Rejected : counts.total}
          >
            {s.label}
          </Chip>
        ))}
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
        {SOURCES.map((s) => (
          <Chip key={s.key || 'any'} active={source === s.key} onClick={() => setSource(s.key)}>
            {s.label}
          </Chip>
        ))}
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
        {CLASSES.map((c) => (
          <Chip key={c} active={klass === c} onClick={() => setKlass(klass === c ? '' : c)}>
            {CLASS_LABEL[c]}
          </Chip>
        ))}
        <Chip active={chronicOnly} onClick={() => setChronicOnly((v) => !v)}>Chronic clusters only</Chip>
      </div>

      <div className="grid grid--main" style={{ alignItems: 'start' }}>
        <Card
          flush
          title="Coimbatore report map"
          eyebrow={`${reports.length} reports plotted · ${filteredClusters.length} defect clusters`}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {pendingVisible > 0 && (
                <span className="fleet-chip fleet-chip--idle">{pendingVisible} awaiting officer</span>
              )}
              <Button size="sm" icon={SlidersHorizontal} onClick={() => setShowOverlays((v) => !v)}>
                Overlays
              </Button>
            </div>
          }
        >
          {showOverlays && (
            <div className="overlay-bar">
              <span className="eyebrow" style={{ marginRight: 4 }}>Map layers</span>
              {OVERLAYS.map((o) => (
                <Chip
                  key={o.key}
                  active={overlays[o.key]}
                  onClick={() => setOverlays((prev) => ({ ...prev, [o.key]: !prev[o.key] }))}
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          )}
          <MapView
            segments={segments || []}
            hotspots={filteredClusters}
            reports={reports}
            geofences={geofences || { type: 'FeatureCollection', features: [] }}
            layers={overlays}
            onSelect={openHotspot}
            onReportSelect={(r) => {
              setFocus({ lat: r.latitude, lon: r.longitude, zoom: 17 });
              toast.info(`Report #${r.id} — ${CLASS_LABEL[r.damage_class] || r.damage_class} · ${r.status}`);
            }}
            focus={focus}
            height={640}
            basemap={basemap}
            onBasemapChange={setBasemap}
          />
        </Card>

        <Card
          title="Received reports"
          eyebrow="Newest first"
          flush
          actions={<Badge tone="neutral">{reports.length}</Badge>}
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

          {loading && !allReports.length ? (
            <SkeletonRows rows={6} />
          ) : reports.length === 0 ? (
            <div className="empty">
              <ListFilter size={26} strokeWidth={1.5} />
              <b>No reports match</b>
              <span>Try clearing a filter or widening the search.</span>
            </div>
          ) : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="report-row"
                  onClick={() => locateReport(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && locateReport(r)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                    <span className={`report-src report-src--${r.source === 'citizen' ? 'citizen' : 'dashcam'}`}>
                      {r.source === 'citizen' ? <Smartphone size={11} /> : <Camera size={11} />}
                      {sourceLabel(r.source)}
                    </span>
                    <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
                      {Math.round(r.confidence * 100)}%
                    </span>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    {r.location_name || r.street_name}
                  </div>
                  {r.location_name && r.street_name && r.location_name !== r.street_name && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{r.street_name}</div>
                  )}
                  <div style={{ fontSize: 11.5, color: 'var(--faint)', display: 'flex', gap: 7, marginTop: 2 }}>
                    <span>{CLASS_LABEL[r.damage_class] || r.damage_class}</span>
                    <span>·</span>
                    <span>{r.zone_name}</span>
                    <span>·</span>
                    <span>{relTime(r.timestamp)}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={10} />
                    {coords(r.latitude, r.longitude)}
                  </div>

                  {can('detections:review') && r.status === 'Pending' && (
                    <div className="pill-row" style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={CheckCircle2}
                        disabled={busyId === r.id}
                        onClick={() => review(r, 'Verified')}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={XCircle}
                        disabled={busyId === r.id}
                        onClick={() => review(r, 'Rejected')}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
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
