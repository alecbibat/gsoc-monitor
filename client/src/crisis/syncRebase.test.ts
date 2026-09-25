import { describe, expect, it } from 'vitest';
import { rebaseIncident } from './syncRebase';

const base = {
  id: 'c-1',
  incidentName: 'Ridge Fire',
  incidentStatus: 'active',
  executiveSummary: '',
  intake: { 'g-what-1': 'Smoke seen from lodge' } as Record<string, string>,
  roles: [
    { id: 'ic', title: 'Incident Commander', color: '#fff', order: 0 },
    { id: 'safety', title: 'Safety Officer', color: '#f00', order: 0 },
  ],
  assignments: [] as { id: string; roleId: string; name: string; endedAt?: string }[],
  liveLayers: ['wildfires'] as string[],
  actionLog: [{ id: 'e1' }],
  checklists: {},
};

describe('rebaseIncident', () => {
  it("keeps a peer's change to a field this tab never touched", () => {
    const local = { ...base, executiveSummary: 'Evacuating Many Glacier' };
    const remote = { ...base, incidentStatus: 'recovery' };
    const out = rebaseIncident(base, local, remote);
    expect(out.incidentStatus).toBe('recovery');
    expect(out.executiveSummary).toBe('Evacuating Many Glacier');
  });

  it('merges the intake answer map key by key', () => {
    const local = { ...base, intake: { ...base.intake, 'g-what-2': 'Near the ridge trail' } };
    const remote = { ...base, intake: { ...base.intake, 'g-life-1': 'No injuries' } };
    expect(rebaseIncident(base, local, remote).intake).toEqual({
      'g-what-1': 'Smoke seen from lodge',
      'g-what-2': 'Near the ridge trail',
      'g-life-1': 'No injuries',
    });
  });

  it('honors a local clear of an answer the peer did not touch', () => {
    const { 'g-what-1': _gone, ...cleared } = base.intake;
    const local = { ...base, intake: cleared };
    const remote = { ...base, intake: { ...base.intake, 'g-life-1': 'No injuries' } };
    expect(rebaseIncident(base, local, remote).intake).toEqual({ 'g-life-1': 'No injuries' });
  });

  it('merges id-keyed arrays element by element', () => {
    const local = {
      ...base,
      assignments: [{ id: 'a1', roleId: 'ic', name: 'Dana' }],
    };
    const remote = {
      ...base,
      assignments: [{ id: 'a2', roleId: 'safety', name: 'Lee' }],
      roles: base.roles.map((r) => (r.id === 'safety' ? { ...r, color: '#0f0' } : r)),
    };
    const out = rebaseIncident(base, local, remote);
    expect(out.assignments.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(out.roles.find((r) => r.id === 'safety')?.color).toBe('#0f0');
  });

  it('merges concurrent edits to different fields of the same element', () => {
    const local = { ...base, roles: base.roles.map((r) => (r.id === 'ic' ? { ...r, title: 'IC (Unified)' } : r)) };
    const remote = { ...base, roles: base.roles.map((r) => (r.id === 'ic' ? { ...r, color: '#abc' } : r)) };
    const ic = rebaseIncident(base, local, remote).roles.find((r) => r.id === 'ic');
    expect(ic).toEqual({ id: 'ic', title: 'IC (Unified)', color: '#abc', order: 0 });
  });

  it('lets a removal win over an unrelated edit of the removed element', () => {
    const local = { ...base, roles: base.roles.map((r) => (r.id === 'safety' ? { ...r, color: '#123' } : r)) };
    const remote = { ...base, roles: base.roles.filter((r) => r.id !== 'safety') };
    expect(rebaseIncident(base, local, remote).roles.map((r) => r.id)).toEqual(['ic']);
    // …and a local removal survives a peer's unrelated addition.
    const local2 = { ...base, roles: base.roles.filter((r) => r.id !== 'safety') };
    const remote2 = { ...base, roles: [...base.roles, { id: 'pio', title: 'PIO', color: '#f0f', order: 1 }] };
    expect(rebaseIncident(base, local2, remote2).roles.map((r) => r.id)).toEqual(['ic', 'pio']);
  });

  it('keeps local additions near their local neighbors', () => {
    const local = { ...base, roles: [{ id: 'new', title: 'New', color: '#000', order: 0 }, ...base.roles] };
    const remote = { ...base, roles: [...base.roles, { id: 'pio', title: 'PIO', color: '#f0f', order: 1 }] };
    expect(rebaseIncident(base, local, remote).roles.map((r) => r.id)).toEqual(['new', 'ic', 'safety', 'pio']);
  });

  it('merges primitive arrays as sets', () => {
    const local = { ...base, liveLayers: ['wildfires', 'smoke'] };
    const remote = { ...base, liveLayers: [] as string[] };
    // The peer turned wildfires off, this tab turned smoke on.
    expect(rebaseIncident(base, local, remote).liveLayers).toEqual(['smoke']);
  });

  it('keeps the local value on a true scalar conflict', () => {
    const local = { ...base, incidentName: 'Ridge Fire (North)' };
    const remote = { ...base, incidentName: 'Ridge Complex' };
    expect(rebaseIncident(base, local, remote).incidentName).toBe('Ridge Fire (North)');
  });

  it('takes excluded keys from the remote unmerged', () => {
    const local = { ...base, actionLog: [{ id: 'e2' }, { id: 'e1' }] };
    const remote = { ...base, actionLog: [{ id: 'e3' }, { id: 'e1' }] };
    expect(rebaseIncident(base, local, remote, ['actionLog', 'checklists']).actionLog)
      .toEqual([{ id: 'e3' }, { id: 'e1' }]);
  });

  it('returns the remote unchanged when this tab changed nothing', () => {
    const remote = { ...base, incidentStatus: 'closed', intake: {} };
    expect(rebaseIncident(base, { ...base }, remote)).toEqual(remote);
  });

  it('drops keys removed on one side and absent on the other', () => {
    const local = { ...base, executiveSummary: 'x' };
    const { liveLayers: _l, ...remote } = base;
    const out = rebaseIncident(base, local, remote as typeof base);
    expect('liveLayers' in out).toBe(false);
  });
});
