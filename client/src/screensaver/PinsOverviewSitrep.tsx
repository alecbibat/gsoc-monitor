import * as Cesium from 'cesium';
import { useEffect, useMemo, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { summarize, groupHazardColor, groupCentroid, isExtreme } from './watchSummary';

// Hide the sitrep below this camera height: during the first moments of the
// fly-back ascent (and any weird transient), centroid projections would land
// in nonsensical screen spots.
const MIN_CAMERA_HEIGHT_M = 2_000_000;

// Property Watch drawn on the globe itself during the pins tour's zoomed-out
// beats (phases 'rotating' and 'flying-back', when the camera is at or heading
// to the 9,000 km US overview): one dot per property group at its real
// location — a faint static mark when the group is clear, a breathing halo
// tinted its worst-hazard color when it isn't (fire groups flicker an amber
// core, quake groups ping an expanding ring). No names on the map: reading
// which group is which belongs to the clock card's cluster, which consumes the
// same summaries so the two can never disagree. The whole layer fades out the
// moment the camera dives to a property.
export function PinsOverviewSitrep() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const phase = useScreensaverStore((s) => s.phase);
  const result = useProximityStore((s) => s.result);

  const isPins = active && mode === 'pins';
  const atOverview = isPins && (phase === 'rotating' || phase === 'flying-back');

  const summaryById = useMemo(() => {
    const groups = summarize(result?.properties ?? []);
    return new Map(groups.map((g) => [g.group.id, g]));
  }, [result]);

  const nodesRef = useRef(new Map<string, HTMLDivElement | null>());

  // Imperative per-frame positioning: project each group's centroid to window
  // coordinates on postRender and move the DOM nodes directly, so React only
  // renders when the scan result changes.
  useEffect(() => {
    if (!viewer || !atOverview) return;
    const v = viewer;
    const scratch = new Cesium.Cartesian2();
    const anchors = LOCATION_GROUPS.map((g) => {
      const c = groupCentroid(g);
      return { id: g.id, cart: Cesium.Cartesian3.fromDegrees(c.lon, c.lat) };
    });

    const update = () => {
      const high = v.camera.positionCartographic.height > MIN_CAMERA_HEIGHT_M;
      for (const a of anchors) {
        const el = nodesRef.current.get(a.id);
        if (!el) continue;
        const win = high
          ? Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, a.cart, scratch)
          : undefined;
        if (!win) {
          el.style.opacity = '0';
          continue;
        }
        el.style.transform = `translate(${win.x}px, ${win.y}px) translate(-50%, -50%)`;
        el.style.opacity = '1';
      }
    };

    v.scene.postRender.addEventListener(update);
    return () => {
      v.scene.postRender.removeEventListener(update);
    };
  }, [viewer, atOverview]);

  if (!isPins) return null;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 transition-opacity duration-500 ${
        atOverview ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {LOCATION_GROUPS.map((g) => {
        const s = summaryById.get(g.id);
        if (!s) {
          // Clear group: a faint static mark, so the overview always shows the
          // whole monitored portfolio.
          return (
            <div
              key={g.id}
              ref={(el) => nodesRef.current.set(g.id, el)}
              className="absolute left-0 top-0 h-[5px] w-[5px] rounded-full bg-white/25 opacity-0 will-change-transform"
            />
          );
        }

        const color = groupHazardColor(s);
        // Halo grows with distinct alert types: 44px at one, capped at 74px.
        const size = 44 + Math.min(s.alerts.length, 5) * 6;
        return (
          <div
            key={g.id}
            ref={(el) => nodesRef.current.set(g.id, el)}
            className="absolute left-0 top-0 opacity-0 will-change-transform"
            style={{ width: size, height: size }}
          >
            <div
              className={`watch-halo absolute inset-0 rounded-full ${
                isExtreme(s) ? 'watch-halo-fast' : ''
              }`}
              style={{
                background: `radial-gradient(circle, ${color}8C 0%, ${color}2E 45%, transparent 70%)`,
              }}
            />
            <span
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                s.fireCount > 0 ? 'watch-flicker h-2 w-2' : 'h-[7px] w-[7px]'
              }`}
              style={
                s.fireCount > 0
                  ? { background: '#ffb84d', boxShadow: '0 0 10px #ffb84d' }
                  : { background: color, boxShadow: `0 0 10px ${color}` }
              }
            />
            {s.quakeCount > 0 && (
              <span
                className="watch-ping absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full border"
                style={{ borderColor: color }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
