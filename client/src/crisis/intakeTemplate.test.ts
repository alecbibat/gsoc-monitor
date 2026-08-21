import { describe, expect, it } from 'vitest';
import {
  INTAKE_TEMPLATES, answeredCount, intakeTemplateFor, isIntakeAnswers,
} from './intakeTemplate';

const tpl = INTAKE_TEMPLATES.default;
const allQuestions = tpl.groups.flatMap((g) => g.questions);

describe('intake template', () => {
  it('carries the 30 initial-contact questions in 6 groups', () => {
    expect(tpl.groups).toHaveLength(6);
    expect(allQuestions).toHaveLength(30);
  });

  it('numbers questions sequentially with unique ids', () => {
    expect(allQuestions.map((q) => q.n)).toEqual(allQuestions.map((_, i) => i + 1));
    expect(new Set(allQuestions.map((q) => q.id)).size).toBe(allQuestions.length);
  });

  it('falls back to the default template for unmapped incident types', () => {
    expect(intakeTemplateFor('earthquake')).toBe(tpl);
    expect(intakeTemplateFor('not-a-type')).toBe(tpl);
  });
});

describe('answeredCount', () => {
  it('counts non-empty answers only — the share-table gate', () => {
    const q1 = allQuestions[0].id;
    const q2 = allQuestions[1].id;
    expect(answeredCount(tpl, {})).toBe(0);
    expect(answeredCount(tpl, { [q1]: '  ' })).toBe(0);
    expect(answeredCount(tpl, { [q1]: 'MV Example, callsign X', [q2]: '' })).toBe(1);
    // Answers keyed to questions this template doesn't know don't count.
    expect(answeredCount(tpl, { 'iq-999': 'stale' })).toBe(0);
  });
});

describe('isIntakeAnswers', () => {
  it('accepts string maps and rejects malformed snapshot payloads', () => {
    expect(isIntakeAnswers({})).toBe(true);
    expect(isIntakeAnswers({ 'iq-1': 'answer' })).toBe(true);
    expect(isIntakeAnswers(null)).toBe(false);
    expect(isIntakeAnswers([])).toBe(false);
    expect(isIntakeAnswers({ 'iq-1': 42 })).toBe(false);
  });
});
