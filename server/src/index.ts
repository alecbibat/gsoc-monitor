import path from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { config } from './config';
import { migrate } from './migrate';
import earthquakesRouter from './routes/earthquakes';
import radarRouter from './routes/radar';
import flightsRouter from './routes/flights';
import geocodeRouter from './routes/geocode';
import pizzaRouter from './routes/pizza';
import shipsRouter, { initShipsStream } from './routes/ships';
import newsRouter from './routes/news';
import countyRouter from './routes/county';
import parkRouter from './routes/park';
import directionsRouter from './routes/directions';
import driveRouter from './routes/route';
import parkNewsRouter from './routes/parkNews';
import satellitesRouter from './routes/satellites';
import webcamsRouter from './routes/webcams';
import crisisRouter from './routes/crisis';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import incidentsRouter from './routes/incidents';

dotenv.config();

async function main() {
  await migrate();

  const app = express();

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
  app.use('/api/pizza', pizzaRouter);
  app.use('/api/ships', shipsRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/county', countyRouter);
  app.use('/api/park', parkRouter);
  app.use('/api/directions', directionsRouter);
  app.use('/api/drive', driveRouter);
  app.use('/api/park-news', parkNewsRouter);
  app.use('/api/satellites', satellitesRouter);
  app.use('/api/webcams', webcamsRouter);

  initShipsStream();

  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.listen(config.port, () => {
    console.log(`gsoc-monitor server listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
