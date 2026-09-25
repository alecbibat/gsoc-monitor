import { describe, expect, it } from 'vitest';
import {
  GENERAL_SCOPE, TEMPLATE_ID_RE,
  applicableBlocks, checklistScopes, contributingScopes, intakeScopes, isCrisisTemplatesConfig,
  mintTemplateId, parseScopeKey, resolveChecklist, resolveIntake, retiredChecklistEntries,
  retiredIntakeEntries, sameScope, scopeApplies, scopeKey, scopeRank,
  type ChecklistBlock, type ChecklistBlockItem, type CrisisTemplatesConfig, type IntakeBlock,
  type IntakeBlockGroup, type TemplateScope,
} from './model';

const T = (incidentType: string | null, propertyId: string | null): TemplateScope => ({ incidentType, propertyId });
const META = { custom: false, revision: 0, updatedAt: null, updatedBy: null };

const item = (id: string, roleId: string, phase: ChecklistBlockItem['phase'] = 'immediate'): ChecklistBlockItem =>
  ({ id, roleId, phase, text: `text ${id}` });
const cBlock = (scope: TemplateScope, items: ChecklistBlockItem[]): ChecklistBlock => ({ ...META, scope, items });
const group = (id: string, qids: string[], label = id): IntakeBlockGroup =>
  ({ id, label, questions: qids.map((q) => ({ id: q, text: `text ${q}` })) });
const iBlock = (scope: TemplateScope, groups: IntakeBlockGroup[]): IntakeBlock => ({ ...META, scope, groups });

const role = (id: string) => ({ id, code: id.toUpperCase(), title: id, color: '#ffffff', reportsTo: 'IC', directs: '—' });

// Blocks deliberately listed out of resolution order: the resolver sorts.
const config: CrisisTemplatesConfig = {
  checklistRoles: { ...META, roles: ['ic', 'gsoc-support', 'safety', 'finance'].map(role) },
  checklistBlocks: [
    cBlock(T('wildfire', 'grand-canyon'), [item('tp-1', 'ic')]),
    cBlock(T(null, 'grand-canyon'), [item('p-1', 'gsoc-support'), item('p-2', 'ic', 'demob')]),
    cBlock(GENERAL_SCOPE, [item('g-1', 'ic'), item('g-2', 'safety', 'ongoing'), item('g-3', 'ic', 'ongoing')]),
    cBlock(T('wildfire', null), [item('t-1', 'ic'), item('g-1', 'safety'), item('t-2', 'ghost-role')]),
    cBlock(T('flood', null), [item('f-1', 'finance')]),
    cBlock(T(null, 'glacier'), [item('gl-1', 'safety')]),
  ],
  intakeBlocks: [
    iBlock(T(null, 'grand-canyon'), [group('p-gc', ['pq-1'])]),
    iBlock(GENERAL_SCOPE, [group('g-what', ['gq-1', 'gq-2']), group('g-life', ['gq-3'])]),
    iBlock(T('wildfire', null), [group('t-wf', ['tq-1', 'gq-1']), group('t-wf-dup', ['gq-2'])]),
    iBlock(T('flood', null), [group('t-fl', ['fq-1'])]),
  ],
};

const ids = (tpl: ReturnType<typeof resolveChecklist>) =>
  Object.fromEntries(tpl.roles.map((r) => [r.id, r.phases.map((p) => `${p.id}:${p.items.map((i) => i.id).join(',')}`)]));

