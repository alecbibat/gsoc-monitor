import { describe, expect, it } from 'vitest';
import type { ChecklistRoleMeta, TemplateScope } from './types';
import {
  CANONICAL_TYPE_IDS, LIMITS, checkChecklistItems, checkChecklistRoles, checkIntakeGroups,
  cleanText, describeScope, parseBaseRevision, parseScope, parseScopeParam,
} from './validate';

const ROLES: ChecklistRoleMeta[] = [
  { id: 'ic', code: 'IC', title: 'Incident Commander', color: '#fbbf24', reportsTo: '', directs: '' },
  { id: 'gsoc-support', code: 'GSOC', title: 'GSOC Support', color: '#f97316', reportsTo: '', directs: '' },
  { id: 'ops', code: 'OSC', title: 'Operations Section Chief', color: '#ef4444', reportsTo: '', directs: '' },
];
const NONE = new Map<string, TemplateScope>();
const ctx = (takenIds = NONE) => ({ roles: ROLES, takenIds });
const item = (id: string, text = `Do ${id}`, roleId = 'ops', phase = 'immediate') => ({ id, roleId, phase, text });
const errorOf = (r: { ok: boolean; error?: string }) => (r.ok ? null : r.error);

describe('cleanText', () => {
  it('trims, turns line breaks into spaces and drops other control characters', () => {
    expect(cleanText('  Evacuate the lodge  ')).toBe('Evacuate the lodge');
    expect(cleanText('Line one\r\nline two\tend')).toBe('Line one line two end');
    expect(cleanText('bell\u0007 and del\u007f')).toBe('bell and del');
    expect(cleanText(42)).toBe('');
    expect(cleanText(null)).toBe('');
  });
});

describe('scope parsing', () => {
  it('accepts the four scope kinds and treats missing parts as "any"', () => {
    expect(parseScope({ incidentType: null, propertyId: null })).toEqual({ ok: true, value: { incidentType: null, propertyId: null } });
    expect(parseScope({})).toEqual({ ok: true, value: { incidentType: null, propertyId: null } });
    expect(parseScope({ incidentType: 'wildfire', propertyId: 'grand-canyon' }))
      .toEqual({ ok: true, value: { incidentType: 'wildfire', propertyId: 'grand-canyon' } });
    expect(parseScope({ propertyId: 'windstar-ships' })).toEqual({ ok: true, value: { incidentType: null, propertyId: 'windstar-ships' } });
  });

  it('rejects unknown and retired incident types, malformed property ids, non-objects', () => {
    expect(errorOf(parseScope({ incidentType: 'not-a-type' }))).toMatch(/Unknown incident type/);
    // Retired aliases resolve as their successors — nothing may be written for them.
    expect(errorOf(parseScope({ incidentType: 'chemical' }))).toMatch(/Unknown incident type/);
    expect(errorOf(parseScope({ incidentType: 'security' }))).toMatch(/Unknown incident type/);
    expect(errorOf(parseScope({ propertyId: 'Grand Canyon' }))).toMatch(/Invalid property id/);
    expect(errorOf(parseScope({ propertyId: 7 }))).toMatch(/Invalid property id/);
    expect(errorOf(parseScope(null))).toMatch(/scope must be an object/);
    expect(errorOf(parseScope([]))).toMatch(/scope must be an object/);
  });

  it('parses the ?scope= key of a reset', () => {
    expect(parseScopeParam('*|*')).toEqual({ ok: true, value: { incidentType: null, propertyId: null } });
    expect(parseScopeParam('wildfire|yellowstone')).toEqual({ ok: true, value: { incidentType: 'wildfire', propertyId: 'yellowstone' } });
    expect(parseScopeParam('*|glacier')).toEqual({ ok: true, value: { incidentType: null, propertyId: 'glacier' } });
    expect(errorOf(parseScopeParam(undefined))).toMatch(/required/);
    expect(errorOf(parseScopeParam(['*|*']))).toMatch(/required/);
    expect(errorOf(parseScopeParam('wildfire'))).toMatch(/Invalid scope/);
    expect(errorOf(parseScopeParam('bogus|*'))).toMatch(/Unknown incident type/);
  });

  it('knows the canonical types in taxonomy order', () => {
    expect(CANONICAL_TYPE_IDS[0]).toBe('wildfire');
    expect(CANONICAL_TYPE_IDS).toContain('maritime');
    expect(CANONICAL_TYPE_IDS).not.toContain('chemical');
    expect(CANONICAL_TYPE_IDS).not.toContain('security');
  });

  it('describes scopes for messages', () => {
    expect(describeScope({ incidentType: null, propertyId: null })).toBe('the General');
    expect(describeScope({ incidentType: 'flood', propertyId: null })).toBe('the flood');
    expect(describeScope({ incidentType: null, propertyId: 'glacier' })).toBe('the glacier');
    expect(describeScope({ incidentType: 'flood', propertyId: 'glacier' })).toBe('the flood @ glacier');
  });
});

