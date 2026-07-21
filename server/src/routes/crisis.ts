import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// SSE client connections are transient (per-process); share state lives in DB.
const sseClients = new Map<string, Set<Response>>();

// ── Routes ────────────────────────────────────────────────────────────────────
//
// Read paths (GET snapshot + GET events) are intentionally public so anyone with
// a share link can view the incident without an account. Every WRITE path —
// creating, updating, or revoking a link — requires auth: the share token alone
// must never be a write credential, or any viewer could overwrite the public
// situation report. Editors always call these from an authenticated session, so
// the same-origin auth cookie is sent automatically.

// POST /api/crisis/publish — create a new share link, returns token + url
router.post('/publish', requireAuth, async (req: Request, res: Response) => {
  const snapshot = req.body;
  if (!snapshot || typeof snapshot !== 'object') {
    res.status(400).json({ error: 'Body must be a JSON object' }); return;
  }
  const token = randomUUID();
  const incidentId: string | undefined = (snapshot as { incidentId?: string }).incidentId;
  await pool.query(
    `INSERT INTO share_links (token, incident_id, snapshot)
     VALUES ($1, $2, $3)`,
    [token, incidentId ?? null, JSON.stringify(snapshot)]
  );
  res.json({ token, url: `/?share=${token}` });
});

// PATCH /api/crisis/share/:token — push updated snapshot, notify SSE clients
router.patch('/share/:token', requireAuth, async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rows: [row] } = await pool.query(
    'SELECT snapshot FROM share_links WHERE token = $1 AND active = TRUE',
    [token]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const merged = { ...(row.snapshot as object), ...req.body, lastUpdated: new Date().toISOString() };
  await pool.query(
    'UPDATE share_links SET snapshot = $1 WHERE token = $2',
    [JSON.stringify(merged), token]
  );

  const payload = `event: update\ndata: ${JSON.stringify(merged)}\n\n`;
  sseClients.get(token)?.forEach((client) => {
    try { client.write(payload); } catch { /* disconnected */ }
  });

  res.json({ ok: true });
});

// GET /api/crisis/share/:token — return current state snapshot (no auth required)
router.get('/share/:token', async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    'SELECT snapshot FROM share_links WHERE token = $1 AND active = TRUE',
    [req.params.token]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row.snapshot);
});

// DELETE /api/crisis/share/:token — revoke a share link
router.delete('/share/:token', requireAuth, async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    'SELECT 1 FROM share_links WHERE token = $1',
    [req.params.token]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  await pool.query('UPDATE share_links SET active = FALSE WHERE token = $1', [req.params.token]);

  const payload = `event: revoked\ndata: {}\n\n`;
  sseClients.get(req.params.token)?.forEach((client) => {
    try { client.write(payload); client.end(); } catch { /* gone */ }
  });
  sseClients.delete(req.params.token);

  res.json({ ok: true });
});

// GET /api/crisis/share/:token/events — SSE stream for live updates (no auth required)
router.get('/share/:token/events', async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rows: [row] } = await pool.query(
    'SELECT snapshot FROM share_links WHERE token = $1 AND active = TRUE',
    [token]
  );
  if (!row) { res.status(404).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify(row.snapshot)}\n\n`);

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25_000);

  if (!sseClients.has(token)) sseClients.set(token, new Set());
  sseClients.get(token)!.add(res);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.get(token)?.delete(res);
    if (sseClients.get(token)?.size === 0) sseClients.delete(token);
  });
});

export default router;
