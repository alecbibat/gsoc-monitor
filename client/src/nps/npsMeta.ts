import type { NpsAlertCategory } from '../types';

// How NPS items look everywhere they appear (ticker, panel, popups). The NPS
// green marks "this came from the National Park Service"; an alert's category
// colour says how serious it is. Store-free and static.

/** The NPS highlight: badge, chip border and tint. */
export const NPS_GREEN = '#34d399';

export interface NpsCategoryMeta {
  label: string;
  /** Ticker / chip wording. */
  short: string;
  color: string;
  /** Popup queue rank (see notify/notices.ts): Danger sits with Wireless Emergency Alerts, Info with fleet movements. */
  noticeRank: number;
}

export const NPS_CATEGORY: Record<NpsAlertCategory, NpsCategoryMeta> = {
  danger: { label: 'Danger', short: 'Danger', color: '#f87171', noticeRank: 12 },
  closure: { label: 'Park closure', short: 'Closure', color: '#fb923c', noticeRank: 9 },
  caution: { label: 'Caution', short: 'Caution', color: '#facc15', noticeRank: 8 },
  info: { label: 'Information', short: 'Info', color: NPS_GREEN, noticeRank: 3 },
};

/** Panel and legend order: most serious first. */
export const NPS_CATEGORY_ORDER: NpsAlertCategory[] = ['danger', 'closure', 'caution', 'info'];

export const NPS_ATTRIBUTION = 'National Park Service Data API';

/** "Nov 4" (this year) or "Nov 4, 2025" for a YYYY-MM-DD calendar day. */
export function formatNpsDay(day: string | null | undefined, now = new Date()): string | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return null;
  // Built from the parts, so no time zone can shift it to the day before.
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** "today", "yesterday", "3 days ago" for a YYYY-MM-DD calendar day; null past a fortnight. */
export function relativeNpsDay(day: string | null | undefined, now = new Date()): string | null {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  if (!m) return null;
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today - then) / 86_400_000);
  if (days < 0 || days > 14) return null;
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
