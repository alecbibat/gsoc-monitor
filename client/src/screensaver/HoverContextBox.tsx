import { useEffect, useState } from 'react';
import { useHoverStore } from './hoverStore';
import { ContextMiniMap } from './ContextMiniMap';
import { reverseGeocode } from './reverseGeocode';

// Context minimap for the hover orbit — the same affordance the pins screensaver
// gets, but centred on the user-picked orbit point and labelled with a
// reverse-geocoded place name.
export function HoverContextBox() {
  const active = useHoverStore((s) => s.active);
  const point = useHoverStore((s) => s.point);
  const [geoLabel, setGeoLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!point) {
      setGeoLabel(null);
      return;
    }
    const ctrl = new AbortController();
    reverseGeocode(point.lat, point.lon, ctrl.signal).then((label) => {
      if (!ctrl.signal.aborted) setGeoLabel(label);
    });
    return () => ctrl.abort();
  }, [point?.lat, point?.lon]);

  const visible = active && point !== null;

  return (
    <div
      className={`pointer-events-none absolute bottom-12 right-6 z-30 transition-all duration-500 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {point && (
        <ContextMiniMap lat={point.lat} lon={point.lon}>
          <div className="truncate text-[10px] font-medium text-white/80">
            {geoLabel ?? 'Orbit point'}
          </div>
        </ContextMiniMap>
      )}
    </div>
  );
}
