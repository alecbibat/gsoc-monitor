import { Router } from 'express';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
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

// aisstream subscription mode. The firehose streams every ship aisstream sees
// worldwide — useful once as a diagnostic (it proved none of the fleet are in
// the community receiver network: 150k+ messages, 0 fleet matches), but that's
// ~5 GB/day of inbound data for zero benefit now that CruiseMapper is the
// reliable position source. So we default to the narrow FiltersShipMMSI: it
// sips almost no data and still delivers a live update the moment one of the
// fleet sails into a receiver's range, supplementing the 2-hourly scrape. Set
// AIS_MMSI_FILTER=0 to fall back to the firehose (e.g. if scraping ever breaks).
const USE_MMSI_FILTER = process.env.AIS_MMSI_FILTER !== '0';

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
  etaUtc: number | null;    // parsed ETA, epoch ms UTC
  etaText: string | null;   // provider's raw ETA string (kept when unparseable)
  updatedAt: number;
}

// Side-cache for static data that may arrive before a position report.
interface StaticInfo {
  imo: number | null;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  destination: string | null;
  etaUtc: number | null;
  etaText: string | null;
}

// --- ETA parsing -------------------------------------------------------------
// AIS ETAs carry no year (month/day/hour/minute, UTC), so infer the year that
// puts the date closest to now — "Jan 2" reported on Dec 28 lands next year.
// Month/Day 0 and Hour 24 / Minute 60 are AIS "not available" sentinels.
export function etaFromAisFields(
  month: unknown,
  day: unknown,
  hour: unknown,
  minute: unknown
): number | null {
  const M = typeof month === 'number' ? month : 0;
  const D = typeof day === 'number' ? day : 0;
  if (M < 1 || M > 12 || D < 1 || D > 31) return null;
  const H = typeof hour === 'number' && hour < 24 ? hour : 0;
  const Min = typeof minute === 'number' && minute < 60 ? minute : 0;
  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  let best: number | null = null;
  for (const y of [year - 1, year, year + 1]) {
    const t = Date.UTC(y, M - 1, D, H, Min);
    if (best === null || Math.abs(t - now) < Math.abs(best - now)) best = t;
  }
  return best;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Best-effort parse of the ETA strings the position providers hand back
// ("07-22 06:00", "Jul 22, 06:00", "22 Jul 06:00", ISO datetimes). All are
// treated as UTC per AIS convention. Returns epoch ms or null.
export function parseEtaText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO-ish "2026-07-22 06:00" / "2026-07-22T06:00[:00Z]"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);

  // VesselFinder-style "MM-DD HH:MM" (no year)
  m = s.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (m) return etaFromAisFields(+m[1], +m[2], +m[3], +m[4]);

  // "Jul 22, 06:00" / "Jul 22 06:00"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return etaFromAisFields(mo, +m[2], +m[3], +m[4]);
  }

  // "22 Jul, 06:00" / "22 Jul 06:00"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return etaFromAisFields(mo, +m[1], +m[3], +m[4]);
  }

  return null;
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
    etaUtc: null,
    etaText: null,
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

// --- Position snapshot (last-known persistence) -----------------------------
// Written to disk after every successful poll so the fleet stays on the map
// across server restarts and Heroku deploys. The snapshot file lives at
// SHIPS_SNAPSHOT_PATH (default: <server root>/ships-snapshot.json) — on Heroku
// this persists within a dyno's lifetime but is wiped on a fresh deploy. That's
// fine: CruiseMapper scrapes at startup anyway, so ships reappear within ~15 s.
const SNAPSHOT_PATH =
  process.env.SHIPS_SNAPSHOT_PATH ??
  path.join(__dirname, '../../ships-snapshot.json');

interface Snapshot {
  tracked: VesselData[];
  history: { mmsi: string; pts: TrackPoint[] }[];
  savedAt: number;
}

// How many ships were restored from disk at startup, and how old that snapshot
// was — surfaced in /api/ships/debug so a restart's recovery is visible.
let snapshotLoadedCount = 0;
let snapshotLoadedAgeMin: number | null = null;

