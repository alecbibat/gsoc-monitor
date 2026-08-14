import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AssetCategory, AssetCondition, PropertyAsset } from '../types';

// ── Site assets & infrastructure register (Track 2) ──────────────────────────
// Compact CRUD panel embedded in the property panels. The roadmap's bottleneck
// is data COLLECTION, so entry is deliberately frictionless: one tap to add,
// inline edit, compliance state visible at a glance (overdue / due soon).

export const CATEGORY_META: Record<AssetCategory, { icon: string; label: string }> = {
  'building':     { icon: '🏢', label: 'Building' },
  'generator':    { icon: '⚡', label: 'Generator' },
  'water-system': { icon: '💧', label: 'Water system' },
  'fuel-storage': { icon: '⛽', label: 'Fuel storage' },
  'comms':        { icon: '📡', label: 'Comms' },
  'vehicle':      { icon: '🚙', label: 'Vehicle' },
  'medical':      { icon: '🩺', label: 'Medical' },
  'other':        { icon: '📦', label: 'Other' },
};

const CONDITION_STYLE: Record<AssetCondition, string> = {
  good:   'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  fair:   'text-yellow-300 border-yellow-400/30 bg-yellow-400/10',
  poor:   'text-amber-300 border-amber-400/30 bg-amber-400/10',
  failed: 'text-red-300 border-red-400/30 bg-red-400/10',
};

type DueState = { label: string; cls: string } | null;

/** Compliance framing for next_due: overdue (red), ≤30 days (amber), else quiet. */
export function dueState(nextDue: string | null, todayIso?: string): DueState {
  if (!nextDue) return null;
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  if (nextDue < today) return { label: 'overdue', cls: 'text-red-300 border-red-400/40 bg-red-400/10' };
  const days = Math.round((Date.parse(nextDue) - Date.parse(today)) / 86_400_000);
  if (days <= 30) return { label: `due in ${days}d`, cls: 'text-amber-300 border-amber-400/30 bg-amber-400/10' };
  return { label: `due ${nextDue}`, cls: 'text-white/35 border-white/10' };
}

interface FormState {
  name: string;
  category: AssetCategory;
  condition: '' | AssetCondition;
  lastInspected: string;
  nextDue: string;
  responsibleParty: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '', category: 'building', condition: '', lastInspected: '',
  nextDue: '', responsibleParty: '', notes: '',
};

function toBody(f: FormState, groupId: string, locationName: string) {
  return {
    groupId,
    locationName,
    name: f.name,
    category: f.category,
    condition: f.condition || null,
    lastInspected: f.lastInspected || null,
    nextDue: f.nextDue || null,
    responsibleParty: f.responsibleParty || null,
    notes: f.notes,
  };
}

