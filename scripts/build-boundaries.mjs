#!/usr/bin/env node
// Rebuilds the vector country and state/province border lines drawn over
// the imagery basemaps (Dark Sat, Earth) from Natural Earth:
//
//   npm run build:boundaries
//   npm run build:boundaries -- --from ./ne-geojson-dir   # pre-downloaded files
//
// Both classes come from the 1:10m release so province lines end exactly on
// the country borders they meet (the 1:50m country lines are offset by up to a
// few km from the 1:10m province lines at regional zoom). Each line is
// simplified with Douglas–Peucker in planar lon/lat — endpoints are always
// kept, so lines that meet at a junction still meet — then quantized to
// 0.001° (≈ 110 m, well below the tolerance) and delta-encoded.
//
// Output: client/public/data/boundaries.json, served as /data/boundaries.json
//
//   { "v": 1, "scale": 1000,
//     "country": { "n": [points in line 0, points in line 1, …],
//                  "d": [dx, dy, dx, dy, …] },
//     "state":   { … same … } }
//
// "d" is one running stream of integer lon/lat steps (× scale) per class: the
// first pair is relative to (0, 0), and every pair after that — including
// the first point of each new line — is relative to the point before it. The
// client (client/src/cesium/boundaryLines.ts) decodes it and densifies long
// straight runs such as the 49th parallel so they follow the globe.
//
// Natural Earth is public domain. Re-run this when Natural Earth publishes a
// release that moves a border (rarely).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'public', 'data', 'boundaries.json');
const BASE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

// Quantization grid: 1000 steps per degree.
const SCALE = 1000;

