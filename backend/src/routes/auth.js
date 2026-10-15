import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { JWT_TTL } from '../config.js';
import { one, query } from '../db.js';
import { CAPABILITIES, requireAuth, requireRole, signToken } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { audit } from '../services/audit.js';

const router = Router();

const credentials = z.object({
  email: z.string().trim().min(3),
  password: z.string().min(4),
});

router.post(
  '/login',
  rateLimit({ windowMs: 60_000, max: 20 }),
  asyncHandler(async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, 'A valid email and password are required.', 'VALIDATION_ERROR', {
        fields: Object.keys(parsed.error.flatten().fieldErrors),
      });
    }
    const { email, password } = parsed.data;
    const user = one('SELECT * FROM users WHERE lower(email) = lower(?)', [email]);
    if (!user) throw httpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw httpError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');

    audit({ userId: user.id, userEmail: user.email, action: 'auth.login', entity: 'user', entityId: user.id });

    res.json({
      token: signToken(user),
      expiresIn: JWT_TTL,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    capabilities: CAPABILITIES[req.user.role] || [],
  });
});

/** Executive-only: see who has access. */
router.get('/users', requireAuth, requireRole('executive'), (_req, res) => {
  res.json(
    query('SELECT id, email, name, role, created_at FROM users ORDER BY id').map((u) => ({
      ...u,
      capabilities: CAPABILITIES[u.role] || [],
    }))
  );
});

export default router;
