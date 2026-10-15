import React, { useMemo, useState } from 'react';
import { Activity, Cpu, Pause, Play, Radio, RefreshCw, Truck, Zap } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { useLiveFeed, usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, clockOf, num, relTime } from '../lib/format.js';
import {
  Badge, Banner, Button, Card, Empty, PageHead, SkeletonRows, Stat, Table, useToast,
} from '../components/ui.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const INTERVALS = [
  { label: 'Fast · 4 s', value: 4000 },
  { label: 'Normal · 9 s', value: 9000 },
  { label: 'Slow · 20 s', value: 20000 },
];

export default function Fleet() {
  const toast = useToast();
  const { isExecutive, can } = useAuth();
  const [intervalMs, setIntervalMs] = useState(9000);
  const [busy, setBusy] = useState('');

  const { data: fleet, loading } = usePoll(() => dataApi.fleet(), 12000, []);
  const { data: analytics } = usePoll(() => dataApi.fleetAnalytics(), 30000, []);
  const { data: recent } = usePoll(() => dataApi.detections('?limit=40'), 15000, []);
  const live = useLiveFeed({ limit: 60, enabled: true });

  const sim = fleet?.simulator;
  const running = sim?.running;

  const control = async (action) => {
    setBusy(action);
    try {
      const next = await dataApi.simulator(action, action === 'start' ? intervalMs : undefined);
      toast.success(
        action === 'start'
          ? `Fleet ingestion started — one observation every ${(next.intervalMs / 1000).toFixed(0)}s.`
          : action === 'stop'
            ? 'Fleet ingestion paused.'
            : next.tick?.kind === 'rejected'
              ? 'Manual tick rejected by the confidence gate (working as intended).'
              : 'Manual tick ingested.'
      );
    } catch (e) {
      toast.error(e.status === 403 ? 'Simulator control is restricted to the Municipal Executive role.' : e.message);
    } finally {
      setBusy('');
    }
  };

  const liveStats = useMemo(() => {
    const rows = live.events;
    return {
      total: rows.length,
      accepted: rows.filter((e) => e.kind === 'new' || e.kind === 'pass').length,
      rejected: rows.filter((e) => e.kind === 'rejected').length,
      chronic: rows.filter((e) => e.becomes_chronic).length,
    };
  }, [live.events]);

  if (loading && !fleet) {
    return (
      <>
        <PageHead eyebrow="Passive ingestion" title="Fleet & Ingestion" />
        <Card title="Loading fleet…"><SkeletonRows rows={5} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Passive ingestion"
        title="Fleet & Ingestion"
        subtitle="TNSTC buses and CMC waste trucks carry the vision stack. Every observation flows through the same validated ingestion pipeline as real edge hardware."
      >
        <Badge tone={running ? 'live' : 'neutral'}>{running ? 'Simulator running' : 'Simulator idle'}</Badge>
        <Badge tone={live.connected ? 'live' : 'neutral'}>{live.connected ? 'Stream connected' : 'Stream idle'}</Badge>
      </PageHead>

      <div className="grid grid--4">
        <Stat
          label="Observations ingested"
          value={num(sim?.emitted ?? 0)}
          icon={Activity}
          accent="var(--brand)"
          foot={running ? `every ${(sim.intervalMs / 1000).toFixed(0)}s` : 'simulator paused'}
        />
        <Stat
          label="Rejected by gate"
          value={num(sim?.rejected ?? 0)}
          icon={Cpu}
          accent="var(--medium)"
          foot="confidence below 0.60"
        />
        <Stat
          label="Deduplicated passes"
          value={num(sim?.deduplicated ?? 0)}
          icon={RefreshCw}
          accent="var(--chronic)"
          foot="same vehicle, same 5 m spot"
        />
        <Stat
          label="Observations · 24 h"
          value={num(fleet?.detections24h ?? 0)}
          icon={Zap}
          accent="var(--low)"
          foot={`${fleet?.roster?.length || 0} vehicles in the fleet`}
        />
      </div>

      <div className="grid grid--side">
        <Card
          title="Ingestion simulator"
          eyebrow="Executive control"
          actions={
            <div className="pill-row">
              <Button
                size="sm"
                icon={running ? Pause : Play}
                variant={running ? 'default' : 'primary'}
                disabled={!isExecutive || !!busy}
                onClick={() => control(running ? 'stop' : 'start')}
              >
                {busy === 'start' || busy === 'stop' ? 'Working…' : running ? 'Pause' : 'Start'}
              </Button>
              <Button size="sm" icon={Zap} disabled={!isExecutive || !!busy} onClick={() => control('tick')}>
                Single tick
              </Button>
            </div>
          }
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="field">
              <label>Emission interval</label>
              <select
                className="select"
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                disabled={running}
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>{i.label}</option>
                ))}
              </select>
            </div>

            <div className="kv">
              <div className="kv__row"><span className="kv__k">Status</span><span className="kv__v">{running ? 'Running' : 'Stopped'}</span></div>
              <div className="kv__row"><span className="kv__k">Interval</span><span className="kv__v">{((sim?.intervalMs || intervalMs) / 1000).toFixed(0)} s</span></div>
              <div className="kv__row"><span className="kv__k">Started</span><span className="kv__v">{sim?.startedAt ? relTime(sim.startedAt) : '—'}</span></div>
              <div className="kv__row"><span className="kv__k">Last frame</span><span className="kv__v">{sim?.lastEvent?.at ? relTime(sim.lastEvent.at) : '—'}</span></div>
            </div>

            <Banner tone="info" icon={Radio}>
              Simulated rows are tagged <code className="mono">source = simulator</code>, so they are never confused
              with genuine edge detections. Roughly 1 frame in 14 is deliberately below the confidence gate to
              demonstrate that the filter is enforced.
            </Banner>
          </div>
        </Card>

        <Card
          title="Live ingestion feed"
          eyebrow="Server-Sent Events"
          flush
          actions={
            <div className="pill-row">
              <Badge tone="low" dot={false}>{liveStats.accepted} accepted</Badge>
              <Badge tone="critical" dot={false}>{liveStats.rejected} rejected</Badge>
            </div>
          }
        >
          {live.events.length === 0 ? (
            <Empty
              icon={Radio}
              title="Waiting for telemetry"
              hint="Start the simulator to stream observations. Frames appear here the moment the API accepts or rejects them."
            />
          ) : (
            <div className="feed">
              {live.events.map((e, i) => {
                if (e.kind === 'hotspot') {
                  return (
                    <div className="feed__row" key={`h-${e.hotspot_id}-${i}`}>
                      <span className="feed__time">{clockOf(new Date().toISOString())}</span>
                      <span className="feed__veh">defect</span>
                      <span className="feed__street">
                        #{e.hotspot_id} {e.street_name} → {e.grade}
                      </span>
                      <span className="feed__conf">{Number(e.priority_score).toFixed(1)}</span>
                    </div>
                  );
                }
                const rejected = e.kind === 'rejected';
                return (
                  <div className={`feed__row ${rejected ? 'feed__row--rejected' : ''}`} key={`d-${e.detection_id ?? i}-${i}`}>
                    <span className="feed__time">{clockOf(e.timestamp || new Date().toISOString())}</span>
                    <span className="feed__veh">{e.vehicle_id}</span>
                    <span className="feed__street">
                      {CLASS_LABEL[e.damage_class] || e.damage_class}
                      {e.kind === 'pass' && ' · repeat pass'}
                      {rejected && ` · rejected (${e.reason})`}
                      {e.becomes_chronic && ' · chronic'}
                      {!rejected && ` @ ${e.street_name || ''}`}
                    </span>
                    <span
                      className="feed__conf"
                      style={{ color: rejected ? 'var(--critical)' : Number(e.confidence) >= 0.85 ? 'var(--low)' : 'var(--muted)' }}
                    >
                      {Number(e.confidence).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid--2">
        <Card flush title="Fleet roster" eyebrow="Vehicles contributing telemetry">
          <Table
            rowKey={(v) => v.id}
            columns={[
              {
                key: 'id',
                header: 'Vehicle',
                render: (v) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Truck size={15} style={{ color: 'var(--faint)' }} />
                    <div>
                      <div className="mono t-strong" style={{ fontSize: 12 }}>{v.id}</div>
                      <div className="t-sub">{v.route}</div>
                    </div>
                  </div>
                ),
              },
              { key: 'kind', header: 'Type', render: (v) => <Badge tone="neutral">{v.kind}</Badge> },
            ]}
            rows={fleet?.roster || []}
          />
        </Card>

        <Card flush title="Contribution by vehicle" eyebrow="Detections and average confidence">
          {analytics?.length ? (
            <Table
              rowKey={(a) => a.vehicle_id}
              columns={[
                { key: 'vehicle_id', header: 'Vehicle', render: (a) => <span className="mono" style={{ fontSize: 12 }}>{a.vehicle_id}</span> },
                { key: 'detections', header: 'Detections', align: 'right', render: (a) => num(a.detections) },
                {
                  key: 'avg_confidence',
                  header: 'Avg conf.',
                  align: 'right',
                  render: (a) => (
                    <span className="mono" style={{ color: a.avg_confidence >= 0.85 ? 'var(--low)' : 'var(--muted)' }}>
                      {Number(a.avg_confidence).toFixed(3)}
                    </span>
                  ),
                },
                { key: 'last_seen', header: 'Last seen', align: 'right', render: (a) => <span className="mono" style={{ fontSize: 11 }}>{relTime(a.last_seen)}</span> },
              ]}
              rows={analytics}
            />
          ) : (
            <Empty icon={Truck} title="No telemetry yet" />
          )}
        </Card>
      </div>

      <Card flush title="Recent observations" eyebrow={`${recent?.total ?? 0} total on record`}>
        {recent?.items?.length ? (
          <Table
            rowKey={(d) => d.id}
            columns={[
              { key: 'timestamp', header: 'When', render: (d) => <span className="mono" style={{ fontSize: 11 }}>{relTime(d.timestamp)}</span> },
              { key: 'vehicle_id', header: 'Vehicle', render: (d) => <span className="mono" style={{ fontSize: 11.5 }}>{d.vehicle_id}</span> },
              { key: 'damage_class', header: 'Defect', render: (d) => CLASS_LABEL[d.damage_class] || d.damage_class },
              {
                key: 'street_name',
                header: 'Location',
                render: (d) => (
                  <div>
                    <div style={{ fontSize: 12.5 }}>{d.street_name}</div>
                    <div className="t-sub">{d.zone_name}</div>
                  </div>
                ),
              },
              {
                key: 'confidence',
                header: 'Conf.',
                align: 'right',
                render: (d) => (
                  <span className="mono" style={{ color: d.confidence >= 0.85 ? 'var(--low)' : 'var(--muted)' }}>
                    {Number(d.confidence).toFixed(2)}
                  </span>
                ),
              },
              {
                key: 'source',
                header: 'Source',
                render: (d) => <Badge tone={d.source === 'simulator' ? 'chronic' : 'neutral'} dot={false}>{d.source}</Badge>,
              },
              { key: 'status', header: 'Status', render: (d) => <span style={{ fontSize: 12, color: 'var(--muted)' }}>{d.status}</span> },
            ]}
            rows={recent.items}
          />
        ) : (
          <Empty icon={Activity} title="No observations recorded" />
        )}
      </Card>

      {!can('detections:ingest') && (
        <Banner tone="info" icon={Truck}>
          Your role can view fleet telemetry but not post observations. Drivers and executives hold the ingestion
          capability.
        </Banner>
      )}
    </>
  );
}
