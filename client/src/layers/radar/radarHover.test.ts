import { describe, expect, it } from 'vitest';
import { echoSwatch, READOUT_OFFSET_PX, readoutPlacement } from './radarHover';

describe('echoSwatch', () => {
  it('gives the palette colour for a visible echo', () => {
    const s = echoSwatch('classic', 42, false);
    expect(s.visible).toBe(true);
    expect(s.css).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Heavy rain in the classic ramp is orange-red, not green.
    const [r, g] = s.css.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(g);
  });

  it('paints snow in the snow ramp', () => {
    expect(echoSwatch('classic', 25, true).css).not.toBe(echoSwatch('classic', 25, false).css);
  });

  it('calls clutter the palettes fade out invisible', () => {
    expect(echoSwatch('classic', 2, false).visible).toBe(false);
    expect(echoSwatch('vivid', 0, false).visible).toBe(false);
  });

  it('clamps readings outside the colour table', () => {
    expect(echoSwatch('classic', 500, false).visible).toBe(true);
    expect(echoSwatch('classic', -500, false).visible).toBe(false);
  });
});

describe('readoutPlacement', () => {
  const box = { w: 120, h: 24 };
  const area = { w: 1000, h: 600 };
  const place = (x: number, y: number) => readoutPlacement(x, y, box.w, box.h, area.w, area.h);

  it('sits below-right of the cursor', () => {
    expect(place(100, 100)).toEqual({ left: 100 + READOUT_OFFSET_PX, top: 100 + READOUT_OFFSET_PX });
  });

  it('flips left near the right edge and up near the bottom', () => {
    expect(place(950, 100).left).toBe(950 - READOUT_OFFSET_PX - box.w);
    expect(place(100, 590).top).toBe(590 - READOUT_OFFSET_PX - box.h);
  });

  it('stays inside the map when there is no room either side', () => {
    const p = readoutPlacement(50, 10, 120, 24, 150, 40);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + 120).toBeLessThanOrEqual(150);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});
