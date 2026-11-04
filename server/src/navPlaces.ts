import { AIRPORT_ROWS } from './data/airports';
import { PORT_ROWS } from './data/ports';

// ── Airport and port lookup ──────────────────────────────────────────────────
// Names the place a tracked aircraft took off from / landed at, or a tracked
// ship arrived at / left. The tables are generated (scripts/build-nav-places.mjs)
// and parsed on first use into a 1°-cell grid, so a lookup scans a handful of
// cells instead of ~25k rows.

export interface Airport {
  /** ICAO code where there is one ("KAPA"), else the OurAirports ident. */
  ident: string;
  iata: string | null;
  name: string;
  municipality: string | null;
  /** US state / Canadian province code, else the ISO country code. */
  region: string;
  country: string;
  lat: number;
  lon: number;
}

export interface Port {
  name: string;
  /** ISO country code. */
  country: string;
  locode: string | null;
  lat: number;
  lon: number;
  /** A Windstar port of call: preferred over a nearer gazetteer entry. */
  preferred: boolean;
}

export interface Nearest<T> {
  place: T;
  distanceKm: number;
}

const EARTH_KM = 6371.0088;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Places bucketed by 1° cell; nearest() scans only the cells within reach. */
export class GridIndex<T extends { lat: number; lon: number }> {
  private cells = new Map<string, T[]>();

  constructor(items: Iterable<T>) {
    for (const it of items) {
      const k = GridIndex.key(Math.floor(it.lat), Math.floor(it.lon));
      const cell = this.cells.get(k);
      if (cell) cell.push(it);
      else this.cells.set(k, [it]);
    }
  }

  private static key(latCell: number, lonCell: number): string {
    // Wrap longitude cells so a search near ±180° looks across the line.
    const lon = ((lonCell % 360) + 540) % 360 - 180;
    return `${latCell}:${lon}`;
  }

  /** Every place within maxKm, nearest first. */
  within(lat: number, lon: number, maxKm: number): Nearest<T>[] {
    const dLat = Math.ceil(maxKm / 111);
    const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const dLon = Math.min(180, Math.ceil(maxKm / (111 * cos)));
    const latCell = Math.floor(lat);
    const lonCell = Math.floor(lon);
    const out: Nearest<T>[] = [];
    const seen = new Set<string>();
    for (let i = latCell - dLat; i <= latCell + dLat; i++) {
      if (i < -90 || i > 89) continue;
      for (let j = lonCell - dLon; j <= lonCell + dLon; j++) {
        const k = GridIndex.key(i, j);
        if (seen.has(k)) continue;
        seen.add(k);
        for (const it of this.cells.get(k) ?? []) {
          const d = haversineKm(lat, lon, it.lat, it.lon);
          if (d <= maxKm) out.push({ place: it, distanceKm: d });
        }
      }
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  nearest(lat: number, lon: number, maxKm: number): Nearest<T> | null {
    return this.within(lat, lon, maxKm)[0] ?? null;
  }
}

function rowsOf(packed: string): string[][] {
  return packed.split('\n').filter(Boolean).map((line) => line.split('\t'));
}

let airports: GridIndex<Airport> | null = null;
let ports: GridIndex<Port> | null = null;

function airportIndex(): GridIndex<Airport> {
  airports ??= new GridIndex(
    rowsOf(AIRPORT_ROWS).map(([ident, iata, name, municipality, region, country, lat, lon]) => ({
      ident,
      iata: iata || null,
      name,
      municipality: municipality || null,
      region,
      country,
      lat: Number(lat),
      lon: Number(lon),
    }))
  );
  return airports;
}

function portIndex(): GridIndex<Port> {
  ports ??= new GridIndex(
    rowsOf(PORT_ROWS).map(([name, country, locode, lat, lon, preferred]) => ({
      name,
      country,
      locode: locode || null,
      lat: Number(lat),
      lon: Number(lon),
      preferred: preferred === '1',
    }))
  );
  return ports;
}

/**
 * The airport a takeoff or landing at this position used: the nearest field
 * with a jet-length runway within maxKm (a takeoff is first seen airborne a
 * few km past the runway end), or null.
 */
export function nearestAirport(lat: number, lon: number, maxKm = 10): Nearest<Airport> | null {
  return airportIndex().nearest(lat, lon, maxKm);
}

// How much farther a Windstar port of call may be than the nearest gazetteer
// entry and still name the stop.
const PREFERRED_SLACK_KM = 8;

/**
 * The port a ship stopped at this position is calling at: the nearest port
 * within maxKm, except that a Windstar port of call up to PREFERRED_SLACK_KM
 * farther wins (an anchorage reads as the bay the ship is in, not the harbour
 * town across the water). Null when nothing is within maxKm.
 */
export function nearestPort(lat: number, lon: number, maxKm = 15): Nearest<Port> | null {
  const all = portIndex().within(lat, lon, maxKm);
  const first = all[0];
  if (!first) return null;
  const preferred = all.find((n) => n.place.preferred);
  return preferred && preferred.distanceKm <= first.distanceKm + PREFERRED_SLACK_KM ? preferred : first;
}
