import express from 'express';
import cors from 'cors';
import { PORT, CORS_ORIGIN } from './config.js';
import { initSchema } from './db.js';
import api from './routes/api.js';

initSchema();

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.use('/api', api);

app.listen(PORT, () => console.log(`RoadPulse API :${PORT} | CORS: ${CORS_ORIGIN.join(',')}`));
