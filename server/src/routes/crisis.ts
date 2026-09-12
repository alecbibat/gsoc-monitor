import { Router, Request, Response } from 'express';
import { createHash, randomInt, randomUUID } from 'crypto';
import { pool } from '../db';
import { requireAuth, readAuthUser } from '../middleware/auth';
import { decideShareAccess, type ShareGateResult } from '../shareAccess';
import { getShareFallback } from '../shareFallbackStore';
import { wrap } from '../asyncWrap';
import { normalizeIncidentTypeId } from '../incidentTaxonomy';
import { applyChecklistToggle, cleanActor, invalidToggleReason, type ChecklistItemState } from '../checklist';
import { broadcastIncident } from './incidentBus';
import { findIapForType, sendPdf } from './iap';

const router = Router();

// SSE client connections are transient (per-process); share state lives in DB.
const sseClients = new Map<string, Set<Response>>();

// ── Viewer gate ───────────────────────────────────────────────────────────────
//
// Share links used to be readable by anyone holding the URL (plus the generated
// password, on newer links). They now require a signed-in account — SSO or
// email+password — so every view of an incident snapshot is attributable.
//
// The link password remains as a break-glass path, DISABLED by default. An
// admin opens a time-boxed window (settings.share_password_fallback) when the
// IdP is down or SSO is otherwise unavailable, which is exactly the outage
// during which a GSOC still needs to push a situation report out. The wire
// format is unchanged: viewers send sha256(password) as ?k= (a query param
// because EventSource cannot set headers), and the DB stores sha256 of THAT,
// so a database dump yields nothing replayable.

const PW_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 — visually unambiguous
function generatePassword(len = 10): string {
  return Array.from({ length: len }, () => PW_ALPHA[randomInt(PW_ALPHA.length)]).join('');
}

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function gateShare(req: Request, passwordHash: string | null): Promise<ShareGateResult> {
  const user = readAuthUser(req);
  const { active } = await getShareFallback();
  return decideShareAccess({
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    passwordHash,
    wireKey: typeof req.query.k === 'string' ? req.query.k : null,
    fallbackActive: active,
  });
}

/**
 * Answer a refused viewer. `passwordRequired` is retained alongside the newer
 * fields so a share tab left open across this deploy still renders its password
 * prompt instead of a blank error.
 */
function denyShare(res: Response, gate: Extract<ShareGateResult, { ok: false }>): void {
  res.status(401).json({
    error: gate.passwordAccepted ? 'Password required' : 'Sign in required',
    loginRequired: true,
    passwordRequired: gate.passwordAccepted,
    passwordAccepted: gate.passwordAccepted,
    badPassword: gate.badPassword,
  });
}

