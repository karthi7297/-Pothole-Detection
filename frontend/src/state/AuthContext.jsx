import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, authApi, getStoredUser, getToken, setSession } from '../lib/api.js';

/**
 * Session + role state.
 *
 * RBAC is enforced server-side (the API rejects out-of-role actions), so
 * switching role performs a real re-authentication against that role's demo
 * account rather than only swapping a local flag.
 */
const AuthContext = createContext(null);

export const DEMO_ACCOUNTS = [
  { role: 'executive', email: 'executive@cmc.gov.in', name: 'Arun Kumar', title: 'Municipal Executive', scope: 'Full city control, dispatch authority' },
  { role: 'inspector', email: 'inspector@cmc.gov.in', name: 'Priya Rajan', title: 'Field Inspector', scope: 'Triage, verification, monsoon watch' },
  { role: 'driver', email: 'driver@tnstc.in', name: 'Murugan S.', title: 'Fleet Driver', scope: 'Passive dashcam ingestion only' },
];
const DEMO_PASSWORD = 'roadpulse123';
export const ROLE_LABEL = { executive: 'Municipal Executive', inspector: 'Field Inspector', driver: 'Fleet Driver' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [capabilities, setCapabilities] = useState([]);
  const [status, setStatus] = useState(() => (getToken() ? 'loading' : 'anon'));
  const [error, setError] = useState('');

  /* Restore an existing session on boot. */
  useEffect(() => {
    let alive = true;
    if (!getToken()) {
      setStatus('anon');
      return () => { alive = false; };
    }
    (async () => {
      try {
        const me = await authApi.me();
        if (!alive) return;
        setUser(me.user);
        setCapabilities(me.capabilities || []);
        setStatus('ready');
      } catch {
        if (!alive) return;
        setSession(null, null);
        setStatus('anon');
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (email, password) => {
    setError('');
    const res = await authApi.login(email, password);
    setSession(res.token, res.user);
    setUser(res.user);
    const me = await authApi.me();
    setCapabilities(me.capabilities || []);
    setStatus('ready');
    return res.user;
  }, []);

  const switchRole = useCallback(
    async (role) => {
      const account = DEMO_ACCOUNTS.find((a) => a.role === role);
      if (!account) throw new Error(`Unknown role "${role}"`);
      return login(account.email, DEMO_PASSWORD);
    },
    [login]
  );

  const logout = useCallback(() => {
    setSession(null, null);
    setUser(null);
    setCapabilities([]);
    setStatus('anon');
  }, []);

  /** Capability check used to gate navigation and actions. */
  const can = useCallback(
    (capability) => {
      if (!capability) return true;
      return capabilities.includes('*') || capabilities.includes(capability);
    },
    [capabilities]
  );

  const value = useMemo(
    () => ({ user, capabilities, status, error, setError, login, logout, switchRole, can, isExecutive: user?.role === 'executive' }),
    [user, capabilities, status, error, login, logout, switchRole, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { ApiError };
