import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Issuer, generators, custom, type Client } from 'openid-client';
import { pool } from '../db';
import { config } from '../config';
import { signToken, COOKIE_OPTS, type AuthUser } from '../middleware/auth';
import { identityFromClaims, safeReturnTo, type SsoIdentity } from '../ssoIdentity';

const router = Router();

// A hung IdP must not hold an Express handler (and a pool client) open until
// the platform's request timeout — 10s is generous for discovery and token
// exchange on any hosted IdP.
custom.setHttpOptionsDefaults({ timeout: 10_000 });

// ── Client discovery ──────────────────────────────────────────────────────────
//
// Discovered lazily and memoized: the dyno must boot with the IdP unreachable
// (same principle as the retrying migration — an outage degrades SSO, it does
// not black out the dashboard). A failed discovery clears the memo so the next
// sign-in retries rather than caching the failure for the life of the process.

let clientPromise: Promise<Client> | null = null;

function discoverClient(): Promise<Client> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const issuer = await Issuer.discover(config.sso.issuer);
    console.log(`[sso] discovered issuer ${issuer.issuer}`);
    return new issuer.Client({
      client_id: config.sso.clientId,
      client_secret: config.sso.clientSecret,
      redirect_uris: [config.sso.redirectUri],
      response_types: ['code'],
    });
  })().catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

// ── Transient flow state ──────────────────────────────────────────────────────
//
// state / nonce / PKCE verifier have to survive the round trip to the IdP. They
// live in a short-lived signed cookie rather than server memory on purpose:
// this app runs a single dyno with no Redis, and an in-memory store would break
// silently the moment anyone scales to two. Signing with the existing
// JWT_SECRET avoids introducing a second secret to rotate.

const FLOW_COOKIE = 'gsoc_sso_flow';
const FLOW_TTL_SECONDS = 600;

interface FlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

// SameSite=lax is correct for OIDC: the callback is a top-level GET navigation,
// which Lax permits. (A SAML ACS endpoint receives a cross-site POST instead,
// where Lax would drop this cookie and the flow would fail with a state
// mismatch — that path would need SameSite=none; Secure.)
const FLOW_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: FLOW_TTL_SECONDS * 1000,
  path: '/api/auth/sso',
};

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET env var is not set');
  return s;
}

function sealFlow(flow: FlowState): string {
  return jwt.sign(flow, jwtSecret(), { expiresIn: FLOW_TTL_SECONDS });
}

function openFlow(raw: string | undefined): FlowState | null {
  if (!raw) return null;
  try {
    const decoded = jwt.verify(raw, jwtSecret()) as Partial<FlowState>;
    if (!decoded.state || !decoded.nonce || !decoded.codeVerifier) return null;
    return {
      state: decoded.state,
      nonce: decoded.nonce,
      codeVerifier: decoded.codeVerifier,
      returnTo: safeReturnTo(decoded.returnTo),
    };
  } catch {
    return null;
  }
}

/** Bounce back to a sign-in surface with a code the client turns into a message. */
function fail(res: Response, returnTo: string, code: string, logDetail?: string): void {
  if (logDetail) console.warn(`[sso] ${code}: ${logDetail}`);
  const sep = returnTo.includes('?') ? '&' : '?';
  res.clearCookie(FLOW_COOKIE, { path: FLOW_COOKIE_OPTS.path });
  res.redirect(`${returnTo}${sep}sso_error=${encodeURIComponent(code)}`);
}

// ── Account resolution ────────────────────────────────────────────────────────

interface ResolveResult {
  user?: AuthUser;
  error?: 'not_provisioned' | 'conflict';
}

/**
 * Map a verified SSO identity onto an app account.
 *
 * Match order is subject first, email second. The subject is the durable key —
 * matching on email alone would create a duplicate account the day someone's
 * address changes, orphaning their watchlist entries and breaking the link
 * between their name and everything they wrote in an incident log. Email is
 * only used once, to attach the subject to the row IT pre-created.
 */
