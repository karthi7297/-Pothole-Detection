/**
 * RoadPulse API client.
 *
 * - VITE_API_URL empty  → same-origin, Vite dev proxy forwards /api to :8080
 * - token persisted in localStorage, attached as a Bearer header
 * - errors are normalised into `ApiError` with status + server message
 */

export const API_BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'roadpulse.token';
const USER_KEY = 'roadpulse.user';

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
  get isAuth() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setSession = (token, user) => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
};
export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
};

async function request(path, { method = 'GET', body, signal, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the RoadPulse API. Is the backend running on :8080?', null);
  }

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, payload?.message || `${res.status} ${res.statusText}`, payload);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
};

/* ------------------------------------------------------------------ auth -- */
export const authApi = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/api/auth/me'),
  users: () => request('/api/auth/users'),
};

/* ---------------------------------------------------------------- domain -- */
export const dataApi = {
  health: () => request('/api/health'),
  metrics: () => request('/api/metrics'),
  dashboard: () => request('/api/dashboard'),

  segments: (params = '') => request(`/api/segments${params}`),
  segment: (id) => request(`/api/segments/${encodeURIComponent(id)}`),

  hotspots: (query = '') => request(`/api/hotspots${query}`),
  hotspot: (id) => request(`/api/hotspots/${id}`),
  updateHotspot: (id, body) => request(`/api/hotspots/${id}`, { method: 'PATCH', body }),

  detections: (query = '') => request(`/api/detections${query}`),
  reviewDetection: (id, status) => request(`/api/detections/${id}`, { method: 'PATCH', body: { status } }),

  workOrders: (query = '') => request(`/api/work-orders${query}`),
  createWorkOrder: (hotspotId, ward) =>
    request('/api/work-orders', { method: 'POST', body: { hotspot_id: hotspotId, ward } }),

  weather: (lat = 11.0168, lon = 76.9558) => request(`/api/weather?lat=${lat}&lon=${lon}`),
  monsoon: () => request('/api/monsoon'),

  trend: (days = 30) => request(`/api/analytics/trend?days=${days}`),
  zones: () => request('/api/analytics/zones'),
  classMix: () => request('/api/analytics/class-mix'),
  priority: () => request('/api/analytics/priority'),
  topHotspots: (limit = 8) => request(`/api/analytics/top-hotspots?limit=${limit}`),
  fleetAnalytics: () => request('/api/analytics/fleet'),

  fleet: () => request('/api/fleet'),
  simulator: (action, intervalMs) =>
    request('/api/fleet/simulator', { method: 'POST', body: { action, ...(intervalMs ? { intervalMs } : {}) } }),

  audit: (limit = 60) => request(`/api/audit?limit=${limit}`),
  eventStatus: () => request('/api/events/status'),
};

/** Unwrap the `{ items, total }` envelope the list endpoints return. */
export const itemsOf = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};
