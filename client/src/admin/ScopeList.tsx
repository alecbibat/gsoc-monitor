import { useId, useMemo, useState } from 'react';
import { sameScope, type TemplateScope } from '../crisis/templates/model';
import { scopeAudience, scopeLabel } from '../crisis/templates/scopeLabels';
import { groupScopeEntries, type ScopeEntry } from './draftOps';
import { ScopePicker } from './ScopePicker';
import { plural } from './editorUi';

// ── Scope list ───────────────────────────────────────────────────────────────
// Left rail of the checklist and intake editors: every scope that has content,
// grouped General / Incident types / Properties / Type + Property, with its
// size and whether an admin has customized it, a filter, and "+ New scope"
// for a combination nothing has been written for yet.

export type { ScopeEntry };

export function ScopeList({ entries, selected, onSelect, noun }: {
  entries: ScopeEntry[];
  selected: TemplateScope;
  onSelect: (scope: TemplateScope) => void;
  /** What `count` counts, singular and plural ("item", "items"). */
  noun: [string, string];
}) {
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<TemplateScope>(selected);
  const filterId = useId();

  const groups = useMemo(
    () => groupScopeEntries(entries, filter, (s) => scopeLabel(s, false)),
    [entries, filter]
  );
  const customized = entries.filter((e) => e.custom).length;
  const hasCombos = entries.some((e) => e.scope.incidentType !== null && e.scope.propertyId !== null);
  const candidateExists = entries.some((e) => sameScope(e.scope, candidate));

  const openAdd = () => {
    setCandidate(selected);
    setAdding(true);
  };

  return (
    <nav aria-label="Template scopes" className="p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <p className="text-[10px] text-white/35">
          {plural(entries.length, 'scope')} · {customized} customized
        </p>
        {!adding && (
          <button
            type="button"
            onClick={openAdd}
            className="shrink-0 rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/55 transition hover:border-accent/40 hover:text-accent/85"
          >
            + New scope
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 rounded-lg border border-accent/20 bg-accent/5 p-2.5">
          <ScopePicker value={candidate} onChange={setCandidate} />
          <p className="mt-2 text-[10px] leading-snug text-white/45">{scopeAudience(candidate)}.</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { onSelect(candidate); setAdding(false); setFilter(''); }}
              className="rounded bg-accent/20 px-3 py-1 text-[11px] font-medium text-accent transition hover:bg-accent/30"
            >
              {candidateExists ? 'Open' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-white/10 px-3 py-1 text-[11px] text-white/45 transition hover:text-white/75"
            >
              Cancel
            </button>
          </div>
          {candidateExists && (
            <p className="mt-1.5 text-[9px] text-white/35">This scope already exists — Open jumps to it.</p>
          )}
        </div>
      )}

      <label htmlFor={filterId} className="sr-only">Filter scopes</label>
      <input
        id={filterId}
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          // Esc clears the filter first; the page's own Esc (close) only when empty.
          if (e.key === 'Escape' && filter) { e.preventDefault(); setFilter(''); }
        }}
        placeholder="Filter by type or property…"
        className="mb-1 w-full rounded border border-white/10 bg-white/4 px-2.5 py-1.5 text-[11px] text-white/80 placeholder-white/25 outline-none transition focus:border-accent/40"
      />

      {groups.length === 0 && (
        <div className="px-1 py-4 text-center">
          <p className="text-[11px] text-white/40">No scopes match “{filter}”.</p>
          <button type="button" onClick={openAdd} className="mt-1 text-[10px] text-accent/70 underline underline-offset-2 hover:text-accent">
            Start a new scope
          </button>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.rank} className="mt-2">
          <h3 className="flex items-baseline gap-1.5 px-1 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">
            {g.label}
            <span className="font-normal tracking-normal text-white/20">{g.entries.length}</span>
          </h3>
          <ul className="space-y-px">
            {g.entries.map((e) => {
              const active = sameScope(e.scope, selected);
              const label = scopeLabel(e.scope);
              return (
                <li key={`${e.scope.incidentType ?? '*'}|${e.scope.propertyId ?? '*'}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(e.scope)}
                    aria-current={active ? 'true' : undefined}
                    title={`${label} — ${scopeAudience(e.scope)}`}
                    className={`flex w-full items-center gap-2 rounded border-l-2 px-2 py-1.5 text-left transition ${
                      active
                        ? 'border-accent bg-accent/10 text-white'
                        : 'border-transparent text-white/65 hover:bg-white/4 hover:text-white/90'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {g.rank === 0 ? 'General' : label}
                    </span>
                    {e.dirty && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Unsaved changes" aria-label="unsaved changes" />
                    )}
                    <span
                      className="shrink-0 text-[10px] tabular-nums text-white/35"
                      aria-label={plural(e.count, noun[0], noun[1])}
                    >
                      {e.count}
                    </span>
                    <span
                      className={`w-12 shrink-0 rounded px-1 py-px text-center text-[8px] font-bold uppercase tracking-wider ${
                        e.isNew ? 'bg-amber-400/15 text-amber-300/85'
                        : e.custom ? 'bg-accent/15 text-accent/80'
                        : 'bg-white/6 text-white/35'
                      }`}
                    >
                      {e.isNew ? 'new' : e.custom ? 'custom' : 'default'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {!filter && !hasCombos && (
        <p className="mt-3 px-1 text-[10px] leading-snug text-white/30">
          No Type + Property scopes yet. Use <span className="text-white/50">+ New scope</span> for content that only
          applies to one incident type at one property.
        </p>
      )}
    </nav>
  );
}
