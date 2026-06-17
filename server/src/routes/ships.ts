import { Router } from 'express';
import WebSocket from 'ws';
import { config } from '../config';

const router = Router();

// The tracked passenger fleet (Windstar Cruises). AIS identifies vessels only by
// MMSI, so we subscribe to these MMSIs directly rather than fishing them out of
// the global firehose by waiting for each ship's periodic static-data (IMO)
// broadcast — the latter almost never catches a specific ship at the free tier's
// volume. IMO + name are seeded so a position report can be labelled before any
// static-data message arrives. MMSIs verified against VesselFinder/MarineTraffic.
interface FleetShip {
  mmsi: string;
  imo: number;
  name: string;
}
const FLEET: FleetShip[] = [
  { mmsi: '311083000', imo: 8807997, name: 'Star Breeze' },
  { mmsi: '311085000', imo: 9008598, name: 'Star Legend' },
  { mmsi: '311084000', imo: 8707343, name: 'Star Pride' },
  { mmsi: '311001759', imo: 9904819, name: 'Star Seeker' },
  { mmsi: '309056000', imo: 8603509, name: 'Wind Spirit' },
  { mmsi: '309163000', imo: 8420878, name: 'Wind Star' },
  { mmsi: '309242000', imo: 8700785, name: 'Wind Surf' },
];
const ALLOWED_IMOS = new Set(FLEET.map((s) => s.imo));
const FLEET_MMSIS = FLEET.map((s) => s.mmsi);

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
// MMSIs confirmed to belong to an allowlisted IMO. Pre-seeded from the known
// fleet so position reports are accepted and labelled immediately (no need to
// wait for a static-data message), and topped up by isAllowed() if static data
// ever reveals an allowlisted IMO under a new MMSI.
const allowedMmsis = new Set<string>();
for (const s of FLEET) {
  allowedMmsis.add(s.mmsi);
  staticCache.set(s.mmsi, {
    imo: s.imo,
    name: s.name,
    callsign: null,
    shipType: 60, // passenger ship; real static data refines this
    destination: null,
  });
}

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

// --- Diagnostics (surfaced via GET /api/ships/debug) -----------------------
// Enough signal to tell apart the failure modes: no key, can't connect/auth,
// connected-but-silent, live-but-out-of-range, or actually working.
let connectAttempts = 0;
let lastConnectAt = 0;
let lastError: string | null = null;
let totalMessages = 0;
let positionReports = 0;
let staticReports = 0;
let lastMessageAt = 0;

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
    positionReports++;
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
    staticReports++;
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
    connectAttempts++;
    lastConnectAt = Date.now();
    ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    ws.on('open', () => {
      ws?.send(
        JSON.stringify({
          APIKey: config.aisstreamApiKey,
          // Whole-world box is mandatory; FiltersShipMMSI then narrows the feed
          // to just the tracked fleet, so we get those ships wherever they are
          // the instant any receiver sees them instead of the global firehose.
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FiltersShipMMSI: FLEET_MMSIS,
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        })
      );
      console.log('AIS stream connected');
    });

    ws.on('message', (data: WebSocket.RawData) => {
      totalMessages++;
      lastMessageAt = Date.now();
      handleMessage(data.toString());
    });

    ws.on('close', () => {
      ws = null;
      reconnectTimer = setTimeout(connectAIS, 5_000);
    });

    ws.on('error', (err) => {
      lastError = err.message;
      console.error('AIS WebSocket error:', err.message);
      ws?.terminate();
    });
  } catch (err) {
    lastError = String(err);
    reconnectTimer = setTimeout(connectAIS, 5_000);
    console.error('AIS connect failed:', err);
  }
}

