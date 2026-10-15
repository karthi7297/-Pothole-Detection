import React, { useMemo, useState } from 'react';
import {
  Camera, CheckCircle2, Clock, Inbox, MapPin, ShieldCheck, XCircle,
} from 'lucide-react';
import { API_BASE, dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, STATUS_TONE, coords, dateTime, relTime } from '../lib/format.js';
import {
  Badge, Banner, Button, Card, Chip, Drawer, Empty, KV, PageHead, SkeletonRows, Stat, Table, useToast,
} from '../components/ui.jsx';

const SOURCE_LABEL = {
  manual: 'Citizen app',
  'manual-citizen': 'Citizen app',
  citizen: 'Citizen app',
  dashcam: 'Fleet dashcam',
  simulator: 'Fleet dashcam',
  edge: 'Edge device',
};

const FILTERS = [
  { key: 'Pending', label: 'Pending' },
  { key: 'Verified', label: 'Verified' },
  { key: 'Rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const thumb = (url) => `${API_BASE}${url}`;

export default function Reports() {
  const toast = useToast();
  const [filter, setFilter] = useState('Pending');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(null);

  const { data, loading, refresh } = usePoll(() => dataApi.detections('?limit=400'), 15000, []);

  const rows = useMemo(() => {
    const all = data?.items || [];
    return all.filter((d) => {
      if (filter !== 'all' && d.status !== filter) return false;
      if (q) {
        const needle = q.toLowerCase();
        return (
          String(d.id).includes(needle) ||
          (d.location_name || '').toLowerCase().includes(needle) ||
          (d.street_name || '').toLowerCase().includes(needle) ||
          (d.zone_name || '').toLowerCase().includes(needle) ||
          (d.vehicle_id || '').toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [data, filter, q]);

  const counts = useMemo(() => {
    const all = data?.items || [];
    return {
      total: all.length,
      Pending: all.filter((d) => d.status === 'Pending').length,
      Verified: all.filter((d) => d.status === 'Verified').length,
      Rejected: all.filter((d) => d.status === 'Rejected').length,
    };
  }, [data]);

  const review = async (row, status) => {
    setBusyId(row.id);
    try {
      await dataApi.reviewDetection(row.id, status);
      toast.success(
        status === 'Verified'
          ? `Report #${row.id} accepted — it now counts toward the repair network.`
          : `Report #${row.id} rejected.`
      );
      setSelected((s) => (s && s.id === row.id ? { ...s, status } : s));
      refresh();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHead
        eyebrow="Verification"
        title="Report Inbox"
        subtitle="Every report filed by citizens and fleet. Accept the real road damage — it joins the repair network — or reject the rest. This is the start of the fix."
      />

      <div className="grid grid--4">
        <Stat label="Awaiting your call" value={counts.Pending} accent="var(--medium)" foot="pending verification" />
        <Stat label="Accepted" value={counts.Verified} accent="var(--brand)" foot="clustered into hotspots" />
        <Stat label="Rejected" value={counts.Rejected} accent="var(--critical)" foot="not road damage" />
        <Stat label="Total reports" value={counts.total} accent="var(--ink-2)" foot="citizen + fleet" />
      </div>

      <Card
        flush
        title="Incoming reports"
        eyebrow={`${rows.length} shown`}
        actions={
          <div className="toolbar">
            <div className="search">
              <Inbox size={14} />
              <input
                className="input"
                placeholder="Search id, location, zone or reporter…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        }
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div className="filters">
            {FILTERS.map((f) => (
              <Chip
                key={f.key}
                active={filter === f.key}
                onClick={() => setFilter(f.key)}
                count={f.key !== 'all' ? counts[f.key] : counts.total}
              >
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : !rows.length ? (
          <Empty
            icon={Inbox}
            title={filter === 'Pending' ? 'No reports waiting' : 'No reports match'}
            hint={
              filter === 'Pending'
                ? 'Every filed report has been reviewed. New citizen reports land here instantly.'
                : 'Try a different status filter or clear your search.'
            }
          />
        ) : (
          <Table
            rowKey={(d) => d.id}
            onRowClick={(d) => setSelected(d)}
            columns={[
              {
                key: 'photo',
                header: '',
                width: 54,
                render: (d) =>
                  d.image_url ? (
                    <img src={thumb(d.image_url)} alt="" className="report-thumb" />
                  ) : (
                    <span className="report-thumb report-thumb--empty"><Camera size={14} /></span>
                  ),
              },
              { key: 'id', header: 'Report', render: (d) => <b className="mono">#{d.id}</b> },
              {
                key: 'damage_class',
                header: 'Defect',
                render: (d) => (
                  <div>
                    <div className="t-strong">{CLASS_LABEL[d.damage_class] || d.damage_class}</div>
                    <div className="t-sub mono">{Math.round((d.confidence || 0) * 100)}% confidence</div>
                  </div>
                ),
              },
              {
                key: 'location_name',
                header: 'Location',
                render: (d) => (
                  <div>
                    <div className="t-strong">{d.location_name || d.street_name}</div>
                    <div className="t-sub mono">
                      {d.location_name && d.street_name && d.location_name !== d.street_name
                        ? `${d.street_name} · ${d.zone_name}`
                        : d.zone_name}
                    </div>
                  </div>
                ),
              },
              {
                key: 'source',
                header: 'Reported by',
                render: (d) => <span className="t-sub">{SOURCE_LABEL[d.source] || d.source}</span>,
              },
              { key: 'timestamp', header: 'When', align: 'right', render: (d) => <span className="mono" style={{ fontSize: 11 }}>{relTime(d.timestamp)}</span> },
              {
                key: 'status',
                header: 'Status',
                render: (d) => <Badge tone={STATUS_TONE[d.status] || 'neutral'}>{d.status}</Badge>,
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (d) =>
                  d.status === 'Pending' ? (
                    <div className="pill-row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" icon={XCircle} disabled={busyId === d.id} onClick={() => review(d, 'Rejected')}>
                        Reject
                      </Button>
                      <Button size="sm" variant="primary" icon={CheckCircle2} disabled={busyId === d.id} onClick={() => review(d, 'Verified')}>
                        Accept
                      </Button>
                    </div>
                  ) : (
                    <span className="t-sub">reviewed</span>
                  ),
              },
            ]}
            rows={rows}
          />
        )}
      </Card>

      <ReportDrawer
        report={selected}
        busy={busyId === selected?.id}
        onReview={review}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function ReportDrawer({ report, busy, onReview, onClose }) {
  if (!report) return null;
  const isPending = report.status === 'Pending';
  return (
    <Drawer
      open={!!report}
      onClose={onClose}
      eyebrow={`Report #${report.id}`}
      title={CLASS_LABEL[report.damage_class] || report.damage_class}
      actions={<Badge tone={STATUS_TONE[report.status] || 'neutral'}>{report.status}</Badge>}
      footer={
        isPending ? (
          <div className="pill-row">
            <Button variant="ghost" icon={XCircle} disabled={busy} onClick={() => onReview(report, 'Rejected')}>
              Reject
            </Button>
            <Button variant="primary" icon={CheckCircle2} disabled={busy} onClick={() => onReview(report, 'Verified')}>
              Accept as real damage
            </Button>
          </div>
        ) : (
          <span className="t-sub">This report has already been reviewed.</span>
        )
      }
    >
      {report.image_url &&
        (String(report.image_url).match(/\.(mp4|webm|mov)$/i) ? (
          <video src={thumb(report.image_url)} controls style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} />
        ) : (
          <img src={thumb(report.image_url)} alt="Reported road damage" style={{ width: '100%', borderRadius: 10, marginBottom: 12 }} />
        ))}

      <KV
        items={[
          { k: 'Confidence', v: `${Math.round((report.confidence || 0) * 100)}%` },
          { k: 'Reported by', v: SOURCE_LABEL[report.source] || report.source },
          { k: 'Location', v: report.location_name || report.street_name },
          { k: 'Street', v: report.street_name },
          { k: 'Zone', v: report.zone_name },
          { k: 'Road type', v: report.road_type },
          { k: 'Coordinates', v: coords(report.latitude, report.longitude) },
          { k: 'Reported at', v: dateTime(report.timestamp) },
          { k: 'Passes', v: report.pass_count },
          { k: 'Hotspot', v: report.hotspot_id ? `#${report.hotspot_id}` : 'not yet clustered' },
        ]}
      />

      {isPending ? (
        <Banner tone="info" icon={ShieldCheck} >
          Accepting this report links it to the nearest chronic hotspot (once it has been seen twice) and
          updates that road's PCI. Rejecting closes it with no effect on the network.
        </Banner>
      ) : (
        <Banner tone="info" icon={Clock}>
          Reviewed and <b>{report.status}</b>.
        </Banner>
      )}

      <div style={{ marginTop: 12 }}>
        <a
          className="btn btn--ghost btn--sm"
          href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPin size={14} /> Open location on map
        </a>
      </div>
    </Drawer>
  );
}
