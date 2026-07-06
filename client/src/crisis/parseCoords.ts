import type { DrawLayerPoint } from './crisisStore';

// Parses a blob of text containing lat/lon coordinate pairs into DrawLayerPoints.
//
// Accepted formats (one pair per line, or semicolon-separated):
//   37.7749, -122.4194              ← Google Maps right-click / decimal degrees
//   37.7749° N, 122.4194° W        ← with degree symbols and cardinal letters
//   37° 46' 29.5" N  122° 25' 16" W  ← DMS (degrees/minutes/seconds)
//   POINT (-122.4194 37.7749)       ← WKT (lon lat order, auto-detected)
//   LINESTRING (-122.4 37.7, -122.3 37.8)
//   POLYGON ((-122.4 37.7, -122.3 37.8, -122.5 37.6, -122.4 37.7))

// Convert DMS string like "37° 46' 29.5"" → decimal degrees
function dmsToDecimal(deg: number, min: number, sec: number): number {
  return deg + min / 60 + sec / 3600;
}

// Extract the first floating-point number from a string segment and advance pos.
// Returns null if nothing found.
function extractNumber(text: string): number | null {
  const m = text.match(/^-?\d+(?:\.\d*)?/);
  return m ? parseFloat(m[0]) : null;
}

// Parse one segment of text as a latitude or longitude value.
// Handles plain decimals and DMS like "37° 46' 29.5"".
function parseCoordValue(seg: string): { val: number; dir: string } | null {
  const s = seg.trim();

  // Plain signed decimal: -122.4194
  const plain = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew]?)$/);
  if (plain) {
    return { val: parseFloat(plain[1]), dir: plain[2].toUpperCase() };
  }

  // DMS: 37° 46' 29.5" N  or  37°46'29.5"N
  const dms = s.match(
    /^(\d+)\s*°\s*(\d+)\s*['']\s*(\d+(?:\.\d+)?)\s*[""]?\s*([NSEWnsew]?)$/
  );
  if (dms) {
    const val = dmsToDecimal(parseFloat(dms[1]), parseFloat(dms[2]), parseFloat(dms[3]));
    return { val, dir: dms[4].toUpperCase() };
  }

  // DMS without seconds: 37° 46' N
  const dm = s.match(/^(\d+)\s*°\s*(\d+(?:\.\d+)?)\s*['']\s*([NSEWnsew]?)$/);
  if (dm) {
    const val = dmsToDecimal(parseFloat(dm[1]), parseFloat(dm[2]), 0);
    return { val, dir: dm[3].toUpperCase() };
  }

  return null;
}

// Resolve lat/lon from a pair of parsed coordinate values.
// Uses direction letters (N/S/E/W) when present; otherwise assumes lat-first.
function resolvePair(
  a: { val: number; dir: string },
  b: { val: number; dir: string }
): DrawLayerPoint | null {
  let lat: number | null = null;
  let lon: number | null = null;

  // Direction letters present — use them to assign lat/lon
  if (a.dir === 'N' || a.dir === 'S') { lat = a.dir === 'S' ? -Math.abs(a.val) : Math.abs(a.val); }
  if (a.dir === 'E' || a.dir === 'W') { lon = a.dir === 'W' ? -Math.abs(a.val) : Math.abs(a.val); }
  if (b.dir === 'N' || b.dir === 'S') { lat = b.dir === 'S' ? -Math.abs(b.val) : Math.abs(b.val); }
  if (b.dir === 'E' || b.dir === 'W') { lon = b.dir === 'W' ? -Math.abs(b.val) : Math.abs(b.val); }

  // No direction letters — assume first = lat, second = lon
  if (lat === null && lon === null) {
    lat = a.val;
    lon = b.val;
  }

  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Split a raw line into coordinate segment tokens.
// Handles common delimiters: comma, semicolon, whitespace (preserving DMS spaces).
// WKT mode splits on ANY whitespace — WKT pairs are "lon lat" with a single
// space, which the generic path deliberately doesn't split (it would break DMS).
function splitLine(line: string, wktMode = false): string[] {
  if (wktMode) {
    return line.replace(/[()]/g, ' ').split(/\s+/).map((s) => s.trim()).filter(Boolean);
  }
  // Try splitting on comma first (most common: "lat, lon")
  const byComma = line.split(',').map((s) => s.trim()).filter(Boolean);
  if (byComma.length >= 2) return byComma;
  // Fall back to splitting on 2+ spaces or tab
  return line.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
}

// Detect WKT and extract raw coordinate text from it.
// WKT uses "lon lat" order — we set a flag so callers can swap.
function extractWkt(raw: string): { text: string; lonLatOrder: boolean } | null {
  const upper = raw.trim().toUpperCase();
  if (
    upper.startsWith('POINT') ||
    upper.startsWith('LINESTRING') ||
    upper.startsWith('POLYGON') ||
    upper.startsWith('MULTIPOINT') ||
    upper.startsWith('MULTILINESTRING') ||
    upper.startsWith('MULTIPOLYGON')
  ) {
    // Strip WKT keyword and outer parens
    const inner = raw.replace(/^[A-Z\s]+/i, '').replace(/^\(+|\)+$/g, '').trim();
    return { text: inner, lonLatOrder: true };
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ParseResult {
  points: DrawLayerPoint[];
  error: string | null;
}

export function parseCoords(raw: string): ParseResult {
  if (!raw.trim()) return { points: [], error: null };

  // Check for WKT
  const wkt = extractWkt(raw.trim());
  const lonLatOrder = wkt?.lonLatOrder ?? false;
  const text = wkt ? wkt.text : raw;

  // Split into candidate lines. WKT separates "lon lat" pairs with commas;
  // free-form input separates pairs with newlines or semicolons.
  const lines = (wkt ? text.split(/[,;\n]+/) : text.split(/[\n;]+/))
    .map((l) => l.trim())
    .filter(Boolean);

  const points: DrawLayerPoint[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    const segs = splitLine(line, !!wkt);
    if (segs.length < 2) {
      // Could be a single "37.7749" token — skip
      continue;
    }

    // Take first two segments as a pair
    const a = parseCoordValue(segs[0]);
    const b = parseCoordValue(segs[1]);

    if (!a || !b) {
      errors.push(`Could not parse: "${line}"`);
      continue;
    }

    const pt = resolvePair(lonLatOrder ? b : a, lonLatOrder ? a : b);
    if (!pt) {
      errors.push(`Out of range: "${line}"`);
      continue;
    }
    points.push(pt);
  }

  if (points.length === 0 && lines.length > 0) {
    return { points: [], error: errors[0] ?? 'No valid coordinates found.' };
  }

  const error =
    errors.length > 0
      ? `${errors.length} line(s) skipped — ${errors[0]}`
      : null;

  return { points, error };
}
