import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { wrap } from '../asyncWrap';
import { INCIDENT_TYPE_IDS } from '../incidentTaxonomy';

// ── Incident Action Plan documents ───────────────────────────────────────────
//
// Pre-uploaded IAP PDFs, served into the share link's IAP tab. One document
// per incident type plus one "general default" row (incident_type NULL) that
// answers for every type without its own upload — that mapping is the
// changeable part: replace or add documents through the admin endpoints below
// (Admin panel → IAP Library), no deploy needed.
//
// Storage is a BYTEA column: the dyno filesystem is wiped on deploy, and the
// existing Cloudinary preset is image-only, so Postgres is the one place a
// PDF survives. Templates are small (tens of KB to a few MB) and served with
// long-lived caching per updated_at.

const MAX_PDF_BYTES = 15 * 1024 * 1024; // matches the client-side upload cap

// A single row per type, where NULL means "general default". The COALESCE
// sentinel mirrors the unique index in migrate.ts.
const TYPE_KEY = "COALESCE(incident_type, '__general__')";

export interface IapDocRow {
  id: string;
  name: string;
  incident_type: string | null;
  size: number;
  updated_at: string;
}

/**
 * Resolve which document serves an incident type: the type's own upload if
 * one exists, else the general default, else nothing. Callers pass an already
 * normalized type id (share snapshots can carry retired ids).
 */
export async function findIapForType(
  incidentType: string | null
): Promise<{ name: string; content: Buffer; updated_at: Date } | null> {
  const { rows: [row] } = await pool.query(
    `SELECT name, content, updated_at FROM iap_documents
     WHERE incident_type = $1 OR incident_type IS NULL
     ORDER BY incident_type NULLS LAST
     LIMIT 1`,
    [incidentType]
  );
  return row ?? null;
}

const router = Router();

// GET /api/iap — the library listing (any signed-in user can see what exists).
router.get('/', requireAuth, wrap(async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id, name, incident_type, size, updated_at FROM iap_documents
     ORDER BY incident_type NULLS FIRST, name ASC`
  );
  res.json(rows as IapDocRow[]);
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

// POST /api/iap — upload/replace the document for one incident type (or the
// general default when incidentType is null). Admin-only: this is app-wide
// config, like the signup code.
router.post('/', requireAdmin, wrap(async (req: Request, res: Response) => {
  const { name, incidentType, dataBase64 } = (req.body ?? {}) as {
    name?: unknown; incidentType?: unknown; dataBase64?: unknown;
  };
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }
  if (incidentType !== null && incidentType !== undefined &&
      (typeof incidentType !== 'string' || !INCIDENT_TYPE_IDS.has(incidentType))) {
    res.status(400).json({ error: `unknown incidentType ${JSON.stringify(incidentType)}` }); return;
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
  // Replace-by-type inside a transaction (the partial-expression unique index
  // makes concurrent inserts safe; delete-then-insert keeps the SQL portable).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM iap_documents WHERE ${TYPE_KEY} = COALESCE($1, '__general__')`, [type]);
    const { rows: [row] } = await client.query(
      `INSERT INTO iap_documents (id, name, incident_type, content, size)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
       RETURNING id, name, incident_type, size, updated_at`,
      [name.trim().slice(0, 120), type, content, content.length]
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

// DELETE /api/iap/:id — remove a document (its type falls back to the general
// default; deleting the default leaves those types with no IAP).
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
