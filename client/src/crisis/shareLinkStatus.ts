import { useEffect, useState } from 'react';
import type { Incident, ShareLink } from './crisisStore';

// ── Share-link liveness ──────────────────────────────────────────────────────
// A link is LIVE — viewers can open it and edits reach them — only while it is
// both un-revoked and inside its expiry window, mirroring the server's LIVE
// predicate (crisis.ts: `active AND (expires_at IS NULL OR expires_at > NOW())`).
// `active` alone stays true after a link lapses (Renew can revive it, so the
// row isn't flipped), and treating it as live kept a green "Share Links" badge
// pulsing while executives were landing on the expired page.
//
// These read the CLIENT clock, so they drive display only: publishing still
// goes to every `active` link (a skewed clock must never silence a link the
// server still serves), and revocation covers expired links too, so a later
// Renew can't bring a stood-down incident's link back.

/** Warn this long before a live link lapses (the panel rows use the same window). */
export const EXPIRY_WARN_MS = 12 * 3600_000;

type LinkTimes = Pick<ShareLink, 'active' | 'expiresAt'>;

function expiryMs(l: LinkTimes): number | null {
  if (!l.expiresAt) return null;
  const t = Date.parse(l.expiresAt);
  return Number.isNaN(t) ? null : t;
}

/** Un-revoked and not past its expiry (links from before expiry existed never lapse). */
export function isLiveLink(l: LinkTimes, now = Date.now()): boolean {
  if (!l.active) return false;
  const t = expiryMs(l);
  return t === null || t > now;
}

/** Un-revoked but past its expiry: viewers get the "expired" page until someone renews. */
export function isExpiredLink(l: LinkTimes, now = Date.now()): boolean {
  if (!l.active) return false;
  const t = expiryMs(l);
  return t !== null && t <= now;
}

export interface ShareLinkHealth {
  /** Links viewers can open right now. */
  live: number;
  /** Un-revoked links that have lapsed. */
  expired: number;
  /** Time left on the live link closest to lapsing, when that is inside EXPIRY_WARN_MS. */
  expiringInMs: number | null;
}

export function shareLinkHealth(links: readonly ShareLink[] | undefined, now = Date.now()): ShareLinkHealth {
  let live = 0;
  let expired = 0;
  let expiringInMs: number | null = null;
  for (const l of links ?? []) {
    if (isExpiredLink(l, now)) { expired += 1; continue; }
    if (!isLiveLink(l, now)) continue;
    live += 1;
    const t = expiryMs(l);
    if (t !== null && t - now < EXPIRY_WARN_MS && (expiringInMs === null || t - now < expiringInMs)) {
      expiringInMs = t - now;
    }
  }
  return { live, expired, expiringInMs };
}

/**
 * Whether anyone can currently open a share link for this incident. The legacy
 * single `shareToken` only counts for incidents that never got a `shareLinks`
 * list — otherwise an all-expired list would fall back to a stale token.
 */
export function hasLiveShare(inc: Pick<Incident, 'shareLinks' | 'shareToken'>, now = Date.now()): boolean {
  const links = inc.shareLinks ?? [];
  if (links.length === 0) return !!inc.shareToken;
  return links.some((l) => isLiveLink(l, now));
}

/** "51h" / "40m" — time left, rounded for a compact label. */
export function fmtRemaining(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

/** "expires in 51h" / "expires in 40m" / "expired" */
export function fmtExpiry(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'expired';
  return `expires in ${fmtRemaining(ms)}`;
}

/**
 * The current time, refreshed every `intervalMs` — so expiry badges and
 * "5m ago" labels move on an idle incident, where nothing else re-renders.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
