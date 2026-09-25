import { describe, expect, it } from 'vitest';
import {
  answeredCount, intakeGroupLetter, isIntakeAnswers, type IntakeTemplate,
} from './intakeTemplate';

// Content lives server-side now (admin-edited templates); a small resolved
// template of the shape resolveIntake produces stands in for it.
const tpl: IntakeTemplate = {
  id: 'resolved:*|*',
  title: 'Intake — Initial Contact Questions',
  source: 'test',
  groups: [
    { id: 'g-what', label: 'What happened', questions: [{ id: 'q-1', n: 1, text: 'What?' }, { id: 'q-2', n: 2, text: 'Where?' }] },
    { id: 'g-life', label: 'Life safety', questions: [{ id: 'q-3', n: 3, text: 'Injuries?' }] },
  ],
};

describe('answeredCount', () => {
  it('counts non-empty answers only — the share-table gate', () => {
    expect(answeredCount(tpl, {})).toBe(0);
    expect(answeredCount(tpl, { 'q-1': '  ' })).toBe(0);
    expect(answeredCount(tpl, { 'q-1': 'Kitchen fire', 'q-2': '' })).toBe(1);
    expect(answeredCount(tpl, { 'q-1': 'a', 'q-2': 'b', 'q-3': 'c' })).toBe(3);
    // Answers keyed to questions this template doesn't know don't count.
    expect(answeredCount(tpl, { 'iq-999': 'stale' })).toBe(0);
  });
});

describe('intakeGroupLetter', () => {
  it('letters groups A…Z, then AA, AB, …', () => {
    expect([0, 1, 25].map(intakeGroupLetter)).toEqual(['A', 'B', 'Z']);
    expect([26, 27, 51, 52].map(intakeGroupLetter)).toEqual(['AA', 'AB', 'AZ', 'BA']);
    expect(intakeGroupLetter(26 + 26 * 26)).toBe('AAA');
  });

  it('clamps nonsense input to A', () => {
    expect(intakeGroupLetter(-3)).toBe('A');
    expect(intakeGroupLetter(0.7)).toBe('A');
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
