import { describe, expect, it } from 'vitest';
import { buildTimeline, useRadarStore } from './radarStore';
import { getUsAnchors, usFrameStamp, usTileTemplate } from './sources';
import { getStormLut } from './palettes';
import type { RadarFrame } from '../../types';

const rv = (time: number): RadarFrame => ({ time, path: `/v2/radar/hash-${time}` });

describe('buildTimeline', () => {
  const base = 1_788_280_800; // 2026-09-01T17:20:00Z, minute % 5
  const usFrames = Array.from({ length: 12 }, (_, i) => base - (11 - i) * 300);
  const globalFrames = Array.from({ length: 6 }, (_, i) => rv(base - (5 - i) * 600));

  it('us-only coverage lists exactly the windowed US frames', () => {
    const tl = buildTimeline({ coverage: 'us', windowMinutes: 60, usFrames, globalFrames });
    expect(tl.map((s) => s.time)).toEqual(usFrames);
    expect(tl.every((s) => s.global === null)).toBe(true);
  });

  it('global-only coverage ignores US frames entirely', () => {
    const tl = buildTimeline({ coverage: 'global', windowMinutes: 60, usFrames, globalFrames });
    expect(tl.map((s) => s.time)).toEqual(globalFrames.map((f) => f.time));
    expect(tl.every((s) => s.us === null)).toBe(true);
  });

  it('auto merges near-duplicate times onto HD slots instead of doubling them', () => {
    const tl = buildTimeline({ coverage: 'auto', windowMinutes: 60, usFrames, globalFrames });
    // Every global time coincides with a US time here, so the union is just
    // the US frame list — no duplicate slots.
    expect(tl.map((s) => s.time)).toEqual(usFrames);
    // 10-min global frames map onto the 5-min slots between them too.
    expect(tl.every((s) => s.global !== null)).toBe(true);
  });

  it('slots are strictly increasing even with offset global times', () => {
    const offsetGlobal = [rv(base - 870), rv(base - 270)]; // not aligned to HD times
    const tl = buildTimeline({
      coverage: 'auto',
      windowMinutes: 60,
      usFrames,
      globalFrames: offsetGlobal,
    });
    for (let i = 1; i < tl.length; i++) expect(tl[i].time).toBeGreaterThan(tl[i - 1].time);
  });

  it('windows relative to the newest frame across both sources', () => {
    const tl = buildTimeline({ coverage: 'auto', windowMinutes: 60, usFrames, globalFrames });
    const oldest = Math.min(...tl.map((s) => s.time));
    expect(base - oldest).toBeLessThanOrEqual(60 * 60);
  });

  it('a channel with no frame near a slot shows nothing for it', () => {
    const tl = buildTimeline({
      coverage: 'auto',
      windowMinutes: 120,
      usFrames: [base], // single HD frame
      globalFrames,
    });
    const early = tl[0];
    expect(early.time).toBeLessThan(base - 600);
    expect(early.us).toBeNull(); // no HD frame within tolerance of old slots
  });
});

describe('live pinning', () => {
  it('follows the newest frame only when already on it', () => {
    const t0 = 1_788_280_800;
    const manifest = (latest: number) => ({
      global: null,
      us: { frames: [latest - 600, latest - 300, latest], intervalSec: 300 },
      generated: latest,
    });
    const s = useRadarStore.getState();
    s.setManifest(manifest(t0));
    const len = buildTimeline(useRadarStore.getState()).length;
    useRadarStore.getState().setCurrentIndex(len - 1); // sit on LIVE
    useRadarStore.getState().setManifest(manifest(t0 + 300));
    let st = useRadarStore.getState();
    expect(st.currentIndex).toBe(buildTimeline(st).length - 1); // still LIVE

    useRadarStore.getState().setCurrentIndex(0); // scrub to the past
    useRadarStore.getState().setManifest(manifest(t0 + 600));
    st = useRadarStore.getState();
    expect(st.currentIndex).toBe(0); // not yanked back to LIVE
  });
});

describe('usFrameStamp / usTileTemplate', () => {
  it('formats UTC minute-resolution stamps', () => {
    // 2026-01-05T04:05:00Z
    expect(usFrameStamp(Date.UTC(2026, 0, 5, 4, 5) / 1000)).toBe('202601050405');
    // midnight rollover
    expect(usFrameStamp(Date.UTC(2026, 11, 31, 23, 55) / 1000)).toBe('202612312355');
  });

  it('builds the IEM ridge:: template with standard XYZ placeholders', () => {
    const url = usTileTemplate(Date.UTC(2026, 8, 1, 17, 20) / 1000);
    expect(url).toContain('ridge::USCOMP-N0Q-202609011720');
    expect(url).toContain('/c/tile.py/1.0.0/');
    expect(url).toContain('{z}/{x}/{y}.png');
    expect(url).not.toContain('reverseY'); // XYZ, never TMS-flipped
  });
});

describe('palette inversion tables', () => {
  it('decodes 255 N0Q anchors mapping index i+1 to magnitude i', () => {
    const anchors = getUsAnchors();
    expect(anchors).toHaveLength(255);
    anchors.forEach((a, i) => expect(a.magnitude).toBe(i));
    // Documented spot colors: dBZ -> index = 2*dBZ + 65 -> anchor[idx-1].
    const at = (dbz: number) => anchors[2 * dbz + 65 - 1];
    expect([at(25).r, at(25).g, at(25).b]).toEqual([14, 179, 20]); // green
    expect([at(40).r, at(40).g, at(40).b]).toEqual([255, 226, 0]); // yellow
    expect([at(0).r, at(0).g, at(0).b]).toEqual([144, 152, 180]);
  });

  it('storm LUT is transparent below the clutter floor and opaque at extremes', () => {
    const lut = getStormLut();
    const alphaAt = (dbz: number) => lut[Math.round(2 * (dbz + 32)) * 4 + 3];
    expect(alphaAt(-10)).toBe(0);
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(20)).toBeGreaterThan(100);
    expect(alphaAt(60)).toBeGreaterThan(240);
  });
});