/** Record who opened the link — a security control and the AAR's reach metric. */
function logShareAccess(token: string, req: Request, gate: Extract<ShareGateResult, { ok: true }>): void {
  const viewer = gate.via === 'session' ? gate.viewer : null;
  pool.query(
    `INSERT INTO share_access_log (token, ip, user_agent, user_id, user_email, via)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      token,
      req.ip ?? null,
      (req.headers['user-agent'] ?? '').slice(0, 300) || null,
      viewer?.id ?? null,
      viewer?.email ?? null,
      gate.via,
    ]
  ).catch((e) => console.warn('[crisis] access log insert failed:', e?.message ?? e));
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
// Read paths (GET snapshot + GET events) require a signed-in account, with the
// link password as an admin-enabled break-glass (see the viewer gate above).
// Every WRITE path — creating, updating, or revoking a link — additionally
// requires requireAuth: the share token alone must never be a write credential,
// or any viewer could overwrite the public situation report. Editors always
// call these from an authenticated session, so the same-origin auth cookie is
// sent automatically.

// A link serves viewers only while active AND unexpired (W4). expires_at NULL
// covers the moment between deploy and the boot migration's backfill — treated
// as live so existing links don't flap during a deploy.
const LIVE = 'active = TRUE AND (expires_at IS NULL OR expires_at > NOW())';
const TTL_SQL = "NOW() + interval '72 hours'";

// Closure payload for a viewer opening a revoked/expired link: a stand-down
// page instead of a dead 404 — the incident's name, final status, and summary
// (still behind the link's password gate).
function gonePayload(row: {
  snapshot: Record<string, unknown>; active: boolean; expires_at: Date | null; revoked_at: Date | null;
}) {
  const snap = row.snapshot ?? {};
  return {
    gone: true,
    reason: row.active ? 'expired' : 'revoked',
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    incidentName: snap.incidentName ?? null,
    incidentStatus: snap.incidentStatus ?? null,
    executiveSummary: snap.executiveSummary ?? null,
    lastUpdated: snap.lastUpdated ?? null,
  };
}

// POST /api/crisis/publish — create a new share link, returns token + url
router.post('/publish', requireAuth, wrap(async (req: Request, res: Response) => {
  const snapshot = req.body;
  if (!snapshot || typeof snapshot !== 'object') {
    res.status(400).json({ error: 'Body must be a JSON object' }); return;
  }
  const token = randomUUID();
  const incidentId: string | undefined = (snapshot as { incidentId?: string }).incidentId;
  const rawLabel = (snapshot as { label?: unknown }).label;
  const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim().slice(0, 80) : null;
  // The plaintext password is returned once here, and the editor keeps it on
  // the incident's ShareLink entry (auth-only data) so the Share Links popup
  // can re-surface it. share_links itself stores sha256(sha256(password)) —
  // sha256(password) is the wire key viewers send, so the stored value can
  // verify a key without being usable as one.
  const password = generatePassword();
  // The incident row is the source of truth for checklist state (share-side
  // toggles land there first), so a NEW link snapshots the row's map rather
  // than the editor's possibly-stale copy in the request body.
  if (incidentId) {
    const { rows: [incRow] } = await pool.query(
      `SELECT data->'checklists' AS checklists FROM incidents WHERE id = $1`,
      [incidentId]
    );
    if (incRow?.checklists && typeof incRow.checklists === 'object') {
      (snapshot as Record<string, unknown>).checklists = incRow.checklists;
    }
  }
  const { rows: [ins] } = await withPasswordColumn(() => pool.query(
    `INSERT INTO share_links (token, incident_id, snapshot, password_hash, label, expires_at)
     VALUES ($1, $2, $3, $4, $5, ${TTL_SQL})
     RETURNING expires_at`,
    [token, incidentId ?? null, JSON.stringify(snapshot), sha256Hex(sha256Hex(password)), label]
  ));
  res.json({ token, url: `/?share=${token}`, password, label, expiresAt: ins.expires_at });
}, 'crisis'));

// PATCH /api/crisis/share/:token — push updated snapshot, notify SSE clients
router.patch('/share/:token', requireAuth, wrap(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rows: [row] } = await pool.query(
    `SELECT snapshot FROM share_links WHERE token = $1 AND ${LIVE}`,
    [token]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  // The checklist map is owned by the per-item toggle endpoints (which update
  // every live snapshot themselves): a viewer's check must not be clobbered by
  // the editor's next debounced auto-publish carrying a stale copy. The one
  // exception is a snapshot that has no map yet (link published before the
  // feature) — the first PATCH seeds it.
  const prevChecklists = (row.snapshot as { checklists?: unknown })?.checklists;
  const merged = {
    ...(row.snapshot as object),
    ...req.body,
    ...(prevChecklists !== undefined ? { checklists: prevChecklists } : {}),
    lastUpdated: new Date().toISOString(),
  };
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
// needed, but password-protected links require the ?k= view key). A revoked
// or expired link answers 410 with a closure summary — an exec opening the
// link the morning after stand-down gets an answer, not a broken page.
router.get('/share/:token', wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await withPasswordColumn(() => pool.query(
    `SELECT snapshot, password_hash, active, expires_at, revoked_at,
            (${LIVE}) AS live
     FROM share_links WHERE token = $1`,
    [req.params.token]
  ));
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const gate = await gateShare(req, row.password_hash);
  if (!gate.ok) { denyShare(res, gate); return; }
  if (!row.live) { res.status(410).json(gonePayload(row)); return; }
  logShareAccess(req.params.token, req, gate);
  res.json(row.snapshot);
}, 'crisis'));

// GET /api/crisis/share/:token/access — editor-side access stats. Now that
// viewers sign in, "who read the situation report" is answerable by name, not
// just by a count of distinct IPs.
router.get('/share/:token/access', requireAuth, wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COUNT(DISTINCT ip)::int AS viewers,
            COUNT(DISTINCT user_id)::int AS accounts,
            COUNT(*) FILTER (WHERE via = 'link-password')::int AS anonymous,
            MAX(at) AS last_at
     FROM share_access_log WHERE token = $1`,
    [req.params.token]
  );
  const { rows: named } = await pool.query(
    `SELECT user_email AS email, MAX(at) AS last_at, COUNT(*)::int AS opens
     FROM share_access_log
     WHERE token = $1 AND user_email IS NOT NULL
     GROUP BY user_email
     ORDER BY MAX(at) DESC
     LIMIT 50`,
    [req.params.token]
  );
  res.json({
    count: row.count,
    viewers: row.viewers,
    accounts: row.accounts,
    anonymous: row.anonymous,
    lastAt: row.last_at,
    named,
  });
}, 'crisis'));

