import { Fragment } from 'react';
import { scopeKey, scopeRank, type TemplateScope } from './model';
import { scopeChipLabel, scopeLabel } from './scopeLabels';

// Small scope badges for resolved checklists / intake: where an item or group
// came from, and which scopes an incident's list is built from. Store-free —
// the share page renders these too.

/** "🔥 Wildfire" chip after an item or group label; nothing for General content. */
export function OriginChip({ scope, className = '' }: { scope: TemplateScope | undefined; className?: string }) {
  if (!scope || scopeRank(scope) === 0) return null;
  const label = scopeChipLabel(scope);
  return (
    <span
      title={`Specific to ${scopeLabel(scope, false)}`}
      className={`ml-1.5 inline-block whitespace-nowrap rounded border border-white/10 bg-white/4 px-1.5 py-px align-[1px] text-[9px] font-normal normal-case leading-tight tracking-normal text-white/40 ${className}`}
    >
      {label}
    </span>
  );
}

/** "Includes  General + 🔥 Wildfire + 🏔 Grand Canyon". */
export function ScopeSummary({ scopes, className = '' }: { scopes: TemplateScope[]; className?: string }) {
  if (scopes.length === 0) return null;
  return (
    <p className={`flex flex-wrap items-center gap-1 text-[10px] text-white/35 ${className}`}>
      <span className="mr-0.5">Includes</span>
      {scopes.map((s, i) => (
        <Fragment key={scopeKey(s)}>
          {i > 0 && <span aria-hidden className="text-white/20">+</span>}
          <span className="rounded border border-white/10 bg-white/4 px-1.5 py-px text-white/55">{scopeChipLabel(s)}</span>
        </Fragment>
      ))}
    </p>
  );
}
