import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, CheckCircle2, Crosshair, ImagePlus, Loader2, MapPin, RotateCcw, Search, ShieldCheck, Sparkles, UploadCloud,
} from 'lucide-react';
import { API_BASE, dataApi, getToken } from '../lib/api.js';
import { usePoll } from '../lib/hooks.js';
import { CLASS_LABEL, STATUS_LABEL, STATUS_TONE, dateTime, relTime } from '../lib/format.js';
import {
  Badge, Banner, Button, Card, Empty, PageHead, Table, useToast,
} from '../components/ui.jsx';
import { useAuth } from '../state/AuthContext.jsx';

const HOME = { lat: 11.0168, lon: 76.9558 }; // Coimbatore centre
const TRACK_STAGES = ['Pending', 'Verified', 'Dispatched', 'Repaired'];

export default function Report() {
  const toast = useToast();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const isLoggedIn = !!getToken();

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [damageClass, setDamageClass] = useState('auto');
  const [lat, setLat] = useState(String(HOME.lat));
  const [lon, setLon] = useState(String(HOME.lon));
  const [locationName, setLocationName] = useState('');
  const [nameSource, setNameSource] = useState('');
  const [resolving, setResolving] = useState(false);
  const [mode, setMode] = useState('manual');
  const [accuracy, setAccuracy] = useState(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // Once the reporter edits the name themselves, stop auto-filling it.
  const nameTouched = useRef(false);
  // Don't name the city-centre default — only look up coordinates the user chose.
  const coordsTouched = useRef(false);

  // A signed-in user sees their own recent reports; anonymous visitors don't.
  const { data: mine } = usePoll(
    () => (isLoggedIn ? dataApi.detections('?limit=12') : Promise.resolve(null)),
    20000,
    [isLoggedIn]
  );

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  /**
   * Resolve a human-readable place name for the current coordinates.
   *
   * A bare latitude/longitude is useless to a repair gang, so the form always
   * carries a name too. The lookup is debounced while typing and never
   * overwrites a name the reporter typed themselves.
   */
  const resolveName = async (la, lo) => {
    setResolving(true);
    try {
      const place = await dataApi.reverseGeocode(la, lo);
      if (!nameTouched.current && place?.name) {
        setLocationName(place.name);
        setNameSource(place.source === 'mapbox' ? 'auto-detected' : 'from road network');
      }
    } catch {
      /* offline or no key — the reporter can still type a name */
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (!coordsTouched.current) return undefined;
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return undefined;
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return undefined;
    const t = setTimeout(() => resolveName(la, lo), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  const fileMeta = useMemo(() => {
    if (!file) return null;
    const mb = (file.size / 1048576).toFixed(1);
    return `${file.type || 'file'} · ${mb} MB`;
  }, [file]);

  const pick = (f) => {
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) {
      toast.error('Please choose a photo or video file.');
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.error('File too large — 25 MB max.');
      return;
    }
    setFile(f);
    setResult(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  };

  const useGps = () => {
    if (!('geolocation' in navigator)) {
      toast.error('Geolocation is not available in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coordsTouched.current = true;
        nameTouched.current = false; // a fresh fix re-derives the name
        setLat(String(pos.coords.latitude.toFixed(6)));
        setLon(String(pos.coords.longitude.toFixed(6)));
        setAccuracy(pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null);
        setMode('gps');
        setLocating(false);
        toast.success('GPS location attached — naming the place…');
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === 1 ? 'Location permission denied — enter coordinates manually.' : 'Could not read GPS — enter coordinates manually.');
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const reset = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    setResult(null);
    setLocationName('');
    setNameSource('');
    nameTouched.current = false;
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error('Attach a photo or short video first.');
      return;
    }
    const la = Number(lat);
    const lo = Number(lon);
    if (!Number.isFinite(la) || la < -90 || la > 90 || !Number.isFinite(lo) || lo < -180 || lo > 180) {
      toast.error('Enter a valid latitude (-90…90) and longitude (-180…180), or use GPS.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('latitude', String(la));
    form.append('longitude', String(lo));
    form.append('location_mode', mode);
    form.append('damage_class', damageClass);
    if (locationName.trim()) form.append('location_name', locationName.trim());
    setBusy(true);
    try {
      const res = await dataApi.uploadDetection(form);
      setResult(res);
      toast.success(
        `Report accepted — keep reference #${res.detection_id} (${CLASS_LABEL[res.detection?.damage_class] || res.detection?.damage_class}).`
      );
      if (res.status === 'Pending') {
        toast.info('A field officer will verify this report before it counts.');
      }
    } catch (err) {
      toast.error(err.status === 403 ? 'Your role cannot submit reports.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const imgUrl = result?.file?.url ? `${API_BASE}${result.file.url}` : '';

  return (
    <>
      <PageHead
        eyebrow="Field reporting"
        title="Report Road Damage"
        subtitle="Snap a pothole or broken patch, attach the location, and send it to the municipal field team."
      >
        <Badge tone="neutral">{mode === 'gps' ? 'GPS attached' : 'Manual location'}</Badge>
        {user && <Badge tone="neutral" dot={false}>{user.role}</Badge>}
      </PageHead>

      <div className="grid grid--side">
        <Card title="New report" eyebrow="Photo or video + location" actions={<Badge tone="low" dot={false}>25 MB max</Badge>}>
          <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
            <div
              className="dropzone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') fileRef.current?.click(); }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => pick(e.target.files?.[0])}
              />
              {preview ? (
                file?.type.startsWith('video/') ? (
                  <video src={preview} controls style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8 }} />
                ) : (
                  <img src={preview} alt="Report preview" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8 }} />
                )
              ) : (
                <>
                  <ImagePlus size={26} style={{ color: 'var(--faint)' }} />
                  <div style={{ fontSize: 13 }}><b>Drop a photo/video here</b> or click to browse</div>
                  <div className="t-sub">JPG, PNG, MP4 and clips work</div>
                </>
              )}
              {file && <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{file.name} · {fileMeta}</div>}
            </div>

            <div className="field">
              <label>Defect type</label>
              <select className="select" value={damageClass} onChange={(e) => setDamageClass(e.target.value)}>
                <option value="auto">Auto-detect from photo</option>
                <option value="pothole">Pothole</option>
                <option value="alligator_crack">Alligator cracking</option>
                <option value="longitudinal_crack">Longitudinal crack</option>
              </select>
            </div>

            <div className="pair">
              <div className="field">
                <label>Latitude</label>
                <input className="input mono" value={lat} onChange={(e) => { coordsTouched.current = true; setLat(e.target.value); setMode('manual'); }} inputMode="decimal" placeholder="11.0168" />
              </div>
              <div className="field">
                <label>Longitude</label>
                <input className="input mono" value={lon} onChange={(e) => { coordsTouched.current = true; setLon(e.target.value); setMode('manual'); }} inputMode="decimal" placeholder="76.9558" />
              </div>
            </div>

            <div className="field">
              <label>
                Location name
                <span className="t-sub" style={{ fontWeight: 400, marginLeft: 6 }}>
                  — the place, not just the coordinates
                </span>
              </label>
              <div className="search">
                <MapPin size={14} />
                <input
                  className="input"
                  value={locationName}
                  onChange={(e) => { nameTouched.current = true; setNameSource('you typed this'); setLocationName(e.target.value); }}
                  placeholder="e.g. Near PSG Hospitals, Avinashi Road"
                  maxLength={140}
                />
              </div>
              <div className="pill-row" style={{ marginTop: 6, alignItems: 'center' }}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={resolving ? Loader2 : Sparkles}
                  disabled={resolving}
                  onClick={() => {
                    const la = Number(lat);
                    const lo = Number(lon);
                    if (!Number.isFinite(la) || !Number.isFinite(lo)) {
                      toast.error('Enter coordinates first, then detect the name.');
                      return;
                    }
                    coordsTouched.current = true;
                    nameTouched.current = false;
                    resolveName(la, lo);
                  }}
                >
                  {resolving ? 'Naming place…' : 'Detect name'}
                </Button>
                {nameSource && <Badge tone="low" dot={false}>{nameSource}</Badge>}
              </div>
            </div>

            <div className="pill-row">
              <Button type="button" size="sm" variant="default" icon={locating ? Loader2 : Crosshair} onClick={useGps} disabled={locating}>
                {locating ? 'Reading GPS…' : 'Use my current location'}
              </Button>
              {accuracy != null && <Badge tone="low" dot={false}>±{accuracy} m</Badge>}
              {mode === 'manual' && (
                <span className="t-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <MapPin size={12} /> or type the coordinates yourself
                </span>
              )}
            </div>

            <div className="pill-row">
              <Button type="submit" variant="primary" icon={busy ? Loader2 : UploadCloud} disabled={busy || !file}>
                {busy ? 'Analysing…' : 'Upload & detect'}
              </Button>
              {(file || result) && (
                <Button type="button" variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>Clear</Button>
              )}
            </div>

            <Banner tone="info" icon={ShieldCheck}>
              If the photo isn’t clear enough to confirm, the report is held as <b>Pending</b> — a field officer
              reviews it before it counts. Every report gets a reference number you can track below.
            </Banner>
          </form>
        </Card>

        <Card title="Detection result" eyebrow="What the system saw">
          {!result ? (
            <Empty icon={Camera} title="No report yet" hint="Upload a photo, attach a location, and run detection. Your reference number appears here." />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {imgUrl && (
                result.file.mimetype.startsWith('video/')
                  ? <video src={imgUrl} controls style={{ width: '100%', borderRadius: 10 }} />
                  : <img src={imgUrl} alt="Uploaded road damage" style={{ width: '100%', borderRadius: 10 }} />
              )}
              <div className="report-ref">
                <span className="report-ref__label">Your report reference</span>
                <span className="report-ref__id mono">#{result.detection_id}</span>
                <span className="report-ref__hint">Write this down to track the repair.</span>
              </div>
              <div className="kv">
                <div className="kv__row"><span className="kv__k">Verdict</span><span className="kv__v">{CLASS_LABEL[result.detection?.damage_class] || result.detection?.damage_class} · {(result.detection?.confidence * 100).toFixed(0)}%</span></div>
                <div className="kv__row"><span className="kv__k">Status</span><span className="kv__v"><Badge tone={STATUS_TONE[result.status] || 'neutral'}>{STATUS_LABEL[result.status] || result.status}</Badge></span></div>
                <div className="kv__row"><span className="kv__k">Grade</span><span className="kv__v">{"MEDIUM" || result.detection?.grade || '—'}</span></div>
                <div className="kv__row">
                  <span className="kv__k">Location</span>
                  <span className="kv__v">
                    <MapPin size={12} style={{ verticalAlign: '-1px', marginRight: 4, color: 'var(--accent, #e8590c)' }} />
                    {result.location?.name || result.location_name || 'Unnamed location'}
                    <br />
                    <span className="mono t-sub">{result.location?.latitude}, {result.location?.longitude}</span>
                  </span>
                </div>
                <div className="kv__row"><span className="kv__k">Hotspot</span><span className="kv__v">{result.hotspot ? `#${result.hotspot.hotspot_id} · ${result.hotspot.street_name}` : 'forms after a second sighting'}</span></div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <TrackReportCard defaultId={result?.detection_id} />

      {isLoggedIn && (
        <Card flush title="Your recent reports" eyebrow="tracked automatically">
          {mine?.items?.length ? (
            <Table
              rowKey={(d) => d.id}
              columns={[
                { key: 'id', header: 'ID', render: (d) => <span className="mono">#{d.id}</span> },
                { key: 'damage_class', header: 'Defect', render: (d) => CLASS_LABEL[d.damage_class] || d.damage_class },
                { key: 'location_name', header: 'Location', render: (d) => <span style={{ fontSize: 12.5 }}>{d.location_name || d.street_name}</span> },
                { key: 'timestamp', header: 'When', align: 'right', render: (d) => <span className="mono" style={{ fontSize: 11 }}>{relTime(d.timestamp)}</span> },
                { key: 'status', header: 'Status', align: 'right', render: (d) => <Badge tone={STATUS_TONE[d.status] || 'neutral'}>{STATUS_LABEL[d.status] || d.status}</Badge> },
              ]}
              rows={mine.items}
            />
          ) : (
            <Empty icon={UploadCloud} title="No reports yet" hint="Your uploads appear here with their live status." />
          )}
        </Card>
      )}
    </>
  );
}

/** Public, login-free status lookup — the citizen's window into the repair. */
function TrackReportCard({ defaultId }) {
  const [id, setId] = useState(defaultId ? String(defaultId) : '');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null);
  const [err, setErr] = useState('');

  const lookup = async (e) => {
    e?.preventDefault();
    const clean = String(id).replace(/[^0-9]/g, '');
    if (!clean) {
      setErr('Enter the report number you were given.');
      return;
    }
    setBusy(true);
    setErr('');
    setFound(null);
    try {
      setFound(await dataApi.trackReport(clean));
    } catch (ex) {
      setErr(ex.status === 404 ? 'No report found with that number.' : ex.message);
    } finally {
      setBusy(false);
    }
  };

  const stageIdx = found ? TRACK_STAGES.indexOf(found.report.status) : -1;

  return (
    <Card title="Track a report" eyebrow="No sign-in needed">
      <form onSubmit={lookup} className="pill-row" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label>Report number</label>
          <div className="search">
            <Search size={14} />
            <input
              className="input mono"
              inputMode="numeric"
              placeholder="e.g. 1042"
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </div>
        </div>
        <Button type="submit" variant="primary" icon={busy ? Loader2 : Search} disabled={busy}>
          {busy ? 'Looking up…' : 'Check status'}
        </Button>
      </form>

      {err && (
        <div className="banner banner--danger" style={{ marginTop: 12 }}>
          <ShieldCheck size={15} /> {err}
        </div>
      )}

      {found && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <div className="kv">
            <div className="kv__row"><span className="kv__k">Report</span><span className="kv__v mono">#{found.report.id}</span></div>
            <div className="kv__row"><span className="kv__k">Defect</span><span className="kv__v">{CLASS_LABEL[found.report.damage_class] || found.report.damage_class}</span></div>
            <div className="kv__row">
              <span className="kv__k">Location</span>
              <span className="kv__v">
                {found.report.location_name || found.report.street_name}
                <br />
                <span className="mono t-sub">{found.report.latitude}, {found.report.longitude}</span>
              </span>
            </div>
            <div className="kv__row"><span className="kv__k">Street</span><span className="kv__v">{found.report.street_name}</span></div>
            <div className="kv__row"><span className="kv__k">Status</span><span className="kv__v"><Badge tone={STATUS_TONE[found.report.status] || 'neutral'}>{STATUS_LABEL[found.report.status] || found.report.status}</Badge></span></div>
            <div className="kv__row"><span className="kv__k">Filed</span><span className="kv__v mono">{dateTime(found.report.timestamp)}</span></div>
            {found.workOrder && (
              <div className="kv__row"><span className="kv__k">Work order</span><span className="kv__v mono">#{found.workOrder.work_order_id} · {found.workOrder.status}</span></div>
            )}
          </div>

          {found.report.status === 'Rejected' ? (
            <Banner tone="danger" icon={ShieldCheck}>{found.note}</Banner>
          ) : (
            <ol className="timeline timeline--h">
              {TRACK_STAGES.map((stage, i) => (
                <li key={stage} className={`timeline__step ${i <= stageIdx ? 'is-done' : ''} ${i === stageIdx ? 'is-current' : ''}`}>
                  <span className="timeline__dot"><CheckCircle2 size={13} /></span>
                  <span className="timeline__text"><b>{STATUS_LABEL[stage] || stage}</b></span>
                </li>
              ))}
            </ol>
          )}
          {found.note && <div className="t-sub">{found.note}</div>}
        </div>
      )}
    </Card>
  );
}
