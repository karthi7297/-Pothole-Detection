import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { answer, normalizePage, pageIntro } from '../services/assistant.js';

/**
 * In-app assistant — Field Inspector only.
 *
 * The assistant is deliberately scoped to the inspector because it answers from
 * the operational data that role works with (reports, triage, dispatch, fleet).
 * Both routes are auth-gated and role-gated.
 */
const router = Router();
router.use(requireAuth);
router.use(requireRole('inspector'));

/** Greeting, starter questions and headline facts for the current page. */
router.get('/assistant/intro', (req, res) => {
  res.json(pageIntro(req.query.page, req.user));
});

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Ask a question.').max(2000),
  page: z.string().trim().max(160).optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(12)
    .optional(),
});

router.post(
  '/assistant/chat',
  rateLimit({ windowMs: 60_000, max: 40 }),
  asyncHandler(async (req, res, next) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(httpError(400, 'A question is required.', 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors));
    }
    const { message, page, history } = parsed.data;
    const result = await answer({
      message,
      page: normalizePage(page),
      history: history || [],
      user: req.user,
    });
    res.json(result);
  })
);

export default router;
