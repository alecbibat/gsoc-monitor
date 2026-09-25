import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeAssignmentsInSubtree, assignmentRoleTitle, isSamePerson, useCrisisStore,
  type Incident,
} from './crisisStore';

// Org-chart staffing rules: removing roles never loses people or history,
// moves say which seat they left, and re-assigning the current holder isn't a
// new assignment.

beforeEach(() => {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
});
afterEach(() => {
  vi.useRealTimers();
});

const active = (): Incident => {
  const s = useCrisisStore.getState();
  return s.incidents.find((i) => i.id === s.activeIncidentId)!;
};
const st = () => useCrisisStore.getState();
const holders = (roleId: string) => active().assignments.filter((a) => a.roleId === roleId && !a.endedAt);

describe('removeRole', () => {
  it('refuses while the role itself is staffed', () => {
    st().createIncident();
    st().assignRole('safety', 'Ana Ruiz');
    const before = active();
    st().removeRole('safety');
    expect(active()).toBe(before);
  });

  it('refuses while anyone beneath it is staffed, however deep', () => {
    st().createIncident();
    st().assignRole('ops-branch', 'Bob Diaz'); // under ops, under ic
    const before = active();
    st().removeRole('ops');
    st().removeRole('ic');
    expect(active()).toBe(before);
    expect(active().roles.some((r) => r.id === 'ops')).toBe(true);
  });

  it('keeps ended assignments of removed roles as the staffing record', () => {
    st().createIncident();
    st().assignRole('ops-branch', 'Bob Diaz');
    st().endAssignment(holders('ops-branch')[0].id);
    st().removeRole('ops');

    const inc = active();
    expect(inc.roles.some((r) => r.id === 'ops' || r.id === 'ops-branch')).toBe(false);
    expect(inc.assignments).toHaveLength(1);
    expect(inc.assignments[0]).toMatchObject({ roleId: 'ops-branch', name: 'Bob Diaz' });
    expect(inc.assignments[0].endedAt).toBeTruthy();

    const [removed] = inc.actionLog;
    expect(removed.system).toBe('role-removed');
    expect(removed.meta).toMatchObject({ roleId: 'ops', roleTitle: 'Operations Section Chief', subRoles: '2' });
  });

  it('does nothing (and logs nothing) for an unknown role', () => {
    st().createIncident();
    const before = active();
    st().removeRole('nope');
    expect(active()).toBe(before);
  });

  it('reattaches history when a builtin role is restored', () => {
    st().createIncident();
    st().assignRole('fin-cost', 'Cara Ng');
    st().endAssignment(holders('fin-cost')[0].id);
    st().removeRole('fin-cost');
    st().restoreBuiltinRole('fin-cost');
    expect(active().assignments.filter((a) => a.roleId === 'fin-cost')).toHaveLength(1);
  });
});

describe('assignmentRoleTitle', () => {
  it('reads live roles first, then the log for removed ones', () => {
    st().createIncident();
    st().addRole({ title: 'Evacuation Coordinator', parentId: 'ops', color: '#fff', isCommandStaff: false, isSupport: false, order: 9 });
    const custom = active().roles.find((r) => r.title === 'Evacuation Coordinator')!;
    st().assignRole(custom.id, 'Dee Park');
    st().endAssignment(holders(custom.id)[0].id);
    st().removeRole(custom.id);

    expect(assignmentRoleTitle(active(), 'ic')).toBe('Incident Commander');
    expect(assignmentRoleTitle(active(), custom.id)).toBe('Evacuation Coordinator');
    expect(assignmentRoleTitle(active(), 'never-existed')).toBeUndefined();
  });
});

