// Which radar tiles the view actually needs.
//
// The prefetcher has to know the tile coordinates covering the current view in
// order to warm the OTHER frames' copies of them. Deriving that independently
// means reimplementing Cesium's level selection (`_getLevelWithMaximumTexelSpacing`
// and friends, all private) and keeping the reimplementation in step with it
// forever. Observing it instead is exact and free: the visible layer already
// asks for precisely the tiles it needs, so `RadarFrameProvider` reports every
// coordinate Cesium requests and this module remembers the recent ones.
//
// Entries age out so that panning away from a region stops us warming tiles
// nobody is looking at any more.

export interface TileCoord {
  level: number;
  x: number;
  y: number;
}

const MAX_AGE_MS = 90_000;
// A generous ceiling on how many tiles one view can need; well above the ~7-20
// a normal viewport asks for, low enough to bound the warming work if a wild
// camera path leaves a long trail.
const MAX_TILES = 64;

const seen = new Map<string, { coord: TileCoord; at: number }>();

export function noteTileRequested(level: number, x: number, y: number): void {
  const key = `${level}/${x}/${y}`;
  const existing = seen.get(key);
  if (existing) {
    existing.at = performance.now();
    return;
  }
  seen.set(key, { coord: { level, x, y }, at: performance.now() });
}

// The tiles the view has needed recently, most recent first.
export function recentTiles(): TileCoord[] {
  const now = performance.now();
  const live: Array<{ coord: TileCoord; at: number }> = [];
  for (const [key, entry] of seen) {
    if (now - entry.at > MAX_AGE_MS) seen.delete(key);
    else live.push(entry);
  }
  live.sort((a, b) => b.at - a.at);
  return live.slice(0, MAX_TILES).map((e) => e.coord);
}

// Forget everything — used when the layer is torn down so a later session does
// not inherit a stale view.
export function clearVisibleTiles(): void {
  seen.clear();
}
