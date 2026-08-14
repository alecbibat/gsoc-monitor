// ── Published fire-behavior reference for the FBFM40 models (roadmap 8a) ─────
//
// Source: Scott, J.H. & Burgan, R.E. (2005), "Standard Fire Behavior Fuel
// Models: A Comprehensive Set for Use with Rothermel's Surface Fire Spread
// Model", USDA Forest Service RMRS-GTR-153 — adjective classes from the Fuel
// Model Selection Guide (pp. 10–12) and class definitions from Table 5 (p. 9),
// verified against the published PDF (NWCG file store) and cross-checked with
// NWCG PMS 437-1. The GTR publishes NO per-model numeric ROS/FL table (charts
// only), so this reference deliberately carries the published classes and
// their numeric RANGES — nothing here is estimated by this app.
//
// Benchmark conditions (GTR-153 p. 9/18, verbatim basis): moisture scenario
// D2L2 — dead 1-h 6%, 10-h 7%, 100-h 8%, live herbaceous 60% (two-thirds
// cured), live woody 90% — midflame wind 5 mi/h, zero slope.
//
// Suppression interpretations: NWCG Fireline Handbook Appendix B (PMS 410-2,
// April 2006), Table 14 "Fire Suppression Interpretations" — the standard
// four-band flame-length "hauling chart" bands (4 / 8 / 11 ft boundaries).

export type BehaviorClass = 'very-low' | 'low' | 'moderate' | 'high' | 'very-high' | 'extreme';

export interface BehaviorClassDef {
  label: string;
  /** Rate-of-spread range, chains/hour (GTR-153 Table 5). 1 chain = 66 ft. */
  rosChHr: string;
  /** Flame-length range, feet (GTR-153 Table 5). */
  flFt: string;
  /** Numeric flame-length range for band-overlap math. */
  flRange: [number, number];
  rank: number;
  /** Display color (screen); print keeps it via print-color. */
  color: string;
}

export const BEHAVIOR_CLASSES: Record<BehaviorClass, BehaviorClassDef> = {
  'very-low':  { label: 'Very Low',  rosChHr: '0–2 ch/h',   flFt: '0–1 ft',   flRange: [0, 1],   rank: 0, color: '#34d399' },
  'low':       { label: 'Low',       rosChHr: '2–5 ch/h',   flFt: '1–4 ft',   flRange: [1, 4],   rank: 1, color: '#a3e635' },
  'moderate':  { label: 'Moderate',  rosChHr: '5–20 ch/h',  flFt: '4–8 ft',   flRange: [4, 8],   rank: 2, color: '#facc15' },
  'high':      { label: 'High',      rosChHr: '20–50 ch/h', flFt: '8–12 ft',  flRange: [8, 12],  rank: 3, color: '#fbbf24' },
  'very-high': { label: 'Very High', rosChHr: '50–150 ch/h', flFt: '12–25 ft', flRange: [12, 25], rank: 4, color: '#fb923c' },
  'extreme':   { label: 'Extreme',   rosChHr: '>150 ch/h',  flFt: '>25 ft',   flRange: [25, 99], rank: 5, color: '#ef4444' },
};

export interface FuelBehaviorRef {
  ros: BehaviorClass;
  fl: BehaviorClass;
  /** Published caveat attached to this model's rating. */
  note?: string;
}

