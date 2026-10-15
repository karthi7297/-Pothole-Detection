import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CORS_ORIGIN, ENABLE_SIMULATOR, NODE_ENV, PORT } from './config.js';
import { initSchema } from './db.js';
import { errorHandler, notFound } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';
import { rateLimit } from './middleware/rateLimit.js';
import api from './routes/index.js';
import { startHeartbeat } from './services/events.js';
import { startSimulator } from './services/simulator.js';
import { initVehicles } from './services/vehicles.js';

initSchema();

const app = express();
app.disable('x-powered-by');

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(requestLogger);
app.use(rateLimit({ windowMs: 60_000, max: 900 }));

const here = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(here, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));

app.use('/api', api);

app.use(notFound);
app.use(errorHandler);

startHeartbeat();

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  RoadPulse Coimbatore — Municipal Road Intelligence API v3.0');
  console.log(`  ▸ listening   http://localhost:${PORT}/api`);
  console.log(`  ▸ environment ${NODE_ENV}`);
  console.log(`  ▸ cors        ${CORS_ORIGIN.join(', ')}`);
  console.log(`  ▸ simulator   ${ENABLE_SIMULATOR ? 'enabled' : 'disabled'}`);
  console.log('');
});

if (ENABLE_SIMULATOR) startSimulator();
initVehicles();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} received — shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
