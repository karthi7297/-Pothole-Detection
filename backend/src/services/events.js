/**
 * Server-Sent Events hub.
 * Replaces the old frontend `setInterval` fake feed with a real push channel
 * driven by the ingestion pipeline.
 */
const clients = new Set();

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function clientCount() {
  return clients.size;
}

export function broadcast(type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

/** Keeps intermediaries from closing idle SSE connections. */
export function startHeartbeat(intervalMs = 25_000) {
  const timer = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