// Keyed by LANDFIRE raster pixel code (same keys as FBFM40). Nonburnable
// codes (91–99) are intentionally absent — "no fire spread" is not a class.
export const FUEL_BEHAVIOR_REF: Record<number, FuelBehaviorRef> = {
  // Grass
  101: { ros: 'moderate',  fl: 'low' },
  102: { ros: 'high',      fl: 'moderate' },
  103: { ros: 'high',      fl: 'moderate' },
  104: { ros: 'very-high', fl: 'high' },
  105: { ros: 'very-high', fl: 'high' },
  106: { ros: 'very-high', fl: 'very-high' },
  107: { ros: 'very-high', fl: 'very-high' },
  108: { ros: 'very-high', fl: 'very-high', note: 'Can be extreme if grass is fully cured (GTR-153)' },
  109: { ros: 'extreme',   fl: 'extreme',   note: 'Extreme if grass is fully or mostly cured (GTR-153)' },
  // Grass-Shrub
  121: { ros: 'moderate',  fl: 'low' },
  122: { ros: 'high',      fl: 'moderate' },
  123: { ros: 'high',      fl: 'moderate' },
  124: { ros: 'high',      fl: 'very-high' },
  // Shrub
  141: { ros: 'very-low',  fl: 'very-low' },
  142: { ros: 'low',       fl: 'low' },
  143: { ros: 'low',       fl: 'low' },
  144: { ros: 'high',      fl: 'moderate' },
  145: { ros: 'very-high', fl: 'very-high' },
  146: { ros: 'high',      fl: 'high' },
  147: { ros: 'high',      fl: 'very-high', note: 'NWCG PMS 437-1 rates SH7 spread Very High; GTR-153 (primary) says High' },
  148: { ros: 'high',      fl: 'high' },
  149: { ros: 'high',      fl: 'very-high' },
  // Timber-Understory
  161: { ros: 'low',       fl: 'low' },
  162: { ros: 'moderate',  fl: 'low' },
  163: { ros: 'high',      fl: 'moderate' },
  164: { ros: 'moderate',  fl: 'moderate' },
  165: { ros: 'moderate',  fl: 'moderate' },
  // Timber-Litter
  181: { ros: 'very-low',  fl: 'very-low' },
  182: { ros: 'very-low',  fl: 'very-low' },
  183: { ros: 'very-low',  fl: 'low' },
  184: { ros: 'low',       fl: 'low' },
  185: { ros: 'low',       fl: 'low' },
  186: { ros: 'moderate',  fl: 'low' },
  187: { ros: 'low',       fl: 'low' },
  188: { ros: 'moderate',  fl: 'low' },
  189: { ros: 'moderate',  fl: 'moderate' },
  // Slash-Blowdown
  201: { ros: 'moderate',  fl: 'low' },
  202: { ros: 'moderate',  fl: 'moderate' },
  203: { ros: 'high',      fl: 'high' },
  204: { ros: 'very-high', fl: 'very-high' },
};

export const BENCHMARK_NOTE =
  'Scott & Burgan (2005) RMRS-GTR-153 adjective classes at benchmark conditions: ' +
  'moisture scenario D2L2 (dead 1-h 6% · 10-h 7% · 100-h 8%, herbaceous ⅔ cured), ' +
  'midflame wind 5 mi/h, zero slope';

// ── Suppression interpretation (hauling chart) ───────────────────────────────

export interface SuppressionBand {
  flFt: string;
  range: [number, number];
  summary: string;
  detail: string;
}

/** Fireline Handbook Appendix B (PMS 410-2, 2006), Table 14 — condensed. */
export const SUPPRESSION_BANDS: SuppressionBand[] = [
  {
    flFt: '0–4 ft', range: [0, 4],
    summary: 'Direct attack — hand crews',
    detail: 'Fires can generally be attacked at the head or flanks by persons using hand tools. Handline should hold the fire.',
  },
  {
    flFt: '4–8 ft', range: [4, 8],
    summary: 'Too intense for hand tools — equipment',
    detail: 'Too intense for direct attack on the head with hand tools; handline cannot be relied on. Dozers, engines, and retardant aircraft can be effective.',
  },
  {
    flFt: '8–11 ft', range: [8, 11],
    summary: 'Serious control problems',
    detail: 'Torching, crowning, and spotting. Control efforts at the head of the fire will probably be ineffective.',
  },
  {
    flFt: '11+ ft', range: [11, 999],
    summary: 'Head attack ineffective',
    detail: 'Crowning, spotting, and major runs are common. Control efforts at the head of the fire are ineffective.',
  },
];

/** The hauling-chart bands a flame-length class overlaps (H = 8–12 ft spans
 * both the 8–11 and 11+ bands — both interpretations apply). */
export function suppressionBandsForFlameClass(fl: BehaviorClass): SuppressionBand[] {
  const [lo, hi] = BEHAVIOR_CLASSES[fl].flRange;
  return SUPPRESSION_BANDS.filter((b) => b.range[0] < hi && b.range[1] > lo);
}
