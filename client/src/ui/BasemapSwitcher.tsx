import { BASEMAPS } from '../cesium/basemaps';
import { useLayersStore } from '../store/layersStore';
import type { BasemapId } from '../types';

const ORDER: BasemapId[] = ['dark', 'light', 'satellite', 'topo'];

export function BasemapSwitcher() {
  const basemap = useLayersStore((s) => s.basemap);
  const setBasemap = useLayersStore((s) => s.setBasemap);

  return (
    <div className="grid grid-cols-4 gap-1.5">
      {ORDER.map((id) => (
        <button
          key={id}
          onClick={() => setBasemap(id)}
          className={`rounded-md px-1.5 py-1.5 text-[11px] font-medium transition ${
            basemap === id
              ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
              : 'bg-white/5 text-white/55 hover:bg-white/10'
          }`}
        >
          {BASEMAPS[id].label}
        </button>
      ))}
    </div>
  );
}
