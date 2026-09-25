import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { wrap } from '../asyncWrap';
import { normalizeIncidentTypeId } from '../incidentTaxonomy';
import { CANONICAL_TYPE_IDS } from '../crisisTemplates/validate';
import { TEMPLATE_ID_RE } from '../crisisTemplates/types';

// ── Incident Action Plan documents ───────────────────────────────────────────
//
// Pre-uploaded IAP PDFs, served into the editor's and the share link's IAP
// tabs. A document is filed under a SCOPE — an incident type, a property
// (LOCATION_GROUPS id, or the 'windstar-ships' fleet), both, or neither (the
// general default) — at most one per scope. An incident gets the most
// specific document that applies to it (findIapForScope). That mapping is the
// changeable part: replace or add documents through the admin endpoints below
// (Admin → IAP documents), no deploy needed.
//
// Storage is a BYTEA column: the dyno filesystem is wiped on deploy, and the
// existing Cloudinary preset is image-only, so Postgres is the one place a
// PDF survives. Templates are small (tens of KB to a few MB) and served with
// long-lived caching per updated_at.

const MAX_PDF_BYTES = 15 * 1024 * 1024; // matches the client-side upload cap

const CANONICAL_TYPES = new Set(CANONICAL_TYPE_IDS);

// One row per (type, property); NULL means "any". The COALESCE sentinels
// mirror the unique index in migrate.ts.
const SCOPE_MATCH =
  "COALESCE(incident_type, '__general__') = COALESCE($1, '__general__') AND " +
  "COALESCE(location_group_id, '__all__') = COALESCE($2, '__all__')";

export interface IapDocRow {
  id: string;
  name: string;
  incident_type: string | null;
  location_group_id: string | null;
  size: number;
  updated_at: string;
}

export type IapMatch = 'type+property' | 'type' | 'property' | 'general';

/** Which rung of the fallback ladder a document sits on. */
export function iapMatchOf(doc: { incident_type: string | null; location_group_id: string | null }): IapMatch {
  if (doc.incident_type !== null && doc.location_group_id !== null) return 'type+property';
  if (doc.incident_type !== null) return 'type';
  if (doc.location_group_id !== null) return 'property';
  return 'general';
}

// Most specific first: (type, property) > (type, any) > (any, property) >
// general. A type-specific plan outranks a property-wide one — how to fight a
// wildfire matters more than which lodge it threatens. A null argument only
// matches documents filed under "any" for that part.
const RESOLVE_WHERE =
  `WHERE (incident_type = $1 OR incident_type IS NULL)
     AND (location_group_id = $2 OR location_group_id IS NULL)
   ORDER BY (incident_type IS NOT NULL) DESC, (location_group_id IS NOT NULL) DESC
   LIMIT 1`;

/**
 * The document that serves an incident of this type at this property, or
 * null. Callers pass an already normalized type id (share snapshots can carry
 * retired ids).
 */
export async function findIapForScope(
  incidentType: string | null,
  propertyId: string | null
): Promise<{ name: string; content: Buffer; updated_at: Date } | null> {
  const { rows: [row] } = await pool.query(
    `SELECT name, content, updated_at FROM iap_documents ${RESOLVE_WHERE}`,
    [incidentType, propertyId]
  );
  return row ?? null;
}

/** A query-string id: absent/blank → null, well-formed → the id, anything else → undefined (bad). */
function queryId(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === '') return null;
  return typeof raw === 'string' && TEMPLATE_ID_RE.test(raw) ? raw : undefined;
}

const router = Router();

