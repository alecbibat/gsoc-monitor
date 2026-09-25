import { describe, expect, it } from 'vitest';
import type { DrawLayer, Incident, PersonnelAssignment } from './crisisStore';
import {
  aarProgress, deleteConfirmPhrase, fmtAgo, incidentExtent, incidentPropertyLabel, lastActivityAt,
  localDateKey, matchesDeletePhrase, staffedCount,
} from './incidentSummary';
import { dismissTopEscapeLayer, pushEscapeLayer } from './escapeLayers';
import { LOCATION_GROUPS } from '../layers/locations/locations';
import { SHIP_GROUP_ID } from './incidentShips';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const assignment = (over: Partial<PersonnelAssignment>): PersonnelAssignment => ({
  id: Math.random().toString(36).slice(2),
  roleId: 'ic',
  name: 'Alex Rivera',
  startedAt: iso(NOW - 3_600_000),
  ...over,
} as PersonnelAssignment);

const layer = (over: Partial<DrawLayer>): DrawLayer => ({
  id: Math.random().toString(36).slice(2),
  name: 'L',
  type: 'other',
  geometry: 'polygon',
  color: '#fff',
  visible: true,
  positions: [],
  createdAt: iso(NOW),
  ...over,
} as DrawLayer);

describe('staffedCount', () => {
  it('counts everyone who held a role, including released seats (stand-down ends them all)', () => {
    const n = staffedCount({
      assignments: [
        assignment({ name: 'Alex Rivera', endedAt: iso(NOW) }),
        assignment({ name: 'alex rivera ', roleId: 'ops', endedAt: iso(NOW) }), // same person, second role
        assignment({ name: 'Sam Lee', personnelId: 'p1', endedAt: iso(NOW) }),
        assignment({ name: 'Sam Lee', personnelId: 'p2', endedAt: iso(NOW) }), // a namesake from the pool
        assignment({ name: '   ' }),
      ],
    });
    expect(n).toBe(3);
  });
});

describe('incidentPropertyLabel', () => {
  it('names fixed properties and the fleet, and nothing for unset or unknown ids', () => {
    const g = LOCATION_GROUPS[0];
    expect(incidentPropertyLabel(g.id)).toBe(`${g.icon} ${g.name}`);
    expect(incidentPropertyLabel(SHIP_GROUP_ID)).toContain('Windstar Ships');
    expect(incidentPropertyLabel(null)).toBeNull();
    expect(incidentPropertyLabel('no-such-property')).toBeNull();
  });
});

describe('lastActivityAt / fmtAgo', () => {
  const base = { createdAt: iso(NOW - 86_400_000), actionLog: [], checklists: {} } as unknown as Incident;

  it('takes the latest log entry or checklist toggle, whatever order the log is in', () => {
    const inc = {
      ...base,
      actionLog: [
        { id: 'a', timestamp: iso(NOW - 3_600_000), description: '', entryType: 'action' },
        { id: 'b', timestamp: iso(NOW - 600_000), description: '', entryType: 'event' }, // backdated order
      ],
      checklists: { 'g-1': { checked: true, at: iso(NOW - 120_000) } },
    } as unknown as Incident;
    expect(lastActivityAt(inc, NOW)).toBe(NOW - 120_000);
  });

  it('ignores mistyped future times and falls back to creation', () => {
    const inc = {
      ...base,
      actionLog: [{ id: 'a', timestamp: iso(NOW + 86_400_000), description: '', entryType: 'action' }],
    } as unknown as Incident;
    expect(lastActivityAt(inc, NOW)).toBe(NOW - 86_400_000);
  });

  it('formats elapsed time coarsely', () => {
    expect(fmtAgo(NOW - 20_000, NOW)).toBe('just now');
    expect(fmtAgo(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(fmtAgo(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
    expect(fmtAgo(NOW - 3 * 86_400_000, NOW)).toBe('3d ago');
  });
});

describe('aarProgress', () => {
  it('counts answered questions and open / overdue corrective actions', () => {
    const p = aarProgress({
      expected: 'Evacuate by 14:00',
      happened: '  ',
      wentWell: 'Comms',
      correctiveActions: [
        { id: '1', text: 'Buy radios', due: '2026-09-20' },          // overdue
        { id: '2', text: 'Update roster', due: '2026-09-25' },       // due today: not overdue
        { id: '3', text: 'Drill', due: '2026-09-01', done: true },   // done
        { id: '4', text: '   ', due: '2026-09-01' },                 // empty row
        { id: '5', text: 'Review plan' },                            // no due date
      ],
    }, '2026-09-25');
    expect(p).toEqual({ answered: 2, openActions: 3, overdue: 1 });
    expect(aarProgress(undefined, '2026-09-25')).toEqual({ answered: 0, openActions: 0, overdue: 0 });
  });

  it('keys dates in local time, as <input type="date"> stores them', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('incidentExtent', () => {
  it('spans visible drawn layers only', () => {
    const e = incidentExtent({
      drawLayers: [
        layer({ positions: [{ lon: -110, lat: 40 }, { lon: -109, lat: 41 }] }),
        layer({ visible: false, positions: [{ lon: 10, lat: 10 }] }),
      ],
      locationGroupId: null,
    });
    expect(e).toEqual({ west: -110, south: 40, east: -109, north: 41 });
  });

  it("frames the property's locations before anything is drawn, and skips the fleet", () => {
    const g = LOCATION_GROUPS.find((x) => x.locations.length > 1)!;
    const e = incidentExtent({ drawLayers: [], locationGroupId: g.id, extraLocationGroups: [SHIP_GROUP_ID] })!;
    expect(e.west).toBe(Math.min(...g.locations.map((l) => l.lon)));
    expect(e.north).toBe(Math.max(...g.locations.map((l) => l.lat)));
    expect(incidentExtent({ drawLayers: [], locationGroupId: SHIP_GROUP_ID })).toBeNull();
    expect(incidentExtent({ drawLayers: [layer({})], locationGroupId: null })).toBeNull();
  });
});

describe('delete confirmation phrase', () => {
  it('asks for the name, or DELETE when there is none', () => {
    expect(deleteConfirmPhrase({ incidentName: '  Grand Canyon Fire ' })).toBe('Grand Canyon Fire');
    expect(deleteConfirmPhrase({ incidentName: '' })).toBe('DELETE');
  });

  it('matches regardless of case and spacing, but never on an empty entry', () => {
    expect(matchesDeletePhrase('grand  canyon fire ', 'Grand Canyon Fire')).toBe(true);
    expect(matchesDeletePhrase('delete', 'DELETE')).toBe(true);
    expect(matchesDeletePhrase('Grand Canyon', 'Grand Canyon Fire')).toBe(false);
    expect(matchesDeletePhrase('  ', '   ')).toBe(false);
  });
});

describe('escape layers', () => {
  it('hands Esc to the most recently opened layer, and reports when none is open', () => {
    const calls: string[] = [];
    const removeA = pushEscapeLayer(() => calls.push('a'));
    const removeB = pushEscapeLayer(() => calls.push('b'));
    expect(dismissTopEscapeLayer()).toBe(true);
    removeB(); // its owner closed
    expect(dismissTopEscapeLayer()).toBe(true);
    removeA();
    expect(dismissTopEscapeLayer()).toBe(false);
    expect(calls).toEqual(['b', 'a']);
  });
});
