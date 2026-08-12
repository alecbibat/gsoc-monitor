// Which radar rendering engine to run.
//
//   v1  the original path: one imagery layer per timeline frame, tiles
//       recolored synchronously on the main thread
//   v2  the Motion Engine refit: worker recolor pipeline, and (from PR 2) two
//       ping-ponged layers instead of a stack per frame
//
// v2 is the default; v1 stays as the kill switch until Stage C stabilizes.
// Selection is `?radar=v1` (sticky — it persists so a reload keeps the choice)
// or the stored value, and `?radar=v2` switches back.

export type RadarEngine = 'v1' | 'v2';

const STORAGE_KEY = 'radarEngine';
// v2 is the default now that Stage A is complete. v1 stays reachable as
// `?radar=v1` for one release as the kill switch.
const DEFAULT_ENGINE: RadarEngine = 'v2';

function isEngine(v: string | null): v is RadarEngine {
  return v === 'v1' || v === 'v2';
}

let resolved: RadarEngine | null = null;

export function radarEngine(): RadarEngine {
  if (resolved) return resolved;
  let engine: RadarEngine = DEFAULT_ENGINE;
  try {
    const param = new URLSearchParams(window.location.search).get('radar');
    if (isEngine(param)) {
      engine = param;
      localStorage.setItem(STORAGE_KEY, param);
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isEngine(stored)) engine = stored;
    }
  } catch {
    // Private-mode localStorage throws on access; the default is fine.
  }
  resolved = engine;
  return engine;
}

// Read once per session so the engine cannot change under a mounted layer.
// Tests re-resolve through this.
export function resetRadarEngineForTest(): void {
  resolved = null;
}
