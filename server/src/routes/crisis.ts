import { Router, Request, Response } from 'express';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../asyncWrap';

const router = Router();

// SSE client connections are transient (per-process); share state lives in DB.
const sseClients = new Map<string, Set<Response>>();

// ── Viewer password gate ──────────────────────────────────────────────────────
//
// Every new share link gets a generated password. Viewers send its SHA-256 hex
// as the ?k= wire key on the two public read paths (a query param because
// EventSource cannot send headers). The DB stores sha256(wire key) — a hash OF
// the credential, never the credential itself — so a database read (backup,
// dump, injection elsewhere) yields nothing directly replayable into ?k=.
// Legacy links with no password_hash stay open so existing shared URLs keep
// working.

const PW_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 — visually unambiguous
function generatePassword(len = 10): string {
  return Array.from({ length: len }, () => PW_ALPHA[randomInt(PW_ALPHA.length)]).join('');
}

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const hashEquals = (aHex: string, bHex: string): boolean => {
  const a = Buffer.from(aHex.toLowerCase(), 'utf8');
  const b = Buffer.from(bHex.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

function viewKeyOk(passwordHash: string | null, req: Request): boolean {
  if (!passwordHash) return true;
  const key = req.query.k;
  if (typeof key !== 'string') return false;
  // Current scheme: stored value is sha256(wire key). Also accept the wire key
  // matching the stored value directly — rows written by the brief first
  // deployment stored the wire key itself, and those links are already shared.
  return hashEquals(sha256Hex(key.toLowerCase()), passwordHash) || hashEquals(key, passwordHash);
}

// Self-heal for a dyno serving new code before the boot migration has managed
// to add the column (migrations run in the background and are allowed to fail
// without taking the process down): retry once after adding it in place.
const UNDEFINED_COLUMN = '42703';
async function withPasswordColumn<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err as { code?: string }).code !== UNDEFINED_COLUMN) throw err;
    console.warn('[crisis] share_links.password_hash missing — adding it now');
    await pool.query('ALTER TABLE share_links ADD COLUMN IF NOT EXISTS password_hash TEXT');
    return run();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
//
// Read paths (GET snapshot + GET events) are intentionally public so anyone with
// a share link can view the incident without an account. Every WRITE path —
// creating, updating, or revoking a link — requires auth: the share token alone
// must never be a write credential, or any viewer could overwrite the public
// situation report. Editors always call these from an authenticated session, so
// the same-origin auth cookie is sent automatically.

// POST /api/crisis/publish — create a new share link, returns token + url
router.post('/publish', requireAuth, wrap(async (req: Request, res: Response) => {
  const snapshot = req.body;
  if (!snapshot || typeof snapshot !== 'object') {
    res.status(400).json({ error: 'Body must be a JSON object' }); return;
  }
  const token = randomUUID();
  const incidentId: string | undefined = (snapshot as { incidentId?: string }).incidentId;
  // The plaintext password is returned once here, and the editor keeps it on
  // the incident's ShareLink entry (auth-only data) so the Share Links popup
  // can re-surface it. share_links itself stores sha256(sha256(password)) —
  // sha256(password) is the wire key viewers send, so the stored value can
  // verify a key without being usable as one.
  const password = generatePassword();
  await withPasswordColumn(() => pool.query(
    `INSERT INTO share_links (token, incident_id, snapshot, password_hash)
     VALUES ($1, $2, $3, $4)`,
    [token, incidentId ?? null, JSON.stringify(snapshot), sha256Hex(sha256Hex(password))]
  ));
  res.json({ token, url: `/?share=${token}`, password });
}, 'crisis'));

// PATCH /api/crisis/share/:token — push updated snapshot, notify SSE clients
router.patch('/share/:token', requireAuth, wrap(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rows: [row] } = await pool.query(
    'SELECT snapshot FROM share_links WHERE token = $1 AND active = TRUE',
    [token]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  const merged = { ...(row.snapshot as object), ...req.body, lastUpdated: new Date().toISOString() };
  // Snapshots can be MB-scale; stringify once and reuse for the UPDATE + SSE.
  const json = JSON.stringify(merged);
  await pool.query(
    'UPDATE share_links SET snapshot = $1 WHERE token = $2',
    [json, token]
  );

  const payload = `event: update\ndata: ${json}\n\n`;
  sseClients.get(token)?.forEach((client) => {
    try { client.write(payload); } catch { /* disconnected */ }
  });

  res.json({ ok: true });
}, 'crisis'));

// GET /api/crisis/share/:token — return current state snapshot (no account
// needed, but password-protected links require the ?k= view key)
router.get('/share/:token', wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await withPasswordColumn(() => pool.query(
    'SELECT snapshot, password_hash FROM share_links WHERE token = $1 AND active = TRUE',
    [req.params.token]
  ));
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  if (!viewKeyOk(row.password_hash, req)) {
    res.status(401).json({ error: 'Password required', passwordRequired: true }); return;
  }
  res.json(row.snapshot);
}, 'crisis'));

// DELETE /api/crisis/share/:token — revoke a share link
router.delete('/share/:token', requireAuth, wrap(async (req: Request, res: Response) => {
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
}, 'crisis'));

// GET /api/crisis/share/:token/events — SSE stream for live updates (no account
// needed, but password-protected links require the ?k= view key)
router.get('/share/:token/events', wrap(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rows: [row] } = await withPasswordColumn(() => pool.query(
    'SELECT snapshot, password_hash FROM share_links WHERE token = $1 AND active = TRUE',
    [token]
  ));
  if (!row) { res.status(404).end(); return; }
  if (!viewKeyOk(row.password_hash, req)) { res.status(401).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  // no-transform: stops compression middleware and intermediaries from
  // buffering the stream — buffered SSE events only arrive on refresh.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
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
}, 'crisis'));

export default router;
