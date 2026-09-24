import { describe, expect, it, vi } from 'vitest';
import {
  LEGEND_ITEMS,
  LIGHTNING_STAGES,
  LIVE_HOLD_S,
  STAGE_ENDS_S,
  STRIKE_LIFETIME_S,
  checkServerStageEnds,
  drawStrikeX,
  stageCss,
  stageIndexForAge,
  xGlyphSvg,
} from './lightningPalette';

// Relative luminance (WCAG) of a stage colour composited over a background.
function lum(hex: string, alpha: number, bg: [number, number, number]): number {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c, i) => alpha * c + (1 - alpha) * bg[i]);
  const lin = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

describe('lightning palette', () => {
  it('pins the stage ends the server sampler also uses', () => {
    // server/src/lightning/constants.ts STAGE_ENDS_S must match.
    expect(STAGE_ENDS_S).toEqual([120, 600, 1800, 3600, 10800, 43200, 86400]);
    expect(STRIKE_LIFETIME_S).toBe(86_400);
    expect(LIVE_HOLD_S).toBe(120);
  });

  it('maps ages to stages at the boundaries and expires at 24 h', () => {
    expect(stageIndexForAge(-5)).toBe(0);
    expect(stageIndexForAge(0)).toBe(0);
    expect(stageIndexForAge(119.999)).toBe(0);
    expect(stageIndexForAge(120)).toBe(1);
    expect(stageIndexForAge(3_599)).toBe(3);
    expect(stageIndexForAge(3_600)).toBe(4);
    expect(stageIndexForAge(86_399)).toBe(6);
    expect(stageIndexForAge(86_400)).toBe(-1);
    expect(stageIndexForAge(Number.NaN)).toBe(-1);
  });

  it('fades monotonically: luminance strictly falls, alpha and size never grow', () => {
    for (const bg of [
      [11, 16, 22],
      [43, 58, 74],
      [74, 90, 58],
    ] as [number, number, number][]) {
      for (let i = 1; i < LIGHTNING_STAGES.length; i++) {
        const a = LIGHTNING_STAGES[i - 1];
        const b = LIGHTNING_STAGES[i];
        expect(lum(b.hex, b.alpha, bg)).toBeLessThan(lum(a.hex, a.alpha, bg));
      }
    }
    for (let i = 1; i < LIGHTNING_STAGES.length; i++) {
      expect(LIGHTNING_STAGES[i].alpha).toBeLessThanOrEqual(LIGHTNING_STAGES[i - 1].alpha);
      expect(LIGHTNING_STAGES[i].sizePx).toBeLessThanOrEqual(LIGHTNING_STAGES[i - 1].sizePx);
      expect(LIGHTNING_STAGES[i].liftM).toBeLessThan(LIGHTNING_STAGES[i - 1].liftM);
      expect(LIGHTNING_STAGES[i].endS).toBeGreaterThan(LIGHTNING_STAGES[i - 1].endS);
    }
  });

  it('keeps even the oldest stage visible on a near-black basemap', () => {
    const bg: [number, number, number] = [5, 7, 10];
    const oldest = LIGHTNING_STAGES[LIGHTNING_STAGES.length - 1];
    const contrast = (lum(oldest.hex, oldest.alpha, bg) + 0.05) / (lum('#05070a', 1, bg) + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(2);
  });

  it('builds legend items and CSS from the same table', () => {
    expect(LEGEND_ITEMS).toHaveLength(LIGHTNING_STAGES.length);
    expect(LEGEND_ITEMS[0]).toEqual({ color: 'rgba(255,255,255,1)', label: '<2 min', glyph: 'x' });
    expect(stageCss(99)).toBe(stageCss(LIGHTNING_STAGES.length - 1));
    expect(xGlyphSvg('#fff')).toContain('<svg');
  });

  it('draws the report X as a dark casing then the stage colour', () => {
    const strokes: string[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(function (this: { strokeStyle: string }) {
        strokes.push(this.strokeStyle);
      }),
      strokeStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
    };
    drawStrikeX(ctx as unknown as CanvasRenderingContext2D, 10, 10, 2);
    expect(strokes).toEqual(['rgba(0,0,0,0.55)', stageCss(2)]);
  });

  it('flags a server/client stage mismatch', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(checkServerStageEnds([...STAGE_ENDS_S])).toBe(true);
    expect(checkServerStageEnds(undefined)).toBe(true);
    expect(checkServerStageEnds([60, 600])).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
