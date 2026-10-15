/**
 * RoadPulse API client.
 *
 * - VITE_API_URL empty  → same-origin, Vite dev proxy forwards /api to :8080
 * - token persisted in localStorage, attached as a Bearer header
 * - errors are normalised into `ApiError` with status + server message
 */

/* RoadPulse API client. */

/* API base */
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

/* ---------------------------------------------------------------- auth -- */
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
  createHotspot: (body) => request('/api/hotspots', { method: 'POST', body }),
  deleteHotspot: (id) => request(`/api/hotspots/${id}`, { method: 'DELETE' }),

  detections: (query = '') => request(`/api/detections${query}`),
  pendingDetections: (query = '') => request(`/api/detections/pending${query}`),
  reportsSummary: () => request('/api/reports/summary'),
  /** Coordinates → human-readable place name. Public; works with no token. */
  reverseGeocode: (lat, lon) =>
    request(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
  /** Public report tracking — works with no token. */
  trackReport: (id) => request(`/api/reports/track/${encodeURIComponent(id)}`),
  reviewDetection: (id, status) => request(`/api/detections/${id}`, { method: 'PATCH', body: { status } }),

  workOrders: (query = '') => request(`/api/work-orders${query}`),
  createWorkOrder: (hotspotId, ward) =>
    request('/api/work-orders', { method: 'POST', body: { hotspot_id: hotspotId, ward } }),
  updateWorkOrder: (id, status) => request(`/api/work-orders/${id}`, { method: 'PATCH', body: { status } }),
  approveWorkOrder: (id) => request(`/api/work-orders/${id}/approve`, { method: 'PATCH', body: {} }),

  weather: (lat = 11.0168, lon = 76.9558) => request(`/api/weather?lat=${lat}&lon=${lon}`),
  monsoon: () => request('/api/monsoon'),

  uploadDetection: (formData, { signal } = {}) => {
    const token = getToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = token ? `${API_BASE}/api/detections/upload` : `${API_BASE}/api/detections/upload-anonymous`;
    return fetch(url, { method: 'POST', headers, body: formData, signal })
      .then(async (res) => {
        if (!res.ok) {
          let payload = null;
          try { payload = await res.json(); } catch { /* non-JSON */ }
          throw new ApiError(res.status, payload?.message || `${res.status} ${res.statusText}`, payload);
        }
        return res.json();
      })
      .catch((err) => {
        if (err instanceof ApiError || err.name === 'AbortError') throw err;
        throw new ApiError(0, 'Cannot reach the RoadPulse API. Is the backend running on :8080?', null);
      });
  },

  trend: (days = 30) => request(`/api/analytics/trend?days=${days}`),
  zones: () => request('/api/analytics/zones'),
  classMix: () => request('/api/analytics/class-mix'),
  priority: () => request('/api/analytics/priority'),
  topHotspots: (limit = 8) => request(`/api/analytics/top-hotspots?limit=${limit}`),
  fleetAnalytics: () => request('/api/analytics/fleet'),

  fleet: () => request('/api/fleet'),
  fleetPositions: () => request('/api/fleet/positions'),
  fleetGeofences: () => request('/api/fleet/geofences'),
  /** Zone geofence polygons — shared by the report map. */
  zoneGeofences: () => request('/api/fleet/geofences'),
  simulator: (action, intervalMs) =>
    request('/api/fleet/simulator', { method: 'POST', body: { action, ...(intervalMs ? { intervalMs } : {}) } }),

  audit: (limit = 60) => request(`/api/audit?limit=${limit}`),
  eventStatus: () => request('/api/events/status'),

  /** Inspector-only, page-aware assistant. */
  assistantIntro: (page) => request(`/api/assistant/intro?page=${encodeURIComponent(page || '')}`),
  assistantChat: (message, page, history) =>
    request('/api/assistant/chat', { method: 'POST', body: { message, page, history } }),
};

/* Unwrap the `{ items, total }` envelope the list endpoints return. */
export const itemsOf = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};