// --- Paid by-IMO position polling ------------------------------------------
// Free aisstream can't always see the fleet. When a paid provider key is set we
// poll the fleet's positions by IMO and write them into the same `tracked` map
// the client renders as pins — so the ships reliably show up regardless of
// community-receiver coverage. Free aisstream stays on as a live supplement;
// whichever source reported most recently wins in the response dedupe.
// Poll cadence — tunable via SHIPS_POLL_MINUTES; defaults cheap since cruise
// ships move slowly and last-known is fine. On VesselFinder (1 credit/ship/poll)
// the fleet runs ~ ships × polls/month credits: 120 min ≈ 2,500 credits/month
// for 7 ships (~€85 on the €330/10k pack); raise the interval to spend less.
const PAID_POLL_MS = Math.max(15, Number(process.env.SHIPS_POLL_MINUTES) || 120) * 60_000;

interface PaidPosition {
  imo: number | null;
  mmsi: string | null;
  lat: number | null;
  lon: number | null;
  speedKt: number | null;
  courseDeg: number | null;
  headingDeg: number | null;
  navStatus: number | null;
  destination: string | null;
  name: string | null;
  t: number; // fix time (ms)
}

let paidProvider: string | null = null;
let paidLastOk = 0;
let paidLastError: string | null = null;
let paidLastCount = 0;

function pnum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickField<T = unknown>(o: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const k of keys) if (o[k] != null) return o[k] as T;
  return undefined;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'gsoc-monitor/1.0', Accept: 'application/json', ...(headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// VesselFinder Vessels API — one request returns all fleet IMOs; each row has an
// AIS object with the position/voyage fields (confirmed schema).
async function fetchVesselFinder(key: string): Promise<PaidPosition[]> {
  const imos = FLEET.map((s) => s.imo).join(',');
  const data = await fetchJson(
    `https://api.vesselfinder.com/vessels?userkey=${encodeURIComponent(key)}&imo=${imos}`
  );
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const ais = (r.AIS ?? r.ais ?? r) as Record<string, unknown>;
    const ts = pickField<string>(ais, 'TIMESTAMP', 'timestamp');
    const t = ts ? Date.parse(ts) : NaN;
    return {
      imo: pnum(pickField(ais, 'IMO', 'imo')),
      mmsi: ((): string | null => {
        const m = pickField(ais, 'MMSI', 'mmsi');
        return m != null ? String(m) : null;
      })(),
      lat: pnum(pickField(ais, 'LATITUDE', 'latitude', 'lat')),
      lon: pnum(pickField(ais, 'LONGITUDE', 'longitude', 'lon', 'lng')),
      speedKt: pnum(pickField(ais, 'SPEED', 'speed')),
      courseDeg: pnum(pickField(ais, 'COURSE', 'course')),
      headingDeg: pnum(pickField(ais, 'HEADING', 'heading')),
      navStatus: pnum(pickField(ais, 'NAVSTAT', 'navstat')),
      destination: (pickField<string>(ais, 'DESTINATION', 'destination') ?? null) || null,
      name: (pickField<string>(ais, 'NAME', 'name') ?? null) || null,
      t: Number.isNaN(t) ? Date.now() : t,
    };
  });
}

