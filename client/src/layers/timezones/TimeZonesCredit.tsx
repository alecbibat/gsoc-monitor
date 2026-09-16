import { useLayersStore } from '../../store/layersStore';

// The zone polygons are OpenStreetMap data (via timezone-boundary-builder),
// and the ODbL asks for a notice wherever they are shown. The legend card
// carries the full credit, but MapLegends hides with the rest of the chrome
// in screensaver / hover modes while the polygons stay on the globe — so this
// one line stays up as long as the layer is on.
export function TimeZonesCredit() {
  const active = useLayersStore((s) => s.active.timezones);
  if (!active) return null;
  return (
    <div className="pointer-events-auto self-end rounded bg-ink-900/70 px-1.5 py-0.5 text-[9px] leading-tight text-white/40 backdrop-blur-sm">
      Time zones ©{' '}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-white/20 hover:text-white/70"
      >
        OpenStreetMap contributors
      </a>{' '}
      · ODbL
    </div>
  );
}
