import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_TTL } from '../config.js';
import { httpError } from './error.js';
import { one } from '../db.js';

export const ROLES = ['executive', 'inspector', 'driver'];

/**
 * Capability matrix — single source of truth for RBAC.
 *
 * The three roles map to the real municipal workflow:
 *
 *   driver    → citizen who reports road damage and tracks their own reports
 *   inspector → field officer: verifies reports and works them to completion
 *   executive → municipal executive: reads every dashboard, changes nothing
 */
export const CAPABILITIES = {
  // Oversight only — the executive monitors the city, it does not act.
  executive: [
    'analytics:read',           // City overview KPIs
    'map:read',                 // City map
    'hotspots:read',            // View tracked defects
    'detections:read',          // View the report log
    'monsoon:read',             // Monsoon watch
    'workorders:read',          // View the dispatch register
    'fleet:read',               // Fleet overview
    'fleet:stream',             // Live fleet stream
    'audit:read',               // Governance & audit trail
  ],
  // Field officer — owns the report → verify → dispatch → repair loop.
  inspector: [
    'analytics:read',           // Operations KPIs
    'map:read',                 // Map operations
    'hotspots:read',            // Triage queue
    'hotspots:verify',          // Verify / dispatch a defect
    'hotspots:manage',          // Create / delete defects
    'detections:read',          // View the report log
    'detections:review',        // Accept / reject pending reports
    'monsoon:read',             // Monsoon watch
    'workorders:read',          // View the dispatch register
    'workorders:manage',        // Issue work orders
    'workorders:update',        // Advance / complete a work order
    'fleet:read',               // Fleet overview
    'fleet:stream',             // Live fleet stream
  ],
  // Citizen / driver — report damage, track your own reports.
  driver: [
    'map:read',                 // Live road map
    'detections:ingest',        // Upload reports
    'detections:read',          // View own reports
  ],
};

export function can(role, capability) {
  const caps = CAPABILITIES[role] || [];
  return caps.includes('*') || caps.includes(capability);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return req.query.token || null;
}

/** Attaches req.user when a valid token is present; never throws. */
export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = one('SELECT id, email, name, role FROM users WHERE id = ?', [payload.sub]);
    if (user) req.user = user;
  } catch {
    /* ignore — treated as anonymous */
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(httpError(401, 'Authentication required.', 'UNAUTHENTICATED'));
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(httpError(401, 'Authentication required.', 'UNAUTHENTICATED'));
    if (!roles.includes(req.user.role)) {
      return next(
        httpError(403, `Role "${req.user.role}" cannot perform this action.`, 'FORBIDDEN', {
          required: roles,
          actual: req.user.role,
        })
      );
    }
    next();
  };
}

/** Capability guard — preferred over raw role checks in routes. */
export function requireCapability(capability) {
  return (req, _res, next) => {
    if (!req.user) return next(httpError(401, 'Authentication required.', 'UNAUTHENTICATED'));
    if (!can(req.user.role, capability)) {
      return next(
        httpError(403, `Your role cannot access "${capability}".`, 'FORBIDDEN', {
          capability,
          role: req.user.role,
        })
      );
    }
    next();
  };
}
