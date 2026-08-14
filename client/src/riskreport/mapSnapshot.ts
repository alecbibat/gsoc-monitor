// ── Canvas map snapshots for the risk report ─────────────────────────────────
// Small, deterministic map images rendered off-DOM: CARTO dark tiles as the
// base, optional ArcGIS export overlays (LANDFIRE fuels, WPC QPF) fetched for
// the exact canvas bbox, and vector overlays (rings, hotspots, alert polygons)
// drawn on top. Result is a data-URL <img>, which both the on-screen report
// and the print pipeline handle natively. Every network piece is best-effort:
// failed tiles leave dark background, a fully failed snapshot returns null and
// the report simply omits that map.

const TILE = 256;
const SUBDOMAINS = ['a', 'b', 'c', 'd'];
const BASE_URL = (s: string, z: number, x: number, y: number) =>
  `https://${s}.basemaps.cartocdn.com/dark_nolabels/${z}/${x}/${y}.png`;
const LABELS_URL = (s: string, z: number, x: number, y: number) =>
  `https://${s}.basemaps.cartocdn.com/dark_only_labels/${z}/${x}/${y}.png`;

const MERC_MAX = 20037508.342789244;

const lonToMercX = (lon: number) => (lon * MERC_MAX) / 180;
const latToMercY = (lat: number) => {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return (Math.log(Math.tan(((90 + clamped) * Math.PI) / 360)) / Math.PI) * MERC_MAX;
};

/** Geodesic destination point (spherical earth) — for drawing radius rings. */
export function destPoint(lat: number, lon: number, bearingDeg: number, distM: number): { lat: number; lon: number } {
  const R = 6_371_000;
  const br = (bearingDeg * Math.PI) / 180;
  const la1 = (lat * Math.PI) / 180;
  const lo1 = (lon * Math.PI) / 180;
  const dr = distM / R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(
    Math.sin(br) * Math.sin(dr) * Math.cos(la1),
    Math.cos(dr) - Math.sin(la1) * Math.sin(la2)
  );
  return { lat: (la2 * 180) / Math.PI, lon: ((((lo2 * 180) / Math.PI) + 540) % 360) - 180 };
}

export interface SnapshotProjection {
  /** lon/lat → canvas pixel coordinates. */
  toXY: (lon: number, lat: number) => [number, number];
  width: number;
  height: number;
  /** Canvas bbox in EPSG:3857 metres (xmin, ymin, xmax, ymax). */
  bbox3857: [number, number, number, number];
}

export interface SnapshotOptions {
  centerLat: number;
  centerLon: number;
  /** The view is zoomed so a circle of this radius fits comfortably. */
  fitRadiusM: number;
  width: number;
  height: number;
  /** ArcGIS export URL builders given the bbox/size — drawn over the base. */
  overlayUrl?: (proj: SnapshotProjection) => string;
  overlayAlpha?: number;
  /** Vector drawing pass, on top of everything. */
  draw?: (ctx: CanvasRenderingContext2D, proj: SnapshotProjection) => void;
  /** Render the CARTO labels layer above overlays (default true). */
  labels?: boolean;
  attribution?: string;
}

