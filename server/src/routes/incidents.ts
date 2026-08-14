import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { wrap } from '../asyncWrap';
import { requireAuth } from '../middleware/auth';
import { invalidIncidentReason, invalidLogEntryReason, ACTION_ENTRY_TYPES } from '../incidentTaxonomy';
import { revokeShareLinksForIncident } from './crisis';

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
  // no-transform: stops compression middleware and intermediaries from
  // buffering the stream — buffered SSE events only arrive on refresh.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
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
//
// Both write paths preserve the row's EXISTING actionLog: the log is
// append-only and owned by the /:id/log endpoints below, so a whole-blob
// last-write-wins update must never be able to erase entries another
// responder appended concurrently. A brand-new row takes the client's log
// (it seeds the incident's initial entries).
router.post('/', wrap(async (req: Request, res: Response) => {
  const incident = req.body;
  const invalid = invalidIncidentReason(incident);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const { rows: [row] } = await pool.query(
    `INSERT INTO incidents (id, data)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET
       data = EXCLUDED.data || jsonb_build_object(
         'actionLog',
         COALESCE(incidents.data->'actionLog', EXCLUDED.data->'actionLog', '[]'::jsonb)
       ),
       updated_at = NOW()
     RETURNING data`,
    [incident.id, JSON.stringify(incident)]
  );
  broadcast('upsert', row.data);
  res.json(row.data);
}, 'incidents'));

router.put('/:id', wrap(async (req: Request, res: Response) => {
  // Validate the same shape POST stores — the URL id wins over any body id.
  const incident = { ...req.body, id: req.params.id };
  const invalid = invalidIncidentReason(incident);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  const { rows: [row] } = await pool.query(
    `UPDATE incidents SET
       data = $1::jsonb || jsonb_build_object(
         'actionLog',
         COALESCE(incidents.data->'actionLog', $1::jsonb->'actionLog', '[]'::jsonb)
       ),
       updated_at = NOW()
     WHERE id = $2 RETURNING data`,
    [JSON.stringify(incident), req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Incident not found' }); return; }
  broadcast('upsert', row.data);
  res.json(row.data);
}, 'incidents'));

// ── Action log (append-only sync path) ──────────────────────────────────────
// Log entries never travel inside the blob writes above. Each mutation locks
// the incident row, applies the change to the JSONB in place, and broadcasts
// the merged incident — concurrent appends from different operators serialize
// on the row lock instead of overwriting each other.

type LogMutResult = 'changed' | 'noop' | 'missing' | 'forbidden';

async function mutateIncidentLog(
  incidentId: string,
  res: Response,
  fn: (data: Record<string, unknown>) => LogMutResult
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [row] } = await client.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM incidents WHERE id = $1 FOR UPDATE',
      [incidentId]
    );
    if (!row) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    const data = row.data;
    const result = fn(data);
    if (result === 'missing') {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Log entry not found' });
      return;
    }
    if (result === 'forbidden') {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'System entries are immutable' });
      return;
    }
    if (result === 'changed') {
      await client.query(
        'UPDATE incidents SET data = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(data), incidentId]
      );
    }
    await client.query('COMMIT');
    if (result === 'changed') broadcast('upsert', data);
    res.json(data);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* connection already gone */ });
    throw err;
  } finally {
    client.release();
  }
}

const logOf = (data: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(data.actionLog) ? (data.actionLog as Record<string, unknown>[]) : [];

// Append an entry (idempotent by entry id — retries must not duplicate).
router.post('/:id/log', wrap(async (req: Request, res: Response) => {
  const entry = req.body;
  const invalid = invalidLogEntryReason(entry);
  if (invalid) { res.status(400).json({ error: invalid }); return; }
  await mutateIncidentLog(req.params.id, res, (data) => {
    const log = logOf(data);
    if (log.some((e) => e?.id === entry.id)) return 'noop';
    data.actionLog = [entry, ...log];
    return 'changed';
  });
}, 'incidents'));

// Edit an entry's editable fields. `null` clears an optional field.
router.patch('/:id/log/:entryId', wrap(async (req: Request, res: Response) => {
  const patch = req.body ?? {};
  if (patch.entryType !== undefined && !ACTION_ENTRY_TYPES.has(patch.entryType)) {
    res.status(400).json({ error: `unknown entryType ${JSON.stringify(patch.entryType)}` });
    return;
  }
  for (const key of ['description', 'attachmentName', 'attachmentData'] as const) {
    if (patch[key] !== undefined && patch[key] !== null && typeof patch[key] !== 'string') {
      res.status(400).json({ error: `${key} must be a string or null` });
      return;
    }
  }
  await mutateIncidentLog(req.params.id, res, (data) => {
    const log = logOf(data);
    const idx = log.findIndex((e) => e?.id === req.params.entryId);
    if (idx === -1) return 'missing';
    // Auto-generated audit events are tamper-evident: the client hides the
    // affordance, and the server enforces it.
    if (log[idx].system) return 'forbidden';
    const entry = { ...log[idx] };
    for (const key of ['description', 'entryType', 'attachmentName', 'attachmentData'] as const) {
      if (patch[key] === undefined) continue;
      if (patch[key] === null) delete entry[key];
      else entry[key] = patch[key];
    }
    data.actionLog = [...log.slice(0, idx), entry, ...log.slice(idx + 1)];
    return 'changed';
  });
}, 'incidents'));

// Remove an entry (idempotent — deleting an absent entry is a no-op).
router.delete('/:id/log/:entryId', wrap(async (req: Request, res: Response) => {
  await mutateIncidentLog(req.params.id, res, (data) => {
    const log = logOf(data);
    const next = log.filter((e) => e?.id !== req.params.entryId);
    if (next.length === log.length) return 'noop';
    data.actionLog = next;
    return 'changed';
  });
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
  // A deleted incident's links must not keep serving its last snapshot forever
  // (they used to). Viewers land on the closure page instead.
  const revoked = await revokeShareLinksForIncident(req.params.id).catch((e) => {
    console.warn('[incidents] share-link revocation on delete failed:', e?.message ?? e);
    return 0;
  });
  res.json({ ok: true, revokedShareLinks: revoked });
}, 'incidents'));

export default router;
