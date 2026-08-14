import { beforeEach, describe, expect, it } from 'vitest';
import { useCrisisStore, type Incident } from './crisisStore';

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

  it('logs share-link publish and revoke', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.addShareLink('tok-1', 'https://x/share/tok-1', 'pw');
    expect(active().actionLog[0].system).toBe('share-created');
    st.deactivateShareLink('tok-1');
    expect(active().actionLog[0].system).toBe('share-revoked');
  });
});
