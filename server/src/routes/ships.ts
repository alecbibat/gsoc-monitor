import { Router } from 'express';
import WebSocket from 'ws';
import { config } from '../config';

const router = Router();

interface VesselData {
  mmsi: string;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  latitude: number;
  longitude: number;
  speedKt: number | null;
  heading: number | null;   // TrueHeading from AIS (ship's compass bearing)
  course: number | null;    // COG (course over ground)
  navStatus: number | null; // AIS navigation status 0-15
  destination: string | null;
  updatedAt: number; // ms timestamp
}

// In-memory vessel store keyed by MMSI.
const vessels = new Map<string, VesselData>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // Earth radius in NM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function evictStale() {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [mmsi, v] of vessels) {
    if (v.updatedAt < cutoff) vessels.delete(mmsi);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleMessage(raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const type = msg?.MessageType as string | undefined;
  const meta = msg?.MetaData ?? {};
  const mmsi = String(meta.MMSI ?? '');
  if (!mmsi || !type) return;

  const now = Date.now();

  if (type === 'PositionReport') {
    const pr = msg.Message?.PositionReport ?? {};
    const lat = typeof pr.Latitude === 'number' ? pr.Latitude : null;
    const lon = typeof pr.Longitude === 'number' ? pr.Longitude : null;
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

    const existing = vessels.get(mmsi);
    vessels.set(mmsi, {
      mmsi,
      name: (meta.ShipName as string | undefined)?.trim() || existing?.name || null,
      callsign: existing?.callsign ?? null,
      shipType: existing?.shipType ?? null,
      latitude: lat,
      longitude: lon,
      speedKt: typeof pr.Sog === 'number' ? pr.Sog : existing?.speedKt ?? null,
      // TrueHeading 511 = "not available" sentinel in AIS
      heading:
        typeof pr.TrueHeading === 'number' && pr.TrueHeading !== 511
          ? pr.TrueHeading
          : existing?.heading ?? null,
      // COG 360 = "not available" sentinel in AIS
      course:
        typeof pr.Cog === 'number' && pr.Cog < 360
          ? pr.Cog
          : existing?.course ?? null,
      navStatus:
        typeof pr.NavigationalStatus === 'number'
          ? pr.NavigationalStatus
          : existing?.navStatus ?? null,
      destination: existing?.destination ?? null,
      updatedAt: now,
    });
  } else if (type === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData ?? {};
    const existing = vessels.get(mmsi);
    // Only enrich vessels we've already positioned
    if (!existing) return;
    vessels.set(mmsi, {
      ...existing,
      name: (sd.Name as string | undefined)?.trim() || existing.name,
      callsign: (sd.CallSign as string | undefined)?.trim() || existing.callsign,
      shipType: typeof sd.Type === 'number' ? sd.Type : existing.shipType,
      destination: (sd.Destination as string | undefined)?.trim() || existing.destination,
    });
  }
}

function connectAIS() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    ws.on('open', () => {
      ws?.send(
        JSON.stringify({
          APIKey: config.aisstreamApiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        })
      );
      console.log('AIS stream connected');
    });

    ws.on('message', (data: WebSocket.RawData) => handleMessage(data.toString()));

    ws.on('close', () => {
      ws = null;
      reconnectTimer = setTimeout(connectAIS, 5_000);
    });

    ws.on('error', (err) => {
      console.error('AIS WebSocket error:', err.message);
      ws?.terminate();
    });
  } catch (err) {
    reconnectTimer = setTimeout(connectAIS, 5_000);
    console.error('AIS connect failed:', err);
  }
}

// Called from index.ts after dotenv.config() to ensure env vars are set.
export function initShipsStream() {
  if (!config.aisstreamApiKey) return;
  connectAIS();
  setInterval(evictStale, 5 * 60_000);
}

function isValidLat(n: number) {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLon(n: number) {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

router.get('/', (req, res) => {
  if (!config.aisstreamApiKey) {
    res.json({ source: 'no-key', ships: [], updated: Date.now() });
    return;
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const distReq = Number(req.query.dist);
  const dist = Number.isFinite(distReq) ? Math.min(500, Math.max(1, Math.round(distReq))) : 200;

  if (!isValidLat(lat) || !isValidLon(lon)) {
    res.status(400).json({ error: 'lat and lon are required' });
    return;
  }

  const now = Date.now();
  const cutoff = now - 15 * 60_000;
  const nearby: Array<VesselData & { lastSeenSec: number }> = [];

  for (const v of vessels.values()) {
    if (v.updatedAt < cutoff) continue;
    if (haversineNm(lat, lon, v.latitude, v.longitude) <= dist) {
      nearby.push({ ...v, lastSeenSec: (now - v.updatedAt) / 1000 });
    }
  }

  // Most recently seen first, cap at 500
  nearby.sort((a, b) => a.lastSeenSec - b.lastSeenSec);

  res.json({
    source: 'aisstream',
    ships: nearby.slice(0, 500),
    updated: now,
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
  });
});

export default router;
