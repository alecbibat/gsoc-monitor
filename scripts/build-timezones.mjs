#!/usr/bin/env node
// Rebuilds the Time Zones overlay's boundary data from a
// timezone-boundary-builder release:
//
//   npm run build:timezones                        # latest release
//   npm run build:timezones -- --release 2026d     # a specific release
//   npm run build:timezones -- --from ./timezones-with-oceans-now.geojson.zip
//
// It downloads the "with oceans, now" variant — one polygon per set of places
// whose clocks agree from today onward (66 zones instead of 444), with the
// open ocean covered too — simplifies it topologically with mapshaper to
// about 1 km so shared borders stay shared and 86 MB of GeoJSON becomes a
// few hundred kilobytes of TopoJSON, and writes:
//
//   client/public/data/timezones.topo.json   served as-is to the browser
//   client/src/layers/timezones/timezones.meta.json   release + attribution,
//                                                     imported by the UI
//
// Boundaries are derived from OpenStreetMap and licensed ODbL. Re-run this
// after a tz database release that moves a border (a few times a year).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_TOPO = path.join(ROOT, 'client', 'public', 'data', 'timezones.topo.json');
const OUT_META = path.join(ROOT, 'client', 'src', 'layers', 'timezones', 'timezones.meta.json');

const REPO = 'evansiroky/timezone-boundary-builder';
const ASSET = 'timezones-with-oceans-now.geojson.zip';
// Visvalingam simplification tolerance. 1 km keeps coastlines and borders
// faithful at any zoom the globe is used at while cutting ~3.9M vertices to
// ~130k; the client tessellates those in about a second.
const SIMPLIFY_INTERVAL_M = 1000;
// TopoJSON coordinate grid: 1e6 steps across 360° ≈ 36 m, far below the
// simplification tolerance, so quantization costs no visible precision.
const QUANTIZATION = 1_000_000;
const MAPSHAPER_HEAP_MB = 6000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(release|from)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Unexpected argument: ${argv[i]}`);
    out[m[1]] = m[2] ?? argv[++i];
    if (out[m[1]] === undefined) throw new Error(`--${m[1]} needs a value`);
  }
  return out;
}

function releaseUrl(release) {
  return release === 'latest'
    ? `https://github.com/${REPO}/releases/latest/download/${ASSET}`
    : `https://github.com/${REPO}/releases/download/${release}/${ASSET}`;
}

// Node's fetch ignores HTTPS_PROXY; fall back to curl (which honours it) so
// the script also works from behind a corporate proxy.
async function download(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      lastModified: res.headers.get('last-modified'),
    };
  } catch (err) {
    console.warn(`fetch failed (${err.message ?? err}); retrying with curl`);
    const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'tz-dl-')), ASSET);
    const headers = path.join(path.dirname(tmp), 'headers.txt');
    const r = spawnSync('curl', ['-sSL', '--fail', '-D', headers, '-o', tmp, url], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`curl exited with ${r.status}`);
    const lm = /^last-modified:\s*(.+)$/im.exec(readFileSync(headers, 'utf8'));
    const bytes = new Uint8Array(readFileSync(tmp));
    rmSync(path.dirname(tmp), { recursive: true, force: true });
    return { bytes, lastModified: lm ? lm[1].trim() : null };
  }
}

function geojsonFromZip(zipBytes) {
  const entries = unzipSync(zipBytes);
  const name = Object.keys(entries).find((n) => n.endsWith('.json'));
  if (!name) throw new Error('No .json entry inside the zip');
  return entries[name];
}

function simplify(inputPath, outputPath) {
  const bin = require.resolve('mapshaper/bin/mapshaper');
  const args = [
    `--max-old-space-size=${MAPSHAPER_HEAP_MB}`, bin,
    '-i', inputPath,
    '-simplify', `interval=${SIMPLIFY_INTERVAL_M}`, 'keep-shapes',
    '-clean',
    '-rename-layers', 'zones',
    '-o', outputPath, 'format=topojson', `quantization=${QUANTIZATION}`,
  ];
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`mapshaper exited with ${r.status}`);
}

function verify(topo) {
  if (topo.type !== 'Topology' || !topo.objects?.zones) throw new Error('Output is not a Topology with a "zones" object');
  const ids = topo.objects.zones.geometries.map((g) => g.properties?.tzid);
  if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error('A zone is missing its tzid');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate tzid in output');
  for (const id of ids) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: id });
    } catch {
      console.warn(`warning: this Node's ICU does not know zone ${id}; browsers may not either`);
    }
  }
  return ids;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const release = args.release ?? 'latest';
  const work = mkdtempSync(path.join(tmpdir(), 'tz-build-'));
  try {
    let geojson;
    let lastModified = null;
    let source;
    if (args.from) {
      source = path.resolve(args.from);
      const bytes = new Uint8Array(readFileSync(source));
      geojson = source.endsWith('.zip') ? geojsonFromZip(bytes) : bytes;
    } else {
      source = releaseUrl(release);
      console.log(`Downloading ${source}`);
      const dl = await download(source);
      lastModified = dl.lastModified;
      geojson = geojsonFromZip(dl.bytes);
    }
    const input = path.join(work, 'zones.json');
    writeFileSync(input, geojson);
    console.log(`Simplifying ${(geojson.length / 1e6).toFixed(1)} MB of GeoJSON with mapshaper`);
    const output = path.join(work, 'zones.topo.json');
    simplify(input, output);

    const topo = JSON.parse(readFileSync(output, 'utf8'));
    const ids = verify(topo);
    const compact = JSON.stringify(topo);
    mkdirSync(path.dirname(OUT_TOPO), { recursive: true });
    writeFileSync(OUT_TOPO, compact);

    const meta = {
      source: `https://github.com/${REPO}`,
      asset: ASSET,
      release,
      assetLastModified: lastModified,
      builtAt: new Date().toISOString(),
      simplifyIntervalMeters: SIMPLIFY_INTERVAL_M,
      quantization: QUANTIZATION,
      zones: ids.length,
      arcs: topo.arcs.length,
      license: 'ODbL 1.0',
      attribution: '© OpenStreetMap contributors, via timezone-boundary-builder',
    };
    writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, OUT_TOPO)} (${(compact.length / 1e6).toFixed(2)} MB, ${ids.length} zones, ${topo.arcs.length} arcs)`);
    console.log(`Wrote ${path.relative(ROOT, OUT_META)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
