import type { FemaZoneFeature } from '../types';

// ── Flood report palette ─────────────────────────────────────────────────────
// One source for the colors the snapshot maps draw and the legends print, so
// a map and its legend can never disagree. Gauge colors come from the rivers
// layer (riverMeta CAT) and ERO colors from floodTypes ERO_META for the same
// reason.

/** Display class of a FEMA NFHL flood-hazard polygon. */
export type FemaZoneClass =
  | 'floodway'     // regulatory floodway inside the SFHA
  | 'coastal'      // V / VE coastal high-hazard area (wave action)
  | 'sfha'         // other 1%-annual-chance zones (A, AE, AH, AO, AR, A99)
  | 'moderate'     // 0.2%-annual-chance (shaded X / B)
  | 'levee'        // reduced risk due to levee
  | 'minimal'      // X (unshaded) / C
  | 'undetermined' // D
  | 'water'        // OPEN WATER
  | 'other';

export function femaZoneClass(f: Pick<FemaZoneFeature, 'zone' | 'subtype' | 'sfha'>): FemaZoneClass {
  const zone = (f.zone ?? '').trim().toUpperCase();
  const sub = (f.subtype ?? '').toUpperCase();
  if (zone === 'OPEN WATER') return 'water';
  if (zone === 'D') return 'undetermined';
  if (f.sfha || /^(A|V)/.test(zone)) {
    if (sub.includes('FLOODWAY')) return 'floodway';
    if (zone.startsWith('V')) return 'coastal';
    return 'sfha';
  }
  if (sub.includes('LEVEE')) return 'levee';
  if (sub.includes('0.2 PCT') || zone === 'B' || zone === 'X500') return 'moderate';
  if (zone === 'X' || zone === 'C') return 'minimal';
  return 'other';
}

/** Fill/stroke per class; `null` fill = drawn as outline only (minimal hazard). */
export const FEMA_CLASS_STYLE: Record<FemaZoneClass, { fill: string | null; stroke: string; label: string; hatch?: boolean }> = {
  floodway:     { fill: 'rgba(239,68,68,0.42)',  stroke: '#ef4444', label: 'Floodway', hatch: true },
  coastal:      { fill: 'rgba(168,85,247,0.45)', stroke: '#a855f7', label: 'Coastal high hazard (V/VE)' },
  sfha:         { fill: 'rgba(37,99,235,0.45)',  stroke: '#3b82f6', label: '1% annual chance (SFHA)' },
  moderate:     { fill: 'rgba(245,158,11,0.38)', stroke: '#f59e0b', label: '0.2% annual chance' },
  levee:        { fill: 'rgba(148,163,184,0.35)', stroke: '#94a3b8', label: 'Levee-reduced risk', hatch: true },
  minimal:      { fill: null,                    stroke: 'rgba(255,255,255,0.28)', label: 'Minimal (X)' },
  undetermined: { fill: 'rgba(120,113,108,0.35)', stroke: '#a8a29e', label: 'Undetermined (D)' },
  water:        { fill: 'rgba(14,165,233,0.25)', stroke: '#0ea5e9', label: 'Open water' },
  other:        { fill: 'rgba(148,163,184,0.2)', stroke: '#94a3b8', label: 'Other' },
};

/** Draw order, lowest first — the higher hazard always paints on top. */
export const FEMA_CLASS_ORDER: FemaZoneClass[] = [
  'other', 'minimal', 'water', 'undetermined', 'levee', 'moderate', 'sfha', 'coastal', 'floodway',
];

/** Current-season burn-scar perimeters on the flood maps (hatched, earth tone). */
export const BURN_SCAR_STYLE = {
  color: 'rgba(214,160,110,0.95)',
  hatch: 'rgba(214,160,110,0.45)',
  label: 'Burn scar (current season)',
};
