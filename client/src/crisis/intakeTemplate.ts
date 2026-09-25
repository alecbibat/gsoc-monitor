// ── Intake — initial contact questions ───────────────────────────────────────
//
// The structured first-notification questionnaire. Its questions are
// admin-edited per incident type / property (Admin → Intake questions) and
// resolved for one incident by templates/model.ts; this module keeps the
// resolved shapes and the shared helpers. The per-incident record is only the
// SPARSE answers map on the incident (`Incident.intake`): questionId → answer
// string. Once at least one question has an answer, the share link's
// situation report renders the answered set as a Q&A table.
//
// Value-imported by the public share page — keep this module store-free.

import type { TemplateScope } from './templates/model';

export interface IntakeQuestionDef {
  /** Stable id — also the key in the incident's intake answers map. */
  id: string;
  /** Display number, 1…n across the resolved questionnaire (answers key by id). */
  n: number;
  text: string;
}

export interface IntakeGroupDef {
  id: string;
  label: string;
  /** Which template scope contributed the group (set by resolveIntake). */
  scope?: TemplateScope;
  questions: IntakeQuestionDef[];
}

export interface IntakeTemplate {
  id: string;
  title: string;
  source: string;
  groups: IntakeGroupDef[];
}

/** questionId → answer text. Cleared answers drop the key; whitespace-only ones count as unanswered. */
export type IntakeAnswers = Record<string, string>;

/** Type guard for answer maps arriving in share snapshots (untrusted JSON). */
export function isIntakeAnswers(v: unknown): v is IntakeAnswers {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((a) => typeof a === 'string');
}

/** How many of the template's questions have a non-empty answer. */
export function answeredCount(template: IntakeTemplate, answers: IntakeAnswers): number {
  let n = 0;
  for (const g of template.groups) {
    for (const q of g.questions) {
      if (answers[q.id]?.trim()) n += 1;
    }
  }
  return n;
}

/** Section letter for the i-th group: A…Z, then AA, AB, … (admins can add many groups). */
export function intakeGroupLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
