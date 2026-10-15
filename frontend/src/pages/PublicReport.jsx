import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, LogIn, ShieldCheck } from 'lucide-react';
import Report from './Report.jsx';

/**
 * Public reporting shell — no login required.
 *
 * Any citizen can open this page, upload a photo/video with their location,
 * and get a report id to track. Municipal staff sign in for the full console.
 */
export default function PublicReport() {
  return (
    <div className="public">
      <header className="public__bar">
        <div className="public__brand">
          <div className="brand__mark">
            <Activity size={18} strokeWidth={2.4} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand__name" style={{ color: 'var(--ink)' }}>RoadPulse</div>
            <div className="brand__sub" style={{ color: 'var(--faint)' }}>Coimbatore · Citizen reporting</div>
          </div>
        </div>
        <Link className="btn btn--ghost btn--sm" to="/login">
          <LogIn size={14} /> Municipal staff sign in
        </Link>
      </header>

      <div className="public__notice">
        <ShieldCheck size={15} />
        <span>
          Reporting is open to everyone — <b>no sign-in needed</b>. Upload a photo or clip, confirm the location,
          and keep the report id to follow its progress.
        </span>
      </div>

      <main className="public__main">
        <Report />
      </main>
    </div>
  );
}
