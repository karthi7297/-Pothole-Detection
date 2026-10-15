import { query, run } from '../db.js';

/** Append-only audit trail — every privileged mutation is recorded. */
export function audit({ userId = null, userEmail = null, action, entity = null, entityId = null, detail = null }) {
  try {
    run(
      'INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)',
      [userId, userEmail, action, entity, entityId != null ? String(entityId) : null, detail]
    );
  } catch (err) {
    // Auditing must never break the request path.
    console.warn('[audit] failed to record entry:', err.message);
  }
}

export function recentAudit(limit = 60) {
  return query('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [limit]);
}
