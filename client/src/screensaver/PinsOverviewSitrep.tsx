import * as Cesium from 'cesium';
import { useEffect, useMemo, useRef } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { useScreensaverStore } from './screensaverStore';
import { useProximityStore } from '../widgets/proximity/proximityStore';
import { quakeColor } from '../widgets/proximity/format';
import {
  summarize,
  groupHazardColor,
  groupCentroid,
  isExtreme,
  type GroupSummary,
} from './watchSummary';

// Hide the sitrep below this camera height: during the first moments of the
// fly-back ascent (and any weird transient), centroid projections would land
// in nonsensical screen spots.
const MIN_CAMERA_HEIGHT_M = 2_000_000;

// Pill offset from its halo, and the greedy collision nudge that keeps the
// Montana/Wyoming cluster (Glacier + Yellowstone) from overlapping.
const PILL_DX = 18;
const PILL_DY = -36;
const PILL_W_ESTIMATE = 190;
const PILL_ROW_H = 30;

interface Node {
  halo: HTMLDivElement | null;
  pill: HTMLDivElement | null;
}

// Property Watch drawn on the globe itself during the pins tour's zoomed-out
// beats (phases 'rotating' and 'flying-back', when the camera is at or heading
// to the 9,000 km US overview): a breathing halo per affected group at its real
// location, tinted its worst-hazard color, plus a compact callout pill. The
// whole layer fades out the moment the camera dives to a property — mid-orbit
// awareness is carried by PinsWatchCluster in the clock card, which reads the
// same summaries so the two can never disagree.
export function PinsOverviewSitrep() {
  const viewer = useCesiumViewer();
  const active = useScreensaverStore((s) => s.active);
  const mode = useScreensaverStore((s) => s.mode);
  const phase = useScreensaverStore((s) => s.phase);
  const result = useProximityStore((s) => s.result);

  const isPins = active && mode === 'pins';
  const atOverview = isPins && (phase === 'rotating' || phase === 'flying-back');

  const groups = useMemo(() => summarize(result?.properties ?? []), [result]);
  const nodesRef = useRef(new Map<string, Node>());

  // Imperative per-frame positioning: project each affected group's centroid to
  // window coordinates on postRender and move the DOM nodes directly, so React
  // renders only when the group list itself changes.
  useEffect(() => {
    if (!viewer || !atOverview || groups.length === 0) return;
    const v = viewer;
    const scratch = new Cesium.Cartesian2();
    const anchors = groups.map((g) => {
      const c = groupCentroid(g.group);
      return { id: g.group.id, cart: Cesium.Cartesian3.fromDegrees(c.lon, c.lat) };
    });

    const update = () => {
      const high = v.camera.positionCartographic.height > MIN_CAMERA_HEIGHT_M;
      const placed: { x: number; y: number }[] = [];
      for (const a of anchors) {
        const node = nodesRef.current.get(a.id);
        if (!node?.halo || !node.pill) continue;
        const win = high
          ? Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, a.cart, scratch)
          : undefined;
        if (!win) {
          node.halo.style.opacity = '0';
          node.pill.style.opacity = '0';
          continue;
        }
        let px = win.x + PILL_DX;
        let py = win.y + PILL_DY;
        for (const q of placed) {
          if (Math.abs(px - q.x) < PILL_W_ESTIMATE && Math.abs(py - q.y) < PILL_ROW_H) {
            py = q.y + PILL_ROW_H;
          }
        }
        placed.push({ x: px, y: py });
        node.halo.style.transform = `translate(${win.x}px, ${win.y}px) translate(-50%, -50%)`;
        node.halo.style.opacity = '1';
        node.pill.style.transform = `translate(${px}px, ${py}px)`;
        node.pill.style.opacity = '1';
      }
    };

    v.scene.postRender.addEventListener(update);
    return () => {
      v.scene.postRender.removeEventListener(update);
    };
  }, [viewer, atOverview, groups]);

  if (!isPins) return null;

  const visible = atOverview && groups.length > 0;

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {groups.map((g) => (
        <SitrepMarker
          key={g.group.id}
          g={g}
          refs={(part, el) => {
            const cur = nodesRef.current.get(g.group.id) ?? { halo: null, pill: null };
            cur[part] = el;
            nodesRef.current.set(g.group.id, cur);
          }}
        />
      ))}
    </div>
  );
}

function SitrepMarker({
  g,
  refs,
}: {
  g: GroupSummary;
  refs: (part: 'halo' | 'pill', el: HTMLDivElement | null) => void;
}) {
  const color = groupHazardColor(g);
  // Halo grows with distinct alert types: 44px at one, capped at 74px.
  const size = 44 + Math.min(g.alerts.length, 5) * 6;

  return (
    <>
      {/* Breathing halo + core at the group's centroid. Nodes start invisible;
          the postRender pass positions and reveals them. */}
      <div
        ref={(el) => refs('halo', el)}
        className="absolute left-0 top-0 opacity-0 will-change-transform"
        style={{ width: size, height: size }}
      >
        <div
          className={`watch-halo absolute inset-0 rounded-full ${isExtreme(g) ? 'watch-halo-fast' : ''}`}
          style={{
            background: `radial-gradient(circle, ${color}8C 0%, ${color}2E 45%, transparent 70%)`,
          }}
        />
        <span
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            g.fireCount > 0 ? 'watch-flicker h-2 w-2' : 'h-[7px] w-[7px]'
          }`}
          style={
            g.fireCount > 0
              ? { background: '#ffb84d', boxShadow: '0 0 10px #ffb84d' }
              : { background: color, boxShadow: `0 0 10px ${color}` }
          }
        />
        {g.quakeCount > 0 && (
          <span
            className="watch-ping absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full border"
            style={{ borderColor: color }}
          />
        )}
      </div>

      {/* Callout pill: who, how many sites, which hazards (as color dots). */}
      <div
        ref={(el) => refs('pill', el)}
        className="absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-ink-900/80 px-2.5 py-1 opacity-0 shadow-panel backdrop-blur-sm will-change-transform"
        style={{ borderColor: `${color}99` }}
      >
        <span aria-hidden className="text-[12px] leading-none">{g.group.icon}</span>
        <span className="text-[11px] font-semibold text-white/90">{g.group.name}</span>
        <span className="text-[9px] tabular-nums text-white/35">
          {g.affectedCount}/{g.group.locations.length}
        </span>
        {g.fireCount > 0 && (
          <span className="text-[10px] font-bold text-accent-warn">
            <span aria-hidden>🔥</span>
            {g.fireCount}
          </span>
        )}
        {g.quakeCount > 0 && (
          <span className="text-[10px] font-bold" style={{ color: quakeColor(g.maxQuakeMag) }}>
            <span aria-hidden>◎</span>M{g.maxQuakeMag.toFixed(1)}
          </span>
        )}
        {g.alerts.length > 0 && (
          <span className="flex items-center gap-1">
            {g.alerts.slice(0, 4).map((a) => (
              <span
                key={a.event}
                title={a.event}
                className="h-2 w-2 rounded-full"
                style={{ background: a.colorHex }}
              />
            ))}
            {g.alerts.length > 4 && (
              <span className="text-[9px] text-white/40">+{g.alerts.length - 4}</span>
            )}
          </span>
        )}
      </div>
    </>
  );
}
