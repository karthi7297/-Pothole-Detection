import { useEffect, useRef, useState } from 'react';
import { API_BASE, getToken } from '../lib/api.js';

/**
 * Subscribes to the server's Server-Sent Events stream.
 *
 * The backend simulator pushes one frame every few seconds; we keep the newest
 * `limit` frames for the live feed and surface rejection frames too, so the
 * confidence gate is visible in the UI rather than hidden.
 */
export function useLiveFeed({ limit = 40, enabled = true } = {}) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [lastAt, setLastAt] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const token = getToken();
    if (!token) return undefined;

    let closed = false;
    let retry;

    const connect = () => {
      if (closed) return;
      const url = `${API_BASE}/api/events/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('hello', () => setConnected(true));
      es.addEventListener('detection', (e) => {
        try {
          const payload = JSON.parse(e.data);
          setEvents((prev) => [payload, ...prev].slice(0, limit));
          setLastAt(new Date().toISOString());
        } catch {
          /* ignore malformed frame */
        }
      });
      es.addEventListener('hotspot', (e) => {
        try {
          const payload = JSON.parse(e.data);
          setEvents((prev) => [{ kind: 'hotspot', ...payload, _ts: new Date().toISOString() }, ...prev].slice(0, limit));
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('simulator', () => setLastAt(new Date().toISOString()));

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!closed) retry = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      esRef.current?.close();
      setConnected(false);
    };
  }, [enabled, limit]);

  return { events, connected, lastAt };
}

/** Poll an async loader on an interval; keeps the previous value while refreshing. */
export function usePoll(loader, intervalMs = 15000, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let timer;

    const run = async () => {
      try {
        const result = await loader();
        if (!alive) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (alive) setError(err);
      } finally {
        if (alive) setLoading(false);
      }
    };

    run();
    if (intervalMs) timer = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading };
}
