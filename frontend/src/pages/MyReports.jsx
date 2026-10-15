import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, Clock, MapPin, Route, Search, Wrench } from 'lucide-react';
import { API_BASE, dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, STATUS_LABEL, STATUS_TONE, coords, dateTime, relTime } from '../lib/format.js';
import {
  Badge, Button, Card, Empty, PageHead, SkeletonRows, Stat, Table,
} from '../components/ui.jsx';

/** The ordered states a report moves through, end to end. */
const TIMELINE = [
  { key: 'Pending', label: 'Received', icon: Clock, note: 'A field officer will verify it shortly.' },
  { key: 'Verified', label: 'Verified', icon: CheckCircle2, note: 'Confirmed as real road damage.' },
  { key: 'Dispatched', label: 'Dispatched', icon: Route, note: 'A repair crew has been assigned.' },
  { key: 'Repaired', label: 'Repaired', icon: Wrench, note: 'The road has been fixed.' },
];

const stageIndex = (status) => {
  if (status === 'Rejected') return -1;
  const i = TIMELINE.findIndex((s) => s.key === status);
  return i === -1 ? 0 : i;
};

export default function MyReports() {
  const navigate = useNavigate();
  const { data, loading } = usePoll(() => dataApi.detections('?limit=200'), 15000, []);
  const [selected, setSelected] = useState(null);

  const rows = data?.items || [];

  const stats = useMemo(() => {
    const inProgress = rows.filter((d) => ['Pending', 'Verified', 'Dispatched'].includes(d.status)).length;
    const repaired = rows.filter((d) => d.status === 'Repaired').length;
    const rejected = rows.filter((d) => d.status === 'Rejected').length;
    return { total: rows.length, inProgress, repaired, rejected };
  }, [rows]);

  const active = selected || rows[0] || null;

  return (
    <>
      <PageHead
        eyebrow="Citizen tracking"
        title="My Reports"
        subtitle="Every road-damage report you filed, and exactly where it stands in the repair process."
      >
        <Button variant="primary" icon={Camera} onClick={() => navigate('/report')}>
          Report new damage
        </Button>
      </PageHead>

      <div className="grid grid--4">
        <Stat label="Reports filed" value={stats.total} accent="var(--brand)" foot="all time" />
        <Stat label="In progress" value={stats.inProgress} accent="var(--medium)" foot="being handled" />
        <Stat label="Repaired" value={stats.repaired} accent="var(--low)" foot="fixed" />
        <Stat label="Closed" value={stats.rejected} accent="var(--critical)" foot="no damage found" />
      </div>

      <div className="grid grid--side" style={{ alignItems: 'start' }}>
        <Card flush title="Your reports" eyebrow={`${rows.length} filed`}>
          {loading && !data ? (
            <SkeletonRows rows={6} />
          ) : !rows.length ? (
            <Empty
              icon={Camera}
              title="You haven't reported any damage yet"
              hint="Spotted a pothole or a bad patch? File a report with a photo and your location — you can follow it right here."
              action={<Button variant="primary" icon={Camera} onClick={() => navigate('/report')}>Report road damage</Button>}
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
                      <img src={`${API_BASE}${d.image_url}`} alt="" className="report-thumb" />
                    ) : (
                      <span className="report-thumb report-thumb--empty"><Camera size={14} /></span>
                    ),
                },
                { key: 'id', header: 'Report', render: (d) => <b className="mono">#{d.id}</b> },
                { key: 'damage_class', header: 'Defect', render: (d) => CLASS_LABEL[d.damage_class] || d.damage_class },
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
                { key: 'timestamp', header: 'When', align: 'right', render: (d) => <span className="mono" style={{ fontSize: 11 }}>{relTime(d.timestamp)}</span> },
                {
                  key: 'status',
                  header: 'Status',
                  align: 'right',
                  render: (d) => <Badge tone={STATUS_TONE[d.status] || 'neutral'}>{STATUS_LABEL[d.status] || d.status}</Badge>,
                },
              ]}
              rows={rows}
            />
          )}
        </Card>

        <Card title="Report status" eyebrow={active ? `Report #${active.id}` : 'Nothing selected'}>
          {!active ? (
            <Empty icon={Search} title="Select a report" hint="Pick a report on the left to follow its progress." />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{CLASS_LABEL[active.damage_class] || active.damage_class}</div>
                <div className="t-sub">{active.location_name || active.street_name} · {active.zone_name}</div>
                <div className="t-sub mono" style={{ fontSize: 11 }}>{coords(active.latitude, active.longitude)}</div>
              </div>

              {active.image_url && (
                <img src={`${API_BASE}${active.image_url}`} alt="Reported road damage" style={{ width: '100%', borderRadius: 10 }} />
              )}

              {active.status === 'Rejected' ? (
                <div className="banner banner--danger" style={{ display: 'block' }}>
                  <b>Closed — no damage found</b>
                  <div style={{ fontSize: 12, marginTop: 3, color: 'var(--muted)' }}>
                    A field officer reviewed your report on {dateTime(active.timestamp)} and did not find road damage.
                  </div>
                </div>
              ) : (
                <ol className="timeline">
                  {TIMELINE.map((step, i) => {
                    const done = i <= stageIndex(active.status);
                    const current = i === stageIndex(active.status);
                    return (
                      <li key={step.key} className={`timeline__step ${done ? 'is-done' : ''} ${current ? 'is-current' : ''}`}>
                        <span className="timeline__dot"><step.icon size={13} /></span>
                        <span className="timeline__text">
                          <b>{step.label}</b>
                          <span>{step.note}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              <a
                className="btn btn--ghost btn--sm"
                href={`https://www.openstreetmap.org/?mlat=${active.latitude}&mlon=${active.longitude}#map=18/${active.latitude}/${active.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin size={14} /> View this spot on the map
              </a>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