// MyShipTracking bulk endpoint — comma-separated IMOs in one request; response
// is a { data: [...] } envelope. Field names parsed defensively.
async function fetchMyShipTracking(key: string): Promise<PaidPosition[]> {
  const imos = FLEET.map((s) => s.imo).join(',');
  const data = (await fetchJson(
    `https://api.myshiptracking.com/api/v2/vessel/bulk?imo=${imos}&response=simple`,
    { Authorization: `Bearer ${key}` }
  )) as { data?: unknown };
  const rows = Array.isArray(data?.data) ? (data.data as Record<string, unknown>[]) : [];
  return rows.map((v) => {
    const ts = pickField<string | number>(v, 'received', 'timestamp', 'last_position_time', 'time');
    const t = typeof ts === 'number' ? ts * (ts < 1e12 ? 1000 : 1) : ts ? Date.parse(String(ts)) : NaN;
    return {
      imo: pnum(pickField(v, 'imo', 'IMO')),
      mmsi: ((): string | null => {
        const m = pickField(v, 'mmsi', 'MMSI');
        return m != null ? String(m) : null;
      })(),
      lat: pnum(pickField(v, 'lat', 'latitude', 'LAT')),
      lon: pnum(pickField(v, 'lng', 'lon', 'longitude', 'LON')),
      speedKt: pnum(pickField(v, 'speed', 'sog', 'SPEED')),
      courseDeg: pnum(pickField(v, 'course', 'cog', 'COURSE')),
      headingDeg: pnum(pickField(v, 'heading', 'true_heading', 'HEADING')),
      navStatus: pnum(pickField(v, 'nav_status', 'navstat', 'status')),
      destination: (pickField<string>(v, 'destination', 'dest') ?? null) || null,
      name: (pickField<string>(v, 'name', 'vessel_name', 'shipname') ?? null) || null,
      t: Number.isNaN(t) ? Date.now() : t,
    };
  });
}

function applyPaidPosition(r: PaidPosition) {
  if (r.lat == null || r.lon == null || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return;
  const ship =
    (r.imo != null ? FLEET.find((s) => s.imo === r.imo) : undefined) ??
    (r.mmsi ? FLEET.find((s) => s.mmsi === r.mmsi) : undefined);
  const mmsi = ship?.mmsi ?? r.mmsi ?? (r.imo != null ? `imo-${r.imo}` : null);
  if (!mmsi) return;
  const now = Number.isFinite(r.t) ? r.t : Date.now();
  const existing = tracked.get(mmsi);
  const record: VesselData = {
    mmsi,
    imo: ship?.imo ?? r.imo ?? existing?.imo ?? null,
    name: ship?.name ?? r.name ?? existing?.name ?? null,
    callsign: existing?.callsign ?? null,
    shipType: existing?.shipType ?? 60,
    latitude: r.lat,
    longitude: r.lon,
    speedKt: r.speedKt ?? existing?.speedKt ?? null,
    heading: r.headingDeg != null && r.headingDeg !== 511 ? r.headingDeg : existing?.heading ?? null,
    course: r.courseDeg != null && r.courseDeg < 360 ? r.courseDeg : existing?.course ?? null,
    navStatus: r.navStatus ?? existing?.navStatus ?? null,
    destination: r.destination ?? existing?.destination ?? null,
    updatedAt: now,
  };
  allowedMmsis.add(mmsi);
  tracked.set(mmsi, record);
  recordHistory(mmsi, r.lat, r.lon, now);
}

async function pollPaidPositions() {
  try {
    let rows: PaidPosition[];
    if (config.vesselfinderApiKey) {
      paidProvider = 'vesselfinder';
      rows = await fetchVesselFinder(config.vesselfinderApiKey);
    } else if (config.myshiptrackingApiKey) {
      paidProvider = 'myshiptracking';
      rows = await fetchMyShipTracking(config.myshiptrackingApiKey);
    } else {
      return;
    }
    let applied = 0;
    for (const r of rows) {
      if (r.lat != null && r.lon != null) {
        applyPaidPosition(r);
        applied++;
      }
    }
    paidLastOk = Date.now();
    paidLastError = null;
    paidLastCount = applied;
  } catch (err) {
    paidLastError = String(err);
    console.error('[ships] paid poll failed:', err);
  }
}

function paidConfigured(): boolean {
  return Boolean(config.vesselfinderApiKey || config.myshiptrackingApiKey);
}

export function initShipsStream() {
  // Free AIS stream — live updates when a ship is in community-receiver range.
  if (config.aisstreamApiKey) {
    connectAIS();
    setInterval(evictStale, 5 * 60_000);
  }
  // Paid by-IMO polling — reliable pins regardless of coverage.
  if (paidConfigured()) {
    pollPaidPositions();
    setInterval(pollPaidPositions, PAID_POLL_MS);
  }
}

router.get('/', (_req, res) => {
  if (!config.aisstreamApiKey && !paidConfigured()) {
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
    streaming: lastMessageAt > 0 && now - lastMessageAt < 60_000,
    messages: totalMessages,
    matched: allowedMmsis.size,
    total: ALLOWED_IMOS.size,
  });
});

