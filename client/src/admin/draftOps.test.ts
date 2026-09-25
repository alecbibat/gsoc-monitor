import { describe, expect, it } from 'vitest';
import {
  checklistIssues, checklistSignature, cleanChecklistItems, cleanIntakeGroups, cleanRoles,
  groupScopeEntries, insertAfter, insertChecklistItem, insertQuestion, intakeIssues, intakeSignature,
  mentionedIds, moveBefore, moveChecklistItem, namedInError, moveQuestion, nudge, nudgeChecklistItem, nudgeQuestion,
  removeById, removeQuestion, roleIssues, roleItems, roleUsage, splitPastedLines, tidyText, updateById,
  updateQuestion, withChecklistBlock, withIntakeBlock, type ScopeEntry,
} from './draftOps';
import {
  resolveChecklist, resolveIntake,
  type ChecklistBlock, type ChecklistBlockItem, type ChecklistRoleMeta, type CrisisTemplatesConfig,
  type IntakeBlockGroup,
} from '../crisis/templates/model';
import type { ChecklistPhaseId } from '../crisis/checklistTemplate';

const it_ = (id: string, roleId: string, phase: ChecklistPhaseId, text = id): ChecklistBlockItem =>
  ({ id, roleId, phase, text });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

const role = (id: string, over: Partial<ChecklistRoleMeta> = {}): ChecklistRoleMeta => ({
  id, code: id.toUpperCase().slice(0, 4), title: `Role ${id}`, color: '#112233', reportsTo: '', directs: '', ...over,
});

const meta = { custom: false, revision: 0, updatedAt: null, updatedBy: null };

function config(over: Partial<CrisisTemplatesConfig> = {}): CrisisTemplatesConfig {
  return {
    checklistRoles: { ...meta, roles: [role('ic'), role('ops')] },
    checklistBlocks: [
      { ...meta, scope: { incidentType: null, propertyId: null }, items: [it_('g1', 'ic', 'immediate')] },
      { ...meta, scope: { incidentType: 'wildfire', propertyId: null }, items: [it_('w1', 'ops', 'ongoing')] },
    ],
    intakeBlocks: [
      { ...meta, scope: { incidentType: null, propertyId: null }, groups: [{ id: 'g', label: 'General', questions: [{ id: 'q1', text: 'Who?' }] }] },
    ],
    ...over,
  };
}