describe('scope helpers', () => {
  it('round-trips scope keys', () => {
    for (const s of [GENERAL_SCOPE, T('wildfire', null), T(null, 'glacier'), T('flood', 'windstar-ships')]) {
      expect(parseScopeKey(scopeKey(s))).toEqual(s);
    }
    expect(scopeKey(GENERAL_SCOPE)).toBe('*|*');
    expect(scopeKey(T('wildfire', 'glacier'))).toBe('wildfire|glacier');
  });

  it('rejects malformed scope keys', () => {
    for (const k of ['', '*', 'a|b|c', 'Wildfire|*', '*|glacier!', '1abc|*', '*|']) {
      expect(parseScopeKey(k)).toBeNull();
    }
  });

  it('compares, matches and ranks scopes', () => {
    expect(sameScope(T('a', null), T('a', null))).toBe(true);
    expect(sameScope(T('a', null), T(null, 'a'))).toBe(false);

    expect(scopeApplies(GENERAL_SCOPE, 'wildfire', null)).toBe(true);
    expect(scopeApplies(T('wildfire', null), 'wildfire', 'glacier')).toBe(true);
    expect(scopeApplies(T('wildfire', null), 'flood', 'glacier')).toBe(false);
    expect(scopeApplies(T(null, 'glacier'), 'flood', 'glacier')).toBe(true);
    // No property on the incident: property-scoped blocks never apply.
    expect(scopeApplies(T(null, 'glacier'), 'flood', null)).toBe(false);
    expect(scopeApplies(T('flood', 'glacier'), 'flood', 'glacier')).toBe(true);
    expect(scopeApplies(T('flood', 'glacier'), 'flood', 'yellowstone')).toBe(false);

    expect([GENERAL_SCOPE, T('a', null), T(null, 'b'), T('a', 'b')].map(scopeRank)).toEqual([0, 1, 2, 3]);
  });
});

describe('applicableBlocks', () => {
  it('keeps only applicable blocks, General → Type → Property → Type + Property', () => {
    const got = applicableBlocks(config.checklistBlocks, 'wildfire', 'grand-canyon').map((b) => scopeKey(b.scope));
    expect(got).toEqual(['*|*', 'wildfire|*', '*|grand-canyon', 'wildfire|grand-canyon']);
  });

  it('is stable within a rank', () => {
    const blocks = [cBlock(T('x', null), []), cBlock(GENERAL_SCOPE, [item('a', 'ic')]), cBlock(GENERAL_SCOPE, [item('b', 'ic')])];
    const got = applicableBlocks(blocks, 'x', null);
    expect(got.map((b) => b.items[0]?.id ?? '-')).toEqual(['a', 'b', '-']);
  });
});

describe('resolveChecklist', () => {
  it('groups items by role (role-list order) then phase, in resolution order', () => {
    const tpl = resolveChecklist(config, 'wildfire', 'grand-canyon');
    expect(ids(tpl)).toEqual({
      ic: ['immediate:g-1,t-1,tp-1', 'ongoing:g-3', 'demob:p-2'],
      'gsoc-support': ['immediate:p-1'],
      safety: ['ongoing:g-2'],
    });
    expect(tpl.roles.map((r) => r.id)).toEqual(['ic', 'gsoc-support', 'safety']);
  });

  it('keeps the first (most general) occurrence of a duplicated id', () => {
    const tpl = resolveChecklist(config, 'wildfire', null);
    // g-1 is General/ic; the Type block's safety copy is dropped.
    expect(ids(tpl).safety).toEqual(['ongoing:g-2']);
    expect(ids(tpl).ic[0]).toBe('immediate:g-1,t-1');
  });

  it('omits roles with no items and items whose role is unknown', () => {
    const tpl = resolveChecklist(config, 'wildfire', null);
    expect(tpl.roles.map((r) => r.id)).toEqual(['ic', 'safety']);
    const all = tpl.roles.flatMap((r) => r.phases.flatMap((p) => p.items.map((i) => i.id)));
    expect(all).not.toContain('t-2');
  });

  it('tags every item with the scope that contributed it', () => {
    const tpl = resolveChecklist(config, 'wildfire', 'grand-canyon');
    const byId = new Map(tpl.roles.flatMap((r) => r.phases.flatMap((p) => p.items)).map((i) => [i.id, i.scope]));
    expect(byId.get('g-1')).toEqual(GENERAL_SCOPE);
    expect(byId.get('t-1')).toEqual(T('wildfire', null));
    expect(byId.get('p-1')).toEqual(T(null, 'grand-canyon'));
    expect(byId.get('tp-1')).toEqual(T('wildfire', 'grand-canyon'));
  });

  it('gives an incident with no type match just the general items', () => {
    const tpl = resolveChecklist(config, 'earthquake', null);
    expect(ids(tpl)).toEqual({ ic: ['immediate:g-1', 'ongoing:g-3'], safety: ['ongoing:g-2'] });
    expect(resolveChecklist({ ...config, checklistBlocks: [] }, 'earthquake', null).roles).toEqual([]);
  });

  it('names the resolved template by type and property', () => {
    expect(resolveChecklist(config, 'wildfire', null).id).toBe('resolved:wildfire|*');
    expect(resolveChecklist(config, null, 'glacier').id).toBe('resolved:*|glacier');
  });
});

