import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { requireAuth } from '../middleware/auth';

// Track 2: site assets & infrastructure per monitored property. Any signed-in
// member can record and maintain assets (the roadmap's bottleneck is data
// collection, so entry must be as frictionless as the watchlist); deletion is
// open to members too — rows are cheap to re-enter and nothing downstream
// depends on them yet.
const router = Router();
router.use(requireAuth);

export const ASSET_CATEGORIES = [
  'building',
  'generator',
  'water-system',
  'fuel-storage',
  'comms',
  'vehicle',
  'medical',
  'other',
] as const;

export const ASSET_CONDITIONS = ['good', 'fair', 'poor', 'failed'] as const;

interface Body {
  groupId?: string;
  locationName?: string;
  name?: string;
  category?: string;
  lat?: number | null;
  lon?: number | null;
  notes?: string;
  condition?: string | null;
  lastInspected?: string | null;
  nextDue?: string | null;
  responsibleParty?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate and normalize a full asset body; returns the row values or an error.
function validate(b: Body): { values?: {
  groupId: string; locationName: string; name: string; category: string;
  lat: number | null; lon: number | null; notes: string; condition: string | null;
  lastInspected: string | null; nextDue: string | null; responsibleParty: string | null;
}; error?: string } {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const groupId = str(b.groupId);
  const locationName = str(b.locationName);
  const name = str(b.name);
  if (!groupId || groupId.length > 64) return { error: 'groupId is required (≤64 chars)' };
  if (!locationName || locationName.length > 120) return { error: 'locationName is required (≤120 chars)' };
  if (!name || name.length > 120) return { error: 'name is required (≤120 chars)' };
  const category = str(b.category) || 'building';
  if (!(ASSET_CATEGORIES as readonly string[]).includes(category)) {
    return { error: `category must be one of: ${ASSET_CATEGORIES.join(', ')}` };
  }
  // Coordinates are optional but must come as a valid pair. An empty string
  // counts as "not provided" — Number('') is 0, which would silently store a
  // Null Island row; a non-numeric value is an error, not a coercion.
  const provided = (v: unknown) => v !== undefined && v !== null && v !== '';
  const hasLat = provided(b.lat);
  const hasLon = provided(b.lon);
  if (hasLat !== hasLon) return { error: 'lat and lon must be provided together' };
  let lat: number | null = null;
  let lon: number | null = null;
  if (hasLat && hasLon) {
    lat = Number(b.lat);
    lon = Number(b.lon);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      return { error: 'lat/lon out of range' };
    }
  }
  const notes = str(b.notes).slice(0, 2000);
  const condition = str(b.condition) || null;
  if (condition !== null && !(ASSET_CONDITIONS as readonly string[]).includes(condition)) {
    return { error: `condition must be one of: ${ASSET_CONDITIONS.join(', ')} (or empty)` };
  }
  const date = (v: unknown, field: string): { value: string | null; error?: string } => {
    const s = str(v);
    if (!s) return { value: null };
    // Regex shape AND a real calendar date — '2026-02-30' would otherwise
    // reach Postgres and surface as a 500 instead of a validation error.
    if (DATE_RE.test(s)) {
      const d = new Date(`${s}T00:00:00Z`);
      if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) return { value: s };
    }
    return { value: null, error: `${field} must be a valid YYYY-MM-DD date` };
  };
  const li = date(b.lastInspected, 'lastInspected');
  if (li.error) return { error: li.error };
  const nd = date(b.nextDue, 'nextDue');
  if (nd.error) return { error: nd.error };
  const responsibleParty = str(b.responsibleParty).slice(0, 120) || null;
  return {
    values: {
      groupId, locationName, name, category, lat, lon, notes, condition,
      lastInspected: li.value, nextDue: nd.value, responsibleParty,
    },
  };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error('[assets]', err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(500).json({ error: 'Database error' });
    });
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function badId(req: Request, res: Response): boolean {
  if (UUID_RE.test(req.params.id)) return false;
  res.status(404).json({ error: 'Asset not found' });
  return true;
}

// Wire-ready row: dates as plain YYYY-MM-DD strings (a bare DATE column would
// serialize as a midnight timestamp and shift a day across timezones).
const RETURNING = `
  id::text, group_id AS "groupId", location_name AS "locationName", name,
  category, lat, lon, notes, condition,
  to_char(last_inspected, 'YYYY-MM-DD') AS "lastInspected",
  to_char(next_due, 'YYYY-MM-DD') AS "nextDue",
  responsible_party AS "responsibleParty",
  added_by::text AS "addedBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

// Generous ceiling — real portfolios are hundreds of assets, and a cap keeps a
// scripted loop from bloating the table.
const MAX_ASSETS = 2000;

// GET /?groupId=&locationName= — scoped list, or everything for rollups.
router.get('/', wrap(async (req: Request, res: Response) => {
  const groupId = typeof req.query.groupId === 'string' ? req.query.groupId : null;
  const locationName = typeof req.query.locationName === 'string' ? req.query.locationName : null;
  const { rows } = await pool.query(
    `SELECT ${RETURNING} FROM property_assets
      WHERE ($1::text IS NULL OR group_id = $1)
        AND ($2::text IS NULL OR location_name = $2)
      ORDER BY category, name`,
    [groupId, locationName]
  );
  res.json(rows);
}));

router.post('/', wrap(async (req: Request, res: Response) => {
  const { values, error } = validate(req.body as Body);
  if (error || !values) { res.status(400).json({ error: error ?? 'invalid body' }); return; }

  const { rows: [count] } = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM property_assets'
  );
  if (parseInt(count.n, 10) >= MAX_ASSETS) {
    res.status(400).json({ error: `Asset register is at its ${MAX_ASSETS}-row limit` });
    return;
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO property_assets
       (group_id, location_name, name, category, lat, lon, notes, condition,
        last_inspected, next_due, responsible_party, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${RETURNING}`,
    [values.groupId, values.locationName, values.name, values.category,
     values.lat, values.lon, values.notes, values.condition,
     values.lastInspected, values.nextDue, values.responsibleParty,
     req.user?.id ?? null]
  );
  res.status(201).json(row);
}));

router.put('/:id', wrap(async (req: Request, res: Response) => {
  if (badId(req, res)) return;
  const { values, error } = validate(req.body as Body);
  if (error || !values) { res.status(400).json({ error: error ?? 'invalid body' }); return; }
  const { rows: [row] } = await pool.query(
    `UPDATE property_assets
        SET group_id = $1, location_name = $2, name = $3, category = $4,
            lat = $5, lon = $6, notes = $7, condition = $8,
            last_inspected = $9, next_due = $10, responsible_party = $11,
            updated_at = NOW()
      WHERE id = $12
      RETURNING ${RETURNING}`,
    [values.groupId, values.locationName, values.name, values.category,
     values.lat, values.lon, values.notes, values.condition,
     values.lastInspected, values.nextDue, values.responsibleParty,
     req.params.id]
  );
  if (!row) { res.status(404).json({ error: 'Asset not found' }); return; }
  res.json(row);
}));

router.delete('/:id', wrap(async (req: Request, res: Response) => {
  if (badId(req, res)) return;
  await pool.query('DELETE FROM property_assets WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
