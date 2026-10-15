import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Camera, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { DEMO_ACCOUNTS, ROLE_LABEL, useAuth } from '../state/AuthContext.jsx';
import { Button, Field, useToast } from '../components/ui.jsx';

const PASSWORD = 'roadpulse123';

export default function Login() {
  const { login, status } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('executive@cmc.gov.in');
  const [password, setPassword] = useState(PASSWORD);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (status === 'ready') navigate('/', { replace: true });
  }, [status, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const user = await login(email.trim(), password);
      toast.success(`Signed in as ${user.name}`);
      navigate('/', { replace: true });
    } catch (ex) {
      setErr(ex.status === 401 ? 'Invalid email or password.' : ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="login__aside">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'rgba(255,255,255,0.14)',
                display: 'grid', placeItems: 'center',
              }}
            >
              <Activity size={20} strokeWidth={2.4} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>
                RoadPulse
              </div>
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
                Coimbatore Municipal Corporation
              </div>
            </div>
          </div>
        </div>

        <div className="login__pitch">
          <h2>Every city bus is a road inspector.</h2>
          <p>
            RoadPulse turns the existing TNSTC and CMC waste fleet into a passive pavement survey. Onboard vision
            flags potholes and cracks, DBSCAN clusters repeat sightings into chronic sub-base failures, and the
            monsoon engine warns you before the water gets in.
          </p>
        </div>

        <div className="login__stats">
          <div className="login__stat">
            <b>&lt; 2 h</b>
            <span>Hazard discovery</span>
          </div>
          <div className="login__stat">
            <b>₹0</b>
            <span>Per km surveyed</span>
          </div>
          <div className="login__stat">
            <b>IRC:82</b>
            <span>PCI compliant</span>
          </div>
        </div>
      </aside>

      <div className="login__panel">
        <form className="login__form" onSubmit={submit}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="eyebrow">Secure access</div>
            <h1>Sign in to the console</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              Use a municipal account. Your role decides which workspaces and actions you can reach.
            </p>
          </div>

          {err && (
            <div className="banner banner--danger">
              <ShieldCheck size={15} />
              {err}
            </div>
          )}

          <Field label="Work email">
            <div className="search">
              <Mail size={14} />
              <input
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@cmc.gov.in"
                required
              />
            </div>
          </Field>

          <Field label="Password">
            <div className="search">
              <KeyRound size={14} />
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          </Field>

          <Button variant="primary" type="submit" disabled={busy} block>
            {busy ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
            {busy ? 'Authenticating…' : 'Sign in'}
          </Button>

          <Link
            to="/report"
            className="btn btn--ghost btn--sm"
            style={{ justifyContent: 'center', gap: 7 }}
          >
            <Camera size={14} /> Report road damage without signing in
          </Link>

          <div className="login__demo">
            <div className="eyebrow">Demo accounts · password {PASSWORD}</div>
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.role}
                type="button"
                className="login__demo-btn"
                onClick={() => {
                  setEmail(a.email);
                  setPassword(PASSWORD);
                }}
              >
                <ShieldCheck size={15} style={{ color: 'var(--brand)', flex: '0 0 auto' }} />
                <span style={{ flex: 1 }}>
                  <b>{ROLE_LABEL[a.role]}</b>
                  <span className="mono">{a.email}</span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>{a.scope}</span>
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
