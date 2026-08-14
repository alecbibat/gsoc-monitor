import { useState, useRef, useEffect } from 'react';
import {
  useCrisisStore, useActiveIncident, COMPLEXITY_TYPES,
  type IncidentType, type DrawLayerType, type DrawGeometry, type DrawLayer,
} from '../crisisStore';
import { INCIDENT_CATEGORIES, INCIDENT_STATUSES, incidentTypesInCategory } from '../taxonomy';
import { IcsOrgChart } from '../IcsOrgChart';
import { ActionLog } from '../ActionLog';
import { parseCoords } from '../parseCoords';
import { SHARE_LIVE_LAYER_GROUPS, isShareLiveLayerId } from '../shareLiveLayers';
import { LOCATION_GROUPS } from '../../layers/locations/locations';

const DRAW_LAYER_TYPES: { value: DrawLayerType; label: string; color: string }[] = [
  { value: 'fire-perimeter', label: 'Fire Perimeter',  color: '#ef4444' },
  { value: 'burned-area',    label: 'Burned Area',     color: '#92400e' },
  { value: 'flood-zone',     label: 'Flood Zone',      color: '#3b82f6' },
  { value: 'staging-area',   label: 'Staging Area',    color: '#22c55e' },
  { value: 'exclusion-zone', label: 'Exclusion Zone',  color: '#f97316' },
  { value: 'search-grid',    label: 'Search Grid',     color: '#ffffff' },
  { value: 'other',          label: 'Other',           color: '#a855f7' },
];

const GEOMETRIES: { value: DrawGeometry; label: string; hint: string }[] = [
  { value: 'polygon', label: 'Area',  hint: 'Filled zone' },
  { value: 'line',    label: 'Line',  hint: 'Path / boundary' },
  { value: 'point',   label: 'Point', hint: 'Single marker' },
];

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <label className="w-24 shrink-0 pt-2 text-[10px] text-white/45">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="flex-1 rounded border border-white/10 bg-white/10 px-2.5 py-1.5 text-[12px] text-white/85 placeholder-white/30 outline-none transition focus:border-white/25 focus:bg-white/15"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// ── Coord import panel ────────────────────────────────────────────────────────

const COORD_HINT: Record<DrawGeometry, string> = {
  polygon: 'Paste one lat, lon pair per line to draw the polygon outline.',
  line:    'Paste one lat, lon pair per line for each waypoint along the line.',
  point:   'Paste a single lat, lon pair for the marker location.',
};

const COORD_EXAMPLE: Record<DrawGeometry, string> = {
  polygon: '34.0522, -118.2437\n34.0531, -118.2301\n34.0412, -118.2285\n34.0398, -118.2420',
  line:    '34.0522, -118.2437\n34.0531, -118.2301\n34.0412, -118.2285',
  point:   '34.0522, -118.2437',
};

