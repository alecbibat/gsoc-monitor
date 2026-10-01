import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NgfsProductStatus } from '../../types';
import {
  ageClass,
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
  framesInWindow: 12,
  framesLoaded: 12,
  framesSkipped: 0,
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
    expect(ngfsStatusText(view(), 1)).toMatch(/^124 hot pixels · 1 h · scan \d{2}:\d{2}$/);
    expect(ngfsStatusText(view({ count: 1 }), 3)).toMatch(/^1 hot pixel · 3 h/);
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
          product({ framesInWindow: 72, framesLoaded: 13, coveredFrom: NOW - 66 * MIN }),
          product({ slot: 'west', framesInWindow: 72, framesLoaded: 1, coveredFrom: NOW - 6 * MIN }),
        ],
      }),
      NOW
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^Earlier scans still loading: complete from \d{2}:\d{2}\.$/);
    const t = new Date(NOW - 6 * MIN).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    expect(notes[0]).toContain(t);
  });

  it('reports scans given up on as gaps, not as still loading', () => {
    const notes = ngfsNotes(
      view({ products: [product({ framesLoaded: 10, framesSkipped: 2 }), product({ slot: 'west', sat: 'GOES-18', framesSkipped: 0 })] }),
      NOW
    );
    expect(notes).toEqual(['2 scans could not be downloaded; their detections are missing.']);
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
