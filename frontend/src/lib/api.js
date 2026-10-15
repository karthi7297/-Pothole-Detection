// Base URL comes from frontend/.env (VITE_API_URL).
// Empty string = same-origin, uses the Vite dev proxy (/api -> backend).
export const API_BASE = import.meta.env.VITE_API_URL || '';

export async function api(path, opts) {
  const r = await fetch(API_BASE + path, opts);
  if (!r.ok) throw new Error(`API ${r.status} ${path}`);
  return r.json();
}