function AssetForm({ initial, saving, error, onSave, onCancel, onDelete }: {
  initial: FormState;
  saving: boolean;
  error: string | null;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));
  const inputCls =
    'rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] text-white/85 placeholder:text-white/25 focus:border-accent/40 focus:outline-none';
  return (
    <div className="space-y-2 rounded-lg border border-accent/20 bg-white/[0.03] p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <input className={`${inputCls} col-span-2`} value={f.name} placeholder="Asset name *"
          onChange={(e) => set({ name: e.target.value })} />
        <select className={`${inputCls} [color-scheme:dark]`} value={f.category}
          onChange={(e) => set({ category: e.target.value as AssetCategory })}>
          {(Object.keys(CATEGORY_META) as AssetCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>
          ))}
        </select>
        <select className={`${inputCls} [color-scheme:dark]`} value={f.condition}
          onChange={(e) => set({ condition: e.target.value as FormState['condition'] })}>
          <option value="">Condition —</option>
          {(['good', 'fair', 'poor', 'failed'] as const).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="text-[9px] uppercase tracking-wider text-white/30">
          Last inspected
          <input type="date" className={`${inputCls} mt-0.5 w-full [color-scheme:dark]`} value={f.lastInspected}
            onChange={(e) => set({ lastInspected: e.target.value })} />
        </label>
        <label className="text-[9px] uppercase tracking-wider text-white/30">
          Next due
          <input type="date" className={`${inputCls} mt-0.5 w-full [color-scheme:dark]`} value={f.nextDue}
            onChange={(e) => set({ nextDue: e.target.value })} />
        </label>
        <input className={`${inputCls} col-span-2`} value={f.responsibleParty} placeholder="Responsible party"
          onChange={(e) => set({ responsibleParty: e.target.value })} />
        <textarea className={`${inputCls} col-span-2 resize-y`} rows={2} value={f.notes} placeholder="Notes"
          onChange={(e) => set({ notes: e.target.value })} />
      </div>
      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(f)}
          disabled={saving || !f.name.trim()}
          className="rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-2 py-1 text-[11px] text-white/40 transition hover:text-white/70">
          Cancel
        </button>
        {onDelete && (
          <button onClick={onDelete} className="ml-auto px-2 py-1 text-[11px] text-white/30 transition hover:text-red-300">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export function PropertyAssets({ groupId, locationName }: { groupId: string; locationName: string }) {
  const [assets, setAssets] = useState<PropertyAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.assets(groupId, locationName)
      .then((rows) => { setAssets(rows); setError(null); })
      .catch((e) => setError((e as Error).message));
  }, [groupId, locationName]);

  useEffect(() => {
    setAssets(null);
    setAdding(false);
    setEditingId(null);
    load();
  }, [load]);

  const save = (f: FormState, id?: string) => {
    setSaving(true);
    setFormError(null);
    const body = toBody(f, groupId, locationName);
    (id ? api.updateAsset(id, body) : api.addAsset(body))
      .then(() => { setAdding(false); setEditingId(null); load(); })
      .catch((e) => setFormError((e as Error).message))
      .finally(() => setSaving(false));
  };

  const remove = (id: string) => {
    setSaving(true);
    api.deleteAsset(id)
      .then(() => { setEditingId(null); load(); })
      .catch((e) => setFormError((e as Error).message))
      .finally(() => setSaving(false));
  };

  const overdue = (assets ?? []).filter((a) => dueState(a.nextDue)?.label === 'overdue').length;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Assets &amp; Infrastructure
        </h3>
        {assets !== null && assets.length > 0 && (
          <span className="text-[10px] text-white/30">{assets.length}</span>
        )}
        {overdue > 0 && (
          <span className="rounded-full border border-red-400/40 bg-red-400/10 px-1.5 py-px text-[9px] font-bold text-red-300">
            {overdue} overdue
          </span>
        )}
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null); setFormError(null); }}
            className="ml-auto rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/50 transition hover:border-accent/40 hover:text-accent"
          >
            + Add
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-white/45">
          Asset register unavailable ({error})
        </p>
      )}

      {adding && (
        <div className="mb-2">
          <AssetForm
            initial={EMPTY_FORM}
            saving={saving}
            error={formError}
            onSave={(f) => save(f)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {assets === null && !error ? (
        <p className="px-1 py-1 text-[11px] text-white/30">Loading…</p>
      ) : assets !== null && assets.length === 0 && !adding ? (
        <p className="rounded-lg bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-white/40">
          No assets recorded for this property yet. Buildings, generators, water
          systems, fuel storage — capture them here so incident response starts
          from a real inventory.
        </p>
      ) : (
        <div className="space-y-1">
          {(assets ?? []).map((a) => {
            const due = dueState(a.nextDue);
            const editing = editingId === a.id;
            return (
              <div key={a.id}>
                <button
                  onClick={() => {
                    setAdding(false);
                    setFormError(null);
                    setEditingId(editing ? null : a.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-left transition hover:bg-white/[0.07]"
                >
                  <span className="text-[13px]" title={CATEGORY_META[a.category]?.label ?? a.category}>
                    {CATEGORY_META[a.category]?.icon ?? '📦'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/80">{a.name}</span>
                  {a.condition && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase ${CONDITION_STYLE[a.condition]}`}>
                      {a.condition}
                    </span>
                  )}
                  {due && due.label !== `due ${a.nextDue}` && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold ${due.cls}`}>
                      {due.label}
                    </span>
                  )}
                </button>
                {editing && (
                  <div className="mt-1">
                    <AssetForm
                      initial={{
                        name: a.name,
                        category: a.category,
                        condition: a.condition ?? '',
                        lastInspected: a.lastInspected ?? '',
                        nextDue: a.nextDue ?? '',
                        responsibleParty: a.responsibleParty ?? '',
                        notes: a.notes,
                      }}
                      saving={saving}
                      error={formError}
                      onSave={(f) => save(f, a.id)}
                      onCancel={() => setEditingId(null)}
                      onDelete={() => remove(a.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
