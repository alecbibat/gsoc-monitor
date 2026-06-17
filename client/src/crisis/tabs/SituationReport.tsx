import { useState } from 'react';
import { useCrisisStore, type IncidentType, type IncidentStatus, type DrawLayerType } from '../crisisStore';
import { IcsOrgChart } from '../IcsOrgChart';
import { ActionLog } from '../ActionLog';

const STATUS_STYLES: Record<IncidentStatus, string> = {
  active:    'border-red-500/50 bg-red-500/15 text-red-400',
  contained: 'border-amber-400/50 bg-amber-400/15 text-amber-300',
  resolved:  'border-green-500/50 bg-green-500/15 text-green-400',
};

const INCIDENT_TYPES: { value: IncidentType; label: string }[] = [
  { value: 'other',          label: 'Other' },
  { value: 'wildfire',       label: 'Wildfire' },
  { value: 'hurricane',      label: 'Hurricane / Tropical Storm' },
  { value: 'earthquake',     label: 'Earthquake' },
  { value: 'flood',          label: 'Flood' },
  { value: 'chemical',       label: 'Chemical / HazMat Spill' },
  { value: 'mass-casualty',  label: 'Mass Casualty Incident' },
  { value: 'cyber',          label: 'Cyber Incident' },
  { value: 'security',       label: 'Security / Active Threat' },
  { value: 'severe-weather', label: 'Severe Weather' },
];

const DRAW_LAYER_TYPES: { value: DrawLayerType; label: string; color: string }[] = [
  { value: 'fire-perimeter', label: 'Fire Perimeter',  color: '#ef4444' },
  { value: 'burned-area',    label: 'Burned Area',     color: '#92400e' },
  { value: 'flood-zone',     label: 'Flood Zone',      color: '#3b82f6' },
  { value: 'staging-area',   label: 'Staging Area',    color: '#22c55e' },
  { value: 'exclusion-zone', label: 'Exclusion Zone',  color: '#f97316' },
  { value: 'search-grid',    label: 'Search Grid',     color: '#ffffff' },
  { value: 'other',          label: 'Other',           color: '#a855f7' },
];

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <label className="w-24 shrink-0 pt-2 text-[10px] text-white/40">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="flex-1 rounded border border-white/8 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/80 placeholder-white/20 outline-none transition focus:border-white/20 focus:bg-white/8"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// ── Map Layers section ────────────────────────────────────────────────────────

