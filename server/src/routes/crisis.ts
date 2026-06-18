import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const router = Router();

interface ShareRecord {
  state: unknown;
  clients: Set<Response>;
}

const shares = new Map<string, ShareRecord>();

// ── Persistence ───────────────────────────────────────────────────────────────
// Shares survive server restarts by persisting to a local JSON file.
// Only the state is persisted; SSE client connections are transient.

const DATA_DIR = join(__dirname, '..', '..', 'data');
const PERSIST_FILE = join(DATA_DIR, 'crisis-shares.json');

function loadPersistedShares() {
  try {
    if (!existsSync(PERSIST_FILE)) return;
    const raw = readFileSync(PERSIST_FILE, 'utf-8');
    const records = JSON.parse(raw) as Record<string, unknown>;
    for (const [token, state] of Object.entries(records)) {
      shares.set(token, { state, clients: new Set() });
    }
    console.log(`[crisis] loaded ${shares.size} persisted share(s)`);
  } catch (err) {
    console.warn('[crisis] could not load persisted shares:', err);
  }
}

function savePersistedShares() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const records: Record<string, unknown> = {};
    shares.forEach((record, token) => { records[token] = record.state; });
    // Write atomically: a partial/interrupted write must never leave a corrupt
    // file behind, because a failed JSON.parse on reload would wipe every share
    // (and turn all existing links into "share link not found").
    const tmp = `${PERSIST_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(records), 'utf-8');
    renameSync(tmp, PERSIST_FILE);
  } catch (err) {
    console.warn('[crisis] could not persist shares:', err);
  }
}

loadPersistedShares();

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/crisis/publish — create a new share link, returns token + url
router.post('/publish', (req: Request, res: Response) => {
  const state = req.body;
  if (!state || typeof state !== 'object') {
    res.status(400).json({ error: 'Body must be a JSON object' });
    return;
  }
  const token = randomUUID();
  shares.set(token, { state, clients: new Set() });
  savePersistedShares();
  res.json({ token, url: `/?share=${token}` });
});

// PATCH /api/crisis/share/:token — push updated state, notify SSE clients
router.patch('/share/:token', (req: Request, res: Response) => {
  const record = shares.get(req.params.token);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }

  record.state = { ...(record.state as object), ...req.body, lastUpdated: new Date().toISOString() };
  savePersistedShares();

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

// DELETE /api/crisis/share/:token — deactivate a share link permanently
router.delete('/share/:token', (req: Request, res: Response) => {
  const record = shares.get(req.params.token);
  if (!record) { res.status(404).json({ error: 'Not found' }); return; }

  // Notify connected viewers that the share has been revoked
  const payload = `event: revoked\ndata: {}\n\n`;
  record.clients.forEach((client) => {
    try { client.write(payload); client.end(); } catch { /* already gone */ }
  });

  shares.delete(req.params.token);
  savePersistedShares();
  res.json({ ok: true });
});

// GET /api/crisis/share/:token/events — SSE stream for live updates
router.get('/share/:token/events', (req: Request, res: Response) => {
  const record = shares.get(req.params.token);
  if (!record) { res.status(404).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify(record.state)}\n\n`);

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