function CoordImportPanel({ layer, onClose }: { layer: DrawLayer; onClose: () => void }) {
  const updateDrawLayer = useCrisisStore((s) => s.updateDrawLayer);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  const geom = layer.geometry;

  const handleChange = (v: string) => {
    setRaw(v);
    setError(null);
    setPreview(null);
    if (!v.trim()) return;
    const result = parseCoords(v);
    if (result.points.length > 0) setPreview(result.points.length);
    if (result.error && result.points.length === 0) setError(result.error);
  };

  const handleApply = () => {
    const result = parseCoords(raw);
    if (result.points.length === 0) {
      setError(result.error ?? 'No valid coordinates found.');
      return;
    }
    const pts = geom === 'point' ? [result.points[0]] : result.points;
    updateDrawLayer(layer.id, { positions: pts });
    onClose();
  };

  return (
    <div className="mt-1.5 rounded-lg border border-white/10 bg-white/4 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold text-white/55">Import coordinates</p>
          <p className="text-[9px] text-white/30 mt-0.5">{COORD_HINT[geom]}</p>
        </div>
        <button onClick={onClose} className="mt-0.5 text-white/25 hover:text-white/55 text-[11px]">✕</button>
      </div>

      <textarea
        ref={taRef}
        className="w-full resize-none rounded border border-white/10 bg-white/8 px-2.5 py-2 font-mono text-[11px] text-white/80 outline-none placeholder-white/20 focus:border-white/20"
        rows={geom === 'point' ? 2 : 5}
        placeholder={COORD_EXAMPLE[geom]}
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleApply();
        }}
        spellCheck={false}
      />

      <div className="flex items-center gap-2">
        {preview !== null && !error && (
          <span className="text-[9px] text-accent-ok">
            ✓ {preview} point{preview !== 1 ? 's' : ''} parsed
            {geom === 'point' && preview > 1 ? ' — first point will be used' : ''}
          </span>
        )}
        {error && (
          <span className="text-[9px] text-red-400/80">{error}</span>
        )}
        <div className="ml-auto flex gap-2">
          <p className="self-center text-[8px] text-white/20">⌘ Enter to apply</p>
          <button
            onClick={handleApply}
            disabled={!raw.trim()}
            className="rounded bg-accent/20 px-3 py-1 text-[10px] text-accent transition hover:bg-accent/30 disabled:opacity-30"
          >
            Apply
          </button>
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-[8px] text-white/20 hover:text-white/40 list-none flex items-center gap-1">
          <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
          Accepted formats
        </summary>
        <div className="mt-1.5 space-y-1 rounded border border-white/8 bg-white/3 px-3 py-2">
          {[
            ['Decimal degrees (Google Maps)', '37.7749, -122.4194'],
            ['With cardinal letters', '37.7749° N, 122.4194° W'],
            ['DMS', '37° 46\' 29" N, 122° 25\' 16" W'],
            ['WKT (lon lat order)', 'POLYGON ((-122.4 37.7, -122.3 37.8, ...))'],
          ].map(([fmt, ex]) => (
            <div key={fmt} className="flex flex-col gap-0.5">
              <span className="text-[8px] text-white/30">{fmt}</span>
              <code className="text-[8px] text-white/50 font-mono">{ex}</code>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ── Map Layers section ────────────────────────────────────────────────────────

function MapLayersSection() {
  const inc = useActiveIncident();
  const addDrawLayer    = useCrisisStore((s) => s.addDrawLayer);
  const updateDrawLayer = useCrisisStore((s) => s.updateDrawLayer);
  const removeDrawLayer = useCrisisStore((s) => s.removeDrawLayer);
  const setActiveDrawLayer = useCrisisStore((s) => s.setActiveDrawLayer);
  const close = useCrisisStore((s) => s.close);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<DrawLayerType>('fire-perimeter');
  const [newGeom, setNewGeom] = useState<DrawGeometry>('polygon');
  const defaultColor = DRAW_LAYER_TYPES.find((t) => t.value === newType)?.color ?? '#ef4444';
  const [newColor, setNewColor] = useState(defaultColor);
  const [coordLayerId, setCoordLayerId] = useState<string | null>(null);

  const drawLayers = inc?.drawLayers ?? [];

  const startCreate = () => {
    const t = newName.trim();
    if (!t) return;
    addDrawLayer({ name: t, type: newType, geometry: newGeom, color: newColor, visible: true, positions: [] });
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
        <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">Map Layers</h3>
        <span className="text-[11px] text-white/40">Draw on the live map — layers stay visible while the incident is active</span>
        <button
          onClick={() => setCreating((v) => !v)}
          className="ml-auto rounded border border-white/12 px-2.5 py-1 text-[9px] text-white/45 transition hover:border-white/25 hover:text-white/70"
        >
          {creating ? 'Cancel' : '+ New Layer'}
        </button>
      </div>

      {creating && (
        <div className="mb-3 space-y-2.5 rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              className="flex-1 rounded border border-white/10 bg-white/10 px-2 py-1.5 text-[12px] text-white/85 outline-none placeholder-white/30 focus:border-white/25 focus:bg-white/15"
              placeholder="Layer name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && startCreate()}
            />
            <select
              className="rounded border border-white/10 bg-ink-900 px-2 py-1.5 text-[11px] text-white/75 outline-none"
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
              <label className="text-[9px] text-white/35">Color</label>
              <input
                type="color"
                className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
              />
            </div>
          </div>

          {/* Geometry picker */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-wider text-white/35">Shape</span>
            <div className="flex gap-1">
              {GEOMETRIES.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setNewGeom(g.value)}
                  title={g.hint}
                  className={`rounded border px-2.5 py-1 text-[10px] transition ${
                    newGeom === g.value
                      ? 'border-accent/40 bg-accent/15 text-accent'
                      : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/65'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <button
              onClick={startCreate}
              disabled={!newName.trim()}
              className="ml-auto rounded bg-accent/20 px-3 py-1.5 text-[10px] text-accent transition hover:bg-accent/30 disabled:opacity-30"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5 rounded-lg border border-white/8 bg-ink-950/60 p-3">
        {drawLayers.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-white/30">
            No map layers — create one above and draw on the live map
          </p>
        ) : (
          drawLayers.map((layer) => (
            <div key={layer.id} className="rounded border border-white/8 bg-white/5">
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: layer.color }} />
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] text-white/80">{layer.name}</span>
                  <span className="ml-2 text-[9px] text-white/35">
                    {DRAW_LAYER_TYPES.find((t) => t.value === layer.type)?.label} · {layer.geometry}
                  </span>
                  {layer.positions.length > 0 && (
                    <span className="ml-2 text-[9px] text-white/30">{layer.positions.length} pts</span>
                  )}
                </div>
                <button
                  onClick={() => updateDrawLayer(layer.id, { visible: !layer.visible })}
                  className={`text-[11px] transition ${layer.visible ? 'text-white/55 hover:text-white/80' : 'text-white/20 hover:text-white/40'}`}
                  title={layer.visible ? 'Hide' : 'Show'}
                  aria-label={layer.visible ? `Hide layer ${layer.name}` : `Show layer ${layer.name}`}
                  aria-pressed={layer.visible}
                >
                  <span aria-hidden="true">{layer.visible ? '👁' : '🚫'}</span>
                </button>
                <button
                  onClick={() => setCoordLayerId((id) => id === layer.id ? null : layer.id)}
                  className={`rounded border px-2 py-0.5 text-[9px] transition ${
                    coordLayerId === layer.id
                      ? 'border-white/25 bg-white/10 text-white/70'
                      : 'border-white/12 text-white/35 hover:border-white/22 hover:text-white/60'
                  }`}
                  title="Import from coordinates"
                >
                  Coords
                </button>
                <button
                  onClick={() => startDraw(layer.id)}
                  className="rounded border border-accent/25 bg-accent/10 px-2 py-0.5 text-[9px] text-accent/80 transition hover:border-accent/40 hover:text-accent"
                >
                  {layer.positions.length > 0 ? 'Redraw' : 'Draw'}
                </button>
                <button
                  onClick={() => { if (confirm(`Remove layer "${layer.name}"?`)) removeDrawLayer(layer.id); }}
                  className="text-[11px] text-white/25 transition hover:text-red-400/70"
                  title="Delete layer"
                  aria-label={`Delete layer ${layer.name}`}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
              {coordLayerId === layer.id && (
                <div className="border-t border-white/8 px-3 pb-3">
                  <CoordImportPanel layer={layer} onClose={() => setCoordLayerId(null)} />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ── Share-map live layers section ─────────────────────────────────────────────

function LiveLayersSection() {
  const inc = useActiveIncident();
  const toggleLiveLayer = useCrisisStore((s) => s.toggleLiveLayer);
  const toggleExtraLocationGroup = useCrisisStore((s) => s.toggleExtraLocationGroup);
  // Persisted incidents can prescribe layer ids removed in a later release
  // (they outlive deploys); count only the ones that still exist, matching
  // what the share globe actually renders (CrisisShareView filters the same
  // way) — otherwise the "N live" badge overcounts with no button to clear it.
  const selected = new Set((inc?.liveLayers ?? []).filter(isShareLiveLayerId));
  const primaryGroupId = inc?.locationGroupId ?? null;
  const extraGroups = new Set(inc?.extraLocationGroups ?? []);

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">Live Data Layers</h3>
        <span className="text-[11px] text-white/40">
          Shown on the interactive share-link map — viewers see them update in real time
        </span>
        {selected.size > 0 && (
          <span className="ml-auto flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/8 px-2 py-0.5 text-[9px] text-green-400/80">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            {selected.size} live
          </span>
        )}
      </div>

      <div className="space-y-3.5 rounded-lg border border-white/8 bg-ink-950/60 p-3">
        {SHARE_LIVE_LAYER_GROUPS.map((group) => (
          <div key={group.name}>
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/30">{group.name}</p>
            <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
              {group.layers.map((l) => {
                const on = selected.has(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLiveLayer(l.id)}
                    aria-pressed={on}
                    className={`rounded border px-2.5 py-1.5 text-left transition ${
                      on
                        ? 'border-accent/40 bg-accent/12'
                        : 'border-white/10 bg-white/4 hover:border-white/22'
                    }`}
                  >
                    <span className={`block text-[11px] leading-tight ${on ? 'text-accent' : 'text-white/70'}`}>
                      {l.label}
                    </span>
                    <span className="mt-0.5 block text-[8px] leading-tight text-white/30">{l.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-white/30">Property Pins</p>
          <div className="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
            {LOCATION_GROUPS.map((g) => {
              const isPrimary = g.id === primaryGroupId;
              const on = isPrimary || extraGroups.has(g.id);
              return (
                <button
                  key={g.id}
                  onClick={() => { if (!isPrimary) toggleExtraLocationGroup(g.id); }}
                  disabled={isPrimary}
                  aria-pressed={on}
                  title={isPrimary ? 'Incident property — set in Incident Information' : 'Also show this group’s pins on the share map'}
                  className={`rounded border px-2.5 py-1.5 text-left transition ${
                    on
                      ? 'border-accent/40 bg-accent/15'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                  } ${isPrimary ? 'cursor-default' : ''}`}
                >
                  <span className={`block text-[11px] leading-tight ${on ? 'text-accent' : 'text-white/70'}`}>
                    {g.icon} {g.name}
                  </span>
                  <span className="mt-0.5 block text-[8px] leading-tight text-white/30">
                    {isPrimary ? 'Incident property' : `${g.locations.length} location${g.locations.length === 1 ? '' : 's'}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-[9px] leading-relaxed text-white/25">
          Selected layers render on a live interactive globe on every active share link for this
          incident, alongside the drawn map layers above. The incident property and any additional
          groups appear as pins and scope the shared Property Watch. Changes apply to viewers
          within seconds.
        </p>
      </div>
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SituationReport() {
  const inc = useActiveIncident();
  const update = useCrisisStore((s) => s.update);

  if (!inc) return null;

  return (
    <div className="space-y-6">

      {/* Row 1: Executive Summary + Incident Information */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">

        <section className="flex flex-col">
          <h3 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">Executive Summary</h3>
          <textarea
            className="flex-1 resize-none rounded-lg border border-white/12 bg-white/8 px-3.5 py-3 text-[13px] leading-relaxed text-white/85 placeholder-white/30 outline-none transition focus:border-white/25 focus:bg-white/12"
            placeholder="Provide a concise summary of the incident, current situation, key impacts, and priority actions required. Update as conditions evolve."
            value={inc.executiveSummary}
            onChange={(e) => update({ executiveSummary: e.target.value })}
            rows={8}
          />
        </section>

        <section>
          <h3 className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">Incident Information</h3>
          <div className="space-y-2.5 rounded-lg border border-white/12 bg-white/8 p-4">
            <FieldRow label="Name">
              <TextInput value={inc.incidentName} onChange={(v) => update({ incidentName: v })} placeholder="e.g. Maui Wildfire Complex" />
            </FieldRow>

            <FieldRow label="Start">
              <input
                type="datetime-local"
                className="flex-1 rounded border border-white/10 bg-white/10 px-2.5 py-1.5 text-[12px] text-white/85 outline-none transition focus:border-white/25 focus:bg-white/15"
                value={inc.incidentDatetime}
                onChange={(e) => update({ incidentDatetime: e.target.value })}
              />
            </FieldRow>

            <FieldRow label="End">
              <input
                type="datetime-local"
                className="flex-1 rounded border border-white/10 bg-white/10 px-2.5 py-1.5 text-[12px] text-white/85 outline-none transition focus:border-white/25 focus:bg-white/15"
                value={inc.incidentEndDatetime ?? ''}
                min={inc.incidentDatetime || undefined}
                onChange={(e) => update({ incidentEndDatetime: e.target.value })}
              />
            </FieldRow>

            <FieldRow label="Location">
              <TextInput value={inc.incidentLocation} onChange={(v) => update({ incidentLocation: v })} placeholder="Affected area or address" />
            </FieldRow>

            <FieldRow label="Property">
              <select
                className="flex-1 rounded border border-white/10 bg-ink-900 px-2.5 py-1.5 text-[12px] text-white/85 outline-none transition focus:border-white/25"
                value={inc.locationGroupId ?? ''}
                onChange={(e) => update({ locationGroupId: e.target.value || null })}
                title="Property group affected by this incident — its pins appear on the share-link map and scope the shared Property Watch"
              >
                <option value="">None</option>
                {LOCATION_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>{g.icon} {g.name}</option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Type">
              <select
                className="flex-1 rounded border border-white/10 bg-ink-900 px-2.5 py-1.5 text-[12px] text-white/85 outline-none transition focus:border-white/25"
                value={inc.incidentType}
                onChange={(e) => update({ incidentType: e.target.value as IncidentType })}
              >
                {INCIDENT_CATEGORIES.map((cat) => (
                  <optgroup key={cat.id} label={cat.label}>
                    {incidentTypesInCategory(cat.id).map((t) => (
                      <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Status">
              <div className="flex flex-wrap items-center gap-2">
                {INCIDENT_STATUSES.map((s) => (
                  <button
                    key={s.id}
                    // Archived incidents are Closed by definition (stand-down
                    // forces it, and every client re-normalizes archived
                    // incidents to closed) — a chip change here would only
                    // flicker and revert. Reopen first.
                    disabled={!!inc.archivedAt}
                    onClick={() => update({ incidentStatus: s.id })}
                    className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      inc.incidentStatus === s.id
                        ? s.badge
                        : 'border-white/12 text-white/35 hover:border-white/25 hover:text-white/55'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                {!!inc.archivedAt && (
                  <span className="text-[9px] text-white/30">Reopen the incident to change status</span>
                )}
              </div>
            </FieldRow>

            <FieldRow label="Complexity">
              <div
                className="flex flex-wrap items-center gap-2"
                title="ICS incident complexity — Type 5 (initial/minor) to Type 1 (most complex). Changes are recorded in the log."
              >
                {COMPLEXITY_TYPES.map((c) => (
                  <button
                    key={c.id}
                    // Toggle off by clicking the selected chip again.
                    onClick={() => update({ complexityType: inc.complexityType === c.id ? null : c.id })}
                    className={`rounded-full border px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition ${
                      inc.complexityType === c.id
                        ? 'border-violet-400/50 bg-violet-400/15 text-violet-300'
                        : 'border-white/12 text-white/35 hover:border-white/25 hover:text-white/55'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
                {!inc.complexityType && (
                  <span className="text-[9px] text-white/25">Not set</span>
                )}
              </div>
            </FieldRow>
          </div>
        </section>
      </div>

      {/* ICS / NIMS Org Chart */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">ICS / NIMS Organizational Structure</h3>
          <span className="text-[11px] text-white/40">Click any role to assign personnel or edit</span>
        </div>
        <div className="rounded-lg border border-white/8 bg-ink-950/60 px-6 py-5">
          <IcsOrgChart />
        </div>
      </section>

      {/* Actions & Events Log */}
      <ActionLog />

      {/* Map Layers */}
      <MapLayersSection />

      {/* Live data layers for the share-link map */}
      <LiveLayersSection />

    </div>
  );
}
