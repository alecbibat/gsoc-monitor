import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DrawLayer } from './crisisStore';
import { measureLayer } from './layerMeasure';

// Interactive read-only map for the public share view. Renders ONLY the draw
// layers belonging to the incident and opens centred on their combined extent.
//
// Leaflet (raster OSM/CARTO tiles) is used rather than Cesium: the share page
// is a standalone document with no other globe, the tiles are fetched directly
// by the viewer's browser, and there is zero WebGL/GPU cost.

// A signature of everything the map actually draws. The share view re-renders
// on every live update (name edits, log entries, status changes); keying the
// redraw on this means unrelated updates don't redraw the layers or yank the
// viewer's pan/zoom back to the fitted view.
function layersSignature(layers: DrawLayer[]): string {
  return layers
    .map((l) => `${l.id}:${l.geometry}:${l.directional ? 'dir' : ''}:${l.color}:${l.name}:${l.positions.map((p) => `${p.lat},${p.lon}`).join('|')}`)
    .join(';');
}

// Chevron markers that show a directional line's direction of travel. Placed at
// segment midpoints (at most MAX_ARROWS, evenly spread across the segments) and
// rotated to the segment's on-screen bearing — longitude is scaled by cos(lat),
// which matches Web Mercator's local aspect, so the glyph aligns with the drawn
// line at any latitude.
const MAX_ARROWS = 8;

function arrowIcon(color: string, angleDeg: number): L.DivIcon {
  return L.divIcon({
    // A real class (styled nowhere) so Leaflet doesn't apply its default
    // white-box .leaflet-div-icon styling.
    className: 'crisis-map-arrow',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html:
      `<svg width="16" height="16" viewBox="0 0 16 16" style="display:block;transform:rotate(${angleDeg}deg)">` +
      `<path d="M2 3 L14 8 L2 13 L5.5 8 Z" fill="${color}" stroke="#ffffff" stroke-width="1"/></svg>`,
  });
}

function addDirectionArrows(group: L.FeatureGroup, latlngs: [number, number][], color: string): void {
  const segments = latlngs.length - 1;
  if (segments < 1) return;
  const count = Math.min(segments, MAX_ARROWS);
  for (let k = 0; k < count; k++) {
    // Evenly spread arrow-bearing segments; a single segment gets one arrow.
    const i = Math.round((k + 0.5) * (segments / count) - 0.5);
    const [lat1, lon1] = latlngs[i];
    const [lat2, lon2] = latlngs[i + 1];
    if (lat1 === lat2 && lon1 === lon2) continue;
    const east = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    const north = lat2 - lat1;
    // CSS rotation is clockwise; the glyph points east at 0°.
    const angle = (-Math.atan2(north, east) * 180) / Math.PI;
    L.marker([(lat1 + lat2) / 2, (lon1 + lon2) / 2], {
      icon: arrowIcon(color, angle),
      interactive: false,
      keyboard: false,
    }).addTo(group);
  }
}

export function CrisisShareMap({ layers }: { layers: DrawLayer[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.FeatureGroup | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const sig = layersSignature(layers);

  // Create the map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: true,
      scrollWheelZoom: false, // enabled only once the user clicks into the map
      attributionControl: true,
      worldCopyJump: true,
    });
    map.setView([20, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '© CARTO © OpenStreetMap contributors',
    }).addTo(map);

    // Don't hijack page scroll: scroll-zoom only after the map gains focus
    // (click/tap), and release it when focus leaves.
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // (Re)draw the layers and refit only when the layer geometry actually changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    const group = L.featureGroup();

    for (const layer of layersRef.current) {
      if (!layer.positions.length) continue;
      const latlngs = layer.positions.map((p) => [p.lat, p.lon] as [number, number]);

      let shape: L.Layer;
      if (layer.geometry === 'point' || latlngs.length < 2) {
        shape = L.circleMarker(latlngs[0], {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: layer.color,
          fillOpacity: 1,
        });
      } else if (layer.geometry === 'line') {
        shape = L.polyline(latlngs, { color: layer.color, weight: 4, opacity: 0.95 });
        if (layer.directional) addDirectionArrows(group, latlngs, layer.color);
      } else {
        shape = L.polygon(latlngs, {
          color: layer.color,
          weight: 2,
          opacity: 0.95,
          fillColor: layer.color,
          fillOpacity: 0.22,
        });
      }

      // Same measurement the layer list and the globe label carry, so hovering
      // a shape on the flat map answers "how far is that?" too.
      const measure = measureLayer(layer);
      shape.bindTooltip(
        measure.kind === 'none' ? layer.name : `${layer.name} · ${measure.summary}`,
        { direction: 'top', className: 'crisis-map-tip', sticky: true }
      );
      shape.addTo(group);
    }

    group.addTo(map);
    overlayRef.current = group;

    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 14 });
    }
    // Container may have been sized after creation — make sure Leaflet agrees.
    map.invalidateSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (
    <div
      ref={elRef}
      className="h-[420px] w-full overflow-hidden rounded-lg border border-white/8"
      style={{ background: '#05070a' }}
    />
  );
}
