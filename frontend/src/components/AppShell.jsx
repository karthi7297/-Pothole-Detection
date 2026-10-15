import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, ChevronDown, ClipboardCheck, CloudRain, FileText, LayoutDashboard,
  LogOut, MapPin, Menu, Radio, Route, ShieldAlert, Truck, X,
} from 'lucide-react';
import { DEMO_ACCOUNTS, ROLE_LABEL, useAuth } from '../state/AuthContext.jsx';
import { useLiveFeed } from '../lib/hooks.js';
import { Button, useToast } from './ui.jsx';
import { initials } from '../lib/format.js';

/* ------------------------------------------------------------------ nav -- */
const NAV = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'City Overview', icon: LayoutDashboard, cap: 'analytics:read', end: true },
      { to: '/map', label: 'Map Operations', icon: MapPin, cap: 'map:read' },
      { to: '/triage', label: 'Triage Queue', icon: ClipboardCheck, cap: 'hotspots:read', badgeKey: 'critical' },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { to: '/work-orders', label: 'Work Orders', icon: FileText, cap: 'workorders:read' },
      { to: '/monsoon', label: 'Monsoon Watch', icon: CloudRain, cap: 'monsoon:read', badgeKey: 'monsoon' },
    ],
  },
  {
    label: 'Network',
    items: [
      { to: '/network', label: 'Corridor Health', icon: Route, cap: 'map:read' },
      { to: '/fleet', label: 'Fleet & Ingestion', icon: Truck, cap: 'fleet:read' },
    ],
  },
  {
    label: 'Administration',
    items: [{ to: '/governance', label: 'Governance', icon: ShieldAlert, cap: 'audit:read' }],
  },
];

const TITLES = {
  '/': { eyebrow: 'Coimbatore Municipal Corporation', title: 'City Overview' },
  '/map': { eyebrow: 'Geospatial', title: 'Map Operations' },
  '/triage': { eyebrow: 'Verification', title: 'Triage Queue' },
  '/work-orders': { eyebrow: 'Dispatch', title: 'Work Orders' },
  '/monsoon': { eyebrow: 'Predictive maintenance', title: 'Monsoon Watch' },
  '/network': { eyebrow: 'Asset condition', title: 'Corridor Health' },
  '/fleet': { eyebrow: 'Passive ingestion', title: 'Fleet & Ingestion' },
  '/governance': { eyebrow: 'Accountability', title: 'Governance' },
};

