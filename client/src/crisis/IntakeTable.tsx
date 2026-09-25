import type { ReactNode } from 'react';
import type { IntakeAnswers, IntakeTemplate } from './intakeTemplate';
import type { RetiredIntakeEntry } from './templates/model';
import { OriginChip } from './templates/ScopeChips';

// ── Intake Q&A table ─────────────────────────────────────────────────────────
// Read-only rendering of the answered intake questions, grouped as in the
// questionnaire. Rendered on the share page's situation report once at least
// one question has an answer (the caller gates on that). Store-free.

function QaRow({ n, question, answer }: { n: number | null; question: ReactNode; answer: string }) {
  return (
    <div className="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex gap-2 text-[12px] leading-snug text-white/50">
        {n !== null && <span className="shrink-0 text-white/25">{n}.</span>}
        <span>{question}</span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-snug text-white/85">{answer}</p>
    </div>
  );
}

export function IntakeTable({ template, answers, retired }: {
  template: IntakeTemplate;
  answers: IntakeAnswers;
  /**
   * Answers to questions this incident no longer resolves to (its type or
   * property changed after they were written) — listed last, so an answer is
   * never silently dropped from the report.
   */
  retired?: RetiredIntakeEntry[];
}) {
  const groups = template.groups
    .map((g) => ({
      ...g,
      questions: g.questions.filter((q) => (answers[q.id] ?? '').trim().length > 0),
    }))
    .filter((g) => g.questions.length > 0);
  const earlier = (retired ?? []).filter((e) => e.answer.trim().length > 0);
  if (groups.length === 0 && earlier.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-white/8 bg-ink-950/60">
      {groups.map((g) => (
        <div key={g.id} className="border-b border-white/6 last:border-b-0">
          <div className="bg-white/4 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
            {g.label}
            <OriginChip scope={g.scope} />
          </div>
          <div className="divide-y divide-white/5">
            {g.questions.map((q) => (
              <QaRow key={q.id} n={q.n} question={q.text} answer={(answers[q.id] ?? '').trim()} />
            ))}
          </div>
        </div>
      ))}
      {earlier.length > 0 && (
        <div className="border-b border-white/6 last:border-b-0">
          <div className="bg-white/4 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
            Other answers <span className="font-normal normal-case tracking-normal text-white/35">(earlier question set)</span>
          </div>
          <div className="divide-y divide-white/5">
            {earlier.map((e) => (
              <QaRow
                key={e.id}
                n={null}
                question={e.text ?? <span className="italic text-white/35">Question no longer in the templates</span>}
                answer={e.answer.trim()}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
