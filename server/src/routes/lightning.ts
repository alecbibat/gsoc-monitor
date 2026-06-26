import { Router } from 'express';
import WebSocket from 'ws';

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
// Parallel typed arrays in a ring buffer: compact (~16 MB total at this cap) and
// allocation-free on the hot path. Strikes are pushed in arrival (time) order,
// so the logical oldest→newest order is contiguous in time and a query can walk
// backward from the newest and stop at the window cutoff.
const CAP = 1_000_000; // hard cap; older strikes are overwritten once full
const latBuf = new Float32Array(CAP);
const lonBuf = new Float32Array(CAP);
const tBuf = new Float64Array(CAP); // epoch ms (needs f64 precision)
let head = 0; // next write index
let count = 0; // number of filled slots (≤ CAP)

function push(lat: number, lon: number, t: number): void {
  latBuf[head] = lat;
  lonBuf[head] = lon;
  tBuf[head] = t;
  head = (head + 1) % CAP;
  if (count < CAP) count++;
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
    push(strike.lat, strike.lon, Date.now());
    totalStrikes++;
    lastStrikeAt = Date.now();
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
  connect();
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
  res.json({
    connected,
    relay: RELAYS[(relayIndex - 1 + RELAYS.length) % RELAYS.length],
    bufferCount: count,
    bufferCap: CAP,
    totalStrikes,
    secSinceLastStrike: lastStrikeAt ? Math.round((now - lastStrikeAt) / 1000) : null,
    updated: now,
  });
});

export default router;
