// HTTP client for the public NGFS RealEarth viewer at CIMSS/SSEC
// (re-ngfs-pub.ssec.wisc.edu). Its /api endpoints return NGFS detections as
// GeoJSON, but only to a viewer session: the page sets PHPSESSID/SERVERID
// cookies, the viewer's JS (js/RELoader.js) mints a random hex "session hash"
// and registers it with /util/session.php, and every /api call then carries
// three re-* headers naming that session. None of it is a secret (no key, and
// CORS is open), but cookies rule out calling it from the browser, so the
// server holds one session and shares the data with every client.

import { createHash, randomBytes } from 'crypto';
import { config } from '../config';

export const REALEARTH_BASE = 'https://re-ngfs-pub.ssec.wisc.edu';

// Per request; the route never waits on more than one refresh (see index.ts).
const TIMEOUT_MS = 15_000;
// Sessions are PHP sessions on SSEC's side; renew well inside a typical
// 24-minute PHP session lifetime rather than waiting for a failure.
const SESSION_MAX_AGE_MS = 15 * 60_000;

// "compatible" UA naming the app and its operator contact (the same string
// NWS and Nominatim get), so SSEC can see who is calling.
const USER_AGENT = `Mozilla/5.0 (compatible; ${config.nwsUserAgent})`;

interface Session {
  hash: string;
  id: string; // PHPSESSID
  cookie: string; // Cookie header value
  createdAt: number;
}

type FetchFn = typeof fetch;

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Pull `name=value` pairs for the cookies we need out of a response's Set-Cookie headers. */
export function cookiesFrom(setCookies: string[]): Map<string, string> {
  const jar = new Map<string, string>();
  for (const line of setCookies) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

export class RealEarthClient {
  private session: Session | null = null;
  private opening: Promise<Session> | null = null;

  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now
  ) {}

  private async openSession(product: string): Promise<Session> {
    // 1. Land on the viewer page: the server sets PHPSESSID (+ SERVERID, the
    //    load balancer's affinity cookie). Redirects are followed by hand —
    //    fetch drops Set-Cookie from the 3xx responses it follows itself.
    const jar = new Map<string, string>();
    let url = `${REALEARTH_BASE}/?products=${encodeURIComponent(product)}&view=leaflet`;
    for (let hop = 0; ; hop++) {
      const r = await this.fetchFn(url, {
        headers: { 'User-Agent': USER_AGENT, ...(jar.size ? { Cookie: cookieHeader(jar) } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      for (const [k, v] of cookiesFrom(r.headers.getSetCookie())) jar.set(k, v);
      await r.arrayBuffer(); // drain so the socket is released
      const location = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && location && hop < 3) {
        url = new URL(location, url).toString();
        continue;
      }
      if (!r.ok) throw new Error(`RealEarth viewer HTTP ${r.status}`);
      break;
    }
    const id = jar.get('PHPSESSID');
    if (!id) throw new Error('RealEarth viewer set no PHPSESSID');
    const cookie = cookieHeader(jar);

    // 2. Register a fresh session hash, as the viewer's own script does; the
    //    endpoint echoes the hash back on success.
    const hash = randomBytes(16).toString('hex');
    const md5 = createHash('md5').update(hash).digest('hex');
    const echo = await this.fetchFn(`${REALEARTH_BASE}/util/session.php?sh=${hash}&md5=${md5}`, {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookie, Referer: `${REALEARTH_BASE}/` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const echoed = (await echo.text()).trim();
    if (!echo.ok || echoed !== hash) {
      throw new Error(`RealEarth session handshake failed (HTTP ${echo.status})`);
    }
    return { hash, id, cookie, createdAt: this.now() };
  }

  private async getSession(product: string): Promise<Session> {
    if (this.session && this.now() - this.session.createdAt < SESSION_MAX_AGE_MS) {
      return this.session;
    }
    // Concurrent callers share one handshake.
    if (!this.opening) {
      this.opening = this.openSession(product).finally(() => {
        this.opening = null;
      });
    }
    this.session = await this.opening;
    return this.session;
  }

  /**
   * GET an /api path as JSON. A rejected request is retried once on a brand
   * new session, since an expired or rotated session is the likeliest cause.
   */
  async getJson(path: string, product: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const s = await this.getSession(product);
      const r = await this.fetchFn(`${REALEARTH_BASE}${path}`, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          Cookie: s.cookie,
          Referer: `${REALEARTH_BASE}/`,
          're-session-hash': s.hash,
          're-session-id': s.id,
          're-access-key': '',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) return r.json();
      await r.arrayBuffer();
      if (attempt === 0 && r.status !== 404) {
        if (this.session === s) this.session = null;
        continue;
      }
      throw new Error(`RealEarth ${path.split('?')[0]} HTTP ${r.status}`);
    }
  }

  /** Frame stamps ("20261001.200117", oldest first) the product currently has. */
  async frameTimes(product: string): Promise<string[]> {
    const body = await this.getJson(`/api/products?products=${encodeURIComponent(product)}`, product);
    const times = Array.isArray(body) ? (body[0] as { times?: unknown } | undefined)?.times : undefined;
    if (!Array.isArray(times)) throw new Error(`RealEarth: no time list for ${product}`);
    return times.filter((t): t is string => typeof t === 'string');
  }

  /** The detections of one frame, as the upstream GeoJSON FeatureCollection. */
  async frame(product: string, stamp: string): Promise<unknown> {
    const [d, t] = stamp.split('.');
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const time = `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
    return this.getJson(
      `/api/shapes?products=${encodeURIComponent(product)}&date=${date}` +
        `&time=${encodeURIComponent(time)}&bounds=&merge=none&notifications=false`,
      product
    );
  }
}
