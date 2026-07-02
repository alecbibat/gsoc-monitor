import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';
import { geocodePlace } from '../intel/geocode';
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

// A public DNS hostname: dotted labels, not an IP literal, no port/path/userinfo.
// Blocks the SSRF shapes (169.254.169.254, localhost, internal single-label
// hosts) that would otherwise let a watchlist row aim the server's ingest
// fetcher at private infrastructure.
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const IPV4_RE = /^\d+\.\d+\.\d+\.\d+$/;
function isPublicHostname(host: string): boolean {
  return HOSTNAME_RE.test(host) && !IPV4_RE.test(host) && !/\.(local|internal|localdomain)$/i.test(host);
}
// http(s) URL whose host passes the same public-hostname bar.
function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      !u.username &&
      !u.password &&
      isPublicHostname(u.hostname)
    );
  } catch {
    return false;
  }
}
const SOCRATA_DATASET_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/i; // Socrata "4x4" resource id
const FIELD_NAME_RE = /^[a-z0-9_]{1,64}$/i; // SoQL column names
const AGENCY_ID_RE = /^[a-z0-9-]{2,32}$/i;

// Validate a source and return a normalized {url, config} or an error message.
// Each kind has one required field; we reject rows the adapters can't act on so
// a typo doesn't silently produce an always-failing source — and constrain
// every value that ends up in a server-side fetch URL.
function validate(b: Body): { url: string | null; config: Record<string, unknown>; error?: string } {
  const kind = b.kind as SourceKind;
  if (!SOURCE_KINDS.includes(kind)) {
    return { url: null, config: {}, error: `kind must be one of: ${SOURCE_KINDS.join(', ')}` };
  }
  const config = { ...(b.config ?? {}) };
  // staticGeo is server-derived from `place` (never client-supplied), so a
  // caller can't pin a source to arbitrary coordinates directly.
  delete config.staticGeo;
  const url = typeof b.url === 'string' && b.url.trim() ? b.url.trim() : null;
  const need = (cond: unknown, msg: string) => (cond ? null : msg);
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  // Optional "pin stories to this place" — only meaningful for feed sources
  // (news/social) whose items lack precise coordinates. Kept as a string; the
  // route geocodes it into staticGeo. Dropped for coordinate-bearing kinds.
  const PINNABLE = new Set(['rss', 'google-news', 'bluesky-author', 'bluesky-search']);
  const place = str(config.place);
  if (place && place.length <= 120 && PINNABLE.has(kind)) config.place = place;
  else delete config.place;

  let error: string | null = null;
  switch (kind) {
    case 'rss':
      error = need(url && isSafeHttpUrl(url), 'rss source needs a public http(s) feed url');
      break;
    case 'google-news':
    case 'bluesky-search':
      error = need(
        str(config.query) && str(config.query).length <= 200,
        `${kind} needs config.query (≤200 chars)`
      );
      break;
    case 'bluesky-author': {
      const handle = str(config.handle).replace(/^@/, '');
      error = need(handle && HOSTNAME_RE.test(handle), 'bluesky-author needs config.handle (e.g. name.bsky.social)');
      config.handle = handle;
      break;
    }
    case 'pulsepoint':
      error = need(AGENCY_ID_RE.test(str(config.agencyId)), 'pulsepoint needs config.agencyId (e.g. EMS1384)');
      break;
    case 'socrata': {
      error =
        need(isPublicHostname(str(config.domain)), 'socrata config.domain must be a public hostname (e.g. data.cityofchicago.org)') ??
        need(SOCRATA_DATASET_RE.test(str(config.dataset)), 'socrata config.dataset must be a Socrata id like ijzp-q8t2');
      // Optional column-name overrides are interpolated into the SoQL query —
      // constrain them to plain identifiers.
      for (const k of ['dateField', 'latField', 'lonField', 'typeField', 'descField']) {
        if (config[k] !== undefined && !FIELD_NAME_RE.test(str(config[k]))) {
          error = error ?? `socrata config.${k} must be a plain column name`;
        }
      }
      break;
    }
    case 'chp':
      break; // statewide, no config required
  }
  return { url, config, error: error ?? undefined };
}

