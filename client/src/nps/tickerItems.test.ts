import { describe, expect, it } from 'vitest';
import type { NpsAlert, NpsFeed, NpsNewsItem } from '../types';
import { TICKER_NEWS_MAX_AGE_MS, interleaveEvenly, npsOnlyEmptyText, npsTickerItems } from './tickerItems';
import { formatNpsDay, relativeNpsDay } from './npsMeta';

const NOW = Date.UTC(2026, 10, 5, 15);

const alert = (id: string, category: NpsAlert['category'], park = 'yell'): NpsAlert => ({
  id,
  parkCode: park,
  park: park === 'yell' ? 'Yellowstone' : 'Glacier',
  parkFullName: '',
  category,
  categoryLabel: '',
  title: `Alert ${id}`,
  description: '',
  url: null,
  conditionsUrl: '',
  postedDay: '2026-11-01',
  postedAt: Date.UTC(2026, 10, 1, 12),
  roadEvents: [],
});

const news = (id: string, daysAgo: number): NpsNewsItem => ({
  id,
  parkCode: 'glac',
  park: 'Glacier',
  parkFullName: '',
  title: `News ${id}`,
  abstract: '',
  url: `https://www.nps.gov/glac/learn/news/${id}.htm`,
  image: null,
  releasedDay: null,
  releasedAt: NOW - daysAgo * 86_400_000,
});

const feed = (alerts: NpsAlert[] | null, items: NpsNewsItem[] | null): NpsFeed => ({
  parks: [],
  alerts,
  alertsFetchedAt: null,
  alertsError: null,
  news: items,
  newsFetchedAt: null,
  newsError: null,
  api: { keyConfigured: true, rateLimit: null, rateRemaining: null, lastOkAt: null, lastError: null, lastErrorAt: null },
});

describe('npsTickerItems', () => {
  it('runs every alert in effect, then the last month of news, newest first', () => {
    const items = npsTickerItems(
      feed([alert('a1', 'danger'), alert('a2', 'info')], [news('old', 45), news('n2', 9), news('n1', 2)]),
      NOW
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['alert:a1', 'alert:a2', 'news:n1', 'news:n2']);
    expect(items[0]).toMatchObject({ kind: 'alert', category: 'danger', park: 'Yellowstone', parkCode: 'yell' });
    expect(items[2]).toMatchObject({ kind: 'news', url: 'https://www.nps.gov/glac/learn/news/n1.htm' });
  });

  it('runs only the alerts in the NPS-alerts mode', () => {
    const f = feed([alert('a1', 'closure'), alert('a2', 'info')], [news('n1', 2)]);
    expect(npsTickerItems(f, NOW, { alertsOnly: true }).map((i) => `${i.kind}:${i.id}`)).toEqual(['alert:a1', 'alert:a2']);
  });

  it('keeps a release right at the age limit and copes with a failed half', () => {
    const edge = { ...news('edge', 0), releasedAt: NOW - TICKER_NEWS_MAX_AGE_MS };
    expect(npsTickerItems(feed(null, [edge]), NOW).map((i) => i.id)).toEqual(['edge']);
    expect(npsTickerItems(feed([alert('a', 'closure')], null), NOW).map((i) => i.id)).toEqual(['a']);
    expect(npsTickerItems(null, NOW)).toEqual([]);
  });
});

describe('interleaveEvenly', () => {
  it('spreads the extras evenly, leading with one', () => {
    expect(interleaveEvenly(['b0', 'b1', 'b2', 'b3', 'b4', 'b5'], ['E0', 'E1', 'E2'])).toEqual([
      'E0', 'b0', 'b1', 'E1', 'b2', 'b3', 'E2', 'b4', 'b5',
    ]);
    expect(interleaveEvenly(['b0', 'b1', 'b2', 'b3'], ['E0', 'E1'])).toEqual(['E0', 'b0', 'b1', 'E1', 'b2', 'b3']);
  });

  it('keeps every item when the extras outnumber the base', () => {
    const out = interleaveEvenly(['b0', 'b1'], ['E0', 'E1', 'E2', 'E3', 'E4']);
    expect(out).toHaveLength(7);
    expect(out.filter((x) => x.startsWith('E'))).toEqual(['E0', 'E1', 'E2', 'E3', 'E4']);
    expect(out.filter((x) => x.startsWith('b'))).toEqual(['b0', 'b1']);
  });

  it('passes either list through alone', () => {
    expect(interleaveEvenly(['b0', 'b1'], [])).toEqual(['b0', 'b1']);
    expect(interleaveEvenly([], ['E0'])).toEqual(['E0']);
  });
});

describe('NPS day formatting', () => {
  const now = new Date(2026, 10, 5, 9);
  it('formats a calendar day without shifting it', () => {
    expect(formatNpsDay('2026-11-04', now)).toBe(new Date(2026, 10, 4).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    expect(formatNpsDay('2025-01-27', now)).toContain('2025');
    expect(formatNpsDay(null, now)).toBeNull();
  });

  it('says how long ago, for the last fortnight', () => {
    expect(relativeNpsDay('2026-11-05', now)).toBe('today');
    expect(relativeNpsDay('2026-11-04', now)).toBe('yesterday');
    expect(relativeNpsDay('2026-11-01', now)).toBe('4 days ago');
    expect(relativeNpsDay('2026-09-01', now)).toBeNull();
  });
});

describe('npsOnlyEmptyText', () => {
  it('tells loading, failure and a quiet day apart', () => {
    expect(npsOnlyEmptyText(null, null)).toBe('Loading National Park Service alerts…');
    expect(npsOnlyEmptyText(null, 'HTTP 502')).toBe('National Park Service alerts unavailable');
    expect(npsOnlyEmptyText(feed(null, []), null)).toBe('National Park Service alerts unavailable');
    expect(npsOnlyEmptyText(feed([], []), null)).toBe('No National Park Service alerts in effect');
  });
});
