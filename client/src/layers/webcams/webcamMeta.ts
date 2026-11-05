import type { WebcamKind } from '../../types';

// Look and wording for the park webcams, shared by the map layer, the camera
// panel and the National Parks panel's grid. Store-free and static.

/** The camera marker's ring — the NPS green, since these are the parks' cameras. */
export const WEBCAM_COLOR = '#34d399';
const LIVE_RED = '#ef4444';

const iconCache = new Map<WebcamKind, string>();

/** A camera on a dark disc; a live-video camera also carries a red dot. */
export function webcamIcon(kind: WebcamKind): string {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="10.5" fill="#0a0c10" stroke="${WEBCAM_COLOR}" stroke-width="2"/>` +
    `<path d="M6.4 9.4h2.1l1.1-1.6h4.8l1.1 1.6h2.1a.9.9 0 0 1 .9.9v5.4a.9.9 0 0 1-.9.9H6.4a.9.9 0 0 1-.9-.9v-5.4a.9.9 0 0 1 .9-.9Z" fill="#fff"/>` +
    `<circle cx="12" cy="13" r="2.1" fill="#0a0c10"/>` +
    (kind === 'stream' ? `<circle cx="18.6" cy="5.4" r="3" fill="${LIVE_RED}" stroke="#0a0c10" stroke-width="1.2"/>` : '') +
    `</svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  iconCache.set(kind, url);
  return url;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function ageText(ms: number): string {
  if (ms < 60_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(ms / 86_400_000)} days ago`;
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