// Resolve config.place into a staticGeo region pin so a feed source's items
// (which arrive without coordinates) can appear on the map at that place.
// Best-effort: if the geocoder can't resolve it, the source is still saved and
// its items stay feed-only — adding never fails on a flaky geocoder.
async function applyPlacePin(config: Record<string, unknown>): Promise<void> {
  const place = typeof config.place === 'string' ? config.place : '';
  if (!place) {
    delete config.staticGeo;
    return;
  }
  const hit = await geocodePlace(place);
  if (hit && hit !== 'error') config.staticGeo = { lat: hit.lat, lon: hit.lon, place };
  else delete config.staticGeo;
}

// Async handlers can reject (DB down, bad cast) — without this the request
// would hang with no response and no error middleware to catch it.
function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error('[watchlist]', err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ error: 'Database error' });
    });
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A malformed :id would otherwise throw inside Postgres ("invalid input syntax
// for type uuid") — reject it up front as a plain 404.
function badId(req: Request, res: Response): boolean {
  if (UUID_RE.test(req.params.id)) return false;
  res.status(404).json({ error: 'Source not found' });
  return true;
}

// A generous ceiling on team sources: enough for any real watchlist, small
// enough that a scripted loop can't turn the ingest engine into an outbound
// request cannon.
const MAX_SOURCES = 100;

router.get('/', wrap(async (_req, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"
       FROM watchlist_sources
      ORDER BY created_at DESC`
  );
  res.json(rows);
}));

router.post('/', wrap(async (req: Request, res: Response) => {
  const body = req.body as Body;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > 120) { res.status(400).json({ error: 'label is required (≤120 chars)' }); return; }
  const { url, config, error } = validate(body);
  if (error) { res.status(400).json({ error }); return; }

  const { rows: [count] } = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM watchlist_sources'
  );
  if (parseInt(count.n, 10) >= MAX_SOURCES) {
    res.status(400).json({ error: `Watchlist is at its ${MAX_SOURCES}-source limit — remove one first` });
    return;
  }

  await applyPlacePin(config);
  const { rows: [row] } = await pool.query(
    `INSERT INTO watchlist_sources (kind, url, label, config, active, added_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"`,
    [body.kind, url, label, JSON.stringify(config), req.user?.id ?? null]
  );
  res.status(201).json(row);
}));

router.put('/:id', wrap(async (req: Request, res: Response) => {
  if (badId(req, res)) return;
  const body = req.body as Body;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > 120) { res.status(400).json({ error: 'label is required (≤120 chars)' }); return; }
  const { url, config, error } = validate(body);
  if (error) { res.status(400).json({ error }); return; }

  await applyPlacePin(config);
  // COALESCE keeps the stored active flag when the body omits it, so an edit
  // can't silently re-enable a source the team paused.
  const active = typeof body.active === 'boolean' ? body.active : null;
  const { rows: [row] } = await pool.query(
    `UPDATE watchlist_sources
        SET kind = $1, url = $2, label = $3, config = $4, active = COALESCE($5, active)
      WHERE id = $6
      RETURNING id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"`,
    [body.kind, url, label, JSON.stringify(config), active, req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Source not found' }); return; }
  res.json(row);
}));

// A lightweight enable/disable toggle without re-validating the whole row.
router.patch('/:id', wrap(async (req: Request, res: Response) => {
  if (badId(req, res)) return;
  const active = (req.body as Body).active;
  if (typeof active !== 'boolean') { res.status(400).json({ error: 'active (boolean) is required' }); return; }
  const { rows: [row] } = await pool.query(
    `UPDATE watchlist_sources SET active = $1 WHERE id = $2
     RETURNING id::text, kind, url, label, config, active, added_by::text AS "addedBy", created_at AS "createdAt"`,
    [active, req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Source not found' }); return; }
  res.json(row);
}));

router.delete('/:id', wrap(async (req: Request, res: Response) => {
  if (badId(req, res)) return;
  await pool.query('DELETE FROM watchlist_sources WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
