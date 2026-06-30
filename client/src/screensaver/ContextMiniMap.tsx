import type { ReactNode } from 'react';

const MAP_W = 240;
const MAP_H = 130;
const TILE_SIZE = 256;
const ZOOM = 5;

function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 1 << zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function poiPixelOffset(lat: number, lon: number, zoom: number) {
  const n = 1 << zoom;
  const xFrac = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    px: (xFrac - Math.floor(xFrac)) * TILE_SIZE,
    py: (yFrac - Math.floor(yFrac)) * TILE_SIZE,
  };
}

function coordsLabel(lat: number, lon: number): string {
  const ns = lat >= 0 ? `${lat.toFixed(2)}°N` : `${Math.abs(lat).toFixed(2)}°S`;
  const ew = lon >= 0 ? `${lon.toFixed(2)}°E` : `${Math.abs(lon).toFixed(2)}°W`;
  return `${ns} ${ew}`;
}

// A small OSM-tile minimap that keeps a single point dead-centre under a
// crosshair, with a bottom gradient for caption text + coordinates. Pure CSS /
// <img> tiles — no WebGL context, zero GPU cost. Shared by the pins screensaver
// (PinsContextBox) and the hover orbit (HoverContextBox); pass the caption
// (name / place) as children — the coordinate line is appended automatically.
export function ContextMiniMap({
  lat,
  lon,
  accentHex = '#a78bfa',
  children,
}: {
  lat: number;
  lon: number;
  accentHex?: string;
  children?: ReactNode;
}) {
  // Build a 3×3 OSM tile grid so the point lands exactly at the container centre.
  // The grid is offset so: gridLeft + TILE_SIZE + px = MAP_W/2, same for y.
  const { x: cx, y: cy } = latLonToTile(lat, lon, ZOOM);
  const { px, py } = poiPixelOffset(lat, lon, ZOOM);
  const maxN = (1 << ZOOM) - 1;
  const tiles: { key: string; dx: number; dy: number; tx: number; ty: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = (((cx + dx) % (1 << ZOOM)) + (1 << ZOOM)) % (1 << ZOOM);
      const ty = Math.max(0, Math.min(maxN, cy + dy));
      tiles.push({ key: `${dx},${dy}`, dx, dy, tx, ty });
    }
  }
  const gridLeft = MAP_W / 2 - px - TILE_SIZE;
  const gridTop = MAP_H / 2 - py - TILE_SIZE;

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-white/15 shadow-2xl"
      style={{ width: MAP_W, height: MAP_H, background: '#05070a' }}
    >
      {/* OSM tile minimap */}
      <div
        style={{
          position: 'absolute',
          left: gridLeft,
          top: gridTop,
          width: TILE_SIZE * 3,
          height: TILE_SIZE * 3,
          filter: 'brightness(0.45) saturate(0.6)',
          pointerEvents: 'none',
        }}
      >
        {tiles.map(({ key, dx, dy, tx, ty }) => (
          <img
            key={key}
            src={`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`}
            draggable={false}
            style={{
              position: 'absolute',
              left: (dx + 1) * TILE_SIZE,
              top: (dy + 1) * TILE_SIZE,
              width: TILE_SIZE,
              height: TILE_SIZE,
              display: 'block',
            }}
            alt=""
          />
        ))}
      </div>

      {/* Crosshair — always at canvas centre, which is always the point. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="3.5" stroke={accentHex} strokeWidth="1.5" />
          <line x1="11" y1="0" x2="11" y2="6.5" stroke={accentHex} strokeWidth="1" opacity="0.7" />
          <line x1="11" y1="15.5" x2="11" y2="22" stroke={accentHex} strokeWidth="1" opacity="0.7" />
          <line x1="0" y1="11" x2="6.5" y2="11" stroke={accentHex} strokeWidth="1" opacity="0.7" />
          <line x1="15.5" y1="11" x2="22" y2="11" stroke={accentHex} strokeWidth="1" opacity="0.7" />
        </svg>
      </div>

      {/* "CONTEXT" label — top-left corner */}
      <div className="pointer-events-none absolute left-2 top-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">CONTEXT</span>
      </div>

      {/* Bottom gradient overlay — caption (children) + coordinates */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
        {children}
        <div className="text-[9px] font-mono text-white/35">{coordsLabel(lat, lon)}</div>
      </div>
    </div>
  );
}
