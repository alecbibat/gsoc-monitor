// ── Intake — initial contact questions ───────────────────────────────────────
//
// The structured first-notification questionnaire from the IAP template's
// INTAKE pages. Question text lives here in code; the per-incident record is
// only the SPARSE answers map on the incident (`Incident.intake`):
// questionId → answer string. Once at least one question has an answer, the
// share link's situation report renders the answered set as a Q&A table.
//
// Value-imported by the public share page — keep this module store-free.

export interface IntakeQuestionDef {
  /** Stable id — also the key in the incident's intake answers map. */
  id: string;
  /** Question number as printed in the source template (display only). */
  n: number;
  text: string;
}

export interface IntakeGroupDef {
  id: string;
  label: string;
  questions: IntakeQuestionDef[];
}

export interface IntakeTemplate {
  id: string;
  title: string;
  source: string;
  groups: IntakeGroupDef[];
}

/** questionId → answer text. Empty/whitespace answers are never stored. */
export type IntakeAnswers = Record<string, string>;

// Sequential ids (`iq-1`…) with the printed numbering kept alongside, so a
// future template revision can renumber without orphaning stored answers.
let intakeN = 0;
function group(id: string, label: string, texts: string[]): IntakeGroupDef {
  return {
    id,
    label,
    questions: texts.map((text) => {
      intakeN += 1;
      return { id: `iq-${intakeN}`, n: intakeN, text };
    }),
  };
}

const VESSEL_GROUNDING_INTAKE: IntakeTemplate = {
  id: 'vessel-grounding-intake-v1',
  title: 'Intake — Initial Contact Questions',
  source: 'IAP generic template · Vessel Grounding / Run Aground',
  groups: [
    group('vessel', 'Vessel Identification & Position', [
      'What is the name of the vessel, call sign, and IMO/registration number?',
      "What is the vessel's exact position (lat/long) or nearest landmark?",
      'What time did the grounding occur (local and UTC)?',
      'How is the vessel oriented — bow, stern, or midships aground? What is the heading?',
      'Who is reporting, and what is their position/role aboard?',
      'What is the best callback number, radio channel, or contact method going forward?',
    ]),
    group('lifesafety', 'Life Safety & Casualties', [
      'Are there any injuries or fatalities? How many, and what severity?',
      'Is anyone missing or unaccounted for?',
      'Is medical assistance required on board right now?',
      'Has a full headcount / muster of passengers and crew been initiated?',
      'Are all persons currently accounted for?',
    ]),
    group('stability', 'Vessel Status & Stability', [
      'Is the vessel taking on water? Where, and at what rate?',
      'What is the current list / heel angle — is it stable or increasing?',
      'Is the hull breached? Which compartments are affected?',
      'Is the vessel stationary and secure, or still shifting / pounding?',
      'What is the status of propulsion, steering, and electrical power?',
      'What is the water depth around the vessel and the state of the tide?',
    ]),
    group('environmental', 'Environmental', [
      'Is there any fuel, oil, or pollution observed in the water?',
      'What are the current weather, visibility, and sea conditions?',
      'What is the seabed / shoreline type (rock, sand, reef, mud)?',
      'Are there environmentally sensitive or protected areas nearby?',
    ]),
    group('passengers', 'Passengers & Guests', [
      'How many passengers and how many crew are aboard?',
      'What is the general condition and mood of the guests?',
      'Have guests been directed to muster / assembly stations?',
      'Are life jackets being distributed and worn?',
    ]),
    group('command', 'Command, Communications & Resources', [
      'Has the Master declared an emergency, and at what alert level?',
      'Have the Coast Guard / local maritime authorities been notified?',
      'Are other vessels standing by or able to assist?',
      'What external resources have been requested (tugs, salvage, SAR, medical)?',
      'Has the company Designated Person Ashore (DPA) been notified?',
    ]),
  ],
};

// Per-incident-type intake questionnaires: key by IncidentType id; anything
// unlisted uses the default — the same pattern as CHECKLIST_TEMPLATES.
export const INTAKE_TEMPLATES: {
  default: IntakeTemplate;
  byType: Partial<Record<string, IntakeTemplate>>;
} = {
  default: VESSEL_GROUNDING_INTAKE,
  byType: {},
};

export function intakeTemplateFor(incidentType: string): IntakeTemplate {
  return INTAKE_TEMPLATES.byType[incidentType] ?? INTAKE_TEMPLATES.default;
}

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
