import { useShallow } from 'zustand/react/shallow';
import { useLayersStore } from '../store/layersStore';
import { useRoadsStatus } from '../layers/roads/roadsStore';
import { LayerToggle } from '../ui/LayerToggle';
import { Section } from '../ui/Section';
import { useUiStore } from '../ui/uiStore';
import { useNpsStore } from './npsStore';
import { openNpsPanel } from './openNpsPanel';
import { NPS_GREEN } from './npsMeta';

// The sidebar's home for the national-park feeds: the road-closures layer,
// the way into the National Parks panel (alerts and news), and whether park
// items run in the ticker.
export function NationalParksSection() {
  const roadsOn = useLayersStore((s) => s.active.roads);
  const toggleLayer = useLayersStore((s) => s.toggleLayer);
  const roads = useRoadsStatus(
    useShallow((s) => ({ closed: s.closed, restricted: s.restricted, sources: s.sources, error: s.error }))
  );
  const inTicker = useNpsStore((s) => s.inTicker);
  const setInTicker = useNpsStore((s) => s.setInTicker);
  const alertCount = useNpsStore((s) => s.feed?.alerts?.length ?? null);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const roadsText =
    roads.error ??
    `${roads.closed} closed · ${roads.restricted} restricted${roads.sources.some((s) => !s.ok && !s.disabled) ? ' · a source is down' : ''}`;

  return (
    <Section title="National Parks">
      <div className="px-1">
        <button
          onClick={() => {
            openNpsPanel();
            setSidebarOpen(false); // dismiss the drawer on mobile
          }}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-white/5"
          title="Open the National Parks panel"
        >
          <span className="text-[13px] text-white/85">Park alerts &amp; news</span>
          <span className="flex items-center gap-1.5 text-[11px] text-white/40">
            {alertCount !== null && (
              <span className="rounded-full px-1.5 tabular-nums" style={{ color: NPS_GREEN, background: `${NPS_GREEN}1f` }}>
                {alertCount} alert{alertCount === 1 ? '' : 's'}
              </span>
            )}
            Open ›
          </span>
        </button>
      </div>
      <LayerToggle label="Road closures" active={roadsOn} onToggle={() => toggleLayer('roads')} statusText={roadsText}>
        {roads.sources.length > 0 && (
          <ul className="space-y-0.5 pt-1 text-[10.5px]">
            {roads.sources.map((s) => (
              <li key={s.source} className="flex items-baseline justify-between gap-2" title={s.error ?? s.disabled ?? undefined}>
                <span className="truncate text-white/50">{s.label}</span>
                <span className={`shrink-0 ${s.ok ? 'text-white/35' : s.disabled ? 'text-white/25' : 'text-accent-danger/80'}`}>
                  {s.ok ? s.count : s.disabled ? 'off' : 'unavailable'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="pt-1.5 text-[10px] leading-relaxed text-white/30">
          Closures and restrictions in force around Glacier, Yellowstone, Grand Canyon, Death Valley, Rocky
          Mountain and Mount Rushmore, including their access highways. Solid red = closed; dashed amber =
          restricted.
        </p>
      </LayerToggle>
      <label className="flex cursor-pointer items-center gap-2 px-3 py-1 text-[12px] text-white/65">
        <input
          type="checkbox"
          checked={inTicker}
          onChange={(e) => setInTicker(e.target.checked)}
          className="accent-emerald-400"
        />
        Park alerts &amp; news in the ticker
      </label>
    </Section>
  );
}
