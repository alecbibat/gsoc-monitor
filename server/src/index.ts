import path from 'path';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { config } from './config';
import { migrate } from './migrate';
import earthquakesRouter from './routes/earthquakes';
import radarRouter from './routes/radar';
import flightsRouter from './routes/flights';
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
import lightningRouter, { initLightningStream } from './routes/lightning';
import riversRouter, { initRiversStream } from './routes/rivers';
import fireOutlookRouter from './routes/fireOutlook';
import jtwcRouter from './routes/jtwc';
import outagesRouter, { initOutagesStream } from './routes/outages';
import briefingRouter from './routes/briefing';
import crisisRouter from './routes/crisis';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import incidentsRouter from './routes/incidents';

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

  // Gzip every response — the API ships large JSON payloads (lightning history,
  // outages, rivers, ships) that compress 5–10×, and the static client bundle
  // benefits too. Costs a little CPU on a mostly-idle dyno.
  app.use(compression());
  app.use(cors());
  app.use(cookieParser());
  // Crisis share state embeds Cloudinary URLs after the migration (previously
  // base64 blobs), but keep a generous limit for any legacy imports.
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Auth + admin (no requireAuth here — middleware is applied per-router)
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);

  // Incident CRUD (requireAuth applied inside router)
  app.use('/api/incidents', incidentsRouter);

  // Crisis share links (public — no auth for viewer access)
  app.use('/api/crisis', crisisRouter);

  // Live data layers
  app.use('/api/earthquakes', earthquakesRouter);
  app.use('/api/radar', radarRouter);
  app.use('/api/flights', flightsRouter);
  app.use('/api/geocode', geocodeRouter);
  app.use('/api/ships', shipsRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/county', countyRouter);
  app.use('/api/park', parkRouter);
  app.use('/api/directions', directionsRouter);
  app.use('/api/drive', driveRouter);
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
  app.use('/api/briefing', briefingRouter);

  initShipsStream();
  // Persistent Blitzortung collector → rolling buffer behind /api/lightning so
  // the client can request the last 1/6/12/24h of strikes.
  initLightningStream();
  // Keep the NWPS national gauge list warm in the cache so /api/rivers never
  // blocks on the ~13 MB upstream pull.
  initRiversStream();
  // Keep the wind grid warm in the background; the route always serves the best
  // available grid (live → snapshot → baked-in fallback), never blocking.
  initWindStream();
  // Multi-state power-outage aggregator — rebuilt in the background so
  // /api/outages always answers instantly.
  initOutagesStream();

  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  // Bind the port immediately so the dyno boots even while the database is
  // unreachable (and well within Heroku's 60s boot window). Migrations run in
  // the background and the app self-heals when Postgres comes back.
  app.listen(config.port, () => {
    console.log(`gsoc-monitor server listening on port ${config.port}`);
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
