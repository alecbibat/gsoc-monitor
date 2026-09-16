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
// open ocean covered too — and turns 86 MB of GeoJSON into under a megabyte
// of TopoJSON:
//
//   1. mapshaper simplifies to ~1 km, topologically (shared borders stay
//      shared) and in planar lon/lat (its default 3D mode merges the two
//      lat-90 vertices of a polar polygon and drops one, opening a wedge).
//   2. mapshaper -clean resolves the release's deliberate overlaps (the West
//      Bank is drawn in both Asia/Jerusalem and Asia/Gaza; Pitcairn in both
//      Pacific/Gambier and Pacific/Pitcairn): the smaller, more specific
//      polygon wins.
//   3. Every zone is cut on a 45° × 90° grid, one mapshaper run per cell
//      (clipping into extra layers in a single run loses hole rings).
//      Cesium 1.142 tessellates any polygon part ≥ 90° tall or ≥ 120° wide
//      twice — PolygonGeometryLibrary.splitPolygonsOnEquator duplicates the
//      ring it means to copy — doubling the fill's opacity and triangle
//      count; parts under those limits never enter that path. The client
//      regroups pieces by zone.
//   4. The pieces are re-imported and written as TopoJSON, and the output
//      is checked: every zone present, no oversized part, a 0.5° world grid
//      fully covered with no point claimed by two zones.
//
// Outputs:
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
import { feature as topoFeature } from 'topojson-client';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_TOPO = path.join(ROOT, 'client', 'public', 'data', 'timezones.topo.json');
const OUT_META = path.join(ROOT, 'client', 'src', 'layers', 'timezones', 'timezones.meta.json');

const REPO = 'evansiroky/timezone-boundary-builder';
const ASSET = 'timezones-with-oceans-now.geojson.zip';
// Visvalingam tolerance in degrees (planar): ~1 km at the equator, finer
// toward the poles. Cuts ~3.9M vertices to ~150k, which the client
// tessellates in about a second.
const SIMPLIFY_INTERVAL_DEG = 0.009;
// TopoJSON coordinate grid: 1e6 steps across 360° ≈ 36 m, far below the
// simplification tolerance, so quantization costs no visible precision.
const QUANTIZATION = 1_000_000;
const MAPSHAPER_HEAP_MB = 6000;
// Grid cells for step 3: rows 45° tall, columns 90° wide.
const CELL_LAT_DEG = 45;
const CELL_LON_DEG = 90;
// Cesium's split thresholds (PolygonGeometry.createSplitPolygons).
const MAX_PART_HEIGHT_DEG = 90;
const MAX_PART_WIDTH_DEG = 120;
const COVERAGE_STEP_DEG = 0.5;

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

function assetUrl(release) {
  return `https://github.com/${REPO}/releases/download/${release}/${ASSET}`;
}

// "latest" is a redirect to /releases/download/<tag>/<asset>; read the tag off
// that first hop so the metadata names a real release.
async function resolveLatestTag() {
  const url = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
  let location = null;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    location = res.headers.get('location');
  } catch {
    const r = spawnSync('curl', ['-sSI', url], { encoding: 'utf8' });
    const m = /^location:\s*(.+)$/im.exec(r.stdout ?? '');
    location = m ? m[1].trim() : null;
  }
  const m = location && /\/releases\/download\/([^/]+)\//.exec(location);
  if (!m) {
    throw new Error(
      'Could not determine the latest release tag from GitHub; pass --release <tag> explicitly.'
    );
  }
  return m[1];
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
    const dir = mkdtempSync(path.join(tmpdir(), 'tz-dl-'));
    const tmp = path.join(dir, ASSET);
    const headers = path.join(dir, 'headers.txt');
    const r = spawnSync('curl', ['-sSL', '--fail', '-D', headers, '-o', tmp, url], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`curl exited with ${r.status}`);
    const lm = /^last-modified:\s*(.+)$/im.exec(readFileSync(headers, 'utf8'));
    const bytes = new Uint8Array(readFileSync(tmp));
    rmSync(dir, { recursive: true, force: true });
    return { bytes, lastModified: lm ? lm[1].trim() : null };
  }
}

function geojsonFromZip(zipBytes) {
  const entries = unzipSync(zipBytes);
  const name = Object.keys(entries).find((n) => n.endsWith('.json'));
  if (!name) throw new Error('No .json entry inside the zip');
  return entries[name];
}

