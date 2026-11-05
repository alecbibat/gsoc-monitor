import { describe, expect, it } from 'vitest';
import { PARK_AREAS, parkAreaFor } from './area';
import { compactLines, linesFromGeometry, simplifyLine } from './geometry';
import { collectRoadClosures, type RoadSource } from './service';
import type { RoadClosure } from './types';
import { mergeDirections, normalizeWzdxFeature, normalizeWzdxFeed, wzdxImpact, type WzdxFeature, type WzdxFeed } from './wzdx';

const NOW = Date.parse('2026-11-05T15:00:00Z');
const opts = { source: 'nps', labelFor: () => 'Grand Teton (NPS)', now: NOW };

// Trimmed from the live NPS /roadevents feed (WZDx 4.1), 2026-11-05: Grand
// Teton's Moose-Wilson Road closure, which sits inside Yellowstone's area.
const mooseWilson = (direction: string, coords: number[][]): WzdxFeature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: {
    Id: `mw-${direction}`,
    core_details: {
      name: 'Moose-Wilson Road and Death Canyon Road & Trailhead Construction',
      data_source_id: '5ed0ce93-fb16-4f86-2c14-08d4c7ad36e2',
      event_type: 'work-zone',
      road_names: ['Moose-Wilson Road', 'Death Canyon Road'],
      direction,
      description: 'Construction projects underway. Moose-Wilson Road closed between LSR Preserve and Moose. ',
    },
    start_date: '2026-09-08T06:00:00Z',
    end_date: '2026-11-16T06:59:59Z',
    vehicle_impact: 'all-lanes-closed',
  },
});
const ROUTE = [[-110.7671053, 43.6398623], [-110.75, 43.645], [-110.7191562, 43.6562557]];
const northbound = mooseWilson('northbound', ROUTE);
const southbound = mooseWilson('southbound', [...ROUTE].reverse());

describe('wzdxImpact', () => {
  it('reads closures and restrictions, and drops open or unknown', () => {
    expect(wzdxImpact('all-lanes-closed')).toBe('closed');
    expect(wzdxImpact('some-lanes-closed-merge-left')).toBe('restricted');
    expect(wzdxImpact('alternating-one-way')).toBe('restricted');
    expect(wzdxImpact('all-lanes-open')).toBeNull();
    expect(wzdxImpact('unknown')).toBeNull();
    expect(wzdxImpact(undefined)).toBeNull();
  });
});

describe('normalizeWzdxFeature', () => {
  it('keeps a closure in force inside a park area', () => {
    const c = normalizeWzdxFeature(northbound, opts)!;
    expect(c).toMatchObject({
      id: 'nps:mw-northbound',
      source: 'nps',
      sourceLabel: 'Grand Teton (NPS)',
      parkCode: 'yell',
      title: 'Moose-Wilson Road and Death Canyon Road & Trailhead Construction',
      roadNames: ['Moose-Wilson Road', 'Death Canyon Road'],
      description: 'Construction projects underway. Moose-Wilson Road closed between LSR Preserve and Moose.',
      impact: 'closed',
      eventType: 'work-zone',
      direction: 'northbound',
      start: '2026-09-08T06:00:00.000Z',
      end: '2026-11-16T06:59:59.000Z',
    });
    expect(c.lines).toHaveLength(1);
    expect(c.point).not.toBeNull();
  });

  it('drops events that ended, have not started, are open, or are far from every park', () => {
    const p = northbound.properties!;
    expect(normalizeWzdxFeature({ ...northbound, properties: { ...p, end_date: '2026-11-01T00:00:00Z' } }, opts)).toBeNull();
    expect(normalizeWzdxFeature({ ...northbound, properties: { ...p, start_date: '2026-11-20T00:00:00Z' } }, opts)).toBeNull();
    expect(normalizeWzdxFeature({ ...northbound, properties: { ...p, vehicle_impact: 'all-lanes-open' } }, opts)).toBeNull();
    // Crater Lake, Oregon: no followed park nearby.
    const craterLake = { ...northbound, geometry: { type: 'LineString', coordinates: [[-122.149, 42.912], [-122.14, 42.92]] } };
    expect(normalizeWzdxFeature(craterLake, opts)).toBeNull();
  });

  it('reads the WZDx v3 layout and an open-ended closure', () => {
    const v3: WzdxFeature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-112.14, 35.98], [-112.13, 36.0]] },
      properties: {
        road_event_id: 'az-1',
        event_type: 'incident',
        road_name: 'SR 64',
        description: 'SR 64 closed in both directions near Tusayan.',
        vehicle_impact: 'all-lanes-closed',
        start_date: '2026-11-05T12:00:00Z',
      },
    };
    expect(normalizeWzdxFeature(v3, opts)).toMatchObject({
      id: 'nps:az-1',
      parkCode: 'grca',
      title: 'SR 64 closed',
      roadNames: ['SR 64'],
      end: null,
    });
  });

  it('shows a start/end MultiPoint as a marker, not a line across country', () => {
    const mp = { ...northbound, geometry: { type: 'MultiPoint', coordinates: [[-110.767, 43.64], [-110.719, 43.656]] } };
    const c = normalizeWzdxFeature(mp, opts)!;
    expect(c.lines).toEqual([]);
    expect(c.point).toEqual([-110.767, 43.64]);
  });
});

