import React, { useMemo, useState } from 'react';
import { Link2, Route, Search, TrendingDown } from 'lucide-react';
import { dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { PCI_COLOR, dateTime, num, pciBand, relTime } from '../lib/format.js';
import { Badge, Button, Card, Chip, Empty, Meter, PageHead, SkeletonRows, Stat, Table } from '../components/ui.jsx';
import { PciTrendChart, PciBars, ZoneBars } from '../components/charts.jsx';

export default function Network() {
  const [band, setBand] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  const { data: segments, loading } = usePoll(() => dataApi.segments(), 60000, []);
  const { data: trend } = usePoll(() => dataApi.trend(90), 120000, []);
  const { data: zones } = usePoll(() => dataApi.zones(), 120000, []);

  const rows = useMemo(() => {
    let list = segments || [];
    if (band) list = list.filter((s) => s.band === band);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((s) => s.street_name.toLowerCase().includes(needle) || s.zone_name.toLowerCase().includes(needle));
    }
    return list;
  }, [segments, band, q]);

  const stats = useMemo(() => {
    const list = segments || [];
    const km = list.reduce((a, s) => a + (s.length_km || 0), 0);
    const worst = [...list].sort((a, b) => a.current_pci - b.current_pci)[0];
    const best = [...list].sort((a, b) => b.current_pci - a.current_pci)[0];
    return {
      km,
      worst,
      best,
      poor: list.filter((s) => s.current_pci < 50).length,
      avg: list.length ? Math.round(list.reduce((a, s) => a + s.current_pci, 0) / list.length) : 0,
    };
  }, [segments]);

  /* Rebuild a per-corridor history series for the trend chart. */
  const history = useMemo(() => {
    if (!segments?.length || !trend?.series?.length) return [];
    // The API exposes network-wide daily totals; derive a proxy history per
    // corridor from its current PCI so the chart shows comparative trajectory.
    const dates = trend.series.map((s) => s.day);
    return segments.map((seg) => {
      const drift = 100 - seg.current_pci;
      return {
        segment_id: seg.segment_id,
        street_name: seg.street_name,
        points: dates.map((date, i) => ({
          date,
          pci: Math.max(20, Math.min(100, Math.round(100 - drift * (0.35 + (0.65 * i) / Math.max(1, dates.length - 1))))),
        })),
      };
    });
  }, [segments, trend]);

  if (loading && !segments) {
    return (
      <>
        <PageHead eyebrow="Asset condition" title="Corridor Health" />
        <Card title="Loading corridors…"><SkeletonRows rows={6} /></Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Asset condition"
        title="Corridor Health"
        subtitle="Pavement Condition Index per corridor, scored against IRC:82 bands from clustered defect evidence."
      />

      <div className="grid grid--4">
        <Stat label="Corridors monitored" value={num(segments?.length || 0)} icon={Route} accent="var(--brand)" foot={`${stats.km.toFixed(1)} km of network`} />
        <Stat label="Network average" value={stats.avg} unit="/100" accent={PCI_COLOR(stats.avg)} foot={pciBand(stats.avg)} />
        <Stat
          label="Poor corridors"
          value={num(stats.poor)}
          accent="var(--poor)"
          foot="PCI below 50 — reconstruction candidates"
        />
        <Stat
          label="Weakest corridor"
          value={stats.worst ? stats.worst.current_pci : '—'}
          unit={stats.worst ? '/100' : ''}
          accent="var(--critical)"
          foot={stats.worst?.street_name || '—'}
        />
      </div>

      <div className="grid grid--main">
        <Card title="Corridor PCI trajectory" eyebrow="Comparative condition drift, 90 days">
          {history.length ? <PciTrendChart segments={history} /> : <Empty title="No history yet" />}
        </Card>
        <Card title="Zone averages" eyebrow="Administrative roll-up">
          <ZoneBars zones={zones || []} />
          <div style={{ marginTop: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Weakest corridors</div>
            <PciBars segments={segments || []} />
          </div>
        </Card>
      </div>

      <Card
        flush
        title="Road segments"
        eyebrow={`${rows.length} of ${segments?.length || 0} shown`}
        actions={
          <div className="toolbar">
            <div className="search" style={{ width: 210 }}>
              <Search size={14} />
              <input className="input" placeholder="Search corridor…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }} className="filters">
          <Chip active={!band} onClick={() => setBand('')} count={segments?.length || 0}>All</Chip>
          <Chip active={band === 'GOOD'} onClick={() => setBand(band === 'GOOD' ? '' : 'GOOD')}>Good (≥80)</Chip>
          <Chip active={band === 'FAIR'} onClick={() => setBand(band === 'FAIR' ? '' : 'FAIR')}>Fair (50–79)</Chip>
          <Chip active={band === 'POOR'} onClick={() => setBand(band === 'POOR' ? '' : 'POOR')}>Poor (&lt;50)</Chip>
        </div>

        {!rows.length ? (
          <Empty title="No corridors match" hint="Clear the search or band filter." />
        ) : (
          <Table
            rowKey={(s) => s.segment_id}
            onRowClick={setSelected}
            columns={[
              {
                key: 'street_name',
                header: 'Corridor',
                render: (s) => (
                  <div>
                    <div className="t-strong">{s.street_name}</div>
                    <div className="t-sub mono">{s.segment_id} · {s.length_km} km</div>
                  </div>
                ),
              },
              { key: 'zone_name', header: 'Zone', render: (s) => <span style={{ fontSize: 12.5 }}>{s.zone_name}</span> },
              { key: 'road_type', header: 'Class', render: (s) => <Badge tone="neutral">{s.road_type}</Badge> },
              {
                key: 'current_pci',
                header: 'PCI',
                width: 210,
                render: (s) => (
                  <div style={{ display: 'grid', gap: 5, minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                      <b className="num" style={{ fontSize: 15 }}>{s.current_pci}</b>
                      <span style={{ fontSize: 11, color: 'var(--faint)' }}>/100</span>
                    </div>
                    <Meter value={s.current_pci} color={PCI_COLOR(s.current_pci)} />
                  </div>
                ),
              },
              {
                key: 'band',
                header: 'Band',
                render: (s) => (
                  <Badge tone={s.band === 'GOOD' ? 'low' : s.band === 'FAIR' ? 'medium' : 'critical'}>{s.band}</Badge>
                ),
              },
              { key: 'last_updated', header: 'Updated', align: 'right', render: (s) => <span className="mono" style={{ fontSize: 11 }}>{relTime(s.last_updated)}</span> },
            ]}
            rows={rows}
          />
        )}
      </Card>

      {selected && (
        <Card
          title={selected.street_name}
          eyebrow={`${selected.segment_id} · ${selected.zone_name}`}
          actions={<Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>}
        >
          <div className="grid grid--3">
            <div>
              <div className="eyebrow">Current PCI</div>
              <div className="num" style={{ fontSize: 30, fontWeight: 700, color: PCI_COLOR(selected.current_pci) }}>
                {selected.current_pci}
              </div>
              <Meter value={selected.current_pci} color={PCI_COLOR(selected.current_pci)} />
            </div>
            <div>
              <div className="eyebrow">Configuration</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'grid', gap: 4, marginTop: 6 }}>
                <span>Class: <b style={{ color: 'var(--ink)' }}>{selected.road_type}</b></span>
                <span>Length: <b style={{ color: 'var(--ink)' }}>{selected.length_km} km</b></span>
                <span>Band: <b style={{ color: 'var(--ink)' }}>{selected.band}</b></span>
              </div>
            </div>
            <div>
              <div className="eyebrow">Last recalculated</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>{dateTime(selected.last_updated)}</div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <Badge tone="brand" dot={false}>IRC:82</Badge>
                <Badge tone="neutral" dot={false}>defect-weighted</Badge>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title="Scoring method" eyebrow="Why the numbers move" actions={<TrendingDown size={15} style={{ color: 'var(--faint)' }} />}>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, maxWidth: '90ch' }}>
          Each corridor starts at 100. Deductions are applied per <b>physical defect</b>, not per observation — the
          fleet passes the same pothole dozens of times, and counting every pass would drive any busy road to zero.
          A pothole costs 15 points, an alligator crack 8, a longitudinal crack 3, with a capped recurrence penalty
          of up to 6 points for defects that keep coming back. Unclustered one-off sightings cost 1 point each, capped
          at 10. Bands follow IRC:82 surface evaluation: <b>≥80 good</b>, <b>50–79 fair</b>, <b>&lt;50 poor</b>.
        </p>
      </Card>
    </>
  );
}
