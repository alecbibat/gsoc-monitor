// Line helpers for road geometry: GeoJSON → polylines, simplification, and
// rounding, so a feed's dense lines travel light to the browser.

type Geometry = { type?: string; coordinates?: unknown } | null | undefined;

const isPos = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1] as number) <= 90 && Math.abs(p[0] as number) <= 180;

/** Polylines and a point from a GeoJSON geometry; point-like geometries yield no lines. */
export function linesFromGeometry(g: Geometry): { lines: number[][][]; point: [number, number] | null } {
  if (!g || typeof g !== 'object') return { lines: [], point: null };
  const c = g.coordinates as unknown;
  const line = (arr: unknown) => (Array.isArray(arr) ? arr.filter(isPos).map((p) => [p[0], p[1]]) : []);
  switch (g.type) {
    case 'LineString': {
      const l = line(c);
      return { lines: l.length >= 2 ? [l] : [], point: l.length === 1 ? [l[0][0], l[0][1]] : null };
    }
    case 'MultiLineString':
      return { lines: Array.isArray(c) ? c.map(line).filter((l) => l.length >= 2) : [], point: null };
    case 'Point':
      return { lines: [], point: isPos(c) ? [c[0], c[1]] : null };
    case 'MultiPoint': {
      // WZDx's MultiPoint is a start and end point, not a path: a straight line
      // between them would cut across country, so it is shown as a marker.
      const pts = line(c);
      return { lines: [], point: pts.length > 0 ? [pts[0][0], pts[0][1]] : null };
    }
    default:
      return { lines: [], point: null };
  }
}

/** Squared distance from p to segment ab, in degrees² (fine at the ~10 m scale used here). */
function segDist2(p: number[], a: number[], b: number[], kx: number): number {
  const ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1], px = p[0] * kx, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Douglas–Peucker with a tolerance in degrees of latitude (1e-4 ≈ 11 m). */
export function simplifyLine(line: number[][], tolDeg = 1e-4): number[][] {
  if (line.length <= 2) return line;
  const kx = Math.cos((line[0][1] * Math.PI) / 180);
  const tol2 = tolDeg * tolDeg;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist2(line[k], line[i], line[j], kx);
      if (d > worst) { worst = d; at = k; }
    }
    if (at >= 0 && worst > tol2) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Simplified and rounded to ~1 m. */
export function compactLines(lines: number[][][]): number[][][] {
  return lines.map((l) => simplifyLine(l).map((p) => [r5(p[0]), r5(p[1])])).filter((l) => l.length >= 2);
}

/** [west, south, east, north] of a set of lines. */
export function linesBbox(lines: number[][][]): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) for (const [x, y] of l) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}