function loadImage(url: string, timeoutMs = 12_000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

export async function renderMapSnapshot(opts: SnapshotOptions): Promise<string | null> {
  try {
    const { centerLat, centerLon, fitRadiusM, width, height } = opts;
    const scale = 2; // retina
    const w = width * scale;
    const h = height * scale;

    // Pick the zoom where the fit radius spans ~38% of the canvas width.
    const metersPerPxAt = (z: number) =>
      (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** z;
    let zoom = 3;
    for (let z = 15; z >= 3; z--) {
      if (fitRadiusM / metersPerPxAt(z) <= w * 0.38) { zoom = z; break; }
    }

    const mpp = metersPerPxAt(zoom);
    const cx = lonToMercX(centerLon);
    const cy = latToMercY(centerLat);
    const bbox3857: [number, number, number, number] = [
      cx - (w / 2) * mpp, cy - (h / 2) * mpp,
      cx + (w / 2) * mpp, cy + (h / 2) * mpp,
    ];
    const proj: SnapshotProjection = {
      width: w,
      height: h,
      bbox3857,
      toXY: (lon, lat) => [
        (lonToMercX(lon) - bbox3857[0]) / mpp,
        (bbox3857[3] - latToMercY(lat)) / mpp,
      ],
    };

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, w, h);

    // Base tiles (and labels): tile pixel-space anchored at the bbox corner.
    // World tile coords at this zoom: worldPx = (merc + MERC_MAX) / mpp… use
    // the standard slippy transform instead for exactness.
    const worldPx = (TILE * 2 ** zoom);
    const px = (lon: number) => ((lon + 180) / 360) * worldPx;
    const py = (lat: number) => {
      const s = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
      return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx;
    };
    // Snapshot pixels are `scale`-denser than slippy pixels at this zoom? No:
    // we chose mpp AT this zoom for the retina canvas directly, so one canvas
    // px = one slippy px. Anchor: canvas (0,0) corresponds to slippy point of
    // the bbox's top-left.
    const originX = px(centerLon) - w / 2;
    const originY = py(centerLat) - h / 2;

    const x0 = Math.floor(originX / TILE);
    const y0 = Math.floor(originY / TILE);
    const x1 = Math.floor((originX + w) / TILE);
    const y1 = Math.floor((originY + h) / TILE);
    const maxTile = 2 ** zoom;

    const tileJobs: Promise<void>[] = [];
    const layers: Array<(s: string, z: number, x: number, y: number) => string> =
      opts.labels === false ? [BASE_URL] : [BASE_URL, LABELS_URL];

    const drawTile = async (urlOf: typeof BASE_URL, tx: number, ty: number, dx: number, dy: number) => {
      if (ty < 0 || ty >= maxTile) return;
      const wrapped = ((tx % maxTile) + maxTile) % maxTile;
      const sub = SUBDOMAINS[(wrapped + ty) % SUBDOMAINS.length];
      const img = await loadImage(urlOf(sub, zoom, wrapped, ty));
      if (img) ctx.drawImage(img, dx, dy, TILE, TILE);
    };

    // Base first, awaited fully before labels/overlays for correct stacking.
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        tileJobs.push(drawTile(BASE_URL, tx, ty, tx * TILE - originX, ty * TILE - originY));
      }
    }
    await Promise.allSettled(tileJobs);

    // ArcGIS export overlay for the exact bbox.
    if (opts.overlayUrl) {
      const overlay = await loadImage(opts.overlayUrl(proj), 20_000);
      if (overlay) {
        ctx.globalAlpha = opts.overlayAlpha ?? 0.72;
        ctx.drawImage(overlay, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    // Labels above overlays so place names stay readable.
    if (layers.includes(LABELS_URL)) {
      const labelJobs: Promise<void>[] = [];
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          labelJobs.push(drawTile(LABELS_URL, tx, ty, tx * TILE - originX, ty * TILE - originY));
        }
      }
      await Promise.allSettled(labelJobs);
    }

    if (opts.draw) opts.draw(ctx, proj);

    // Attribution strip.
    ctx.font = `${10 * scale}px Inter, sans-serif`;
    const attr = opts.attribution ?? '© CARTO © OpenStreetMap contributors';
    const tw = ctx.measureText(attr).width;
    ctx.fillStyle = 'rgba(5,7,10,0.7)';
    ctx.fillRect(w - tw - 12 * scale, h - 16 * scale, tw + 12 * scale, 16 * scale);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(attr, w - tw - 6 * scale, h - 5 * scale);

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('[risk-report] map snapshot failed:', e);
    return null;
  }
}

// ── Shared vector drawing helpers ────────────────────────────────────────────

export function drawRing(
  ctx: CanvasRenderingContext2D,
  proj: SnapshotProjection,
  lat: number, lon: number, radiusM: number,
  style: { stroke: string; width?: number; dash?: number[]; label?: string }
) {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const p = destPoint(lat, lon, (i / 72) * 360, radiusM);
    const [x, y] = proj.toXY(p.lon, p.lat);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width ?? 2;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.stroke();
  if (style.label) {
    const top = destPoint(lat, lon, 0, radiusM);
    const [x, y] = proj.toXY(top.lon, top.lat);
    ctx.setLineDash([]);
    ctx.font = '600 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(5,7,10,0.75)';
    const tw = ctx.measureText(style.label).width;
    ctx.fillRect(x - tw / 2 - 6, y - 24, tw + 12, 26);
    ctx.fillStyle = style.stroke;
    ctx.fillText(style.label, x, y - 4);
  }
  ctx.restore();
}

export function drawPin(
  ctx: CanvasRenderingContext2D,
  proj: SnapshotProjection,
  lat: number, lon: number,
  color = '#3ddcff'
) {
  const [x, y] = proj.toXY(lon, lat);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * A fire-hotspot flame marker: soft orange glow, red-orange flame body with a
 * flickering tip, yellow inner core. `r` is the flame's half-height.
 */
export function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();

  // Glow
  const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.9);
  glow.addColorStop(0, 'rgba(255,120,40,0.5)');
  glow.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
  ctx.fill();

  // Flame body — teardrop with a leaning tip
  const flame = (scale: number, fill: string) => {
    const h = r * 2 * scale;
    const w = r * 1.25 * scale;
    const baseY = y + r * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, baseY - h);                       // tip
    ctx.bezierCurveTo(x + w * 0.15, baseY - h * 0.75, x + w * 0.62, baseY - h * 0.62, x + w * 0.5, baseY - h * 0.28);
    ctx.bezierCurveTo(x + w * 0.62, baseY - h * 0.1, x + w * 0.4, baseY, x, baseY);
    ctx.bezierCurveTo(x - w * 0.55, baseY, x - w * 0.62, baseY - h * 0.35, x - w * 0.38, baseY - h * 0.55);
    ctx.bezierCurveTo(x - w * 0.25, baseY - h * 0.72, x - w * 0.08, baseY - h * 0.85, x, baseY - h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  flame(1, '#ff4d1c');
  ctx.stroke();
  flame(0.55, '#ffb020');
  flame(0.28, '#ffe66b');

  ctx.restore();
}

export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  proj: SnapshotProjection,
  rings: number[][][],
  style: { fill: string; stroke: string; width?: number }
) {
  ctx.save();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => {
      const [x, y] = proj.toXY(lon, lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width ?? 2;
    ctx.stroke();
  }
  ctx.restore();
}
