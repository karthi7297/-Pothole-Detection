import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MOCK, pciColor } from './lib/data.js';
import { api } from './lib/api.js';
import MapView from './components/MapView.jsx';

const ROLES = [['executive', 'Municipal Executive'], ['inspector', 'Field Inspector'], ['driver', 'Fleet Driver']];

export default function App() {
  const [role, setRole] = useState('executive');
  const [tab, setTab] = useState('triage');
  const [metrics, setMetrics] = useState(MOCK.metrics);
  const [segments, setSegments] = useState(MOCK.segments);
  const [spots, setSpots] = useState(MOCK.hotspots);
  const [weather, setWeather] = useState(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [wo, setWo] = useState('');
  const [woId, setWoId] = useState(null);
  const [feed, setFeed] = useState([]);
  const mapHandle = useRef(null);
  const onSelect = useCallback((h) => setSel(h), []);

  // instant mock -> upgrade to live API (never blank, never crash)
  useEffect(() => {
    api('/api/metrics').then(setMetrics).catch(() => {});
    api('/api/segments').then(d => d.length && setSegments(d)).catch(() => {});
    api('/api/hotspots').then(d => d.length && setSpots(d)).catch(() => {});
    api('/api/weather?lat=11.0168&lon=76.9558').then(setWeather).catch(() => setWeather({ source: 'mock-fallback', days: [] }));
  }, []);

  // live fleet simulation (demo-safe interval)
  useEffect(() => {
    const msgs = ['TNSTC_BUS_CB_104: pothole 0.91 @ Avinashi Rd', 'CMC_TRUCK_07: alligator_crack 0.84 @ DB Rd', 'TNSTC_BUS_CB_212: longitudinal 0.72 @ Trichy Rd', 'TNSTC_BUS_CB_104: pothole 0.88 @ Mettupalayam Rd'];
    let i = 0;
    const t = setInterval(() => { setFeed(f => [`${new Date().toLocaleTimeString()} — ${msgs[i++ % msgs.length]}`, ...f].slice(0, 8)); }, 2500);
    return () => clearInterval(t);
  }, []);

  const list = useMemo(() => {
    let r = [...spots].sort((a, b) => b.priority_score - a.priority_score);
    if (q) r = r.filter(h => h.street_name.toLowerCase().includes(q.toLowerCase()));
    return r;
  }, [spots, q]);

  const genWO = async (id) => {
    const hid = id || list[0]?.hotspot_id; if (!hid) return;
    setWo('Generating…');
    try {
      const r = await api('/api/work-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hotspot_id: hid, ward: 'CMC Ward 32 Office' }) });
      setWo(r.summary_text); setWoId(r.work_order_id);
    } catch {
      const h = spots.find(s => s.hotspot_id === hid);
      setWo(`CMC DISPATCH (offline)\n${h.street_name} — Score ${h.priority_score}\nAction: ${h.is_chronic ? 'FULL SUB-BASE RECONSTRUCTION' : 'COLD-MIX PATCH'}\nBudget: Rs.${h.estimated_reconstruct_cost_inr || h.estimated_patch_cost_inr}`);
    }
  };
  const dispatch = async (h) => {
    try { await api(`/api/hotspots/${h.hotspot_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Dispatched' }) }); } catch {}
    setSpots(s => s.map(x => x.hotspot_id === h.hotspot_id ? { ...x, status: 'Dispatched' } : x));
  };

  return (
    <>
      <div className="top">
        <div className="brand">◉ ROADPULSE<em>COIMBATORE · DIGITAL TWIN v2.0</em></div>
        <div className="roles"><span className="hint">ROLE:</span>{ROLES.map(([k, l]) => <button key={k} className={role === k ? 'on' : ''} onClick={() => setRole(k)}>{l}</button>)}</div>
        <div className="live"><i />LIVE</div>
      </div>

      <div className="kpis">
        <div className="kpi"><small>Avg City PCI</small><b>{metrics.avgPci}/100</b><span>Fair / Degrading</span></div>
        <div className="kpi"><small>Active Potholes</small><b style={{ color: '#FF3B30' }}>{metrics.activePotholes}</b><span>{metrics.critical} critical</span></div>
        <div className="kpi"><small>Monsoon Hazards</small><b style={{ color: '#FF9500' }}>{metrics.monsoonHazards}</b><span>rain ≥ 25mm/day · {weather ? weather.source : '…'}</span></div>
        <div className="kpi"><small>Est. Savings</small><b style={{ color: '#34C759' }}>₹{metrics.roiLakhs}L</b><span>₹3.8L / ward / yr</span></div>
        <div className="kpi"><small>PCI by Corridor</small><div className="bars">{segments.map(s => <div key={s.segment_id} className="bar" style={{ height: s.current_pci, background: pciColor(s.current_pci) }} title={`${s.street_name}: ${s.current_pci}`}>{s.current_pci}</div>)}</div></div>
      </div>

      <div className="grid">
        <div className="panel">
          <b>INTERACTIVE GIS MAP</b> <span className="hint">● &gt;80 Good ● 50–80 Fair ● &lt;50 Poor · click a pin for detail</span>
          <MapView segments={segments} spots={spots} onSelect={onSelect} mapHandle={mapHandle} />
          {role === 'driver' && <div className="card" style={{ marginTop: 8 }}><h4>TNSTC_BUS_CB_104 — Dashcam AI (simulated)</h4><div className="feed">{feed.map((f, i) => <div key={i}>{f}</div>)}</div></div>}
          {sel && <div className="card"><span className={`b ${sel.grade}`}>{sel.grade}</span> {sel.is_chronic && <span className="b PU">CHRONIC</span>} {sel.monsoon_inundation_risk && <span className="b AM">MONSOON RISK</span>}<h4>{sel.street_name}</h4><p>Score {sel.priority_score} · {sel.detection_count} reports · Status {sel.status}</p><div className="row"><button className="act p" onClick={() => dispatch(sel)}>Approve & Dispatch</button><button className="act" onClick={() => genWO(sel.hotspot_id)}>Work Order</button></div></div>}
        </div>

        <div className="panel">
          <div className="tabs">{[['triage', 'Triage Queue'], ['work', 'AI Work Order'], ['monsoon', 'Monsoon'], ['verify', 'Verify']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

          {tab === 'triage' && <>
            <div className="search"><input placeholder="Search Avinashi, DB Road, Mettupalayam…" value={q} onChange={e => setQ(e.target.value)} /></div>
            {list.map(h => <div key={h.hotspot_id} className="card"><span className={`b ${h.grade}`}>{h.grade}</span> {h.is_chronic && <span className="b PU">CHRONIC</span>} {h.monsoon_inundation_risk && <span className="b AM">MONSOON</span>}<h4>{h.street_name}</h4><p>Score {h.priority_score} · {h.detection_count} reports · {h.status}</p><div className="row"><button className="act" onClick={() => { setSel(h); mapHandle.current?.setView([h.center_lat, h.center_lon], 15); }}>Locate</button><button className="act p" onClick={() => dispatch(h)}>Approve</button><button className="act" onClick={() => { setTab('work'); genWO(h.hotspot_id); }}>Work Order</button></div></div>)}
          </>}

          {tab === 'work' && <>
            <label>Ward office</label><select><option>CMC Ward 32 Office (East)</option><option>CMC Ward 12 Office (Central)</option><option>CMC Ward 45 Office (North)</option><option>CMC Ward 28 Office (South)</option></select>
            <button className="act p" style={{ width: '100%', padding: 10 }} onClick={() => genWO()}>Generate AI Work Order {woId ? `#${woId}` : ''}</button>
            <pre className="wo">{wo || 'Pick “Work Order” on any hotspot — offline municipal template, OpenRouter Nemotron live if OPENROUTER_KEY is set on server.'}</pre>
            <button className="act" style={{ width: '100%' }} onClick={() => window.print()}>Print / Export PDF</button>
          </>}

          {tab === 'monsoon' && <>
            {(weather?.days || []).slice(0, 5).map((d, i) => <div key={i} className="card"><h4>{d.date} — {d.rainMm} mm rain</h4><p>{d.rainMm >= 25 ? '⚠ AMBER HAZARD: seal alligator cracks on Avinashi + Mettupalayam within 48h.' : 'Normal — routine patrol.'}</p></div>)}
            {spots.filter(s => s.monsoon_inundation_risk).map(h => <div key={h.hotspot_id} className="card"><span className="b AM">FLASHING AMBER</span><h4>{h.street_name}</h4><p>Alligator crack + forecast &gt;25mm/day → sub-base erosion risk.</p></div>)}
          </>}

          {tab === 'verify' && <>
            <p className="hint">{role === 'inspector' ? 'Inspector: Approve / Reject detections.' : 'Executive: override + dispatch.'}</p>
            {spots.map(h => <div key={h.hotspot_id} className="card"><h4>{h.street_name}</h4><p>Status: <b>{h.status}</b></p><div className="row"><button className="act p" onClick={() => dispatch(h)}>Approve</button><button className="act" onClick={() => setSpots(s => s.map(x => x.hotspot_id === h.hotspot_id ? { ...x, status: 'Rejected' } : x))}>Reject</button></div></div>)}
          </>}
        </div>
      </div>
    </>
  );
}
