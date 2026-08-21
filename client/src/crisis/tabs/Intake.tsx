import { useCrisisStore, useActiveIncident } from '../crisisStore';
import { answeredCount, intakeTemplateFor } from '../intakeTemplate';

// ── Intake tab (editor) ──────────────────────────────────────────────────────
// The structured first-notification questionnaire from the IAP template. Type
// an answer into any question and the share link's situation report starts
// rendering the answered set as a Q&A table (empty answers stay off it).
// Answers ride the incident blob like the executive summary — same live sync,
// same archived freeze.

export function IntakeTab() {
  const inc = useActiveIncident();
  const setIntakeAnswer = useCrisisStore((s) => s.setIntakeAnswer);
  if (!inc) return null;

  const template = intakeTemplateFor(inc.incidentType);
  const answers = inc.intake ?? {};
  const answered = answeredCount(template, answers);
  const total = template.groups.reduce((n, g) => n + g.questions.length, 0);
  const frozen = !!inc.archivedAt;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.14em] text-white/65">{template.title}</h3>
        <span className="text-[11px] text-white/40">
          {frozen ? 'Archived incident — answers are frozen' : 'Capture what the first caller can tell you — life safety first'}
        </span>
        <span className={`ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
          answered > 0 ? 'border-accent/30 bg-accent/10 text-accent/80' : 'border-white/12 text-white/35'
        }`}>
          {answered}/{total} answered
        </span>
      </div>
      {answered > 0 && (
        <p className="mb-4 rounded border border-accent/15 bg-accent/6 px-3 py-2 text-[10px] text-accent/70">
          Answered questions are building the intake table on the share link's situation report.
        </p>
      )}

      <div className="space-y-5">
        {template.groups.map((g, gi) => (
          <section key={g.id}>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
              <span className="mr-1.5 text-white/25">{String.fromCharCode(65 + gi)}.</span>
              {g.label}
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
                    className="w-full resize-y rounded border border-white/10 bg-white/8 px-2.5 py-1.5 text-[12px] leading-snug text-white/85 placeholder-white/25 outline-none transition focus:border-white/25 focus:bg-white/12 disabled:opacity-50"
                    placeholder="Notes / response"
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setIntakeAnswer(q.id, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-3 text-[9px] text-white/25">Question set: {template.source}</p>
    </div>
  );
}
