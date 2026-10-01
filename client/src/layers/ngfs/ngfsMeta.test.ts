import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NgfsProductStatus } from '../../types';
import type { PanelData } from '../../panels/panelStore';
import {
  ageClass,
  clockTime,
  refreshedNgfsPanels,
  ngfsPanelData,
  panelPayload,
  trackedSince,
  fetchNgfs,
  footprintKm,
  formatMix,
  incidentTypeLabel,
  NGFS_AGE_CLASSES,
  NGFS_OTHER,
  ngfsNotes,
  ngfsPanelId,
  ngfsStatusText,
  parseMix,
  pixelStyle,
  type NgfsStatusView,
} from './ngfsMeta';

const NOW = Date.UTC(2026, 9, 1, 20, 10, 0);
const MIN = 60_000;

describe('age palette', () => {
  it('buckets by minutes since the last detection', () => {
    expect(ageClass(NOW - 4 * MIN, NOW)).toBe(NGFS_AGE_CLASSES[0]);
    expect(ageClass(NOW - 15 * MIN, NOW)).toBe(NGFS_AGE_CLASSES[1]);
    expect(ageClass(NOW - 59 * MIN, NOW)).toBe(NGFS_AGE_CLASSES[1]);
    expect(ageClass(NOW - 2 * 60 * MIN, NOW)).toBe(NGFS_AGE_CLASSES[2]);
    expect(ageClass(NOW - 5 * 60 * MIN, NOW)).toBe(NGFS_AGE_CLASSES[3]);
    // Clock skew (a detection stamped slightly in the future) is still "fresh".
    expect(ageClass(NOW + MIN, NOW)).toBe(NGFS_AGE_CLASSES[0]);
  });

  it('greys out non-wildland heat whatever its age', () => {
    expect(pixelStyle({ last: NOW, wildland: false }, NOW)).toBe(NGFS_OTHER);
    expect(pixelStyle({ last: NOW, wildland: true }, NOW)).toBe(NGFS_AGE_CLASSES[0]);
  });

  it('fades older classes', () => {
    const fills = NGFS_AGE_CLASSES.map((c) => c.fill);
    expect([...fills].sort((a, b) => b - a)).toEqual(fills);
  });
});

describe('fuel and land-cover mixes', () => {
  it('decodes Anderson fuel models, largest share first', () => {
    expect(parseMix('FBFM5:30,FBFM8:49,Barren:2')).toEqual([
      { label: 'Compact timber litter', pct: 49 },
      { label: 'Brush', pct: 30 },
      { label: 'Barren', pct: 2 },
    ]);
  });

  it('formats the top entries and tolerates junk', () => {
    expect(formatMix('Trees:76,Shrubs:21,Barren:2,Grass/Herbs:1', 2)).toBe('Trees 76% · Shrubs 21%');
    expect(formatMix('nonsense,:5,Trees:x')).toBeNull();
    expect(formatMix(null)).toBeNull();
  });

  it('names IRWIN incident types', () => {
    expect(incidentTypeLabel('RX')).toBe('Prescribed burn');
    expect(incidentTypeLabel('wf')).toBe('Wildfire');
    expect(incidentTypeLabel('XX')).toBe('XX');
    expect(incidentTypeLabel(null)).toBeNull();
  });
});

describe('footprint and ids', () => {
  it('sizes a California pixel from GOES-West at a few km', () => {
    const km = footprintKm({ lat: 37.65861, lon: -119.61361, slot: 'west' })!;
    expect(km.ns).toBeGreaterThan(2);
    expect(km.ns).toBeLessThan(5);
    expect(km.ew).toBeGreaterThan(2);
    expect(km.ew).toBeLessThan(5);
  });

  it('keys a panel by satellite and pixel', () => {
    const a = ngfsPanelId({ lat: 35.332781, lon: -90.688331, slot: 'east' });
    expect(a).toBe('ngfs-east-35.3328,-90.6883');
    expect(ngfsPanelId({ lat: 35.332781, lon: -90.688331, slot: 'west' })).not.toBe(a);
  });
});

const product = (over: Partial<NgfsProductStatus> = {}): NgfsProductStatus => ({
  product: 'NGFS-SCENE-CONUS-EAST',
  slot: 'east',
  sat: 'GOES-19',
  newestFrame: NOW - 6 * MIN,
  newestLoaded: NOW - 6 * MIN,
  framesInWindow: 12,
  framesLoaded: 12,
  framesSkipped: 0,
  loadedFrom: NOW - 61 * MIN,
  coveredFrom: NOW - 61 * MIN,
  error: null,
  ...over,
});
const view = (over: Partial<NgfsStatusView> = {}): NgfsStatusView => ({
  count: 124,
  newestScan: NOW - 6 * MIN,
  windowStart: NOW - 60 * MIN,
  products: [product(), product({ product: 'NGFS-SCENE-CONUS-WEST', slot: 'west', sat: 'GOES-18' })],
  loading: false,
  error: null,
  ...over,
});

