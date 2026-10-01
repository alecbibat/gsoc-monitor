// Shared, store-free tables and helpers for the NGFS heat-detection layer:
// the age palette (used by the globe, the legend and the details panel, so
// they can't drift), fuel/land-cover decoding and the detection fetch.

import type { PanelOpenData } from '../../panels/panelStore';
import type { NgfsPixel, NgfsResponse } from '../../types';
import { haversineMeters } from '../../lib/geo';
import { pixelFootprint, SLOT_LON0 } from './abiFootprint';

export const NGFS_WINDOWS = [1, 3, 6] as const;
/** GOES CONUS scan interval. */
export const SCAN_INTERVAL_MS = 5 * 60_000;
export type NgfsWindow = (typeof NGFS_WINDOWS)[number];

// Age of a pixel's latest detection. GOES scans CONUS every 5 minutes and
// NGFS publishes a few minutes after the scan, so "under 15 min" is the last
// two or three scans: heat that is very likely still there.
export interface NgfsAgeClass {
  maxMin: number;
  label: string;
  color: string;
  fill: number; // footprint fill opacity
}

export const NGFS_AGE_CLASSES: NgfsAgeClass[] = [
  { maxMin: 15, label: 'Under 15 min', color: '#ff2d1a', fill: 0.55 },
  { maxMin: 60, label: '15–60 min', color: '#ff7a1a', fill: 0.45 },
  { maxMin: 180, label: '1–3 h', color: '#ffb52e', fill: 0.35 },
  { maxMin: Infinity, label: '3–6 h', color: '#b9925a', fill: 0.25 },
];

/** Industrial, gas-flare, urban and volcanic heat, when shown at all. */
export const NGFS_OTHER = { label: 'Non-wildland heat', color: '#9ca3af', fill: 0.3 };

export const NGFS_LEGEND_NOTE =
  'Each outline is one GOES satellite pixel (≈2–5 km): heat somewhere inside it, not the area burning.';

export function ageClass(lastMs: number, now: number): NgfsAgeClass {
  const min = (now - lastMs) / 60_000;
  return NGFS_AGE_CLASSES.find((c) => min < c.maxMin) ?? NGFS_AGE_CLASSES[NGFS_AGE_CLASSES.length - 1];
}

export function pixelStyle(p: Pick<NgfsPixel, 'last' | 'wildland'>, now: number): { color: string; fill: number } {
  return p.wildland ? ageClass(p.last, now) : NGFS_OTHER;
}

// LANDFIRE's 13 Anderson fire-behavior fuel models (FBFM13), the codes NGFS
// reports in FUEL, plus the non-burnable classes it names directly.
const FBFM13: Record<string, string> = {
  FBFM1: 'Short grass',
  FBFM2: 'Timber grass & understory',
  FBFM3: 'Tall grass',
  FBFM4: 'Chaparral',
  FBFM5: 'Brush',
  FBFM6: 'Dormant brush',
  FBFM7: 'Southern rough',
  FBFM8: 'Compact timber litter',
  FBFM9: 'Hardwood litter',
  FBFM10: 'Timber litter & understory',
  FBFM11: 'Light logging slash',
  FBFM12: 'Medium logging slash',
  FBFM13: 'Heavy logging slash',
};

export interface MixPart {
  label: string;
  pct: number;
}

/** "FBFM8:49,FBFM5:30,Urban:1" → [{Compact timber litter, 49}, {Brush, 30}, {Urban, 1}], largest first. */
export function parseMix(raw: string | null | undefined): MixPart[] {
  if (!raw) return [];
  const parts: MixPart[] = [];
  for (const item of raw.split(',')) {
    const [key, val] = item.split(':');
    const pct = Number(val);
    if (!key?.trim() || !Number.isFinite(pct)) continue;
    const k = key.trim();
    parts.push({ label: FBFM13[k] ?? k, pct });
  }
  return parts.sort((a, b) => b.pct - a.pct);
}

/** Top `n` parts as "Compact timber litter 49% · Brush 30%". */
export function formatMix(raw: string | null | undefined, n = 3): string | null {
  const parts = parseMix(raw).slice(0, n);
  return parts.length ? parts.map((p) => `${p.label} ${p.pct}%`).join(' · ') : null;
}

export function incidentTypeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (c === 'WF') return 'Wildfire';
  if (c === 'RX') return 'Prescribed burn';
  if (c === 'CX') return 'Complex';
  return code;
}

export const SLOT_LABEL: Record<NgfsPixel['slot'], string> = { east: 'GOES-East', west: 'GOES-West' };

/** Ground size of the pixel's footprint, km (north–south × east–west), or null off the disk. */
export function footprintKm(p: Pick<NgfsPixel, 'lat' | 'lon' | 'slot'>): { ns: number; ew: number } | null {
  const c = pixelFootprint(p.lat, p.lon, SLOT_LON0[p.slot]);
  if (!c) return null;
  const [nw, sw, se] = c;
  return {
    ns: haversineMeters(nw[1], nw[0], sw[1], sw[0]) / 1000,
    ew: haversineMeters(sw[1], sw[0], se[1], se[0]) / 1000,
  };
}

