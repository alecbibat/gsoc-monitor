import type { FemaZoneFeature } from '../types';

// ── Flood report palette ─────────────────────────────────────────────────────
// One source for the colors the snapshot maps draw and the legends print, so
// a map and its legend can never disagree. Gauge colors come from the rivers
// layer (riverMeta CAT) and ERO colors from floodTypes ERO_META for the same
// reason.

/** Display class of a FEMA NFHL flood-hazard polygon. */
export type FemaZoneClass =
  | 'floodway'     // regulatory floodway (incl. encroachment areas) inside the SFHA
  | 'coastal'      // V / VE coastal high-hazard area (wave action)
  | 'sfha'         // other 1%-annual-chance zones (A, AE, AH, AO, AR, A99, A1–A30)
  | 'moderate'     // shaded X / B: 0.2%-annual-chance, and 1% flooding < 1 ft deep,
                   // from < 1 sq mi drainage, or under future conditions
  | 'levee'        // reduced risk due to levee
  | 'minimal'      // X (unshaded) / C
  | 'undetermined' // D
  | 'water'        // OPEN WATER
  | 'other';       // AREA NOT INCLUDED, blanks, anything unrecognised

// The SFHA zone codes, matched exactly: a prefix test would take "AREA NOT
// INCLUDED" (an unstudied area) for an A zone.
const SFHA_CODE = /^(?:A|AE|AH|AO|AR|A99|A\d{1,2}|AR\/\S+|V|VE|V\d{1,2})$/;

export const isSfhaZoneCode = (zone: string | null | undefined) => SFHA_CODE.test((zone ?? '').trim().toUpperCase());

export function femaZoneClass(f: Pick<FemaZoneFeature, 'zone' | 'subtype' | 'sfha'>): FemaZoneClass {
  const zone = (f.zone ?? '').trim().toUpperCase();
  const sub = (f.subtype ?? '').toUpperCase();
  if (zone === 'OPEN WATER') return 'water';
  if (zone === 'D') return 'undetermined';
  if (zone === 'AREA NOT INCLUDED' || zone === '') return 'other';
  if (isSfhaZoneCode(zone) || (f.sfha && /^[AV]/.test(zone))) {
    if (sub.includes('FLOODWAY') || sub.includes('ENCROACHMENT')) return 'floodway';
    if (zone.startsWith('V')) return 'coastal';
    return 'sfha';
  }
  if (sub.includes('LEVEE')) return 'levee';
  // Shaded X: the 0.2% floodplain, and the 1% areas FEMA leaves outside the
  // SFHA (average depth < 1 ft, drainage < 1 sq mi, future conditions).
  if (sub.includes('0.2 PCT') || /\b1 PCT\b/.test(sub) || zone === 'B' || zone === 'X500') return 'moderate';
  if (zone === 'X' || zone === 'C') return 'minimal';
  return 'other';
}

/** Fill/stroke per class; `null` fill = drawn as outline only (minimal hazard). */
export const FEMA_CLASS_STYLE: Record<FemaZoneClass, { fill: string | null; stroke: string; label: string; hatch?: boolean }> = {
  floodway:     { fill: 'rgba(239,68,68,0.42)',  stroke: '#ef4444', label: 'Floodway', hatch: true },
  coastal:      { fill: 'rgba(168,85,247,0.45)', stroke: '#a855f7', label: 'Coastal high hazard (V/VE)' },
  sfha:         { fill: 'rgba(37,99,235,0.45)',  stroke: '#3b82f6', label: '1% annual chance (SFHA)' },
  moderate:     { fill: 'rgba(245,158,11,0.38)', stroke: '#f59e0b', label: 'Moderate (0.2% / shaded X)' },
  levee:        { fill: 'rgba(148,163,184,0.35)', stroke: '#94a3b8', label: 'Levee-reduced risk', hatch: true },
  // Mid gray, not white: the legend swatch must survive the paper theme.
  minimal:      { fill: null,                    stroke: 'rgba(148,163,184,0.7)', label: 'Minimal (X)' },
  undetermined: { fill: 'rgba(120,113,108,0.35)', stroke: '#a8a29e', label: 'Undetermined (D)' },
  water:        { fill: 'rgba(14,165,233,0.25)', stroke: '#0ea5e9', label: 'Open water' },
  other:        { fill: 'rgba(148,163,184,0.2)', stroke: '#94a3b8', label: 'Not studied / other' },
};

/** Draw order, lowest first — the higher hazard always paints on top. */
export const FEMA_CLASS_ORDER: FemaZoneClass[] = [
  'other', 'minimal', 'water', 'undetermined', 'levee', 'moderate', 'sfha', 'coastal', 'floodway',
];

/** This year's burn-scar perimeters on the flood maps (hatched, earth tone). */
export const BURN_SCAR_STYLE = {
  color: 'rgba(214,160,110,0.95)',
  hatch: 'rgba(214,160,110,0.45)',
  label: "Burn scar (this year's fires)",
};

/** A forecast point that has stopped reporting: a hollow ring, the one gray no flood tier uses. */
export const OFFLINE_GAUGE_COLOR = '#9ca3af';
