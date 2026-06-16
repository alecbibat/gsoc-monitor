import { Router } from 'express';
import WebSocket from 'ws';
import { config } from '../config';

const router = Router();

// Only show these specific passenger vessels.
const ALLOWED_IMOS = new Set([8807997, 9008598, 8707343, 9904819, 8603509, 8420878, 8700785]);

interface VesselData {
  mmsi: string;
  imo: number | null;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  latitude: number;
  longitude: number;
  speedKt: number | null;
  heading: number | null;   // TrueHeading (511 = not available in AIS)
  course: number | null;    // COG
  navStatus: number | null; // AIS navigation status 0-15
  destination: string | null;
  updatedAt: number;
}

// Side-cache for static data that may arrive before a position report.
interface StaticInfo {
  imo: number | null;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  destination: string | null;
}

const vessels = new Map<string, VesselData>();
const staticCache = new Map<string, StaticInfo>();

// Prevent unbounded memory growth from the global AIS stream.
const VESSEL_CAP = 50_000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

    if (vessels.size >= VESSEL_CAP && !vessels.has(mmsi)) return;

    const existing = vessels.get(mmsi);
    const sd = staticCache.get(mmsi);

    vessels.set(mmsi, {
      mmsi,
      imo: sd?.imo ?? existing?.imo ?? null,
      name: sd?.name || (meta.ShipName as string | undefined)?.trim() || existing?.name || null,
      callsign: sd?.callsign ?? existing?.callsign ?? null,
      shipType: sd?.shipType ?? existing?.shipType ?? null,
      latitude: lat,
      longitude: lon,
      speedKt: typeof pr.Sog === 'number' ? pr.Sog : existing?.speedKt ?? null,
      heading:
        typeof pr.TrueHeading === 'number' && pr.TrueHeading !== 511
          ? pr.TrueHeading
          : existing?.heading ?? null,
      course:
        typeof pr.Cog === 'number' && pr.Cog < 360
          ? pr.Cog
          : existing?.course ?? null,
      navStatus:
        typeof pr.NavigationalStatus === 'number'
          ? pr.NavigationalStatus
          : existing?.navStatus ?? null,
      destination: sd?.destination ?? existing?.destination ?? null,
      updatedAt: now,
    });
  } else if (type === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData ?? {};
    const imo = typeof sd.ImoNumber === 'number' && sd.ImoNumber > 0 ? sd.ImoNumber : null;
    const info: StaticInfo = {
      imo,
      name: (sd.Name as string | undefined)?.trim() || null,
      callsign: (sd.CallSign as string | undefined)?.trim() || null,
      shipType: typeof sd.Type === 'number' ? sd.Type : null,
      destination: (sd.Destination as string | undefined)?.trim() || null,
    };
    staticCache.set(mmsi, info);

    // Enrich existing position entry immediately if we have one.
    const existing = vessels.get(mmsi);
    if (existing) {
      vessels.set(mmsi, {
        ...existing,
        imo: info.imo ?? existing.imo,
        name: info.name || existing.name,
        callsign: info.callsign || existing.callsign,
        shipType: info.shipType ?? existing.shipType,
        destination: info.destination || existing.destination,
      });
    }
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

export function initShipsStream() {
  if (!config.aisstreamApiKey) return;
  connectAIS();
  setInterval(evictStale, 5 * 60_000);
}

router.get('/', (_req, res) => {
  if (!config.aisstreamApiKey) {
    res.json({ source: 'no-key', ships: [], updated: Date.now() });
    return;
  }

  const now = Date.now();
  const cutoff = now - 15 * 60_000;
  const result = [];

  for (const v of vessels.values()) {
    if (v.updatedAt < cutoff) continue;
    if (v.imo !== null && ALLOWED_IMOS.has(v.imo)) {
      result.push({ ...v, lastSeenSec: (now - v.updatedAt) / 1000 });
    }
  }

  res.json({
    source: 'aisstream',
    ships: result,
    updated: now,
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
    total: ALLOWED_IMOS.size,
  });
});

export default router;
