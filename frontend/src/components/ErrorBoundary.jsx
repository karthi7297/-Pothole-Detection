import React from 'react';

// Demo-proof: a widget crash shows a card, never a blank screen.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return <div className="card"><h4>Something glitched (caught)</h4><p className="hint">{String(this.state.err.message || this.state.err)}</p><button className="act" onClick={() => this.setState({ err: null })}>Retry</button></div>;
    }
    return this.props.children;
  }
}
