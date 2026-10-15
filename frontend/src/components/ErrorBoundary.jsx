import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/** Keeps a widget crash from ever showing a blank screen. */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error('[RoadPulse] UI error:', err, info);
  }

  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div className="card" style={{ maxWidth: 520 }}>
            <div className="card__body" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <AlertTriangle size={20} color="var(--critical)" />
                <h2 style={{ fontSize: 17 }}>This view failed to render</h2>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                The rest of the console is unaffected. The error has been logged to the browser console.
              </p>
              <pre className="wo" style={{ maxHeight: 160 }}>
                {String(this.state.err?.message || this.state.err)}
              </pre>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn--primary" onClick={() => this.setState({ err: null })}>
                  <RefreshCw size={15} /> Retry
                </button>
                <button className="btn" onClick={() => window.location.reload()}>
                  Reload console
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
