import { useEffect, useState } from 'react';
import { useScreensaverStore, type Poi } from './screensaverStore';
import { FLEET_ROSTER, fleetColor } from '../layers/ships/fleet';
import { ShipModel3D } from '../layers/ships/ShipModel3D';

// Bottom-centre card shown while orbiting a Windstar ship in the pins
// screensaver. Displays a live-rotating 3D wireframe, class badge, and
// current speed/heading.
export function ShipFocusCard() {
  const active = useScreensaverStore((s) => s.active);
  const mode   = useScreensaverStore((s) => s.mode);
  const poi    = useScreensaverStore((s) => s.currentPoi);

  const isPins = active && mode === 'pins';

  // Retain the last ship POI so the card fades out with content intact
  // during the brief gap between locations.
  const [shown, setShown] = useState<Poi | null>(null);
  useEffect(() => {
    if (poi?.category === 'ship') setShown(poi);
  }, [poi]);

  if (!isPins || !shown || shown.category !== 'ship') return null;
  const visible = poi?.category === 'ship';

  const mmsi    = shown.meta?.mmsi as string | undefined;
  const speedKt = shown.meta?.speedKt as number | null | undefined;
  const heading = shown.meta?.heading as number | null | undefined;
  const cls     = shown.meta?.cls as 'STAR' | 'WIND' | undefined;

  const fleet = mmsi ? FLEET_ROSTER.find((f) => f.mmsi === mmsi) : undefined;
  const resolvedCls = cls ?? fleet?.cls;
  const color = resolvedCls ? fleetColor(resolvedCls) : '#8fc7d9';

  return (
    <div
      className={`pointer-events-none absolute bottom-14 left-1/2 z-30 w-[min(400px,calc(100vw-2rem))] -translate-x-1/2 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <div
        className="overflow-hidden rounded-xl border bg-ink-900/90 shadow-2xl backdrop-blur-md"
        style={{ borderColor: `${color}55` }}
      >
        {/* Header row */}
        <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1">
          <span aria-hidden className="text-[15px]">🚢</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/90">
            {shown.title}
          </span>
          {resolvedCls && (
            <span
              className="shrink-0 rounded px-2 py-0.5 text-[9px] font-bold tracking-[0.13em]"
              style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
            >
              {resolvedCls} CLASS
            </span>
          )}
        </div>

        {/* Rotating 3D wireframe */}
        <div className="flex justify-center px-3.5">
          {resolvedCls && (
            <ShipModel3D
              variant={resolvedCls === 'STAR' ? 'star' : 'wind'}
              color={color}
              width={310}
              height={116}
            />
          )}
        </div>

        {/* Speed / heading row */}
        <div className="flex items-center gap-3 px-3.5 pb-2.5 text-[11px] text-white/50">
          {speedKt != null && speedKt > 0.5 ? (
            <span className="font-mono text-white/80">{speedKt.toFixed(1)} kt</span>
          ) : (
            <span>At anchor or slow</span>
          )}
          {heading != null && (
            <span className="font-mono">{Math.round(heading)}°</span>
          )}
        </div>
      </div>
    </div>
  );
}
