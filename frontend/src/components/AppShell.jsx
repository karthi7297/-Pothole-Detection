import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, Camera, ChevronDown, ClipboardCheck, CloudRain, FileText, Inbox, LayoutDashboard,
  LogOut, MapPin, Menu, Radio, Route, ShieldAlert, Truck, X,
} from 'lucide-react';
import { ROLE_LABEL, useAuth } from '../state/AuthContext.jsx';
import { useLiveFeed } from '../lib/hooks.js';
import { Button } from './ui.jsx';
import { initials } from '../lib/format.js';

/* ------------------------------------------------------------------ nav -- *
 * Each role gets its OWN menu — not one shared menu filtered by permission.
 * The flow: a citizen reports → the field officer works the report to the end
 * → the executive monitors the city. Roles therefore see different tools.
 */
const ROLE_NAV = {
  // Citizen / driver: report damage, follow your own reports.
  driver: [
    {
      label: 'Citizen',
      items: [
        { to: '/report', label: 'Report Road Damage', icon: Camera },
        { to: '/my-reports', label: 'My Reports', icon: FileText },
      ],
    },
    {
      label: 'Explore',
      items: [{ to: '/map', label: 'Live Road Map', icon: MapPin }],
    },
  ],
  // Field inspector: the work queue, worked from report to repair.
  inspector: [
    {
      label: 'Work Queue',
      items: [
        { to: '/reports', label: 'Report Inbox', icon: Inbox, badgeKey: 'pending' },
        { to: '/triage', label: 'Triage Queue', icon: ClipboardCheck, badgeKey: 'critical' },
        { to: '/work-orders', label: 'Work Orders', icon: FileText, badgeKey: 'workorders' },
      ],
    },
    {
      label: 'Field',
      items: [
        { to: '/map', label: 'Map Operations', icon: MapPin },
        { to: '/monsoon', label: 'Monsoon Watch', icon: CloudRain, badgeKey: 'monsoon' },
        { to: '/fleet', label: 'Fleet & Ingestion', icon: Truck },
      ],
    },
  ],
  // Municipal executive: oversight only — no action buttons anywhere.
  executive: [
    {
      label: 'Oversight',
      items: [
        { to: '/overview', label: 'City Overview', icon: LayoutDashboard },
        { to: '/network', label: 'Corridor Health', icon: Route },
        { to: '/map', label: 'City Map', icon: MapPin },
        { to: '/monsoon', label: 'Monsoon Watch', icon: CloudRain, badgeKey: 'monsoon' },
        { to: '/fleet', label: 'Fleet & Ingestion', icon: Truck },
      ],
    },
    {
      label: 'Accountability',
      items: [
        { to: '/work-orders', label: 'Work Orders', icon: FileText },
        { to: '/governance', label: 'Governance & Audit', icon: ShieldAlert },
      ],
    },
  ],
};

const TITLES = {
  '/': { eyebrow: 'Coimbatore Municipal Corporation', title: 'Dashboard' },
  '/overview': { eyebrow: 'Oversight', title: 'City Overview' },
  '/report': { eyebrow: 'Field reporting', title: 'Report Road Damage' },
  '/my-reports': { eyebrow: 'Citizen tracking', title: 'My Reports' },
  '/reports': { eyebrow: 'Verification', title: 'Report Inbox' },
  '/map': { eyebrow: 'Geospatial', title: 'Map Operations' },
  '/triage': { eyebrow: 'Verification', title: 'Triage Queue' },
  '/work-orders': { eyebrow: 'Dispatch', title: 'Work Orders' },
  '/monsoon': { eyebrow: 'Predictive maintenance', title: 'Monsoon Watch' },
  '/network': { eyebrow: 'Asset condition', title: 'Corridor Health' },
  '/fleet': { eyebrow: 'Passive ingestion', title: 'Fleet & Ingestion' },
  '/governance': { eyebrow: 'Accountability', title: 'Governance & Audit' },
};

/* --------------------------------------------------------------- sidebar -- */
function Sidebar({ open, onClose, metrics }) {
  const { user } = useAuth();
  const groups = ROLE_NAV[user?.role] || [];

  const counts = useMemo(
    () => ({
      pending: metrics?.pendingReports ?? null,
      critical: metrics?.criticalHotspots ?? null,
      monsoon: metrics?.monsoonHazards ?? null,
      workorders: metrics?.dispatchedReports ?? null,
    }),
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
        {groups.map((group) => {
          const items = group.items;
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
  const { user } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  const meta = TITLES[location.pathname] || { eyebrow: 'RoadPulse', title: 'Console' };

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <header className="topbar">
      <Button variant="ghost" size="sm" onClick={onMenu} className="topbar__menu no-print" aria-label="Open navigation">
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
        <span className="live__label">{live.connected ? 'Live' : 'Idle'}</span>
      </span>

      <span className="badge badge--brand no-print topbar__role" title="Your signed-in role. Sign out to use a different role.">
        <span className="badge__dot" />
        {ROLE_LABEL[user?.role] || user?.role || 'signed in'}
      </span>

      <div style={{ position: 'relative' }} ref={wrapRef}>
        <button className="userchip no-print" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
          <span className="userchip__av">{initials(user?.name)}</span>
          <span className="userchip__meta">
            <span className="userchip__name">{user?.name || 'Signed in'}</span>
            <span className="userchip__role">{user?.role || ''}</span>
          </span>
          <ChevronDown className="userchip__chev" size={14} style={{ color: 'var(--faint)' }} />
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
  const location = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 981px)');
    const close = () => { if (mq.matches) setNavOpen(false); };
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, []);

  useEffect(() => {
    if (!navOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  return (
    <div className="app">
      {navOpen && (
        <button type="button" className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
      )}
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} metrics={metrics} />
      <div className="main">
        <Topbar onMenu={() => setNavOpen((v) => !v)} metrics={metrics} live={live} />
        <main className="content rise">{children}</main>
        <footer className="app-foot no-print">
          <span className="mono">RoadPulse Coimbatore v3.0</span>
          <span className="app-foot__detail">Passive fleet ingestion · DBSCAN chronic-defect detection · IRC:82 PCI</span>
          <span className="app-foot__live">
            <Radio size={12} />
            {live.connected ? 'Telemetry stream connected' : 'Telemetry stream idle'}
          </span>
        </footer>
      </div>
    </div>
  );
}
