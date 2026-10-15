import React from 'react';
import { CircleDot, CloudRain, Crosshair, MapPin, Radio, TrendingUp, Truck, Wrench } from 'lucide-react';
import { Badge, Button, Drawer, GradeBadge, KV, Meter, Table } from './ui.jsx';
import { CLASS_LABEL, coords, dateTime, inr, num, relTime, PCI_COLOR } from '../lib/format.js';

/** Full defect record for a hotspot, opened from the map or the triage queue. */
export default function HotspotDrawer({ hotspot, detail, loading, onClose, onLocate, onGenerate, onSetStatus, canAct }) {
  const h = detail || hotspot;
  if (!h) return null;

  const open = Boolean(hotspot);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`Defect #${h.hotspot_id} · ${h.zone_name || ''}`}
      title={h.street_name}
      actions={<GradeBadge grade={h.grade} />}
      footer={
        <>
          {onLocate && (
            <Button icon={Crosshair} onClick={() => onLocate(h)}>
              Locate on map
            </Button>
          )}
          {canAct && (
            <>
              <Button
                variant="default"
                icon={Wrench}
                onClick={() => onSetStatus(h, h.status === 'Dispatched' ? 'Verified' : 'Dispatched')}
              >
                {h.status === 'Dispatched' ? 'Reopen' : 'Approve & dispatch'}
              </Button>
              <Button variant="primary" icon={TrendingUp} onClick={() => onGenerate(h)}>
                Generate work order
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="pill-row">
        {h.is_chronic && <Badge tone="chronic">Chronic sub-base failure</Badge>}
        {h.monsoon_inundation_risk && <Badge tone="monsoon">Monsoon exposure</Badge>}
        <Badge tone={String(h.status || '').toLowerCase() === 'repaired' ? 'low' : 'neutral'}>{h.status}</Badge>
        <Badge tone="neutral">{CLASS_LABEL[h.dominant_class] || h.dominant_class}</Badge>
      </div>

      <section>
        <div className="eyebrow" style={{ marginBottom: 7 }}>Priority</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <span className="num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em' }}>
            {Number(h.priority_score).toFixed(1)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>score / 60 · {h.grade}</span>
        </div>
        <Meter
          value={h.priority_index ?? Math.min(100, (h.priority_score / 60) * 100)}
          color={
            h.grade === 'CRITICAL' ? 'var(--critical)' : h.grade === 'HIGH' ? 'var(--high)' : h.grade === 'MEDIUM' ? 'var(--medium)' : 'var(--low)'
          }
        />
      </section>

      <section>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Defect record</div>
        <KV
          items={[
            { k: 'Fleet observations', v: num(h.detection_count) },
            { k: 'Dominant defect', v: CLASS_LABEL[h.dominant_class] || h.dominant_class },
            { k: 'Road class', v: h.road_type },
            { k: 'Zone', v: h.zone_name },
            { k: 'Coordinates', v: coords(h.center_lat, h.center_lon) },
            { k: 'First observed', v: dateTime(h.first_detected_at) },
            { k: 'Last observed', v: `${relTime(h.last_detected_at)}` },
            { k: 'Assigned ward', v: h.assigned_ward_office || '—' },
          ]}
        />
      </section>

      <section>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Cost of inaction</div>
        <KV
          items={[
            { k: 'Sunk into repeat patching', v: inr(h.estimated_patch_cost_inr) },
            { k: 'Permanent reconstruction', v: inr(h.estimated_reconstruct_cost_inr) },
            {
              k: 'Annual saving if rebuilt',
              v: (
                <span style={{ color: 'var(--low)', fontWeight: 600 }}>
                  {inr(
                    Math.max(
                      0,
                      h.detection_count * 2 * 9500 - (h.estimated_reconstruct_cost_inr || 0) / 3
                    )
                  )}
                </span>
              ),
            },
          ]}
        />
      </section>

      {h.workOrders?.length > 0 && (
        <section>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Dispatch history</div>
          <div style={{ display: 'grid', gap: 7 }}>
            {h.workOrders.map((w) => (
              <div key={w.work_order_id} className="banner banner--info" style={{ fontSize: 12 }}>
                <Wrench size={14} />
                <span>
                  WO #{w.work_order_id} · {w.priority_level} · {w.status}
                </span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{relTime(w.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Observation log</div>
        {loading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading detections…</div>}
        {!loading && (h.detections?.length ? (
          <Table
            rowKey={(d) => d.id}
            columns={[
              {
                key: 'timestamp',
                header: 'When',
                render: (d) => <span className="mono" style={{ fontSize: 11 }}>{relTime(d.timestamp)}</span>,
              },
              {
                key: 'vehicle_id',
                header: 'Vehicle',
                render: (d) => <span className="mono" style={{ fontSize: 11 }}>{d.vehicle_id}</span>,
              },
              { key: 'damage_class', header: 'Class', render: (d) => CLASS_LABEL[d.damage_class] || d.damage_class },
              {
                key: 'confidence',
                header: 'Conf.',
                align: 'right',
                render: (d) => (
                  <span
                    className="mono"
                    style={{ color: d.confidence >= 0.85 ? 'var(--low)' : 'var(--muted)' }}
                  >
                    {Number(d.confidence).toFixed(2)}
                  </span>
                ),
              },
              {
                key: 'source',
                header: 'Source',
                render: (d) => (
                  <span className="badge badge--neutral" style={{ fontSize: 9.5 }}>
                    {d.source}
                  </span>
                ),
              },
            ]}
            rows={h.detections}
          />
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No linked observations.</div>
        ))}
      </section>
    </Drawer>
  );
}
