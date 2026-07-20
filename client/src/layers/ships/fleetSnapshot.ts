// Daily fleet-position snapshot: renders every tracked Windstar ship onto a
// coastline map with a geocoded "where is it" label per ship, plus a table of
// dock/transit status, destination and ETA — then copies the result to the
// clipboard as a PNG for pasting straight into the daily digest email.
//
// The renderer is pure canvas (no DOM, no tiles, no external requests at draw
// time) so the image is identical regardless of globe state, and works even
// when the ships layer is toggled off.
import type { ShipState } from '../../types';
import { api } from '../../api/client';
import { FLEET_ROSTER, fleetColor, type FleetRosterShip } from './fleet';
import { landRings } from './worldLand';

// ---------------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------------

export type StatusKind = 'docked' | 'anchored' | 'underway' | 'alert' | 'unknown';

export interface SnapshotRow {
  roster: FleetRosterShip;
  ship: ShipState | null; // null = no position received yet
  place: string | null; // reverse-geocoded context ("Papeete, French Polynesia")
}

// Abnormal AIS statuses must never be dressed up as routine by the speed
// heuristic — a digest that shows an aground ship as "In port" is worse than
// no digest.
const ALERT_STATUS: Record<number, string> = {
  2: 'Not under command',
  3: 'Restricted maneuv.',
  4: 'Constrained',
  6: 'Aground',
};

export function statusOf(s: ShipState): { kind: StatusKind; label: string } {
  if (s.navStatus != null && ALERT_STATUS[s.navStatus]) {
    return { kind: 'alert', label: ALERT_STATUS[s.navStatus] };
  }
  if (s.navStatus === 5) return { kind: 'docked', label: 'Docked' };
  if (s.navStatus === 1) return { kind: 'anchored', label: 'At anchor' };
  if (s.navStatus === 0) return { kind: 'underway', label: 'Underway' };
  if (s.navStatus === 8) return { kind: 'underway', label: 'Under sail' };
  if (s.speedKt != null) {
    return s.speedKt > 0.7
      ? { kind: 'underway', label: 'Underway' }
      : { kind: 'docked', label: 'In port' };
  }
  return { kind: 'unknown', label: 'Last known' };
}