/**
 * When NGFS first detected the fire object, from its tracking id
 * ("ID-2026-09-20T16:51:17.000Z_0002"). The format is undocumented, so
 * anything else gives null rather than a guess.
 */
export function trackedSince(trackId: string | null | undefined): number | null {
  const m = /^ID-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)_\d+$/.exec(trackId ?? '');
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

/** What the details panel needs beyond the pixel: the window it was drawn from. */
export interface NgfsPanelPayload extends NgfsPixel {
  windowHours: NgfsWindow;
  // Earliest scan the server had for this pixel's satellite in the window:
  // the window start once history is fully loaded, later while it fills.
  historyFrom: number;
  historyComplete: boolean; // every scan back to the window start is loaded (or skipped)
}

export function panelPayload(p: NgfsPixel, data: Pick<NgfsResponse, 'windowHours' | 'windowStart' | 'products'>): NgfsPanelPayload {
  const product = data.products.find((x) => x.slot === p.slot);
  const covered = product?.coveredFrom ?? null;
  return {
    ...p,
    windowHours: data.windowHours,
    historyFrom: covered != null && covered > data.windowStart ? covered : data.windowStart,
    // The first scan in the window can land up to one scan interval after its start.
    historyComplete: covered != null && covered <= data.windowStart + SCAN_INTERVAL_MS,
  };
}

/** Panel/pick-chooser entry for a pixel. The subtitle tells overlapping pixels apart. */
export function ngfsPanelData(p: NgfsPixel, payload: NgfsPanelPayload): PanelOpenData {
  const id = ngfsPanelId(p);
  const where = [p.county, p.state].filter(Boolean).join(', ') || `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
  return {
    id,
    kind: 'ngfs',
    title: p.incident ? `${p.incident} · NGFS heat` : 'NGFS Heat Detection',
    subtitle: `${where} · ${SLOT_LABEL[p.slot]} · last ${clock(p.last)}`,
    payload: { ...payload },
  };
}

/** Stable per-pixel panel id: the same pixel re-opens the same panel after a refresh. */
export function ngfsPanelId(p: Pick<NgfsPixel, 'lat' | 'lon' | 'slot'>): string {
  return `ngfs-${p.slot}-${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

/** GET /api/ngfs, surfacing the server's error text (e.g. why the upstream failed). */
export async function fetchNgfs(hours: NgfsWindow, signal?: AbortSignal): Promise<NgfsResponse> {
  const r = await fetch(`/api/ngfs?hours=${hours}`, { signal });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  return (await r.json()) as NgfsResponse;
}

// --- Sidebar status ----------------------------------------------------------

export interface NgfsStatusView {
  count: number;
  newestScan: number | null;
  windowStart: number | null;
  products: NgfsResponse['products'];
  loading: boolean;
  error: string | null;
}

/** Local "HH:MM". */
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
const clock = clockTime;

// NGFS normally publishes a scan within a few minutes; well past that, say so.
const STALE_SCAN_MS = 20 * 60_000;

/** One-line status under the layer toggle. */
export function ngfsStatusText(s: NgfsStatusView, hours: NgfsWindow): string {
  if (s.error) return s.error;
  if (s.loading && s.newestScan == null) return 'Loading NOAA NGFS…';
  // newestScan is the newest scan actually on the map (see NgfsLayer).
  const n = `${s.count.toLocaleString()} hot pixel${s.count === 1 ? '' : 's'} · ${hours} h`;
  return s.newestScan ? `${n} · scan ${clock(s.newestScan)}` : n;
}

/**
 * Caveats worth a line under the controls: a satellite that is down, a
 * window whose history is still being fetched, or a feed that has gone quiet.
 */
export function ngfsNotes(s: NgfsStatusView, now: number): string[] {
  if (s.error) return [];
  const notes: string[] = [];
  for (const p of s.products) {
    if (p.error) notes.push(`${SLOT_LABEL[p.slot]} (${p.sat}) unavailable: ${p.error}`);
  }
  if (s.windowStart != null) {
    // Coverage is only as complete as the satellite furthest behind.
    let from: number | null = null;
    let skipped = 0;
    const latestMissing: string[] = [];
    for (const p of s.products) {
      if (p.error) continue;
      skipped += p.framesSkipped;
      if (p.framesInWindow === 0 || p.framesLoaded + p.framesSkipped >= p.framesInWindow) continue;
      if (p.coveredFrom == null) {
        // Not even the newest scan is in yet, so there's no "complete from".
        latestMissing.push(SLOT_LABEL[p.slot]);
        continue;
      }
      from = from == null ? p.coveredFrom : Math.max(from, p.coveredFrom);
    }
    if (latestMissing.length) notes.push(`Latest ${latestMissing.join(' and ')} scan not loaded yet.`);
    if (from != null) notes.push(`Earlier scans still loading: complete from ${clock(from)}.`);
    if (skipped > 0) {
      notes.push(`${skipped} scan${skipped === 1 ? '' : 's'} could not be downloaded; their detections are missing.`);
    }
  }
  if (s.newestScan != null && now - s.newestScan > STALE_SCAN_MS) {
    notes.push(`Newest NGFS scan is ${Math.round((now - s.newestScan) / 60_000)} min old; the feed may be delayed.`);
  }
  return notes;
}
