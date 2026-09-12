/**
 * Turning an IdP's ID-token claims into an identity this app will trust.
 *
 * Everything here is deliberately pure: the security-relevant decisions (is the
 * email verified, is its domain ours, is there a stable subject to key on) are
 * the part worth testing, and they shouldn't need a live IdP to exercise.
 *
 * Cryptographic validation of the token itself — signature against the IdP's
 * JWKS, issuer, audience, expiry, nonce — is done by openid-client before any
 * of this runs. These are the checks openid-client can't make for us because
 * they encode our policy, not the protocol's.
 */

export interface SsoIdentity {
  subject: string;
  email: string;
  name: string;
}

export type SsoIdentityResult =
  | { ok: true; identity: SsoIdentity }
  | { ok: false; reason: string; detail: string };

/** Lowercase and trim, matching how every other write path stores email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  // Deliberately loose — the IdP already validated it. This only rejects
  // shapes we couldn't take a domain from.
  if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

/**
 * Is this email's domain one the IdP is authoritative for?
 *
 * An empty allowlist trusts whatever the IdP asserts. That is fine for a
 * single-tenant app registration but wrong for a multi-tenant one, where any
 * Microsoft or Google account in the world can complete the flow — hence the
 * loud recommendation to set SSO_ALLOWED_DOMAINS in production.
 */
export function emailDomainAllowed(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const domain = emailDomain(email);
  return allowed.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

export function identityFromClaims(
  claims: Record<string, unknown>,
  opts: { allowedDomains: string[]; requireVerifiedEmail?: boolean }
): SsoIdentityResult {
  const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!subject) {
    return { ok: false, reason: 'no_subject', detail: 'The identity provider did not return a subject claim.' };
  }

  const email = normalizeEmail(claims.email);
  if (!email) {
    return {
      ok: false,
      reason: 'no_email',
      detail: 'The identity provider did not return an email address. Add the "email" scope to the app registration.',
    };
  }

  // Only treat email_verified as disqualifying when the IdP actually sends it.
  // Some enterprise IdPs omit it entirely for directory-sourced accounts, and
  // rejecting those would break the common corporate case for no gain — the
  // domain allowlist is the real control there.
  if (opts.requireVerifiedEmail !== false && claims.email_verified === false) {
    return {
      ok: false,
      reason: 'email_unverified',
      detail: 'The identity provider reports this email address as unverified.',
    };
  }

  if (!emailDomainAllowed(email, opts.allowedDomains)) {
    return {
      ok: false,
      reason: 'domain_not_allowed',
      detail: `${emailDomain(email)} is not an approved sign-in domain.`,
    };
  }

  const rawName =
    (typeof claims.name === 'string' && claims.name.trim()) ||
    [claims.given_name, claims.family_name].filter((p) => typeof p === 'string' && p.trim()).join(' ').trim() ||
    (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
    '';

  return {
    ok: true,
    identity: {
      subject,
      email,
      // Falling back to the local part keeps initials and crisis-log
      // attribution sensible when the IdP sends no name at all.
      name: (rawName || email.slice(0, email.indexOf('@'))).slice(0, 120),
    },
  };
}

/**
 * Where to send the browser after a successful sign-in.
 *
 * Only same-origin paths are allowed. `returnTo` reaches us as a query
 * parameter — an attacker-supplied absolute URL here would turn the callback
 * into an open redirect, which is exactly the primitive phishing wants against
 * a login endpoint. Protocol-relative "//evil.com" is the case a naive
 * startsWith('/') check misses.
 */
export function safeReturnTo(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
