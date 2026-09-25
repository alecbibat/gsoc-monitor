import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCrisisStore, type Incident } from './crisisStore';

// standDownIncident's End-time stamping: the AAR's Duration runs start → End,
// and an archived record is frozen, so stand-down must leave End filled in.
beforeEach(() => {
  useCrisisStore.setState({ incidents: [], activeIncidentId: null });
});
afterEach(() => { vi.useRealTimers(); });

const st = () => useCrisisStore.getState();
const inc = (id: string): Incident => st().incidents.find((i) => i.id === id)!;
const lastStoodDown = (id: string) => inc(id).actionLog.find((e) => e.system === 'stood-down')!;

describe('standDownIncident — End time', () => {
  it('stamps End with the stand-down time when it was left blank', () => {
    const id = st().createIncident('wildfire');
    expect(inc(id).incidentEndDatetime).toBe('');
    st().standDownIncident(id, 'Contained');
    const after = inc(id);
    expect(after.incidentEndDatetime).toBe(after.archivedAt);
    expect(lastStoodDown(id).meta).toMatchObject({ endedAt: after.archivedAt, endAuto: 'true' });
  });

  it('keeps an End the operator entered', () => {
    const id = st().createIncident('wildfire');
    st().update({ incidentEndDatetime: '2026-09-25T14:00:00.000Z' });
    st().standDownIncident(id);
    expect(inc(id).incidentEndDatetime).toBe('2026-09-25T14:00:00.000Z');
    expect(lastStoodDown(id).meta?.endedAt).toBe('2026-09-25T14:00:00.000Z');
    expect(lastStoodDown(id).meta?.endAuto).toBeUndefined();
  });

  it('takes an explicit end time over the End field, and ignores an unparsable one', () => {
    const a = st().createIncident('wildfire');
    st().update({ incidentEndDatetime: '2026-09-25T14:00:00.000Z' });
    st().standDownIncident(a, undefined, '2026-09-25T15:30:00.000Z');
    expect(inc(a).incidentEndDatetime).toBe('2026-09-25T15:30:00.000Z');

    const b = st().createIncident('wildfire');
    st().standDownIncident(b, undefined, 'not a date');
    expect(inc(b).incidentEndDatetime).toBe(inc(b).archivedAt);
  });

  it('stamps an automatic End at the instant given for it, still as automatic', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T14:11:15.000Z'));
    const a = st().createIncident('wildfire');
    // The dialog showed 14:05 when it opened; the sequence finished at 14:11.
    st().standDownIncident(a, 'Contained', undefined, '2026-09-25T14:05:00.000Z');
    expect(inc(a).incidentEndDatetime).toBe('2026-09-25T14:05:00.000Z');
    expect(inc(a).archivedAt).toBe('2026-09-25T14:11:15.000Z');
    expect(lastStoodDown(a).meta).toMatchObject({ endedAt: '2026-09-25T14:05:00.000Z', endAuto: 'true' });

    // Only used when End is automatic: an entered End wins, and so does an explicit one.
    const b = st().createIncident('wildfire');
    st().update({ incidentEndDatetime: '2026-09-25T13:00:00.000Z' });
    st().standDownIncident(b, undefined, undefined, '2026-09-25T14:05:00.000Z');
    expect(inc(b).incidentEndDatetime).toBe('2026-09-25T13:00:00.000Z');
    const c = st().createIncident('wildfire');
    st().standDownIncident(c, undefined, '2026-09-25T12:00:00.000Z', '2026-09-25T14:05:00.000Z');
    expect(inc(c).incidentEndDatetime).toBe('2026-09-25T12:00:00.000Z');
    expect(lastStoodDown(c).meta?.endAuto).toBeUndefined();

    // Unparsable: falls back to the stand-down time.
    const d = st().createIncident('wildfire');
    st().standDownIncident(d, undefined, undefined, 'garbage');
    expect(inc(d).incidentEndDatetime).toBe('2026-09-25T14:11:15.000Z');
  });

  it('re-stamps an End a previous stand-down stamped, after a reopen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
    const id = st().createIncident('wildfire');
    st().standDownIncident(id);                          // stood down by mistake
    expect(inc(id).incidentEndDatetime).toBe('2026-09-25T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
    st().reopenIncident(id);
    vi.setSystemTime(new Date('2026-09-25T18:00:00.000Z'));
    st().standDownIncident(id);                          // the real close
    expect(inc(id).incidentEndDatetime).toBe('2026-09-25T18:00:00.000Z');
    expect(lastStoodDown(id).meta?.endAuto).toBe('true');
  });

  it('reopen clears the End a stand-down stamped, but not one the operator entered', () => {
    const a = st().createIncident('wildfire');
    st().standDownIncident(a);
    expect(inc(a).incidentEndDatetime).toBeTruthy();
    st().reopenIncident(a);
    expect(inc(a).incidentEndDatetime).toBe('');
    expect(inc(a).incidentStatus).toBe('monitoring');

    const b = st().createIncident('wildfire');
    st().update({ incidentEndDatetime: '2026-09-25T14:00:00.000Z' });
    st().standDownIncident(b);
    st().reopenIncident(b);
    expect(inc(b).incidentEndDatetime).toBe('2026-09-25T14:00:00.000Z');

    const c = st().createIncident('wildfire');
    st().standDownIncident(c, undefined, '2026-09-25T15:30:00.000Z');
    st().reopenIncident(c);
    expect(inc(c).incidentEndDatetime).toBe('2026-09-25T15:30:00.000Z');
  });

  it('keeps an End the operator re-entered after a reopen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T10:00:00.000Z'));
    const id = st().createIncident('wildfire');
    st().standDownIncident(id);
    vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
    st().reopenIncident(id);
    st().update({ incidentEndDatetime: '2026-09-25T16:00:00.000Z' });
    vi.setSystemTime(new Date('2026-09-25T18:00:00.000Z'));
    st().standDownIncident(id);
    expect(inc(id).incidentEndDatetime).toBe('2026-09-25T16:00:00.000Z');
  });
});