describe('parseBaseRevision', () => {
  it('requires a non-negative integer', () => {
    expect(parseBaseRevision(0)).toEqual({ ok: true, value: 0 });
    expect(parseBaseRevision(7)).toEqual({ ok: true, value: 7 });
    for (const bad of [undefined, null, -1, 1.5, '3', NaN]) {
      expect(errorOf(parseBaseRevision(bad))).toMatch(/baseRevision is required/);
    }
  });
});

describe('checkChecklistItems', () => {
  it('returns cleaned items in order, dropping unknown fields', () => {
    const r = checkChecklistItems(
      [{ ...item('x-a', '  Muster staff \n at the ICP '), extra: true }, item('x-b', 'Brief GSOC', 'gsoc-support', 'ongoing')],
      ctx()
    );
    expect(r).toEqual({
      ok: true,
      value: [
        { id: 'x-a', roleId: 'ops', phase: 'immediate', text: 'Muster staff at the ICP' },
        { id: 'x-b', roleId: 'gsoc-support', phase: 'ongoing', text: 'Brief GSOC' },
      ],
    });
  });

  it('accepts an empty block', () => {
    expect(checkChecklistItems([], ctx())).toEqual({ ok: true, value: [] });
  });

  it('names the offending item by role, phase and position as the editor shows it', () => {
    const r = checkChecklistItems([item('x-a'), item('x-b'), item('x-c', '   ')], ctx());
    expect(errorOf(r)).toBe('Operations Section Chief → Immediate, item 3 is empty — write the action or delete the item');
    const long = 'y'.repeat(LIMITS.itemText + 1);
    expect(errorOf(checkChecklistItems([item('x-a', long, 'ic', 'demob')], ctx())))
      .toMatch(/^Incident Commander → Demobilization, item 1 \("y{40}…"\) is 501 characters long — the limit is 500$/);
  });

  it('rejects unknown roles and phases, falling back to the flat position', () => {
    expect(errorOf(checkChecklistItems([item('x-a', 'Text', 'safety')], ctx())))
      .toBe('Item 1 ("Text") is assigned to an unknown role "safety"');
    expect(errorOf(checkChecklistItems([item('x-a', 'Text', 'ops', 'later')], ctx())))
      .toBe('Item 1 ("Text") has an unknown phase "later"');
  });

  it('rejects malformed ids and duplicates within the block', () => {
    expect(errorOf(checkChecklistItems([item('Bad Id')], ctx()))).toMatch(/has an invalid id "Bad Id"/);
    expect(errorOf(checkChecklistItems([{ roleId: 'ops', phase: 'immediate', text: 'No id' }], ctx())))
      .toMatch(/has an invalid id null/);
    // A huge rejected value is quoted, not echoed whole.
    const huge = errorOf(checkChecklistItems([{ ...item('x-a', 'Short'), id: 'Z'.repeat(5000) }], ctx()))!;
    expect(huge).toMatch(/has an invalid id "Z+…$/);
    expect(huge.length).toBeLessThan(200);
    expect(errorOf(checkChecklistItems([item('x-a', 'One'), item('x-a', 'Two', 'ic')], ctx())))
      .toBe('Incident Commander → Immediate, item 1 ("Two") repeats the id "x-a" of Operations Section Chief → Immediate, item 1');
  });

  it('rejects an id another scope already uses', () => {
    const taken = new Map<string, TemplateScope>([['t-flood-ops-imm-1', { incidentType: 'flood', propertyId: null }]]);
    expect(errorOf(checkChecklistItems([item('t-flood-ops-imm-1', 'Sandbag')], ctx(taken))))
      .toBe('Operations Section Chief → Immediate, item 1 ("Sandbag") uses the id "t-flood-ops-imm-1", which already belongs to the flood checklist');
  });

  it('rejects non-arrays, non-objects and oversized blocks', () => {
    expect(errorOf(checkChecklistItems({}, ctx()))).toBe('items must be an array');
    expect(errorOf(checkChecklistItems([null], ctx()))).toBe('Item 1 is not an object');
    const many = Array.from({ length: LIMITS.checklistItemsPerBlock + 1 }, (_, i) => item(`x-${i}`));
    expect(errorOf(checkChecklistItems(many, ctx()))).toMatch(/at most 300 items per scope \(this one has 301\)/);
    const max = Array.from({ length: LIMITS.checklistItemsPerBlock }, (_, i) => item(`x-${i}`));
    expect(checkChecklistItems(max, ctx()).ok).toBe(true);
  });
});

describe('checkIntakeGroups', () => {
  const none = { takenGroupIds: NONE, takenQuestionIds: NONE };
  const group = (id: string, label: string, qs: [string, string][]) =>
    ({ id, label, questions: qs.map(([qid, text]) => ({ id: qid, text })) });

  it('returns cleaned groups and questions in order', () => {
    const r = checkIntakeGroups([group('g-a', '  Caller  ', [['g-a-1', ' Who is calling? '], ['g-a-2', 'Callback\nnumber?']])], none);
    expect(r).toEqual({
      ok: true,
      value: [{ id: 'g-a', label: 'Caller', questions: [{ id: 'g-a-1', text: 'Who is calling?' }, { id: 'g-a-2', text: 'Callback number?' }] }],
    });
  });

  it('keeps a labelled group with no questions yet', () => {
    expect(checkIntakeGroups([group('g-a', 'Later', [])], none).ok).toBe(true);
  });

  it('names the group / question at fault', () => {
    expect(errorOf(checkIntakeGroups([group('g-a', ' ', [])], none))).toBe('Group 1 needs a label');
    expect(errorOf(checkIntakeGroups([group('g-a', 'Scene', [['g-a-1', 'Ok'], ['g-a-2', '']])], none)))
      .toBe('Question 2 in group "Scene" is empty — write the question or delete it');
    expect(errorOf(checkIntakeGroups([group('g-a', 'x'.repeat(121), [])], none))).toMatch(/label is 121 characters long — the limit is 120/);
    expect(errorOf(checkIntakeGroups([group('g-a', 'Scene', [['g-a-1', 'q'.repeat(501)]])], none)))
      .toMatch(/^Question 1 in group "Scene" \("q{40}…"\) is 501 characters long/);
  });

  it('rejects duplicate group / question ids within the block', () => {
    expect(errorOf(checkIntakeGroups([group('g-a', 'One', []), group('g-a', 'Two', [])], none)))
      .toBe('Group 2 ("Two") repeats the group id "g-a"');
    expect(errorOf(checkIntakeGroups([group('g-a', 'One', [['q-1', 'A']]), group('g-b', 'Two', [['q-1', 'B']])], none)))
      .toBe('Question 1 in group "Two" ("B") repeats the id "q-1" of question 1 in group "One"');
  });

  it('rejects ids another scope already uses', () => {
    const flood: TemplateScope = { incidentType: 'flood', propertyId: null };
    expect(errorOf(checkIntakeGroups([group('t-flood', 'Water', [])], { takenGroupIds: new Map([['t-flood', flood]]), takenQuestionIds: NONE })))
      .toBe('Group 1 ("Water") uses the id "t-flood", which already belongs to a group in the flood intake');
    expect(errorOf(checkIntakeGroups([group('g-x', 'Water', [['t-flood-1', 'Depth?']])], { takenGroupIds: NONE, takenQuestionIds: new Map([['t-flood-1', flood]]) })))
      .toBe('Question 1 in group "Water" ("Depth?") uses the id "t-flood-1", which already belongs to the flood intake');
  });

  it('enforces the group and question caps', () => {
    const groups = Array.from({ length: LIMITS.intakeGroupsPerBlock + 1 }, (_, i) => group(`g-${i}`, `G${i}`, []));
    expect(errorOf(checkIntakeGroups(groups, none))).toMatch(/at most 40 groups per scope \(this one has 41\)/);
    const qs = Array.from({ length: LIMITS.questionsPerGroup + 1 }, (_, i): [string, string] => [`q-${i}`, `Q${i}`]);
    expect(errorOf(checkIntakeGroups([group('g-a', 'Big', qs)], none))).toMatch(/has 81 questions — the limit is 80 per group/);
    expect(errorOf(checkIntakeGroups('nope', none))).toBe('groups must be an array');
    expect(errorOf(checkIntakeGroups([{ id: 'g-a', label: 'A', questions: 'x' }], none))).toBe('Group 1 ("A") questions must be an array');
  });
});

describe('checkChecklistRoles', () => {
  const usage = (entries: [string, number][] = []) => ({ usage: new Map(entries), currentRoles: ROLES });

  it('returns cleaned roles, lower-casing colors and defaulting the notes', () => {
    const r = checkChecklistRoles([{ id: 'r-food', code: ' FB ', title: 'Food & Beverage Lead', color: '#AABBCC' }], usage());
    expect(r).toEqual({
      ok: true,
      value: [{ id: 'r-food', code: 'FB', title: 'Food & Beverage Lead', color: '#aabbcc', reportsTo: '', directs: '' }],
    });
  });

  it('requires 1..30 roles with unique well-formed ids', () => {
    expect(errorOf(checkChecklistRoles([], usage()))).toBe('Keep at least one checklist role');
    const many = Array.from({ length: 31 }, (_, i) => ({ ...ROLES[0], id: `r-${i}` }));
    expect(errorOf(checkChecklistRoles(many, usage()))).toMatch(/At most 30 checklist roles/);
    expect(errorOf(checkChecklistRoles([ROLES[0], ROLES[0]], usage()))).toBe('Role 2 ("Incident Commander") repeats the role id "ic"');
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], id: 'IC' }], usage()))).toMatch(/invalid id "IC"/);
  });

  it('checks code, title, color and note lengths', () => {
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], title: '' }], usage()))).toBe('Role 1 needs a title');
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], code: '' }], usage()))).toMatch(/needs a short code/);
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], code: 'TOOLONGCODE' }], usage()))).toMatch(/longer than 8 characters/);
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], color: 'red' }], usage()))).toMatch(/hex color/);
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], directs: 'd'.repeat(201) }], usage()))).toMatch(/"Directs" is 201 characters long/);
    expect(errorOf(checkChecklistRoles([{ ...ROLES[0], reportsTo: 5 }], usage()))).toMatch(/"Reports to" must be text/);
  });

  it('refuses to drop a role that checklist items still use, naming it and the count', () => {
    expect(errorOf(checkChecklistRoles([ROLES[0], ROLES[1]], usage([['ops', 12]]))))
      .toBe('"Operations Section Chief" (OSC) is still assigned to 12 checklist items — move or delete those items before removing the role');
    expect(errorOf(checkChecklistRoles([ROLES[0]], usage([['gsoc-support', 1]])))).toMatch(/assigned to 1 checklist item —/);
    // Unused roles can go.
    expect(checkChecklistRoles([ROLES[0]], usage([['ic', 3], ['ops', 0]])).ok).toBe(true);
  });
});
