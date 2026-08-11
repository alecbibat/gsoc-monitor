// Generates ../src/layers/ships/majorCities.ts — the packed major-city
// dataset for the fleet snapshot. Source: GeoNames "cities15000" via the
// all-the-cities@3.1.0 npm package (not a project dependency — install it
// ad hoc). Run from client/:
//   npm i --no-save all-the-cities@3.1.0 && node scripts/generate-major-cities.mjs
// Keep: national capitals (PPLC), cities with population >= 250k, and
// first-order admin seats (PPLA) with population >= 25k.
import cities from 'all-the-cities';
import { writeFileSync } from 'node:fs';

const countryName = new Intl.DisplayNames(['en'], { type: 'region' });

// GeoNames admin1 codes for Canadian provinces/territories -> postal abbrevs.
const CA_ADMIN = {
  '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL',
  '07': 'NS', '08': 'ON', '09': 'PE', '10': 'QC', '11': 'SK',
  '12': 'YT', '13': 'NT', '14': 'NU',
};

function regionOf(c) {
  if (c.country === 'US' && /^[A-Z]{2}$/.test(c.adminCode)) return c.adminCode;
  if (c.country === 'CA' && CA_ADMIN[c.adminCode]) return CA_ADMIN[c.adminCode];
  try {
    const n = countryName.of(c.country);
    if (n && n !== c.country) return n;
  } catch {
    /* fall through */
  }
  return null;
}

const keep = cities.filter(
  (c) =>
    c.featureCode === 'PPLC' ||
    c.population >= 250_000 ||
    (c.featureCode === 'PPLA' && c.population >= 25_000)
);

const rows = [];
const seen = new Set();
for (const c of keep) {
  const region = regionOf(c);
  if (!region) continue;
  // Display name: GeoNames writes "Washington, D.C." — keep only the part
  // before a comma so the rendered "name, region" never doubles up.
  const name = c.name.split(',')[0].trim();
  if (!name || /[\t\n\\`]|\$\{/.test(name) || /[\t\n\\`]|\$\{/.test(region)) continue;
  const [lon, lat] = c.loc.coordinates;
  const key = `${name}|${region}`;
  if (seen.has(key)) continue; // duplicate GeoNames entries (same city, two ids)
  seen.add(key);
  rows.push({ name, region, lat: lat.toFixed(2), lon: lon.toFixed(2) });
}
rows.sort((a, b) => (a.region + a.name).localeCompare(b.region + b.name, 'en'));

const body = rows.map((r) => `${r.name}\t${r.region}\t${r.lat}\t${r.lon}`).join('\n');

const out = `// Major world cities for the fleet snapshot's "nearest major city" context:
// national capitals, cities of 250k+ population, and first-order admin seats
// of 25k+ — worldwide, so every ship position resolves to a recognizable
// anchor no matter where the fleet is sailing.
//
// GENERATED FILE — do not hand-edit. Source: GeoNames "cities15000" via the
// all-the-cities@3.1.0 npm package (data CC BY 4.0, geonames.org — credited
// on the rendered snapshot). Row format: name \\t region \\t lat \\t lon,
// where region is the US state / Canadian province postal abbreviation or the
// English country name, and coordinates are degrees rounded to 0.01°.
// Regenerate with client/scripts/generate-major-cities.mjs (see its header
// for the one-line invocation).

export interface MajorCity {
  name: string;
  region: string; // "WA" / "BC" / "French Polynesia"
  lat: number;
  lon: number;
}

export interface NearestCity {
  city: MajorCity;
  distNm: number; // great-circle distance, nautical miles
  bearingDeg: number; // initial bearing from the city toward the query point
}

const ROWS = \`${body}\`;

let cache: MajorCity[] | null = null;

function majorCities(): MajorCity[] {
  if (cache) return cache;
  cache = ROWS.split('\\n').map((line) => {
    const [name, region, lat, lon] = line.split('\\t');
    return { name, region, lat: Number(lat), lon: Number(lon) };
  });
  return cache;
}

const EARTH_NM = 3440.065; // mean radius in nautical miles
const rad = (d: number): number => (d * Math.PI) / 180;

const haversineNm = (f1: number, f2: number, dl: number): number => {
  const sinHalfLat = Math.sin((f2 - f1) / 2);
  const sinHalfLon = Math.sin(dl / 2);
  const h = sinHalfLat * sinHalfLat + Math.cos(f1) * Math.cos(f2) * sinHalfLon * sinHalfLon;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Nearest major city to a position, by great-circle distance, with the
// bearing from that city toward the position (for "120 nm NE of Suva").
// Exact haversine scan over ~3k rows — well under a millisecond, and only
// run once per ship per snapshot.
export function nearestMajorCity(lat: number, lon: number): NearestCity | null {
  const f2 = rad(lat);
  let best: MajorCity | null = null;
  let bestDist = Infinity;
  for (const c of majorCities()) {
    const d = haversineNm(rad(c.lat), f2, rad(lon - c.lon));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (!best) return null;

  const f1 = rad(best.lat);
  const dl = rad(lon - best.lon);
  const bearing =
    (Math.atan2(
      Math.sin(dl) * Math.cos(f2),
      Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
    ) *
      180) /
      Math.PI;
  return { city: best, distNm: bestDist, bearingDeg: (bearing + 360) % 360 };
}
`;

writeFileSync(new URL('../src/layers/ships/majorCities.ts', import.meta.url), out);
console.log('rows:', rows.length, 'bytes:', Buffer.byteLength(out));
const spot = (n) => rows.filter((r) => r.name === n).map((r) => `${r.name}, ${r.region} @ ${r.lat},${r.lon}`);
for (const n of ['Papeete', 'Juneau', 'Suva', 'Barcelona', 'Anchorage', 'Reykjavík', 'Philipsburg', 'Bridgetown', 'Avarua'])
  console.log(n, '->', spot(n));