// POST /api/crisis/share/:token/renew — extend a live link by another TTL window
router.post('/share/:token/renew', requireAuth, wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    `UPDATE share_links SET expires_at = ${TTL_SQL}
     WHERE token = $1 AND active = TRUE
     RETURNING expires_at`,
    [req.params.token]
  );
  if (!row) { res.status(404).json({ error: 'Not found or revoked' }); return; }
  res.json({ expiresAt: row.expires_at });
}, 'crisis'));

// Revoke one token: flip the row and close any connected viewers (they refetch
// and land on the 410 closure page).
async function revokeToken(token: string): Promise<void> {
  await pool.query(
    'UPDATE share_links SET active = FALSE, revoked_at = NOW() WHERE token = $1',
    [token]
  );
  const payload = `event: revoked\ndata: {}\n\n`;
  sseClients.get(token)?.forEach((client) => {
    try { client.write(payload); client.end(); } catch { /* gone */ }
  });
  sseClients.delete(token);
}

/**
 * Revoke every live share link belonging to an incident. Called when an
 * incident is deleted — links must not keep serving a snapshot of a record
 * that no longer exists.
 */
export async function revokeShareLinksForIncident(incidentId: string): Promise<number> {
  const { rows } = await pool.query<{ token: string }>(
    'SELECT token FROM share_links WHERE incident_id = $1 AND active = TRUE',
    [incidentId]
  );
  for (const { token } of rows) await revokeToken(token);
  return rows.length;
}

// DELETE /api/crisis/share/:token — revoke a share link
router.delete('/share/:token', requireAuth, wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    'SELECT 1 FROM share_links WHERE token = $1',
    [req.params.token]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  await revokeToken(req.params.token);
  res.json({ ok: true });
}, 'crisis'));

// ── Share-side checklist + IAP ────────────────────────────────────────────────
//
// These two routes are the deliberate, narrow exceptions to "the share token is
// never a write credential / snapshots are the only public read": the checklist
// toggle writes exactly one bounded map entry on the parent incident (nothing
// else is reachable), and the IAP route reads a pre-uploaded reference PDF.
// Both are gated exactly like the snapshot: token + ?k= view key + LIVE.

/**
 * Push a fresh checklist map into every live snapshot of an incident and fan
 * it out to connected viewers. Toggles bypass the editor's auto-publish (which
 * only runs while an editor has the incident open), so the toggle endpoints
 * call this directly.
 */
export async function updateShareChecklists(
  incidentId: string,
  checklists: Record<string, ChecklistItemState>
): Promise<void> {
  const { rows } = await pool.query<{ token: string; snapshot: Record<string, unknown> }>(
    `SELECT token, snapshot FROM share_links WHERE incident_id = $1 AND ${LIVE}`,
    [incidentId]
  );
  const lastUpdated = new Date().toISOString();
  for (const { token, snapshot } of rows) {
    const json = JSON.stringify({ ...(snapshot as object), checklists, lastUpdated });
    await pool.query('UPDATE share_links SET snapshot = $1 WHERE token = $2', [json, token]);
    const payload = `event: update\ndata: ${json}\n\n`;
    sseClients.get(token)?.forEach((client) => {
      try { client.write(payload); } catch { /* disconnected */ }
    });
  }
}

