import { beforeEach, describe, expect, it } from 'vitest';
import { useCrisisStore, type Incident } from './crisisStore';
import { activeRoleOf, commandSeatsVacated, poolMemberNamed, staffedBelow } from './IcsOrgChart';

// Pure staffing helpers behind the org chart's pool picker, move confirm and
// collapsed-branch labels. The store rules themselves are covered by
// crisisStore.roles.test.ts.

beforeEach(() => {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
});

const active = (): Incident => {
  const s = useCrisisStore.getState();
  return s.incidents.find((i) => i.id === s.activeIncidentId)!;
};
const st = () => useCrisisStore.getState();

describe('poolMemberNamed', () => {
  const pool = [
    { id: 'p-1', name: 'Sarah Chen' },
    { id: 'p-2', name: 'Alex Kim' },
    { id: 'p-3', name: 'alex kim ' },
  ];

  it('matches a typed name case-insensitively', () => {
    expect(poolMemberNamed(pool, '  sarah CHEN ')?.id).toBe('p-1');
  });

  it('refuses to guess between namesakes, and ignores blanks', () => {
    expect(poolMemberNamed(pool, 'Alex Kim')).toBeUndefined();
    expect(poolMemberNamed(pool, '   ')).toBeUndefined();
    expect(poolMemberNamed(pool, 'Nobody')).toBeUndefined();
  });
});

describe('activeRoleOf', () => {
  it('finds the seat a person holds now, by pool id or name', () => {
    st().createIncident();
    st().assignRole('pio', 'Sarah Chen', undefined, 'p-1');
    st().assignRole('safety', 'Bob Diaz');
    expect(activeRoleOf(active(), 'Sarah Chen', 'p-1')?.id).toBe('pio');
    expect(activeRoleOf(active(), 'Sarah Chen', 'p-9')).toBeUndefined(); // a namesake
    expect(activeRoleOf(active(), 'bob diaz', 'p-2')?.id).toBe('safety'); // typed entry, name fallback
    expect(activeRoleOf(active(), 'Cara Ng')).toBeUndefined();
  });
});

describe('commandSeatsVacated', () => {
  it('names the command seat a move would leave empty', () => {
    st().createIncident();
    st().assignRole('ic', 'Sarah Chen', undefined, 'p-1');
    expect(commandSeatsVacated(active(), 'ops', 'Sarah Chen', 'p-1').map((r) => r.id)).toEqual(['ic']);
  });

  it('stays quiet for ordinary moves, re-seating, and other people', () => {
    st().createIncident();
    st().assignRole('ic', 'Sarah Chen');
    st().assignRole('safety', 'Bob Diaz');
    expect(commandSeatsVacated(active(), 'ops', 'Bob Diaz')).toEqual([]);   // not a command seat
    expect(commandSeatsVacated(active(), 'ic', 'Sarah Chen')).toEqual([]);  // already there
    expect(commandSeatsVacated(active(), 'ops', 'Cara Ng')).toEqual([]);    // not seated anywhere
  });
});

describe('staffedBelow', () => {
  it('counts people beneath a role, not on it', () => {
    st().createIncident();
    st().assignRole('pio', 'Sarah Chen');
    st().assignRole('gsoc-support', 'Ana Ruiz');
    st().assignRole('gsoc-support', 'Eli Moss');
    expect(staffedBelow(active(), 'pio')).toBe(2);
    expect(staffedBelow(active(), 'gsoc-support')).toBe(0);
    expect(staffedBelow(active(), 'ic')).toBe(3);
    expect(staffedBelow(null, 'ic')).toBe(0);
  });
});
