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
import { findIapForScope, sendPdf } from './iap';
import { loadEffectiveConfig } from '../crisisTemplates/store';
import { checklistItemApplies, shareTemplatesConfig } from '../crisisTemplates/effective';

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

interface ShareRow {
  incident_id: string | null;
  snapshot: Record<string, unknown>;
  password_hash: string | null;
  active: boolean;
  expires_at: Date | null;
  revoked_at: Date | null;
  live: boolean;
}

/**
 * The viewer-side read gate every share read path shares: load the link,
 * check the viewer (session or break-glass key), refuse a dead link with the
 * closure payload. Answers 404 / 401 / 410 itself and returns null; otherwise
 * the live row and how the viewer got in.
 */
async function openLiveShare(
  req: Request, res: Response, token: string
): Promise<{ row: ShareRow; gate: Extract<ShareGateResult, { ok: true }> } | null> {
  const { rows: [row] } = await withPasswordColumn(() => pool.query<ShareRow>(
    `SELECT incident_id, snapshot, password_hash, active, expires_at, revoked_at,
            (${LIVE}) AS live
     FROM share_links WHERE token = $1`,
    [token]
  ));
  if (!row) { res.status(404).json({ error: 'Not found' }); return null; }
  const gate = await gateShare(req, row.password_hash);
  if (!gate.ok) { denyShare(res, gate); return null; }
  if (!row.live) { res.status(410).json(gonePayload(row)); return null; }
  return { row, gate };
}

/** The incident type (normalized) and property a share snapshot resolves templates / the IAP for. */
function snapshotScope(snapshot: Record<string, unknown> | null): { incidentType: string; propertyId: string | null } {
  const rawType = snapshot?.incidentType;
  const rawProp = snapshot?.locationGroupId;
  return {
    incidentType: normalizeIncidentTypeId(typeof rawType === 'string' ? rawType : null),
    propertyId: typeof rawProp === 'string' && rawProp ? rawProp : null,
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
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    res.status(400).json({ error: 'Body must be a JSON object' }); return;
  }

  // The checklist map is owned by the per-item toggle endpoints (which update
  // every live snapshot themselves): a viewer's check must not be clobbered by
  // the editor's next debounced auto-publish carrying a stale copy. The one
  // exception is a snapshot that has no map yet (link published before the
  // feature) — the first PATCH seeds it.
  //
  // ONE statement, merged in the database — never read, merge in JS, write
  // back: a toggle's fanout (updateShareChecklists) landing between the read
  // and the write was overwritten by the map this request had read, and
  // viewers saw the item uncheck. Under READ COMMITTED an UPDATE that meets a
  // concurrent write to its row re-evaluates SET against the NEWEST version,
  // so `snapshot->'checklists'` here is always the latest map.
  const { rows: [row] } = await pool.query<{ json: string }>(
    `UPDATE share_links
        SET snapshot = (snapshot || $1::jsonb) || CASE
              WHEN snapshot ? 'checklists'
                THEN jsonb_build_object('checklists', snapshot->'checklists', 'lastUpdated', $3::text)
              ELSE jsonb_build_object('lastUpdated', $3::text)
            END
      WHERE token = $2 AND ${LIVE}
      RETURNING snapshot::text AS json`,
    [JSON.stringify(req.body), token, new Date().toISOString()]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }

  // Snapshots can be MB-scale: the stored text goes straight to the viewers.
  const payload = `event: update\ndata: ${row.json}\n\n`;
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
  const open = await openLiveShare(req, res, req.params.token);
  if (!open) return;
  logShareAccess(req.params.token, req, open.gate);
  res.json(open.row.snapshot);
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
 *
 * Runs under the incident row's lock (the same one applyChecklistToggle
 * takes) and fans out the map as the row holds it NOW, not the caller's copy:
 * two toggles' fanouts used to be able to finish out of order and leave the
 * older map on the share page. `checklists` is only the fallback for an
 * incident row that is gone. Each snapshot is merged in one UPDATE (see the
 * PATCH route), so a concurrent auto-publish can't be overwritten either.
 */
