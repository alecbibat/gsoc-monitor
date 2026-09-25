import fs from 'fs';
import path from 'path';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { config } from './config';
import { migrate } from './migrate';
import alertsRouter from './routes/alerts';
import earthquakesRouter from './routes/earthquakes';
import radarRouter from './routes/radar';
import flightsRouter, { initFlightsTracker } from './routes/flights';
import geocodeRouter from './routes/geocode';
import shipsRouter, { initShipsStream } from './routes/ships';
import newsRouter from './routes/news';
import countyRouter from './routes/county';
import parkRouter from './routes/park';
import directionsRouter from './routes/directions';
import driveRouter from './routes/route';
import parkNewsRouter from './routes/parkNews';
import satellitesRouter from './routes/satellites';
import newsMapRouter from './routes/newsMap';
import smokeRouter from './routes/smoke';
import aqiRouter from './routes/aqi';
import windRouter, { initWindStream } from './routes/wind';
import lightningRouter, { initLightning, shutdownLightning } from './lightning';
import riversRouter, { initRiversStream } from './routes/rivers';
import fireOutlookRouter from './routes/fireOutlook';
import jtwcRouter from './routes/jtwc';
import outagesRouter, { initOutagesStream } from './routes/outages';
import crisisRouter from './routes/crisis';
import authRouter from './routes/auth';
import ssoRouter from './routes/sso';
import adminRouter from './routes/admin';
import incidentsRouter from './routes/incidents';
import iapRouter from './routes/iap';
import watchlistRouter from './routes/watchlist';
import intelRouter from './routes/intel';
import { initIntelStream } from './intel/service';
import { requireAuth } from './middleware/auth';

dotenv.config();

