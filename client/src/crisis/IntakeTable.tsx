import type { IntakeAnswers, IntakeTemplate } from './intakeTemplate';

// ── Intake Q&A table ─────────────────────────────────────────────────────────
// Read-only rendering of the answered intake questions, grouped as in the
// questionnaire. Rendered on the share page's situation report once at least
// one question has an answer (the caller gates on that). Store-free.

export function IntakeTable({ template, answers }: {
  template: IntakeTemplate;
  answers: IntakeAnswers;
}) {
  const groups = template.groups
    .map((g) => ({
      ...g,
      questions: g.questions.filter((q) => (answers[q.id] ?? '').trim().length > 0),
    }))
    .filter((g) => g.questions.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-white/8 bg-ink-950/60">
      {groups.map((g) => (
        <div key={g.id} className="border-b border-white/6 last:border-b-0">
          <div className="bg-white/4 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
            {g.label}
          </div>
          <div className="divide-y divide-white/5">
            {g.questions.map((q) => (
              <div key={q.id} className="grid gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="flex gap-2 text-[12px] leading-snug text-white/50">
                  <span className="shrink-0 text-white/25">{q.n}.</span>
                  <span>{q.text}</span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-snug text-white/85">
                  {(answers[q.id] ?? '').trim()}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
