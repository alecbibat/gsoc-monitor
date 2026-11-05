import type { WebcamKind } from '../../types';

// Look and wording for the park webcams, shared by the map layer, the camera
// panel and the National Parks panel's grid. Store-free and static.

/** The camera marker's ring — the NPS green, since these are the parks' cameras. */
export const WEBCAM_COLOR = '#34d399';
const LIVE_RED = '#ef4444';

const iconCache = new Map<WebcamKind, string>();

/** A camera on a dark disc; a live-video camera adds a red dot, a link-out camera an arrow. */
export function webcamIcon(kind: WebcamKind): string {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="10.5" fill="#0a0c10" stroke="${WEBCAM_COLOR}" stroke-width="2"/>` +
    `<path d="M6.4 9.4h2.1l1.1-1.6h4.8l1.1 1.6h2.1a.9.9 0 0 1 .9.9v5.4a.9.9 0 0 1-.9.9H6.4a.9.9 0 0 1-.9-.9v-5.4a.9.9 0 0 1 .9-.9Z" fill="#fff"/>` +
    `<circle cx="12" cy="13" r="2.1" fill="#0a0c10"/>` +
    (kind === 'stream' ? `<circle cx="18.6" cy="5.4" r="3" fill="${LIVE_RED}" stroke="#0a0c10" stroke-width="1.2"/>` : '') +
    (kind === 'link'
      ? `<circle cx="18.6" cy="5.4" r="3.3" fill="#e2e8f0" stroke="#0a0c10" stroke-width="1.2"/>` +
        `<path d="M17.4 6.6 19.9 4.1M18.2 4.1h1.7v1.7" fill="none" stroke="#0a0c10" stroke-width="1" stroke-linecap="round"/>`
      : '') +
    `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(kind, url);
  return url;
}

/** "4 min", "3 h", "2 days". */
export function durationText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} h`;
  return `${Math.round(ms / 86_400_000)} days`;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function ageText(ms: number): string {
  return ms < 60_000 ? 'just now' : `${durationText(ms)} ago`;
}

/**
 * Past this age a camera's picture is no longer what's there now: four of its
 * refresh intervals, and never under half an hour (cameras skip the odd
 * upload, and some go dark at night).
 */
export function staleAfterMs(refreshSec: number): number {
  return Math.max(4 * refreshSec * 1000, 30 * 60_000);
}

/** "Every minute", "Every 5 min", "Every hour". */
export function refreshText(refreshSec: number): string {
  if (refreshSec < 90) return 'Updates every minute';
  if (refreshSec < 3600) return `Updates every ${Math.round(refreshSec / 60)} min`;
  const h = Math.round(refreshSec / 3600);
  return h === 1 ? 'Updates hourly' : `Updates every ${h} h`;
}

/**
 * Is a camera's picture current, and how to say so. Stale when the picture is
 * older than staleAfterMs — or when the server has seen the same bytes for
 * that long, whatever the host's headers claim (some re-stamp an unchanged
 * file). `text` is null when nothing is known about its time.
 */
export function webcamFreshness(o: {
  updated: number | null;
  unchangedSince: number | null;
  refreshSec: number;
  now: number;
  timeOnImage?: boolean;
}): { stale: boolean; text: string | null } {
  const limit = staleAfterMs(o.refreshSec);
  const age = o.updated !== null ? o.now - o.updated : null;
  const unchangedFor = o.unchangedSince !== null ? o.now - o.unchangedSince : null;
  if (age !== null && age > limit) return { stale: true, text: `Last new image ${ageText(age)}` };
  if (unchangedFor !== null && unchangedFor > limit) return { stale: true, text: `No new image for ${durationText(unchangedFor)}` };
  if (age !== null) return { stale: false, text: `Updated ${ageText(age)}` };
  if (o.timeOnImage) return { stale: false, text: 'Capture time is printed on the image' };
  return { stale: false, text: null };
}

/** "nps.gov", "earthcam.com" — where a link-out camera opens. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A browser-direct camera's URL for one load: with a timestamp when its host's CDN would serve an old frame. */
export function directImageSrc(url: string, bust: boolean, stamp: number): string {
  return bust ? `${url}${url.includes('?') ? '&' : '?'}_=${stamp}` : url;
}

/** For each camera, its place among the cameras at the same spot. */
export function spotSlots(cams: readonly { lon: number; lat: number }[]): { index: number; count: number }[] {
  const spots = new Map<string, number[]>();
  cams.forEach((c, i) => {
    const key = `${c.lon.toFixed(4)},${c.lat.toFixed(4)}`;
    spots.set(key, [...(spots.get(key) ?? []), i]);
  });
  const slots: { index: number; count: number }[] = [];
  for (const members of spots.values()) members.forEach((cam, index) => (slots[cam] = { index, count: members.length }));
  return slots;
}