// GET /api/iap — the library listing (any signed-in user can see what exists).
router.get('/', requireAuth, wrap(async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id, name, incident_type, location_group_id, size, updated_at FROM iap_documents
     ORDER BY incident_type NULLS FIRST, location_group_id NULLS FIRST, name ASC`
  );
  res.json(rows as IapDocRow[]);
}, 'iap'));

// GET /api/iap/resolve?type=<id>&property=<id> — which document an incident
// of this type at this property gets, and why (the editor's IAP tab and the
// admin page's "which document will an incident get?" preview). A retired
// type id resolves as its successor, like the share route.
router.get('/resolve', requireAuth, wrap(async (req: Request, res: Response) => {
  const type = queryId(req.query.type);
  const property = queryId(req.query.property);
  if (type === undefined) { res.status(400).json({ error: 'Invalid type' }); return; }
  if (property === undefined) { res.status(400).json({ error: 'Invalid property' }); return; }
  const { rows: [doc] } = await pool.query<IapDocRow>(
    `SELECT id, name, incident_type, location_group_id, size, updated_at FROM iap_documents ${RESOLVE_WHERE}`,
    [type === null ? null : normalizeIncidentTypeId(type), property]
  );
  res.setHeader('Cache-Control', 'no-store');
  res.json({ doc: doc ?? null, match: doc ? iapMatchOf(doc) : null });
}, 'iap'));

// GET /api/iap/:id/file — preview a stored document (signed-in users).
router.get('/:id/file', requireAuth, wrap(async (req: Request, res: Response) => {
  const { rows: [row] } = await pool.query(
    'SELECT name, content, updated_at FROM iap_documents WHERE id = $1',
    [req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  sendPdf(res, row.name, row.content, row.updated_at);
}, 'iap'));

// POST /api/iap — upload/replace the document for one scope: incidentType
// and/or propertyId, either null for "any" (both null = the general default).
// Admin-only: this is app-wide config, like the signup code.
router.post('/', requireAdmin, wrap(async (req: Request, res: Response) => {
  const { name, incidentType, propertyId, dataBase64 } = (req.body ?? {}) as {
    name?: unknown; incidentType?: unknown; propertyId?: unknown; dataBase64?: unknown;
  };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  if (incidentType !== null && incidentType !== undefined &&
      (typeof incidentType !== 'string' || !CANONICAL_TYPES.has(incidentType))) {
    res.status(400).json({ error: `unknown incidentType ${JSON.stringify(incidentType)}` }); return;
  }
  if (propertyId !== null && propertyId !== undefined &&
      (typeof propertyId !== 'string' || !TEMPLATE_ID_RE.test(propertyId))) {
    res.status(400).json({ error: `invalid propertyId ${JSON.stringify(propertyId)}` }); return;
  }
  if (typeof dataBase64 !== 'string' || !dataBase64) {
    res.status(400).json({ error: 'dataBase64 is required' }); return;
  }
  let content: Buffer;
  try {
    content = Buffer.from(dataBase64, 'base64');
  } catch {
    res.status(400).json({ error: 'dataBase64 is not valid base64' }); return;
  }
  if (content.length === 0) { res.status(400).json({ error: 'empty file' }); return; }
  if (content.length > MAX_PDF_BYTES) {
    res.status(413).json({ error: 'PDF is larger than 15 MB' }); return;
  }
  // %PDF- magic: the share tab renders with a PDF reader, so reject anything else
  // up front instead of serving a viewer error to stakeholders later.
  if (!content.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    res.status(400).json({ error: 'File is not a PDF' }); return;
  }

  const type = typeof incidentType === 'string' ? incidentType : null;
  const property = typeof propertyId === 'string' ? propertyId : null;
  // Replace-by-scope inside a transaction. The advisory lock serializes two
  // uploads for the same scope, which would otherwise both delete nothing and
  // then collide on the unique index; delete-then-insert (rather than an
  // upsert) gives the new file a new id, so a cached /:id/file is never stale.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('iap_documents'))");
    await client.query(`DELETE FROM iap_documents WHERE ${SCOPE_MATCH}`, [type, property]);
    const { rows: [row] } = await client.query(
      `INSERT INTO iap_documents (id, name, incident_type, location_group_id, content, size)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
       RETURNING id, name, incident_type, location_group_id, size, updated_at`,
      [name.trim().slice(0, 120), type, property, content, content.length]
    );
    await client.query('COMMIT');
    res.json(row as IapDocRow);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* connection already gone */ });
    throw err;
  } finally {
    client.release();
  }
}, 'iap'));

// DELETE /api/iap/:id — remove a document (incidents it served fall back to
// the next applicable scope; deleting the general default leaves incidents
// with no applicable document without an IAP).
router.delete('/:id', requireAdmin, wrap(async (req: Request, res: Response) => {
  const { rowCount } = await pool.query('DELETE FROM iap_documents WHERE id = $1', [req.params.id]);
  if (!rowCount) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ok: true });
}, 'iap'));

/** Shared PDF response headers (also used by the public share route). */
export function sendPdf(res: Response, name: string, content: Buffer, updatedAt: Date | string): void {
  res.setHeader('Content-Type', 'application/pdf');
  // ASCII-sanitized filename: header values must stay ASCII, and the name is
  // operator-supplied.
  const safe = (name || 'incident-action-plan').replace(/[^\w .()-]+/g, '_').slice(0, 100);
  res.setHeader('Content-Disposition', `inline; filename="${safe}.pdf"`);
  // The viewer shows the document title from this (exposed for fetch()).
  res.setHeader('X-IAP-Name', safe);
  res.setHeader('Access-Control-Expose-Headers', 'X-IAP-Name');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Last-Modified', new Date(updatedAt).toUTCString());
  res.send(content);
}

export default router;