describe('mergeDirections', () => {
  it('folds the per-direction copies of one closure into one', () => {
    const list = [northbound, southbound].map((f) => normalizeWzdxFeature(f, opts)!);
    const merged = mergeDirections(list);
    expect(merged).toHaveLength(1);
    expect(merged[0].direction).toBe('northbound, southbound');
    expect(merged[0].lines).toHaveLength(1);
  });

  it('labels each event by its data source organisation', () => {
    const feed: WzdxFeed = {
      road_event_feed_info: { data_sources: [{ data_source_id: '5ed0ce93-fb16-4f86-2c14-08d4c7ad36e2', organization_name: 'Grand Teton' }] },
      features: [northbound, southbound],
    };
    const out = normalizeWzdxFeed(feed, { source: 'nps', now: NOW, defaultLabel: 'NPS' });
    expect(out.map((c) => c.sourceLabel)).toEqual(['Grand Teton (NPS)']);
  });
});

describe('geometry', () => {
  it('drops points that add no shape, keeping the ends', () => {
    const straight = Array.from({ length: 50 }, (_, i) => [-110 + i * 0.001, 44 + i * 0.001]);
    expect(simplifyLine(straight)).toEqual([straight[0], straight[49]]);
    const bent = [[-110, 44], [-109.99, 44], [-109.99, 44.01]];
    expect(simplifyLine(bent)).toEqual(bent);
  });

  it('rounds to ~1 m and reads GeoJSON line types', () => {
    expect(compactLines([[[-110.1234567, 44.7654321], [-110.2, 44.8]]])).toEqual([[[-110.12346, 44.76543], [-110.2, 44.8]]]);
    expect(linesFromGeometry({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2]]] }).lines).toEqual([[[0, 0], [1, 1]]]);
    expect(linesFromGeometry({ type: 'Point', coordinates: [-110, 44] }).point).toEqual([-110, 44]);
    expect(linesFromGeometry(null)).toEqual({ lines: [], point: null });
  });

  it('places gateway towns inside their park area', () => {
    expect(PARK_AREAS).toHaveLength(6);
    expect(parkAreaFor([], [-112.19, 35.25])).toBe('grca'); // Williams, AZ
    expect(parkAreaFor([], [-110.705, 45.032])).toBe('yell'); // Gardiner, MT
    expect(parkAreaFor([], [-105.52, 40.377])).toBe('romo'); // Estes Park, CO
    expect(parkAreaFor([], [-103.23, 44.08])).toBe('moru'); // Rapid City, SD
    expect(parkAreaFor([], [-104.99, 39.74])).toBeNull(); // Denver
  });
});

describe('collectRoadClosures', () => {
  const closure = (id: string, impact: RoadClosure['impact'], end: string | null = null): RoadClosure => ({
    id, source: 'x', sourceLabel: 'X', parkCode: 'yell', title: id, roadNames: [], description: '', impact,
    eventType: 'incident', direction: null, start: null, end, updated: null, lines: [], point: [-110.5, 44.5], url: null,
  });

  it('serves every source that answers, reports the one that failed and the one switched off', async () => {
    const ok: RoadSource = {
      key: `ok-${NOW}`, label: 'OK', ttlMs: () => 60_000,
      fetch: async () => [closure('r', 'restricted'), closure('c', 'closed'), closure('gone', 'closed', '2026-11-01T00:00:00Z')],
    };
    const broken: RoadSource = { key: `broken-${NOW}`, label: 'Broken', ttlMs: () => 60_000, fetch: async () => { throw new Error('HTTP 500'); } };
    const off: RoadSource = { key: `off-${NOW}`, label: 'Off', ttlMs: () => 60_000, disabled: () => 'KEY not set', fetch: async () => [] };
    const feed = await collectRoadClosures([ok, broken, off], NOW);
    expect(feed.closures.map((c) => c.id)).toEqual(['c', 'r']);
    expect(feed.sources.find((s) => s.label === 'OK')).toMatchObject({ ok: true, count: 2 });
    expect(feed.sources.find((s) => s.label === 'Broken')).toMatchObject({ ok: false, error: 'HTTP 500' });
    expect(feed.sources.find((s) => s.label === 'Off')).toMatchObject({ ok: false, disabled: 'KEY not set' });
  });
});