// AbortSignal.timeout with a fallback for engines that predate it (pre-2022).
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// Reverse geocode one position via BigDataCloud (free, keyless — same service
// the screensaver context boxes use). Falls back to the named water body over
// open ocean; null on any failure.
async function placeName(lat: number, lon: number, signal: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal }
    );
    if (!r.ok) return null;
    const d = (await r.json()) as {
      city?: string;
      locality?: string;
      principalSubdivisionCode?: string;
      countryCode?: string;
      countryName?: string;
      localityInfo?: { informative?: Array<{ name?: string; description?: string }> };
    };
    const parts: string[] = [];
    if (d.city) parts.push(d.city);
    else if (d.locality) parts.push(d.locality);
    if (d.countryCode === 'US' || d.countryCode === 'CA') {
      if (d.principalSubdivisionCode) parts.push(d.principalSubdivisionCode);
    } else if (d.countryName) {
      parts.push(d.countryName);
    }
    if (parts.length) return parts.join(', ');
    // Open ocean: the informative list runs broad → specific, so scan backwards
    // for the most specific named water body.
    const inf = d.localityInfo?.informative;
    if (Array.isArray(inf)) {
      for (let i = inf.length - 1; i >= 0; i--) {
        const nm = inf[i]?.name;
        if (typeof nm === 'string' && /ocean|sea|gulf|bay|strait|channel|passage|sound/i.test(nm)) {
          return nm;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function assembleRows(): Promise<SnapshotRow[]> {
  // Bounded wait so a wedged server can't pin the button in "Rendering…".
  const data = await Promise.race([
    api.ships(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Ship feed timed out')), 20_000)
    ),
  ]);
  if (data.source === 'no-key') {
    throw new Error('No ship position source configured on the server');
  }
  const rows: SnapshotRow[] = FLEET_ROSTER.map((roster) => ({
    roster,
    ship: data.ships.find((s) => s.mmsi === roster.mmsi) ?? null,
    place: null,
  }));
  await Promise.allSettled(
    rows.map(async (row) => {
      if (!row.ship) return;
      row.place = await placeName(row.ship.latitude, row.ship.longitude, timeoutSignal(7_000));
    })
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const fmtCoord = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

const fmtAge = (sec: number): string => {
  if (sec < 90) return 'just now';
  if (sec < 5400) return `${Math.round(sec / 60)}m ago`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
};

// AIS destinations arrive SHOUTING ("PAPEETE"); soften only all-caps strings.
const prettyDestination = (s: string): string =>
  s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s./>-])([a-z])/g, (m, sep, c) => sep + c.toUpperCase())
    : s;

const utcFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const denverFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
const denverStampFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
const utcStampFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// ---------------------------------------------------------------------------
// Map window (equirectangular) — smallest circular-longitude window that holds
// the fleet, aspect-matched to the map panel, clamped so tiny clusters don't
// zoom past what the 1:50m coastline can support.
// ---------------------------------------------------------------------------

interface MapWindow {
  lonMin: number; // west edge; east edge = lonMin + lonSpan (may exceed 180)
  lonSpan: number;
  latMin: number;
  latSpan: number;
}

function fitWindow(
  points: Array<{ lat: number; lon: number }>,
  mapW: number,
  mapH: number
): MapWindow {
  const aspect = mapH / mapW; // degrees lat per degree lon on an equirect map
  if (points.length === 0) {
    const lonSpan = 360;
    return { lonMin: -180, lonSpan, latMin: -65, latSpan: Math.min(150, lonSpan * aspect) };
  }

  // Smallest circular window over the longitudes: complement of the largest gap.
  const lons = points.map((p) => ((p.lon + 540) % 360) - 180).sort((a, b) => a - b);
  let gapStart = lons[lons.length - 1];
  let gapSize = lons[0] + 360 - gapStart;
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1];
    if (g > gapSize) {
      gapSize = g;
      gapStart = lons[i - 1];
    }
  }
  let lonMin = gapStart + gapSize; // first ship going east
  let lonSpan = 360 - gapSize;

  const lats = points.map((p) => p.lat);
  let latLo = Math.min(...lats);
  let latHi = Math.max(...lats);

  // Padding, then floor the zoom (a one-port fleet still gets a regional view).
  const lonPad = Math.max(2.5, lonSpan * 0.18);
  lonMin -= lonPad;
  lonSpan += lonPad * 2;
  const latPad = Math.max(1.2, (latHi - latLo) * 0.18);
  latLo -= latPad;
  latHi += latPad;
  if (lonSpan < 10) {
    lonMin -= (10 - lonSpan) / 2;
    lonSpan = 10;
  }
  lonSpan = Math.min(360, lonSpan);

  // Fit latitude to the panel aspect: grow whichever direction is short.
  let latSpan = latHi - latLo;
  const idealLat = lonSpan * aspect;
  if (idealLat >= latSpan) {
    const grow = idealLat - latSpan;
    latLo -= grow / 2;
    latSpan = idealLat;
  } else {
    const grown = latSpan / aspect;
    if (grown <= 360) {
      lonMin -= (grown - lonSpan) / 2;
      lonSpan = grown;
      latSpan = lonSpan * aspect;
    } else {
      // Can't widen past the full globe — keep the fleet's latitude extent and
      // accept a vertically stretched projection rather than cropping the
      // northernmost ship off the panel.
      lonMin -= (360 - lonSpan) / 2;
      lonSpan = 360;
    }
  }

  // Keep the window on the globe vertically.
  if (latLo < -82) latLo = -82;
  if (latLo + latSpan > 86) latLo = 86 - latSpan;
  if (latLo < -82) {
    latLo = -82;
    latSpan = 168;
  }

  // Normalize the west edge into [-180, 180) so the land-drawing offset sweep
  // has a bounded range to cover.
  lonMin = ((lonMin + 540) % 360) - 180;

  return { lonMin, lonSpan, latMin: latLo, latSpan };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const SANS = '"Inter", ui-sans-serif, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace';

const C = {
  bg: '#0a0e14',
  panel: '#0d141d',
  panelBorder: 'rgba(255,255,255,0.09)',
  land: '#2b3a4a',
  landStroke: '#5c7891',
  graticule: 'rgba(255,255,255,0.045)',
  ink: 'rgba(255,255,255,0.92)',
  ink2: 'rgba(255,255,255,0.60)',
  ink3: 'rgba(255,255,255,0.38)',
  accent: '#3ddcff',
  warn: '#ffb84d',
};

interface RingBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}
let ringBoxCache: RingBox[] | null = null;
function ringBoxes(): RingBox[] {
  if (ringBoxCache) return ringBoxCache;
  ringBoxCache = landRings().map((ring) => {
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    for (let i = 0; i < ring.length; i += 2) {
      if (ring[i] < minLon) minLon = ring[i];
      if (ring[i] > maxLon) maxLon = ring[i];
      if (ring[i + 1] < minLat) minLat = ring[i + 1];
      if (ring[i + 1] > maxLat) maxLat = ring[i + 1];
    }
    return { minLon, maxLon, minLat, maxLat };
  });
  return ringBoxCache;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Logical layout constants (canvas is drawn at 2x for crispness).
const SCALE = 2;
const W = 1520;
const PAD = 44;
const MAP_H = 560;
const ROW_H = 48;
const TABLE_HEAD_H = 34;

export function renderFleetSnapshot(rows: SnapshotRow[], generatedAt: number): HTMLCanvasElement {
  const live = rows.filter((r): r is SnapshotRow & { ship: ShipState } => r.ship !== null);
  const headerH = 104;
  const mapY = headerH;
  const tableY = mapY + MAP_H + 26;
  const tableH = TABLE_HEAD_H + rows.length * ROW_H;
  const footerH = 46;
  const H = tableY + tableH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'middle';

  // ---- background -----------------------------------------------------------
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ---- header ---------------------------------------------------------------
  const kinds = live.map((r) => statusOf(r.ship).kind);
  const underway = kinds.filter((k) => k === 'underway').length;
  const inPort = kinds.filter((k) => k === 'docked' || k === 'anchored').length;
  const alerts = kinds.filter((k) => k === 'alert').length;
  const unknown = kinds.filter((k) => k === 'unknown').length;
  ctx.fillStyle = C.ink;
  ctx.font = `700 23px ${SANS}`;
  ctx.fillText('Windstar Fleet — Daily Position Snapshot', PAD, 40);
  ctx.font = `400 13px ${SANS}`;
  ctx.fillStyle = C.ink2;
  const summary = [
    `${live.length} of ${rows.length} ships reporting`,
    `${underway} underway`,
    `${inPort} in port / at anchor`,
    ...(alerts > 0 ? [`${alerts} status alert`] : []),
    ...(unknown > 0 ? [`${unknown} last-known only`] : []),
  ].join('   ·   ');
  ctx.fillText(summary, PAD, 70);

  ctx.textAlign = 'right';
  ctx.font = `500 13px ${SANS}`;
  ctx.fillStyle = C.ink2;
  ctx.fillText(denverStampFmt.format(generatedAt), W - PAD, 40);
  ctx.font = `400 12px ${MONO}`;
  ctx.fillStyle = C.ink3;
  ctx.fillText(`${utcStampFmt.format(generatedAt)} UTC`, W - PAD, 70);
  ctx.textAlign = 'left';

  // ---- map panel ------------------------------------------------------------
  const mapX = PAD;
  const mapW = W - PAD * 2;
  roundedRect(ctx, mapX, mapY, mapW, MAP_H, 12);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.strokeStyle = C.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  roundedRect(ctx, mapX, mapY, mapW, MAP_H, 12);
  ctx.clip();

  const win = fitWindow(
    live.map((r) => ({ lat: r.ship.latitude, lon: r.ship.longitude })),
    mapW,
    MAP_H
  );
  const px = (lon: number): number => mapX + ((lon - win.lonMin) / win.lonSpan) * mapW;
  const py = (lat: number): number =>
    mapY + ((win.latMin + win.latSpan - lat) / win.latSpan) * MAP_H;

  // Land — draw each ring at every 360° offset that intersects the window.
  const rings = landRings();
  const boxes = ringBoxes();
  const lonMax = win.lonMin + win.lonSpan;
  const latMax = win.latMin + win.latSpan;
  ctx.fillStyle = C.land;
  ctx.strokeStyle = C.landStroke;
  ctx.lineWidth = 0.9;
  const pxPerLon = mapW / win.lonSpan;
  const pxPerLat = MAP_H / win.latSpan;
  for (let i = 0; i < rings.length; i++) {
    const b = boxes[i];
    if (b.maxLat < win.latMin || b.minLat > latMax) continue;
    // Wide sweep: ring frames sit in [-180, 180)-centered space but a window
    // whose west edge is near +180 can reach lonMax ≈ 540.
    for (const off of [-360, 0, 360, 720]) {
      if (b.maxLon + off < win.lonMin || b.minLon + off > lonMax) continue;
      const ring = rings[i];
      // Sub-pixel islets (atolls at ocean-basin zoom) get a minimum-size dot
      // instead of an invisible degenerate polygon.
      if ((b.maxLon - b.minLon) * pxPerLon < 2.5 && (b.maxLat - b.minLat) * pxPerLat < 2.5) {
        ctx.fillRect(px((b.minLon + b.maxLon) / 2 + off) - 1, py((b.minLat + b.maxLat) / 2) - 1, 2, 2);
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(px(ring[0] + off), py(ring[1]));
      for (let j = 2; j < ring.length; j += 2) {
        ctx.lineTo(px(ring[j] + off), py(ring[j + 1]));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // Graticule with edge labels.
  const step =
    win.lonSpan > 200 ? 45
    : win.lonSpan > 100 ? 30
    : win.lonSpan > 50 ? 15
    : win.lonSpan > 24 ? 10
    : win.lonSpan > 12 ? 5
    : 2;
  ctx.strokeStyle = C.graticule;
  ctx.lineWidth = 1;
  ctx.font = `400 9.5px ${MONO}`;
  for (let lon = Math.ceil(win.lonMin / step) * step; lon <= lonMax; lon += step) {
    const x = px(lon);
    ctx.beginPath();
    ctx.moveTo(x, mapY);
    ctx.lineTo(x, mapY + MAP_H);
    ctx.stroke();
    const norm = ((lon + 540) % 360) - 180;
    // Leave the bottom-right corner to the map credit.
    if (x < mapX + mapW - 150) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText(
        `${Math.abs(norm)}°${norm === 0 || Math.abs(norm) === 180 ? '' : norm > 0 ? 'E' : 'W'}`,
        x + 4,
        mapY + MAP_H - 10
      );
    }
  }
  for (let lat = Math.ceil(win.latMin / step) * step; lat <= latMax; lat += step) {
    const y = py(lat);
    ctx.beginPath();
    ctx.moveTo(mapX, y);
    ctx.lineTo(mapX + mapW, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(`${Math.abs(lat)}°${lat === 0 ? '' : lat > 0 ? 'N' : 'S'}`, mapX + 6, y - 7);
  }

  // Recent track breadcrumbs (72h server history) under the markers. The whole
  // polyline is unwrapped backward from the ship's drawn 360°-copy so a track
  // crossing the antimeridian doesn't streak across the map.
  for (const r of live) {
    const track = r.ship.track ?? [];
    if (track.length < 2) continue;
    const pts = [...track.map((p) => ({ lat: p.lat, lon: p.lon })), {
      lat: r.ship.latitude,
      lon: r.ship.longitude,
    }];
    const lons = new Array<number>(pts.length);
    lons[pts.length - 1] = nearestLonCopy(pts[pts.length - 1].lon, win);
    for (let i = pts.length - 2; i >= 0; i--) {
      let lon = pts[i].lon;
      while (lon - lons[i + 1] > 180) lon -= 360;
      while (lon - lons[i + 1] < -180) lon += 360;
      lons[i] = lon;
    }
    const color = fleetColor(r.roster.cls);
    ctx.strokeStyle = `${color}59`; // 35% alpha
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(px(lons[0]), py(pts[0].lat));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(px(lons[i]), py(pts[i].lat));
    ctx.stroke();
  }

  // Ship markers + course vectors.
  interface Marker {
    x: number;
    y: number;
    row: SnapshotRow & { ship: ShipState };
  }
  const markers: Marker[] = live.map((r) => ({
    x: px(nearestLonCopy(r.ship.longitude, win)),
    y: py(r.ship.latitude),
    row: r,
  }));

  for (const m of markers) {
    const color = fleetColor(m.row.roster.cls);
    const st = statusOf(m.row.ship);
    // Course vector for ships making way.
    const bearing = m.row.ship.course ?? m.row.ship.heading;
    if (st.kind === 'underway' && bearing != null) {
      const rad = (bearing * Math.PI) / 180;
      const dx = Math.sin(rad);
      const dy = -Math.cos(rad);
      ctx.strokeStyle = `${color}cc`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(m.x + dx * 9, m.y + dy * 9);
      ctx.lineTo(m.x + dx * 22, m.y + dy * 22);
      ctx.stroke();
      // Arrowhead.
      const ax = m.x + dx * 22;
      const ay = m.y + dy * 22;
      ctx.fillStyle = `${color}cc`;
      ctx.beginPath();
      ctx.moveTo(ax + dx * 7, ay + dy * 7);
      ctx.lineTo(ax - dy * 4, ay + dx * 4);
      ctx.lineTo(ax + dy * 4, ay - dx * 4);
      ctx.closePath();
      ctx.fill();
    }
    // Soft glow, then the dot.
    const glow = ctx.createRadialGradient(m.x, m.y, 2, m.x, m.y, 16);
    glow.addColorStop(0, `${color}47`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(m.x, m.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  // Callout labels — greedy collision-avoiding placement with leader lines.
  const placed: Rect[] = markers.map((m) => ({ x: m.x - 9, y: m.y - 9, w: 18, h: 18 }));
  const mapRect: Rect = { x: mapX + 6, y: mapY + 6, w: mapW - 12, h: MAP_H - 12 };
  for (const m of markers) {
    const color = fleetColor(m.row.roster.cls);
    const name = m.row.ship.name?.trim() || m.row.roster.name;
    const st = statusOf(m.row.ship);
    const context = m.row.place ?? (st.kind === 'underway' ? 'At sea' : st.label);
    ctx.font = `600 12.5px ${SANS}`;
    const nameW = ctx.measureText(name).width;
    ctx.font = `400 10.5px ${SANS}`;
    const ctxW = ctx.measureText(context).width;
    const chipW = Math.max(nameW, ctxW) + 20;
    const chipH = 38;

    const dirs: Array<[number, number]> = [
      [1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1],
    ];
    let best: Rect | null = null;
    outer: for (const dist of [16, 30, 48, 70, 96]) {
      for (const [dx, dy] of dirs) {
        const cx = m.x + dx * dist + (dx === 0 ? -chipW / 2 : dx > 0 ? 0 : -chipW);
        const cy = m.y + dy * dist + (dy === 0 ? -chipH / 2 : dy > 0 ? 0 : -chipH);
        const rect: Rect = { x: cx, y: cy, w: chipW, h: chipH };
        if (
          rect.x < mapRect.x ||
          rect.y < mapRect.y ||
          rect.x + rect.w > mapRect.x + mapRect.w ||
          rect.y + rect.h > mapRect.y + mapRect.h
        ) {
          continue;
        }
        if (placed.some((p) => intersects(rect, p))) continue;
        best = rect;
        break outer;
      }
    }
    // Fallback: pin beside the marker even if it overlaps something.
    if (!best) {
      best = {
        x: Math.min(Math.max(m.x + 16, mapRect.x), mapRect.x + mapRect.w - chipW),
        y: Math.min(Math.max(m.y - chipH / 2, mapRect.y), mapRect.y + mapRect.h - chipH),
        w: chipW,
        h: chipH,
      };
    }
    placed.push(best);

    // Leader line to the chip's nearest edge midpoint when it sits away.
    const chipCx = best.x + best.w / 2;
    const chipCy = best.y + best.h / 2;
    const anchorX = Math.min(Math.max(m.x, best.x), best.x + best.w);
    const anchorY = Math.min(Math.max(m.y, best.y), best.y + best.h);
    if (Math.hypot(anchorX - m.x, anchorY - m.y) > 14) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(chipCx + (anchorX - chipCx) * 0.9, chipCy + (anchorY - chipCy) * 0.9);
      ctx.stroke();
    }

    roundedRect(ctx, best.x, best.y, best.w, best.h, 6);
    ctx.fillStyle = 'rgba(6,11,17,0.88)';
    ctx.fill();
    ctx.strokeStyle = `${color}73`; // 45% alpha
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = `600 12.5px ${SANS}`;
    ctx.fillText(name, best.x + 10, best.y + 12);
    ctx.fillStyle = C.ink2;
    ctx.font = `400 10.5px ${SANS}`;
    ctx.fillText(context, best.x + 10, best.y + 27);
  }

  // Map credit.
  ctx.font = `400 8.5px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.textAlign = 'right';
  ctx.fillText('Coastline: Natural Earth', mapX + mapW - 10, mapY + MAP_H - 10);
  ctx.textAlign = 'left';
  ctx.restore();

  // ---- table ----------------------------------------------------------------
  drawTable(ctx, rows, mapX, tableY, mapW, generatedAt);

  // ---- footer ---------------------------------------------------------------
  const footY = tableY + tableH + 26;
  ctx.font = `400 10.5px ${SANS}`;
  ctx.fillStyle = C.ink3;
  ctx.fillText(
    'Positions are each ship’s last AIS fix · destinations & ETAs are as reported by the ship (ETA in UTC and Denver time)',
    PAD,
    footY
  );
  ctx.textAlign = 'right';
  ctx.fillText('GSOC Monitor', W - PAD, footY);
  ctx.textAlign = 'left';

  return canvas;
}

// The nearest 360°-copy of a longitude that falls inside (or closest to) the
// window, so markers/tracks land on the drawn copy of the world.
function nearestLonCopy(lon: number, win: MapWindow): number {
  const center = win.lonMin + win.lonSpan / 2;
  let l = lon;
  while (l < center - 180) l += 360;
  while (l > center + 180) l -= 360;
  return l;
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  rows: SnapshotRow[],
  x: number,
  y: number,
  w: number,
  generatedAt: number
): void {
  // Column plan; 'location' absorbs the leftover width.
  const cols = [
    { key: 'ship', label: 'Ship', w: 190 },
    { key: 'status', label: 'Status', w: 118 },
    { key: 'location', label: 'Location', w: 0 },
    { key: 'position', label: 'Position', w: 168 },
    { key: 'speed', label: 'Speed', w: 76 },
    { key: 'destination', label: 'Destination (AIS)', w: 226 },
    { key: 'eta', label: 'ETA', w: 196 },
    { key: 'age', label: 'Last fix', w: 84 },
  ];
  const fixed = cols.reduce((a, c) => a + c.w, 0);
  cols[2].w = w - fixed;
  const colX: number[] = [];
  let cx = x;
  for (const c of cols) {
    colX.push(cx);
    cx += c.w;
  }

  // Header row.
  ctx.font = `600 10px ${SANS}`;
  ctx.fillStyle = C.ink3;
  for (let i = 0; i < cols.length; i++) {
    ctx.fillText(cols[i].label.toUpperCase(), colX[i] + (i === 0 ? 0 : 10), y + TABLE_HEAD_H / 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + TABLE_HEAD_H - 4);
  ctx.lineTo(x + w, y + TABLE_HEAD_H - 4);
  ctx.stroke();

  const now = generatedAt;
  rows.forEach((row, i) => {
    const ry = y + TABLE_HEAD_H + i * ROW_H;
    const mid = ry + ROW_H / 2;
    if (i % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(x - 8, ry, w + 16, ROW_H);
    }
    const color = fleetColor(row.roster.cls);

    // Ship: class dot + name.
    ctx.beginPath();
    ctx.arc(colX[0] + 6, mid, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.font = `600 13px ${SANS}`;
    ctx.fillText(row.roster.name, colX[0] + 18, mid);

    if (!row.ship) {
      ctx.fillStyle = C.ink3;
      ctx.font = `400 12px ${SANS}`;
      ctx.fillText('No position received yet', colX[1] + 10, mid);
      return;
    }
    const s = row.ship;
    const st = statusOf(s);

    // Status pill.
    ctx.font = `700 9.5px ${SANS}`;
    const pillText = st.label.toUpperCase();
    const pillW = ctx.measureText(pillText).width + 16;
    const pillColor =
      st.kind === 'alert' ? '#ff5d5d'
      : st.kind === 'underway' ? C.accent
      : st.kind === 'unknown' ? C.warn
      : '#52e3a4';
    roundedRect(ctx, colX[1] + 10, mid - 9, pillW, 18, 9);
    ctx.fillStyle = `${pillColor}1f`;
    ctx.fill();
    ctx.strokeStyle = `${pillColor}59`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = pillColor;
    ctx.fillText(pillText, colX[1] + 18, mid);

    // Location.
    ctx.fillStyle = C.ink;
    ctx.font = `400 12.5px ${SANS}`;
    const locText = row.place ?? (st.kind === 'underway' ? 'At sea' : '—');
    ctx.fillText(ellipsize(ctx, locText, cols[2].w - 20), colX[2] + 10, mid);

    // Position (mono).
    ctx.fillStyle = C.ink2;
    ctx.font = `400 11px ${MONO}`;
    ctx.fillText(fmtCoord(s.latitude, s.longitude), colX[3] + 10, mid);

    // Speed.
    ctx.fillStyle = C.ink2;
    ctx.font = `400 12px ${SANS}`;
    ctx.fillText(s.speedKt != null ? `${s.speedKt.toFixed(1)} kt` : '—', colX[4] + 10, mid);

    // Destination.
    ctx.fillStyle = s.destination ? C.ink : C.ink3;
    ctx.font = `400 12.5px ${SANS}`;
    const dest = s.destination?.trim() ? prettyDestination(s.destination.trim()) : '—';
    ctx.fillText(ellipsize(ctx, dest, cols[5].w - 20), colX[5] + 10, mid);

    // ETA — UTC on the first line, Denver on the second. An expired parsed ETA
    // suppresses the raw-text fallback too (it's the same stale ETA, year-less).
    if (s.etaUtc != null && s.etaUtc > now - 12 * 3600_000) {
      ctx.fillStyle = C.ink;
      ctx.font = `400 12px ${SANS}`;
      ctx.fillText(`${utcFmt.format(s.etaUtc)} UTC`, colX[6] + 10, mid - 8);
      ctx.fillStyle = C.ink3;
      ctx.font = `400 10.5px ${SANS}`;
      ctx.fillText(denverFmt.format(s.etaUtc), colX[6] + 10, mid + 9);
    } else if (s.etaUtc == null && s.etaText) {
      ctx.fillStyle = C.ink2;
      ctx.font = `400 11.5px ${SANS}`;
      ctx.fillText(ellipsize(ctx, s.etaText, cols[6].w - 20), colX[6] + 10, mid);
    } else {
      ctx.fillStyle = C.ink3;
      ctx.font = `400 12px ${SANS}`;
      ctx.fillText('—', colX[6] + 10, mid);
    }

    // Age (amber when the fix is older than a day).
    const stale = s.lastSeenSec > 24 * 3600;
    ctx.fillStyle = stale ? C.warn : C.ink3;
    ctx.font = `400 11px ${SANS}`;
    ctx.fillText(fmtAge(s.lastSeenSec), colX[7] + 10, mid);
  });
}

// ---------------------------------------------------------------------------
// Orchestration: build → PNG blob → clipboard (download fallback)
// ---------------------------------------------------------------------------

async function buildFleetSnapshotBlob(): Promise<Blob> {
  const rows = await assembleRows();
  await document.fonts.ready;
  const canvas = renderFleetSnapshot(rows, Date.now());
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return blob;
}

function downloadBlob(blob: Blob): void {
  const denverDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(Date.now());
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `windstar-fleet-${denverDate}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type SnapshotResult =
  | { ok: true; method: 'clipboard' | 'download' }
  | { ok: false; error: string };

// Call from a click handler. Passing the pending blob promise straight into
// ClipboardItem keeps the user-gesture chain alive through the async render
// (required by Safari, supported by Chromium ≥ 98); if the engine rejects
// promise payloads we retry with the resolved blob, and if the clipboard is
// unavailable altogether we download the PNG instead.
export async function copyFleetSnapshot(): Promise<SnapshotResult> {
  const blobPromise = buildFleetSnapshotBlob();

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      return { ok: true, method: 'clipboard' };
    } catch {
      // Fall through — distinguish render failure from clipboard failure below.
    }
  }

  let blob: Blob;
  try {
    blob = await blobPromise;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Snapshot render failed' };
  }

  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return { ok: true, method: 'clipboard' };
    } catch {
      // Clipboard genuinely unavailable (permissions/insecure context).
    }
  }

  try {
    downloadBlob(blob);
    return { ok: true, method: 'download' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save the image' };
  }
}
