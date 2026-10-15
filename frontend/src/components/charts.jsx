import React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CLASS_COLOR, CLASS_LABEL, GRADE_COLOR, PCI_COLOR, dayShort } from '../lib/format.js';

const axis = {
  stroke: 'var(--border-strong)',
  tick: { fill: 'var(--muted)', fontSize: 10.5, fontFamily: 'IBM Plex Mono' },
};

const tooltipStyle = {
  contentStyle: {
    background: '#fff',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 12,
    boxShadow: '0 4px 16px -6px rgba(23,24,26,.18)',
    fontFamily: 'IBM Plex Sans',
  },
  labelStyle: { fontFamily: 'IBM Plex Mono', fontSize: 10.5, color: 'var(--muted)', marginBottom: 4 },
  itemStyle: { padding: 0 },
};

/* ---------------------------------------------- detection trend by class -- */
export function TrendChart({ series = [], height = 210 }) {
  const data = series.map((d) => ({ ...d, label: dayShort(d.day) }));
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
          <defs>
            {Object.entries(CLASS_COLOR).map(([k, color]) => (
              <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={26} />
          <YAxis {...axis} width={38} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="pothole" name="Pothole" stackId="1" stroke={CLASS_COLOR.pothole} fill="url(#grad-pothole)" strokeWidth={1.8} />
          <Area type="monotone" dataKey="alligator_crack" name="Alligator crack" stackId="1" stroke={CLASS_COLOR.alligator_crack} fill="url(#grad-alligator_crack)" strokeWidth={1.8} />
          <Area type="monotone" dataKey="longitudinal_crack" name="Longitudinal crack" stackId="1" stroke={CLASS_COLOR.longitudinal_crack} fill="url(#grad-longitudinal_crack)" strokeWidth={1.8} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="legend" style={{ marginTop: 8 }}>
        {Object.entries(CLASS_LABEL).map(([k, label]) => (
          <span className="legend__item" key={k}>
            <span className="legend__swatch" style={{ background: CLASS_COLOR[k] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- PCI trend line -- */
export function PciTrendChart({ segments = [], height = 220 }) {
  // Merge per-corridor history into a single date-indexed series.
  const dates = [...new Set(segments.flatMap((s) => s.points?.map((p) => p.date) || []))].sort();
  const data = dates.map((date) => {
    const row = { date, label: dayShort(date) };
    for (const s of segments) {
      const point = s.points?.find((p) => p.date === date);
      if (point) row[s.segment_id] = point.pci;
    }
    return row;
  });

  const palette = ['#123a5e', '#e8590c', '#2f9e44', '#6741d9', '#0c7bb3', '#b8860b', '#c92a2a', '#5f6b7a'];

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" {...axis} minTickGap={24} />
          <YAxis {...axis} width={38} domain={[0, 100]} />
          <Tooltip {...tooltipStyle} />
          <ReferenceLine y={80} stroke="var(--good)" strokeDasharray="4 4" strokeWidth={1} />
          <ReferenceLine y={50} stroke="var(--poor)" strokeDasharray="4 4" strokeWidth={1} />
          {segments.slice(0, 8).map((s, i) => (
            <Line
              key={s.segment_id}
              type="monotone"
              dataKey={s.segment_id}
              name={s.street_name}
              stroke={palette[i % palette.length]}
              strokeWidth={1.9}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="legend" style={{ marginTop: 8 }}>
        {segments.slice(0, 8).map((s, i) => (
          <span className="legend__item" key={s.segment_id}>
            <span className="legend__swatch" style={{ background: palette[i % palette.length] }} />
            {s.street_name.replace(/\s*\(.*\)$/, '')}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- grade distribution */
export function GradeDonut({ distribution = [], height = 190 }) {
  const data = distribution.filter((d) => d.count > 0).map((d) => ({ name: d.grade, value: d.count, fill: GRADE_COLOR[d.grade] }));
  if (!data.length) return <div className="empty"><b>No hotspots</b></div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Pie>
        <Tooltip {...tooltipStyle} />
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          formatter={(v) => <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{v}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ----------------------------------------------------------- zone health -- */
export function ZoneBars({ zones = [], height = 200 }) {
  const data = zones.map((z) => ({ ...z, label: z.zone_name.replace(' Zone', '') }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" {...axis} />
        <YAxis {...axis} width={38} domain={[0, 100]} />
        <Tooltip {...tooltipStyle} />
        <ReferenceLine y={80} stroke="var(--good)" strokeDasharray="4 4" />
        <ReferenceLine y={50} stroke="var(--poor)" strokeDasharray="4 4" />
        <Bar dataKey="avgPci" name="Avg PCI" radius={[4, 4, 0, 0]} maxBarSize={46}>
          {data.map((z) => (
            <Cell key={z.zone_name} fill={PCI_COLOR(z.avgPci)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* -------------------------------------------------------------- rainfall -- */
export function RainChart({ days = [], threshold = 25, height = 190 }) {
  const data = days.slice(0, 7).map((d) => ({ ...d, label: dayShort(d.date) }));
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={38} />
          <Tooltip {...tooltipStyle} formatter={(v) => [`${v} mm`, 'Rainfall']} />
          <ReferenceLine y={threshold} stroke="var(--critical)" strokeDasharray="4 4" label={{ value: `${threshold} mm`, position: 'right', fill: 'var(--critical)', fontSize: 10 }} />
          <Bar dataKey="rainMm" name="Rainfall" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.rainMm >= threshold ? 'var(--critical)' : 'var(--monsoon)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------- class mix (1 bar) -- */
export function ClassMixBar({ mix = [] }) {
  const total = mix.reduce((a, m) => a + m.count, 0) || 1;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 20, overflow: 'hidden', background: 'var(--paper-2)' }}>
        {mix.map((m) => (
          <div
            key={m.damage_class}
            title={`${CLASS_LABEL[m.damage_class]}: ${m.count} (${m.sharePct}%)`}
            style={{ width: `${(m.count / total) * 100}%`, background: CLASS_COLOR[m.damage_class] }}
          />
        ))}
      </div>
      {mix.map((m) => (
        <div key={m.damage_class} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span className="legend__swatch" style={{ background: CLASS_COLOR[m.damage_class] }} />
          <span style={{ color: 'var(--ink-2)' }}>{CLASS_LABEL[m.damage_class]}</span>
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
            {m.count} · {m.sharePct}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------- PCI by corridor (bars) -- */
export function PciBars({ segments = [] }) {
  const data = [...segments].sort((a, b) => a.current_pci - b.current_pci).slice(0, 8);
  return (
    <div className="bars">
      {data.map((s) => (
        <div className="bars__col" key={s.segment_id} title={`${s.street_name} — PCI ${s.current_pci}`}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{s.current_pci}</span>
          <div className="bars__bar" style={{ height: `${Math.max(4, s.current_pci)}%`, background: PCI_COLOR(s.current_pci) }} />
          <span className="bars__label">{s.street_name.replace(/\s*\(.*\)$/, '').slice(0, 12)}</span>
        </div>
      ))}
    </div>
  );
}
