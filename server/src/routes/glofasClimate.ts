import { pool } from '../db';

// ── GloFAS return-period flows (the flood report's discharge thresholds) ─────
// A river cell's 2/5/20-year flows come from its own reanalysis: the annual
// maxima of the last CLIMATE_YEARS complete years, fitted with a Gumbel (EV1)
// distribution by the method of moments — the distribution GloFAS itself fits
// for its flood thresholds, and one that extrapolates to the 20-year flow
// sensibly from a 20-year record (an empirical 95th percentile of 20 values is
// just the second-largest year).
//
// The pull is expensive: Open-Meteo bills anything past two weeks of data as
// several calls (~1 per 2 weeks), so 20 years ≈ 520 calls against a free tier
// of 600/min, 5,000/h and 10,000/day that this dyno's IP already shares with
// the wind grid. The fitted flows barely move from year to year, so they are
// persisted per cell in the `snapshots` table: each cell costs one pull per
// calendar year, not one per report or per dyno restart.

export const CLIMATE_YEARS = 20;
/** A partial year's maximum understates its peak — skip it. */
export const MIN_DAYS_PER_YEAR = 300;
/** Fewer usable years than this is too short a record to fit. */
export const MIN_YEARS = 10;

export interface ReturnPeriods {
  rp2: number;
  rp5: number;
  rp20: number;
  /** Complete years that went into the fit. */
  years: number;
  fromYear: number;
  toYear: number;
}

export interface ClimateWindow {
  start: string;
  end: string;
}

/** The last CLIMATE_YEARS complete calendar years before `now` (UTC). */
export function climatologyWindow(now = new Date()): ClimateWindow {
  const endYear = now.getUTCFullYear() - 1;
  return { start: `${endYear - CLIMATE_YEARS + 1}-01-01`, end: `${endYear}-12-31` };
}

/** Per-year maximum over years with at least MIN_DAYS_PER_YEAR finite values, oldest first. */
export function annualMaxima(time: string[], q: Array<number | null>): { year: number; max: number }[] {
  const byYear = new Map<number, { n: number; max: number }>();
  const len = Math.min(time.length, q.length);
  for (let i = 0; i < len; i++) {
    const v = q[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const year = Number(time[i]?.slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const y = byYear.get(year);
    if (y) {
      y.n++;
      if (v > y.max) y.max = v;
    } else {
      byYear.set(year, { n: 1, max: v });
    }
  }
  return [...byYear.entries()]
    .filter(([, y]) => y.n >= MIN_DAYS_PER_YEAR)
    .map(([year, y]) => ({ year, max: y.max }))
    .sort((a, b) => a.year - b.year);
}

const EULER_GAMMA = 0.5772156649;
const sig3 = (v: number) => Number(v.toPrecision(3));

/**
 * Gumbel fit to the annual maxima (method of moments): β = s·√6/π,
 * μ = mean − γ·β, and the T-year flow x_T = μ − β·ln(−ln(1 − 1/T)).
 * null when fewer than MIN_YEARS usable years.
 */
export function gumbelReturnPeriods(time: string[], q: Array<number | null>): ReturnPeriods | null {
  const ams = annualMaxima(time, q);
  if (ams.length < MIN_YEARS) return null;
  const xs = ams.map((a) => a.max);
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const beta = (sd * Math.sqrt(6)) / Math.PI;
  const mu = mean - EULER_GAMMA * beta;
  // Flows can't go negative; a flat record (sd 0) puts every period at the mean.
  const flow = (T: number) => sig3(Math.max(0, mu - beta * Math.log(-Math.log(1 - 1 / T))));
  return {
    rp2: flow(2),
    rp5: flow(5),
    rp20: flow(20),
    years: n,
    fromYear: ams[0].year,
    toYear: ams[n - 1].year,
  };
}

// ── Persistence (one row per 0.05° cell) ─────────────────────────────────────

interface StoredClimate {
  window: ClimateWindow;
  /** null = the record was too short to fit; stored so it isn't re-pulled. */
  rp: ReturnPeriods | null;
  savedAt: number;
}

// lat/lon are the cell's centre (flood.ts snapToGlofasLat/Lon). Rows stored
// when cells were keyed by a corner (a multiple of 0.05°) can never match a
// centre key, so they are simply never read again — no version bump needed to
// stop a fit for a neighbouring cell being served as this one's.
const snapshotKey = (lat: number, lon: number) => `glofas-rp:v1:${lat},${lon}`;

/**
 * The stored fit for this cell and window. undefined = nothing usable (no row,
 * a previous year's window, a malformed row, or the database unreachable) —
 * the caller then pulls the reanalysis.
 */
export async function loadStoredReturnPeriods(
  lat: number,
  lon: number,
  window: ClimateWindow
): Promise<{ rp: ReturnPeriods | null } | undefined> {
  try {
    const { rows } = await pool.query<{ data: StoredClimate }>('SELECT data FROM snapshots WHERE key = $1', [
      snapshotKey(lat, lon),
    ]);
    const d = rows[0]?.data;
    if (!d || d.window?.start !== window.start || d.window?.end !== window.end) return undefined;
    if (d.rp !== null && !(Number.isFinite(d.rp?.rp2) && Number.isFinite(d.rp?.rp5) && Number.isFinite(d.rp?.rp20))) {
      return undefined;
    }
    return { rp: d.rp };
  } catch (err) {
    console.warn('[flood] climatology snapshot read failed (pulling instead):', err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** Fire-and-forget upsert — a failed save only costs a re-pull later. */
export function saveReturnPeriods(lat: number, lon: number, window: ClimateWindow, rp: ReturnPeriods | null): void {
  const data: StoredClimate = { window, rp, savedAt: Date.now() };
  pool
    .query(
      `INSERT INTO snapshots (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [snapshotKey(lat, lon), JSON.stringify(data)]
    )
    .catch((err) => {
      console.warn('[flood] climatology snapshot save failed:', err instanceof Error ? err.message : err);
    });
}

/**
 * Stored fit if this year's is on file, else pull the window's reanalysis
 * (via `pullSeries`), fit it and store the result. Pull errors propagate — the
 * caller decides how a missing threshold set is shown.
 */
export async function resolveReturnPeriods(
  lat: number,
  lon: number,
  pullSeries: (window: ClimateWindow) => Promise<{ time: string[]; q: Array<number | null> }>,
  now = new Date()
): Promise<ReturnPeriods | null> {
  const window = climatologyWindow(now);
  const stored = await loadStoredReturnPeriods(lat, lon, window);
  if (stored) return stored.rp;
  const { time, q } = await pullSeries(window);
  const rp = gumbelReturnPeriods(time, q);
  saveReturnPeriods(lat, lon, window, rp);
  return rp;
}
