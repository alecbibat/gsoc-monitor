import { useEffect, useState } from 'react';
import { useScreensaverStore } from './screensaverStore';

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

// Reverse geocode a lat/lon via BigDataCloud (free, no key required).
// Returns a short label like "Portland, OR", "Caribbean Sea", etc.
async function reverseGeocode(lat: number, lon: number, signal: AbortSignal): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal },
    );
    if (!r.ok || signal.aborted) return null;
    const d = (await r.json()) as {
      city?: string;
      locality?: string;
      principalSubdivisionCode?: string;
      countryCode?: string;
      countryName?: string;
    };
    const parts: string[] = [];
    if (d.city) parts.push(d.city);
    else if (d.locality) parts.push(d.locality);
    if (d.countryCode === 'US' || d.countryCode === 'CA') {
      if (d.principalSubdivisionCode) parts.push(d.principalSubdivisionCode);
    } else if (d.countryName) {
      parts.push(d.countryName);
    }
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}

export function PinsContextBox() {
  const [geoLabel, setGeoLabel] = useState<string | null>(null);

  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const poi = useScreensaverStore((s) => s.currentPoi);

  const isPins = active && mode === 'pins';
  const visible = isPins && poi !== null;

  useEffect(() => {
    if (!poi) { setGeoLabel(null); return; }
    const ctrl = new AbortController();
    reverseGeocode(poi.lat, poi.lon, ctrl.signal).then((label) => {
      if (!ctrl.signal.aborted) {
        setGeoLabel(label ?? (poi.category === 'ship' ? 'International Waters' : null));
      }
    });
    return () => ctrl.abort();
  }, [poi?.lat, poi?.lon, poi?.category]);

  // Build 3×3 OSM tile grid so the POI lands exactly at the container centre.
  // The grid div is positioned so: gridLeft + TILE_SIZE + px = MAP_W/2, same for y.
  const tileGrid = poi
    ? (() => {
        const { x: cx, y: cy } = latLonToTile(poi.lat, poi.lon, ZOOM);
        const { px, py } = poiPixelOffset(poi.lat, poi.lon, ZOOM);
        const maxN = (1 << ZOOM) - 1;
        const tiles: { key: string; dx: number; dy: number; tx: number; ty: number }[] = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const tx = ((cx + dx) % (1 << ZOOM) + (1 << ZOOM)) % (1 << ZOOM);
            const ty = Math.max(0, Math.min(maxN, cy + dy));
            tiles.push({ key: `${dx},${dy}`, dx, dy, tx, ty });
          }
        }
        return { tiles, gridLeft: MAP_W / 2 - px - TILE_SIZE, gridTop: MAP_H / 2 - py - TILE_SIZE };
      })()
    : null;

  return (
    <div
      className={`pointer-events-none absolute bottom-12 right-6 z-30 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div
        className="relative overflow-hidden rounded-xl border border-white/15 shadow-2xl"
        style={{ width: MAP_W, height: MAP_H, background: '#05070a' }}
      >
        {/* OSM tile minimap — no WebGL context, zero GPU cost */}
        {tileGrid && (
          <div
            style={{
              position: 'absolute',
              left: tileGrid.gridLeft,
              top: tileGrid.gridTop,
              width: TILE_SIZE * 3,
              height: TILE_SIZE * 3,
              filter: 'brightness(0.45) saturate(0.6)',
              pointerEvents: 'none',
            }}
          >
            {tileGrid.tiles.map(({ key, dx, dy, tx, ty }) => (
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
        )}

        {/* Crosshair — always at canvas centre, which is always the POI. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="3.5" stroke="#a78bfa" strokeWidth="1.5" />
            <line x1="11" y1="0" x2="11" y2="6.5" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
            <line x1="11" y1="15.5" x2="11" y2="22" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
            <line x1="0" y1="11" x2="6.5" y2="11" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
            <line x1="15.5" y1="11" x2="22" y2="11" stroke="#a78bfa" strokeWidth="1" opacity="0.7" />
          </svg>
        </div>

        {/* "CONTEXT" label — top-left corner */}
        <div className="pointer-events-none absolute left-2 top-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
            CONTEXT
          </span>
        </div>

        {/* Bottom gradient overlay with POI name + location + coordinates */}
        {poi && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
            <div className="truncate text-[10px] font-medium text-white/80">{poi.title}</div>
            {geoLabel && (
              <div className="truncate text-[9px] text-white/55">{geoLabel}</div>
            )}
            <div className="text-[9px] font-mono text-white/35">
              {poi.lat >= 0 ? `${poi.lat.toFixed(2)}°N` : `${Math.abs(poi.lat).toFixed(2)}°S`}{' '}
              {poi.lon >= 0 ? `${poi.lon.toFixed(2)}°E` : `${Math.abs(poi.lon).toFixed(2)}°W`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
