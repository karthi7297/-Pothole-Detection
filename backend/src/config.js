import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const sqliteRaw = process.env.SQLITE_PATH || './roadpulse.db';
export const SQLITE_PATH = path.isAbsolute(sqliteRaw) ? sqliteRaw : path.join(BACKEND_ROOT, sqliteRaw);

export const PORT = Number(process.env.PORT || 8080);
export const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

export const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