// POST /api/crisis/share/:token/checklist/:itemId — check or uncheck one item
// from the share page. Body: { checked: boolean, by?: string }. The timestamp
// is stamped server-side; the response carries the authoritative map.
router.post('/share/:token/checklist/:itemId', wrap(async (req: Request, res: Response) => {
  const { token, itemId } = req.params;
  const invalid = invalidToggleReason(itemId, req.body);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const { rows: [row] } = await withPasswordColumn(() => pool.query(
    `SELECT incident_id, snapshot, password_hash, active, expires_at, revoked_at,
            (${LIVE}) AS live
     FROM share_links WHERE token = $1`,
    [token]
  ));
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const gate = await gateShare(req, row.password_hash);
  if (!gate.ok) { denyShare(res, gate); return; }
  if (!row.live) { res.status(410).json(gonePayload(row)); return; }
  if (!row.incident_id) {
    // Pre-W4 links were published without an incident id — there is no parent
    // record to write to, so the checklist stays read-only on those.
    res.status(409).json({ error: 'Checklist is read-only on this link' }); return;
  }

  const body = req.body as { checked: boolean; by?: unknown };
  // A signed-in viewer's account name outranks the self-typed one the share
  // page used to rely on: the toggle lands in the incident's audit trail, and
  // an attested identity is worth more there than a text box.
  const by = (gate.via === 'session' ? gate.viewer.name : null) ?? cleanActor(body.by) ?? 'Share viewer';
  const result = await applyChecklistToggle(row.incident_id, itemId, body.checked, by);
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  if (result.changed) {
    broadcastIncident('upsert', result.incident);
    // The toggle is committed — a fanout hiccup must not read as a failure.
    await updateShareChecklists(row.incident_id, result.checklists).catch((e) =>
      console.warn('[crisis] share checklist fanout failed:', e?.message ?? e)
    );
  }
  res.json({ checklists: result.checklists });
}, 'crisis'));

// GET /api/crisis/share/:token/iap — the Incident Action Plan PDF for this
// incident's type (fallback: the general default document). Same gate as the
// snapshot; 404 with { noIap: true } when nothing is uploaded.
router.get('/share/:token/iap', wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await withPasswordColumn(() => pool.query(
    `SELECT snapshot, password_hash, active, expires_at, revoked_at,
            (${LIVE}) AS live
     FROM share_links WHERE token = $1`,
    [req.params.token]
  ));
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  const gate = await gateShare(req, row.password_hash);
  if (!gate.ok) { denyShare(res, gate); return; }
  if (!row.live) { res.status(410).json(gonePayload(row)); return; }
  const rawType = (row.snapshot as { incidentType?: unknown })?.incidentType;
  const doc = await findIapForType(normalizeIncidentTypeId(typeof rawType === 'string' ? rawType : null));
  if (!doc) { res.status(404).json({ error: 'No IAP uploaded for this incident type', noIap: true }); return; }
  sendPdf(res, doc.name, doc.content, doc.updated_at);
}, 'crisis'));

// GET /api/crisis/share/:token/events — SSE stream for live updates (no account
// needed, but password-protected links require the ?k= view key)
router.get('/share/:token/events', wrap(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rows: [row] } = await withPasswordColumn(() => pool.query(
    `SELECT snapshot, password_hash FROM share_links WHERE token = $1 AND ${LIVE}`,
    [token]
  ));
  if (!row) { res.status(404).end(); return; }
  // EventSource sends the session cookie automatically on same-origin requests,
  // so a signed-in viewer's stream authenticates the same way the snapshot did.
  const gate = await gateShare(req, row.password_hash);
  if (!gate.ok) { res.status(401).end(); return; }

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
