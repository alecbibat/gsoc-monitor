#!/usr/bin/env node
// Builds the place-name dataset behind the globe's vector labels
// (client/src/cesium/placeLabels.ts):
//
//   npm run build:place-labels
//   npm run build:place-labels -- --cache ./.place-labels-cache   # keep downloads between runs
//   npm run build:place-labels -- --no-geonames                   # Natural Earth only
//
// Sources
//   Natural Earth vector data, public domain (https://www.naturalearthdata.com),
//   read as GeoJSON from https://github.com/nvkelso/natural-earth-vector:
//     ne_50m_admin_0_countries             countries: LABEL_X/LABEL_Y, MIN_LABEL
//     ne_10m_admin_1_label_points_details  states/provinces: longitude/latitude, min_label, postal
//     ne_10m_populated_places_simple       cities and towns: min_zoom, pop_max, featurecla
//     ne_10m_geography_marine_polys        oceans, seas, gulfs, bays, straits: min_label
//     ne_10m_lakes                         large lakes and reservoirs: min_label
//   GeoNames cities15000, CC BY 4.0 (https://www.geonames.org): towns of 15,000+
//   people that Natural Earth lacks, so regional zooms are not empty. The map
//   must credit "GeoNames" wherever these labels are shown.
//
// Output: client/public/data/place-labels.json
//   { "v": 1, "fields": ["kind","name","lon","lat","minZoom","pop","flags","abbr"], "rows": [...] }
//   kind     "c" country, "s" state/province (admin-1), "w" water body, "p" populated place
//   lon/lat  label point, 3 decimals (water: a point inside the polygon, from mapshaper)
//   minZoom  web-map zoom (Web Mercator, 256 px tiles) at which the label first appears
//   pop      population for places (pop_max), else 0
//   flags    bitmask: 1 national capital, 2 state/province capital
//   abbr     postal abbreviation for US, Canadian and Australian states, else ""
// Rows are sorted by importance (kind c, s, w, p; then minZoom ascending; then
// population descending) and the label engine breaks ties by row order.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'public', 'data', 'place-labels.json');

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const NE = {
  countries: 'ne_50m_admin_0_countries',
  admin1: 'ne_10m_admin_1_label_points_details',
  places: 'ne_10m_populated_places_simple',
  marine: 'ne_10m_geography_marine_polys',
  lakes: 'ne_10m_lakes',
};
const GEONAMES_URL = 'https://download.geonames.org/export/dump/cities15000.zip';

const FIELDS = ['kind', 'name', 'lon', 'lat', 'minZoom', 'pop', 'flags', 'abbr'];
const KIND_ORDER = { c: 0, s: 1, w: 2, p: 3 };
const KIND_RANK_STATE = 100; // admin-1 tie-break: lower NE labelrank first
// GeoNames rows are added (most important first) until the file reaches this size.
const MAX_BYTES = 880_000;
const ADMIN1_MAX_MIN_LABEL = 7; // keeps US/CA/AU (3.5), BR (3.7), CN/IN (4.6), RU (5), MX/DE (6.6), JP (7)
const PLACE_MAX_MIN_ZOOM = 10;
const MARINE_MAX_MIN_LABEL = 6;
const MARINE_MAX_SCALERANK = 4;
const LAKE_MAX_SCALERANK = 4; // Great Lakes … Lake Powell, Lake Mead, Yellowstone Lake
// Same-name labels closer than this are one feature. A state and the city it
// is named after are merged (the city stays) only when the state is a city
// (Berlin is not "City" in NE, but its point is 2 km from the city's) or the
// two points nearly coincide; Chihuahua the state and the city both stay.
const DUP_KM = 25;
const CITY_STATE_KM = 50;
const STATE_PLACE_KM = 10;
const CITY_TYPES =
  /city|metropol|capital|captial|federal (?:district|territory)|special district|urban prefecture|autonomous commune|administrative state|union territory|^municipality$/i;