function wsStateName(): string {
  if (!ws) return 'closed';
  switch (ws.readyState) {
    case WebSocket.CONNECTING:
      return 'connecting';
    case WebSocket.OPEN:
      return 'open';
    case WebSocket.CLOSING:
      return 'closing';
    default:
      return 'closed';
  }
}

// Per-IMO snapshot of the allowlist: which of the tracked ships we've actually
// correlated to a live MMSI, and where/when we last saw them.
function trackedByImo() {
  const now = Date.now();
  const byImo = new Map<number, VesselData>();
  for (const v of tracked.values()) {
    if (v.imo == null) continue;
    const prev = byImo.get(v.imo);
    if (!prev || v.updatedAt > prev.updatedAt) byImo.set(v.imo, v);
  }
  return [...ALLOWED_IMOS].map((imo) => {
    const v = byImo.get(imo);
    return {
      imo,
      matched: !!v,
      mmsi: v?.mmsi ?? null,
      name: v?.name ?? null,
      lat: v?.latitude ?? null,
      lon: v?.longitude ?? null,
      lastSeenSec: v ? Math.round((now - v.updatedAt) / 1000) : null,
    };
  });
}

// Plain-language read of the current state so the failure mode is obvious at a
// glance from a browser.
function diagnose(perImo: ReturnType<typeof trackedByImo>): string {
  if (!config.aisstreamApiKey) return 'No AISSTREAM_API_KEY is set in this environment — that is why nothing shows.';
  const state = wsStateName();
  if (state !== 'open')
    return `WebSocket is "${state}" (last error: ${lastError ?? 'none'}). Likely an invalid/expired key or blocked outbound WebSocket.`;
  if (totalMessages === 0)
    return `Connected and subscribed to the ${ALLOWED_IMOS.size}-ship fleet, but no messages yet — most likely none of them are in a receiver's range right now (they pin to last-known once seen). Only suspect the key if this persists for many hours.`;
  const matched = perImo.filter((p) => p.matched).length;
  if (matched === 0)
    return `Stream is live (${totalMessages.toLocaleString()} msgs) but none of the ${ALLOWED_IMOS.size} tracked ships have appeared — a terrestrial-coverage gap. They pin to last-known the moment one is seen.`;
  return `Working: ${matched} of ${ALLOWED_IMOS.size} tracked ships seen.`;
}

// GET /api/ships/debug — connection, stream-volume and per-ship match state.
router.get('/debug', (_req, res) => {
  const now = Date.now();
  const perImo = trackedByImo();
  res.json({
    keyConfigured: Boolean(config.aisstreamApiKey),
    ws: {
      state: wsStateName(),
      connectAttempts,
      lastConnectAt: lastConnectAt || null,
      lastError,
      lastMessageAt: lastMessageAt || null,
      secSinceLastMessage: lastMessageAt ? Math.round((now - lastMessageAt) / 1000) : null,
      streaming: lastMessageAt > 0 && now - lastMessageAt < 60_000,
    },
    stream: {
      totalMessages,
      positionReports,
      staticReports,
      distinctVesselsInMemory: vessels.size,
    },
    paid: {
      configured: paidConfigured(),
      provider: paidProvider,
      lastOkAt: paidLastOk || null,
      lastCount: paidLastCount,
      lastError: paidLastError,
    },
    allowlist: {
      imoCount: ALLOWED_IMOS.size,
      matchedMmsis: [...allowedMmsis],
      ships: perImo,
    },
    diagnosis: diagnose(perImo),
    updated: now,
  });
});

export default router;
