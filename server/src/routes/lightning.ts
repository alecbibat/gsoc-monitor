import { Router } from 'express';
import WebSocket from 'ws';
import { promises as fsp } from 'fs';
import path from 'path';

const router = Router();

// Blitzortung's community lightning network publishes real-time strikes over a
// set of public WebSocket relays (no API key). The browser keeps only a short
// live window, so to answer "show me the last 1/6/12/24h" we run a persistent
// collector here — exactly like the AIS ships stream — accumulating strikes into
// a memory-bounded rolling buffer the client can query by time window.
const RELAYS = ['wss://ws1.blitzortung.org/', 'wss://ws7.blitzortung.org/', 'wss://ws8.blitzortung.org/'];

// LZW-style decompressor matching Blitzortung's wire format (same scheme the
// public lightningmaps.org client uses). Decode, then JSON.parse to get a strike.
function inflate(input: string): string {
  const dict: Record<number, string> = {};
  const data = input.split('');
  let current = data[0];
  let oldPhrase = current;
  const out: string[] = [current];
  let code = 256;
  const baseCode = 256;
  for (let i = 1; i < data.length; i++) {
    const charCode = data[i].charCodeAt(0);
    let phrase: string;
    if (baseCode > charCode) {
      phrase = data[i];
    } else {
      phrase = dict[charCode] ? dict[charCode] : oldPhrase + current;
    }
    out.push(phrase);
    current = phrase.charAt(0);
    dict[code] = oldPhrase + current;
    code++;
    oldPhrase = phrase;
  }
  return out.join('');
}

// --- Rolling strike buffer ---------------------------------------------------
// Parallel typed arrays in a ring buffer: compact and allocation-free on the hot
// path. Strikes are pushed in arrival (time) order, so the logical oldest→newest
// order is contiguous in time and a query can walk backward from the newest and
// stop at the window cutoff.
//
// Sizing (this is what fixes "24h only ever covers ~2.8h"): the *global*
// Blitzortung stream runs ~100 strikes/sec, so a 1M-slot ring filled in ~2.8h
// and then overwrote everything older — the 24h window could never be reached,
// and the disk snapshot could only ever persist the ~2.8h the buffer physically
// held. Two changes give a true 24h span within a bounded memory budget:
//   1. This buffer only ever feeds the *historical* point cloud, which is
//      thinned to ≤ MAX_RESPONSE points for display regardless of window (the
//      live browser layer draws the freshest 10 min at full fidelity itself).
//      So we can decimate on ingest — keep 1 of every KEEP_EVERY strikes — with
//      no visible loss: even the 1h window still holds far more than the display
//      cap. This stretches the same slots to cover ~6× longer.
//   2. Enlarge the ring so 24h fits with headroom.
// At CAP=3M / KEEP_EVERY=6 the buffer spans 24h for sustained raw rates up to
// ~200 strikes/sec, using ~48 MB (Float32 lat+lon + Float64 ms time).
const CAP = 3_000_000; // hard cap; older strikes are overwritten once full
const KEEP_EVERY = 6; // store 1 of every N received strikes (uniform, spatially unbiased)
const latBuf = new Float32Array(CAP);
const lonBuf = new Float32Array(CAP);
const tBuf = new Float64Array(CAP); // epoch ms (needs f64 precision)
let head = 0; // next write index
let count = 0; // number of filled slots (≤ CAP)
let ingestSeq = 0; // counts received strikes for decimation

function push(lat: number, lon: number, t: number): void {
  latBuf[head] = lat;
  lonBuf[head] = lon;
  tBuf[head] = t;
  head = (head + 1) % CAP;
  if (count < CAP) count++;
}

// --- Disk persistence (survive restarts/deploys) ----------------------------
// The ring buffer is RAM-only, so a restart would otherwise wipe the 24h
// history and force it to rebuild live over the next day. We periodically dump
// the last ~24h of strikes to disk (mirrors the ships snapshot) and reload them
// on boot — BEFORE connecting, so reloaded (older) strikes precede live ones and
// the buffer stays time-ordered for the query walk. On an ephemeral dyno the
// file survives the dyno's life but is wiped on a fresh deploy; the periodic
// save + live stream cover the gap. Snapshot is columnar JSON (~14 MB at cap).
const SNAPSHOT_PATH =
  process.env.LIGHTNING_SNAPSHOT_PATH ?? path.join(__dirname, '../../lightning-snapshot.json');