describe('resolveIntake', () => {
  it('concatenates groups in resolution order and numbers questions 1…n', () => {
    const tpl = resolveIntake(config, 'wildfire', 'grand-canyon');
    expect(tpl.groups.map((g) => g.id)).toEqual(['g-what', 'g-life', 't-wf', 'p-gc']);
    const qs = tpl.groups.flatMap((g) => g.questions);
    expect(qs.map((q) => q.id)).toEqual(['gq-1', 'gq-2', 'gq-3', 'tq-1', 'pq-1']);
    expect(qs.map((q) => q.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops duplicate question ids and groups they leave empty', () => {
    const tpl = resolveIntake(config, 'wildfire', null);
    const wf = tpl.groups.find((g) => g.id === 't-wf');
    expect(wf?.questions.map((q) => q.id)).toEqual(['tq-1']);
    expect(tpl.groups.some((g) => g.id === 't-wf-dup')).toBe(false);
  });

  it('tags groups with their scope', () => {
    const tpl = resolveIntake(config, 'flood', 'grand-canyon');
    expect(tpl.groups.map((g) => scopeKey(g.scope!))).toEqual(['*|*', '*|*', 'flood|*', '*|grand-canyon']);
  });
});

describe('contributing scopes', () => {
  it('lists distinct scopes in resolution order, skipping undefined', () => {
    expect(contributingScopes([T('a', 'b'), undefined, GENERAL_SCOPE, T(null, 'b'), GENERAL_SCOPE, T('a', null)]))
      .toEqual([GENERAL_SCOPE, T('a', null), T(null, 'b'), T('a', 'b')]);
  });

  it('reports only scopes that actually contributed content', () => {
    expect(checklistScopes(resolveChecklist(config, 'wildfire', 'glacier')).map(scopeKey))
      .toEqual(['*|*', 'wildfire|*', '*|glacier']);
    // No Yellowstone block exists, so the property scope contributes nothing.
    expect(intakeScopes(resolveIntake(config, 'flood', 'yellowstone')).map(scopeKey)).toEqual(['*|*', 'flood|*']);
  });
});

describe('retiredChecklistEntries', () => {
  const tpl = resolveChecklist(config, 'flood', null);

  it('returns state for ids outside the resolved template, newest first', () => {
    const got = retiredChecklistEntries(config, tpl, {
      'g-1': { checked: true, at: '2026-08-19T00:00:00.000Z' }, // live
      't-1': { checked: true, at: '2026-08-19T00:01:00.000Z', by: 'Sam' }, // wildfire item
      'gone-1': { checked: false, at: '2026-08-19T00:02:00.000Z' }, // in no block
    });
    expect(got).toEqual([
      { id: 'gone-1', text: null, roleId: null, checked: false, at: '2026-08-19T00:02:00.000Z' },
      { id: 't-1', text: 'text t-1', roleId: 'ic', checked: true, at: '2026-08-19T00:01:00.000Z', by: 'Sam' },
    ]);
  });

  it("falls back to the share route's retired map for text", () => {
    const filtered = {
      checklistBlocks: config.checklistBlocks.filter((b) => scopeApplies(b.scope, 'flood', null)),
      retiredChecklistItems: { 't-1': { text: 'Evacuate the trailhead', roleId: 'ops', phase: 'immediate' as const } },
    };
    const got = retiredChecklistEntries(filtered, tpl, { 't-1': { checked: true, at: 'x' } });
    expect(got).toEqual([{ id: 't-1', text: 'Evacuate the trailhead', roleId: 'ops', checked: true, at: 'x' }]);
  });

  it('is empty when every toggled item is live', () => {
    expect(retiredChecklistEntries(config, tpl, { 'f-1': { checked: true, at: 'x' } })).toEqual([]);
  });
});

describe('retiredIntakeEntries', () => {
  const tpl = resolveIntake(config, 'flood', null);

  it('returns non-empty answers to questions outside the resolved template', () => {
    const got = retiredIntakeEntries(config, tpl, {
      'gq-1': 'live answer',
      'tq-1': 'wildfire answer',
      'pq-1': '   ',
      'nowhere': 'orphan',
    });
    expect(got).toEqual([
      { id: 'tq-1', text: 'text tq-1', answer: 'wildfire answer' },
      { id: 'nowhere', text: null, answer: 'orphan' },
    ]);
  });

  it("falls back to the share route's retired map for text", () => {
    const got = retiredIntakeEntries(
      { intakeBlocks: [], retiredIntakeQuestions: { 'tq-1': { text: 'Fire front distance?', groupLabel: 'Wildfire' } } },
      tpl,
      { 'tq-1': '2 miles' }
    );
    expect(got).toEqual([{ id: 'tq-1', text: 'Fire front distance?', answer: '2 miles' }]);
  });
});

describe('mintTemplateId', () => {
  it('mints server-acceptable, prefixed, distinct ids', () => {
    const minted = Array.from({ length: 200 }, () => mintTemplateId());
    for (const id of minted) {
      expect(id).toMatch(TEMPLATE_ID_RE);
      expect(id).toMatch(/^x-[a-z0-9]{12}$/);
    }
    expect(new Set(minted).size).toBe(minted.length);
    expect(mintTemplateId('r')).toMatch(/^r-[a-z0-9]{12}$/);
  });
});

describe('isCrisisTemplatesConfig', () => {
  const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(config));

  it('accepts a well-formed config, with or without retired maps', () => {
    expect(isCrisisTemplatesConfig(clone())).toBe(true);
    expect(isCrisisTemplatesConfig({
      ...clone(),
      retiredChecklistItems: { a: { text: 't', roleId: 'ic', phase: 'immediate' } },
      retiredIntakeQuestions: { b: { text: 't', groupLabel: 'G' } },
    })).toBe(true);
  });

  it('rejects malformed payloads instead of letting them reach the renderer', () => {
    expect(isCrisisTemplatesConfig(null)).toBe(false);
    expect(isCrisisTemplatesConfig([])).toBe(false);
    expect(isCrisisTemplatesConfig({ ...clone(), checklistRoles: { roles: 'x' } })).toBe(false);

    const badItem = clone();
    (badItem.checklistBlocks as ChecklistBlock[])[0].items.push({ id: 'z', roleId: 'ic', phase: 'immediate', text: 42 } as never);
    expect(isCrisisTemplatesConfig(badItem)).toBe(false);

    const badScope = clone();
    (badScope.intakeBlocks as IntakeBlock[])[0].scope = { incidentType: null } as never;
    expect(isCrisisTemplatesConfig(badScope)).toBe(false);

    const badQuestion = clone();
    (badQuestion.intakeBlocks as IntakeBlock[])[0].groups[0].questions.push(null as never);
    expect(isCrisisTemplatesConfig(badQuestion)).toBe(false);

    const badRole = clone();
    (badRole.checklistRoles as { roles: unknown[] }).roles.push({ id: 'x', code: 'X', title: { t: 1 }, color: '#000000' });
    expect(isCrisisTemplatesConfig(badRole)).toBe(false);

    expect(isCrisisTemplatesConfig({ ...clone(), retiredChecklistItems: { a: { text: null } } })).toBe(false);
    expect(isCrisisTemplatesConfig({ ...clone(), retiredIntakeQuestions: [] })).toBe(false);
  });
});
