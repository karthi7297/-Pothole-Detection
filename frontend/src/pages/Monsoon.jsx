import React, { useMemo } from 'react';
import { CloudRain, Droplets, RefreshCw, ShieldAlert, Sun, TriangleAlert, Wind } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, coords, dayShort, num, relTime } from '../lib/format.js';
import { Badge, Banner, Button, Card, GradeBadge, KV, PageHead, SkeletonRows, Stat, Table } from '../components/ui.jsx';
import { RainChart } from '../components/charts.jsx';

export default function Monsoon() {
  const { data: monsoon, loading, error } = usePoll(() => dataApi.monsoon(), 120000, []);
  const { data: weather } = usePoll(() => dataApi.weather(), 120000, []);

  const forecast = monsoon?.forecast || weather;
  const days = forecast?.days || [];
  const threshold = monsoon?.thresholdMm ?? 25;

  const worst = useMemo(() => days.reduce((a, d) => (d.rainMm > (a?.rainMm || -1) ? d : a), null), [days]);

  if (loading && !monsoon) {
    return (
      <>
        <PageHead eyebrow="Predictive maintenance" title="Monsoon Watch" />
        <Card title="Fetching forecast…"><SkeletonRows rows={5} /></Card>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead eyebrow="Predictive maintenance" title="Monsoon Watch" />
        <Banner tone="danger" icon={TriangleAlert}>{error.message}</Banner>
      </>
    );
  }

  const active = monsoon?.riskActive;
  const severity = monsoon?.severity || 'NORMAL';

  return (
    <>
      <PageHead
        eyebrow="Predictive maintenance"
        title="Monsoon Watch"
        subtitle={`Water entering open cracks strips the asphalt binder under heavy-vehicle load. Any cracked corridor with ${threshold} mm/day or more forecast is treated as an emergency.`}
      >
        <Badge tone={forecast?.live ? 'live' : 'neutral'}>
          {forecast?.source || 'forecast'}
        </Badge>
        <Button size="sm" icon={RefreshCw} onClick={() => window.location.reload()}>
          Re-run assessment
        </Button>
      </PageHead>

      <Banner
        tone={severity === 'SEVERE' ? 'danger' : severity === 'ELEVATED' ? 'warn' : 'ok'}
        icon={severity === 'NORMAL' ? Sun : ShieldAlert}
      >
        <b>{severity} monsoon exposure.</b> {monsoon?.advisory}
      </Banner>

      <div className="grid grid--4">
        <Stat
          label="Peak rainfall (7 d)"
          value={forecast?.peakRainMm ?? worst?.rainMm ?? 0}
          unit="mm"
          icon={Droplets}
          accent="var(--monsoon)"
          foot={`threshold ${threshold} mm/day`}
        />
        <Stat
          label="Active hazards"
          value={num(monsoon?.exposed?.length || 0)}
          icon={CloudRain}
          accent="var(--critical)"
          foot="cracked + threshold rainfall"
        />
        <Stat
          label="Vulnerable locations"
          value={num(monsoon?.vulnerable?.length || 0)}
          icon={Wind}
          accent="var(--high)"
          foot="cracked, awaiting rain"
        />
        <Stat
          label="Response window"
          value={monsoon?.windowHours ? `${monsoon.windowHours} h` : '—'}
          icon={ShieldAlert}
          accent="var(--medium)"
          foot={active ? 'seal cracks now' : 'no active window'}
        />
      </div>

      <div className="grid grid--main">
        <Card title="Rainfall forecast" eyebrow="Next 7 days · open-meteo">
          <RainChart days={days} threshold={threshold} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8, marginTop: 14 }}>
            {days.slice(0, 7).map((d) => (
              <div
                key={d.date}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r)',
                  padding: '9px 10px',
                  background: d.rainMm >= threshold ? 'var(--critical-soft)' : 'var(--surface-2)',
                }}
              >
                <div className="eyebrow">{dayShort(d.date)}</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, color: d.rainMm >= threshold ? 'var(--critical)' : 'var(--ink)' }}>
                  {d.rainMm} <span style={{ fontSize: 11, fontWeight: 400 }}>mm</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {d.tMax != null ? `${Math.round(d.tMax)}°` : ''} {d.label || ''}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Assessment" eyebrow="Engine output">
          <KV
            items={[
              { k: 'Severity', v: severity },
              { k: 'Risk active', v: active ? 'Yes' : 'No' },
              { k: 'Rainfall threshold', v: `${threshold} mm/day` },
              { k: 'Peak forecast', v: `${forecast?.peakRainMm ?? '—'} mm` },
              { k: 'Source', v: forecast?.source || '—' },
              { k: 'Response window', v: monsoon?.windowHours ? `${monsoon.windowHours} hours` : 'None' },
              { k: 'Rainy days ahead', v: num(monsoon?.rainyDays?.length || 0) },
            ]}
          />
          <div style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>How this is computed</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
              The engine pulls a free Open-Meteo forecast for Coimbatore, finds days at or above{' '}
              {threshold} mm, then cross-references every defect whose dominant class is{' '}
              <b>alligator crack</b> or <b>longitudinal crack</b> — the water-ingress vectors. Matches are flagged
              on the map and in the triage queue.
            </p>
          </div>
        </Card>
      </div>

      {monsoon?.exposed?.length > 0 && (
        <Card flush title="Active monsoon hazards" eyebrow="Cracked corridors inside the rain window">
          <Table
            rowKey={(h) => h.hotspot_id}
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
              { key: 'last_detected_at', header: 'Last seen', align: 'right', render: (h) => relTime(h.last_detected_at) },
              { key: 'action', header: '', align: 'right', render: () => <Badge tone="monsoon">seal within 48 h</Badge> },
            ]}
            rows={monsoon.exposed}
          />
        </Card>
      )}

      <Card flush title="Vulnerable inventory" eyebrow="Cracked locations — one storm away from sub-base failure">
        {monsoon?.vulnerable?.length ? (
          <Table
            rowKey={(h) => h.hotspot_id}
            columns={[
              { key: 'grade', header: 'Priority', render: (h) => <GradeBadge grade={h.grade} /> },
              {
                key: 'street_name',
                header: 'Location',
                render: (h) => (
                  <div>
                    <div className="t-strong">{h.street_name}</div>
                    <div className="t-sub">{h.zone_name}</div>
                  </div>
                ),
              },
              { key: 'dominant_class', header: 'Crack type', render: (h) => CLASS_LABEL[h.dominant_class] || h.dominant_class },
              { key: 'detection_count', header: 'Sightings', align: 'right', render: (h) => num(h.detection_count) },
              {
                key: 'exposed',
                header: 'Status',
                render: (h) => (h.exposed ? <Badge tone="critical">in rain window</Badge> : <Badge tone="neutral">monitoring</Badge>),
              },
            ]}
            rows={monsoon.vulnerable}
          />
        ) : (
          <div className="empty">
            <Sun size={26} strokeWidth={1.5} />
            <b>No cracked locations on record</b>
            <span>Nothing currently exposes the sub-base to water ingress.</span>
          </div>
        )}
      </Card>
    </>
  );
}
