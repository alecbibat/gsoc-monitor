import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  echoSwatch,
  hurricaneTooltipZone,
  radarReadout,
  READOUT_OFFSET_PX,
  readoutPlacement,
  type Box,
} from './radarHover';

const rgb = (css: string) => css.match(/\d+/g)!.map(Number);

describe('echoSwatch', () => {
  it('gives the palette colour for a visible echo', () => {
    const s = echoSwatch('classic', 42, false);
    expect(s.visible).toBe(true);
    expect(s.css).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Heavy rain in the classic ramp is orange-red, not green.
    const [r, g] = rgb(s.css);
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

describe('radarReadout', () => {
  it('names the band and rounds the dBZ it shows', () => {
    expect(radarReadout('classic', { dbz: 42.3, snow: false }, true)).toEqual({
      label: 'Heavy rain',
      dbz: 42,
      css: echoSwatch('classic', 42.3, false).css,
    });
  });

  it('labels from the rounded value, so the number and the word agree', () => {
    // 34.6 shows as "35 dBZ", which is where Heavy starts.
    expect(radarReadout('classic', { dbz: 34.6, snow: false }, true)).toMatchObject({ label: 'Heavy rain', dbz: 35 });
  });

  it('is null where the map paints nothing visible', () => {
    expect(radarReadout('classic', { dbz: 3, snow: false }, true)).toBeNull();
  });

  describe('snow', () => {
    it('with snow coloured separately: the snow ramp, from its lower floor', () => {
      const r = radarReadout('classic', { dbz: 4, snow: true }, true);
      expect(r).toEqual({ label: 'Light snow', dbz: 4, css: echoSwatch('classic', 4, true).css });
      // Near-white, not the rain ramp's green.
      const [red, green, blue] = rgb(r!.css);
      expect(Math.min(red, green, blue)).toBeGreaterThan(200);
    });

    it('with snow painted as rain: hidden where rain would be invisible', () => {
      // Classic rain fades in from 8 dBZ: a 4 dBZ snow pixel, visible in the
      // snow ramp, paints nothing as rain.
      expect(echoSwatch('classic', 4, true).visible).toBe(true);
      expect(radarReadout('classic', { dbz: 4, snow: true }, false)).toBeNull();
    });

    it('with snow painted as rain: the rain colour, still called snow', () => {
      const r = radarReadout('classic', { dbz: 30, snow: true }, false);
      expect(r).toEqual({ label: 'Heavy snow', dbz: 30, css: echoSwatch('classic', 30, false).css });
      expect(r!.css).not.toBe(echoSwatch('classic', 30, true).css);
    });
  });
});

describe('readoutPlacement', () => {
  const box = { w: 120, h: 24 };
  const area: Box = { left: 0, top: 0, right: 1000, bottom: 600 };
  const place = (x: number, y: number, blocked?: (b: Box) => boolean) =>
    readoutPlacement(x, y, box.w, box.h, area, blocked);
  const O = READOUT_OFFSET_PX;

  it('sits below-right of the cursor', () => {
    expect(place(100, 100)).toEqual({ left: 100 + O, top: 100 + O });
  });

  it('flips left near the right edge and up near the bottom', () => {
    expect(place(950, 100)).toEqual({ left: 950 - O - box.w, top: 100 + O });
    expect(place(100, 590)).toEqual({ left: 100 + O, top: 590 - O - box.h });
    expect(place(950, 590)).toEqual({ left: 950 - O - box.w, top: 590 - O - box.h });
  });

  it('respects an area that does not start at the origin', () => {
    const inset: Box = { left: 200, top: 100, right: 700, bottom: 400 };
    expect(readoutPlacement(210, 110, box.w, box.h, inset)).toEqual({ left: 210 + O, top: 110 + O });
    expect(readoutPlacement(690, 390, box.w, box.h, inset)).toEqual({ left: 690 - O - box.w, top: 390 - O - box.h });
  });

  it('goes above the cursor rather than over the dock below it', () => {
    // A scrubber dock across the bottom from y = 520.
    const dock: Box = { left: 200, top: 520, right: 800, bottom: 580 };
    const p = place(500, 500, (b) => boxesOverlap(b, dock));
    expect(p).toEqual({ left: 500 + O, top: 500 - O - box.h });
  });

  it('keeps clear of the hurricane tooltip, whichever corner it took', () => {
    const view = { w: 1000, h: 600 };
    const at = (x: number, y: number) => {
      const zone = hurricaneTooltipZone(x, y, view.w, view.h);
      const p = place(x, y, (b) => boxesOverlap(b, zone));
      const drawn = { left: p.left, top: p.top, right: p.left + box.w, bottom: p.top + box.h };
      expect(boxesOverlap(drawn, zone)).toBe(false);
      return p;
    };
    // Tooltip below-right → readout above-right.
    expect(at(300, 300)).toEqual({ left: 300 + O, top: 300 - O - box.h });
    // Near the bottom the tooltip flips up → readout stays below-right.
    expect(at(300, 500)).toEqual({ left: 300 + O, top: 500 + O });
    // Near the right edge the tooltip flips left → readout stays below-right
    // if it fits, else takes the free corner.
    expect(at(820, 300)).toEqual({ left: 820 + O, top: 300 + O });
    expect(at(950, 300)).toEqual({ left: 950 - O - box.w, top: 300 - O - box.h });
  });

  it('with no free corner, stays inside the map', () => {
    const p = readoutPlacement(50, 10, 120, 24, { left: 0, top: 0, right: 150, bottom: 40 }, () => true);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + 120).toBeLessThanOrEqual(150);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});

describe('hurricaneTooltipZone', () => {
  it('is the corner HurricaneTooltip draws in, flipped by its own margins', () => {
    expect(hurricaneTooltipZone(100, 100, 1200, 800)).toEqual({
      left: 100,
      top: 100,
      right: Infinity,
      bottom: Infinity,
    });
    expect(hurricaneTooltipZone(1000, 700, 1200, 800)).toEqual({
      left: -Infinity,
      top: -Infinity,
      right: 1000,
      bottom: 700,
    });
  });
});
