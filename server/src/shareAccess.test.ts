import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  clampFallbackHours, decideShareAccess, linkPasswordOk, parseFallbackSetting,
  FALLBACK_DEFAULT_HOURS, FALLBACK_MAX_HOURS,
} from './shareAccess';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

// The wire key a viewer sends is sha256(password); the DB stores sha256 of that.
const PASSWORD = 'RTMK7QBN29';
const WIRE_KEY = sha256(PASSWORD.toLowerCase());
const STORED = sha256(WIRE_KEY);

const VIEWER = { id: 'u1', email: 'analyst@company.com', name: 'A. Analyst' };

describe('parseFallbackSetting', () => {
  const now = new Date('2026-09-09T12:00:00Z');

  it('treats absent, empty and malformed settings as off', () => {
    expect(parseFallbackSetting(null, now).active).toBe(false);
    expect(parseFallbackSetting('', now).active).toBe(false);
    expect(parseFallbackSetting('not json', now).active).toBe(false);
    expect(parseFallbackSetting('"a string"', now).active).toBe(false);
    expect(parseFallbackSetting('{}', now).active).toBe(false);
  });

  it('is active only inside its window', () => {
    const future = JSON.stringify({ expiresAt: '2026-09-09T18:00:00Z' });
    const past = JSON.stringify({ expiresAt: '2026-09-09T06:00:00Z' });
    expect(parseFallbackSetting(future, now).active).toBe(true);
    expect(parseFallbackSetting(past, now).active).toBe(false);
  });

  it('reports an expired window so the admin panel can show when it last ran', () => {
    const past = JSON.stringify({ expiresAt: '2026-09-09T06:00:00Z' });
    expect(parseFallbackSetting(past, now).expiresAt).toBe('2026-09-09T06:00:00Z');
  });

  it('fails closed on an unparseable expiry rather than staying open', () => {
    expect(parseFallbackSetting(JSON.stringify({ expiresAt: 'whenever' }), now).active).toBe(false);
  });

  it('carries who opened the window, for the after-action review', () => {
    const state = parseFallbackSetting(
      JSON.stringify({ expiresAt: '2026-09-09T18:00:00Z', enabledBy: 'u9', enabledByName: 'A. Bibat' }),
      now
    );
    expect(state.enabledBy).toBe('u9');
    expect(state.enabledByName).toBe('A. Bibat');
  });
});

describe('clampFallbackHours', () => {
  it('defaults when unusable and bounds the window at both ends', () => {
    expect(clampFallbackHours(undefined)).toBe(FALLBACK_DEFAULT_HOURS);
    expect(clampFallbackHours('nonsense')).toBe(FALLBACK_DEFAULT_HOURS);
    expect(clampFallbackHours(0)).toBe(FALLBACK_DEFAULT_HOURS);
    expect(clampFallbackHours(-5)).toBe(FALLBACK_DEFAULT_HOURS);
    expect(clampFallbackHours(6)).toBe(6);
    expect(clampFallbackHours(10_000)).toBe(FALLBACK_MAX_HOURS);
  });
});

describe('linkPasswordOk', () => {
  it('accepts the correct wire key', () => {
    expect(linkPasswordOk(STORED, WIRE_KEY)).toBe(true);
  });

  it('rejects a wrong key, a missing key, and a link with no password', () => {
    expect(linkPasswordOk(STORED, sha256('WRONGPASS1'))).toBe(false);
    expect(linkPasswordOk(STORED, null)).toBe(false);
    expect(linkPasswordOk(null, WIRE_KEY)).toBe(false);
  });

  it('still accepts legacy rows that stored the wire key directly', () => {
    expect(linkPasswordOk(WIRE_KEY, WIRE_KEY)).toBe(true);
  });
});

describe('decideShareAccess', () => {
  it('lets a signed-in viewer through without any link password', () => {
    const gate = decideShareAccess({
      user: VIEWER, passwordHash: STORED, wireKey: null, fallbackActive: false,
    });
    expect(gate).toEqual({ ok: true, via: 'session', viewer: VIEWER });
  });

  it('refuses an anonymous viewer holding the correct password while break-glass is closed', () => {
    const gate = decideShareAccess({
      user: null, passwordHash: STORED, wireKey: WIRE_KEY, fallbackActive: false,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.loginRequired).toBe(true);
    // Nothing hints that a password would work — the prompt must be sign-in.
    expect(gate.passwordAccepted).toBe(false);
  });

  it('accepts that same password once an admin opens the break-glass window', () => {
    const gate = decideShareAccess({
      user: null, passwordHash: STORED, wireKey: WIRE_KEY, fallbackActive: true,
    });
    expect(gate).toEqual({ ok: true, via: 'link-password', viewer: null });
  });

  it('rejects a wrong password even while break-glass is open, and says so', () => {
    const gate = decideShareAccess({
      user: null, passwordHash: STORED, wireKey: sha256('NOPE12345'), fallbackActive: true,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.passwordAccepted).toBe(true);
    expect(gate.badPassword).toBe(true);
  });

  it('shows the password prompt, not an error, before anything has been typed', () => {
    const gate = decideShareAccess({
      user: null, passwordHash: STORED, wireKey: null, fallbackActive: true,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.passwordAccepted).toBe(true);
    expect(gate.badPassword).toBe(false);
  });

  it('gates legacy passwordless links too — they used to be open to anyone with the URL', () => {
    for (const fallbackActive of [false, true]) {
      const gate = decideShareAccess({
        user: null, passwordHash: null, wireKey: null, fallbackActive,
      });
      expect(gate.ok).toBe(false);
      if (gate.ok) return;
      // No credential exists for these links, so break-glass cannot open them.
      expect(gate.passwordAccepted).toBe(false);
    }
  });

  it('still admits a signed-in viewer to a legacy passwordless link', () => {
    const gate = decideShareAccess({
      user: VIEWER, passwordHash: null, wireKey: null, fallbackActive: false,
    });
    expect(gate.ok).toBe(true);
  });
});
