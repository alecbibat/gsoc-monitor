import { beforeEach, describe, expect, it } from 'vitest';
import { entryTypeOf, extractPublicState, useCrisisStore, type ActionLogEntry, type Incident } from './crisisStore';

// The store is a module singleton — reset between tests.
beforeEach(() => {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
});

const active = (): Incident => {
  const s = useCrisisStore.getState();
  return s.incidents.find((i) => i.id === s.activeIncidentId)!;
};

describe('system log events', () => {
  it('seeds a created event on new incidents, typed from the picker', () => {
    useCrisisStore.getState().createIncident('wildfire');
    const inc = active();
    expect(inc.incidentType).toBe('wildfire');
    expect(inc.actionLog).toHaveLength(1);
    expect(inc.actionLog[0].system).toBe('created');
    expect(inc.actionLog[0].entryType).toBe('event');
    // Stored as 'event', but system entries DISPLAY as info everywhere —
    // badges, hide-info filters and counts all go through entryTypeOf.
    expect(entryTypeOf(inc.actionLog[0])).toBe('info');
  });

  it('classes entry types for display: system → info, missing → action', () => {
    const base = { id: 'x', timestamp: '2026-01-01T00:00:00.000Z', description: '' };
    expect(entryTypeOf({ ...base, entryType: 'action' })).toBe('action');
    expect(entryTypeOf({ ...base, entryType: 'event' })).toBe('event');
    expect(entryTypeOf({ ...base, entryType: 'info' })).toBe('info');
    // System entries read as info regardless of the stored type.
    expect(entryTypeOf({ ...base, entryType: 'event', system: 'status-change' })).toBe('info');
    // Snapshot entries published before entry types existed have none.
    expect(entryTypeOf(base as ActionLogEntry)).toBe('action');
  });

  it('logs status changes with from/to meta', () => {
    useCrisisStore.getState().createIncident();
    useCrisisStore.getState().update({ incidentStatus: 'recovery' });
    const [top] = active().actionLog;
    expect(top.system).toBe('status-change');
    expect(top.meta).toEqual({ from: 'active', to: 'recovery' });
    expect(top.description).toBe('Status changed: Active → Recovery');
  });

  it('does not log when a field patch leaves status unchanged', () => {
    useCrisisStore.getState().createIncident();
    useCrisisStore.getState().update({ incidentName: 'Ridge Fire' });
    expect(active().actionLog).toHaveLength(1); // just the created event
  });

  it('logs complexity changes', () => {
    useCrisisStore.getState().createIncident();
    useCrisisStore.getState().update({ complexityType: 'type-4' });
    expect(active().actionLog[0].system).toBe('complexity-change');
    expect(active().actionLog[0].meta?.to).toBe('type-4');
  });

  it('logs assignments and command transfers', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.assignRole('ic', 'Sarah Chen');
    expect(active().actionLog[0].system).toBe('assignment');
    expect(active().actionLog[0].description).toContain('Sarah Chen assigned as Incident Commander');

    st.assignRole('ic', 'Bob Diaz');
    const transfer = active().actionLog[0];
    expect(transfer.system).toBe('assignment');
    expect(transfer.description).toContain('replacing Sarah Chen');
    expect(transfer.meta?.replaced).toBe('Sarah Chen');
  });

  it('logs assignment release', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.assignRole('safety', 'Ana Ruiz');
    const assignment = active().assignments.find((a) => !a.endedAt && a.name === 'Ana Ruiz')!;
    st.endAssignment(assignment.id);
    expect(active().actionLog[0].system).toBe('assignment-ended');
    expect(active().actionLog[0].description).toContain('Ana Ruiz released from Safety Officer');
  });

  it('logs role add and remove with subtree counts', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.addRole({ title: 'Staging Manager', parentId: 'ops', color: '#fff', isCommandStaff: false, isSupport: false, order: 9 });
    expect(active().actionLog[0].system).toBe('role-added');

    st.removeRole('ops'); // removes ops + its two built-in children + the new role
    const removed = active().actionLog[0];
    expect(removed.system).toBe('role-removed');
    expect(removed.description).toContain('Operations Section Chief');
    expect(removed.meta?.subRoles).toBe('3');
  });

  it('logs stand-down and reopen alongside the state change', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    st.standDownIncident(id);
    let inc = useCrisisStore.getState().incidents.find((i) => i.id === id)!;
    expect(inc.incidentStatus).toBe('closed');
    expect(inc.actionLog[0].system).toBe('stood-down');

    st.reopenIncident(id);
    inc = useCrisisStore.getState().incidents.find((i) => i.id === id)!;
    expect(inc.incidentStatus).toBe('monitoring');
    expect(inc.actionLog[0].system).toBe('reopened');
  });

  it('stand-down releases open assignments and stamps reason; reopen clears the stamps', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    st.assignRole('ic', 'Sarah Chen');
    st.assignRole('ops', 'Bob Diaz');

    st.standDownIncident(id, '  Contained, guests accounted for  ');
    let inc = useCrisisStore.getState().incidents.find((i) => i.id === id)!;
    expect(inc.assignments.every((a) => !!a.endedAt)).toBe(true);
    expect(inc.standDownReason).toBe('Contained, guests accounted for');
    expect(inc.actionLog[0].meta?.reason).toBe('Contained, guests accounted for');
    expect(inc.actionLog[0].meta?.releasedAssignments).toBe('2');

    st.reopenIncident(id);
    inc = useCrisisStore.getState().incidents.find((i) => i.id === id)!;
    expect(inc.standDownReason).toBeNull();
    expect(inc.closedBy).toBeNull();
  });

  it('blocks edits on archived incidents until reopened', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    st.update({ incidentName: 'Ridge Fire' });
    st.standDownIncident(id, 'done');

    // The incident is no longer active (stand-down navigates to the list);
    // reopen it in the editor the way the archive's View button does.
    st.openIncident(id);
    const before = useCrisisStore.getState().incidents.find((i) => i.id === id)!;
    st.update({ incidentName: 'Renamed after closing' });
    st.assignRole('ic', 'Late Larry');
    st.addActionEntry('action');
    const after = useCrisisStore.getState().incidents.find((i) => i.id === id)!;
    expect(after).toBe(before); // every mutation was a no-op

    st.reopenIncident(id);
    st.update({ incidentName: 'Renamed after reopening' });
    expect(useCrisisStore.getState().incidents.find((i) => i.id === id)!.incidentName)
      .toBe('Renamed after reopening');
  });

  it('logs vessel changes with what came and went', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.toggleIncidentShip('311083000'); // Star Breeze
    st.toggleIncidentShip('309242000'); // Wind Surf
    expect(active().shipMmsis).toEqual(['311083000', '309242000']);
    const [added] = active().actionLog;
    expect(added.system).toBe('vessels-change');
    expect(added.meta).toEqual({ added: 'Wind Surf', count: '2' });
    expect(added.description).toContain('Star Breeze and Wind Surf');

    st.toggleIncidentShip('311083000');
    expect(active().shipMmsis).toEqual(['309242000']);
    expect(active().actionLog[0].meta).toEqual({ removed: 'Star Breeze', count: '1' });
  });

  it('normalizes the vessel list and stays quiet when nothing changes', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    // Reverse order, a duplicate, and an MMSI no longer in the fleet.
    st.setIncidentShips(['309242000', '311083000', '309242000', '999999999']);
    expect(active().shipMmsis).toEqual(['311083000', '309242000']);
    const logLength = active().actionLog.length;
    st.setIncidentShips(['309242000', '311083000']); // same set, different order
    expect(active().actionLog).toHaveLength(logLength);
  });

  it('freezes vessel edits on a stood-down incident', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    st.toggleIncidentShip('311083000');
    st.standDownIncident(id, 'done');
    st.openIncident(id);
    st.toggleIncidentShip('309242000');
    st.setIncidentShips([]);
    expect(active().shipMmsis).toEqual(['311083000']);
  });

  it('publishes vessel identities, always as a concrete list', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    expect(extractPublicState(active()).shipMmsis).toEqual([]);
    st.toggleIncidentShip('311083000');
    expect(extractPublicState(active()).shipMmsis).toEqual(['311083000']);
  });

  it('logs share-link publish and revoke', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.addShareLink('tok-1', 'https://x/share/tok-1', 'pw');
    expect(active().actionLog[0].system).toBe('share-created');
    st.deactivateShareLink('tok-1');
    expect(active().actionLog[0].system).toBe('share-revoked');
  });
});
