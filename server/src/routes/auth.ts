import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { config } from '../config';
import { wrap } from '../asyncWrap';
import { requireAuth, signToken, COOKIE_OPTS, type AuthUser } from '../middleware/auth';

const router = Router();

// What sign-in options this deployment offers. Public by design — the login
// screen and the share-link gate both render from it, before anyone is
// authenticated. It exposes only which methods exist, never any credential.
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    sso: config.sso.enabled ? { enabled: true, label: config.sso.buttonLabel } : { enabled: false },
    passwordLogin: config.passwordLoginMode !== 'off',
    passwordLoginAdminOnly: config.passwordLoginMode === 'admin-only',
    signup: config.signupEnabled && config.passwordLoginMode === 'all',
  });
});

// bcrypt at cost 12 burns ~1s of main-thread CPU per attempt (bcryptjs is pure
// JS), so a credential-stuffing loop can peg the dyno. Cheap in-memory brake:
// 10 failed attempts per IP per 10 minutes, cleared on success.
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 10;
const failures = new Map<string, number[]>();
function tooManyFailures(ip: string): boolean {
  const now = Date.now();
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  failures.set(ip, recent);
  return recent.length >= FAIL_LIMIT;
}
function recordFailure(ip: string): void {
  const list = failures.get(ip);
  if (list) list.push(Date.now());
  else failures.set(ip, [Date.now()]);
  if (failures.size > 10_000) failures.clear(); // bound the map under address churn
}

router.post('/signup', wrap(async (req: Request, res: Response) => {
  // Self-serve signup closes once IT provisions accounts and SSO carries
  // everyone in; the admin panel becomes the only way to create one.
  if (!config.signupEnabled || config.passwordLoginMode !== 'all') {
    res.status(403).json({
      error: 'Self-serve signup is disabled. Ask a GSOC administrator to create your account.',
    });
    return;
  }
  const { email, name, password, code } = req.body ?? {};
  if (!email || !name || !password || !code) {
    res.status(400).json({ error: 'All fields are required' }); return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' }); return;
  }
  if (tooManyFailures(req.ip ?? '')) {
    res.status(429).json({ error: 'Too many attempts — try again in a few minutes' }); return;
  }

  const { rows: [setting] } = await pool.query(
    "SELECT value FROM settings WHERE key = 'signup_code'"
  );
  if (!setting || setting.value !== code.trim().toUpperCase()) {
    recordFailure(req.ip ?? '');
    res.status(400).json({ error: 'Invalid signup code' }); return;
  }

  const password_hash = await bcrypt.hash(password, 12);

  // First registered user becomes admin automatically.
  const { rows: [{ count }] } = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM users'
  );
  const role = count === 0 ? 'admin' : 'member';

  try {
    const { rows: [user] } = await pool.query<AuthUser>(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role`,
      [email.toLowerCase().trim(), name.trim(), password_hash, role]
    );
    res.cookie('gsoc_auth', signToken(user), COOKIE_OPTS).json(user);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      res.status(400).json({ error: 'That email is already registered' }); return;
    }
    throw err;
  }
}, 'auth'));

router.post('/login', wrap(async (req: Request, res: Response) => {
  if (config.passwordLoginMode === 'off') {
    res.status(403).json({ error: 'Password sign-in is disabled — use single sign-on.', ssoOnly: true });
    return;
  }
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' }); return;
  }
  if (tooManyFailures(req.ip ?? '')) {
    res.status(429).json({ error: 'Too many attempts — try again in a few minutes' }); return;
  }
  const { rows: [user] } = await pool.query(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  // password_hash is nullable now: an SSO-only account (or one an admin
  // pre-created without a password) has none. bcrypt.compare throws on a null
  // hash, so the short-circuit is load-bearing, not defensive noise.
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    recordFailure(req.ip ?? '');
    res.status(401).json({ error: 'Invalid email or password' }); return;
  }
  // Phase 3 of the rollout: passwords survive only for the break-glass admin
  // account, so the GSOC can still get in when the IdP is unreachable.
  if (config.passwordLoginMode === 'admin-only' && user.role !== 'admin') {
    res.status(403).json({ error: 'Password sign-in is disabled for this account — use single sign-on.', ssoOnly: true });
    return;
  }
  failures.delete(req.ip ?? '');
  const { password_hash: _h, ...safeUser } = user as { password_hash: string } & AuthUser;
  res.cookie('gsoc_auth', signToken(safeUser), COOKIE_OPTS).json(safeUser);
}, 'auth'));

router.post('/logout', (_req, res: Response) => {
  res.clearCookie('gsoc_auth', { path: '/' }).json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json(req.user);
});

export default router;
