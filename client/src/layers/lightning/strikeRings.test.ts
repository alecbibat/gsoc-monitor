import * as Cesium from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RING_LIFE_MS,
  RING_PX_FAR,
  RING_PX_NEAR,
  createStrikeRings,
  ringFrame,
  ringFullPx,
} from './strikeRings';

describe('ringFullPx', () => {
  it('opens wider the further out the camera is, within the near and far sizes', () => {
    const heights = [150, 50_000, 300_000, 1_000_000, 3_000_000, 8_000_000, 40_000_000];
    const px = heights.map(ringFullPx);
    expect(px[0]).toBe(RING_PX_NEAR);
    expect(px[1]).toBe(RING_PX_NEAR);
    expect(px[px.length - 2]).toBe(RING_PX_FAR);
    expect(px[px.length - 1]).toBe(RING_PX_FAR);
    for (let i = 1; i < px.length; i++) expect(px[i]).toBeGreaterThanOrEqual(px[i - 1]);
    expect(px[3]).toBeGreaterThan(RING_PX_NEAR);
    expect(px[3]).toBeLessThan(RING_PX_FAR);
  });

  it('survives a nonsense height', () => {
    expect(ringFullPx(0)).toBe(RING_PX_NEAR);
    expect(ringFullPx(-5)).toBe(RING_PX_NEAR);
  });
});

describe('ringFrame', () => {
  it('starts around the X at full brightness and ends at full size, faded out', () => {
    const start = ringFrame(0, 60);
    expect(start.diameterPx).toBeGreaterThanOrEqual(12);
    expect(start.diameterPx).toBeLessThan(25);
    expect(start.alpha).toBe(1);
    expect(ringFrame(0, 30).diameterPx).toBe(12); // never smaller than the live X it rings
    const end = ringFrame(1, 60);
    expect(end.diameterPx).toBe(60);
    expect(end.alpha).toBe(0);
  });

  it('only ever grows and fades, holding full brightness through its first third', () => {
    let prev = ringFrame(0, 40);
    for (let i = 1; i <= 50; i++) {
      const f = ringFrame(i / 50, 40);
      expect(f.diameterPx).toBeGreaterThanOrEqual(prev.diameterPx);
      expect(f.alpha).toBeLessThanOrEqual(prev.alpha);
      if (i / 50 <= 0.3) expect(f.alpha).toBe(1);
      prev = f;
    }
    // It bursts out: half its growth in well under a third of its life.
    expect(ringFrame(0.25, 40).diameterPx).toBeGreaterThan((ringFrame(0, 40).diameterPx + 40) / 2);
  });

  it('clamps progress outside 0–1', () => {
    expect(ringFrame(-1, 50)).toEqual(ringFrame(0, 50));
    expect(ringFrame(3, 50)).toEqual(ringFrame(1, 50));
  });
});

describe('createStrikeRings', () => {
  // Just enough viewer for the rings: real Cesium points, no WebGL.
  function fakeViewer(heightM = 2e6) {
    const primitives: Cesium.PointPrimitiveCollection[] = [];
    const scene = {
      primitives: {
        add: (p: Cesium.PointPrimitiveCollection) => (primitives.push(p), p),
        remove: (p: Cesium.PointPrimitiveCollection) => {
          primitives.splice(primitives.indexOf(p), 1);
          p.destroy();
          return true;
        },
      },
      requestRender: vi.fn(),
    };
    const camera = { positionCartographic: Cesium.Cartographic.fromDegrees(-97, 35, heightM) };
    const viewer = { scene, camera, isDestroyed: () => false } as unknown as Cesium.Viewer;
    return { viewer, scene, primitives };
  }
  const shownRings = (c: Cesium.PointPrimitiveCollection) => {
    let n = 0;
    for (let i = 0; i < c.length; i++) if (c.get(i).show) n++;
    return n / 3;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('draws a white ring between two dark casings, sized for the zoom, and requests renders while it lives', () => {
    const { viewer, scene, primitives } = fakeViewer(8_000_000);
    const rings = createStrikeRings(viewer, 10);
    rings.spawn(-97, 35);
    const points = primitives[0];
    expect(points.length).toBe(3);
    const [outer, inner, core] = [points.get(0), points.get(1), points.get(2)];
    // The casings hug the white ring: inner ends where it starts, outer starts where it ends.
    expect(inner.pixelSize + 2 * inner.outlineWidth).toBeCloseTo(core.pixelSize);
    expect(outer.pixelSize).toBeCloseTo(core.pixelSize + 2 * core.outlineWidth);
    for (const pt of [outer, inner, core]) expect(pt.color.alpha).toBe(0); // rings, not discs
    expect(core.outlineColor.alpha).toBeGreaterThan(0.9);

    vi.advanceTimersByTime(RING_LIFE_MS - 100);
    expect(core.pixelSize).toBeGreaterThan(RING_PX_FAR - 2);
    expect(scene.requestRender.mock.calls.length).toBeGreaterThan(50);
    vi.advanceTimersByTime(200);
    expect(rings.active).toBe(0);
    expect(shownRings(points)).toBe(0);
    // The loop stops once the last ring is gone.
    const renders = scene.requestRender.mock.calls.length;
    vi.advanceTimersByTime(1_000);
    expect(scene.requestRender.mock.calls.length).toBe(renders);
  });

  it('makes the oldest ring give way at the cap, and reuses finished rings', () => {
    const { viewer, primitives } = fakeViewer();
    const rings = createStrikeRings(viewer, 2);
    rings.spawn(0, 0);
    vi.advanceTimersByTime(100);
    rings.spawn(1, 1);
    vi.advanceTimersByTime(100);
    rings.spawn(2, 2); // over the cap: the first ring's points are taken over
    const points = primitives[0];
    expect(rings.active).toBe(2);
    expect(points.length).toBe(6);
    const at = (i: number) => Cesium.Cartographic.fromCartesian(points.get(i).position);
    expect(Cesium.Math.toDegrees(at(2).longitude)).toBeCloseTo(2); // the reused first ring
    vi.advanceTimersByTime(RING_LIFE_MS + 50); // a frame past the last ring's end
    expect(rings.active).toBe(0);
    rings.spawn(3, 3);
    expect(points.length).toBe(6);
    expect(shownRings(points)).toBe(1);
  });

  it('removes its collection on destroy and ignores spawns after', () => {
    const { viewer, primitives } = fakeViewer();
    const rings = createStrikeRings(viewer, 4);
    rings.spawn(0, 0);
    const points = primitives[0];
    rings.destroy();
    expect(primitives).toHaveLength(0);
    expect(points.isDestroyed()).toBe(true);
    rings.spawn(1, 1);
    expect(rings.active).toBe(0);
    vi.advanceTimersByTime(RING_LIFE_MS);
    rings.destroy(); // twice is fine
  });
});