function mapshaper(...args) {
  const bin = require.resolve('mapshaper/bin/mapshaper');
  const r = spawnSync(process.execPath, [`--max-old-space-size=${MAPSHAPER_HEAP_MB}`, bin, ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) throw new Error(`mapshaper exited with ${r.status}: ${args.join(' ')}`);
}

// Steps 1–2: simplify and resolve overlaps, keeping full precision GeoJSON
// for the clipping runs.
function simplifyAndClean(inputPath, outputPath) {
  mapshaper(
    '-i', inputPath, 'name=zones',
    '-simplify', `interval=${SIMPLIFY_INTERVAL_DEG}`, 'planar', 'keep-shapes',
    '-clean', 'overlap-rule=min-area',
    '-o', outputPath, 'format=geojson'
  );
}

// Step 3: one clip run per grid cell, then gather the pieces.
function clipToGrid(cleanPath, workDir) {
  const features = [];
  let i = 0;
  for (let south = -90; south < 90; south += CELL_LAT_DEG) {
    for (let west = -180; west < 180; west += CELL_LON_DEG) {
      const out = path.join(workDir, `cell-${i++}.json`);
      mapshaper(
        '-i', cleanPath,
        '-clip', `bbox=${west},${south},${west + CELL_LON_DEG},${south + CELL_LAT_DEG}`,
        '-o', out, 'format=geojson'
      );
      for (const f of JSON.parse(readFileSync(out, 'utf8')).features) {
        if (f.geometry) features.push(f);
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

// Step 4: shared-arc TopoJSON from the pieces.
function toTopoJson(piecesPath, outputPath) {
  mapshaper('-i', piecesPath, 'name=zones', '-o', outputPath, 'format=topojson', `quantization=${QUANTIZATION}`);
}

// ── Verification ─────────────────────────────────────────────────────────────

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function verify(topo, expectedZones) {
  if (topo.type !== 'Topology' || !topo.objects?.zones) throw new Error('Output is not a Topology with a "zones" object');
  const features = topoFeature(topo, topo.objects.zones).features;
  const problems = [];

  const zones = new Set(features.map((f) => f.properties?.tzid));
  for (const z of expectedZones) if (!zones.has(z)) problems.push(`zone ${z} is missing from the output`);
  for (const z of zones) if (!expectedZones.has(z)) problems.push(`unexpected zone ${z} in the output`);
  for (const z of zones) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: z });
    } catch {
      console.warn(`warning: this Node's ICU does not know zone ${z}; browsers may not either`);
    }
  }

  const parts = [];
  for (const f of features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of polys) {
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lon, lat] of rings[0]) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      if (maxLat - minLat >= MAX_PART_HEIGHT_DEG || maxLon - minLon >= MAX_PART_WIDTH_DEG) {
        problems.push(`${f.properties.tzid} has a part ${(maxLon - minLon).toFixed(1)}° wide × ${(maxLat - minLat).toFixed(1)}° tall (Cesium would tessellate it twice)`);
      }
      parts.push({ tzid: f.properties.tzid, rings, bbox: [minLon, minLat, maxLon, maxLat] });
    }
  }

  // Coverage: every sample point on a world grid belongs to exactly one zone.
  let uncovered = 0;
  let contested = 0;
  const examples = [];
  for (let lat = -90 + COVERAGE_STEP_DEG / 2; lat < 90; lat += COVERAGE_STEP_DEG) {
    for (let lon = -180 + COVERAGE_STEP_DEG / 2; lon < 180; lon += COVERAGE_STEP_DEG) {
      const owners = new Set();
      for (const p of parts) {
        const b = p.bbox;
        if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
        let crossings = 0;
        for (const ring of p.rings) if (pointInRing(lon, lat, ring)) crossings++;
        if (crossings % 2 === 1) owners.add(p.tzid);
      }
      if (owners.size === 0) {
        uncovered++;
        if (examples.length < 5) examples.push(`(${lon}, ${lat}) uncovered`);
      } else if (owners.size > 1) {
        contested++;
        if (examples.length < 5) examples.push(`(${lon}, ${lat}) in ${[...owners].join(' and ')}`);
      }
    }
  }
  if (uncovered) problems.push(`${uncovered} grid points are covered by no zone`);
  if (contested) problems.push(`${contested} grid points are covered by more than one zone`);
  for (const e of examples) problems.push(`  e.g. ${e}`);

  if (problems.length) throw new Error(`Output failed verification:\n${problems.join('\n')}`);
  return { zones: zones.size, pieces: features.length, parts: parts.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const work = mkdtempSync(path.join(tmpdir(), 'tz-build-'));
  try {
    let geojson;
    let lastModified = null;
    let release;
    let source;
    if (args.from) {
      source = path.resolve(args.from);
      release = args.release ?? `local file ${path.basename(source)}`;
      const bytes = new Uint8Array(readFileSync(source));
      geojson = source.endsWith('.zip') ? geojsonFromZip(bytes) : bytes;
    } else {
      release = args.release ?? (await resolveLatestTag());
      source = assetUrl(release);
      console.log(`Downloading ${source}`);
      const dl = await download(source);
      lastModified = dl.lastModified;
      geojson = geojsonFromZip(dl.bytes);
    }
    const input = path.join(work, 'raw.json');
    writeFileSync(input, geojson);
    const expectedZones = new Set(
      JSON.parse(Buffer.from(geojson).toString('utf8')).features.map((f) => f.properties.tzid)
    );

    console.log(`Simplifying ${(geojson.length / 1e6).toFixed(1)} MB of GeoJSON with mapshaper`);
    const clean = path.join(work, 'clean.json');
    simplifyAndClean(input, clean);
    console.log('Cutting zones on the grid');
    const pieces = path.join(work, 'pieces.json');
    writeFileSync(pieces, JSON.stringify(clipToGrid(clean, work)));
    const output = path.join(work, 'zones.topo.json');
    toTopoJson(pieces, output);

    const topo = JSON.parse(readFileSync(output, 'utf8'));
    console.log('Verifying coverage');
    const stats = verify(topo, expectedZones);
    const compact = JSON.stringify(topo);
    mkdirSync(path.dirname(OUT_TOPO), { recursive: true });
    writeFileSync(OUT_TOPO, compact);

    const meta = {
      source: `https://github.com/${REPO}`,
      asset: ASSET,
      release,
      assetLastModified: lastModified,
      builtAt: new Date().toISOString(),
      simplifyIntervalDegrees: SIMPLIFY_INTERVAL_DEG,
      quantization: QUANTIZATION,
      zones: stats.zones,
      pieces: stats.pieces,
      arcs: topo.arcs.length,
      license: 'ODbL 1.0',
      attribution: '© OpenStreetMap contributors, via timezone-boundary-builder',
    };
    writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(
      `Wrote ${path.relative(ROOT, OUT_TOPO)} (${(compact.length / 1e6).toFixed(2)} MB, ${stats.zones} zones in ${stats.pieces} pieces, ${stats.parts} parts, ${topo.arcs.length} arcs)`
    );
    console.log(`Wrote ${path.relative(ROOT, OUT_META)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
