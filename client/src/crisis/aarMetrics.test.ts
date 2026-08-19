import { beforeEach, describe, expect, it } from 'vitest';
import { useCrisisStore, type Incident } from './crisisStore';
import { buildSwimlane, computeAarMetrics, fmtSpan } from './aarMetrics';

beforeEach(() => {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
});

const active = (): Incident => {
  const s = useCrisisStore.getState();
  return s.incidents.find((i) => i.id === s.activeIncidentId)!;
};

const T0 = '2026-08-01T10:00:00.000Z';
const H = 3_600_000;
const at = (hours: number) => new Date(Date.parse(T0) + hours * H).toISOString();

function makeIncident(over: Partial<Incident>): Incident {
  useCrisisStore.getState().createIncident('wildfire');
  return { ...active(), ...over };
}

describe('computeAarMetrics', () => {
  it('computes duration from start to stand-down', () => {
    const inc = makeIncident({ createdAt: at(0), incidentDatetime: at(0), archivedAt: at(30) });
    expect(computeAarMetrics(inc).durationMs).toBe(30 * H);
  });

  it('prefers incidentDatetime over createdAt for the start', () => {
    const inc = makeIncident({ createdAt: at(2), incidentDatetime: at(0), archivedAt: at(10) });
    expect(computeAarMetrics(inc).durationMs).toBe(10 * H);
  });

  it('derives time-to-active from the earliest to-active transition', () => {
    const inc = makeIncident({
      createdAt: at(0),
      archivedAt: at(20),
      actionLog: [
        { id: 'b', timestamp: at(5), description: '', entryType: 'event', system: 'status-change', meta: { from: 'monitoring', to: 'active' } },
        { id: 'a', timestamp: at(2), description: '', entryType: 'event', system: 'status-change', meta: { from: 'monitoring', to: 'active' } },
      ],
    });
    const m = computeAarMetrics(inc);
    expect(m.timeToActiveMs).toBe(2 * H);
    expect(m.activeAtCreation).toBe(false);
  });

  it('marks active-at-creation when no transition was ever logged', () => {
    const inc = makeIncident({ actionLog: [] });
    const m = computeAarMetrics(inc);
    expect(m.timeToActiveMs).toBeNull();
    expect(m.activeAtCreation).toBe(true);
  });

  it('does not count a post-reopen re-activation as time-to-active', () => {
    // Created Active (store default) → stood down → reopened → escalated.
    // The monitoring→active transition at +12h is a RE-activation.
    const inc = makeIncident({
      createdAt: at(0),
      actionLog: [
        { id: 's', timestamp: at(10), description: '', entryType: 'event', system: 'stood-down' },
        { id: 'r', timestamp: at(12), description: '', entryType: 'event', system: 'status-change', meta: { from: 'monitoring', to: 'active' } },
      ],
    });
    const m = computeAarMetrics(inc);
    expect(m.timeToActiveMs).toBeNull();
    expect(m.activeAtCreation).toBe(true);
  });

  it('reports never-active for a monitoring-only incident', () => {
    const inc = makeIncident({
      actionLog: [
        { id: 'a', timestamp: at(1), description: '', entryType: 'event', system: 'status-change', meta: { from: 'monitoring', to: 'recovery' } },
      ],
    });
    const m = computeAarMetrics(inc);
    expect(m.timeToActiveMs).toBeNull();
    expect(m.activeAtCreation).toBe(false);
  });

  it('same-person IC re-assignment is not a command transfer', () => {
    const inc = makeIncident({
      assignments: [
        { id: '1', roleId: 'ic', name: 'Sarah Chen', startedAt: at(0), endedAt: at(2) },
        { id: '2', roleId: 'ic', name: 'Sarah Chen', startedAt: at(2) },
      ],
    });
    expect(computeAarMetrics(inc).commandTransfers).toBe(0);
  });

  it('counts transfers on a rebuilt command role (custom root id)', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    const base = active();
    const inc: Incident = {
      ...base,
      roles: [{ id: 'cmd-x', title: 'Commander', parentId: null, color: '#fff', isCommandStaff: false, isSupport: false, order: 0, builtin: false }],
      assignments: [
        { id: '1', roleId: 'cmd-x', name: 'Sarah', startedAt: at(0), endedAt: at(2) },
        { id: '2', roleId: 'cmd-x', name: 'Bob', startedAt: at(2) },
      ],
    };
    expect(computeAarMetrics(inc).commandTransfers).toBe(1);
  });

  it('distinguishes two people who share a name via personnelId', () => {
    const inc = makeIncident({
      assignments: [
        { id: '1', roleId: 'ops', name: 'J. Smith', personnelId: 'p1', startedAt: at(0) },
        { id: '2', roleId: 'planning', name: 'J. Smith', personnelId: 'p2', startedAt: at(1) },
      ],
    });
    expect(computeAarMetrics(inc).personnelCount).toBe(2);
  });

  it('counts unique personnel, assignments, and command transfers', () => {
    const st = useCrisisStore.getState();
    st.createIncident();
    st.assignRole('ic', 'Sarah Chen');
    st.assignRole('ic', 'Bob Diaz');       // transfer
    st.assignRole('ops', 'Sarah Chen');    // same person, second seat
    const m = computeAarMetrics(active());
    expect(m.personnelCount).toBe(2);
    expect(m.assignmentCount).toBe(3);
    expect(m.commandTransfers).toBe(1);
  });

  it('splits log counts into operator vs system entries', () => {
    const st = useCrisisStore.getState();
    st.createIncident();          // 1 system 'created' event
    st.addActionEntry('action');  // 1 operator entry
    const m = computeAarMetrics(active());
    expect(m.logTotal).toBe(2);
    expect(m.operatorEntries).toBe(1);
    // Auto-generated entries class as system in logByType, matching the log views.
    expect(m.logByType).toEqual({ action: 1, event: 0, info: 0, system: 1 });
  });
});