const CLASSES = {
  country: {
    name: 'ne_10m_admin_0_boundary_lines_land',
    // Douglas–Peucker tolerance in degrees (≈ 1 km at the equator).
    toleranceDeg: 0.01,
    // Lease and overlay limits (Guantánamo, the Panama Canal area, …) sit on
    // top of, or inside, real borders; everything else — disputed lines and
    // lines of control included — is drawn.
    skip: new Set(['Lease limit', 'Overlay limit']),
  },
  state: {
    name: 'ne_10m_admin_1_states_provinces_lines',
    toleranceDeg: 0.02,
    // Meta bounds group provinces into statistical regions (UK, US, China,
    // Russia, Canada) and would draw some lines twice; indicators are short
    // ticks across water.
    skip: new Set(['Admin-1 statistical meta bounds', 'Admin-1 boundary indicator']),
  },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(from)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Unexpected argument: ${argv[i]}`);
    out[m[1]] = m[2] ?? argv[++i];
    if (out[m[1]] === undefined) throw new Error(`--${m[1]} needs a value`);
  }
  return out;
}

// Node's fetch ignores HTTPS_PROXY; fall back to curl (which honours it) so
// the script also works from behind a corporate proxy.
async function download(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.warn(`fetch failed (${err.message ?? err}); retrying with curl`);
    const dir = mkdtempSync(path.join(tmpdir(), 'ne-dl-'));
    try {
      const tmp = path.join(dir, 'download.geojson');
      const r = spawnSync('curl', ['-sSL', '--fail', '-o', tmp, url], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`curl exited with ${r.status}`);
      return readFileSync(tmp, 'utf8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

// Natural Earth cuts lines at the antimeridian, but split defensively at any
// jump of more than 180° so no segment can wrap the long way round.
function splitAtAntimeridian(line) {
  const out = [];
  let cur = [line[0]];
  for (let i = 1; i < line.length; i++) {
    if (Math.abs(line[i][0] - line[i - 1][0]) > 180) {
      out.push(cur);
      cur = [];
    }
    cur.push(line[i]);
  }
  out.push(cur);
  return out;
}

// Natural Earth cuts its lines into many short pieces (42k for the provinces).
// Douglas–Peucker has to keep every piece's endpoints, so first chain pieces
// end to end wherever exactly two ends meet. Junctions where three or more
// lines meet stay as they are.
function mergeLines(lines) {
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const nodes = new Map(); // node key → [[line index, is the line's end], …]
  lines.forEach((l, i) => {
    for (const [k, isEnd] of [[key(l[0]), false], [key(l[l.length - 1]), true]]) {
      const at = nodes.get(k);
      if (at) at.push([i, isEnd]);
      else nodes.set(k, [[i, isEnd]]);
    }
  });
  const used = new Uint8Array(lines.length);
  const next = (point) => {
    const at = nodes.get(key(point));
    if (!at || at.length !== 2) return null;
    return at.find(([j]) => !used[j]) ?? null;
  };
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = lines[i].slice();
    for (let hit = next(chain[chain.length - 1]); hit; hit = next(chain[chain.length - 1])) {
      const [j, atEnd] = hit;
      used[j] = 1;
      const add = atEnd ? lines[j].slice().reverse() : lines[j];
      for (let p = 1; p < add.length; p++) chain.push(add[p]);
    }
    for (let hit = next(chain[0]); hit; hit = next(chain[0])) {
      const [j, atEnd] = hit;
      used[j] = 1;
      const add = atEnd ? lines[j] : lines[j].slice().reverse();
      chain = add.slice(0, -1).concat(chain);
    }
    out.push(chain);
  }
  return out;
}

// Iterative Douglas–Peucker in planar lon/lat. Keeps both endpoints.
function simplify(line, tol) {
  const n = line.length;
  if (n <= 2) return line;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD2 = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = line[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > maxD2) {
        maxD2 = d2;
        idx = i;
      }
    }
    if (idx >= 0 && maxD2 > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

function quantize(line) {
  const out = [];
  for (const [lon, lat] of line) {
    const x = Math.round(lon * SCALE);
    const y = Math.round(lat * SCALE);
    const prev = out[out.length - 1];
    if (prev && prev[0] === x && prev[1] === y) continue;
    out.push([x, y]);
  }
  return out;
}

function buildClass(geojson, cfg) {
  const pieces = [];
  let inputPoints = 0;
  let skipped = 0;
  for (const f of geojson.features) {
    if (cfg.skip.has(f.properties?.FEATURECLA)) {
      skipped++;
      continue;
    }
    for (const raw of linesOf(f.geometry)) {
      if (!raw || raw.length < 2) continue;
      inputPoints += raw.length;
      for (const part of splitAtAntimeridian(raw)) if (part.length >= 2) pieces.push(part);
    }
  }
  const lines = [];
  for (const chain of mergeLines(pieces)) {
    const q = quantize(simplify(chain, cfg.toleranceDeg));
    if (q.length >= 2) lines.push(q);
  }
  // Running delta stream across all lines of the class.
  const n = [];
  const d = [];
  let px = 0;
  let py = 0;
  let points = 0;
  for (const line of lines) {
    n.push(line.length);
    for (const [x, y] of line) {
      d.push(x - px, y - py);
      px = x;
      py = y;
    }
    points += line.length;
  }
  return {
    encoded: { n, d },
    stats: { features: geojson.features.length, skipped, inputPoints, pieces: pieces.length, lines: lines.length, points },
  };
}

// Decode the stream back and check it: every point on the globe, every line
// at least two points long, no segment longer than 180° of longitude.
function verify(encoded, label) {
  const { n, d } = encoded;
  const total = n.reduce((s, k) => s + k, 0);
  if (d.length !== total * 2) throw new Error(`${label}: ${d.length / 2} encoded points, line counts say ${total}`);
  let x = 0;
  let y = 0;
  let i = 0;
  for (const k of n) {
    if (k < 2) throw new Error(`${label}: line with ${k} point(s)`);
    for (let p = 0; p < k; p++, i += 2) {
      const lx = x;
      x += d[i];
      y += d[i + 1];
      if (Math.abs(x) > 180 * SCALE || Math.abs(y) > 90 * SCALE) {
        throw new Error(`${label}: point (${x / SCALE}, ${y / SCALE}) is off the globe`);
      }
      if (p > 0 && Math.abs(x - lx) > 180 * SCALE) throw new Error(`${label}: segment wraps the antimeridian`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = { v: 1, scale: SCALE, source: 'Natural Earth 1:10m (public domain)' };
  for (const [key, cfg] of Object.entries(CLASSES)) {
    let text;
    if (args.from) {
      text = readFileSync(path.resolve(args.from, `${cfg.name}.geojson`), 'utf8');
    } else {
      const url = `${BASE_URL}${cfg.name}.geojson`;
      console.log(`Downloading ${url}`);
      text = await download(url);
    }
    const { encoded, stats } = buildClass(JSON.parse(text), cfg);
    verify(encoded, key);
    out[key] = encoded;
    console.log(
      `${key}: ${stats.features} features (${stats.skipped} skipped), ${stats.inputPoints} → ${stats.points} points, ${stats.pieces} pieces chained into ${stats.lines} lines`
    );
  }
  const json = JSON.stringify(out);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${(json.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
