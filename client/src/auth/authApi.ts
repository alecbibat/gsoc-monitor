import type { AuthUser } from './authStore';

/**
 * Sign-in plumbing shared by the two places a person can authenticate: the main
 * login screen, and the share-link gate a stakeholder lands on when they open a
 * situation report without a session.
 */

export interface AuthConfig {
  sso: { enabled: boolean; label?: string };
  passwordLogin: boolean;
  passwordLoginAdminOnly: boolean;
  signup: boolean;
}

// Assume password-only until the server answers. It's the pre-SSO behaviour, so
// a failed config fetch degrades to the login form that has always been there
// rather than to a screen with no way in at all.
export const FALLBACK_AUTH_CONFIG: AuthConfig = {
  sso: { enabled: false },
  passwordLogin: true,
  passwordLoginAdminOnly: false,
  signup: true,
};

export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', { credentials: 'include' });
    if (!res.ok) return FALLBACK_AUTH_CONFIG;
    return { ...FALLBACK_AUTH_CONFIG, ...(await res.json()) } as AuthConfig;
  } catch {
    return FALLBACK_AUTH_CONFIG;
  }
}

/**
 * Where to send the browser to start SSO. This must be a full navigation, not a
 * fetch: the whole point is the redirect chain through the IdP and back, which
 * has to happen in the address bar. `returnTo` brings the person back to the
 * page they were trying to reach — a share link, usually.
 */
export function ssoLoginUrl(returnTo?: string): string {
  const target = returnTo ?? window.location.pathname + window.location.search;
  return `/api/auth/sso/login?returnTo=${encodeURIComponent(target)}`;
}

export function startSso(returnTo?: string): void {
  window.location.assign(ssoLoginUrl(returnTo));
}

async function post(path: string, body: unknown): Promise<AuthUser> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data as unknown as AuthUser;
}

export const login = (email: string, password: string) =>
  post('/api/auth/login', { email, password });

export const signup = (email: string, name: string, password: string, code: string) =>
  post('/api/auth/signup', { email, name, password, code: code.trim().toUpperCase() });

// ── SSO error codes ───────────────────────────────────────────────────────────
//
// The callback can only hand the browser a short code in the URL (details go to
// the server log, not the address bar). These turn it into something a person
// can act on — most importantly "your account isn't set up yet", which is the
// expected outcome while IT is still provisioning people.

const SSO_ERRORS: Record<string, string> = {
  not_provisioned:
    'No account here yet for that address. Ask a GSOC administrator to add you, then sign in again.',
  domain_not_allowed: 'That sign-in domain is not approved for this application.',
  email_unverified: 'Your identity provider reports that email address as unverified.',
  no_email:
    'Your identity provider did not share an email address. A GSOC administrator will need to adjust the SSO configuration.',
  no_subject: 'Your identity provider did not return a usable account identifier.',
  account_conflict:
    'That email is already linked to a different single sign-on identity. Contact a GSOC administrator.',
  flow_expired: 'That sign-in attempt timed out. Please try again.',
  idp_unreachable:
    'Could not reach the single sign-on provider. Try again, or sign in with a password if you have one.',
  idp_rejected: 'The single sign-on provider declined the sign-in.',
  sso_disabled: 'Single sign-on is not configured for this deployment.',
  sso_misconfigured: 'Single sign-on is misconfigured. A GSOC administrator will need to correct it.',
  sso_failed: 'Single sign-on did not complete. Please try again.',
};

export function ssoErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return SSO_ERRORS[code] ?? 'Single sign-on did not complete. Please try again.';
}

/**
 * Read (and clear) an `?sso_error=` left behind by a failed callback, so the
 * message shows once and does not survive a refresh or reach a share link's
 * own query handling.
 */
export function consumeSsoError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('sso_error');
  if (!code) return null;
  params.delete('sso_error');
  const qs = params.toString();
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
  );
  return ssoErrorMessage(code);
}
