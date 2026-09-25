import { describe, expect, it } from 'vitest';
import { NO_ECHO, type RadarGrid } from './radarDecode';
import { intensityLabel, legendGradient, paletteLut, RADAR_PALETTES, sampleStops } from './radarPalettes';
import { renderRadarTile, sampleGrid } from './radarRender';

function grid(w: number, h: number, fill: (x: number, y: number) => number, snowAt?: (x: number, y: number) => boolean): RadarGrid {
  const dbz = new Int8Array(w * h);
  const snow = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      dbz[y * w + x] = fill(x, y);
      snow[y * w + x] = snowAt?.(x, y) ? 1 : 0;
    }
  }
  return { width: w, height: h, dbz, snow };
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('palettes', () => {
  it('keeps brightness from falling as rain gets heavier (light → heavy)', () => {
    // The served ramp goes light cyan → navy: stronger echo reads darker on a
    // dark map. The recoloured palettes must not repeat that between light
    // and heavy rain (they may dip into red cores, which are saturated).
    for (const id of ['classic', 'vivid'] as const) {
      const lut = paletteLut(id).rain;
      const at = (dbz: number) => {
        const k = Math.round((dbz + 32) * 4) * 4;
        return lum(lut[k], lut[k + 1], lut[k + 2]) * (lut[k + 3] / 255);
      };
      expect(at(15)).toBeLessThan(at(30));
      expect(at(30)).toBeLessThan(at(40));
    }
  });

  it('drops the clutter band and fades light echo in', () => {
    const lut = paletteLut('classic').rain;
    const alpha = (dbz: number) => lut[Math.round((dbz + 32) * 4) * 4 + 3];
    expect(alpha(0)).toBe(0);
    expect(alpha(5)).toBe(0);
    expect(alpha(12)).toBeGreaterThan(80);
    expect(alpha(12)).toBeLessThan(160);
    expect(alpha(50)).toBe(255);
  });

  it('reproduces the served colours for the RainViewer palette', () => {
    const lut = paletteLut('rainviewer').rain;
    const k = (20 + 32) * 4 * 4;
    expect(Array.from(lut.subarray(k, k + 4))).toEqual([0, 163, 224, 255]); // #00a3e0
  });

  it('interpolates stops and builds legend gradients for every palette', () => {
    expect(sampleStops([[0, '#000000', 0], [10, '#ffffff', 1]], 5)).toEqual([127.5, 127.5, 127.5, 0.5]);
    for (const p of RADAR_PALETTES) expect(legendGradient(p.id)).toMatch(/^linear-gradient\(to right, rgba/);
  });

  it('labels intensity in plain language', () => {
    expect(intensityLabel(12, false)).toBe('Light rain');
    expect(intensityLabel(30, false)).toBe('Moderate rain');
    expect(intensityLabel(40, false)).toBe('Heavy rain');
    expect(intensityLabel(60, false)).toMatch(/hail/);
    expect(intensityLabel(10, true)).toBe('Light snow');
  });
});

describe('renderRadarTile', () => {
  const lut = paletteLut('classic');

  it('returns nothing for a tile without visible echo', () => {
    expect(renderRadarTile(grid(4, 4, () => NO_ECHO), lut, { sigma: 0.8, flipY: false, snow: true })).toBeNull();
    // Echo below the palette's threshold (clutter) is not visible either.
    expect(renderRadarTile(grid(4, 4, () => 2), lut, { sigma: 0, flipY: false, snow: true })).toBeNull();
  });

  it('bleeds edge colour a couple of pixels, then fills with the ramp floor', () => {
    const g = grid(8, 1, (x) => (x === 0 ? 45 : NO_ECHO));
    const out = renderRadarTile(g, lut, { sigma: 0, flipY: false, snow: true })!;
    const rgb = (x: number) => Array.from(out.subarray(x * 4, x * 4 + 3));
    expect(out[3]).toBe(255);
    expect(rgb(1)).toEqual(rgb(0)); // bled
    expect(rgb(2)).toEqual(rgb(0));
    expect(out[1 * 4 + 3]).toBe(0); // but transparent
    expect(rgb(6)).toEqual(lut.edgeRgb);
  });

  it('paints echo through the palette and flips rows when asked', () => {
    // Top row heavy, rest empty.
    const g = grid(8, 8, (_x, y) => (y === 0 ? 45 : NO_ECHO));
    const upright = renderRadarTile(g, lut, { sigma: 0, flipY: false, snow: true })!;
    const flipped = renderRadarTile(g, lut, { sigma: 0, flipY: true, snow: true })!;
    expect(upright[3]).toBe(255);
    expect(upright[7 * 8 * 4 + 3]).toBe(0);
    expect(flipped[3]).toBe(0);
    expect(flipped[7 * 8 * 4 + 3]).toBe(255);
  });

  it('smooths in data space: a hard step becomes a graded edge without foreign hues', () => {
    const g = grid(16, 1, (x) => (x < 8 ? 40 : NO_ECHO));
    const out = renderRadarTile(g, lut, { sigma: 1, flipY: false, snow: true })!;
    const alphas = Array.from({ length: 16 }, (_, x) => out[x * 4 + 3]);
    // Monotone non-increasing across the edge, with intermediate values.
    for (let x = 1; x < 16; x++) expect(alphas[x]).toBeLessThanOrEqual(alphas[x - 1]);
    expect(alphas.some((a) => a > 0 && a < 250)).toBe(true);
  });

  it('uses the snow ramp where the source was snow, blended across the boundary', () => {
    const g = grid(24, 1, () => 25, (x) => x >= 12);
    const out = renderRadarTile(g, lut, { sigma: 0, flipY: false, snow: true })!;
    const rgb = (x: number) => Array.from(out.subarray(x * 4, x * 4 + 3));
    expect(rgb(0)).not.toEqual(rgb(23));
    expect(rgb(23)[2]).toBeGreaterThan(rgb(23)[1] - 40); // icy, not green
    expect(rgb(23)[0]).toBeGreaterThan(150);
    // The seam grades over a few pixels instead of switching at one.
    const g11 = rgb(11)[1];
    expect(g11).not.toEqual(rgb(0)[1]);
    expect(g11).not.toEqual(rgb(23)[1]);
  });

  it('paints snow as rain when snow shading is off', () => {
    const g = grid(2, 1, () => 25, (x) => x === 1);
    const out = renderRadarTile(g, lut, { sigma: 0, flipY: false, snow: false })!;
    expect(Array.from(out.subarray(0, 4))).toEqual(Array.from(out.subarray(4, 8)));
  });
});

describe('sampleGrid', () => {
  it('reports the strongest echo under the cursor, or null', () => {
    const g = grid(5, 5, (x, y) => (x === 2 && y === 2 ? 50 : x < 2 ? 20 : NO_ECHO), (x) => x === 0);
    expect(sampleGrid(g, 2.2, 1.8)).toEqual({ dbz: 50, snow: false });
    expect(sampleGrid(g, 0, 0)).toEqual({ dbz: 20, snow: true });
    expect(sampleGrid(g, 4.4, 4.4)).toBeNull();
  });
});