// Bring the database schema up to date, retrying with backoff. Crucially this
// is NOT allowed to take the process down: a database outage must degrade only
// the DB-backed routes (auth, incidents, crisis), not black out the entire
// dashboard. The server previously `await migrate()`d before listening and
// exited(1) on any connection error — so a Postgres hiccup H10-crashed the dyno
// and 503'd every route, including the static client and the non-DB APIs.
async function migrateWithRetry(maxAttempts = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate();
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxAttempts) {
        console.error(
          `[migrate] failed after ${attempt} attempts (${msg}). DB-backed routes ` +
            '(auth, incidents, crisis) will error until the database is reachable; ' +
            'the globe, static client and non-DB APIs remain available.'
        );
        return;
      }
      const waitMs = Math.min(30_000, 1000 * 2 ** attempt);
      console.error(
        `[migrate] attempt ${attempt}/${maxAttempts} failed (${msg}); retrying in ${waitMs / 1000}s`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

function main() {
  const app = express();

  // Heroku's router is the single proxy hop in front of the dyno and appends
  // the real client address to X-Forwarded-For. Trust exactly that one hop so
  // req.ip is the client (per-IP login brake in routes/auth.ts, share access
  // log in routes/crisis.ts) rather than the router's internal 10.x address.
  // Must be 1, not true: `true` takes the left-most, client-spoofable entry.
  // Gated on DYNO (always set on Heroku) so a host with no proxy in front
  // doesn't let clients pick their own req.ip via X-Forwarded-For.
  if (process.env.DYNO) app.set('trust proxy', 1);

  // Gzip every response — the API ships large JSON payloads (lightning history,
  // outages, rivers, ships) that compress 5–10×, and the static client bundle
  // benefits too. Costs a little CPU on a mostly-idle dyno.
  //
  // EXCEPT server-sent event streams: gzip holds writes in the zlib buffer, so
  // SSE events (crisis share updates, incident live sync) sat server-side and
  // never reached the browser — viewers had to refresh to see changes.
  app.use(
    compression({
      filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.includes('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    })
  );
  app.use(cors());
  app.use(cookieParser());
  // Crisis share state embeds Cloudinary URLs after the migration (previously
  // base64 blobs) — only that router keeps a generous limit for legacy imports.
  // Everywhere else 1mb is plenty, and it stops an oversized (or malicious)
  // body from synchronously parsing 50 MB of JSON on the single dyno.
  // inflate:false — no client of ours compresses request bodies (browsers never
  // do), and these parsers run BEFORE per-route auth. With inflation on, a ~46 KB
  // gzip body decodes to ~48 MB and JSON.parses to >1 GB RSS unauthenticated.
  app.use('/api/crisis', express.json({ limit: '50mb', inflate: false }));
  app.use('/api/incidents', express.json({ limit: '5mb', inflate: false }));
  // IAP uploads arrive as base64 JSON from the admin panel (15 MB PDF cap
  // -> ~20 MB encoded).
  app.use('/api/iap', express.json({ limit: '25mb', inflate: false }));
  app.use(express.json({ limit: '1mb', inflate: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Auth + admin (no requireAuth here — middleware is applied per-router).
  // The SSO router mounts first so /api/auth/sso/* is matched before the
  // password routes' own paths.
  app.use('/api/auth/sso', ssoRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);

  // Incident CRUD (requireAuth applied inside router)
  app.use('/api/incidents', incidentsRouter);

  // Incident Action Plan document library (auth/admin applied per-route)
  app.use('/api/iap', iapRouter);

  // Team-shared OSINT watchlist CRUD (requireAuth applied inside router)
  app.use('/api/watchlist', watchlistRouter);
  // Public read-only intel feed (the ingested Dataminr-style buffer)
  app.use('/api/intel', intelRouter);

  // Crisis share links (public — no auth for viewer access)
  app.use('/api/crisis', crisisRouter);

  // Live data layers
  app.use('/api/alerts', alertsRouter);
  app.use('/api/earthquakes', earthquakesRouter);
  app.use('/api/radar', radarRouter);
  app.use('/api/flights', flightsRouter);
  app.use('/api/geocode', geocodeRouter);
  app.use('/api/ships', shipsRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/county', countyRouter);
  app.use('/api/park', parkRouter);
  // Unused by the client (routes in-browser); gated so it isn't a public Overpass/OSRM proxy.
  app.use('/api/directions', requireAuth, directionsRouter);
  app.use('/api/drive', requireAuth, driveRouter);
  app.use('/api/park-news', parkNewsRouter);
  app.use('/api/satellites', satellitesRouter);
  app.use('/api/news-map', newsMapRouter);
  app.use('/api/smoke', smokeRouter);
  app.use('/api/aqi', aqiRouter);
  app.use('/api/wind', windRouter);
  app.use('/api/lightning', lightningRouter);
  app.use('/api/rivers', riversRouter);
  app.use('/api/fire-outlook', fireOutlookRouter);
  app.use('/api/jtwc-invests', jtwcRouter);
  app.use('/api/outages', outagesRouter);

  initShipsStream();
  // Background ADS-B poller: keeps last-known aircraft positions and altitude
  // trails accumulating (and persisted) even when no client is connected.
  initFlightsTracker();
  // Persistent Blitzortung collector: every strike of the last 24 h, kept in
  // memory and in Postgres, behind /api/lightning (display field, counts near
  // a location, collector health). It starts collecting immediately and
  // restores the persisted history in the background — never the other way
  // round, so a slow or unreachable database costs no live strikes.
  initLightning();
  // Keep the NWPS national gauge list warm in the cache so /api/rivers never
  // blocks on the ~13 MB upstream pull.
  initRiversStream();
  // Keep the wind grid warm in the background; the route always serves the best
  // available grid (live → snapshot → baked-in fallback), never blocking.
  initWindStream();
  // Multi-state power-outage aggregator — rebuilt in the background so
  // /api/outages always answers instantly.
  initOutagesStream();
  // Dataminr-style OSINT ingest: scanner/dispatch, crime, crashes, news and
  // social feeds normalized into one rolling buffer behind /api/intel.
  initIntelStream();

  const clientDist = path.join(__dirname, '../../client/dist');

  // Build-time brotli-11 siblings (client/scripts/precompress.mjs). Serving them
  // avoids re-compressing multi-MB static files (Cesium.js) at q4 on every full
  // response; decoded bytes are identical.
  const precompressed = new Set<string>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.br')) {
        precompressed.add('/' + path.relative(clientDist, full.slice(0, -3)).split(path.sep).join('/'));
      }
    }
  };
  walk(clientDist); // once at boot, before listen

  // Vite emits content-hashed filenames under assets/, and Cesium is copied into
  // a version-named cesium-<version>/ folder (client/vite.config.ts), so both can
  // be cached forever; index.html must revalidate so a deploy is picked up
  // immediately.
  const serveClient = express.static(clientDist, {
    setHeaders: (res, filePath) => {
      let p = filePath;
      if (p.endsWith('.br')) {
        // Same Content-Type send would have set for the uncompressed file (not
        // res.type(), which lowercases the charset).
        p = p.slice(0, -3);
        const type = express.static.mime.lookup(p);
        const charset = express.static.mime.charsets.lookup(type, '');
        res.setHeader('Content-Type', type + (charset ? '; charset=' + charset : ''));
        res.setHeader('Content-Encoding', 'br');
      }
      if (
        p.includes(`${path.sep}assets${path.sep}`) ||
        /^cesium-\d/.test(path.relative(clientDist, p).split(path.sep)[0])
      ) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (p.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  });
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !precompressed.has(req.path)) return next();
    res.vary('Accept-Encoding');
    // Ask about br on its own: a combined acceptsEncodings('gzip', 'br') follows
    // the header's order and would pick gzip for Chrome. Range requests keep
    // today's path so byte offsets still address the uncompressed file.
    if (req.acceptsEncodings('br') !== 'br' || req.headers.range) return next();
    const originalUrl = req.url;
    const q = originalUrl.indexOf('?');
    req.url = q === -1 ? originalUrl + '.br' : originalUrl.slice(0, q) + '.br' + originalUrl.slice(q);
    // compression() skips the response ('already encoded' via Content-Encoding);
    // if the .br is missing, fall through to the plain file with the URL restored.
    // send doesn't clear headers on errors it forwards (e.g. 412), so drop the
    // br headers setHeaders added before the backstop writes its JSON.
    serveClient(req, res, (err?: unknown) => {
      req.url = originalUrl;
      if (err) {
        res.removeHeader('Content-Encoding');
        res.removeHeader('Content-Type');
      }
      next(err);
    });
  });
  app.use(serveClient);
  // Long-open tabs keep the Cesium base URL they booted with and fetch workers,
  // wasm and assets lazily, the first time they need them: /cesium/ for tabs
  // opened before Cesium moved to cesium-<version>/, and /cesium-<old>/ for tabs
  // opened before a Cesium upgrade. Serve both from the current folder with the
  // old 1h cache, as the unversioned /cesium/ path always did. Requests for the
  // current version were already answered by serveClient above.
  let cesiumDir: string | undefined;
  try {
    cesiumDir = fs.readdirSync(clientDist).find((d) => /^cesium-\d/.test(d));
  } catch {
    /* no client build (dev) */
  }
  if (cesiumDir) {
    const staleCesium = express.static(path.join(clientDist, cesiumDir), {
      setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=3600'),
    });
    app.use('/cesium', staleCesium);
    app.use(/^\/cesium-\d[^/]*/, staleCesium);
  }
  app.get('*', (req, res) => {
    // A missing hashed chunk (stale tab requesting assets from a previous
    // deploy) must 404, not serve index.html — a 200 text/html response to a
    // module import makes React.lazy throw and blank the whole page. Same for a
    // Cesium worker/asset from a previous Cesium version's folder.
    if (
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/cesium-') ||
      req.path.startsWith('/cesium/')
    ) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // Backstop for anything that reaches next(err) — without it Express prints
  // HTML stack traces; with it API consumers get JSON and the process stays up.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[express]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });

  // Bind the port immediately so the dyno boots even while the database is
  // unreachable (and well within Heroku's 60s boot window). Migrations run in
  // the background and the app self-heals when Postgres comes back.
  const server = app.listen(config.port, () => {
    console.log(`gsoc-monitor server listening on port ${config.port}`);
  });

  // Heroku sends SIGTERM to every process, allows 30s, then SIGKILLs (R12).
  // Any SIGTERM listener disables Node's default exit, so we must exit
  // ourselves: stop accepting connections, let in-flight requests finish,
  // persist the lightning tail, then exit. Lightning shuts down in two phases:
  // it flushes at once but keeps collecting until the server has closed (or
  // 20 s), then stops and makes a final flush bounded at 3 s — so the strikes
  // of the shutdown window itself are saved too. The unref'd backstop exits
  // before the 30s SIGKILL even if a long-lived SSE stream or a stuck DB
  // write keeps things open.
  process.once('SIGTERM', () => {
    console.log('[shutdown] SIGTERM - flushing and exiting');
    setTimeout(() => process.exit(0), 25_000).unref();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    void Promise.allSettled([shutdownLightning(closed), closed]).then(() => process.exit(0));
  });

  void migrateWithRetry();
}

// A rejected background promise (an external-API poller, the AIS stream, a
// retried migration) must not crash a long-running monitoring server — log it
// and stay up. Genuine startup faults still throw synchronously out of main().
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

try {
  main();
} catch (err) {
  console.error('Server failed to start:', err);
  process.exit(1);
}
