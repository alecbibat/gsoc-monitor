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

// The allowlisted passenger vessels we actually display. This map keeps each
// ship's LAST KNOWN position indefinitely (never evicted, never capped) so a
// vessel that sails out of coastal AIS range stays on the map at its last
// reported spot until a fresh report updates it.
const tracked = new Map<string, VesselData>();
// MMSIs confirmed to belong to an allowlisted IMO (learned from static data).
// AIS position reports identify a vessel only by MMSI, so once we've correlated
// an MMSI to an allowlisted IMO we keep updating it even if static data stops.
const allowedMmsis = new Set<string>();

function isAllowed(mmsi: string, imo: number | null): boolean {
  if (allowedMmsis.has(mmsi)) return true;
  if (imo !== null && ALLOWED_IMOS.has(imo)) {
    allowedMmsis.add(mmsi);
    return true;
  }
  return false;
}

// Per-ship breadcrumb history (where each vessel has been), used to draw the
// "past path". Like the tracked map, this lives in memory for the process.
interface TrackPoint {
  lat: number;
  lon: number;
  t: number;
}
const history = new Map<string, TrackPoint[]>();
const MAX_TRACK_POINTS = 400;
const MAX_TRACK_AGE_MS = 72 * 60 * 60_000; // 72h
const MIN_TRACK_MOVE_M = 75; // ignore jitter while moored/anchored

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function recordHistory(mmsi: string, lat: number, lon: number, t: number): void {
  let h = history.get(mmsi);
  if (!h) {
    h = [];
    history.set(mmsi, h);
  }
  const last = h[h.length - 1];
  if (last && haversineM(last.lat, last.lon, lat, lon) < MIN_TRACK_MOVE_M) return;
  h.push({ lat, lon, t });
  const cutoff = t - MAX_TRACK_AGE_MS;
  while (h.length > MAX_TRACK_POINTS || (h.length > 0 && h[0].t < cutoff)) h.shift();
}

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

    // Always accept reports for confirmed allowlisted ships; only apply the
    // memory cap to the anonymous firehose.
    const known = allowedMmsis.has(mmsi);
    if (!known && vessels.size >= VESSEL_CAP && !vessels.has(mmsi)) return;

    const existing = vessels.get(mmsi) ?? tracked.get(mmsi);
    const sd = staticCache.get(mmsi);

    const record: VesselData = {
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
    };

    vessels.set(mmsi, record);
    // Promote into the permanent tracked map once we know it's allowlisted.
    if (isAllowed(mmsi, record.imo)) {
      tracked.set(mmsi, record);
      recordHistory(mmsi, lat, lon, now);
    }
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

    // Enrich an existing position entry immediately if we have one.
    const existing = vessels.get(mmsi) ?? tracked.get(mmsi);
    if (existing) {
      const enriched: VesselData = {
        ...existing,
        imo: info.imo ?? existing.imo,
        name: info.name || existing.name,
        callsign: info.callsign || existing.callsign,
        shipType: info.shipType ?? existing.shipType,
        destination: info.destination || existing.destination,
      };
      vessels.set(mmsi, enriched);
      // Now that static data may have revealed an allowlisted IMO, promote it
      // (with its last known position) into the permanent tracked map.
      if (isAllowed(mmsi, enriched.imo)) {
        tracked.set(mmsi, enriched);
        recordHistory(mmsi, enriched.latitude, enriched.longitude, enriched.updatedAt);
      }
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

  // Return every tracked ship at its last known position regardless of age —
  // no staleness cutoff, so they stay visible until a fresh report moves them.
  // Dedupe by IMO (keeping the most recent) in case an MMSI was reassigned.
  const best = new Map<string, VesselData>();
  for (const v of tracked.values()) {
    const key = v.imo !== null ? `imo:${v.imo}` : `mmsi:${v.mmsi}`;
    const prev = best.get(key);
    if (!prev || v.updatedAt > prev.updatedAt) best.set(key, v);
  }
  const result = [...best.values()].map((v) => ({
    ...v,
    lastSeenSec: (now - v.updatedAt) / 1000,
    track: history.get(v.mmsi) ?? [],
  }));

  res.json({
    source: 'aisstream',
    ships: result,
    updated: now,
    connected: ws !== null && ws.readyState === WebSocket.OPEN,
    total: ALLOWED_IMOS.size,
  });
});

export default router;
