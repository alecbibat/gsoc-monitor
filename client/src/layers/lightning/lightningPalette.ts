// Lightning symbology — the single source of truth for every place a strike is
// drawn: the globe (live + 24 h field), the map legend card, the share-globe
// legend, and the risk report's legend and canvas map. The server's display
// sampler uses the same stage ends (server/src/lightning/constants.ts); every
// /field response carries them so a mismatch is caught at runtime too.
//
// Every strike is an X. It is born white (with the bolt animation when seen
// live), then steps through one hot → cool ramp as it ages and expires at 24 h.
// Luminance falls monotonically stage to stage (also under deuteranopia and
// protanopia) and alpha/size shrink slightly, so recency reads at a glance on
// dark and satellite basemaps. Stages are discrete on purpose: a mark only
// needs repainting when it crosses a boundary, so a field of thousands of
// settled marks costs almost nothing to maintain.

export interface LightningStage {
  index: number;
  /** The stage applies while age < endS (seconds). */
  endS: number;
  hex: string;
  alpha: number;
  /** Billboard size in px (the X's bounding square). */
  sizePx: number;
  /** Tiny altitude lift (m) so newer marks win the depth test over older ones at the same spot. */
  liftM: number;
  label: string;
}

export const LIGHTNING_STAGES: readonly LightningStage[] = [
  { index: 0, endS: 120, hex: '#FFFFFF', alpha: 1.0, sizePx: 22, liftM: 7, label: '<2 min' },
  { index: 1, endS: 600, hex: '#FFE14D', alpha: 1.0, sizePx: 20, liftM: 6, label: '2–10 min' },
  { index: 2, endS: 1_800, hex: '#FF9D2E', alpha: 0.95, sizePx: 18, liftM: 5, label: '10–30 min' },
  { index: 3, endS: 3_600, hex: '#FF3B30', alpha: 0.9, sizePx: 17, liftM: 4, label: '30–60 min' },
  { index: 4, endS: 10_800, hex: '#E44069', alpha: 0.83, sizePx: 16, liftM: 3, label: '1–3 h' },
  { index: 5, endS: 43_200, hex: '#B72FDF', alpha: 0.71, sizePx: 15, liftM: 2, label: '3–12 h' },
  { index: 6, endS: 86_400, hex: '#524EC1', alpha: 0.69, sizePx: 14, liftM: 1, label: '12–24 h' },
];

export const STAGE_ENDS_S: readonly number[] = LIGHTNING_STAGES.map((s) => s.endS);

/** Marks expire (are removed) at this age. */
export const STRIKE_LIFETIME_S = 86_400;

/**
 * How long an individual live strike is kept as its own X — exactly the white
 * stage. After that only the server's stable sample of it remains, so the
 * thinning coincides with the white → yellow colour step and reads as ageing
 * rather than loss. (In a busy whole-globe view the live pool's caps can
 * retire the oldest white Xs sooner; LEGEND_NOTE says "up to 2 min".)
 */
export const LIVE_HOLD_S = LIGHTNING_STAGES[0].endS;

/** Stage index for an age in seconds; −1 once expired. Negative ages (clock skew) count as fresh. */
export function stageIndexForAge(ageS: number): number {
  if (!(ageS < STRIKE_LIFETIME_S)) return -1; // also catches NaN
  for (let i = 0; i < LIGHTNING_STAGES.length; i++) {
    if (ageS < LIGHTNING_STAGES[i].endS) return i;
  }
  return -1;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** CSS rgba() for a stage, alpha included. */
export function stageCss(i: number): string {
  const s = LIGHTNING_STAGES[Math.max(0, Math.min(LIGHTNING_STAGES.length - 1, i))];
  const [r, g, b] = hexToRgb(s.hex);
  return `rgba(${r},${g},${b},${s.alpha})`;
}

/**
 * Warn (once per distinct payload) when the server's stage ends differ from
 * ours — the sampler's strata would no longer line up with the colours.
 * Returns true when they match.
 */
let warnedStageEnds = '';
export function checkServerStageEnds(endsS: readonly number[] | undefined): boolean {
  if (!endsS) return true;
  const ok = endsS.length === STAGE_ENDS_S.length && endsS.every((v, i) => v === STAGE_ENDS_S[i]);
  const sig = endsS.join(',');
  if (!ok && warnedStageEnds !== sig) {
    warnedStageEnds = sig;
    console.warn('[lightning] server stage ends differ from the client palette', endsS, STAGE_ENDS_S);
  }
  return ok;
}

// The X glyph: a soft white glow, a thin dark casing (keeps the X legible over
// bright cloud tops and satellite imagery), then the white core. Drawn white
// once and tinted per mark via the billboard colour — the black casing stays
// black under any tint.
const X_PATH = 'M10 10 L26 26 M26 10 L10 26';
export const X_ICON_DATA_URI = (() => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">` +
    `<g fill="none" stroke-linecap="round">` +
    `<path d="${X_PATH}" stroke="#ffffff" stroke-width="8" opacity="0.25"/>` +
    `<path d="${X_PATH}" stroke="#000000" stroke-width="5.5" opacity="0.5"/>` +
    `<path d="${X_PATH}" stroke="#ffffff" stroke-width="3.5"/>` +
    `</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
})();

/** Inline SVG markup for an X swatch in a given colour (legends, print-safe). */
export function xGlyphSvg(color: string, px = 12): string {
  const d = 'M3 3 L13 13 M13 3 L3 13';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16" aria-hidden="true">` +
    `<g fill="none" stroke-linecap="round">` +
    `<path d="${d}" stroke="rgba(0,0,0,0.55)" stroke-width="4.5"/>` +
    `<path d="${d}" stroke="${color}" stroke-width="2.25"/>` +
    `</g></svg>`
  );
}

/** Draw one strike X on a 2D canvas (the risk report's map), centred on x/y. */
export function drawStrikeX(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  stage: number,
  sizePx = 9
): void {
  const h = sizePx / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - h, y - h);
  ctx.lineTo(x + h, y + h);
  ctx.moveTo(x + h, y - h);
  ctx.lineTo(x - h, y + h);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = stageCss(stage);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Legend rows, one per stage, freshest first. */
export const LEGEND_ITEMS: readonly { color: string; label: string; glyph: 'x' }[] = LIGHTNING_STAGES.map(
  (s) => ({ color: stageCss(s.index), label: s.label, glyph: 'x' as const })
);

export const LEGEND_NOTE =
  'Recent strikes show individually for up to 2 min; older ones are sampled (each active area keeps an X; zoom in for more).';