describe('assignRole', () => {
  it('logs the seat a move leaves, and that it is now vacant', () => {
    st().createIncident();
    st().assignRole('ic', 'Sarah Chen');
    st().assignRole('ops', 'Sarah Chen');

    expect(holders('ic')).toHaveLength(0);
    expect(holders('ops').map((a) => a.name)).toEqual(['Sarah Chen']);
    const [top] = active().actionLog;
    expect(top.system).toBe('assignment');
    expect(top.description).toBe(
      'Sarah Chen assigned as Operations Section Chief (moved from Incident Commander, now vacant)'
    );
    expect(top.meta).toMatchObject({ from: 'Incident Commander', fromRoleId: 'ic', vacated: 'Incident Commander' });
  });

  it('combines a replacement and a move in one entry', () => {
    st().createIncident();
    st().assignRole('ops', 'Bob Diaz');
    st().assignRole('ic', 'Sarah Chen');
    st().assignRole('ops', 'Sarah Chen');
    const [top] = active().actionLog;
    expect(top.description).toBe(
      'Sarah Chen assigned as Operations Section Chief (replacing Bob Diaz; moved from Incident Commander, now vacant)'
    );
    expect(top.meta?.replaced).toBe('Bob Diaz');
  });

  it('does not call a support seat vacant while others still hold it', () => {
    st().createIncident();
    st().assignRole('gsoc-support', 'Ana Ruiz');
    st().assignRole('gsoc-support', 'Eli Moss');
    st().assignRole('pio', 'Ana Ruiz');
    const [top] = active().actionLog;
    expect(top.description).toBe('Ana Ruiz assigned as Public Information Officer (moved from GSOC Support)');
    expect(top.meta?.vacated).toBeUndefined();
    expect(holders('gsoc-support').map((a) => a.name)).toEqual(['Eli Moss']);
  });

  it('re-assigning the current holder is not a new assignment', () => {
    st().createIncident();
    st().assignRole('ic', 'Sarah Chen', { phone: '555-0100' });
    const before = active();
    st().assignRole('ic', 'sarah chen');
    expect(active()).toBe(before); // nothing new: no bar split, no log line

    st().assignRole('ic', 'Sarah Chen', { phone: '555-0199', email: 'sc@example.com' });
    const inc = active();
    expect(inc.assignments).toHaveLength(1);
    expect(inc.assignments[0]).toMatchObject({ name: 'Sarah Chen', phone: '555-0199', email: 'sc@example.com' });
    expect(inc.assignments[0].startedAt).toBe(before.assignments[0].startedAt);
    expect(inc.actionLog).toBe(before.actionLog);
  });

  it('links a typed holder to their pool entry instead of duplicating them', () => {
    st().createIncident();
    st().assignRole('ic', 'Sarah Chen');
    st().assignRole('ic', 'Sarah Chen', undefined, 'p-1');
    expect(active().assignments).toHaveLength(1);
    expect(active().assignments[0].personnelId).toBe('p-1');
  });

  it('never lists the same person twice on a support role', () => {
    st().createIncident();
    st().assignRole('gsoc-support', 'Ana Ruiz', undefined, 'p-1');
    st().assignRole('gsoc-support', 'Ana Ruiz', undefined, 'p-1');
    expect(holders('gsoc-support')).toHaveLength(1);
  });

  it('keeps namesakes with different pool ids apart', () => {
    st().createIncident();
    st().assignRole('gsoc-support', 'Alex Kim', undefined, 'p-1');
    st().assignRole('gsoc-support', 'Alex Kim', undefined, 'p-2');
    expect(holders('gsoc-support')).toHaveLength(2);
  });

  it('ignores a role that no longer exists', () => {
    st().createIncident();
    const before = active();
    st().assignRole('gone', 'Sarah Chen');
    expect(active()).toBe(before);
  });
});

describe('endAssignment', () => {
  it('never re-stamps an assignment that already ended', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
    st().createIncident();
    st().assignRole('safety', 'Ana Ruiz');
    const id = holders('safety')[0].id;
    vi.setSystemTime(new Date('2026-03-01T11:00:00Z'));
    st().endAssignment(id);
    const before = active();

    vi.setSystemTime(new Date('2026-03-01T15:00:00Z'));
    st().endAssignment(id);
    expect(active()).toBe(before);
    expect(active().assignments[0].endedAt).toBe('2026-03-01T11:00:00.000Z');
  });
});

describe('helpers', () => {
  it('isSamePerson: pool id when both have one, else name', () => {
    expect(isSamePerson({ name: 'Alex Kim', personnelId: 'p-1' }, 'Alex Kim', 'p-2')).toBe(false);
    expect(isSamePerson({ name: 'Alex Kim', personnelId: 'p-1' }, 'A. Kim', 'p-1')).toBe(true);
    expect(isSamePerson({ name: 'Alex Kim' }, ' alex kim ', 'p-1')).toBe(true);
    expect(isSamePerson({ name: 'Alex Kim', personnelId: 'p-1' }, 'alex kim')).toBe(true);
  });

  it('activeAssignmentsInSubtree: open assignments on the role and beneath it', () => {
    st().createIncident();
    st().assignRole('planning', 'Pat Lee');
    st().assignRole('plan-docs', 'Rae Wu');
    st().assignRole('ops', 'Bob Diaz');
    st().endAssignment(holders('planning')[0].id);
    const inc = active();
    expect(activeAssignmentsInSubtree(inc.roles, inc.assignments, 'planning').map((a) => a.name)).toEqual(['Rae Wu']);
    expect(activeAssignmentsInSubtree(inc.roles, inc.assignments, 'ic')).toHaveLength(2);
    expect(activeAssignmentsInSubtree(inc.roles, inc.assignments, 'finance')).toHaveLength(0);
  });
});
