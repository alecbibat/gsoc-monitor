import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { wrap } from '../asyncWrap';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// All incidents are shared across the team workspace.
router.get('/', wrap(async (_req, res: Response) => {
  const { rows } = await pool.query(
    'SELECT data FROM incidents ORDER BY created_at ASC'
  );
  res.json(rows.map((r) => r.data));
}, 'incidents'));

// Upsert an incident (client generates stable IDs, so POST and PUT are the same).
router.post('/', wrap(async (req: Request, res: Response) => {
  const incident = req.body;
  if (!incident?.id) { res.status(400).json({ error: 'id is required' }); return; }
  const { rows: [row] } = await pool.query(
    `INSERT INTO incidents (id, data)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
     RETURNING data`,
    [incident.id, JSON.stringify(incident)]
  );
  res.json(row.data);
}, 'incidents'));

router.put('/:id', wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    `UPDATE incidents SET data = $1, updated_at = NOW()
     WHERE id = $2 RETURNING data`,
    [JSON.stringify({ ...req.body, id: req.params.id }), req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Incident not found' }); return; }
  res.json(row.data);
}, 'incidents'));

router.delete('/:id', wrap(async (req: Request, res: Response) => {
  // Archived incidents can only be deleted by admins.
  const { rows: [row] } = await pool.query<{ archived_at: string | null }>(
    `SELECT data->>'archivedAt' AS archived_at FROM incidents WHERE id = $1`,
    [req.params.id]
  );
  if (row?.archived_at) {
    const user = (req as Request & { user?: { role: string } }).user;
    if (user?.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can delete archived incidents' });
      return;
    }
  }
  await pool.query('DELETE FROM incidents WHERE id = $1', [req.params.id]);
  // Leave share_links rows in place — active ones stay accessible to current viewers
  // until they expire or are explicitly revoked.
  res.json({ ok: true });
}, 'incidents'));

export default router;
