import { describe, expect, it } from 'vitest';
import {
  emailDomain, emailDomainAllowed, identityFromClaims, normalizeEmail, safeReturnTo,
} from './ssoIdentity';

const ALLOWED = ['company.com'];

describe('normalizeEmail', () => {
  it('lowercases and trims, matching how every other write path stores email', () => {
    // If this ever diverges, one person ends up with two accounts.
    expect(normalizeEmail('  Alice@Company.COM ')).toBe('alice@company.com');
  });

  it('rejects values it could not take a domain from', () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('no@domain')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe('emailDomainAllowed', () => {
  it('allows any domain when no allowlist is configured', () => {
    expect(emailDomainAllowed('anyone@wherever.net', [])).toBe(true);
  });

  it('matches the domain and its subdomains, and nothing else', () => {
    expect(emailDomainAllowed('a@company.com', ALLOWED)).toBe(true);
    expect(emailDomainAllowed('a@contractors.company.com', ALLOWED)).toBe(true);
    expect(emailDomainAllowed('a@evil.net', ALLOWED)).toBe(false);
  });

  it('is not fooled by a lookalike domain that merely ends with the allowed one', () => {
    // The check is anchored on a dot boundary, so "notcompany.com" must fail.
    expect(emailDomainAllowed('a@notcompany.com', ALLOWED)).toBe(false);
  });

  it('takes the domain from the last @, not the first', () => {
    expect(emailDomain('weird@name@company.com')).toBe('company.com');
  });
});

describe('identityFromClaims', () => {
  const base = { sub: 'idp|123', email: 'Alice@Company.com', name: 'Alice Chen' };

  it('accepts a well-formed claim set and normalizes the email', () => {
    const result = identityFromClaims(base, { allowedDomains: ALLOWED });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identity).toEqual({
      subject: 'idp|123',
      email: 'alice@company.com',
      name: 'Alice Chen',
    });
  });

  it('requires a subject — it is the durable key an account is linked on', () => {
    const result = identityFromClaims({ ...base, sub: '' }, { allowedDomains: ALLOWED });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_subject');
  });

  it('requires an email, and says which scope is missing', () => {
    const result = identityFromClaims({ sub: 'x' }, { allowedDomains: ALLOWED });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_email');
    expect(result.detail).toMatch(/email.*scope/i);
  });

  it('rejects an email the IdP explicitly marks unverified', () => {
    const result = identityFromClaims(
      { ...base, email_verified: false },
      { allowedDomains: ALLOWED }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('email_unverified');
  });

  it('accepts an omitted email_verified — enterprise IdPs often skip it', () => {
    expect(identityFromClaims(base, { allowedDomains: ALLOWED }).ok).toBe(true);
  });

  it('rejects a domain outside the allowlist', () => {
    const result = identityFromClaims(
      { ...base, email: 'mallory@evil.net' },
      { allowedDomains: ALLOWED }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('domain_not_allowed');
  });

  it('builds a name from given/family, then preferred_username, then the local part', () => {
    const fromParts = identityFromClaims(
      { sub: 'x', email: 'a@company.com', given_name: 'Alice', family_name: 'Chen' },
      { allowedDomains: ALLOWED }
    );
    expect(fromParts.ok && fromParts.identity.name).toBe('Alice Chen');

    const fromUsername = identityFromClaims(
      { sub: 'x', email: 'a@company.com', preferred_username: 'achen' },
      { allowedDomains: ALLOWED }
    );
    expect(fromUsername.ok && fromUsername.identity.name).toBe('achen');

    const fromLocal = identityFromClaims(
      { sub: 'x', email: 'achen@company.com' },
      { allowedDomains: ALLOWED }
    );
    expect(fromLocal.ok && fromLocal.identity.name).toBe('achen');
  });
});

describe('safeReturnTo', () => {
  it('keeps same-origin paths, including a share link', () => {
    expect(safeReturnTo('/?share=abc-123')).toBe('/?share=abc-123');
    expect(safeReturnTo('/incidents')).toBe('/incidents');
  });

  it('refuses anything that could redirect off-origin after login', () => {
    // A login endpoint that honours an attacker-supplied absolute URL is the
    // open-redirect primitive phishing wants.
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('/\\evil.com')).toBe('/');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo(42)).toBe('/');
  });
});
