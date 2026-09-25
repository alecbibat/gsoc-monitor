// Integrity checks for the built-in crisis-template content. Ids are the keys
// of every incident's stored checklist/intake state, so they must be unique
// across ALL scopes, and every default block must pass the same validation an
// admin save goes through (validate.ts) — otherwise "open the default and
// press Save" would be rejected.

import { describe, expect, it } from 'vitest';
import { INCIDENT_TYPE_IDS } from '../../incidentTaxonomy';
import { checkChecklistItems, checkIntakeGroups, LIMITS } from '../../crisisTemplates/validate';
import {
  CHECKLIST_PHASE_IDS, TEMPLATE_ID_RE, scopeKey,
  type TemplateScope,
} from '../../crisisTemplates/types';
import { DEFAULT_CHECKLIST_BLOCKS, DEFAULT_CHECKLIST_ROLES, DEFAULT_INTAKE_BLOCKS } from './index';
import {
  LEGACY_GENERAL_CHECKLIST, LEGACY_GENERAL_INTAKE, LEGACY_MARITIME_CHECKLIST, LEGACY_MARITIME_INTAKE,
} from './legacy';

const RETIRED_TYPES = new Set(['chemical', 'security']);
const CANONICAL_TYPES = [...INCIDENT_TYPE_IDS].filter((t) => !RETIRED_TYPES.has(t));
const PROPERTY_IDS = [
  'glacier', 'death-valley', 'grand-canyon', 'corporate', 'centennial-airport', 'yellowstone', 'rushmore',
  'custer', 'windstar', 'holiday', 'vermont', 'sea-island', 'cog-railway', 'rocky-mountain', 'windstar-ships',
];

type Kind = 'general' | 'type' | 'property' | 'type+property';
const kindOf = (s: TemplateScope): Kind =>
  s.incidentType === null
    ? (s.propertyId === null ? 'general' : 'property')
    : (s.propertyId === null ? 'type' : 'type+property');

const allItems = DEFAULT_CHECKLIST_BLOCKS.flatMap((b) => b.items.map((item) => ({ scope: b.scope, item })));
const allGroups = DEFAULT_INTAKE_BLOCKS.flatMap((b) => b.groups.map((group) => ({ scope: b.scope, group })));
const allQuestions = allGroups.flatMap(({ scope, group }) => group.questions.map((q) => ({ scope, group, q })));

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

const cleanTextOk = (t: string) =>
  t.length > 0 && t === t.trim() && !/[\u0000-\u001f\u007f]/.test(t) && !/\s{2,}/.test(t);

describe('crisis template defaults — ids', () => {
  it('every checklist item id matches the template id pattern', () => {
    const bad = allItems.filter(({ item }) => !TEMPLATE_ID_RE.test(item.id)).map(({ item }) => item.id);
    expect(bad).toEqual([]);
  });

  it('every intake group id and question id matches the template id pattern', () => {
    expect(allGroups.filter(({ group }) => !TEMPLATE_ID_RE.test(group.id)).map(({ group }) => group.id)).toEqual([]);
    expect(allQuestions.filter(({ q }) => !TEMPLATE_ID_RE.test(q.id)).map(({ q }) => q.id)).toEqual([]);
  });

  it('checklist item ids are globally unique across all blocks', () => {
    expect(duplicates(allItems.map(({ item }) => item.id))).toEqual([]);
  });

  it('intake question ids and group ids are each globally unique across all blocks', () => {
    expect(duplicates(allQuestions.map(({ q }) => q.id))).toEqual([]);
    expect(duplicates(allGroups.map(({ group }) => group.id))).toEqual([]);
  });

  it('each block has a distinct scope', () => {
    expect(duplicates(DEFAULT_CHECKLIST_BLOCKS.map((b) => scopeKey(b.scope)))).toEqual([]);
    expect(duplicates(DEFAULT_INTAKE_BLOCKS.map((b) => scopeKey(b.scope)))).toEqual([]);
  });

  it('minted ids carry their scope prefix', () => {
    const LEGACY = new Set([
      ...LEGACY_GENERAL_CHECKLIST.map((i) => i.id),
      ...LEGACY_MARITIME_CHECKLIST.map((i) => i.id),
    ]);
    const LEGACY_GROUPS = new Set(LEGACY_MARITIME_INTAKE.map((g) => g.id));
    const prefix = (s: TemplateScope) =>
      s.incidentType ? `t-${s.incidentType}` : s.propertyId ? `p-${s.propertyId}` : 'g';
    const badItems = allItems
      .filter(({ item }) => !LEGACY.has(item.id))
      .filter(({ scope, item }) => !item.id.startsWith(`${prefix(scope)}-${item.roleId}-`))
      .map(({ item }) => item.id);
    expect(badItems).toEqual([]);
    const badGroups = allGroups
      .filter(({ group }) => !LEGACY_GROUPS.has(group.id))
      .filter(({ scope, group }) => group.id !== prefix(scope) && !group.id.startsWith(`${prefix(scope)}-`))
      .map(({ group }) => group.id);
    expect(badGroups).toEqual([]);
  });
});