describe('sidebar status', () => {
  it('summarises count, window and scan time', () => {
    // Built with the same locale calls as the code, so it holds in any locale.
    expect(ngfsStatusText(view(), 1)).toBe(`${(124).toLocaleString()} hot pixels · 1 h · scan ${clockTime(NOW - 6 * MIN)}`);
    expect(ngfsStatusText(view({ count: 1 }), 3)).toBe(`${(1).toLocaleString()} hot pixel · 3 h · scan ${clockTime(NOW - 6 * MIN)}`);
  });

  it('shows loading before the first answer, and errors verbatim', () => {
    expect(ngfsStatusText(view({ loading: true, newestScan: null, count: 0 }), 1)).toBe('Loading NOAA NGFS…');
    expect(ngfsStatusText(view({ error: 'NGFS feed error: HTTP 502' }), 1)).toBe('NGFS feed error: HTTP 502');
  });

  it('has nothing to add when both satellites are complete and current', () => {
    expect(ngfsNotes(view(), NOW)).toEqual([]);
  });

  it('names a satellite that is down', () => {
    const notes = ngfsNotes(view({ products: [product(), product({ slot: 'west', sat: 'GOES-18', error: 'HTTP 500' })] }), NOW);
    expect(notes).toEqual(['GOES-West (GOES-18) unavailable: HTTP 500']);
  });

  it('says when the window is only partly loaded, from the furthest-behind satellite', () => {
    const notes = ngfsNotes(
      view({
        windowStart: NOW - 6 * 60 * MIN,
        products: [
          product({ framesInWindow: 72, framesLoaded: 13, loadedFrom: NOW - 66 * MIN, coveredFrom: NOW - 66 * MIN }),
          product({ slot: 'west', framesInWindow: 72, framesLoaded: 1, loadedFrom: NOW - 6 * MIN, coveredFrom: NOW - 6 * MIN }),
        ],
      }),
      NOW
    );
    expect(notes).toEqual([`Earlier scans still loading: complete from ${clockTime(NOW - 6 * MIN)}.`]);
  });

  it('reports scans given up on as gaps, not as still loading', () => {
    const notes = ngfsNotes(
      view({ products: [product({ framesLoaded: 10, framesSkipped: 2 }), product({ slot: 'west', sat: 'GOES-18', framesSkipped: 0 })] }),
      NOW
    );
    expect(notes).toEqual(['2 scans could not be downloaded; their detections are missing.']);
  });

  it('says the newest scan is missing instead of claiming coverage from it', () => {
    // The newest scan is published but not loaded: no "complete from" time exists.
    const notes = ngfsNotes(
      view({ products: [product({ framesLoaded: 11, coveredFrom: null, newestLoaded: NOW - 11 * MIN }), product({ slot: 'west', sat: 'GOES-18' })] }),
      NOW
    );
    expect(notes).toEqual(['Latest GOES-East scan not loaded yet.']);
  });

  it('still says earlier scans are loading when the newest is missing too', () => {
    // Cold start: 13 of 71 scans in, and the newest download hasn't landed.
    const notes = ngfsNotes(
      view({
        windowStart: NOW - 6 * 60 * MIN,
        products: [
          product({
            framesInWindow: 71,
            framesLoaded: 13,
            newestLoaded: NOW - 11 * MIN,
            loadedFrom: NOW - 71 * MIN,
            coveredFrom: null,
          }),
          product({ slot: 'west', sat: 'GOES-18', framesInWindow: 0, framesLoaded: 0, newestFrame: null, newestLoaded: null, loadedFrom: null }),
        ],
      }),
      NOW
    );
    expect(notes).toEqual([
      'Latest GOES-East scan not loaded yet.',
      `Earlier scans still loading: complete from ${clockTime(NOW - 71 * MIN)}.`,
    ]);
  });

  it('flags a feed that has gone quiet', () => {
    expect(ngfsNotes(view({ newestScan: NOW - 45 * MIN }), NOW)).toEqual([
      'Newest NGFS scan is 45 min old; the feed may be delayed.',
    ]);
  });
});

describe('fetchNgfs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests the window and returns the body', async () => {
    const fetchMock = vi.fn(async () => Response.json({ pixels: [], products: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchNgfs(3)).resolves.toMatchObject({ pixels: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/ngfs?hours=3', expect.anything());
  });

  it('surfaces the server’s reason on failure', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'NGFS feed unavailable: RealEarth session handshake failed (HTTP 403)' }, { status: 502 })
    );
    await expect(fetchNgfs(1)).rejects.toThrow(/handshake failed \(HTTP 403\)/);
    vi.stubGlobal('fetch', async () => new Response('Bad gateway', { status: 502 }));
    await expect(fetchNgfs(1)).rejects.toThrow('HTTP 502');
  });
});

