import { Router } from 'express';
import { addClient, clientCount, broadcast } from '../services/events.js';
import { optionalAuth } from '../middleware/auth.js';
import { status } from '../services/simulator.js';

const router = Router();

/**
 * Server-Sent Events stream.
 * The browser's EventSource cannot set headers, so the token may be passed as
 * `?token=`; optionalAuth handles both forms.
 */
router.get('/events/stream', optionalAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), clients: clientCount() + 1 })}\n\n`);
  addClient(res);
  req.on('close', () => res.end());
});

router.get('/events/status', (_req, res) =>
  res.json({ connectedClients: clientCount(), simulator: status() })
);

router.post('/events/ping', (_req, res) => {
  broadcast('ping', { at: new Date().toISOString() });
  res.json({ ok: true, clients: clientCount() });
});

export default router;
