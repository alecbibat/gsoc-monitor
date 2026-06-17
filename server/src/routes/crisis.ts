import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

interface ShareRecord {
  state: unknown;
  clients: Set<Response>;
}

const shares = new Map<string, ShareRecord>();

// POST /api/crisis/publish — initial publish, returns token
router.post('/publish', (req: Request, res: Response) => {
  const state = req.body;
  if (!state || typeof state !== 'object') {
    res.status(400).json({ error: 'Body must be a JSON object' });
    return;
  }
  const token = randomUUID();
  shares.set(token, { state, clients: new Set() });
  res.json({ token, url: `/?share=${token}` });
});

// PATCH /api/crisis/share/:token — push updated state, notify SSE clients
router.patch('/share/:token', (req: Request, res: Response) => {
  const record = shares.get(req.params.token);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }

  record.state = { ...(record.state as object), ...req.body, lastUpdated: new Date().toISOString() };

  const payload = `event: update\ndata: ${JSON.stringify(record.state)}\n\n`;
  record.clients.forEach((client) => {
    try { client.write(payload); } catch { /* client disconnected */ }
  });

  res.json({ ok: true });
});

// GET /api/crisis/share/:token — return current state snapshot
router.get('/share/:token', (req: Request, res: Response) => {
  const record = shares.get(req.params.token);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(record.state);
});

// GET /api/crisis/share/:token/events — SSE stream
router.get('/share/:token/events', (req: Request, res: Response) => {
  const record = shares.get(req.params.token);
  if (!record) { res.status(404).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Send current state immediately on connect
  res.write(`event: connected\ndata: ${JSON.stringify(record.state)}\n\n`);

  // Keep-alive ping every 25 s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25_000);

  record.clients.add(res);

  req.on('close', () => {
    clearInterval(ping);
    record.clients.delete(res);
  });
});

export default router;