describe('crisis template defaults — content shape', () => {
  const roleIds = new Set(DEFAULT_CHECKLIST_ROLES.map((r) => r.id));

  it('roles include GSOC Support and have unique ids', () => {
    expect(roleIds.has('gsoc-support')).toBe(true);
    expect(duplicates(DEFAULT_CHECKLIST_ROLES.map((r) => r.id))).toEqual([]);
  });

  it('every item uses a known role and phase', () => {
    expect(allItems.filter(({ item }) => !roleIds.has(item.roleId)).map(({ item }) => item.id)).toEqual([]);
    expect(allItems.filter(({ item }) => !CHECKLIST_PHASE_IDS.has(item.phase)).map(({ item }) => item.id)).toEqual([]);
  });

  it('texts are non-empty, trimmed, single-spaced and at most 500 characters', () => {
    const badItems = allItems.filter(({ item }) => !cleanTextOk(item.text) || item.text.length > LIMITS.itemText);
    expect(badItems.map(({ item }) => item.id)).toEqual([]);
    const badQuestions = allQuestions.filter(({ q }) => !cleanTextOk(q.text) || q.text.length > LIMITS.questionText);
    expect(badQuestions.map(({ q }) => q.id)).toEqual([]);
    const badLabels = allGroups.filter(({ group }) => !cleanTextOk(group.label) || group.label.length > LIMITS.groupLabel);
    expect(badLabels.map(({ group }) => group.id)).toEqual([]);
  });

  it('no checklist item text is repeated verbatim anywhere in the defaults', () => {
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    expect(duplicates(allItems.map(({ item }) => norm(item.text)))).toEqual([]);
    expect(duplicates(allQuestions.map(({ q }) => norm(q.text)))).toEqual([]);
  });

  it('every block passes the admin-save validation unchanged', () => {
    const itemOwner = new Map(allItems.map(({ scope, item }) => [item.id, scope]));
    for (const b of DEFAULT_CHECKLIST_BLOCKS) {
      const mine = new Set(b.items.map((i) => i.id));
      const takenIds = new Map([...itemOwner].filter(([id]) => !mine.has(id)));
      const r = checkChecklistItems(b.items, { roles: DEFAULT_CHECKLIST_ROLES, takenIds });
      expect(r, scopeKey(b.scope)).toEqual({ ok: true, value: b.items });
    }
    const groupOwner = new Map(allGroups.map(({ scope, group }) => [group.id, scope]));
    const questionOwner = new Map(allQuestions.map(({ scope, q }) => [q.id, scope]));
    for (const b of DEFAULT_INTAKE_BLOCKS) {
      const gids = new Set(b.groups.map((g) => g.id));
      const qids = new Set(b.groups.flatMap((g) => g.questions.map((q) => q.id)));
      const r = checkIntakeGroups(b.groups, {
        takenGroupIds: new Map([...groupOwner].filter(([id]) => !gids.has(id))),
        takenQuestionIds: new Map([...questionOwner].filter(([id]) => !qids.has(id))),
      });
      expect(r, scopeKey(b.scope)).toEqual({ ok: true, value: b.groups });
    }
  });

  it('no block or group is empty', () => {
    expect(DEFAULT_CHECKLIST_BLOCKS.filter((b) => b.items.length === 0).map((b) => scopeKey(b.scope))).toEqual([]);
    expect(DEFAULT_INTAKE_BLOCKS.filter((b) => b.groups.length === 0).map((b) => scopeKey(b.scope))).toEqual([]);
    expect(allGroups.filter(({ group }) => group.questions.length === 0).map(({ group }) => group.id)).toEqual([]);
  });
});

