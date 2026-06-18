import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAdmin } from '../middleware/auth';

const router = Router();
router.use(requireAdmin);

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len = 8) {
  return Array.from({ length: len }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
}

// List all users
router.get('/users', async (_req, res: Response) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, created_at FROM users ORDER BY created_at ASC'
  );
  res.json(rows);
});

// Delete a user (cannot delete yourself)
router.delete('/users/:id', async (req: Request, res: Response) => {
  if (req.user!.id === req.params.id) {
    res.status(400).json({ error: 'You cannot delete your own account' }); return;
  }
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  if (!rowCount) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ ok: true });
});

// Get current signup code
router.get('/signup-code', async (_req, res: Response) => {
  const { rows: [row] } = await pool.query(
    "SELECT value FROM settings WHERE key = 'signup_code'"
  );
  res.json({ code: row?.value ?? null });
});

// Rotate the signup code
router.post('/signup-code/refresh', async (_req, res: Response) => {
  const code = randomCode();
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('signup_code', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [code]
  );
  res.json({ code });
});

export default router;
