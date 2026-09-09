const csv = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * How email+password sign-in behaves alongside SSO. The migration runs through
 * these in order:
 *
 *   all        — phase 1: everyone can use either password or SSO.
 *   admin-only — phase 3: only admins keep a password (the break-glass account
 *                for when the IdP is unreachable); everyone else must use SSO.
 *   off        — passwords disabled outright. Not recommended here: this is an
 *                emergency-operations tool, and an IdP outage is exactly the
 *                kind of incident it exists to coordinate.
 */
export type PasswordLoginMode = 'all' | 'admin-only' | 'off';

function passwordLoginMode(): PasswordLoginMode {
  const raw = (process.env.PASSWORD_LOGIN_MODE ?? 'all').trim().toLowerCase();
  return raw === 'admin-only' || raw === 'off' ? raw : 'all';
}

export const config = {
  port: Number(process.env.PORT) || 5174,

  // ── Authentication ──────────────────────────────────────────────────────────
  passwordLoginMode: passwordLoginMode(),
  // Self-serve signup with the shared code. Turn off once IT provisions
  // accounts (admin panel) and SSO carries everyone in.
  signupEnabled: process.env.SIGNUP_ENABLED !== 'false',

  sso: {
    // SSO turns itself on only when fully configured — a half-set env can't
    // leave a dead "Sign in with SSO" button on the login screen.
    get enabled(): boolean {
      return Boolean(
        process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET
      );
    },
    issuer: process.env.OIDC_ISSUER ?? '',
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    // Must match the redirect URI registered with the IdP exactly.
    redirectUri: process.env.OIDC_REDIRECT_URI ?? '',
    scope: process.env.OIDC_SCOPE ?? 'openid email profile',
    buttonLabel: process.env.SSO_BUTTON_LABEL ?? 'Sign in with SSO',
    // Email domains the IdP is authoritative for. Empty = allow any domain the
    // IdP vouches for; set it in production so a misconfigured multi-tenant
    // app registration can't admit outside accounts.
    allowedDomains: csv(process.env.SSO_ALLOWED_DOMAINS),
    // false (default) = IT pre-creates accounts and SSO links them by email,
    // which is the agreed model. true = create an account on first SSO login.
    autoProvision: process.env.SSO_AUTO_PROVISION === 'true',
    defaultRole: process.env.SSO_DEFAULT_ROLE === 'admin' ? 'admin' : 'member',
  },

  nwsUserAgent: process.env.NWS_USER_AGENT || 'gsoc-monitor (no-contact-set)',
  // aisstream.io API key — free at https://aisstream.io — add as AISSTREAM_API_KEY
  // in Heroku Config Vars. Without it the layer shows a no-key placeholder.
  aisstreamApiKey: process.env.AISSTREAM_API_KEY || '',
  // Optional paid AIS providers for reliable by-IMO positions (free aisstream
  // can't always see the fleet). Set EITHER one and the server polls the fleet's
  // positions and drops them onto the map as pins. VesselFinder is self-serve
  // (https://api.vesselfinder.com); MyShipTracking is the other supported option.
  vesselfinderApiKey: process.env.VESSELFINDER_API_KEY || '',
  myshiptrackingApiKey: process.env.MYSHIPTRACKING_API_KEY || '',
  // Free fallback: scrape CruiseMapper's public ship pages by IMO when no paid
  // key is set. CruiseMapper carries satellite-AIS positions (it sees the fleet
  // at sea, unlike free aisstream) but sits behind Cloudflare, so a plain server
  // fetch may be blocked — watch /api/ships/debug to see if it gets through.
  // Set SHIPS_SCRAPE_CRUISEMAPPER=0 to disable.
  cruisemapperScrape: process.env.SHIPS_SCRAPE_CRUISEMAPPER !== '0',
  // NPS Data API key — free at https://www.nps.gov/subjects/developer/get-started.htm.
  // DEMO_KEY works out of the box (rate-limited); set NPS_API_KEY in Config Vars
  // for production headroom. Used for park news releases + alerts/closures.
  npsApiKey: process.env.NPS_API_KEY || 'DEMO_KEY',
};
