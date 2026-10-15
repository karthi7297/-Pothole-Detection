/* Formatting + domain vocabulary shared across the app. */

export const inr = (n, { compact = false } = {}) => {
  const v = Number(n) || 0;
  if (compact) {
    if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
    if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
    if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  }
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

export const num = (n, dp = 0) => (Number(n) || 0).toLocaleString('en-IN', {
  minimumFractionDigits: dp,
  maximumFractionDigits: dp,
});

export const pct = (n) => `${Number(n) > 0 ? '+' : ''}${Math.round(Number(n) || 0)}%`;

export const CLASS_LABEL = {
  pothole: 'Pothole',
  alligator_crack: 'Alligator crack',
  longitudinal_crack: 'Longitudinal crack',
};

export const CLASS_COLOR = {
  pothole: 'var(--critical)',
  alligator_crack: 'var(--high)',
  longitudinal_crack: 'var(--medium)',
};

export const GRADE_COLOR = {
  CRITICAL: 'var(--critical)',
  HIGH: 'var(--high)',
  MEDIUM: 'var(--medium)',
  LOW: 'var(--low)',
};

export const PCI_COLOR = (pci) => (pci >= 80 ? 'var(--good)' : pci >= 50 ? 'var(--fair)' : 'var(--poor)');

export const pciBand = (pci) => (pci >= 80 ? 'GOOD' : pci >= 50 ? 'FAIR' : 'POOR');

export const STATUS_TONE = {
  Active: 'neutral',
  Pending: 'medium',
  Verified: 'brand',
  Dispatched: 'high',
  Rejected: 'critical',
  Repaired: 'low',
  Issued: 'high',
  Draft: 'neutral',
};

export const STATUS_LABEL = {
  Active: 'Active',
  Pending: 'Pending',
  Verified: 'Verified',
  Dispatched: 'Dispatched',
  Rejected: 'Rejected',
  Repaired: 'Repaired',
  Issued: 'Issued',
  Draft: 'Draft',
};

/** "14:32:08" from an ISO or SQLite timestamp. */
export const clockOf = (ts) => {
  if (!ts) return '--:--:--';
  const s = String(ts);
  return s.includes('T') ? s.slice(11, 19) : s.slice(11, 19) || s.slice(0, 8);
};

/** "15 Oct" */
export const dayShort = (ts) => {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(ts).slice(5, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

/** "15 Oct 2026, 14:32" */
export const dateTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const relTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.round(secs / 86400)}d ago`;
  return dayShort(ts);
};

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'RP';

export const coords = (lat, lon) => `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