export async function updateShareChecklists(
  incidentId: string,
  checklists: Record<string, ChecklistItemState>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inc] } = await client.query<{ checklists: unknown }>(
      `SELECT data->'checklists' AS checklists FROM incidents WHERE id = $1 FOR UPDATE`,
      [incidentId]
    );
    const current = inc?.checklists;
    const map = current && typeof current === 'object' && !Array.isArray(current) ? current : checklists;
    const { rows } = await client.query<{ token: string; json: string }>(
      `UPDATE share_links
          SET snapshot = snapshot || jsonb_build_object('checklists', $2::jsonb, 'lastUpdated', $3::text)
        WHERE incident_id = $1 AND ${LIVE}
        RETURNING token, snapshot::text AS json`,
      [incidentId, JSON.stringify(map), new Date().toISOString()]
    );
    // Pushed while the lock still orders fanouts, so viewers get them in the
    // order they were written. Nothing untrue can reach them if the COMMIT
    // then fails: the map was read from the (committed) incident row.
    for (const { token, json } of rows) {
      const payload = `event: update\ndata: ${json}\n\n`;
      sseClients.get(token)?.forEach((c) => {
        try { c.write(payload); } catch { /* disconnected */ }
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* connection already gone */ });
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/crisis/share/:token/checklist/:itemId — check or uncheck one item
// from the share page. Body: { checked: boolean, by?: string }. The timestamp
// is stamped server-side; the response carries the authoritative map.
router.post('/share/:token/checklist/:itemId', wrap(async (req: Request, res: Response) => {
  const { token, itemId } = req.params;
  const invalid = invalidToggleReason(itemId, req.body);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const open = await openLiveShare(req, res, token);
  if (!open) return;
  const { row, gate } = open;
  if (!row.incident_id) {
    // Pre-W4 links were published without an incident id — there is no parent
    // record to write to, so the checklist stays read-only on those.
    res.status(409).json({ error: 'Checklist is read-only on this link' }); return;
  }
  // Only the lines the share page shows as live may be toggled from it (its
  // retired items are read-only). Unlike the signed-in toggle, an id outside
  // the blocks that apply to the snapshot's type + property is refused: the
  // templates route below returns the text of any stored id another scope
  // owns, so it would read out that scope's checklist and plant a fake entry
  // in the incident.
  const { incidentType, propertyId } = snapshotScope(row.snapshot);
  if (!checklistItemApplies(await loadEffectiveConfig(), incidentType, propertyId, itemId)) {
    res.status(409).json({ error: 'That item is not on this incident\'s current checklist — reload to see the latest' }); return;
  }

  const body = req.body as { checked: boolean; by?: unknown };
  // A signed-in viewer's account name outranks the self-typed one the share
  // page used to rely on: the toggle lands in the incident's audit trail, and
  // an attested identity is worth more there than a text box. Both go through
  // cleanActor: a blank or control-character account name falls through.
  const by = cleanActor(gate.via === 'session' ? gate.viewer.name : undefined) ?? cleanActor(body.by) ?? 'Share viewer';
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

// GET /api/crisis/share/:token/iap — the Incident Action Plan PDF that best
// fits this incident (type + property, then type, then property, then the
// general default — iap.ts). Same gate as the snapshot; 404 with
// { noIap: true } when nothing applies.
router.get('/share/:token/iap', wrap(async (req: Request, res: Response) => {
  const open = await openLiveShare(req, res, req.params.token);
  if (!open) return;
  const { incidentType, propertyId } = snapshotScope(open.row.snapshot);
  const doc = await findIapForScope(incidentType, propertyId);
  if (!doc) { res.status(404).json({ error: 'No IAP uploaded for this incident', noIap: true }); return; }
  sendPdf(res, doc.name, doc.content, doc.updated_at);
}, 'crisis'));

// GET /api/crisis/share/:token/templates — the checklist / intake templates
// this incident resolves to, for the share page's Checklists and Intake tabs.
// Same gate as the snapshot. Only the blocks that apply to the snapshot's
// type + property are sent (a viewer has no business reading every scope's
// content, nor the names of the admins who edited them), plus the text of
// any state the incident holds for lines it no longer resolves to — so that
// record stays readable on the share page too.
router.get('/share/:token/templates', wrap(async (req: Request, res: Response) => {
  const open = await openLiveShare(req, res, req.params.token);
  if (!open) return;
  const snap = open.row.snapshot ?? {};
  const { incidentType, propertyId } = snapshotScope(snap);
  const config = await loadEffectiveConfig();
  res.setHeader('Cache-Control', 'no-store');
  res.json(shareTemplatesConfig(config, incidentType, propertyId, snap.checklists, snap.intake));
}, 'crisis'));

/**
 * An admin changed the templates: tell every connected share viewer, so an
 * open share page can refetch its checklist / intake (`templates` event; no
 * payload — each viewer's own fetch goes through its gate).
 */
export function broadcastShareTemplates(): void {
  const payload = `event: templates\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
  for (const clients of sseClients.values()) {
    for (const client of clients) {
      try { client.write(payload); } catch { /* disconnected */ }
    }
  }
}

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
  // The viewer may have disconnected during the awaits above. Its 'close'
  // event has then already fired, so the listener registered below would
  // never run and the ping interval + sseClients entry would leak forever.
  if (res.destroyed || req.socket?.destroyed) return;

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
