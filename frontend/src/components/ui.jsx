import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react';

/* ======================================================================== *
 * Toasts
 * ======================================================================== */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message, tone = 'ok', ttl = 4200) => {
      const id = Math.random().toString(36).slice(2);
      setItems((prev) => [...prev, { id, message, tone }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      toast: push,
      success: (m) => push(m, 'ok'),
      error: (m) => push(m, 'err', 6000),
      info: (m) => push(m, 'info'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts no-print">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'err' ? 'toast--err' : ''}`} role="status">
            {t.tone === 'ok' && <CheckCircle2 size={16} />}
            {t.tone === 'err' && <AlertCircle size={16} />}
            {t.tone === 'info' && <Info size={16} />}
            <span>{t.message}</span>
            <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext) || { toast() {}, success() {}, error() {}, info() {} };

/* ======================================================================== *
 * Layout primitives
 * ======================================================================== */
export function Card({ title, eyebrow, actions, children, flush, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card__head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h3>{title}</h3>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={`card__body ${flush ? 'card__body--flush' : ''}`}>{children}</div>
    </section>
  );
}

export function PageHead({ title, eyebrow, subtitle, children }) {
  return (
    <div className="page-head">
      <div className="page-head__text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: '72ch' }}>{subtitle}</p>}
      </div>
      {children && <div className="page-head__actions">{children}</div>}
    </div>
  );
}

/* ======================================================================== *
 * Stat card
 * ======================================================================== */
export function Stat({ label, value, unit, foot, icon: Icon, accent = 'var(--brand)', delta, deltaTone }) {
  const tone = deltaTone || (Number(delta) > 0 ? 'up' : Number(delta) < 0 ? 'down' : 'flat');
  return (
    <div className="stat" style={{ '--stat-accent': accent }}>
      <div className="stat__top">
        <span className="stat__label">{label}</span>
        {Icon && <span className="stat__icon"><Icon size={15} /></span>}
      </div>
      <div className="stat__value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {(foot || delta != null) && (
        <div className="stat__foot">
          {delta != null && (
            <span className={`delta delta--${tone}`}>
              {tone === 'up' ? '▲' : tone === 'down' ? '▼' : '—'} {Math.abs(Number(delta))}
            </span>
          )}
          {foot && <span>{foot}</span>}
        </div>
      )}
    </div>
  );
}

/* ======================================================================== *
 * Badges, chips, meters
 * ======================================================================== */
const TONE_CLASS = {
  critical: 'badge--critical',
  high: 'badge--high',
  medium: 'badge--medium',
  low: 'badge--low',
  chronic: 'badge--chronic',
  monsoon: 'badge--monsoon',
  brand: 'badge--brand',
  neutral: 'badge--neutral',
  live: 'badge--live',
};

export function Badge({ tone = 'neutral', children, dot = true, title }) {
  return (
    <span className={`badge ${TONE_CLASS[tone] || TONE_CLASS.neutral}`} title={title}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

export const GradeBadge = ({ grade }) => (
  <Badge tone={String(grade || '').toLowerCase()}>{grade}</Badge>
);

export function Chip({ active, onClick, children, count }) {
  return (
    <button type="button" className={`chip ${active ? 'is-on' : ''}`} onClick={onClick}>
      {children}
      {count != null && <span className="chip__n">{count}</span>}
    </button>
  );
}

export function Meter({ value, max = 100, color = 'var(--brand)', height }) {
  const width = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <div className="meter" style={height ? { height } : undefined}>
      <div className="meter__fill" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

export function Banner({ tone = 'info', icon: Icon, children, actions }) {
  return (
    <div className={`banner banner--${tone}`}>
      {Icon && <Icon size={16} style={{ flex: '0 0 auto' }} />}
      <div style={{ flex: 1 }}>{children}</div>
      {actions}
    </div>
  );
}

/* ======================================================================== *
 * Buttons + fields
 * ======================================================================== */
export function Button({ variant = 'default', size, icon: Icon, children, block, ...rest }) {
  const cls = ['btn'];
  if (variant !== 'default') cls.push(`btn--${variant}`);
  if (size === 'sm') cls.push('btn--sm');
  if (block) cls.push('btn--block');
  return (
    <button className={cls.join(' ')} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 15} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--faint)' }}>{hint}</span>}
    </div>
  );
}

/* ======================================================================== *
 * Table
 * ======================================================================== */
export function Table({ columns, rows, empty, onRowClick, rowKey }) {
  if (!rows?.length) return empty || <Empty title="Nothing to show" hint="No records match the current filters." />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row) : row.id ?? i}
              className={onRowClick ? 'rowlink' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.header || ''}
                  className={[c.align === 'right' ? 'num' : '', c.header ? '' : 'td-actions'].filter(Boolean).join(' ') || undefined}
                >
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ======================================================================== *
 * Empty / loading states
 * ======================================================================== */
export function Empty({ icon: Icon = Info, title, hint, action }) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.5} />
      <b>{title}</b>
      {hint && <span style={{ fontSize: 12.5, maxWidth: '38ch' }}>{hint}</span>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 14, w = '100%', style }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export function SkeletonRows({ rows = 5 }) {
  return (
    <div style={{ display: 'grid', gap: 10, padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} h={16} w={`${100 - i * 7}%`} />
      ))}
    </div>
  );
}

/* ======================================================================== *
 * Drawer
 * ======================================================================== */
export function Drawer({ open, onClose, title, eyebrow, actions, children, footer }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-scrim no-print" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer__head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 style={{ fontSize: 17 }}>{title}</h2>
          </div>
          <div className="drawer__tools">
            {actions}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
              <X size={16} />
            </Button>
          </div>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__foot">{footer}</footer>}
      </aside>
    </>
  );
}

/* ======================================================================== *
 * Key/value list
 * ======================================================================== */
export function KV({ items }) {
  return (
    <div className="kv">
      {items.filter(Boolean).map((it, i) => (
        <div className="kv__row" key={i}>
          <span className="kv__k">{it.k}</span>
          <span className="kv__v">{it.v}</span>
        </div>
      ))}
    </div>
  );
}
