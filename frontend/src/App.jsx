import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import { usePoll } from './lib/hooks.js';
import { dataApi } from './lib/api.js';
import Login from './pages/Login.jsx';
import PublicReport from './pages/PublicReport.jsx';
import Overview from './pages/Overview.jsx';
import Report from './pages/Report.jsx';
import MyReports from './pages/MyReports.jsx';
import Reports from './pages/Reports.jsx';
import MapOps from './pages/MapOps.jsx';
import Triage from './pages/Triage.jsx';
import WorkOrders from './pages/WorkOrders.jsx';
import Monsoon from './pages/Monsoon.jsx';
import Network from './pages/Network.jsx';
import Fleet from './pages/Fleet.jsx';
import Governance from './pages/Governance.jsx';
import { SkeletonRows } from './components/ui.jsx';

function Booting() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 'min(320px, calc(100% - 32px))', display: 'grid', gap: 12 }}>
        <div className="eyebrow" style={{ textAlign: 'center' }}>RoadPulse · establishing session</div>
        <SkeletonRows rows={3} />
      </div>
    </div>
  );
}

/** Blocks a route when the signed-in role lacks the capability. */
function Guard({ capability, children }) {
  const { can } = useAuth();
  const location = useLocation();
  if (!can(capability)) {
    return (
      <div className="card">
        <div className="card__body">
          <div className="empty">
            <b>Not available for your role</b>
            <span>
              This workspace needs the <code className="mono">{capability}</code> permission. Sign out and sign
              in with an account that has it.
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{location.pathname}</span>
          </div>
        </div>
      </div>
    );
  }
  return children;
}

/** Blocks a route unless the signed-in role is one of `roles`. */
function RoleGuard({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) {
    return (
      <div className="card">
        <div className="card__body">
          <div className="empty">
            <b>Not available for your role</b>
            <span>This workspace belongs to the {roles.join(' / ')} role.</span>
          </div>
        </div>
      </div>
    );
  }
  return children;
}

/**
 * Each role lands on its own dashboard — there is no cross-role switching:
 * a citizen reports, a field officer works the queue, an executive monitors.
 */
export function homeFor(role) {
  if (role === 'inspector') return '/reports';
  if (role === 'driver') return '/report';
  return '/overview';
}

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user?.role)} replace />;
}

export default function App() {
  const { status, user } = useAuth();

  // Shared KPI poll — feeds the sidebar counters and the top bar menu.
  const { data: metrics } = usePoll(
    () => (status === 'ready' ? dataApi.metrics() : Promise.resolve(null)),
    20000,
    [status]
  );

  if (status === 'loading') return <Booting />;

  // Anonymous visitors can still file a report and track one — no login needed.
  if (status === 'anon' || !user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/report" element={<PublicReport />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppShell metrics={metrics}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/overview"
          element={
            <Guard capability="analytics:read">
              <Overview />
            </Guard>
          }
        />
        <Route
          path="/report"
          element={
            <Guard capability="detections:ingest">
              <Report />
            </Guard>
          }
        />
        <Route
          path="/my-reports"
          element={
            <RoleGuard roles={['driver']}>
              <MyReports />
            </RoleGuard>
          }
        />
        <Route
          path="/reports"
          element={
            <Guard capability="detections:review">
              <Reports />
            </Guard>
          }
        />
        <Route
          path="/map"
          element={
            <Guard capability="map:read">
              <MapOps />
            </Guard>
          }
        />
        <Route
          path="/triage"
          element={
            <Guard capability="hotspots:read">
              <Triage />
            </Guard>
          }
        />
        <Route
          path="/work-orders"
          element={
            <Guard capability="workorders:read">
              <WorkOrders />
            </Guard>
          }
        />
        <Route
          path="/monsoon"
          element={
            <Guard capability="monsoon:read">
              <Monsoon />
            </Guard>
          }
        />
        <Route
          path="/network"
          element={
            <Guard capability="map:read">
              <Network />
            </Guard>
          }
        />
        <Route
          path="/fleet"
          element={
            <Guard capability="fleet:read">
              <Fleet />
            </Guard>
          }
        />
        <Route
          path="/governance"
          element={
            <Guard capability="audit:read">
              <Governance />
            </Guard>
          }
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
    </AppShell>
  );
}