const PERSIST_WINDOW_MS = 24 * 60 * 60_000;
const MAX_PERSIST = 600_000; // bound the file; stride-thin the window if larger
let savingSnapshot = false;

async function saveSnapshot(): Promise<void> {
  if (savingSnapshot || count === 0) return;
  savingSnapshot = true;
  try {
    const now = Date.now();
    const cutoff = now - PERSIST_WINDOW_MS;
    const newest = (head - 1 + CAP) % CAP;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (tBuf[(newest - i + CAP) % CAP] < cutoff) break;
      total++;
    }
    const stride = Math.max(1, Math.ceil(total / MAX_PERSIST));
    const lat: number[] = [];
    const lon: number[] = [];
    const t: number[] = [];
    for (let i = 0, k = 0; i < count; i++) {
      const idx = (newest - i + CAP) % CAP;
      const tv = tBuf[idx];
      if (tv < cutoff) break;
      if (k % stride === 0) {
        lat.push(Math.round(latBuf[idx] * 1000) / 1000);
        lon.push(Math.round(lonBuf[idx] * 1000) / 1000);
        t.push(Math.round(tv / 1000)); // epoch seconds
      }
      k++;
    }
    // Collected newest→oldest; store chronological so reload preserves order.
    lat.reverse();
    lon.reverse();
    t.reverse();
    await fsp.writeFile(SNAPSHOT_PATH, JSON.stringify({ lat, lon, t, savedAt: now }));
  } catch (err) {
    console.error('[lightning] snapshot save failed:', err instanceof Error ? err.message : err);
  } finally {
    savingSnapshot = false;
  }
}

async function loadSnapshot(): Promise<void> {
  try {
    const raw = await fsp.readFile(SNAPSHOT_PATH, 'utf8');
    const snap = JSON.parse(raw) as { lat?: number[]; lon?: number[]; t?: number[] };
    const lat = snap.lat ?? [];
    const lon = snap.lon ?? [];
    const t = snap.t ?? [];
    const n = Math.min(lat.length, lon.length, t.length);
    const cutoff = Date.now() - PERSIST_WINDOW_MS;
    let loaded = 0;
    for (let i = 0; i < n; i++) {
      const tms = t[i] * 1000; // seconds → ms
      if (tms < cutoff) continue; // drop strikes now older than the window
      push(lat[i], lon[i], tms);
      loaded++;
    }
    if (loaded > 0) console.log(`[lightning] restored ${loaded} strikes from snapshot`);
  } catch {
    // No snapshot yet — normal on first boot.
  }
}

// --- Connection --------------------------------------------------------------
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relayIndex = 0;
let connected = false;
let totalStrikes = 0;
let lastStrikeAt = 0;

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3_000);
}

