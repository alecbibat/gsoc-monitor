import { describe, expect, it } from 'vitest';
import {
  intensityBand,
  intensityLabel,
  LEGEND_MAX_DBZ,
  LEGEND_MIN_DBZ,
  legendBands,
  RAIN_INTENSITY,
  SNOW_INTENSITY,
} from './radarPalettes';

// One intensity scale drives both the legend's marks and the hover readout's
// wording, so the two can't drift apart.

describe('intensity scale', () => {
  it('rises through the bands in order', () => {
    for (const bands of [RAIN_INTENSITY, SNOW_INTENSITY]) {
      expect(bands[0].min).toBe(-Infinity);
      for (let i = 1; i < bands.length; i++) expect(bands[i].min).toBeGreaterThan(bands[i - 1].min);
    }
  });

  it('labels rain by the band a reading falls in, breaks inclusive', () => {
    expect(intensityLabel(-10, false)).toBe('Light rain');
    expect(intensityLabel(19.9, false)).toBe('Light rain');
    expect(intensityLabel(20, false)).toBe('Moderate rain');
    expect(intensityLabel(34, false)).toBe('Moderate rain');
    expect(intensityLabel(35, false)).toBe('Heavy rain');
    expect(intensityLabel(54, false)).toBe('Heavy rain');
    expect(intensityLabel(55, false)).toBe('Extreme · possible hail');
    expect(intensityLabel(80, false)).toBe('Extreme · possible hail');
  });

  it('labels snow on its own, lower scale', () => {
    expect(intensityLabel(3, true)).toBe('Light snow');
    expect(intensityLabel(15, true)).toBe('Moderate snow');
    expect(intensityLabel(25, true)).toBe('Heavy snow');
    expect(intensityLabel(60, true)).toBe('Heavy snow');
  });

  it('every readout label starts with its band name', () => {
    for (const b of RAIN_INTENSITY) {
      const dbz = Number.isFinite(b.min) ? b.min : 0;
      expect(intensityBand(dbz)).toBe(b);
      expect(intensityLabel(dbz, false).startsWith(b.name)).toBe(true);
    }
  });
});

describe('legendBands', () => {
  it('covers the legend range edge to edge, breaking where the labels do', () => {
    const bands = legendBands();
    expect(bands.map((b) => b.name)).toEqual(RAIN_INTENSITY.map((b) => b.name));
    expect(bands[0].from).toBe(LEGEND_MIN_DBZ);
    expect(bands[bands.length - 1].to).toBe(LEGEND_MAX_DBZ);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].from).toBe(bands[i - 1].to);
      expect(bands[i].from).toBe(RAIN_INTENSITY[i].min);
    }
  });

  it('spells out each span', () => {
    expect(legendBands().map((b) => b.range)).toEqual([
      'below 20 dBZ',
      '20–35 dBZ',
      '35–55 dBZ',
      '55 dBZ and above',
    ]);
  });
});
