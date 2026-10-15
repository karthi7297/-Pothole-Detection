import React, { useMemo, useState } from 'react';
import { Database, KeyRound, ScrollText, Search, Server, ShieldCheck, Users } from 'lucide-react';
import { authApi, dataApi } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { ROLE_LABEL, DEMO_ACCOUNTS } from '../state/AuthContext.jsx';
import { dateTime, relTime } from '../lib/format.js';
import { Badge, Card, Chip, Empty, PageHead, SkeletonRows, Stat, Table } from '../components/ui.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const ACTION_TONE = {
  'auth.login': 'low',
  'system.seed': 'brand',
  'workorder.create': 'high',
  'hotspot.update': 'medium',
  'detection.review': 'brand',
  'detection.ingest': 'neutral',
  'fleet.simulator_start': 'monsoon',
  'fleet.simulator_stop': 'neutral',
  'fleet.simulate_tick': 'monsoon',
};

export default function Governance() {
  const { isExecutive, capabilities, user } = useAuth();
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');

  const { data: audit, loading } = usePoll(() => dataApi.audit(120), 20000, []);
  const { data: users } = usePoll(() => (isExecutive ? authApi.users() : Promise.resolve(null)), 120000, [isExecutive]);
  const { data: health } = usePoll(() => dataApi.health(), 30000, []);
  const { data: events } = usePoll(() => dataApi.eventStatus(), 20000, []);

  const rows = useMemo(() => {
    let list = audit || [];
    if (action) list = list.filter((a) => a.action === action);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (a) =>
          (a.action || '').toLowerCase().includes(needle) ||
          (a.user_email || '').toLowerCase().includes(needle) ||
          (a.detail || '').toLowerCase().includes(needle) ||
          (a.entity || '').toLowerCase().includes(needle)
      );
    }
    return list;
  }, [audit, q, action]);

  const actionTypes = useMemo(() => [...new Set((audit || []).map((a) => a.action))].sort(), [audit]);

  const stats = useMemo(() => {
    const list = audit || [];
    return {
      total: list.length,
      operators: new Set(list.map((a) => a.user_email).filter(Boolean)).size,
      writes: list.filter((a) => !String(a.action).startsWith('auth.')).length,
      logins: list.filter((a) => String(a.action).startsWith('auth.')).length,
    };
  }, [audit]);

  return (
    <>
      <PageHead
        eyebrow="Accountability"
        title="Governance"
        subtitle="Every privileged mutation is written to an append-only audit trail. Nothing in this console changes state silently."
      />

      <div className="grid grid--4">
        <Stat label="Audit entries" value={stats.total} icon={ScrollText} accent="var(--brand)" foot="most recent 120" />
        <Stat label="Distinct operators" value={stats.operators} icon={Users} accent="var(--chronic)" foot="actors in the trail" />
        <Stat label="State changes" value={stats.writes} icon={ShieldCheck} accent="var(--high)" foot="excluding sign-ins" />
        <Stat label="Sign-ins" value={stats.logins} icon={KeyRound} accent="var(--low)" foot="authenticated sessions" />
      </div>

      <div className="grid grid--3">
        <Card title="API health" eyebrow="Runtime">
          <div className="kv">
            <div className="kv__row"><span className="kv__k">Service</span><span className="kv__v">{health?.service || '—'}</span></div>
            <div className="kv__row"><span className="kv__k">Version</span><span className="kv__v">{health?.version || '—'}</span></div>
            <div className="kv__row"><span className="kv__k">Status</span><span className="kv__v">{health?.ok ? 'Healthy' : '—'}</span></div>
            <div className="kv__row"><span className="kv__k">Simulator</span><span className="kv__v">{health?.simulator || '—'}</span></div>
            <div className="kv__row"><span className="kv__k">Checked</span><span className="kv__v">{health?.ts ? relTime(new Date(health.ts).toISOString()) : '—'}</span></div>
          </div>
        </Card>

        <Card title="Telemetry stream" eyebrow="Server-Sent Events">
          <div className="kv">
            <div className="kv__row"><span className="kv__k">Connected clients</span><span className="kv__v">{events?.connectedClients ?? '—'}</span></div>
            <div className="kv__row"><span className="kv__k">Simulator running</span><span className="kv__v">{events?.simulator?.running ? 'Yes' : 'No'}</span></div>
            <div className="kv__row"><span className="kv__k">Frames emitted</span><span className="kv__v">{events?.simulator?.emitted ?? '—'}</span></div>
            <div className="kv__row"><span className="kv__k">Frames rejected</span><span className="kv__v">{events?.simulator?.rejected ?? '—'}</span></div>
          </div>
        </Card>

        <Card title="Your session" eyebrow="Effective permissions">
          <div className="kv">
            <div className="kv__row"><span className="kv__k">Signed in as</span><span className="kv__v">{user?.email}</span></div>
            <div className="kv__row"><span className="kv__k">Role</span><span className="kv__v">{ROLE_LABEL[user?.role] || user?.role}</span></div>
            <div className="kv__row"><span className="kv__k">Capabilities</span><span className="kv__v">{capabilities.length}</span></div>
          </div>
          <div className="pill-row" style={{ marginTop: 12 }}>
            {capabilities.map((c) => (
              <span key={c} className="badge badge--neutral" style={{ fontSize: 9.5 }}>{c}</span>
            ))}
          </div>
        </Card>
      </div>

      {isExecutive && (
        <Card flush title="Access directory" eyebrow="Users and effective capabilities">
          {!users ? (
            <SkeletonRows rows={4} />
          ) : (
            <Table
              rowKey={(u) => u.id}
              columns={[
                {
                  key: 'name',
                  header: 'User',
                  render: (u) => (
                    <div>
                      <div className="t-strong">{u.name}</div>
                      <div className="t-sub mono">{u.email}</div>
                    </div>
                  ),
                },
                { key: 'role', header: 'Role', render: (u) => <Badge tone="brand">{ROLE_LABEL[u.role] || u.role}</Badge> },
                {
                  key: 'capabilities',
                  header: 'Capabilities',
                  render: (u) => (
                    <div className="pill-row">
                      {(u.capabilities || []).slice(0, 6).map((c) => (
                        <span key={c} className="badge badge--neutral" style={{ fontSize: 9.5 }}>{c}</span>
                      ))}
                      {(u.capabilities || []).length > 6 && (
                        <span className="badge badge--neutral" style={{ fontSize: 9.5 }}>
                          +{u.capabilities.length - 6}
                        </span>
                      )}
                    </div>
                  ),
                },
                { key: 'created_at', header: 'Added', align: 'right', render: (u) => <span className="mono" style={{ fontSize: 11 }}>{dateTime(u.created_at)}</span> },
              ]}
              rows={users}
            />
          )}
        </Card>
      )}

      <Card
        flush
        title="Audit trail"
        eyebrow={`${rows.length} entries`}
        actions={
          <div className="toolbar">
            <div className="search" style={{ width: 200 }}>
              <Search size={14} />
              <input className="input" placeholder="Search actor or detail…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }} className="filters">
          <Chip active={!action} onClick={() => setAction('')} count={audit?.length || 0}>All actions</Chip>
          {actionTypes.map((a) => (
            <Chip key={a} active={action === a} onClick={() => setAction(action === a ? '' : a)}>
              {a}
            </Chip>
          ))}
        </div>

        {loading && !audit ? (
          <SkeletonRows rows={8} />
        ) : !rows.length ? (
          <Empty icon={Database} title="No audit entries match" hint="Clear the filters to see the full trail." />
        ) : (
          <Table
            rowKey={(a) => a.id}
            columns={[
              { key: 'created_at', header: 'When', render: (a) => <span className="mono" style={{ fontSize: 11 }}>{dateTime(a.created_at)}</span> },
              {
                key: 'action',
                header: 'Action',
                render: (a) => <Badge tone={ACTION_TONE[a.action] || 'neutral'} dot={false}>{a.action}</Badge>,
              },
              {
                key: 'user_email',
                header: 'Actor',
                render: (a) => <span className="mono" style={{ fontSize: 11.5 }}>{a.user_email || 'system'}</span>,
              },
              { key: 'entity', header: 'Entity', render: (a) => <span style={{ fontSize: 12, color: 'var(--muted)' }}>{a.entity || '—'}{a.entity_id ? ` #${a.entity_id}` : ''}</span> },
              { key: 'detail', header: 'Detail', render: (a) => <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{a.detail || '—'}</span> },
            ]}
            rows={rows}
          />
        )}
      </Card>

      {!isExecutive && (
        <Card title="Demo accounts" eyebrow="Switch role from the top bar to explore each permission set">
          <div className="grid grid--3">
            {DEMO_ACCOUNTS.map((a) => (
              <div key={a.role} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 13 }}>
                <Badge tone="brand">{ROLE_LABEL[a.role]}</Badge>
                <div style={{ fontWeight: 600, marginTop: 8, fontSize: 13 }}>{a.name}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{a.email}</div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{a.scope}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
