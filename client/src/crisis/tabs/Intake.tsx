import { useEffect, useMemo, useState } from 'react';
import { useCrisisStore, useActiveIncident } from '../crisisStore';
import { answeredCount, intakeGroupLetter } from '../intakeTemplate';
import { incidentTypeDef } from '../taxonomy';
import { intakeScopes } from '../templates/model';
import { useResolvedIntake } from '../templates/templatesStore';
import { OriginChip, ScopeSummary } from '../templates/ScopeChips';
import {
  EditTemplatesButton, MissingPropertyHint, TemplatesLoadState, useEnsureTemplatesLoaded,
} from '../templates/editorTabChrome';

// ── Intake tab (editor) ──────────────────────────────────────────────────────
// The structured first-notification questionnaire, resolved for this
// incident's type and property from the admin-edited templates. Type an
// answer into any question and the share link's situation report starts
// rendering the answered set as a Q&A table (empty answers stay off it).
// Answers ride the incident blob like the executive summary — same live sync,
// same archived freeze.

const FIELD_CLS =
  'w-full resize-y rounded border border-white/10 bg-white/8 px-2.5 py-1.5 text-[12px] leading-snug text-white/85 placeholder-white/25 outline-none transition [field-sizing:content] max-h-72 focus:border-white/25 focus:bg-white/12 disabled:opacity-50';

