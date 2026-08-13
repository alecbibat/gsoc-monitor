import { createPortal } from 'react-dom';
import { useCrisisStore, incidentOfLayer, type DrawLayerType } from './crisisStore';
import { incidentStatusDef } from './taxonomy';

const TYPE_LABEL: Record<DrawLayerType, string> = {
  'fire-perimeter': 'Fire Perimeter',
  'burned-area': 'Burned Area',
  'flood-zone': 'Flood Zone',
  'staging-area': 'Staging Area',
  'exclusion-zone': 'Exclusion Zone',
  'search-grid': 'Search Grid',
  'other': 'Other',
};

const POPUP_W = 248;

export function CrisisLayerPopup() {
  const picked = useCrisisStore((s) => s.pickedLayer);
  const found = useCrisisStore((s) => {
    if (!s.pickedLayer) return null;
    const inc = incidentOfLayer(s, s.pickedLayer.layerId);
    const layer = inc?.drawLayers.find((l) => l.id === s.pickedLayer!.layerId) ?? null;
    return inc && layer ? { inc, layer } : null;
  });
  const openIncident = useCrisisStore((s) => s.openIncident);
  const setPickedLayer = useCrisisStore((s) => s.setPickedLayer);

  if (!picked || !found) return null;
  const { inc, layer } = found;

  const left = Math.max(8, Math.min(picked.x + 14, window.innerWidth - POPUP_W - 8));
  const top = Math.max(8, Math.min(picked.y - 10, window.innerHeight - 200));

  return createPortal(
    <div
      className="fixed z-[1500] overflow-hidden rounded-xl border border-white/15 bg-ink-950/95 shadow-2xl backdrop-blur-md"
      style={{ left, top, width: POPUP_W }}
    >
      {/* Color bar */}
      <div className="h-1 w-full" style={{ background: layer.color }} />

      <div className="p-3.5">
        {/* Layer */}
        <div className="flex items-start gap-2">
          <div className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white/90">{layer.name}</div>
            <div className="text-[10px] text-white/40">
              {TYPE_LABEL[layer.type]} · {layer.geometry} · {layer.positions.length} pts
            </div>
          </div>
          <button
            onClick={() => setPickedLayer(null)}
            className="shrink-0 text-[12px] text-white/30 transition hover:text-white/60"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Incident */}
        <div className="mt-3 rounded-lg border border-white/8 bg-white/5 px-2.5 py-2">
          <div className="mb-1 text-[8px] font-bold uppercase tracking-[0.16em] text-white/30">
            Part of incident
          </div>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/85">
              {inc.incidentName || 'Untitled Incident'}
            </span>
            <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${incidentStatusDef(inc.incidentStatus).badge}`}>
              {incidentStatusDef(inc.incidentStatus).label}
            </span>
          </div>
        </div>

        {/* Open */}
        <button
          onClick={() => { openIncident(inc.id); setPickedLayer(null); }}
          className="mt-2.5 w-full rounded-lg border border-accent/30 bg-accent/12 py-1.5 text-[11px] font-medium text-accent transition hover:border-accent/50 hover:bg-accent/20"
        >
          Open incident →
        </button>
      </div>
    </div>,
    document.body
  );
}