function saveSnapshot(): void {
  try {
    const snap: Snapshot = {
      tracked: [...tracked.values()],
      history: [...history.entries()].map(([mmsi, pts]) => ({ mmsi, pts })),
      savedAt: Date.now(),
    };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap));
  } catch {
    // Non-fatal — the app works fine without it.
  }
}

function loadSnapshot(): void {
  try {
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const snap = JSON.parse(raw) as Snapshot;
    const ageMs = Date.now() - (snap.savedAt ?? 0);
    // Ignore snapshots older than 7 days — stale positions are misleading.
    if (ageMs > 7 * 24 * 60 * 60_000) return;
    for (const v of snap.tracked ?? []) {
      if (v.mmsi && FLEET_MMSIS.includes(v.mmsi)) {
        // Snapshots written before the ETA fields existed lack them.
        tracked.set(v.mmsi, { ...v, etaUtc: v.etaUtc ?? null, etaText: v.etaText ?? null });
        allowedMmsis.add(v.mmsi);
      }
    }
    for (const { mmsi, pts } of snap.history ?? []) {
      if (pts.length > 0 && FLEET_MMSIS.includes(mmsi)) history.set(mmsi, pts);
    }
    snapshotLoadedCount = [...tracked.keys()].length;
    snapshotLoadedAgeMin = Math.round(ageMs / 60_000);
    if (snapshotLoadedCount > 0)
      console.log(`[ships] loaded ${snapshotLoadedCount} ships from snapshot (${snapshotLoadedAgeMin} min old)`);
  } catch {
    // No snapshot yet — start fresh.
  }
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
      etaUtc: sd?.etaUtc ?? existing?.etaUtc ?? null,
      etaText: sd?.etaText ?? existing?.etaText ?? null,
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
    const eta = sd.Eta ?? {};
    const info: StaticInfo = {
      imo,
      name: (sd.Name as string | undefined)?.trim() || null,
      callsign: (sd.CallSign as string | undefined)?.trim() || null,
      shipType: typeof sd.Type === 'number' ? sd.Type : null,
      destination: (sd.Destination as string | undefined)?.trim() || null,
      etaUtc: etaFromAisFields(eta.Month, eta.Day, eta.Hour, eta.Minute),
      etaText: null,
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
        etaUtc: info.etaUtc ?? existing.etaUtc,
        etaText: info.etaText ?? existing.etaText,
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
      // Whole-world box is mandatory. By default we narrow to the fleet MMSIs
      // (lightweight, live supplement); AIS_MMSI_FILTER=0 takes the firehose.
      const sub: Record<string, unknown> = {
        APIKey: config.aisstreamApiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      };
      if (USE_MMSI_FILTER) sub.FiltersShipMMSI = FLEET_MMSIS;
      ws?.send(JSON.stringify(sub));
      console.log(`AIS stream connected (${USE_MMSI_FILTER ? 'MMSI filter' : 'firehose'})`);
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
  etaText: string | null; // provider ETA string, parsed downstream
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
      etaText: (pickField<string>(ais, 'ETA_PREDICTED', 'ETA', 'eta') ?? null) || null,
      name: (pickField<string>(ais, 'NAME', 'name') ?? null) || null,
      t: Number.isNaN(t) ? Date.now() : t,
    };
  });
}