describe('buildSwimlane', () => {
  it('returns null with no assignments', () => {
    const inc = makeIncident({});
    expect(buildSwimlane(inc)).toBeNull();
  });

  it('builds one row per staffed role with clamped bars', () => {
    const inc = makeIncident({
      createdAt: at(0),
      archivedAt: at(10),
      assignments: [
        { id: '1', roleId: 'ic', name: 'Sarah', startedAt: at(1), endedAt: at(4) },
        { id: '2', roleId: 'ic', name: 'Bob', startedAt: at(4) },          // open at close
        { id: '3', roleId: 'ops', name: 'Kim', startedAt: at(2), endedAt: at(8) },
      ],
    });
    const lane = buildSwimlane(inc)!;
    expect(lane.rows.map((r) => r.roleId)).toEqual(['ic', 'ops']); // roles order, only staffed
    expect(lane.rows[0].bars).toHaveLength(2);
    expect(lane.rows[0].bars[1].open).toBe(true);
    expect(lane.rows[0].bars[1].endMs).toBe(lane.t1);
    expect(lane.t1).toBe(Date.parse(at(10)));
  });
});

describe('AAR store actions', () => {
  it('edits AAR content on an ARCHIVED incident (post-incident exemption)', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    st.standDownIncident(id);
    expect(active().archivedAt).toBeTruthy();

    st.updateAar(id, { wentWell: 'Fast comms' });
    expect(active().aar?.wentWell).toBe('Fast comms');

    // Regular edits stay frozen.
    st.update({ incidentName: 'should not apply' });
    expect(active().incidentName).not.toBe('should not apply');
  });

  it('merges question patches without clobbering siblings', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    st.updateAar(id, { expected: 'A' });
    st.updateAar(id, { improve: 'B' });
    expect(active().aar).toMatchObject({ expected: 'A', improve: 'B' });
  });

  it('corrective actions: add, update, toggle, remove', () => {
    const st = useCrisisStore.getState();
    const id = st.createIncident();
    const aid = st.addCorrectiveAction(id);
    st.updateCorrectiveAction(id, aid, { text: 'Pre-stage radios', owner: 'Ops' });
    st.updateCorrectiveAction(id, aid, { done: true });
    expect(active().aar?.correctiveActions).toEqual([
      { id: aid, text: 'Pre-stage radios', owner: 'Ops', done: true },
    ]);
    st.removeCorrectiveAction(id, aid);
    expect(active().aar?.correctiveActions).toEqual([]);
  });
});

describe('fmtSpan', () => {
  it('humanizes spans coarsely', () => {
    expect(fmtSpan(18 * 60_000)).toBe('18m');
    expect(fmtSpan(5 * H + 12 * 60_000)).toBe('5h 12m');
    expect(fmtSpan(76 * H)).toBe('3d 4h');
  });
});