describe('crisis template defaults — scope coverage', () => {
  const checklistKinds = DEFAULT_CHECKLIST_BLOCKS.map((b) => kindOf(b.scope));
  const intakeKinds = DEFAULT_INTAKE_BLOCKS.map((b) => kindOf(b.scope));

  it('has exactly one General block for checklists and for intake', () => {
    expect(checklistKinds.filter((k) => k === 'general')).toHaveLength(1);
    expect(intakeKinds.filter((k) => k === 'general')).toHaveLength(1);
  });

  it('only uses canonical incident types', () => {
    const types = [...DEFAULT_CHECKLIST_BLOCKS, ...DEFAULT_INTAKE_BLOCKS]
      .map((b) => b.scope.incidentType)
      .filter((t): t is string => t !== null);
    expect(types.filter((t) => !CANONICAL_TYPES.includes(t))).toEqual([]);
  });

  it.each(CANONICAL_TYPES)('incident type %s has a checklist block and an intake block', (type) => {
    const isType = (s: TemplateScope) => s.incidentType === type && s.propertyId === null;
    expect(DEFAULT_CHECKLIST_BLOCKS.filter((b) => isType(b.scope))).toHaveLength(1);
    expect(DEFAULT_INTAKE_BLOCKS.filter((b) => isType(b.scope))).toHaveLength(1);
  });

  it.each(PROPERTY_IDS)('property %s has a checklist block and an intake block', (propertyId) => {
    const isProp = (s: TemplateScope) => s.incidentType === null && s.propertyId === propertyId;
    expect(DEFAULT_CHECKLIST_BLOCKS.filter((b) => isProp(b.scope))).toHaveLength(1);
    expect(DEFAULT_INTAKE_BLOCKS.filter((b) => isProp(b.scope))).toHaveLength(1);
  });

  it('has no property blocks beyond the 15 known properties', () => {
    const props = [...DEFAULT_CHECKLIST_BLOCKS, ...DEFAULT_INTAKE_BLOCKS]
      .map((b) => b.scope.propertyId)
      .filter((p): p is string => p !== null);
    expect(props.filter((p) => !PROPERTY_IDS.includes(p))).toEqual([]);
  });

  it('gives GSOC Support items in most type and property scopes', () => {
    const scoped = DEFAULT_CHECKLIST_BLOCKS.filter((b) => kindOf(b.scope) !== 'general');
    const missing = scoped.filter((b) => !b.items.some((i) => i.roleId === 'gsoc-support')).map((b) => scopeKey(b.scope));
    expect(missing).toEqual([]);
  });
});

describe('crisis template defaults — legacy ids', () => {
  const general = DEFAULT_CHECKLIST_BLOCKS.find((b) => kindOf(b.scope) === 'general')!;
  const maritime = DEFAULT_CHECKLIST_BLOCKS.find((b) => b.scope.incidentType === 'maritime' && b.scope.propertyId === null)!;
  const generalIntake = DEFAULT_INTAKE_BLOCKS.find((b) => kindOf(b.scope) === 'general')!;
  const maritimeIntake = DEFAULT_INTAKE_BLOCKS.find((b) => b.scope.incidentType === 'maritime' && b.scope.propertyId === null)!;
  const countItem = (id: string) => allItems.filter(({ item }) => item.id === id).length;
  const countQuestion = (id: string) => allQuestions.filter(({ q }) => q.id === id).length;

  it('keeps every legacy General checklist item, verbatim, exactly once, in the General block', () => {
    for (const legacy of LEGACY_GENERAL_CHECKLIST) {
      expect(countItem(legacy.id), legacy.id).toBe(1);
      expect(general.items.find((i) => i.id === legacy.id), legacy.id).toEqual(legacy);
    }
  });

  it('keeps every legacy Maritime checklist item, verbatim, exactly once, leading the Maritime block', () => {
    for (const legacy of LEGACY_MARITIME_CHECKLIST) {
      expect(countItem(legacy.id), legacy.id).toBe(1);
      expect(maritime.items.find((i) => i.id === legacy.id), legacy.id).toEqual(legacy);
    }
    expect(maritime.items.slice(0, LEGACY_MARITIME_CHECKLIST.length)).toEqual(LEGACY_MARITIME_CHECKLIST);
  });

  it('embeds all five legacy General intake questions exactly once in the General block', () => {
    const inGeneral = generalIntake.groups.flatMap((g) => g.questions);
    for (const legacy of Object.values(LEGACY_GENERAL_INTAKE)) {
      expect(countQuestion(legacy.id), legacy.id).toBe(1);
      expect(inGeneral.find((q) => q.id === legacy.id), legacy.id).toEqual(legacy);
    }
  });

  it('keeps the legacy Maritime intake groups, verbatim, leading the Maritime intake block', () => {
    expect(maritimeIntake.groups.slice(0, LEGACY_MARITIME_INTAKE.length)).toEqual(LEGACY_MARITIME_INTAKE);
    for (const q of LEGACY_MARITIME_INTAKE.flatMap((g) => g.questions)) expect(countQuestion(q.id), q.id).toBe(1);
  });

  it('gives GSOC Support General items in all three phases', () => {
    const phases = new Set(general.items.filter((i) => i.roleId === 'gsoc-support').map((i) => i.phase));
    expect([...phases].sort()).toEqual(['demob', 'immediate', 'ongoing']);
  });
});