// --- CruiseMapper free scrape ----------------------------------------------
// CruiseMapper's public ship page (reachable by IMO at /?imo=NNN) renders the
// vessel's last AIS fix into the HTML, and crucially it carries satellite-AIS
// coverage — it sees the fleet at sea where free aisstream cannot. The catch is
// Cloudflare bot protection: a plain fetch may be served a 403 challenge instead
// of the page. We send a full, consistent set of browser headers to pass the
// lighter checks; if we're still blocked, lastScrapeNote records the status so
// /api/ships/debug shows exactly what happened on the live server.
let lastScrapeNote: string | null = null;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
    headers: { ...BROWSER_HEADERS, ...(headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Pull a last-known position out of one CruiseMapper ship page. The page format
// isn't contractual, so we try several strategies and accept the first that
// yields a coordinate pair in range. Returns null (not throw) on a page with no
// parseable position so one ship's miss doesn't abort the batch.
function parseCruiseMapper(html: string, ship: FleetShip): PaidPosition | null {
  let lat: number | null = null;
  let lon: number | null = null;

  // 1) Decimal coords assigned to lat/lng-like keys in inline JS or JSON
  //    (e.g. the Leaflet/Google marker init: "lat":-15.877,"lng":-149.56).
  const keyed = (names: string[]): number | null => {
    for (const n of names) {
      const m = html.match(
        new RegExp(`["']?${n}["']?\\s*[:=]\\s*["']?(-?\\d{1,3}\\.\\d{3,})`, 'i')
      );
      if (m) return Number(m[1]);
    }
    return null;
  };
  lat = keyed(['nlat', 'latitude', 'shipLat', 'lat']);
  lon = keyed(['nlng', 'nlon', 'longitude', 'shipLng', 'shipLon', 'lng', 'lon']);

  // 2) data-* attributes on the map container.
  if (lat === null) {
    const m = html.match(/data-lat(?:itude)?=["'](-?\d{1,2}\.\d+)["']/i);
    if (m) lat = Number(m[1]);
  }
  if (lon === null) {
    const m = html.match(/data-l(?:ng|on|ongitude)=["'](-?\d{1,3}\.\d+)["']/i);
    if (m) lon = Number(m[1]);
  }

  // 3) Visible hemisphere format "15.877 S / 149.560 W".
  if (lat === null || lon === null) {
    const m = html.match(
      /(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\s*[/,]?\s*(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])/i
    );
    if (m) {
      lat = Number(m[1]) * (m[2].toUpperCase() === 'S' ? -1 : 1);
      lon = Number(m[3]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
    }
  }

  if (
    lat === null ||
    lon === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    (lat === 0 && lon === 0)
  ) {
    return null;
  }

  const num = (re: RegExp): number | null => {
    const m = html.match(re);
    return m ? Number(m[1]) : null;
  };
  const speedKt = num(/([\d.]+)\s*(?:kn|knots|kts)\b/i);
  const courseDeg = num(/course[^0-9-]{0,24}(\d{1,3}(?:\.\d+)?)\s*°/i);
  const destM = html.match(/(?:en route to|next port|destination)[:\s]+([A-Za-z][A-Za-z .,'()-]{1,38})/i);
  // ETA appears in a few shapes ("ETA: Jul 22, 06:00", "arrival ... 22 Jul, 06:00",
  // or an ISO datetime nearby); grab the first date-like run after the keyword.
  const etaM = html.match(
    /(?:ETA|estimated\s+(?:time\s+of\s+)?arrival|arrival)[^A-Za-z0-9]{0,20}(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{1,2}:\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{1,2}:\d{2})/i
  );

  return {
    imo: ship.imo,
    mmsi: ship.mmsi,
    lat,
    lon,
    speedKt,
    courseDeg,
    headingDeg: null,
    navStatus: null,
    destination: destM ? destM[1].trim() : null,
    etaText: etaM ? etaM[1].trim() : null,
    name: ship.name,
    t: Date.now(),
  };
}

async function fetchCruiseMapper(): Promise<PaidPosition[]> {
  const out: PaidPosition[] = [];
  let blocked = 0;
  let parsed = 0;
  let lastErr = '';
  for (const ship of FLEET) {
    try {
      const html = await fetchText(`https://www.cruisemapper.com/?imo=${ship.imo}`, {
        Referer: 'https://www.cruisemapper.com/',
      });
      const pos = parseCruiseMapper(html, ship);
      if (pos) {
        out.push(pos);
        parsed++;
      }
    } catch (err) {
      lastErr = String(err);
      if (lastErr.includes('403') || lastErr.includes('503')) blocked++;
    }
    await sleep(1_200 + Math.random() * 800); // gentle, less bot-like pacing
  }
  lastScrapeNote =
    blocked > 0
      ? `${blocked}/${FLEET.length} requests blocked (Cloudflare ${lastErr || '403/503'}); ${parsed} parsed`
      : `${parsed}/${FLEET.length} ships parsed${lastErr ? ` (last error: ${lastErr})` : ''}`;
  return out;
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
      etaText: ((): string | null => {
        const e = pickField(v, 'eta_UTC', 'eta_utc', 'eta', 'ETA');
        return e != null ? String(e) : null;
      })(),
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
  const etaUtc = parseEtaText(r.etaText);
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
    etaUtc: etaUtc ?? (r.etaText ? null : existing?.etaUtc ?? null),
    etaText: r.etaText ?? existing?.etaText ?? null,
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
    } else if (config.cruisemapperScrape) {
      paidProvider = 'cruisemapper';
      rows = await fetchCruiseMapper();
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
    saveSnapshot();
  } catch (err) {
    paidLastError = String(err);
    console.error('[ships] paid poll failed:', err);
  }
}

function paidConfigured(): boolean {
  return Boolean(
    config.vesselfinderApiKey || config.myshiptrackingApiKey || config.cruisemapperScrape
  );
}

export function initShipsStream() {
  loadSnapshot();
  // Free AIS stream — live updates when a ship is in community-receiver range.
  if (config.aisstreamApiKey) {
    connectAIS();
    setInterval(evictStale, 5 * 60_000);
  }
  // By-IMO polling — reliable pins regardless of aisstream coverage. Uses a paid
  // provider if a key is set, otherwise the free CruiseMapper scrape.
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

function providerLabel(): string {
  switch (paidProvider) {
    case 'cruisemapper':
      return 'CruiseMapper';
    case 'vesselfinder':
      return 'VesselFinder';
    case 'myshiptracking':
      return 'MyShipTracking';
    default:
      return 'the position feed';
  }
}

// Plain-language read of the current state so the situation is obvious at a
// glance from a browser. A by-IMO source (CruiseMapper scrape or a paid key) is
// now the primary way ships reach the map, so lead with whether ships are
// actually shown and from where; aisstream is a live supplement whose silence
// is expected when no fleet ship is in a community receiver's range.
function diagnose(perImo: ReturnType<typeof trackedByImo>): string {
  const total = ALLOWED_IMOS.size;
  const matched = perImo.filter((p) => p.matched).length;
  const aisOpen = wsStateName() === 'open';
  const aisSupp = aisOpen
    ? ' aisstream is connected as a live supplement (silent until a ship enters receiver range).'
    : '';

  // Primary: are ships on the map, and where from?
  if (matched > 0) {
    const head =
      matched === total
        ? `Working: all ${total} ships on the map`
        : `${matched} of ${total} ships on the map`;
    const via = paidProvider ? ` via ${providerLabel()}` : '';
    return `${head}${via}.${aisSupp}`;
  }

  // No ships shown — diagnose the by-IMO source first, then aisstream.
  if (paidConfigured()) {
    const src = providerLabel();
    if (paidLastError) return `No ships yet — ${src} poll failed: ${paidLastError}.`;
    if (lastScrapeNote && /blocked/i.test(lastScrapeNote))
      return `No ships yet — ${src} is being blocked: ${lastScrapeNote}.`;
    if (paidLastOk === 0) return `No ships yet — ${src} has not finished its first poll.`;
    return `No ships yet — ${src} returned no positions${lastScrapeNote ? ` (${lastScrapeNote})` : ''}.`;
  }
  if (!config.aisstreamApiKey) return 'No position source configured (no scrape, no paid key, no AISSTREAM_API_KEY).';
  if (!aisOpen)
    return `aisstream WebSocket is "${wsStateName()}" (last error: ${lastError ?? 'none'}).`;
  return `aisstream connected but none of the ${total} ships are in receiver range yet.`;
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
      scrapeNote: lastScrapeNote,
    },
    allowlist: {
      imoCount: ALLOWED_IMOS.size,
      matchedMmsis: [...allowedMmsis],
      ships: perImo,
    },
    snapshot: {
      path: SNAPSHOT_PATH,
      loadedAtStartup: snapshotLoadedCount,
      ageAtStartupMin: snapshotLoadedAgeMin,
      trackedNow: tracked.size,
    },
    diagnosis: diagnose(perImo),
    updated: now,
  });
});

export default router;