/* --------------------------------------------------------------- sidebar -- */
function Sidebar({ open, onClose, metrics }) {
  const { can, user } = useAuth();

  const counts = useMemo(
    () => ({ critical: metrics?.criticalHotspots ?? null, monsoon: metrics?.monsoonHazards ?? null }),
    [metrics]
  );

  return (
    <aside className={`sidebar ${open ? 'is-open' : ''}`}>
      <div className="brand">
        <div className="brand__mark">
          <Activity size={18} strokeWidth={2.4} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="brand__name">RoadPulse</div>
          <div className="brand__sub">Coimbatore · CMC</div>
        </div>
        <button
          className="btn btn--ghost btn--sm"
          style={{ marginLeft: 'auto', display: open ? 'inline-flex' : 'none' }}
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      <nav className="nav">
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(i.cap));
          if (!items.length) return null;
          return (
            <div className="nav__group" key={group.label}>
              <div className="nav__label">{group.label}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onClose}
                  className={({ isActive }) => `nav__item ${isActive ? 'is-active' : ''}`}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                  {item.badgeKey && counts[item.badgeKey] > 0 && (
                    <span className="nav__count">{counts[item.badgeKey]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__foot">
        <div className="sidebar__stat">
          <span>Corridors</span>
          <b>{metrics?.segments ?? '—'}</b>
        </div>
        <div className="sidebar__stat">
          <span>Avg city PCI</span>
          <b>{metrics ? `${metrics.avgPci}/100` : '—'}</b>
        </div>
        <div className="sidebar__stat">
          <span>Tracked defects</span>
          <b>{metrics?.hotspots ?? '—'}</b>
        </div>
        <div className="sidebar__stat" style={{ marginTop: 2 }}>
          <span>Signed in</span>
          <b style={{ fontFamily: 'var(--font-body)' }}>{user?.name?.split(' ')[0] || '—'}</b>
        </div>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- topbar -- */
function Topbar({ onMenu, metrics, live }) {
  const { user, switchRole } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState('');
  const wrapRef = useRef(null);

  const meta = TITLES[location.pathname] || { eyebrow: 'RoadPulse', title: 'Console' };

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const changeRole = async (role) => {
    if (role === user?.role || switching) return;
    setSwitching(role);
    try {
      await switchRole(role);
      toast.success(`Switched to ${ROLE_LABEL[role]} — permissions updated.`);
    } catch (err) {
      toast.error(`Could not switch role: ${err.message}`);
    } finally {
      setSwitching('');
    }
  };

  return (
    <header className="topbar">
      <Button variant="ghost" size="sm" onClick={onMenu} className="no-print" aria-label="Open navigation" style={{ display: 'none' }} data-mobile-only>
        <Menu size={18} />
      </Button>

      <div className="topbar__title">
        <div className="crumbs">
          RoadPulse <span>/</span> <b>{meta.eyebrow}</b>
        </div>
        <h1>{meta.title}</h1>
      </div>

      <div className="topbar__spacer" />

      <span className={`live ${live.connected ? 'is-live' : 'is-off'}`} title={live.connected ? 'Streaming fleet telemetry' : 'Stream idle'}>
        <span className="live__dot" />
        {live.connected ? 'Live' : 'Idle'}
      </span>

      <div className="seg no-print" role="group" aria-label="Active role">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.role}
            className={user?.role === a.role ? 'is-on' : ''}
            onClick={() => changeRole(a.role)}
            disabled={!!switching}
            title={a.scope}
          >
            {switching === a.role ? '…' : ROLE_LABEL[a.role].replace('Municipal ', '').replace('Field ', '').replace('Fleet ', '')}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative' }} ref={wrapRef}>
        <button className="userchip no-print" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
          <span className="userchip__av">{initials(user?.name)}</span>
          <span className="userchip__meta">
            <span className="userchip__name">{user?.name || 'Signed in'}</span>
            <span className="userchip__role">{user?.role || ''}</span>
          </span>
          <ChevronDown size={14} style={{ color: 'var(--faint)' }} />
        </button>

        {menuOpen && (
          <div className="menu">
            <div className="menu__head">
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{user?.email}</div>
              <div className="pill-row" style={{ marginTop: 7 }}>
                <span className="badge badge--brand">
                  <span className="badge__dot" />
                  {ROLE_LABEL[user?.role] || 'unknown'}
                </span>
              </div>
            </div>
            <div style={{ padding: '2px 10px 8px' }}>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Network status</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                <span>{metrics?.segments ?? '—'} corridors monitored</span>
                <span>{metrics?.hotspots ?? '—'} tracked defects</span>
                <span>{metrics?.detections24h ?? '—'} observations in 24 h</span>
              </div>
            </div>
            <LogoutItem />
          </div>
        )}
      </div>
    </header>
  );
}

function LogoutItem() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      className="menu__item is-danger"
      onClick={() => {
        logout();
        navigate('/login', { replace: true });
      }}
    >
      <LogOut size={15} />
      Sign out
    </button>
  );
}

/* ----------------------------------------------------------------- shell -- */
export default function AppShell({ children, metrics }) {
  const [navOpen, setNavOpen] = useState(false);
  const live = useLiveFeed({ limit: 1, enabled: true });

  useEffect(() => {
    // Reveal the hamburger only on small screens.
    const mq = window.matchMedia('(max-width: 980px)');
    const apply = () => {
      document.querySelectorAll('[data-mobile-only]').forEach((el) => {
        el.style.display = mq.matches ? 'inline-flex' : 'none';
      });
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <div className="app">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} metrics={metrics} />
      <div className="main">
        <Topbar onMenu={() => setNavOpen((v) => !v)} metrics={metrics} live={live} />
        <main className="content rise">{children}</main>
        <footer
          className="no-print"
          style={{
            padding: '14px 22px 26px',
            fontSize: 11.5,
            color: 'var(--faint)',
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <span className="mono">RoadPulse Coimbatore v3.0</span>
          <span>·</span>
          <span>Passive fleet ingestion · DBSCAN chronic-defect detection · IRC:82 PCI</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Radio size={12} />
            {live.connected ? 'Telemetry stream connected' : 'Telemetry stream idle'}
          </span>
          <BarChart3 size={12} />
        </footer>
      </div>
    </div>
  );
}