export function IntakeTab() {
  const inc = useActiveIncident();
  const setIntakeAnswer = useCrisisStore((s) => s.setIntakeAnswer);
  const typeId = inc ? incidentTypeDef(inc.incidentType).id : null;
  const propertyId = inc?.locationGroupId ?? null;
  const { template, retiredFor, status, error, reload } = useResolvedIntake(typeId, propertyId);
  useEnsureTemplatesLoaded(status, reload);

  const answers = inc?.intake;
  const retired = useMemo(() => retiredFor(answers ?? {}), [retiredFor, answers]);
  const scopes = useMemo(() => (template ? intakeScopes(template) : []), [template]);

  // "Unanswered only" hides the questions that were answered WHEN it was
  // switched on — not live — so the question being typed into doesn't vanish
  // after its first keystroke. Flip it off and on to re-filter.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string> | null>(null);
  const incId = inc?.id;
  useEffect(() => { setHiddenIds(null); }, [incId]);

  if (!inc) return null;
  const frozen = !!inc.archivedAt;
  const current = answers ?? {};
  const answered = template ? answeredCount(template, current) : 0;
  const total = template ? template.groups.reduce((n, g) => n + g.questions.length, 0) : 0;

  const toggleUnanswered = () => {
    if (hiddenIds || !template) { setHiddenIds(null); return; }
    setHiddenIds(new Set(
      template.groups.flatMap((g) => g.questions.filter((q) => current[q.id]?.trim()).map((q) => q.id))
    ));
  };
  const groups = (template?.groups ?? [])
    .map((g, gi) => ({
      ...g,
      letter: intakeGroupLetter(gi),
      questions: hiddenIds ? g.questions.filter((q) => !hiddenIds.has(q.id)) : g.questions,
    }))
    .filter((g) => g.questions.length > 0);

  const clearRetired = (id: string) => {
    if (!window.confirm('Clear this answer? It is removed from the incident record and the share link.')) return;
    setIntakeAnswer(id, '');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">
              {template?.title ?? 'Intake — Initial Contact Questions'}
            </h3>
            <span className="text-[11px] text-white/40">
              {frozen ? 'Archived incident — answers are frozen' : 'Capture what the first caller can tell you — life safety first'}
            </span>
          </div>
          <ScopeSummary scopes={scopes} className="mt-1.5" />
          {!propertyId && !frozen && template && <MissingPropertyHint what="questions" />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {template && (
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
              answered > 0 ? 'border-accent/30 bg-accent/10 text-accent/80' : 'border-white/12 text-white/35'
            }`}>
              {answered}/{total} answered
            </span>
          )}
          <EditTemplatesButton section="intake" incidentType={typeId} propertyId={propertyId} />
        </div>
      </div>

      <TemplatesLoadState what="intake questions" status={status} error={error} hasTemplate={!!template} reload={reload} />

      {template && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {answered > 0 && (
              <p className="min-w-0 flex-1 rounded border border-accent/15 bg-accent/6 px-3 py-2 text-[10px] text-accent/70">
                Answered questions are building the intake table on the share link's situation report.
              </p>
            )}
            {total > 0 && (
              <button
                onClick={toggleUnanswered}
                aria-pressed={!!hiddenIds}
                className={`ml-auto shrink-0 rounded border px-2.5 py-1 text-[10px] transition ${
                  hiddenIds
                    ? 'border-accent/30 bg-accent/10 text-accent/80 hover:text-accent'
                    : 'border-white/10 text-white/40 hover:text-white/60'
                }`}
              >
                {hiddenIds && <span aria-hidden>✓ </span>}Unanswered only
                {hiddenIds && hiddenIds.size > 0 && <span className="text-white/35"> · {hiddenIds.size} hidden</span>}
              </button>
            )}
          </div>

          {total === 0 ? (
            <p className="rounded-lg border border-white/8 bg-white/4 px-4 py-6 text-center text-[12px] text-white/40">
              No intake questions apply to this incident.
            </p>
          ) : groups.length === 0 ? (
            <p className="rounded-lg border border-accent-ok/20 bg-accent-ok/6 px-4 py-6 text-center text-[12px] text-accent-ok/75">
              ✓ Every question has an answer.
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <section key={g.id} aria-labelledby={`intake-group-${g.id}`}>
                  <h4 id={`intake-group-${g.id}`} className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
                    <span className="mr-1.5 text-white/25">{g.letter}.</span>
                    {g.label}
                    <OriginChip scope={g.scope} />
                  </h4>
                  <div className="space-y-2.5 rounded-lg border border-white/8 bg-white/4 px-3.5 py-3">
                    {g.questions.map((q) => (
                      <div key={q.id}>
                        <label className="mb-1 flex gap-1.5 text-[11px] leading-snug text-white/55" htmlFor={`intake-${q.id}`}>
                          <span className="shrink-0 text-white/30">{q.n}.</span>
                          <span>{q.text}</span>
                        </label>
                        <textarea
                          id={`intake-${q.id}`}
                          rows={1}
                          disabled={frozen}
                          className={FIELD_CLS}
                          placeholder="Notes / response"
                          value={current[q.id] ?? ''}
                          onChange={(e) => setIntakeAnswer(q.id, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Answers written against questions this incident no longer resolves
          to (its type or property changed, or an admin removed them). Kept
          read-only so nothing typed is lost; clearing is an explicit act. */}
      {retired.length > 0 && (
        <section className="mt-6" aria-labelledby="intake-retired">
          <h4 id="intake-retired" className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
            Other answers <span className="font-normal normal-case tracking-normal text-white/35">(earlier question set)</span>
          </h4>
          <p className="mb-2 text-[10px] text-white/35">
            Answered before the incident's type or property changed, or since removed from the templates. Still shown on
            the share link.
          </p>
          <ul className="divide-y divide-white/6 rounded-lg border border-white/8 bg-white/4">
            {retired.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-snug text-white/55">
                    {e.text ?? <span className="italic text-white/35">Question no longer in the templates</span>}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug text-white/80">{e.answer.trim()}</p>
                </div>
                {!frozen && (
                  <button
                    onClick={() => clearRetired(e.id)}
                    className="shrink-0 rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/40 transition hover:border-red-400/40 hover:text-red-300"
                    aria-label={`Clear answer${e.text ? ` to: ${e.text}` : ''}`}
                  >
                    Clear
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