// NE's postal codes for Australia are two-letter internal codes ("NS", "VI").
const AU_ABBR = {
  'New South Wales': 'NSW',
  Victoria: 'VIC',
  Queensland: 'QLD',
  'South Australia': 'SA',
  'Western Australia': 'WA',
  Tasmania: 'TAS',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
  'Jervis Bay Territory': 'JBT',
};
const MARINE_NAME_FIX = { 'Tikahtnu Inlet': 'Cook Inlet', Hangzhouwan: 'Hangzhou Bay' };
// Suffixes dropped from admin-1 names unless what is left is only a direction.
const ADMIN1_SUFFIX = /\s+(?:Economic\s+)?(?:Province|Prefecture|Governorate|Region|Department|Municipality)$/i;
const GENERIC_REMAINDER = /^(?:(?:north|south)(?:[- ]?(?:east|west))?(?:ern)?|east(?:ern)?|west(?:ern)?|central|upper|lower|capital|coast)$/i;

// GeoNames: population brackets → minZoom; capitals (PPLC/PPLA) one step earlier.
const GN_BRACKETS = [
  [1_000_000, 5.5],
  [300_000, 6.5],
  [100_000, 7.5],
  [50_000, 8.3],
  [15_000, 9.2],
];
const GN_CAPITAL_TOP = 5.0;
const GN_SKIP_CODES = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
const GN_NEAR_NE_KM = 8; // any Natural Earth place this close → already labelled
const GN_NEAR_GN_KM = 4; // a bigger GeoNames town this close → same urban area
const GN_SATELLITE_KM = 25; // next to a bigger NE city → one zoom later

function parseArgs(argv) {
  const out = { cache: null, geonames: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-geonames') out.geonames = false;
    else if (a === '--cache') out.cache = path.resolve(argv[++i] ?? '');
    else if (a.startsWith('--cache=')) out.cache = path.resolve(a.slice(8));
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return out;
}

// Node's fetch ignores HTTPS_PROXY on older releases; fall back to curl.
async function download(url, cacheDir) {
  const name = path.basename(new URL(url).pathname);
  const cached = cacheDir ? path.join(cacheDir, name) : null;
  if (cached && existsSync(cached)) return readFileSync(cached);
  let bytes;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.warn(`fetch ${name} failed (${err.message ?? err}); retrying with curl`);
    const dir = mkdtempSync(path.join(tmpdir(), 'place-labels-dl-'));
    try {
      const tmp = path.join(dir, name);
      const r = spawnSync('curl', ['-sSL', '--fail', '-o', tmp, url], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`curl exited with ${r.status} for ${url}`);
      bytes = readFileSync(tmp);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (cached) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, bytes);
  }
  console.log(`  ${name}: ${(bytes.length / 1e6).toFixed(1)} MB`);
  return bytes;
}

