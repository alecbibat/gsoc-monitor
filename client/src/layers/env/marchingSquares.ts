// ── Marching squares over a lat/lon scalar grid ──────────────────────────────
// Produces contour polylines (isobars, isotherms) from the server's regional
// environmental grid. Pure and dependency-free so it unit-tests directly.
//
// Grid layout matches the wind/env routes: row-major, rows south→north,
// columns west→east; index = row * nx + col.

export interface ScalarGrid {
  nx: number;
  ny: number;
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  values: (number | null)[];
}

export type ContourLine = Array<[number, number]>; // [lon, lat] points

interface Pt {
  lon: number;
  lat: number;
  /** Identity of the grid edge this point lies on — exact segment chaining
   * without floating-point endpoint matching. */
  key: string;
}

interface Seg { a: Pt; b: Pt }

// Cell edges: 0 = bottom (A→B), 1 = right (B→C), 2 = top (D→C), 3 = left (A→D)
// with corners A=(c,r) B=(c+1,r) C=(c+1,r+1) D=(c,r+1).

export function contourLines(grid: ScalarGrid, level: number): ContourLine[] {
  const { nx, ny, lon0, lat0, dLon, dLat, values } = grid;
  const v = (c: number, r: number) => values[r * nx + c];

  const segs: Seg[] = [];

  const interp = (
    va: number, vb: number,
    lonA: number, latA: number, lonB: number, latB: number,
    key: string
  ): Pt => {
    const t = va === vb ? 0.5 : (level - va) / (vb - va);
    return { lon: lonA + (lonB - lonA) * t, lat: latA + (latB - latA) * t, key };
  };

  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const vA = v(c, r), vB = v(c + 1, r), vC = v(c + 1, r + 1), vD = v(c, r + 1);
      if (vA === null || vB === null || vC === null || vD === null) continue;

      const idx = (vA >= level ? 1 : 0) | (vB >= level ? 2 : 0) | (vC >= level ? 4 : 0) | (vD >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;

      const lonW = lon0 + c * dLon, lonE = lon0 + (c + 1) * dLon;
      const latS = lat0 + r * dLat, latN = lat0 + (r + 1) * dLat;
      const edge = (e: 0 | 1 | 2 | 3): Pt => {
        switch (e) {
          case 0: return interp(vA, vB, lonW, latS, lonE, latS, `h:${c}:${r}`);
          case 1: return interp(vB, vC, lonE, latS, lonE, latN, `v:${c + 1}:${r}`);
          case 2: return interp(vD, vC, lonW, latN, lonE, latN, `h:${c}:${r + 1}`);
          case 3: return interp(vA, vD, lonW, latS, lonW, latN, `v:${c}:${r}`);
        }
      };
      const add = (e1: 0 | 1 | 2 | 3, e2: 0 | 1 | 2 | 3) => segs.push({ a: edge(e1), b: edge(e2) });

      switch (idx) {
        case 1: case 14: add(3, 0); break;
        case 2: case 13: add(0, 1); break;
        case 4: case 11: add(1, 2); break;
        case 8: case 7: add(2, 3); break;
        case 3: case 12: add(3, 1); break;
        case 6: case 9: add(0, 2); break;
        case 5: { // A,C inside — ambiguous saddle, resolved by the cell center
          const center = (vA + vB + vC + vD) / 4;
          if (center >= level) { add(0, 1); add(2, 3); }
          else { add(3, 0); add(1, 2); }
          break;
        }
        case 10: { // B,D inside — the mirror saddle
          const center = (vA + vB + vC + vD) / 4;
          if (center >= level) { add(3, 0); add(1, 2); }
          else { add(0, 1); add(2, 3); }
          break;
        }
      }
    }
  }

  // Chain segments into polylines by shared edge identity.
  const byKey = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [s.a.key, s.b.key]) {
      const arr = byKey.get(k);
      if (arr) arr.push(i); else byKey.set(k, [i]);
    }
  });

  const used = new Array<boolean>(segs.length).fill(false);
  const lines: ContourLine[] = [];

  const nextSeg = (key: string): number => {
    for (const i of byKey.get(key) ?? []) if (!used[i]) return i;
    return -1;
  };

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts: Pt[] = [segs[i].a, segs[i].b];

    // Extend forward from the tail…
    for (;;) {
      const tail = pts[pts.length - 1];
      const j = nextSeg(tail.key);
      if (j < 0) break;
      used[j] = true;
      pts.push(segs[j].a.key === tail.key ? segs[j].b : segs[j].a);
    }
    // …then backward from the head.
    for (;;) {
      const head = pts[0];
      const j = nextSeg(head.key);
      if (j < 0) break;
      used[j] = true;
      pts.unshift(segs[j].a.key === head.key ? segs[j].b : segs[j].a);
    }

    lines.push(pts.map((p) => [p.lon, p.lat]));
  }

  return lines;
}

/** Contour levels spanning a field's finite values at a fixed interval,
 * aligned to multiples of the interval (1012, 1016 … for 4 hPa isobars). */
export function contourLevels(values: (number | null)[], intervalV: number): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const x of values) {
    if (x === null) continue;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const out: number[] = [];
  for (let l = Math.ceil(min / intervalV) * intervalV; l <= max; l += intervalV) out.push(l);
  return out;
}
