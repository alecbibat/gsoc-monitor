import { Router } from 'express';
import WebSocket from 'ws';
import zlib from 'zlib';
import { pool } from '../db';

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

// --- Postgres persistence (survive restarts AND deploys) ---------------------
// The ring buffer is RAM-only, and the dyno filesystem is wiped on every deploy
// and daily dyno cycle — a disk snapshot only survived same-dyno restarts. So
// strikes are persisted to Postgres in ~5-minute append-only chunks: each save
// packs only the strikes since the previous save (~30-60 KB gzipped), and rows
// older than the window are pruned. On boot all chunks in the window are loaded
// chronologically BEFORE the live stream connects, so the buffer stays
// time-ordered for the query walk. Losing at most the last save interval on a
// hard kill is fine — the live stream refills minutes of data immediately.
const PERSIST_WINDOW_MS = 24 * 60 * 60_000;
const SAVE_INTERVAL_MS = 5 * 60_000;
const MAX_CHUNK = 300_000; // stride-thin one save after an extended DB outage
let lastSavedT = 0; // newest strike time already persisted (high-water mark)
let savingChunk = false;

// Chunk codec: gzip(Float32 lat[] · Float32 lon[] · Uint32 tSec[]). Exported for
// tests. Uint32 epoch-seconds is plenty — the display buckets by hour.
export function packStrikes(lat: number[], lon: number[], tMs: number[]): Buffer {
  const n = lat.length;
  const la = new Float32Array(n);
  const lo = new Float32Array(n);
  const ts = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    la[i] = lat[i];
    lo[i] = lon[i];
    ts[i] = Math.round(tMs[i] / 1000);
  }
  return zlib.gzipSync(
    Buffer.concat([Buffer.from(la.buffer), Buffer.from(lo.buffer), Buffer.from(ts.buffer)])
  );
}
export function unpackStrikes(data: Buffer, n: number): { lat: Float32Array; lon: Float32Array; tMs: Float64Array } {
  const raw = zlib.gunzipSync(data);
  if (raw.length < n * 12) throw new Error(`chunk too short: ${raw.length} < ${n * 12}`);
  // Copy out of the Buffer pool region before viewing as typed arrays (the
  // underlying ArrayBuffer may be shared and misaligned).
  const own = new Uint8Array(raw).slice().buffer;
  const lat = new Float32Array(own, 0, n);
  const lon = new Float32Array(own, n * 4, n);
  const tSec = new Uint32Array(own, n * 8, n);
  const tMs = new Float64Array(n);
  for (let i = 0; i < n; i++) tMs[i] = tSec[i] * 1000;
  return { lat, lon, tMs };
}

// Persist the strikes received since the last save as one chunk, then prune
// rows that have aged out of the window. DB errors leave lastSavedT untouched,
// so the next attempt simply covers a longer span.
async function saveChunk(): Promise<void> {
  if (savingChunk || count === 0) return;
  savingChunk = true;
  try {
    const newest = (head - 1 + CAP) % CAP;
    // Collect newest→oldest until we reach already-persisted strikes.
    let lat: number[] = [];
    let lon: number[] = [];
    let t: number[] = [];
    for (let i = 0; i < count; i++) {
      const idx = (newest - i + CAP) % CAP;
      if (tBuf[idx] <= lastSavedT) break;
      lat.push(latBuf[idx]);
      lon.push(lonBuf[idx]);
      t.push(tBuf[idx]);
    }
    if (lat.length === 0) return;
    lat.reverse();
    lon.reverse();
    t.reverse();
    // After a long DB outage the pending span can be huge — stride-thin it so a
    // single chunk stays bounded. (Reassign rather than push(...spread): a
    // 300k-element spread blows V8's argument limit and would kill every
    // subsequent save.)
    if (lat.length > MAX_CHUNK) {
      const stride = Math.ceil(lat.length / MAX_CHUNK);
      const keep = (arr: number[]) => arr.filter((_, i) => i % stride === 0);
      lat = keep(lat);
      lon = keep(lon);
      t = keep(t);
    }
    const data = packStrikes(lat, lon, t);
    await pool.query(
      'INSERT INTO lightning_chunks (chunk_start, n, data) VALUES ($1, $2, $3)',
      [Math.round(t[0]), lat.length, data]
    );
    lastSavedT = t[t.length - 1];
    // Prune aged-out chunks (25h so we never trim mid-window).
    await pool.query('DELETE FROM lightning_chunks WHERE chunk_start < $1', [
      Date.now() - PERSIST_WINDOW_MS - 60 * 60_000,
    ]);
  } catch (err) {
    console.error('[lightning] chunk save failed:', err instanceof Error ? err.message : err);
  } finally {
    savingChunk = false;
  }
}

