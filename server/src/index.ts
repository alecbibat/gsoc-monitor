import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { config } from './config';
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

dotenv.config();

const app = express();

app.use(cors());
// Crisis share state embeds base64 images (layer map thumbnails + action-log
// photo attachments), so a published incident can be several MB. Keep a
// generous limit — a too-small one returns 413 and silently drops the update,
// which surfaces to viewers as "share link not found" when a fresh publish fails.
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
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
app.use('/api/crisis', crisisRouter);

// Start AIS WebSocket stream (after dotenv so env vars are available).
initShipsStream();

// Serve the built client as static files, with an SPA fallback so client-side
// routing (if any is added later) keeps working on refresh/deep links.
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`gsoc-monitor server listening on port ${config.port}`);
});