describe('generic list ops', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('moveBefore moves, appends on null, and keeps identity for no-ops', () => {
    expect(ids(moveBefore(list, 'c', 'a'))).toEqual(['c', 'a', 'b']);
    expect(ids(moveBefore(list, 'a', null))).toEqual(['b', 'c', 'a']);
    expect(moveBefore(list, 'a', 'b')).toBe(list); // already right before b
    expect(moveBefore(list, 'b', 'b')).toBe(list);
    expect(moveBefore(list, 'zz', null)).toBe(list);
    expect(moveBefore(list, 'a', 'zz')).toBe(list);
  });

  it('nudge swaps with a neighbour and stops at the ends', () => {
    expect(ids(nudge(list, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(ids(nudge(list, 'b', 1))).toEqual(['a', 'c', 'b']);
    expect(nudge(list, 'a', -1)).toBe(list);
    expect(nudge(list, 'c', 1)).toBe(list);
  });

  it('insertAfter / removeById / updateById', () => {
    expect(ids(insertAfter(list, { id: 'x' }, 'a'))).toEqual(['a', 'x', 'b', 'c']);
    expect(ids(insertAfter(list, { id: 'x' }, null))).toEqual(['a', 'b', 'c', 'x']);
    expect(ids(removeById(list, 'b'))).toEqual(['a', 'c']);
    expect(removeById(list, 'zz')).toBe(list);
    const named = [{ id: 'a', name: 'A' }];
    expect(updateById(named, 'a', { name: 'A' })).toBe(named);
    expect(updateById(named, 'a', { name: 'B' })[0]).toEqual({ id: 'a', name: 'B' });
    expect(named[0].name).toBe('A'); // never mutates
  });
});

describe('checklist items', () => {
  // Deliberately interleaved: group position in the array is irrelevant.
  const items = [
    it_('a1', 'ic', 'immediate'),
    it_('o1', 'ops', 'immediate'),
    it_('a2', 'ic', 'immediate'),
    it_('a3', 'ic', 'ongoing'),
    it_('a4', 'ic', 'demob'),
  ];

  it('inserts after an anchor, or at the end of the item’s group', () => {
    expect(ids(insertChecklistItem(items, it_('n', 'ic', 'immediate'), 'a1'))).toEqual(['a1', 'n', 'o1', 'a2', 'a3', 'a4']);
    expect(ids(roleItems(insertChecklistItem(items, it_('n', 'ic', 'immediate')), 'ic'))).toEqual(['a1', 'a2', 'n', 'a3', 'a4']);
    expect(ids(insertChecklistItem(items, it_('n', 'safety', 'ongoing')))).toEqual([...ids(items), 'n']);
  });

  it('moves within and between phases of a role', () => {
    const within = moveChecklistItem(items, 'a2', { roleId: 'ic', phase: 'immediate', beforeId: 'a1' });
    expect(ids(roleItems(within, 'ic'))).toEqual(['a2', 'a1', 'a3', 'a4']);
    const across = moveChecklistItem(items, 'a1', { roleId: 'ic', phase: 'demob', beforeId: null });
    expect(across.find((i) => i.id === 'a1')?.phase).toBe('demob');
    expect(ids(roleItems(across, 'ic'))).toEqual(['a2', 'a3', 'a4', 'a1']);
    expect(items[0].phase).toBe('immediate'); // input untouched
  });

  it('refuses anchors outside the target group, and no-op moves keep identity', () => {
    expect(moveChecklistItem(items, 'a1', { roleId: 'ic', phase: 'ongoing', beforeId: 'o1' })).toBe(items);
    expect(moveChecklistItem(items, 'a1', { roleId: 'ic', phase: 'immediate', beforeId: 'a2' })).toBe(items);
    expect(moveChecklistItem(items, 'a1', { roleId: 'ic', phase: 'immediate', beforeId: 'a1' })).toBe(items);
    expect(moveChecklistItem(items, 'nope', { roleId: 'ic', phase: 'immediate', beforeId: null })).toBe(items);
  });

  it('nudges across phase boundaries within the role', () => {
    const upOut = nudgeChecklistItem(items, 'a3', -1); // top of ongoing → end of immediate
    expect(upOut.find((i) => i.id === 'a3')?.phase).toBe('immediate');
    expect(ids(roleItems(upOut, 'ic'))).toEqual(['a1', 'a2', 'a3', 'a4']);
    const downOut = nudgeChecklistItem(items, 'a2', 1); // bottom of immediate → start of ongoing
    expect(downOut.find((i) => i.id === 'a2')?.phase).toBe('ongoing');
    expect(ids(roleItems(downOut, 'ic'))).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(ids(roleItems(nudgeChecklistItem(items, 'a1', 1), 'ic'))).toEqual(['a2', 'a1', 'a3', 'a4']);
    expect(ids(roleItems(nudgeChecklistItem(items, 'a2', -1), 'ic'))).toEqual(['a2', 'a1', 'a3', 'a4']);
    expect(nudgeChecklistItem(items, 'a1', -1)).toBe(items); // first item, first phase
    expect(nudgeChecklistItem(items, 'a4', 1)).toBe(items); // last item, last phase
  });

  it('nudging into an empty phase lands in it', () => {
    const two = [it_('x', 'ic', 'immediate'), it_('y', 'ic', 'demob')];
    expect(nudgeChecklistItem(two, 'x', 1).find((i) => i.id === 'x')?.phase).toBe('ongoing');
    expect(nudgeChecklistItem(two, 'y', -1).find((i) => i.id === 'y')?.phase).toBe('ongoing');
  });

  it('cleans for saving: tidies text, drops empties, orders by role list then phase', () => {
    const messy = [
      it_('o1', 'ops', 'ongoing', '  Stage   crews\n'),
      it_('e', 'ic', 'immediate', '   '),
      it_('a2', 'ic', 'demob', 'Stand down'),
      it_('a1', 'ic', 'immediate', 'Assume command'),
      it_('u', 'ghost', 'immediate', 'Orphan'),
    ];
    expect(cleanChecklistItems(messy, ['ic', 'ops'])).toEqual([
      it_('a1', 'ic', 'immediate', 'Assume command'),
      it_('a2', 'ic', 'demob', 'Stand down'),
      it_('o1', 'ops', 'ongoing', 'Stage crews'),
      it_('u', 'ghost', 'immediate', 'Orphan'),
    ]);
  });

  it('signature ignores interleaving and blank items but not order within a phase', () => {
    const a = [it_('a1', 'ic', 'immediate'), it_('o1', 'ops', 'immediate'), it_('a2', 'ic', 'immediate')];
    const b = [it_('o1', 'ops', 'immediate'), it_('a1', 'ic', 'immediate'), it_('a2', 'ic', 'immediate'), it_('z', 'ic', 'ongoing', ' ')];
    expect(checklistSignature(a)).toBe(checklistSignature(b));
    const swapped = [it_('a2', 'ic', 'immediate'), it_('a1', 'ic', 'immediate'), it_('o1', 'ops', 'immediate')];
    expect(checklistSignature(a)).not.toBe(checklistSignature(swapped));
    const edited = [it_('a1', 'ic', 'immediate', 'changed'), it_('o1', 'ops', 'immediate'), it_('a2', 'ic', 'immediate')];
    expect(checklistSignature(a)).not.toBe(checklistSignature(edited));
    const trailing = [it_('a1', 'ic', 'immediate', 'a1  '), it_('o1', 'ops', 'immediate'), it_('a2', 'ic', 'immediate')];
    expect(checklistSignature(a)).toBe(checklistSignature(trailing));
  });

  it('flags limits and unknown roles, ignoring blank items', () => {
    const roles = new Set(['ic']);
    expect(checklistIssues([it_('a', 'ic', 'immediate'), it_('b', 'ic', 'immediate', ' ')], roles)).toEqual([]);
    const long = checklistIssues([it_('a', 'ic', 'immediate', 'x'.repeat(501))], roles);
    expect(long).toHaveLength(1);
    expect(long[0].id).toBe('a');
    expect(checklistIssues([it_('a', 'gone', 'immediate')], roles)[0].id).toBe('a');
    const many = Array.from({ length: 301 }, (_, i) => it_(`i${i}`, 'ic', 'immediate'));
    expect(checklistIssues(many, roles).some((x) => x.id === null)).toBe(true);
  });
});

describe('intake groups', () => {
  const groups: IntakeBlockGroup[] = [
    { id: 'g1', label: 'One', questions: [{ id: 'q1', text: 'A' }, { id: 'q2', text: 'B' }] },
    { id: 'g2', label: 'Two', questions: [{ id: 'q3', text: 'C' }] },
    { id: 'g3', label: 'Empty', questions: [] },
  ];
  const qids = (gs: IntakeBlockGroup[]) => gs.map((g) => g.questions.map((q) => q.id));

  it('inserts, updates and removes questions immutably', () => {
    expect(qids(insertQuestion(groups, 'g1', { id: 'n', text: '' }, 'q1'))).toEqual([['q1', 'n', 'q2'], ['q3'], []]);
    expect(qids(insertQuestion(groups, 'g3', { id: 'n', text: '' }))).toEqual([['q1', 'q2'], ['q3'], ['n']]);
    expect(insertQuestion(groups, 'nope', { id: 'n', text: '' })).toBe(groups);
    expect(updateQuestion(groups, 'q3', 'C!')[1].questions[0].text).toBe('C!');
    expect(updateQuestion(groups, 'q3', 'C')).toBe(groups);
    expect(qids(removeQuestion(groups, 'q1'))).toEqual([['q2'], ['q3'], []]);
    expect(groups[0].questions).toHaveLength(2);
  });

  it('moves questions within and between groups', () => {
    expect(qids(moveQuestion(groups, 'q2', { groupId: 'g1', beforeId: 'q1' }))).toEqual([['q2', 'q1'], ['q3'], []]);
    expect(qids(moveQuestion(groups, 'q1', { groupId: 'g2', beforeId: 'q3' }))).toEqual([['q2'], ['q1', 'q3'], []]);
    expect(qids(moveQuestion(groups, 'q1', { groupId: 'g3', beforeId: null }))).toEqual([['q2'], ['q3'], ['q1']]);
    expect(moveQuestion(groups, 'q1', { groupId: 'g1', beforeId: 'q2' })).toBe(groups);
    expect(moveQuestion(groups, 'q1', { groupId: 'g2', beforeId: 'q2' })).toBe(groups); // anchor not in target
  });

  it('nudges questions across group boundaries', () => {
    expect(qids(nudgeQuestion(groups, 'q2', 1))).toEqual([['q1'], ['q2', 'q3'], []]);
    expect(qids(nudgeQuestion(groups, 'q3', -1))).toEqual([['q1', 'q2', 'q3'], [], []]);
    expect(qids(nudgeQuestion(groups, 'q3', 1))).toEqual([['q1', 'q2'], [], ['q3']]);
    expect(nudgeQuestion(groups, 'q1', -1)).toBe(groups);
  });

  it('cleans for saving and compares by content', () => {
    const messy: IntakeBlockGroup[] = [
      { id: 'g1', label: ' One ', questions: [{ id: 'q1', text: 'A\n' }, { id: 'q9', text: '  ' }] },
      { id: 'new', label: '', questions: [{ id: 'q8', text: '' }] },
      { id: 'g3', label: 'Named, empty', questions: [] },
    ];
    expect(cleanIntakeGroups(messy)).toEqual([
      { id: 'g1', label: 'One', questions: [{ id: 'q1', text: 'A' }] },
      { id: 'g3', label: 'Named, empty', questions: [] },
    ]);
    expect(intakeSignature(messy)).toBe(intakeSignature(cleanIntakeGroups(messy)));
    expect(intakeSignature(groups)).not.toBe(intakeSignature(nudgeQuestion(groups, 'q2', -1)));
  });

  it('flags unnamed groups with questions and over-long text', () => {
    expect(intakeIssues(groups)).toEqual([]);
    const unnamed = intakeIssues([{ id: 'g', label: ' ', questions: [{ id: 'q', text: 'x' }] }]);
    expect(unnamed[0]).toMatchObject({ id: 'g' });
    const long = intakeIssues([{ id: 'g', label: 'G', questions: [{ id: 'q', text: 'x'.repeat(501) }] }]);
    expect(long[0]).toMatchObject({ id: 'q' });
  });
});

describe('roles', () => {
  it('validates required fields, duplicates and colors', () => {
    const ok = roleIssues([role('ic'), role('ops')]);
    expect(ok.count).toBe(0);
    const bad = roleIssues([
      role('ic', { code: 'IC' }),
      role('x', { code: 'ic', title: ' ' }),
      role('y', { code: 'TOOLONGCODE', color: 'red' }),
    ]);
    expect(bad.byRole.x).toMatchObject({ code: expect.any(String), title: 'Required' });
    expect(bad.byRole.ic?.code).toBeDefined(); // both halves of a duplicate are flagged
    expect(bad.byRole.y).toMatchObject({ code: expect.any(String), color: expect.any(String) });
    expect(roleIssues([]).general).toHaveLength(1);
  });

  it('cleans role text and lowercases colors', () => {
    expect(cleanRoles([role('ic', { title: ' Incident  Commander ', color: '#AABBCC' })])[0])
      .toMatchObject({ title: 'Incident Commander', color: '#aabbcc' });
  });

  it('counts item usage per role across blocks', () => {
    const blocks: ChecklistBlock[] = [
      { ...meta, scope: { incidentType: null, propertyId: null }, items: [it_('a', 'ic', 'immediate'), it_('b', 'ic', 'demob')] },
      { ...meta, scope: { incidentType: 'flood', propertyId: null }, items: [it_('c', 'ic', 'immediate'), it_('d', 'ops', 'ongoing')] },
    ];
    const usage = roleUsage(blocks);
    expect(usage.get('ic')).toEqual({ items: 3, scopes: 2 });
    expect(usage.get('ops')).toEqual({ items: 1, scopes: 1 });
    expect(usage.get('pio')).toBeUndefined();
  });
});

describe('preview merge', () => {
  it('substitutes a draft for an existing block, leaving the rest', () => {
    const c = config();
    const merged = withChecklistBlock(c, { incidentType: 'wildfire', propertyId: null }, [it_('w2', 'ic', 'immediate', 'Draft')]);
    const r = resolveChecklist(merged, 'wildfire', null);
    expect(r.roles.map((x) => x.id)).toEqual(['ic']);
    expect(r.roles[0].phases[0].items.map((i) => i.id)).toEqual(['g1', 'w2']);
    expect(c.checklistBlocks[1].items[0].id).toBe('w1'); // original untouched
  });

  it('adds a block for a scope that has none yet', () => {
    const merged = withChecklistBlock(config(), { incidentType: 'wildfire', propertyId: 'glacier' }, [it_('c1', 'ops', 'ongoing')]);
    expect(merged.checklistBlocks).toHaveLength(3);
    const r = resolveChecklist(merged, 'wildfire', 'glacier');
    expect(r.roles.find((x) => x.id === 'ops')?.phases[0].items.map((i) => i.id)).toEqual(['w1', 'c1']);
    expect(resolveChecklist(merged, 'wildfire', 'yellowstone').roles.find((x) => x.id === 'ops')?.phases[0].items)
      .toHaveLength(1);
  });

  it('does the same for intake, numbering across scopes', () => {
    const merged = withIntakeBlock(config(), { incidentType: 'flood', propertyId: null }, [
      { id: 'f', label: 'Flood', questions: [{ id: 'fq', text: 'Depth?' }] },
    ]);
    const r = resolveIntake(merged, 'flood', null);
    expect(r.groups.map((g) => g.id)).toEqual(['g', 'f']);
    expect(r.groups[1].questions[0]).toMatchObject({ id: 'fq', n: 2 });
  });
});

describe('misc', () => {
  it('tidyText collapses whitespace and control characters', () => {
    expect(tidyText('  a\n\tb\u0007  c ')).toBe('a b c');
  });

  it('finds ids a server error names, without prefix false-positives', () => {
    expect(mentionedIds('Item x-12 has empty text', ['x-1', 'x-12', 'x-2'])).toEqual(['x-12']);
    expect(mentionedIds('Duplicate id "x-1"', ['x-1', 'x-12'])).toEqual(['x-1']);
    expect(mentionedIds('Nothing here', ['x-1'])).toEqual([]);
  });

  it('finds the entries a server error names by quoted snippet or id', () => {
    const entries = [
      { id: 'a', text: 'Evacuate the lodge and account for every guest and employee on the roster' },
      { id: 'b', text: 'Call the park' },
      { id: 'c', text: 'Call the county' },
    ];
    expect(namedInError('Incident Commander → Immediate, item 2 ("Evacuate the lodge and account for every…") is 600 characters long', entries))
      .toEqual(['a']);
    expect(namedInError('Item 3 ("Call the park") is assigned to an unknown role "x"', entries)).toEqual(['b']);
    expect(namedInError('Item 1 repeats the id "c" of item 4', entries)).toEqual(['c']);
    expect(namedInError('Something else went wrong', entries)).toEqual([]);
  });

  it('splits a pasted list into lines without markers', () => {
    expect(splitPastedLines('- one\n• two\r\n\n3. three\n[ ] four\n  plain  ')).toEqual(['one', 'two', 'three', 'four', 'plain']);
    expect(splitPastedLines('single')).toEqual(['single']);
  });

  it('groups scope entries by kind and filters by every word', () => {
    const entries: ScopeEntry[] = [
      { scope: { incidentType: 'wildfire', propertyId: 'glacier' }, count: 1, custom: true },
      { scope: { incidentType: null, propertyId: null }, count: 5, custom: false },
      { scope: { incidentType: 'wildfire', propertyId: null }, count: 3, custom: false },
      { scope: { incidentType: 'flood', propertyId: null }, count: 2, custom: false },
      { scope: { incidentType: null, propertyId: 'glacier' }, count: 4, custom: true },
    ];
    const label = (s: ScopeEntry['scope']) =>
      [s.incidentType, s.propertyId].filter(Boolean).join(' ') || 'General';
    const all = groupScopeEntries(entries, '', label);
    expect(all.map((g) => g.rank)).toEqual([0, 1, 2, 3]);
    expect(all[1].entries.map((e) => e.scope.incidentType)).toEqual(['wildfire', 'flood']);
    const wild = groupScopeEntries(entries, 'WILD', label);
    expect(wild.map((g) => g.rank)).toEqual([1, 3]);
    expect(groupScopeEntries(entries, 'wildfire glacier', label).map((g) => g.rank)).toEqual([3]);
    expect(groupScopeEntries(entries, 'zzz', label)).toEqual([]);
  });
});
