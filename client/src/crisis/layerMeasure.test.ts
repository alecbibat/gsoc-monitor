import { describe, expect, it } from 'vitest';
import { measureLayer } from './layerMeasure';

// Roughly 1° of longitude apart at the equator (~111 km), which makes the
// expected numbers easy to reason about.
const A = { lat: 0, lon: 0 };
const B = { lat: 0, lon: 1 };
const C = { lat: 1, lon: 1 };

describe('measureLayer', () => {
  it('measures a two-point line with its bearing', () => {
    const m = measureLayer({ geometry: 'line', positions: [A, B] });
    expect(m.kind).toBe('length');
    expect(m.primary).toMatch(/^111\.\d\d km · 69\.\d\d mi$/);
    expect(m.detail).toContain('nm');
    expect(m.detail).toContain('bearing 090° E');
    expect(m.summary).toBe(`${m.primary} · ${m.detail}`);
    expect(Math.round(m.lengthM ?? 0)).toBe(111319);
  });

  it('measures a multi-leg path by vertex count, not a made-up heading', () => {
    const m = measureLayer({ geometry: 'line', positions: [A, B, C] });
    expect(m.kind).toBe('length');
    expect(m.detail).toContain('3 pts');
    expect(m.detail).not.toContain('bearing');
  });

  it('treats a directional arrow like the line it is', () => {
    const line = measureLayer({ geometry: 'line', positions: [A, B] });
    const arrow = measureLayer({ geometry: 'line', directional: true, positions: [A, B] });
    expect(arrow).toEqual(line);
  });

  it('measures a polygon as area plus perimeter', () => {
    const m = measureLayer({ geometry: 'polygon', positions: [A, B, C] });
    expect(m.kind).toBe('area');
    expect(m.primary).toMatch(/km²/);
    expect(m.detail).toContain('perimeter');
    expect(m.detail).toContain('3 pts');
    expect(m.areaM2).toBeGreaterThan(0);
  });

  it('falls back to a distance for a two-point polygon', () => {
    const m = measureLayer({ geometry: 'polygon', positions: [A, B] });
    expect(m.kind).toBe('length');
    expect(m.primary).toMatch(/km/);
  });

  it('reports a point layer as a readable position', () => {
    const m = measureLayer({ geometry: 'point', positions: [{ lat: 20.8911, lon: -156.47 }] });
    expect(m.kind).toBe('position');
    expect(m.primary).toBe('20.8911°N 156.4700°W');
    expect(m.detail).toBe('');
  });

  it('counts multiple markers on one point layer', () => {
    const m = measureLayer({ geometry: 'point', positions: [A, B] });
    expect(m.kind).toBe('position');
    expect(m.detail).toBe('2 markers');
  });

  it('says nothing rather than zero when there is nothing to measure', () => {
    expect(measureLayer({ geometry: 'line', positions: [] }).kind).toBe('none');
    expect(measureLayer({ geometry: 'line', positions: [A] }).kind).toBe('none');
    expect(measureLayer({ geometry: 'polygon', positions: [] }).kind).toBe('none');
    expect(measureLayer({ geometry: 'point', positions: [] }).summary).toBe('');
  });
});
