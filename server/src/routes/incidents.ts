import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { wrap } from '../asyncWrap';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// ── Live sync ───────────────────────────────────────────────────────────────
// Incidents are a shared team workspace, so every editor needs to see other
// responders' changes as they happen — not just on their next page load. Each
// connected editor holds an SSE stream here; whenever an incident is upserted or
// deleted we fan the change out to all of them. Combined with the client's
// skip-if-locally-dirty merge, this collapses the window in which two people can
// unknowingly overwrite each other from "until someone reloads" to ~1 second.
const sseClients = new Set<Response>();

function broadcast(event: 'upsert' | 'delete', data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* disconnected — cleaned up on close */ }
  }
}

// GET /api/incidents/events — SSE stream of live incident changes (auth required).
router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25_000);

  sseClients.add(res);
  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

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
  broadcast('upsert', row.data);
  res.json(row.data);
}, 'incidents'));

router.put('/:id', wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    `UPDATE incidents SET data = $1, updated_at = NOW()
     WHERE id = $2 RETURNING data`,
    [JSON.stringify({ ...req.body, id: req.params.id }), req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Incident not found' }); return; }
  broadcast('upsert', row.data);
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
  broadcast('delete', { id: req.params.id });
  // Leave share_links rows in place — active ones stay accessible to current viewers
  // until they expire or are explicitly revoked.
  res.json({ ok: true });
}, 'incidents'));

export default router;
