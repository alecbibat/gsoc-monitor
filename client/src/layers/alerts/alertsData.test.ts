import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Topology } from 'topojson-specification';
import {
  alertCountyFips,
  alertOutline,
  alertRings,
  countyAtlasFromTopology,
  fetchActiveAlertsShared,
  type RawAlert,
} from './alertsData';

// Two unit squares side by side, sharing the edge x = 1 — the arc layout a
// county topology uses for two neighbours:
//   arc 0: the shared edge (1,0)→(1,1)
//   arc 1: the rest of the west square, arc 2: the rest of the east square.
const TOPO: Topology = {
  type: 'Topology',
  arcs: [
    [[1, 0], [1, 1]],
    [[1, 1], [0, 1], [0, 0], [1, 0]],
    [[1, 0], [2, 0], [2, 1], [1, 1]],
  ],
  objects: {
    counties: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: '01001', arcs: [[1, 0]] },
        { type: 'Polygon', id: '01003', arcs: [[2, -1]] },
      ],
    },
  },
};

function countyAlert(...same: string[]): RawAlert {
  return { geometry: null, properties: { id: 'a', geocode: { SAME: same } } };
}

function totalLength(lines: number[][][]): number {
  let len = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
  }
  return len;
}

function hasSegment(lines: number[][][], a: number[], b: number[]): boolean {
  const eq = (p: number[], q: number[]) => p[0] === q[0] && p[1] === q[1];
  return lines.some((line) =>
    line.some((p, i) => i > 0 && ((eq(line[i - 1], a) && eq(p, b)) || (eq(line[i - 1], b) && eq(p, a))))
  );
}

describe('alertCountyFips', () => {
  it('turns 6-digit SAME codes into 5-digit FIPS, deduped', () => {
    expect(alertCountyFips(countyAlert('001001', '001003', '001001'))).toEqual(['01001', '01003']);
  });

  it('maps retired county codes to their successors', () => {
    expect(alertCountyFips(countyAlert('046113', '002270', '051515'))).toEqual(['46102', '02158', '51019']);
  });
});

describe('county atlas', () => {
  const atlas = countyAtlasFromTopology(TOPO);

  it('builds a polygon per county, keyed by FIPS', () => {
    expect([...atlas.geometries.keys()]).toEqual(['01001', '01003']);
    expect(alertRings(countyAlert('001001'), atlas.geometries)).toHaveLength(1);
  });

  it('merges an alert’s counties into one outline without their shared border', () => {
    const lines = alertOutline(countyAlert('001001', '001003'), atlas);
    // The 2×1 rectangle's perimeter — the inner edge x = 1 is gone.
    expect(totalLength(lines)).toBeCloseTo(6);
    expect(hasSegment(lines, [1, 0], [1, 1])).toBe(false);
  });

  it('outlines a single county on all four sides', () => {
    const lines = alertOutline(countyAlert('001001'), atlas);
    expect(totalLength(lines)).toBeCloseTo(4);
    expect(hasSegment(lines, [1, 0], [1, 1])).toBe(true);
  });

  it('uses an alert’s own polygon when it has one', () => {
    const ring = [[5, 5], [6, 5], [6, 6], [5, 5]];
    const alert: RawAlert = {
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { id: 'storm', geocode: { SAME: ['001001'] } },
    };
    expect(alertOutline(alert, atlas)).toEqual([ring]);
  });

  it('has nothing to draw for counties the atlas does not know', () => {
    expect(alertOutline(countyAlert('099999'), atlas)).toEqual([]);
    expect(alertOutline(countyAlert('001001'), null)).toEqual([]);
  });
});

describe('fetchActiveAlertsShared', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves calls inside the window from one download, and retries after a failure', async () => {
    let calls = 0;
    let fail = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (fail) return new Response('nope', { status: 503 });
        return new Response(JSON.stringify({ features: [{ geometry: null, properties: { id: `x${calls}` } }] }));
      })
    );
    const t0 = 1_000_000;
    const first = await fetchActiveAlertsShared(t0);
    const again = await fetchActiveAlertsShared(t0 + 10_000);
    expect(again).toBe(first);
    expect(calls).toBe(1);

    // Past the window: a fresh download (whose failure — both the direct
    // path and the proxy — is not cached).
    fail = true;
    await expect(fetchActiveAlertsShared(t0 + 40_000)).rejects.toThrow();
    const failedCalls = calls;
    fail = false;
    const after = await fetchActiveAlertsShared(t0 + 41_000);
    expect(calls).toBeGreaterThan(failedCalls);
    expect(after[0].properties.id).toBe(`x${calls}`);
  });
});
