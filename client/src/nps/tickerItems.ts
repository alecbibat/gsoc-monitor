import type { NpsAlertCategory, NpsFeed } from '../types';

// What the NPS feed puts on the ticker, and how it mixes into the world
// headlines. Pure, so the rules are testable on their own.

/** News releases older than this stay in the panel but leave the ticker. */
export const TICKER_NEWS_MAX_AGE_MS = 30 * 86_400_000;

export type NpsTickerItem =
  | { kind: 'alert'; id: string; parkCode: string; park: string; title: string; category: NpsAlertCategory }
  | { kind: 'news'; id: string; parkCode: string; park: string; title: string; url: string };

/**
 * Every alert in effect (most serious first, as the server orders them), then
 * the last month's news releases, newest first.
 */
export function npsTickerItems(feed: NpsFeed | null, now: number): NpsTickerItem[] {
  if (!feed) return [];
  const alerts: NpsTickerItem[] = (feed.alerts ?? []).map((a) => ({
    kind: 'alert',
    id: a.id,
    parkCode: a.parkCode,
    park: a.park,
    title: a.title,
    category: a.category,
  }));
  const news: NpsTickerItem[] = (feed.news ?? [])
    .filter((n) => now - n.releasedAt <= TICKER_NEWS_MAX_AGE_MS)
    .sort((a, b) => b.releasedAt - a.releasedAt)
    .map((n) => ({ kind: 'news', id: n.id, parkCode: n.parkCode, park: n.park, title: n.title, url: n.url }));
  return [...alerts, ...news];
}

/**
 * `extra` spread evenly through `base`, leading with extra[0] so the first
 * screenful already shows one. Order within each list is kept. With nothing to
 * mix into, the extras run on their own.
 */
export function interleaveEvenly<A, B>(base: readonly A[], extra: readonly B[]): (A | B)[] {
  const n = base.length;
  const m = extra.length;
  if (m === 0) return [...base];
  if (n === 0) return [...extra];
  const out: (A | B)[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    // extra[j] belongs at fraction j/m of the way through base.
    while (j < m && j * n <= i * m) out.push(extra[j++]);
    out.push(base[i]);
  }
  while (j < m) out.push(extra[j++]);
  return out;
}
