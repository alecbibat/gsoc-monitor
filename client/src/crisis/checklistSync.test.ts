import { describe, expect, it } from 'vitest';
import { mergeChecklists } from './checklistSync';
import type { ChecklistStateMap } from './checklistTemplate';

const at = (m: number) => `2026-08-19T10:${String(m).padStart(2, '0')}:00.000Z`;

describe('mergeChecklists', () => {
  const remote: ChecklistStateMap = {
    'ic-imm-1': { checked: true, at: at(0), by: 'Ops' },
    'ic-imm-2': { checked: false, at: at(1) },
  };

  it('takes the server map wholesale when nothing is in flight', () => {
    const local: ChecklistStateMap = { 'ic-imm-1': { checked: false, at: at(2) } };
    expect(mergeChecklists(remote, local, new Set())).toBe(remote);
  });

  it('keeps local state for items whose own push is still in flight', () => {
    // A stale SSE snapshot must not visually revert a toggle the user just
    // made; the item's own response/echo converges it.
    const local: ChecklistStateMap = { 'ic-imm-1': { checked: false, at: at(2), by: 'Me' } };
    const merged = mergeChecklists(remote, local, new Set(['ic-imm-1']));
    expect(merged['ic-imm-1']).toEqual(local['ic-imm-1']);
    expect(merged['ic-imm-2']).toEqual(remote['ic-imm-2']);
  });

  it('ignores in-flight ids with no local entry', () => {
    const merged = mergeChecklists(remote, {}, new Set(['ic-imm-1']));
    expect(merged).toEqual(remote);
  });
});
