import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { requireAdmin } from '../middleware/auth';
import { wrap } from '../asyncWrap';
import { clampFallbackHours } from '../shareAccess';
import {
  getShareFallbackFresh, enableShareFallback, disableShareFallback,
} from '../shareFallbackStore';

const router = Router();
router.use(requireAdmin);

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len = 8) {
  return Array.from({ length: len }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
}

// List all users. Reports whether each account can sign in by password, by SSO,
// or neither yet ("pending" — pre-created and waiting for its owner's first SSO
// login to link it), which is the state an admin needs to see during migration.
router.get('/users', wrap(async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id, email, name, role, created_at, sso_linked_at,
            (password_hash IS NOT NULL) AS has_password,
            (sso_subject   IS NOT NULL) AS sso_linked
       FROM users ORDER BY created_at ASC`
  );
  res.json(rows);
}, 'admin'));

// Pre-create an account for someone IT will match by email at their first SSO
// login. A password is optional and normally omitted: SSO-only accounts have no
// password at all. Supply one only for a break-glass admin that must still work
// when the IdP is unreachable.
router.post('/users', wrap(async (req: Request, res: Response) => {
  const { email, name, role, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof name !== 'string' || !email.trim() || !name.trim()) {
    res.status(400).json({ error: 'Email and name are required' }); return;
  }
  const normalizedEmail = email.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(normalizedEmail)) {
    res.status(400).json({ error: 'That does not look like a valid email address' }); return;
  }
  const normalizedRole = role === 'admin' ? 'admin' : 'member';

  let passwordHash: string | null = null;
  if (password !== undefined && password !== null && password !== '') {
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' }); return;
    }
    passwordHash = await bcrypt.hash(password, 12);
  }

  try {
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at, sso_linked_at,
                 (password_hash IS NOT NULL) AS has_password,
                 (sso_subject   IS NOT NULL) AS sso_linked`,
      [normalizedEmail, name.trim(), passwordHash, normalizedRole]
    );
    res.status(201).json(user);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'That email already has an account' }); return;
    }
    throw err;
  }
}, 'admin'));

// Delete a user (cannot delete yourself)
router.delete('/users/:id', wrap(async (req: Request, res: Response) => {
  if (req.user!.id === req.params.id) {
    res.status(400).json({ error: 'You cannot delete your own account' }); return;
  }
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!rowCount) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ ok: true });
}, 'admin'));

// Get current signup code
router.get('/signup-code', wrap(async (_req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    "SELECT value FROM settings WHERE key = 'signup_code'"
  );
  res.json({ code: row?.value ?? null });
}, 'admin'));

// Rotate the signup code
router.post('/signup-code/refresh', wrap(async (_req: Request, res: Response) => {
  const code = randomCode();
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('signup_code', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [code]
  );
  res.json({ code });
}, 'admin'));

// ── Share-link password break-glass ───────────────────────────────────────────
//
// Share links normally require a signed-in account. This opens a time-boxed
// window in which the link password is accepted again, for when the IdP is down
// or SSO is otherwise unavailable and a situation report still has to reach
// people. It expires on its own so nobody has to remember to close it.

router.get('/share-fallback', wrap(async (_req: Request, res: Response) => {
  res.json(await getShareFallbackFresh());
}, 'admin'));

router.post('/share-fallback', wrap(async (req: Request, res: Response) => {
  const hours = clampFallbackHours((req.body ?? {}).hours);
  const state = await enableShareFallback(hours, { id: req.user!.id, name: req.user!.name });
  // Loud on purpose: this widens who can read every live share link, and the
  // log is where an after-action review will look for when, and by whom.
  console.warn(`[admin] share-link password fallback ENABLED for ${hours}h by ${req.user!.email}`);
  res.json(state);
}, 'admin'));

router.delete('/share-fallback', wrap(async (req: Request, res: Response) => {
  const state = await disableShareFallback();
  console.warn(`[admin] share-link password fallback DISABLED by ${req.user!.email}`);
  res.json(state);
}, 'admin'));

export default router;
