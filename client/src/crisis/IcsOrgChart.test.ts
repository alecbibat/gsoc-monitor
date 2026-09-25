import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, type IcsRole } from './crisisStore';
import { chartOrder, dropZoneAt, roleDropTarget } from './IcsOrgChart';

// Pure drag-and-drop geometry and legality behind the org chart's drop
// indicators. The store side of a move (renumbering, logging) is covered by
// crisisStore.test.ts; these decide what a hovered card offers.

const rect = { left: 100, top: 50, width: 90, height: 60 };

describe('dropZoneAt', () => {
  it('splits a card into left / middle / right thirds', () => {
    expect(dropZoneAt(rect, 110, 80, false)).toBe('before');
    expect(dropZoneAt(rect, 145, 80, false)).toBe('child');
    expect(dropZoneAt(rect, 185, 80, false)).toBe('after');
  });

  it('splits top-level cards (stacked vertically) into top / middle / bottom', () => {
    expect(dropZoneAt(rect, 110, 55, true)).toBe('before');
    expect(dropZoneAt(rect, 110, 80, true)).toBe('child');
    expect(dropZoneAt(rect, 185, 105, true)).toBe('after');
  });

  it('treats a zero-size card as its middle', () => {
    expect(dropZoneAt({ left: 0, top: 0, width: 0, height: 0 }, 0, 0, false)).toBe('child');
  });
});

describe('roleDropTarget', () => {
  const roles = DEFAULT_ROLES;

  it('forbids dropping a role on itself or anywhere in its subtree', () => {
    for (const zone of ['before', 'child', 'after'] as const) {
      expect(roleDropTarget(roles, 'ops', 'ops', zone)).toBeNull();
      expect(roleDropTarget(roles, 'ops', 'ops-division', zone)).toBeNull();
      expect(roleDropTarget(roles, 'planning', 'plan-docs', zone)).toBeNull();
    }
  });

  it('forbids unknown roles', () => {
    expect(roleDropTarget(roles, 'nope', 'ops', 'child')).toBeNull();
    expect(roleDropTarget(roles, 'ops', 'nope', 'child')).toBeNull();
  });

  it('makes the middle of a card "sub-role of" it', () => {
    expect(roleDropTarget(roles, 'safety', 'ops', 'child')).toEqual({ parentId: 'ops' });
  });

  it('places before/after the hovered card, in its row', () => {
    // General staff under the IC: ops, planning, logistics, finance.
    expect(roleDropTarget(roles, 'fin-cost', 'planning', 'before')).toEqual({
      parentId: 'ic', beforeRoleId: 'planning', isCommandStaff: false,
    });
    expect(roleDropTarget(roles, 'fin-cost', 'planning', 'after')).toEqual({
      parentId: 'ic', beforeRoleId: 'logistics', isCommandStaff: false,
    });
    // After the last card = to the end.
    expect(roleDropTarget(roles, 'fin-cost', 'finance', 'after')).toEqual({
      parentId: 'ic', beforeRoleId: null, isCommandStaff: false,
    });
    // Beside a command-staff card = into the command-staff row.
    expect(roleDropTarget(roles, 'plan-docs', 'pio', 'before')).toEqual({
      parentId: 'ic', beforeRoleId: 'pio', isCommandStaff: true,
    });
  });

  it('skips the dragged role itself when resolving "after"', () => {
    // Command staff: safety, pio, liaison. Dropping safety after pio lands it
    // before liaison — not "before safety", which would be a no-op.
    expect(roleDropTarget(roles, 'safety', 'pio', 'after')).toEqual({
      parentId: 'ic', beforeRoleId: 'liaison', isCommandStaff: true,
    });
  });

  it('lets a top-level role move only beside other top-level roles', () => {
    const withSecondRoot: IcsRole[] = [
      ...roles,
      { id: 'area', title: 'Area Command', parentId: null, color: '#fff', isCommandStaff: false, isSupport: false, order: 1, builtin: false },
    ];
    expect(roleDropTarget(withSecondRoot, 'ic', 'area', 'after')).toEqual({
      parentId: null, beforeRoleId: null, isCommandStaff: false,
    });
    expect(roleDropTarget(withSecondRoot, 'ic', 'area', 'child')).toBeNull();
    expect(roleDropTarget(withSecondRoot, 'area', 'ops', 'child')).toBeNull();
    expect(roleDropTarget(withSecondRoot, 'area', 'ops', 'before')).toBeNull();
    // Any other role may become top-level by dropping beside a root.
    expect(roleDropTarget(withSecondRoot, 'ops', 'area', 'before')).toEqual({
      parentId: null, beforeRoleId: 'area', isCommandStaff: false,
    });
  });
});

describe('chartOrder', () => {
  it('lists roles depth-first as drawn: command staff, then general staff', () => {
    const order = chartOrder(DEFAULT_ROLES);
    expect(order).toHaveLength(DEFAULT_ROLES.length);
    expect(order.slice(0, 7).map((o) => [o.role.id, o.depth])).toEqual([
      ['ic', 0],
      ['safety', 1],
      ['pio', 1],
      ['gsoc-support', 2],
      ['liaison', 1],
      ['ops', 1],
      ['ops-branch', 2],
    ]);
  });

  it('omits roles whose parent is missing (they are not on the chart)', () => {
    const orphan: IcsRole = { id: 'lost', title: 'Lost', parentId: 'gone', color: '#fff', isCommandStaff: false, isSupport: false, order: 0, builtin: false };
    expect(chartOrder([...DEFAULT_ROLES, orphan]).some((o) => o.role.id === 'lost')).toBe(false);
  });
});