async function resolveUser(identity: SsoIdentity, provider: string): Promise<ResolveResult> {
  const linked = await pool.query<AuthUser & { sso_subject: string | null }>(
    `UPDATE users
        SET name  = $3,
            email = $4
      WHERE sso_provider = $1 AND sso_subject = $2
      RETURNING id, email, name, role`,
    [provider, identity.subject, identity.name, identity.email]
  );
  if (linked.rows[0]) return { user: linked.rows[0] };

  // First SSO login for this person: attach the subject to the pre-created row.
  // The sso_subject IS NULL guard makes this a no-op if the row already belongs
  // to a different subject, which is the ambiguous case we refuse to guess at.
  const byEmail = await pool.query<AuthUser>(
    `UPDATE users
        SET sso_provider = $1, sso_subject = $2, sso_linked_at = NOW(), name = $4
      WHERE LOWER(email) = $3 AND sso_subject IS NULL
      RETURNING id, email, name, role`,
    [provider, identity.subject, identity.email, identity.name]
  );
  if (byEmail.rows[0]) {
    console.log(`[sso] linked ${identity.email} to existing account ${byEmail.rows[0].id}`);
    return { user: byEmail.rows[0] };
  }

  const { rows: [existing] } = await pool.query<{ sso_subject: string | null }>(
    'SELECT sso_subject FROM users WHERE LOWER(email) = $1',
    [identity.email]
  );
  if (existing) return { error: 'conflict' };

  if (!config.sso.autoProvision) return { error: 'not_provisioned' };

  // Mirrors the password signup rule: an empty user table makes the first
  // account an admin, so a fresh deployment can't lock everyone out.
  const { rows: [{ count }] } = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM users'
  );
  const role = count === 0 ? 'admin' : config.sso.defaultRole;

  try {
    const { rows: [created] } = await pool.query<AuthUser>(
      `INSERT INTO users (email, name, role, sso_provider, sso_subject, sso_linked_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, email, name, role`,
      [identity.email, identity.name, role, provider, identity.subject]
    );
    console.log(`[sso] provisioned ${identity.email} as ${role}`);
    return { user: created };
  } catch (err) {
    // Two first-logins racing: the loser re-reads the winner's row.
    if ((err as { code?: string }).code === '23505') {
      const { rows: [raced] } = await pool.query<AuthUser>(
        `SELECT id, email, name, role FROM users
          WHERE (sso_provider = $1 AND sso_subject = $2) OR LOWER(email) = $3`,
        [provider, identity.subject, identity.email]
      );
      if (raced) return { user: raced };
    }
    throw err;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/auth/sso/login — start the flow.
router.get('/login', (req: Request, res: Response) => {
  const returnTo = safeReturnTo(req.query.returnTo);
  if (!config.sso.enabled) {
    fail(res, returnTo, 'sso_disabled', 'OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET not all set');
    return;
  }
  if (!config.sso.redirectUri) {
    fail(res, returnTo, 'sso_misconfigured', 'OIDC_REDIRECT_URI is not set');
    return;
  }

  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();

  discoverClient()
    .then((client) => {
      const url = client.authorizationUrl({
        scope: config.sso.scope,
        state,
        nonce,
        code_challenge: generators.codeChallenge(codeVerifier),
        code_challenge_method: 'S256',
      });
      res.cookie(FLOW_COOKIE, sealFlow({ state, nonce, codeVerifier, returnTo }), FLOW_COOKIE_OPTS);
      res.redirect(url);
    })
    .catch((err) => {
      fail(res, returnTo, 'idp_unreachable', err instanceof Error ? err.message : String(err));
    });
});

// GET /api/auth/sso/callback — the IdP sends the browser back here.
router.get('/callback', (req: Request, res: Response) => {
  const flow = openFlow(req.cookies?.[FLOW_COOKIE]);
  // Without the flow cookie there is nothing to validate the response against,
  // so the request is unauthenticated by definition — most often an expired
  // login page or a bookmarked callback URL.
  if (!flow) {
    fail(res, '/', 'flow_expired', 'missing or expired flow cookie');
    return;
  }
  const returnTo = flow.returnTo;

  void (async () => {
    try {
      const client = await discoverClient();
      const params = client.callbackParams(req);

      if (params.error) {
        fail(res, returnTo, 'idp_rejected', `${params.error}: ${params.error_description ?? ''}`);
        return;
      }

      // Verifies the ID token end to end — signature against the IdP's JWKS,
      // issuer, audience, expiry — plus the state/nonce/PKCE binding.
      const tokenSet = await client.callback(config.sso.redirectUri, params, {
        state: flow.state,
        nonce: flow.nonce,
        code_verifier: flow.codeVerifier,
      });

      const result = identityFromClaims(tokenSet.claims() as Record<string, unknown>, {
        allowedDomains: config.sso.allowedDomains,
      });
      if (!result.ok) {
        fail(res, returnTo, result.reason, result.detail);
        return;
      }

      const resolved = await resolveUser(result.identity, config.sso.issuer);
      if (resolved.error === 'not_provisioned') {
        fail(res, returnTo, 'not_provisioned', `no account for ${result.identity.email}`);
        return;
      }
      if (resolved.error === 'conflict' || !resolved.user) {
        fail(res, returnTo, 'account_conflict', `${result.identity.email} is already linked to another identity`);
        return;
      }

      res.clearCookie(FLOW_COOKIE, { path: FLOW_COOKIE_OPTS.path });
      res.cookie('gsoc_auth', signToken(resolved.user), COOKIE_OPTS);
      res.redirect(returnTo);
    } catch (err) {
      fail(res, returnTo, 'sso_failed', err instanceof Error ? err.message : String(err));
    }
  })();
});

export default router;
