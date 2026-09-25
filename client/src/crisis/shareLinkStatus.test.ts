import { describe, expect, it } from 'vitest';
import type { ShareLink } from './crisisStore';
import {
  EXPIRY_WARN_MS, fmtExpiry, fmtRemaining, hasLiveShare, isExpiredLink, isLiveLink, shareLinkHealth,
} from './shareLinkStatus';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  token: Math.random().toString(36).slice(2),
  url: 'https://example.test/share/x',
  createdAt: iso(NOW - 10 * H),
  active: true,
  ...over,
});

describe('isLiveLink / isExpiredLink', () => {
  it('treats an active link inside its window as live', () => {
    const l = link({ expiresAt: iso(NOW + 5 * H) });
    expect(isLiveLink(l, NOW)).toBe(true);
    expect(isExpiredLink(l, NOW)).toBe(false);
  });

  it('treats an active link past its expiry as expired, not live (the server serves it a 410)', () => {
    const l = link({ expiresAt: iso(NOW - 1) });
    expect(isLiveLink(l, NOW)).toBe(false);
    expect(isExpiredLink(l, NOW)).toBe(true);
    // Exactly at expiry the server's `expires_at > NOW()` is already false.
    expect(isLiveLink(link({ expiresAt: iso(NOW) }), NOW)).toBe(false);
  });

  it('never counts a revoked link as either', () => {
    const l = link({ active: false, expiresAt: iso(NOW - H) });
    expect(isLiveLink(l, NOW)).toBe(false);
    expect(isExpiredLink(l, NOW)).toBe(false);
  });

  it('keeps links from before expiry existed (or with a garbled expiry) live', () => {
    expect(isLiveLink(link(), NOW)).toBe(true);
    expect(isLiveLink(link({ expiresAt: 'not a date' }), NOW)).toBe(true);
    expect(isExpiredLink(link({ expiresAt: 'not a date' }), NOW)).toBe(false);
  });
});

describe('shareLinkHealth', () => {
  it('counts live and expired links and reports the soonest expiry inside the warning window', () => {
    const h = shareLinkHealth([
      link({ expiresAt: iso(NOW + 60 * H) }),
      link({ expiresAt: iso(NOW + 5 * H) }),
      link({ expiresAt: iso(NOW + 2 * H) }),
      link({ expiresAt: iso(NOW - H) }),
      link({ active: false }),
    ], NOW);
    expect(h).toEqual({ live: 3, expired: 1, expiringInMs: 2 * H });
  });

  it('reports no warning when every live link has more than the warning window left', () => {
    const h = shareLinkHealth([link({ expiresAt: iso(NOW + EXPIRY_WARN_MS + H) }), link()], NOW);
    expect(h).toEqual({ live: 2, expired: 0, expiringInMs: null });
  });

  it('handles incidents with no links', () => {
    expect(shareLinkHealth(undefined, NOW)).toEqual({ live: 0, expired: 0, expiringInMs: null });
  });
});

describe('hasLiveShare', () => {
  it('is false when every link has lapsed, even though the legacy shareToken still names one', () => {
    const l = link({ expiresAt: iso(NOW - H) });
    expect(hasLiveShare({ shareLinks: [l], shareToken: l.token }, NOW)).toBe(false);
  });

  it('uses the legacy shareToken only for incidents that never had a link list', () => {
    expect(hasLiveShare({ shareLinks: [], shareToken: 'legacy' }, NOW)).toBe(true);
    expect(hasLiveShare({ shareLinks: [], shareToken: null }, NOW)).toBe(false);
  });

  it('is true while any link is live', () => {
    expect(hasLiveShare({
      shareLinks: [link({ expiresAt: iso(NOW - H) }), link({ expiresAt: iso(NOW + H) })],
      shareToken: null,
    }, NOW)).toBe(true);
  });
});

describe('expiry labels', () => {
  it('formats the time left', () => {
    expect(fmtRemaining(51 * H + 10 * 60_000)).toBe('51h');
    expect(fmtRemaining(40 * 60_000)).toBe('40m');
    expect(fmtRemaining(10_000)).toBe('1m');
    expect(fmtExpiry(iso(NOW + 5 * H), NOW)).toBe('expires in 5h');
    expect(fmtExpiry(iso(NOW - 1), NOW)).toBe('expired');
    expect(fmtExpiry('nope', NOW)).toBe('');
  });
});
