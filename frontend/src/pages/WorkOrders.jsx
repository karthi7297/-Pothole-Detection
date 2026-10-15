import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, Play, Printer, Search, Sparkles, TriangleAlert, Wrench } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { GRADE_COLOR, inr, num, relTime } from '../lib/format.js';
import {
  Badge, Banner, Button, Card, Empty, Field, GradeBadge, PageHead, SkeletonRows, Stat, Table, useToast,
} from '../components/ui.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const WARDS = [
  'CMC Ward 32 Office (East)',
  'CMC Ward 12 Office (Central)',
  'CMC Ward 45 Office (North)',
  'CMC Ward 28 Office (South)',
  'CMC Ward 07 Office (West)',
];

export default function WorkOrders() {
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can('workorders:manage');
  const canUpdate = can('workorders:update');

  const [hotspotQuery, setHotspotQuery] = useState('');
  const [hotspotId, setHotspotId] = useState('');
  const [ward, setWard] = useState(WARDS[0]);
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [viewing, setViewing] = useState(null);

  const { data: hotspots, loading: loadingHotspots } = usePoll(() => dataApi.hotspots('?sort=priority&limit=200'), 30000, []);
  const { data: orders, loading: loadingOrders, refresh: refreshOrders } = usePoll(() => dataApi.workOrders('?limit=60'), 20000, []);

  const rows = hotspots?.items || [];

  const matches = useMemo(() => {
    const needle = hotspotQuery.trim().toLowerCase();
    const base = needle
      ? rows.filter((h) => h.street_name.toLowerCase().includes(needle) || (h.zone_name || '').toLowerCase().includes(needle))
      : rows;
    return base.slice(0, 40);
  }, [rows, hotspotQuery]);

  useEffect(() => {
    if (!hotspotId && rows.length) setHotspotId(String(rows[0].hotspot_id));
  }, [rows, hotspotId]);

  const selectedHotspot = rows.find((h) => String(h.hotspot_id) === String(hotspotId)) || null;

  const generate = async () => {
    if (!selectedHotspot) return;
    setBusy(true);
    try {
      const wo = await dataApi.createWorkOrder(Number(hotspotId), ward);
      setDraft(wo);
      toast.success(`Work order #${wo.work_order_id} issued via ${wo.model}.`);
      refreshOrders();
    } catch (e) {
      toast.error(
        e.status === 403
          ? 'Issuing work orders is a field-officer action.'
          : e.message
      );
    } finally {
      setBusy(false);
    }
  };

  const advance = async (row, status) => {
    setUpdatingId(row.work_order_id);
    try {
      const updated = await dataApi.updateWorkOrder(row.work_order_id, status);
      toast.success(`Work order #${row.work_order_id} marked ${status}.`);
      setViewing((v) => (v && v.work_order_id === row.work_order_id ? { ...v, ...updated } : v));
      setDraft((d) => (d && d.work_order_id === row.work_order_id ? { ...d, ...updated } : d));
      refreshOrders();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const summary = useMemo(() => {
    const list = orders || [];
    return {
      total: list.length,
      issued: list.filter((w) => w.status === 'Issued').length,
      budget: list.reduce((a, w) => a + (w.estimated_budget_inr || 0), 0),
      tonnes: list.reduce((a, w) => a + (w.asphalt_required_tons || 0), 0),
    };
  }, [orders]);

  const active = draft || viewing;

  return (
    <>
      <PageHead
        eyebrow="Dispatch"
        title="Work Orders"
        subtitle="Turn a verified defect into a formal municipal dispatch — material quantities, crew, cost and liability note included."
      />

      <div className="grid grid--4">
        <Stat label="Orders issued" value={num(summary.total)} accent="var(--brand)" foot={`${summary.issued} currently open`} />
        <Stat label="Committed budget" value={inr(summary.budget, { compact: true })} accent="var(--high)" foot="across all orders" />
        <Stat label="Asphalt scheduled" value={`${summary.tonnes.toFixed(1)} t`} accent="var(--ink-2)" foot="cold-mix + emulsion" />
        <Stat
          label="Chronic sites queued"
          value={num(rows.filter((h) => h.is_chronic).length)}
          accent="var(--chronic)"
          foot="reconstruction candidates"
        />
      </div>

      <div className="grid grid--side" style={{ alignItems: 'start' }}>
        <Card title="Generate dispatch" eyebrow="AI-assisted" actions={<Badge tone="brand" dot={false}>Nemotron / offline</Badge>}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Search defects">
              <div className="search">
                <Search size={14} />
                <input
                  className="input"
                  placeholder="Street or zone…"
                  value={hotspotQuery}
                  onChange={(e) => setHotspotQuery(e.target.value)}
                />
              </div>
            </Field>

            <Field label="Target defect">
              {loadingHotspots && !rows.length ? (
                <SkeletonRows rows={2} />
              ) : (
                <select className="select" value={hotspotId} onChange={(e) => setHotspotId(e.target.value)}>
                  {matches.map((h) => (
                    <option key={h.hotspot_id} value={h.hotspot_id}>
                      {h.grade} · {h.street_name} · {Number(h.priority_score).toFixed(1)}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field label="Assigning ward office">
              <select className="select" value={ward} onChange={(e) => setWard(e.target.value)}>
                {WARDS.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </Field>

            {selectedHotspot && (
              <div className="banner banner--info" style={{ display: 'block', fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <GradeBadge grade={selectedHotspot.grade} />
                  {selectedHotspot.is_chronic && <Badge tone="chronic">chronic</Badge>}
                  {selectedHotspot.monsoon_inundation_risk && <Badge tone="monsoon">monsoon</Badge>}
                </div>
                <b>{selectedHotspot.street_name}</b>
                <div style={{ color: 'var(--muted)', marginTop: 3 }}>
                  {selectedHotspot.detection_count} sightings · {selectedHotspot.road_type} ·{' '}
                  {selectedHotspot.zone_name}
                </div>
                <div className="mono" style={{ marginTop: 5, fontSize: 11 }}>
                  rebuild {inr(selectedHotspot.estimated_reconstruct_cost_inr)} · patched {inr(selectedHotspot.estimated_patch_cost_inr)}
                </div>
              </div>
            )}

            <Button variant="primary" icon={Sparkles} onClick={generate} disabled={busy || !canManage} block>
              {busy ? 'Generating dispatch…' : 'Generate work order'}
            </Button>

            {!canManage && (
              <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
                Issuing dispatches is a field-officer action. You can monitor the register below.
              </div>
            )}
          </div>
        </Card>

        <Card
          flush
          title={active ? `Work order #${active.work_order_id}` : 'Dispatch preview'}
          eyebrow={active ? `${active.priority_level} · ${active.assigned_ward_office} · ${active.model}` : 'Nothing generated yet'}
          actions={
            active && (
              <Button size="sm" icon={Printer} onClick={() => window.print()}>
                Print / PDF
              </Button>
            )
          }
        >
          {!active ? (
            <Empty
              icon={FileText}
              title="No dispatch loaded"
              hint="Pick a defect on the left and generate — the offline municipal template always works, and upgrades to live LLM text when an OpenRouter key is configured."
            />
          ) : (
            <>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <div className="eyebrow">Priority</div>
                  <div style={{ fontWeight: 600, color: GRADE_COLOR[active.priority_level] || 'var(--ink)' }}>
                    {active.priority_level}
                  </div>
                </div>
                <div>
                  <div className="eyebrow">Asphalt</div>
                  <div className="num" style={{ fontWeight: 600 }}>{active.asphalt_required_tons} t</div>
                </div>
                <div>
                  <div className="eyebrow">Budget</div>
                  <div className="num" style={{ fontWeight: 600 }}>{inr(active.estimated_budget_inr)}</div>
                </div>
                <div>
                  <div className="eyebrow">Ward</div>
                  <div style={{ fontSize: 12.5 }}>{active.assigned_ward_office}</div>
                </div>
              </div>
              <pre className="wo" style={{ border: 0, borderRadius: 0, maxHeight: 460 }}>{active.summary_text}</pre>
            </>
          )}
        </Card>
      </div>

      <Card flush title="Dispatch register" eyebrow={`${(orders || []).length} work orders`}>
        {loadingOrders && !orders ? (
          <SkeletonRows rows={5} />
        ) : !orders?.length ? (
          <Empty icon={Wrench} title="No work orders yet" hint="Generate one above to open the register." />
        ) : (
          <Table
            rowKey={(w) => w.work_order_id}
            onRowClick={(w) => { setViewing(w); setDraft(null); }}
            columns={[
              { key: 'work_order_id', header: 'WO #', render: (w) => <b className="mono">#{w.work_order_id}</b> },
              {
                key: 'street_name',
                header: 'Location',
                render: (w) => (
                  <div>
                    <div className="t-strong">{w.street_name || '—'}</div>
                    <div className="t-sub">{w.zone_name || ''}</div>
                  </div>
                ),
              },
              { key: 'priority_level', header: 'Priority', render: (w) => <GradeBadge grade={w.priority_level} /> },
              { key: 'asphalt_required_tons', header: 'Asphalt', align: 'right', render: (w) => `${Number(w.asphalt_required_tons || 0).toFixed(1)} t` },
              { key: 'estimated_budget_inr', header: 'Budget', align: 'right', render: (w) => inr(w.estimated_budget_inr) },
              {
                key: 'model',
                header: 'Engine',
                render: (w) => (
                  <span className="badge badge--neutral" style={{ fontSize: 9.5 }}>
                    {String(w.model || '').includes('offline') ? 'offline template' : 'LLM'}
                  </span>
                ),
              },
              { key: 'status', header: 'Status', render: (w) => <Badge tone={w.status === 'Completed' ? 'low' : w.status === 'Issued' ? 'high' : 'neutral'}>{w.status}</Badge> },
              { key: 'created_at', header: 'Issued', align: 'right', render: (w) => <span className="mono" style={{ fontSize: 11 }}>{relTime(w.created_at)}</span> },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (w) => {
                  const closed = w.status === 'Completed' || w.status === 'Cancelled';
                  if (!canUpdate || closed) return null;
                  return (
                    <div className="pill-row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                      {w.status !== 'In Progress' && (
                        <Button size="sm" variant="ghost" icon={Play} disabled={updatingId === w.work_order_id} onClick={() => advance(w, 'In Progress')}>
                          Start
                        </Button>
                      )}
                      <Button size="sm" variant="primary" icon={CheckCircle2} disabled={updatingId === w.work_order_id} onClick={() => advance(w, 'Completed')}>
                        Complete
                      </Button>
                    </div>
                  );
                },
              },
            ]}
            rows={orders}
          />
        )}
      </Card>

      {!can('workorders:read') && (
        <Banner tone="info" icon={TriangleAlert}>Your role cannot view the dispatch register.</Banner>
      )}
    </>
  );
}
