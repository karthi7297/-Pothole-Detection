import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, ArrowUpRight, CloudRain, Coins, Gauge, RefreshCw, TriangleAlert, TrendingDown, Wrench,
} from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, GRADE_COLOR, inr, num, pciBand, relTime } from '../lib/format.js';
import { Badge, Banner, Button, Card, GradeBadge, PageHead, Skeleton, SkeletonRows, Stat, Table, useToast } from '../components/ui.jsx';
import { ClassMixBar, GradeDonut, PciBars, TrendChart, ZoneBars } from '../components/charts.jsx';
import HotspotDrawer from '../components/HotspotDrawer.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export default function Overview() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [range, setRange] = useState(30);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data: metrics, loading, error } = usePoll(() => dataApi.metrics(), 20000, []);
  const { data: trend } = usePoll(() => dataApi.trend(range), 60000, [range]);
  const { data: zones } = usePoll(() => dataApi.zones(), 60000, []);
  const { data: mix } = usePoll(() => dataApi.classMix(), 60000, []);
  const { data: priority } = usePoll(() => dataApi.priority(), 60000, []);
  const { data: top } = usePoll(() => dataApi.topHotspots(7), 30000, []);
  const { data: segments } = usePoll(() => dataApi.segments(), 60000, []);

  const openHotspot = async (h) => {
    setSelected(h);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await dataApi.hotspot(h.hotspot_id));
    } catch {
      /* drawer falls back to the list row */
    } finally {
      setDetailLoading(false);
    }
  };

  const dispatch = async (h, status) => {
    try {
      await dataApi.updateHotspot(h.hotspot_id, { status });
      toast.success(`Defect #${h.hotspot_id} marked ${status}.`);
      setDetail((d) => (d ? { ...d, status } : d));
    } catch (e) {
      toast.error(e.message);
    }
  };

  const generate = async (h) => {
    try {
      const wo = await dataApi.createWorkOrder(h.hotspot_id, h.assigned_ward_office);
      toast.success(`Work order #${wo.work_order_id} issued (${wo.model}).`);
      navigate('/work-orders');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const pciTone = useMemo(() => {
    const d = metrics?.pciDelta;
    if (d == null) return null;
    return { value: d, tone: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
  }, [metrics]);

  if (loading && !metrics) {
    return (
      <>
        <PageHead eyebrow="Coimbatore Municipal Corporation" title="City Overview" />
        <div className="grid grid--4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="stat" key={i}><Skeleton h={11} w="45%" /><Skeleton h={26} w="60%" /><Skeleton h={10} w="70%" /></div>
          ))}
        </div>
        <Card title="Loading network data…"><SkeletonRows rows={5} /></Card>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead eyebrow="Coimbatore Municipal Corporation" title="City Overview" />
        <Banner tone="danger" icon={TriangleAlert}>
          <b>Could not reach the API.</b> {error.message}
        </Banner>
      </>
    );
  }

  const m = metrics;

  return (
    <>
      <PageHead
        eyebrow="Coimbatore Municipal Corporation"
        title="City Overview"
        subtitle="Live pavement condition across 5 zones, computed from passive fleet telemetry — no manual surveys."
      >
        <Button icon={RefreshCw} onClick={() => window.location.reload()} size="sm">
          Refresh
        </Button>
        <Button variant="primary" icon={ArrowUpRight} size="sm" onClick={() => navigate('/triage')}>
          Open triage queue
        </Button>
      </PageHead>

      <div className="grid grid--4">
        <Stat
          label="Avg city PCI"
          value={m.avgPci}
          unit="/100"
          icon={Gauge}
          accent={m.avgPci >= 80 ? 'var(--good)' : m.avgPci >= 50 ? 'var(--fair)' : 'var(--poor)'}
          delta={pciTone?.value}
          deltaTone={pciTone?.tone}
          foot={`${m.pciBand} · ${m.segments} corridors`}
        />
        <Stat
          label="Active potholes"
          value={num(m.activePotholes)}
          icon={TriangleAlert}
          accent="var(--critical)"
          foot={`${m.criticalHotspots} critical defect${m.criticalHotspots === 1 ? '' : 's'}`}
        />
        <Stat
          label="Monsoon exposure"
          value={num(m.monsoonHazards)}
          icon={CloudRain}
          accent="var(--monsoon)"
          foot={`${m.monsoonVulnerable} cracked locations at risk`}
        />
        <Stat
          label="Annual saving identified"
          value={inr(m.annualSavingsInr, { compact: true })}
          icon={Coins}
          accent="var(--low)"
          foot={`vs ${inr(m.sunkPatchSpendInr, { compact: true })} already spent patching`}
        />
      </div>

      {m.criticalHotspots > 0 && (
        <Banner tone="danger" icon={TriangleAlert}
          actions={
            <Button size="sm" variant="danger" onClick={() => navigate('/triage')}>
              Review {m.criticalHotspots} critical
            </Button>
          }
        >
          <b>{m.criticalHotspots} defect{m.criticalHotspots === 1 ? '' : 's'} at critical priority.</b>{' '}
          These sites have been repaired repeatedly without fixing the sub-base — every extra patch is money lost.
        </Banner>
      )}

      <div className="grid grid--main">
        <Card
          title="Fleet observations"
          eyebrow={`Damage class trend · last ${range} days`}
          actions={
            <div className="seg">
              {[30, 90, 180].map((d) => (
                <button key={d} className={range === d ? 'is-on' : ''} onClick={() => setRange(d)}>
                  {d}d
                </button>
              ))}
            </div>
          }
        >
          <TrendChart series={trend?.series || []} />
        </Card>

        <Card title="Priority mix" eyebrow={`${m.hotspots} tracked defects`}>
          <GradeDonut distribution={priority || []} />
          <div className="kv" style={{ marginTop: 8 }}>
            <div className="kv__row">
              <span className="kv__k">Chronic sub-base failures</span>
              <span className="kv__v">{m.chronicCount}</span>
            </div>
            <div className="kv__row">
              <span className="kv__k">Observations in 24 h</span>
              <span className="kv__v">{num(m.detections24h)}</span>
            </div>
            <div className="kv__row">
              <span className="kv__k">Total observations</span>
              <span className="kv__v">{num(m.detectionsTotal)}</span>
            </div>
            <div className="kv__row">
              <span className="kv__k">Last ingestion</span>
              <span className="kv__v">{relTime(m.lastIngestAt)}</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid--3">
        <Card title="Zone health" eyebrow="Average PCI by administrative zone">
          <ZoneBars zones={zones || []} />
        </Card>

        <Card title="Defect composition" eyebrow="Share of all observations">
          <ClassMixBar mix={mix || []} />
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Weakest corridors</div>
            <PciBars segments={segments || []} />
          </div>
        </Card>

        <Card title="Cost of doing nothing" eyebrow="Transparent municipal model">
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <div className="eyebrow">Already spent on repeat patching</div>
              <div className="num" style={{ fontSize: 24, fontWeight: 600, color: 'var(--critical)' }}>
                {inr(m.sunkPatchSpendInr)}
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                ₹9,500 per intervention × every recorded sighting at chronic sites.
              </p>
            </div>
            <div>
              <div className="eyebrow">Reconstruction backlog</div>
              <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>
                {inr(m.reconstructionBacklogInr)}
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                One-off sub-base rebuild for {m.chronicCount} chronic defects.
              </p>
            </div>
            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
              <div className="eyebrow">Annual saving if rebuilt now</div>
              <div className="num" style={{ fontSize: 26, fontWeight: 700, color: 'var(--low)' }}>
                {inr(m.annualSavingsInr)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Highest-priority defects"
        eyebrow="Ranked by dynamic priority score"
        flush
        actions={<Button size="sm" variant="ghost" onClick={() => navigate('/triage')}>View all</Button>}
      >
        <Table
          rowKey={(h) => h.hotspot_id}
          onRowClick={openHotspot}
          columns={[
            { key: 'grade', header: 'Priority', render: (h) => <GradeBadge grade={h.grade} /> },
            {
              key: 'street_name',
              header: 'Location',
              render: (h) => (
                <div>
                  <div className="t-strong">{h.street_name}</div>
                  <div className="t-sub">{h.zone_name} · {h.road_type}</div>
                </div>
              ),
            },
            { key: 'dominant_class', header: 'Defect', render: (h) => CLASS_LABEL[h.dominant_class] || h.dominant_class },
            { key: 'detection_count', header: 'Sightings', align: 'right', render: (h) => num(h.detection_count) },
            { key: 'priority_score', header: 'Score', align: 'right', render: (h) => <b>{Number(h.priority_score).toFixed(1)}</b> },
            {
              key: 'flags',
              header: 'Flags',
              render: (h) => (
                <div className="pill-row">
                  {h.is_chronic && <Badge tone="chronic">chronic</Badge>}
                  {h.monsoon_inundation_risk && <Badge tone="monsoon">monsoon</Badge>}
                </div>
              ),
            },
            { key: 'status', header: 'Status', render: (h) => <span style={{ fontSize: 12, color: 'var(--muted)' }}>{h.status}</span> },
          ]}
          rows={top || []}
        />
      </Card>

      <HotspotDrawer
        hotspot={selected}
        detail={detail}
        loading={detailLoading}
        onClose={() => { setSelected(null); setDetail(null); }}
        onLocate={(h) => navigate('/map', { state: { focusId: h.hotspot_id } })}
        onGenerate={generate}
        onSetStatus={dispatch}
        canAct={can('hotspots:verify')}
      />
    </>
  );
}