function MapLayersSection() {
  const drawLayers = useCrisisStore((s) => s.drawLayers);
  const { addDrawLayer, updateDrawLayer, removeDrawLayer, setActiveDrawLayer, close } = useCrisisStore();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<DrawLayerType>('fire-perimeter');
  const defaultColor = DRAW_LAYER_TYPES.find((t) => t.value === newType)?.color ?? '#ef4444';
  const [newColor, setNewColor] = useState(defaultColor);

  const startCreate = () => {
    const t = newName.trim();
    if (!t) return;
    addDrawLayer({
      name: t,
      type: newType,
      color: newColor,
      visible: true,
      positions: [],
      closed: true,
    });
    setNewName('');
    setCreating(false);
  };

  const startDraw = (layerId: string) => {
    setActiveDrawLayer(layerId);
    close();
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
          Map Layers
        </h3>
        <span className="text-[9px] text-white/20">
          Draw on the live map — layers stay visible while the incident is active
        </span>
        <button
          onClick={() => setCreating((v) => !v)}
          className="ml-auto rounded border border-white/10 px-2.5 py-1 text-[9px] text-white/40 transition hover:border-white/20 hover:text-white/60"
        >
          {creating ? 'Cancel' : '+ New Layer'}
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="mb-3 rounded-lg border border-white/10 bg-white/3 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              className="flex-1 rounded border border-white/8 bg-white/5 px-2 py-1.5 text-[12px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
              placeholder="Layer name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startCreate()}
            />
            <select
              className="rounded border border-white/8 bg-ink-900 px-2 py-1.5 text-[11px] text-white/70 outline-none"
              value={newType}
              onChange={(e) => {
                const t = e.target.value as DrawLayerType;
                setNewType(t);
                setNewColor(DRAW_LAYER_TYPES.find((x) => x.value === t)?.color ?? '#a855f7');
              }}
            >
              {DRAW_LAYER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <label className="text-[9px] text-white/30">Color</label>
              <input
                type="color"
                className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </div>
            <button
              onClick={startCreate}
              disabled={!newName.trim()}
              className="rounded bg-accent/15 px-3 py-1.5 text-[10px] text-accent transition hover:bg-accent/25 disabled:opacity-30"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Layer list */}
      <div className="space-y-1.5 rounded-lg border border-white/8 bg-ink-950/60 p-3">
        {drawLayers.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-white/25">
            No map layers — create one above and draw on the live map
          </p>
        ) : (
          drawLayers.map((layer) => (
            <div key={layer.id} className="flex items-center gap-2 rounded border border-white/6 bg-white/3 px-3 py-2">
              {/* Color dot */}
              <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color }} />

              {/* Name + type */}
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-white/75">{layer.name}</span>
                <span className="ml-2 text-[9px] text-white/30">
                  {DRAW_LAYER_TYPES.find((t) => t.value === layer.type)?.label}
                </span>
                {layer.positions.length > 0 && (
                  <span className="ml-2 text-[9px] text-white/25">
                    {layer.positions.length} pts
                  </span>
                )}
              </div>

              {/* Visible toggle */}
              <button
                onClick={() => updateDrawLayer(layer.id, { visible: !layer.visible })}
                className={`text-[11px] transition ${layer.visible ? 'text-white/50 hover:text-white/75' : 'text-white/20 hover:text-white/40'}`}
                title={layer.visible ? 'Hide' : 'Show'}
              >
                {layer.visible ? '👁' : '🚫'}
              </button>

              {/* Draw */}
              <button
                onClick={() => startDraw(layer.id)}
                className="rounded border border-accent/25 bg-accent/8 px-2 py-0.5 text-[9px] text-accent/70 transition hover:border-accent/40 hover:text-accent"
              >
                Draw
              </button>

              {/* Delete */}
              <button
                onClick={() => {
                  if (confirm(`Remove layer "${layer.name}"?`)) removeDrawLayer(layer.id);
                }}
                className="text-[11px] text-white/20 transition hover:text-red-400/70"
                title="Delete layer"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SituationReport() {
  const store = useCrisisStore();

  return (
    <div className="space-y-6">

      {/* Row 1: Executive Summary + Incident Information */}
      <div className="grid grid-cols-2 gap-5">

        {/* Executive Summary */}
        <section className="flex flex-col">
          <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
            Executive Summary
          </h3>
          <textarea
            className="flex-1 resize-none rounded-lg border border-white/10 bg-white/4 px-3.5 py-3 text-[13px] leading-relaxed text-white/80 placeholder-white/20 outline-none transition focus:border-white/20 focus:bg-white/5"
            placeholder="Provide a concise summary of the incident, current situation, key impacts, and priority actions required. Update as conditions evolve."
            value={store.executiveSummary}
            onChange={(e) => store.update({ executiveSummary: e.target.value })}
            rows={9}
          />
        </section>

        {/* Incident Information */}
        <section>
          <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
            Incident Information
          </h3>
          <div className="space-y-2.5 rounded-lg border border-white/10 bg-white/4 p-4">

            <FieldRow label="Name">
              <TextInput
                value={store.incidentName}
                onChange={(v) => store.update({ incidentName: v })}
                placeholder="e.g. Maui Wildfire Complex"
              />
            </FieldRow>

            <FieldRow label="Date / Time">
              <input
                type="datetime-local"
                className="flex-1 rounded border border-white/8 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/80 outline-none transition focus:border-white/20 focus:bg-white/8"
                value={store.incidentDatetime}
                onChange={(e) => store.update({ incidentDatetime: e.target.value })}
              />
            </FieldRow>

            <FieldRow label="Location">
              <TextInput
                value={store.incidentLocation}
                onChange={(v) => store.update({ incidentLocation: v })}
                placeholder="Affected area or address"
              />
            </FieldRow>

            <FieldRow label="Type">
              <select
                className="flex-1 rounded border border-white/8 bg-ink-900 px-2.5 py-1.5 text-[12px] text-white/80 outline-none transition focus:border-white/20"
                value={store.incidentType}
                onChange={(e) =>
                  store.update({ incidentType: e.target.value as IncidentType })
                }
              >
                {INCIDENT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Status">
              <div className="flex flex-wrap gap-2">
                {(['active', 'contained', 'resolved'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => store.update({ incidentStatus: s })}
                    className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition ${
                      store.incidentStatus === s
                        ? STATUS_STYLES[s]
                        : 'border-white/10 text-white/30 hover:border-white/20 hover:text-white/50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </FieldRow>

          </div>
        </section>
      </div>

      {/* ICS / NIMS Org Chart */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
            ICS / NIMS Organizational Structure
          </h3>
          <span className="text-[9px] text-white/20">
            Click any role to assign personnel or edit
          </span>
        </div>
        <div className="rounded-lg border border-white/8 bg-ink-950/60 px-6 py-5">
          <IcsOrgChart />
        </div>
      </section>

      {/* Actions & Events Log */}
      <ActionLog />

      {/* Map Layers */}
      <MapLayersSection />

    </div>
  );
}