// Load every chunk still in the window, oldest first, into the ring buffer.
// Retries a few times because boot-time migration may still be creating the
// table; gives up quietly (cold start) if the DB stays unreachable.
async function loadChunks(attempts = 5): Promise<void> {
  const cutoff = Date.now() - PERSIST_WINDOW_MS;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { rows } = await pool.query<{ n: number; data: Buffer }>(
        'SELECT n, data FROM lightning_chunks WHERE chunk_start >= $1 ORDER BY chunk_start ASC',
        [cutoff]
      );
      let loaded = 0;
      for (const row of rows) {
        try {
          const { lat, lon, tMs } = unpackStrikes(row.data, row.n);
          for (let i = 0; i < row.n; i++) {
            if (tMs[i] < cutoff) continue;
            push(lat[i], lon[i], tMs[i]);
            loaded++;
            if (tMs[i] > lastSavedT) lastSavedT = tMs[i];
          }
        } catch (err) {
          console.warn('[lightning] skipping corrupt chunk:', err instanceof Error ? err.message : err);
        }
      }
      if (loaded > 0) console.log(`[lightning] restored ${loaded} strikes from ${rows.length} chunks`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= attempts) {
        console.warn(`[lightning] history load failed after ${attempt} attempts (${msg}) — starting cold`);
        return;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

// --- Connection --------------------------------------------------------------
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let relayIndex = 0;
let connected = false;
let connectedAt = 0;
let totalStrikes = 0;
let lastStrikeAt = 0;

// Exponential backoff (with jitter) so unreachable relays aren't hammered every
// 3s forever; reset as soon as a strike actually arrives.
let consecutiveFailures = 0;
function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay =
    Math.min(120_000, 3_000 * 2 ** Math.min(consecutiveFailures, 5)) +
    Math.floor(Math.random() * 1_000);
  consecutiveFailures++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
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
    connectedAt = Date.now();
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
    consecutiveFailures = 0;
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
  // Restore the persisted 24h history first (so reloaded strikes precede live
  // ones and the buffer stays time-ordered), then connect the live stream. The
  // load retries briefly around boot-time migration, worst case ~15s of missed
  // live strikes — negligible against a 24h window.
  loadChunks()
    .catch(() => {})
    .finally(() => connect());
  setInterval(() => void saveChunk(), SAVE_INTERVAL_MS);
  // Half-open-socket watchdog: the global stream never goes 2 minutes silent,
  // but a NAT timeout can leave the TCP connection "up" with no 'close' event —
  // which would silently stop 24h collection until someone restarts the dyno.
  setInterval(() => {
    const sinceData = Date.now() - Math.max(lastStrikeAt, connectedAt);
    if (connected && ws && sinceData > 120_000) {
      console.warn('[lightning] no strikes for 2 min on an open socket — forcing reconnect');
      try {
        ws.terminate(); // triggers 'close' → scheduleReconnect
      } catch {
        connected = false;
        ws = null;
        scheduleReconnect();
      }
    }
  }, 60_000).unref();
  // Heroku sends SIGTERM before a dyno restart and allows ~30s of grace — a
  // final small chunk write shrinks the loss window to near zero.
  process.once('SIGTERM', () => void saveChunk());
}

// --- Query route -------------------------------------------------------------
// GET /api/lightning?minutes=60  → strikes within the last `minutes`, as compact
// parallel arrays. The response is capped at MAX_RESPONSE points; if the window
// holds more, it's uniformly strided (thinned) so the payload and the client's
// point cloud stay bounded regardless of storm intensity.
//
// Optional &lat=&lon=&radiusMi= applies a spatial filter BEFORE the cap, so a
// "near this property" query (the risk report) gets every buffered strike in
// its radius instead of a stride-thinned global sample — a 24 h global window
// holds ~1M+ strikes and global thinning would sample local storms down to
// nothing while the report presents the numbers as true counts.
const MAX_RESPONSE = 20_000;

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Identical windows are requested by every polling dashboard — memoize the
// serialized body briefly so a 24h query (a walk over up to ~1.4M ring slots)
// runs once per interval, not once per client.
const MEMO_TTL_MS = 10_000;
const queryMemo = new Map<string, { at: number; body: string }>();

router.get('/', (req, res) => {
  const minutes = Math.min(1440, Math.max(1, Math.round(Number(req.query.minutes)) || 60));
  const qLat = Number(req.query.lat);
  const qLon = Number(req.query.lon);
  const qRad = Number(req.query.radiusMi);
  const hasFilter =
    Number.isFinite(qLat) && Math.abs(qLat) <= 90 &&
    Number.isFinite(qLon) && Math.abs(qLon) <= 180 &&
    Number.isFinite(qRad) && qRad > 0;
  const radiusMi = hasFilter ? Math.min(500, qRad) : 0;

  const now = Date.now();
  const cutoff = now - minutes * 60_000;

  const memoKey = hasFilter
    ? `${minutes}:${qLat.toFixed(3)},${qLon.toFixed(3)},${radiusMi}`
    : String(minutes);
  const memo = queryMemo.get(memoKey);
  if (memo && now - memo.at < MEMO_TTL_MS) {
    res.type('application/json').send(memo.body);
    return;
  }

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

  const oldestIdx = (head - count + CAP) % CAP;
  const coverageMin = Math.min(minutes, Math.round((now - tBuf[oldestIdx]) / 60_000));

  // The ring is time-ordered oldest→newest, so binary-search the first logical
  // slot inside the window instead of walking millions of entries.
  const at = (j: number) => tBuf[(oldestIdx + j) % CAP];
  let lo = 0;
  let hi = count; // first index with t >= cutoff (or count if none)
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid) < cutoff) lo = mid + 1;
    else hi = mid;
  }
  const lat: number[] = [];
  const lon: number[] = [];
  const t: number[] = [];
  const pushIdx = (idx: number) => {
    lat.push(Math.round(latBuf[idx] * 1000) / 1000);
    lon.push(Math.round(lonBuf[idx] * 1000) / 1000);
    t.push(Math.round(tBuf[idx] / 1000)); // epoch seconds (smaller payload)
  };

  let totalInWindow: number;
  let stride: number;
  if (!hasFilter) {
    totalInWindow = count - lo;
    // Emit every `stride`-th strike (anchored at the newest, matching the old
    // newest→oldest walk) so the result is ≤ MAX_RESPONSE and evenly spread.
    stride = Math.max(1, Math.ceil(totalInWindow / MAX_RESPONSE));
    for (let j = lo; j < count; j++) {
      if ((count - 1 - j) % stride !== 0) continue;
      pushIdx((oldestIdx + j) % CAP);
    }
  } else {
    // Spatial filter first (cheap bounding-box reject before the haversine),
    // THEN the response cap — totalInWindow/thinned describe the filtered set.
    const dLatMax = radiusMi / 69;
    const dLonMax = radiusMi / (69 * Math.max(0.05, Math.cos((qLat * Math.PI) / 180)));
    const radiusM = radiusMi * 1609.344;
    const matches: number[] = []; // buffer slot indices, oldest→newest
    for (let j = lo; j < count; j++) {
      const idx = (oldestIdx + j) % CAP;
      const dla = latBuf[idx] - qLat;
      if (dla > dLatMax || dla < -dLatMax) continue;
      let dlo = lonBuf[idx] - qLon;
      if (dlo > 180) dlo -= 360;
      else if (dlo < -180) dlo += 360;
      if (dlo > dLonMax || dlo < -dLonMax) continue;
      if (haversineM(qLat, qLon, latBuf[idx], lonBuf[idx]) > radiusM) continue;
      matches.push(idx);
    }
    totalInWindow = matches.length;
    stride = Math.max(1, Math.ceil(totalInWindow / MAX_RESPONSE));
    for (let k = 0; k < matches.length; k++) {
      if ((matches.length - 1 - k) % stride !== 0) continue;
      pushIdx(matches[k]);
    }
  }

  const body = JSON.stringify({
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
  queryMemo.set(memoKey, { at: now, body });
  res.type('application/json').send(body);
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