function connect(): void {
  const url = RELAYS[relayIndex % RELAYS.length];
  relayIndex++;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.on('open', () => {
    connected = true;
    // Subscribe to the global strike stream.
    socket.send(JSON.stringify({ a: 111 }));
    console.log(`[lightning] connected to ${url}`);
  });

  socket.on('message', (data: WebSocket.RawData) => {
    const raw = data.toString();
    let strike: { lat?: number; lon?: number } | null = null;
    try {
      strike = JSON.parse(inflate(raw));
    } catch {
      try {
        strike = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!strike || typeof strike.lat !== 'number' || typeof strike.lon !== 'number') return;
    if (strike.lat < -90 || strike.lat > 90 || strike.lon < -180 || strike.lon > 180) return;
    totalStrikes++;
    lastStrikeAt = Date.now();
    // Decimate: store 1 of every KEEP_EVERY strikes so the fixed buffer spans a
    // full 24h. Strikes arrive globally interleaved, so every-Nth is an unbiased
    // sample; the historical view is display-thinned anyway (see MAX_RESPONSE).
    if (ingestSeq++ % KEEP_EVERY !== 0) return;
    push(strike.lat, strike.lon, Date.now());
  });

  socket.on('close', () => {
    connected = false;
    ws = null;
    scheduleReconnect();
  });

  socket.on('error', () => {
    connected = false;
    try {
      socket.terminate();
    } catch {
      /* already gone */
    }
  });
}

export function initLightningStream(): void {
  // Restore the persisted 24h buffer first (so reloaded strikes precede live
  // ones and the buffer stays time-ordered), then connect the live stream.
  loadSnapshot()
    .catch(() => {})
    .finally(() => connect());
  setInterval(() => void saveSnapshot(), 5 * 60_000);
  process.once('SIGTERM', () => void saveSnapshot());
}

// --- Query route -------------------------------------------------------------
// GET /api/lightning?minutes=60  → strikes within the last `minutes`, as compact
// parallel arrays. The response is capped at MAX_RESPONSE points; if the window
// holds more, it's uniformly strided (thinned) so the payload and the client's
// point cloud stay bounded regardless of storm intensity.
const MAX_RESPONSE = 20_000;

router.get('/', (req, res) => {
  const minutes = Math.min(1440, Math.max(1, Math.round(Number(req.query.minutes)) || 60));
  const now = Date.now();
  const cutoff = now - minutes * 60_000;

  if (count === 0) {
    res.json({
      lat: [],
      lon: [],
      t: [],
      windowMin: minutes,
      totalInWindow: 0,
      returned: 0,
      thinned: false,
      coverageMin: 0,
      connected,
      updated: Math.round(now / 1000),
    });
    return;
  }

  const newest = (head - 1 + CAP) % CAP;
  const oldestIdx = (head - count + CAP) % CAP;
  const coverageMin = Math.min(minutes, Math.round((now - tBuf[oldestIdx]) / 60_000));

  // Pass 1: how many strikes fall inside the window (walk newest → oldest,
  // stopping at the first one older than the cutoff — the buffer is time-ordered).
  let totalInWindow = 0;
  for (let i = 0; i < count; i++) {
    const idx = (newest - i + CAP) % CAP;
    if (tBuf[idx] < cutoff) break;
    totalInWindow++;
  }

  // Pass 2: emit every `stride`-th strike so the result is ≤ MAX_RESPONSE while
  // staying spread evenly across the whole window.
  const stride = Math.max(1, Math.ceil(totalInWindow / MAX_RESPONSE));
  const lat: number[] = [];
  const lon: number[] = [];
  const t: number[] = [];
  for (let i = 0, k = 0; i < count; i++) {
    const idx = (newest - i + CAP) % CAP;
    const tv = tBuf[idx];
    if (tv < cutoff) break;
    if (k % stride === 0) {
      lat.push(Math.round(latBuf[idx] * 1000) / 1000);
      lon.push(Math.round(lonBuf[idx] * 1000) / 1000);
      t.push(Math.round(tv / 1000)); // epoch seconds (smaller payload)
    }
    k++;
  }
  // Collected newest → oldest; hand back oldest → newest.
  lat.reverse();
  lon.reverse();
  t.reverse();

  res.json({
    lat,
    lon,
    t,
    windowMin: minutes,
    totalInWindow,
    returned: lat.length,
    thinned: stride > 1,
    coverageMin,
    connected,
    updated: Math.round(now / 1000),
  });
});

// GET /api/lightning/debug — collector health at a glance.
router.get('/debug', (_req, res) => {
  const now = Date.now();
  const oldestIdx = count > 0 ? (head - count + CAP) % CAP : -1;
  const coverageMin = oldestIdx >= 0 ? Math.round((now - tBuf[oldestIdx]) / 60_000) : 0;
  res.json({
    connected,
    relay: RELAYS[(relayIndex - 1 + RELAYS.length) % RELAYS.length],
    bufferCount: count,
    bufferCap: CAP,
    keepEvery: KEEP_EVERY,
    coverageMin, // how far back the buffer reaches — should climb toward 1440 (24h)
    coverageHours: Math.round((coverageMin / 60) * 10) / 10,
    totalStrikes, // received (before decimation)
    secSinceLastStrike: lastStrikeAt ? Math.round((now - lastStrikeAt) / 1000) : null,
    updated: now,
  });
});

export default router;
