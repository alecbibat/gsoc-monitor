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

dotenv.config();

const app = express();

app.use(cors());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/earthquakes', earthquakesRouter);
app.use('/api/radar', radarRouter);
app.use('/api/flights', flightsRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/pizza', pizzaRouter);
app.use('/api/ships', shipsRouter);

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