function mapshaper(...args) {
  const bin = require.resolve('mapshaper/bin/mapshaper');
  const r = spawnSync(process.execPath, [bin, '-quiet', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`mapshaper exited with ${r.status}: ${args.join(' ')}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const nameKey = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const titleCase = (s) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase()) : s;

function haversineKm(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Grid of 0.5° cells for "anything within N km" lookups.
class PointIndex {
  constructor(cellDeg = 0.5) {
    this.cell = cellDeg;
    this.cells = new Map();
  }
  key(ix, iy) {
    return ix * 1000 + iy;
  }
  add(row) {
    const k = this.key(Math.floor(row.lon / this.cell), Math.floor(row.lat / this.cell));
    const list = this.cells.get(k);
    if (list) list.push(row);
    else this.cells.set(k, [row]);
  }
  near(lon, lat, km) {
    const out = [];
    const ny = Math.ceil(km / (111.2 * this.cell));
    const nx = Math.ceil(km / (111.2 * this.cell * Math.max(Math.cos((lat * Math.PI) / 180), 0.02)));
    const ix0 = Math.floor(lon / this.cell);
    const iy0 = Math.floor(lat / this.cell);
    for (let dx = -nx; dx <= nx; dx++) {
      for (let dy = -ny; dy <= ny; dy++) {
        for (const r of this.cells.get(this.key(ix0 + dx, iy0 + dy)) ?? []) {
          const d = haversineKm(lon, lat, r.lon, r.lat);
          if (d <= km) out.push({ row: r, km: d });
        }
      }
    }
    return out;
  }
}

function row(kind, name, lon, lat, minZoom, { pop = 0, flags = 0, abbr = '', rank = 0, city = false } = {}) {
  return { kind, name, lon: r3(lon), lat: r3(lat), minZoom: r1(minZoom), pop, flags, abbr, rank, city, key: nameKey(name) };
}

const valid = (r) =>
  r.name && r.key && Number.isFinite(r.lon) && Number.isFinite(r.lat) && Number.isFinite(r.minZoom);

// ── Natural Earth layers ─────────────────────────────────────────────────────

function countryRows(fc) {
  return fc.features.map(({ properties: p }) => {
    // NAME_EN is often the formal name ("United States of America", "People's
    // Republic of China") and NAME_LONG sometimes is ("Russian Federation"):
    // take the shorter, skipping abbreviations.
    const names = [clean(p.NAME_EN), clean(p.NAME_LONG)].filter((n) => n && !n.includes('.'));
    names.sort((a, b) => a.length - b.length);
    const name = names[0] || clean(p.NAME);
    return row('c', name, p.LABEL_X, p.LABEL_Y, p.MIN_LABEL, { rank: p.POP_EST ?? 0 });
  });
}

function admin1Name(p) {
  if (p.iso_a2 === 'MX' && p.name === 'Distrito Federal') return 'Mexico City'; // name_en is just "Mexico"
  const name = clean(p.name_en) || clean(p.name);
  const stripped = name.replace(ADMIN1_SUFFIX, '');
  return stripped !== name && stripped.length >= 3 && !GENERIC_REMAINDER.test(stripped) ? stripped : name;
}

function admin1Rows(fc) {
  const out = [];
  for (const { properties: p, geometry: g } of fc.features) {
    if (!(p.min_label <= ADMIN1_MAX_MIN_LABEL)) continue;
    const name = admin1Name(p);
    let abbr = '';
    if (p.iso_a2 === 'US' || p.iso_a2 === 'CA') abbr = clean(p.postal);
    else if (p.iso_a2 === 'AU') abbr = AU_ABBR[name] ?? '';
    const lon = p.longitude ?? g?.coordinates?.[0];
    const lat = p.latitude ?? g?.coordinates?.[1];
    out.push(row('s', name, lon, lat, p.min_label, { abbr, rank: KIND_RANK_STATE - (p.labelrank ?? 9), city: CITY_TYPES.test(p.type_en ?? '') }));
  }
  return out;
}

function capitalFlags(p) {
  if (p.adm0cap === 1 || p.featurecla === 'Admin-0 capital') return 1;
  if (/^Admin-1 (?:region )?capital$|^Admin-0 region capital$/.test(p.featurecla ?? '')) return 2;
  return 0;
}

function placeRows(fc) {
  const out = [];
  for (const { properties: p, geometry: g } of fc.features) {
    if (!(p.min_zoom <= PLACE_MAX_MIN_ZOOM)) continue;
    const pop = Math.max(0, Math.round(p.pop_max ?? 0));
    const lon = p.longitude ?? g?.coordinates?.[0];
    const lat = p.latitude ?? g?.coordinates?.[1];
    out.push(row('p', clean(p.name), lon, lat, p.min_zoom, { pop, flags: capitalFlags(p), rank: pop }));
  }
  return out;
}

// One label point per polygon part (mapshaper's "inner" point, well inside the
// shape), with the part's area so the biggest piece of a body wins.
function innerPoints(features, work, tag) {
  const input = path.join(work, `${tag}.json`);
  const output = path.join(work, `${tag}-points.json`);
  writeFileSync(input, JSON.stringify({ type: 'FeatureCollection', features }));
  mapshaper('-i', input, '-explode', '-each', 'area_m2=this.area', '-points', 'inner', '-o', output, 'format=geojson');
  return JSON.parse(readFileSync(output, 'utf8')).features.filter((f) => f.geometry?.coordinates);
}

// Pieces sharing a name: keep the largest, plus any other piece at least a
// quarter its size and far away (the halves of the Pacific either side of the
// antimeridian), so a globe turned either way still shows one.
function pickWaterPieces(points) {
  const groups = new Map();
  for (const f of points) {
    const k = nameKey(f.properties.name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const out = [];
  for (const pieces of groups.values()) {
    pieces.sort((a, b) => b.properties.area_m2 - a.properties.area_m2);
    const kept = [];
    for (const f of pieces) {
      const [lon, lat] = f.geometry.coordinates;
      if (kept.length) {
        if (f.properties.area_m2 < 0.25 * kept[0].properties.area_m2) continue;
        const far = kept.every((k) => haversineKm(lon, lat, ...k.geometry.coordinates) >= 1500);
        if (!far) continue;
      }
      kept.push(f);
    }
    for (const f of kept) {
      const [lon, lat] = f.geometry.coordinates;
      out.push(row('w', f.properties.name, lon, lat, f.properties.mz, { rank: f.properties.area_m2 }));
    }
  }
  return out;
}

function marineName(p) {
  // Oceans: NE's name_en folds North/South Pacific into one "Pacific Ocean"; keep
  // the halves apart. River mouths: name_en drops "River" ("Amazon").
  if (p.featurecla === 'ocean' || p.featurecla === 'river') return titleCase(clean(p.name));
  const name = clean(p.name_en) || titleCase(clean(p.name));
  return MARINE_NAME_FIX[name] ?? name;
}

function waterRows(marine, lakes, work) {
  const features = [];
  for (const f of marine.features) {
    const p = f.properties;
    if (!(p.min_label <= MARINE_MAX_MIN_LABEL || p.scalerank <= MARINE_MAX_SCALERANK)) continue;
    const name = marineName(p);
    if (name) features.push({ type: 'Feature', geometry: f.geometry, properties: { name, mz: p.min_label } });
  }
  for (const f of lakes.features) {
    const p = f.properties;
    // name_en is the bare stem here ("Superior", "Nyanza"); name is "Lake Superior".
    const name = clean(p.name);
    if (!(p.scalerank <= LAKE_MAX_SCALERANK) || !name) continue;
    features.push({ type: 'Feature', geometry: f.geometry, properties: { name, mz: p.min_label ?? p.min_zoom } });
  }
  return pickWaterPieces(innerPoints(features, work, 'water'));
}

// ── GeoNames fill-in ─────────────────────────────────────────────────────────

function geonamesMinZoom(pop, capital) {
  const i = GN_BRACKETS.findIndex(([min]) => pop >= min);
  if (i < 0) return null;
  if (!capital) return GN_BRACKETS[i][1];
  return i === 0 ? GN_CAPITAL_TOP : GN_BRACKETS[i - 1][1];
}

function geonamesRows(zipBytes, nePlaces) {
  const entries = unzipSync(new Uint8Array(zipBytes));
  const file = Object.keys(entries).find((n) => n.endsWith('.txt'));
  if (!file) throw new Error('No .txt entry inside the GeoNames zip');
  const candidates = [];
  for (const line of Buffer.from(entries[file]).toString('utf8').split('\n')) {
    const c = line.split('\t');
    if (c.length < 15 || c[6] !== 'P' || GN_SKIP_CODES.has(c[7])) continue;
    const pop = Number(c[14]) || 0;
    const name = clean(c[1]);
    const minZoom = geonamesMinZoom(pop, c[7] === 'PPLC' || c[7] === 'PPLA');
    if (!name || minZoom === null) continue;
    const flags = c[7] === 'PPLC' ? 1 : c[7] === 'PPLA' ? 2 : 0;
    candidates.push(row('p', name, Number(c[5]), Number(c[4]), minZoom, { pop, flags, rank: pop }));
  }
  candidates.sort((a, b) => a.minZoom - b.minZoom || b.pop - a.pop);

  const neIndex = new PointIndex();
  for (const r of nePlaces) neIndex.add(r);
  const gnIndex = new PointIndex();
  const out = [];
  for (const c of candidates.filter(valid)) {
    const nearNe = neIndex.near(c.lon, c.lat, Math.max(DUP_KM, GN_SATELLITE_KM));
    if (nearNe.some(({ row: r, km }) => km <= GN_NEAR_NE_KM || (km <= DUP_KM && r.key === c.key))) continue;
    const nearGn = gnIndex.near(c.lon, c.lat, DUP_KM);
    if (nearGn.some(({ row: r, km }) => km <= GN_NEAR_GN_KM || r.key === c.key)) continue;
    if (nearNe.some(({ row: r, km }) => km <= GN_SATELLITE_KM && r.pop > c.pop)) {
      c.minZoom = r1(Math.min(PLACE_MAX_MIN_ZOOM, c.minZoom + 1));
    }
    gnIndex.add(c);
    out.push(c);
  }
  return out;
}

// ── Assembly ─────────────────────────────────────────────────────────────────

const compareRows = (a, b) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  a.minZoom - b.minZoom ||
  b.pop - a.pop ||
  b.rank - a.rank ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// Which of two same-name labels at one spot to keep: a city over the country
// or state it is the whole of (Singapore, Berlin), a country over a state.
const KEEP_ORDER = { p: 0, c: 1, s: 2, w: 3 };

// How close two same-name labels must be to count as one.
function mergeKm(a, b) {
  if (a.kind === b.kind || !(a.kind === 's' || b.kind === 's') || !(a.kind === 'p' || b.kind === 'p')) return DUP_KM;
  return (a.kind === 's' ? a : b).city ? CITY_STATE_KM : STATE_PLACE_KM;
}

function dedupe(rows) {
  const byKey = new Map();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  const dropped = new Set();
  const merges = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => KEEP_ORDER[a.kind] - KEEP_ORDER[b.kind] || compareRows(a, b));
    for (let i = 0; i < group.length; i++) {
      const keep = group[i];
      if (dropped.has(keep)) continue;
      for (let j = i + 1; j < group.length; j++) {
        const other = group[j];
        if (dropped.has(other)) continue;
        if (haversineKm(keep.lon, keep.lat, other.lon, other.lat) > mergeKm(keep, other)) continue;
        dropped.add(other);
        keep.minZoom = Math.min(keep.minZoom, other.minZoom);
        if (keep.kind === 'p' && other.kind === 'p') keep.flags |= other.flags;
        merges.push(`${other.kind}:${other.name} → ${keep.kind}:${keep.name}`);
      }
    }
  }
  return { rows: rows.filter((r) => !dropped.has(r)), merges };
}

const serialize = (r) => JSON.stringify([r.kind, r.name, r.lon, r.lat, r.minZoom, r.pop, r.flags, r.abbr]);
const document = (lines) => `{"v":1,"fields":${JSON.stringify(FIELDS)},"rows":[\n${lines.join(',\n')}\n]}\n`;

function verify(text) {
  const doc = JSON.parse(text);
  const problems = [];
  if (doc.v !== 1 || JSON.stringify(doc.fields) !== JSON.stringify(FIELDS)) problems.push('bad header');
  const index = new PointIndex();
  doc.rows.forEach((r, i) => {
    const [kind, name, lon, lat, minZoom, pop, flags, abbr] = r;
    if (r.length !== FIELDS.length) problems.push(`row ${i} has ${r.length} fields`);
    if (!(kind in KIND_ORDER)) problems.push(`row ${i} kind ${kind}`);
    if (typeof name !== 'string' || !name.trim()) problems.push(`row ${i} has an empty name`);
    if (!(Math.abs(lon) <= 180 && Math.abs(lat) <= 90)) problems.push(`row ${i} (${name}) at ${lon},${lat}`);
    if (!(minZoom >= 0 && minZoom <= 22)) problems.push(`row ${i} (${name}) minZoom ${minZoom}`);
    if (!Number.isInteger(pop) || pop < 0) problems.push(`row ${i} (${name}) pop ${pop}`);
    if (![0, 1, 2, 3].includes(flags) || typeof abbr !== 'string') problems.push(`row ${i} (${name}) flags/abbr`);
    const key = nameKey(String(name));
    // A state and the city it is named after may be 10–25 km apart (mergeKm).
    const statePlace = (o) => o.kind !== kind && [o.kind, kind].every((k) => k === 's' || k === 'p');
    const dup = index
      .near(lon, lat, DUP_KM)
      .find(({ row: o, km }) => o.key === key && (!statePlace(o) || km <= STATE_PLACE_KM));
    if (dup) problems.push(`"${name}" (${kind}) is within ${dup.km.toFixed(1)} km of "${dup.row.name}" (${dup.row.kind})`);
    index.add({ lon, lat, key, name, kind });
  });
  if (problems.length) throw new Error(`Output failed verification:\n${problems.slice(0, 30).join('\n')}`);
  return doc;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const work = mkdtempSync(path.join(tmpdir(), 'place-labels-'));
  try {
    console.log('Downloading sources');
    const names = Object.values(NE);
    const [neBytes, gnBytes] = await Promise.all([
      Promise.all(names.map((n) => download(`${NE_BASE}${n}.geojson`, args.cache))),
      args.geonames ? download(GEONAMES_URL, args.cache) : null,
    ]);
    const ne = Object.fromEntries(Object.keys(NE).map((k, i) => [k, JSON.parse(neBytes[i].toString('utf8'))]));

    const places = placeRows(ne.places).filter(valid);
    const base = [
      ...countryRows(ne.countries),
      ...admin1Rows(ne.admin1),
      ...waterRows(ne.marine, ne.lakes, work),
      ...places,
    ].filter(valid);
    const { rows, merges } = dedupe(base);
    console.log(`Merged ${merges.length} same-name labels at one spot (e.g. ${merges.slice(0, 6).join(', ')})`);

    let lines = rows.sort(compareRows).map(serialize);
    let gnAdded = 0;
    if (gnBytes) {
      // Most important first, until the file is full.
      const extra = geonamesRows(gnBytes, places).sort(compareRows);
      let bytes = Buffer.byteLength(document(lines));
      const keep = [];
      for (const r of extra) {
        const line = serialize(r);
        const add = Buffer.byteLength(line) + 2;
        if (bytes + add > MAX_BYTES) break;
        bytes += add;
        keep.push(r);
      }
      // A town can still share its name with a province or country around it.
      const merged = dedupe([...rows, ...keep]);
      const fromGeonames = new Set(keep);
      gnAdded = merged.rows.filter((r) => fromGeonames.has(r)).length;
      console.log(
        `GeoNames: ${extra.length} towns not in Natural Earth, kept ${gnAdded} ` +
          `(down to minZoom ${keep.at(-1)?.minZoom}, pop ${keep.at(-1)?.pop}; merged ${merged.merges.length} more)`
      );
      lines = merged.rows.sort(compareRows).map(serialize);
    }

    const text = document(lines);
    const doc = verify(text);
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);

    const counts = {};
    const zoom = {};
    for (const [kind, , , , mz] of doc.rows) {
      counts[kind] = (counts[kind] ?? 0) + 1;
      zoom[kind] = [Math.min(zoom[kind]?.[0] ?? 99, mz), Math.max(zoom[kind]?.[1] ?? 0, mz)];
    }
    console.log(
      `Wrote ${path.relative(ROOT, OUT)}: ${doc.rows.length} rows, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB ` +
        `(${Object.keys(KIND_ORDER).map((k) => `${k} ${counts[k] ?? 0} @ z${zoom[k]?.join('–')}`).join(', ')}; ` +
        `${gnAdded} places from GeoNames)`
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
