import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { requireAuth, signToken, COOKIE_OPTS, type AuthUser } from '../middleware/auth';

const router = Router();

router.post('/signup', async (req: Request, res: Response) => {
  const { email, name, password, code } = req.body ?? {};
  if (!email || !name || !password || !code) {
    res.status(400).json({ error: 'All fields are required' }); return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' }); return;
  }

  const { rows: [setting] } = await pool.query(
    "SELECT value FROM settings WHERE key = 'signup_code'"
  );
  if (!setting || setting.value !== code.trim().toUpperCase()) {
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
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' }); return;
  }
  const { rows: [user] } = await pool.query(
    'SELECT id, email, name, role, password_hash FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' }); return;
  }
  const { password_hash: _h, ...safeUser } = user as { password_hash: string } & AuthUser;
  res.cookie('gsoc_auth', signToken(safeUser), COOKIE_OPTS).json(safeUser);
});

router.post('/logout', (_req, res: Response) => {
  res.clearCookie('gsoc_auth', { path: '/' }).json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json(req.user);
});

export default router;
