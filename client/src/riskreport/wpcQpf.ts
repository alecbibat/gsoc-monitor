import { QPF_LAYER } from '../layers/precip/precipStore';
import { MILES_TO_M } from '../lib/geo';
import { drawPin, drawRing, renderMapSnapshot } from './mapSnapshot';
import type { RiskTarget } from './riskTypes';

// ── WPC quantitative precipitation forecast, shared by every report ──────────
// The site chips and the regional map read the SAME MapServer, so the numbers
// and the picture can never disagree.

export const WPC_QPF_MAPSERVER =
  'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';

// WPC QPF at the property point, read from the SAME MapServer the rainfall map
// renders — the chip strip and the map must agree on source (a point forecast
// from a different model regularly disagrees with WPC and reads as a bug).
// Identify returns each window's contour polygon containing the point; an
// empty result set means the point is outside every contour (< 0.01 in).
// Attribute values arrive as strings.
export async function fetchWpcSiteQpf(
  lat: number,
  lon: number
): Promise<{ in24: number; in48: number; in72: number; in120: number }> {
  const layers = [QPF_LAYER['24h'], QPF_LAYER['48h'], QPF_LAYER['72h'], QPF_LAYER['5day']];
  const url =
    `${WPC_QPF_MAPSERVER}/identify?f=json&geometryType=esriGeometryPoint` +
    `&geometry=${lon.toFixed(4)},${lat.toFixed(4)}&sr=4326` +
    `&layers=all:${layers.join(',')}&tolerance=0&returnGeometry=false` +
    `&mapExtent=${(lon - 0.5).toFixed(2)},${(lat - 0.5).toFixed(2)},${(lon + 0.5).toFixed(2)},${(lat + 0.5).toFixed(2)}` +
    '&imageDisplay=400,400,96';
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`WPC identify HTTP ${res.status}`);
  const j = (await res.json()) as {
    results?: Array<{ layerId?: number; attributes?: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (j.error) throw new Error(`WPC identify: ${j.error.message ?? 'service error'}`);
  if (!Array.isArray(j.results)) throw new Error('WPC identify: malformed response');

  // The value field is named `qpf` today; scan defensively so a rename
  // degrades to the daily-forecast fallback instead of silently zeroing.
  const byLayer: Record<number, number> = {};
  let foundAny = false;
  for (const r of j.results) {
    if (r.layerId === undefined) continue;
    for (const [k, raw] of Object.entries(r.attributes ?? {})) {
      if (!/qpf/i.test(k)) continue;
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (!Number.isFinite(n)) continue;
      foundAny = true;
      // Nested contours stack — the highest containing value wins.
      byLayer[r.layerId] = Math.max(byLayer[r.layerId] ?? 0, n);
      break;
    }
  }
  if (j.results.length > 0 && !foundAny) throw new Error('WPC identify: no qpf attribute found');
  return {
    in24: byLayer[QPF_LAYER['24h']] ?? 0,
    in48: byLayer[QPF_LAYER['48h']] ?? 0,
    in72: byLayer[QPF_LAYER['72h']] ?? 0,
    in120: byLayer[QPF_LAYER['5day']] ?? 0,
  };
}

/**
 * Single 72 h accumulation map — the full multi-day picture in one image;
 * per-window site totals live in the chip strip above it (view-side).
 */
export function renderQpfSnapshot(target: RiskTarget, width: number, signal?: AbortSignal): Promise<string | null> {
  return renderMapSnapshot({
    centerLat: target.lat,
    centerLon: target.lon,
    fitRadiusM: 220 * MILES_TO_M,
    width,
    height: 380,
    signal,
    overlayAlpha: 0.68,
    overlayUrl: (proj) =>
      `${WPC_QPF_MAPSERVER}/export` +
      `?bbox=${proj.bbox3857.join(',')}` +
      `&bboxSR=3857&imageSR=3857&size=${proj.width},${proj.height}` +
      `&layers=show:${QPF_LAYER['72h']}` +
      '&format=png32&transparent=true&f=image',
    attribution: '© Esri © OSM · QPF NOAA/WPC',
    draw: (ctx, proj) => {
      // High-contrast ring: dark casing under a bright dashed stroke — the
      // faint cyan version disappeared against the QPF ramp.
      drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, {
        stroke: 'rgba(5,7,10,0.85)', width: 6,
      });
      drawRing(ctx, proj, target.lat, target.lon, 25 * MILES_TO_M, {
        stroke: '#ffffff', width: 2.5, dash: [8, 6], label: '25 mi',
      });
      drawPin(ctx, proj, target.lat, target.lon);
    },
  });
}
