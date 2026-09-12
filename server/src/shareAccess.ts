import { createHash, timingSafeEqual } from 'crypto';

/**
 * Who may open a share link.
 *
 * Share links used to be public: anyone holding the URL (plus the generated
 * password, on newer links) could read a full incident snapshot — personnel
 * names, phone numbers, photos. They are now gated on a real account.
 *
 * The link password survives as a deliberate break-glass path, OFF by default.
 * An admin turns it on when the IdP is unreachable or SSO is otherwise
 * unavailable — precisely the outage during which a GSOC still has to push a
 * situation report out. It auto-expires so nobody has to remember to turn it
 * back off.
 */

// ── Break-glass setting ───────────────────────────────────────────────────────
//
// Stored as JSON in settings.share_password_fallback. Absent, unparseable or
// past its expiry all mean the same thing: off. Failing closed matters more
// than explaining why, so a malformed value is never treated as "on".

export interface FallbackState {
  active: boolean;
  expiresAt: string | null;
  enabledBy: string | null;
  enabledByName: string | null;
  enabledAt: string | null;
}

export const FALLBACK_OFF: FallbackState = {
  active: false,
  expiresAt: null,
  enabledBy: null,
  enabledByName: null,
  enabledAt: null,
};

/** Longest a break-glass window may be opened for, and the default when unspecified. */
export const FALLBACK_MAX_HOURS = 72;
export const FALLBACK_DEFAULT_HOURS = 12;

export function parseFallbackSetting(value: string | null | undefined, now: Date = new Date()): FallbackState {
  if (!value) return FALLBACK_OFF;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return FALLBACK_OFF;
  }
  if (!parsed || typeof parsed !== 'object') return FALLBACK_OFF;
  const row = parsed as Record<string, unknown>;
  const expiresAt = typeof row.expiresAt === 'string' ? row.expiresAt : null;
  if (!expiresAt) return FALLBACK_OFF;
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs) || expiryMs <= now.getTime()) {
    // Expired windows report their (past) expiry so the admin panel can say
    // "last enabled until …" rather than showing nothing at all.
    return { ...FALLBACK_OFF, expiresAt };
  }
  return {
    active: true,
    expiresAt,
    enabledBy: typeof row.enabledBy === 'string' ? row.enabledBy : null,
    enabledByName: typeof row.enabledByName === 'string' ? row.enabledByName : null,
    enabledAt: typeof row.enabledAt === 'string' ? row.enabledAt : null,
  };
}

/** Clamp a requested break-glass duration into a sane, bounded window. */
export function clampFallbackHours(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_DEFAULT_HOURS;
  return Math.min(FALLBACK_MAX_HOURS, Math.max(1, Math.round(n)));
}

// ── Link password verification ────────────────────────────────────────────────

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const hashEquals = (aHex: string, bHex: string): boolean => {
  const a = Buffer.from(aHex.toLowerCase(), 'utf8');
  const b = Buffer.from(bHex.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Does this wire key match the link's stored password hash?
 *
 * Current scheme: the DB stores sha256(wire key), so a database read yields
 * nothing directly replayable into ?k=. The second comparison accepts rows
 * written by a brief early deployment that stored the wire key itself — those
 * links are already in circulation.
 */
export function linkPasswordOk(passwordHash: string | null, wireKey: string | null): boolean {
  if (!passwordHash || !wireKey) return false;
  return hashEquals(sha256Hex(wireKey.toLowerCase()), passwordHash) || hashEquals(wireKey, passwordHash);
}

// ── The gate ──────────────────────────────────────────────────────────────────

export interface ShareViewer {
  id: string;
  email: string;
  name: string;
}

export type ShareGateResult =
  | { ok: true; via: 'session'; viewer: ShareViewer }
  | { ok: true; via: 'link-password'; viewer: null }
  | { ok: false; loginRequired: true; passwordAccepted: boolean; badPassword: boolean };

export function decideShareAccess(opts: {
  user: ShareViewer | null;
  passwordHash: string | null;
  wireKey: string | null;
  fallbackActive: boolean;
}): ShareGateResult {
  // A signed-in account is the primary path and needs no link password, so an
  // internal responder never hunts for one to read their own incident.
  if (opts.user) return { ok: true, via: 'session', viewer: opts.user };

  // Break-glass. Note a link with no password_hash at all (published before
  // link passwords existed) is NOT open here — it has no credential to check,
  // so it now requires an account like everything else.
  if (opts.fallbackActive && linkPasswordOk(opts.passwordHash, opts.wireKey)) {
    return { ok: true, via: 'link-password', viewer: null };
  }

  return {
    ok: false,
    loginRequired: true,
    // Tells the viewer's browser which gate to render: a sign-in prompt, or the
    // password prompt while break-glass is open.
    passwordAccepted: opts.fallbackActive && Boolean(opts.passwordHash),
    // Distinguishes "you typed the wrong password" from "you need to sign in",
    // so the share page can show the right error.
    badPassword: opts.fallbackActive && Boolean(opts.passwordHash) && Boolean(opts.wireKey),
  };
}
