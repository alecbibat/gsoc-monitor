import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { SOURCE_KINDS, type SourceKind } from '../intel/types';

// Team-shared watchlist of intel sources. Any signed-in member can add a source
// (a news site, a Google-News topic, a scanner agency, a crime dataset, a social
// account) and it applies for the whole workspace — matching how incidents are
// shared. The background ingest engine picks up active rows on its next cycle.
const router = Router();
router.use(requireAuth);

interface Body {
  kind?: string;
  url?: string;
  label?: string;
  config?: Record<string, unknown>;
  active?: boolean;
}

// Validate a source and return a normalized {url, config} or an error message.
// Each kind has one required field; we reject rows the adapters can't act on so
// a typo doesn't silently produce an always-failing source.
function validate(b: Body): { url: string | null; config: Record<string, unknown>; error?: string } {
  const kind = b.kind as SourceKind;
  if (!SOURCE_KINDS.includes(kind)) {
    return { url: null, config: {}, error: `kind must be one of: ${SOURCE_KINDS.join(', ')}` };
  }
  const config = { ...(b.config ?? {}) };
  const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim() : null;
  const need = (cond: unknown, msg: string) => (cond ? null : msg);

  let error: string | null = null;
  switch (kind) {
    case 'rss':
      error = need(url && /^https?:\/\//i.test(url), 'rss source needs a valid http(s) url');
      break;
    case 'google-news':
    case 'bluesky-search':
      error = need(typeof config.query === 'string' && (config.query as string).trim(), `${kind} needs config.query`);
      break;
    case 'bluesky-author':
      error = need(typeof config.handle === 'string' && (config.handle as string).trim(), 'bluesky-author needs config.handle');
      break;
    case 'pulsepoint':
      error = need(typeof config.agencyId === 'string' && (config.agencyId as string).trim(), 'pulsepoint needs config.agencyId');
      break;
    case 'socrata':
      error = need(
        typeof config.domain === 'string' && (config.domain as string).trim() &&
          typeof config.dataset === 'string' && (config.dataset as string).trim(),
        'socrata needs config.domain and config.dataset'
      );
      break;
    case 'chp':
      break; // statewide, no config required
  }
  return { url, config, error: error ?? undefined };
}

router.get('/', async (_req, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"
       FROM watchlist_sources
      ORDER BY created_at DESC`
  );
  res.json(rows);
});

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as Body;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) { res.status(400).json({ error: 'label is required' }); return; }
  const { url, config, error } = validate(body);
  if (error) { res.status(400).json({ error }); return; }

  const { rows: [row] } = await pool.query(
    `INSERT INTO watchlist_sources (kind, url, label, config, active, added_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"`,
    [body.kind, url, label, JSON.stringify(config), req.user?.id ?? null]
  );
  res.status(201).json(row);
});

router.put('/:id', async (req: Request, res: Response) => {
  const body = req.body as Body;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) { res.status(400).json({ error: 'label is required' }); return; }
  const { url, config, error } = validate(body);
  if (error) { res.status(400).json({ error }); return; }

  const { rows: [row] } = await pool.query(
    `UPDATE watchlist_sources
        SET kind = $1, url = $2, label = $3, config = $4, active = $5
      WHERE id = $6
      RETURNING id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"`,
    [body.kind, url, label, JSON.stringify(config), body.active !== false, req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Source not found' }); return; }
  res.json(row);
});

// A lightweight enable/disable toggle without re-validating the whole row.
router.patch('/:id', async (req: Request, res: Response) => {
  const active = (req.body as Body).active;
  if (typeof active !== 'boolean') { res.status(400).json({ error: 'active (boolean) is required' }); return; }
  const { rows: [row] } = await pool.query(
    `UPDATE watchlist_sources SET active = $1 WHERE id = $2
     RETURNING id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"`,
    [active, req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Source not found' }); return; }
  res.json(row);
});

router.delete('/:id', async (req: Request, res: Response) => {
  await pool.query('DELETE FROM watchlist_sources WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

export default router;
