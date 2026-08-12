// The altitude hybrid, and the finding that shapes it.
//
// Cesium primitives draw ABOVE all imagery, including the place-label overlay,
// and "labels stay above weather" is a house rule. The plan's resolution was to
// run the GPU primitive only where labels are faded out — but it assumed labels
// fade out when you zoom OUT. They do the opposite.
//
// `labelAlphaAt` in CesiumGlobe returns 0 below LABELS_FADE.near (55 km),
// ramping to 1 at LABELS_FADE.far (80 km): labels are INVISIBLE close in and
// fully visible zoomed out. So the primitive can only own the CLOSE-IN view,
// and the imagery path has to keep the regional and continental views — which
// is where animated precipitation is mostly watched.
//
// Handover therefore completes well below the point labels start appearing:
// the primitive is fully faded out by 55 km, so it can never cover a label.

/** Camera height (m) below which the primitive is at full strength. */
export const GL_FULL_HEIGHT = 45_000;
/** Camera height (m) at and above which only the imagery layers draw. */
export const GL_NONE_HEIGHT = 55_000;

// Spike-only escape hatch: `?radarglceiling=<metres>` lifts the handover so the
// primitive can be judged at a scale where you can actually see it. Inside the
// real band the view spans a couple of texels of one level-7 tile, which is
// enough to prove the shader runs and nothing like enough to prove it is right.
// Raising this puts the primitive OVER the place labels — fine for evaluating
// the render, never acceptable as a shipped default.
function ceilingOverride(): number | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('radarglceiling');
    if (!raw) return null;
    const metres = Number(raw);
    return Number.isFinite(metres) && metres > 0 ? metres : null;
  } catch {
    return null;
  }
}

let ceiling: number | null | undefined;
function noneHeight(): number {
  if (ceiling === undefined) ceiling = ceilingOverride();
  return ceiling ?? GL_NONE_HEIGHT;
}

function fullHeight(): number {
  const none = noneHeight();
  // Keep the crossfade band proportional when the ceiling is overridden.
  return none === GL_NONE_HEIGHT ? GL_FULL_HEIGHT : none * 0.8;
}

export interface HandoverMix {
  /** Alpha for the GPU primitive, 0–1. */
  gl: number;
  /** Alpha multiplier for the Stage A imagery layers, 0–1. */
  tiles: number;
  /** True when the primitive contributes nothing and can be skipped entirely. */
  glIdle: boolean;
}

export function handoverAt(cameraHeight: number): HandoverMix {
  if (!Number.isFinite(cameraHeight)) return { gl: 0, tiles: 1, glIdle: true };
  const full = fullHeight();
  const none = noneHeight();
  if (cameraHeight <= full) return { gl: 1, tiles: 0, glIdle: false };
  if (cameraHeight >= none) return { gl: 0, tiles: 1, glIdle: true };
  const t = (cameraHeight - full) / (none - full);
  // Complementary rather than both-at-full: the two paths draw the same field,
  // so overlapping them at full alpha would double the opacity of every echo.
  return { gl: 1 - t, tiles: t, glIdle: false };
}
