import React, { useMemo, useState } from 'react';
import { CheckCircle2, Search, SlidersHorizontal, TriangleAlert, Wrench, XCircle } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, coords, inr, num, relTime } from '../lib/format.js';
import {
  Badge, Banner, Button, Card, Chip, Empty, GradeBadge, PageHead, SkeletonRows, Stat, Table, useToast,
} from '../components/ui.jsx';
import HotspotDrawer from '../components/HotspotDrawer.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const GRADES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES = ['Active', 'Verified', 'Dispatched', 'Repaired', 'Rejected'];

export default function Triage() {
  const toast = useToast();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');
  const [chronicOnly, setChronicOnly] = useState(false);
  const [sort, setSort] = useState('priority');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const params = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (grade) sp.set('grade', grade);
    if (status) sp.set('status', status);
    if (chronicOnly) sp.set('chronic', 'true');
    sp.set('sort', sort);
    sp.set('limit', '200');
    return `?${sp.toString()}`;
  }, [q, grade, status, chronicOnly, sort]);

  const { data, loading } = usePoll(() => dataApi.hotspots(params), 20000, [params]);
  const rows = data?.items || [];

  const open = async (h) => {
    setSelected(h);
    setDetail(null);
    setLoadingDetail(true);
    try {
      setDetail(await dataApi.hotspot(h.hotspot_id));
    } catch {
      /* fall back */
    } finally {
      setLoadingDetail(false);
    }
  };

  const act = async (h, next) => {
    try {
      const updated = await dataApi.updateHotspot(h.hotspot_id, { status: next });
      toast.success(`Defect #${h.hotspot_id} marked ${next}.`);
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

  const stats = useMemo(() => {
    const critical = rows.filter((h) => h.grade === 'CRITICAL').length;
    const pending = rows.filter((h) => h.status === 'Pending' || h.status === 'Active').length;
    const chronic = rows.filter((h) => h.is_chronic).length;
    const exposure = rows.reduce(
      (a, h) => a + (h.detection_count * 2 * 9500 - (h.estimated_reconstruct_cost_inr || 0) / 3 > 0
        ? h.detection_count * 2 * 9500 - (h.estimated_reconstruct_cost_inr || 0) / 3
        : 0),
      0
    );
    return { critical, pending, chronic, exposure };
  }, [rows]);

  return (
    <>
      <PageHead
        eyebrow="Verification"
        title="Triage Queue"
        subtitle="Every tracked defect, ranked by dynamic priority score. Inspectors verify, executives dispatch."
      />

      <div className="grid grid--4">
        <Stat label="Awaiting action" value={num(stats.pending)} accent="var(--medium)" foot="pending or unverified" />
        <Stat label="Critical" value={num(stats.critical)} accent="var(--critical)" foot="score above 35" />
        <Stat label="Chronic defects" value={num(stats.chronic)} accent="var(--chronic)" foot="reported 3+ times" />
        <Stat label="Saving available" value={inr(stats.exposure, { compact: true })} accent="var(--low)" foot="if rebuilt permanently" />
      </div>

      <Card
        flush
        title="Defect queue"
        eyebrow={`${rows.length} records`}
        actions={
          <div className="toolbar">
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 150 }}>
              <option value="priority">Sort: priority</option>
              <option value="reports">Sort: sightings</option>
              <option value="recent">Sort: most recent</option>
              <option value="street">Sort: street</option>
            </select>
          </div>
        }
      >
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'grid', gap: 10 }}>
          <div className="search">
            <Search size={14} />
            <input
              className="input"
              placeholder="Search by street, zone or defect class…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="filters">
            <Chip active={!grade} onClick={() => setGrade('')} count={rows.length}>All</Chip>
            {GRADES.map((g) => (
              <Chip key={g} active={grade === g} onClick={() => setGrade(grade === g ? '' : g)}>
                {g.charAt(0) + g.slice(1).toLowerCase()}
              </Chip>
            ))}
            <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Chip active={chronicOnly} onClick={() => setChronicOnly((v) => !v)}>Chronic only</Chip>
          </div>
        </div>

        {loading && !rows.length ? (
          <SkeletonRows rows={8} />
        ) : !rows.length ? (
          <Empty icon={SlidersHorizontal} title="No defects match these filters" hint="Clear a filter or widen your search to see more records." />
        ) : (
          <Table
            rowKey={(h) => h.hotspot_id}
            onRowClick={open}
            columns={[
              { key: 'grade', header: 'Priority', render: (h) => <GradeBadge grade={h.grade} /> },
              {
                key: 'street_name',
                header: 'Location',
                render: (h) => (
                  <div>
                    <div className="t-strong">{h.street_name}</div>
                    <div className="t-sub mono">{coords(h.center_lat, h.center_lon)}</div>
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
              {
                key: 'status',
                header: 'Status',
                render: (h) => (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{h.status}</span>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (h) => (
                  <div className="pill-row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                    {can('hotspots:verify') && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={h.status === 'Rejected' ? CheckCircle2 : XCircle}
                          onClick={() => act(h, h.status === 'Rejected' ? 'Verified' : 'Rejected')}
                          title={h.status === 'Rejected' ? 'Restore' : 'Reject'}
                        >
                          {h.status === 'Rejected' ? 'Restore' : 'Reject'}
                        </Button>
                        <Button size="sm" variant="primary" icon={Wrench} onClick={() => act(h, 'Dispatched')}>
                          Dispatch
                        </Button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            rows={rows}
          />
        )}
      </Card>

      {!can('hotspots:verify') && (
        <Banner tone="info" icon={TriangleAlert}>
          Your role has read-only access to the triage queue. Verification and dispatch need the{' '}
          <b>Field Inspector</b> or <b>Municipal Executive</b> role.
        </Banner>
      )}

      <HotspotDrawer
        hotspot={selected}
        detail={detail}
        loading={loadingDetail}
        onClose={() => { setSelected(null); setDetail(null); }}
        onGenerate={generate}
        onSetStatus={act}
        canAct={can('hotspots:verify')}
      />
    </>
  );
}