describe('panel data', () => {
  const pixel = {
    lat: 37.65861,
    lon: -119.61361,
    slot: 'west' as const,
    sat: 'GOES-18',
    first: NOW - 60 * MIN,
    last: NOW - 6 * MIN,
    frames: 11,
    frp: 1554,
    maxFrp: 1600,
    featureFrp: 1554,
    trackId: 'ID-2026-09-20T16:51:17.000Z_0002',
    type: 'Known Wildland Fire Incident',
    wildland: true,
    confidence: 'nominal',
    state: 'CA',
    county: 'Mariposa County',
    incident: 'DOME',
    incidentType: 'WF',
    fuel: null,
    landCover: null,
  };
  const data = (loadedFrom: number | null) => ({
    windowHours: 1 as const,
    windowStart: NOW - 60 * MIN,
    // coveredFrom null throughout: the newest scan missing must not matter.
    products: [product(), product({ slot: 'west', sat: 'GOES-18', loadedFrom, coveredFrom: null })],
  });

  it('carries the window and how much of it the pixel’s satellite has loaded', () => {
    expect(panelPayload(pixel, data(NOW - 58 * MIN))).toMatchObject({
      windowHours: 1,
      historyFrom: NOW - 58 * MIN,
      historyComplete: true,
    });
    expect(panelPayload(pixel, data(NOW - 20 * MIN))).toMatchObject({ historyFrom: NOW - 20 * MIN, historyComplete: false });
    expect(panelPayload(pixel, data(null))).toMatchObject({ historyFrom: NOW - 60 * MIN, historyComplete: false });
  });

  it('labels overlapping pixels apart by satellite and time', () => {
    const d = ngfsPanelData(pixel, panelPayload(pixel, data(null)));
    expect(d).toMatchObject({ id: 'ngfs-west-37.6586,-119.6136', kind: 'ngfs', title: 'DOME · NGFS heat' });
    expect(d.subtitle).toBe(`Mariposa County, CA · GOES-West · last ${clockTime(NOW - 6 * MIN)} · 1554 MW`);
    // A neighbouring pixel of the same fire, same scan: still a different row.
    const neighbour = { ...pixel, lat: pixel.lat + 0.02, frp: 310 };
    expect(ngfsPanelData(neighbour, panelPayload(neighbour, data(null))).subtitle).not.toBe(d.subtitle);
  });

  it('reads when NGFS started tracking the fire object, and ignores other id formats', () => {
    expect(trackedSince('ID-2026-09-20T16:51:17.000Z_0002')).toBe(Date.UTC(2026, 8, 20, 16, 51, 17));
    expect(trackedSince('ID-2026-09-20T16:51:17Z_12')).toBe(Date.UTC(2026, 8, 20, 16, 51, 17));
    expect(trackedSince('12345')).toBeNull();
    expect(trackedSince(null)).toBeNull();
  });
});

describe('refreshedNgfsPanels', () => {
  const base = { x: 0, y: 0, width: 300, height: 400, z: 3, dockedTo: null, locked: true };
  const panel = (id: string, kind: PanelData['kind'], payload: Record<string, unknown> = {}): PanelData => ({
    ...base,
    id,
    kind,
    title: 'old',
    subtitle: 'old',
    payload,
  });

  it('is a no-op when no NGFS panel is open', () => {
    expect(refreshedNgfsPanels([panel('q1', 'earthquakes')], new Map(), 1)).toBeNull();
  });

  it('updates open pixels in place, marks departed ones gone, and leaves other panels alone', () => {
    const quake = panel('q1', 'earthquakes');
    const live = panel('ngfs-east-1.0000,2.0000', 'ngfs', { frp: 1 });
    const departed = panel('ngfs-east-3.0000,4.0000', 'ngfs', { frp: 9, windowHours: 6 });
    const fresh = new Map([[live.id, { id: live.id, kind: 'ngfs' as const, title: 'new', subtitle: 'new sub', payload: { frp: 2 } }]]);
    const out = refreshedNgfsPanels([quake, live, departed], fresh, 1)!;
    expect(out[0]).toBe(quake);
    expect(out[1]).toMatchObject({ title: 'new', subtitle: 'new sub', payload: { frp: 2 }, z: 3, locked: true });
    expect(out[2].payload).toEqual({ frp: 9, windowHours: 1, gone: true });
    expect(out[2].payload).not.toBe(departed.payload); // re-renders, so relative times move on
  });
});
