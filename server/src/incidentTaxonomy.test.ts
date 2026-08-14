import { describe, expect, it } from 'vitest';
import {
  INCIDENT_STATUS_IDS,
  INCIDENT_TYPE_IDS,
  invalidIncidentReason,
  invalidLogEntryReason,
} from './incidentTaxonomy';

const valid = { id: 'c-123', incidentType: 'wildfire', incidentStatus: 'active' };

describe('invalidIncidentReason', () => {
  it('accepts a canonical incident', () => {
    expect(invalidIncidentReason(valid)).toBeNull();
  });

  it('accepts retired ids that stored incidents and old clients still send', () => {
    expect(invalidIncidentReason({ ...valid, incidentType: 'chemical' })).toBeNull();
    expect(invalidIncidentReason({ ...valid, incidentType: 'security' })).toBeNull();
    expect(invalidIncidentReason({ ...valid, incidentStatus: 'contained' })).toBeNull();
    expect(invalidIncidentReason({ ...valid, incidentStatus: 'resolved' })).toBeNull();
  });

  it('accepts the new lifecycle statuses', () => {
    for (const status of ['monitoring', 'active', 'recovery', 'closed']) {
      expect(invalidIncidentReason({ ...valid, incidentStatus: status })).toBeNull();
    }
  });

  it('rejects non-object bodies', () => {
    expect(invalidIncidentReason(null)).toMatch(/incident object/);
    expect(invalidIncidentReason('x')).toMatch(/incident object/);
    expect(invalidIncidentReason([valid])).toMatch(/incident object/);
  });

  it('rejects a missing or empty id', () => {
    expect(invalidIncidentReason({ ...valid, id: undefined })).toMatch(/id is required/);
    expect(invalidIncidentReason({ ...valid, id: '' })).toMatch(/id is required/);
  });

  it('rejects unknown or missing type and status', () => {
    expect(invalidIncidentReason({ ...valid, incidentType: 'volcano' })).toMatch(/incidentType/);
    expect(invalidIncidentReason({ ...valid, incidentType: undefined })).toMatch(/incidentType/);
    expect(invalidIncidentReason({ ...valid, incidentStatus: 'escalated' })).toMatch(/incidentStatus/);
    expect(invalidIncidentReason({ ...valid, incidentStatus: 7 })).toMatch(/incidentStatus/);
  });

  it('exports non-empty id sets that include the legacy values', () => {
    expect(INCIDENT_TYPE_IDS.has('chemical')).toBe(true);
    expect(INCIDENT_STATUS_IDS.has('resolved')).toBe(true);
    expect(INCIDENT_TYPE_IDS.size).toBeGreaterThan(20);
  });
});

describe('invalidLogEntryReason', () => {
  const entry = {
    id: 'c-e1',
    timestamp: '2026-08-14T00:00:00.000Z',
    description: 'Evacuated lodge',
    entryType: 'action',
  };

  it('accepts a plain entry and a system entry', () => {
    expect(invalidLogEntryReason(entry)).toBeNull();
    expect(
      invalidLogEntryReason({ ...entry, actor: 'Alec', system: 'status-change', meta: { from: 'active', to: 'closed' } })
    ).toBeNull();
  });

  it('rejects malformed bodies', () => {
    expect(invalidLogEntryReason(null)).toMatch(/log-entry object/);
    expect(invalidLogEntryReason([entry])).toMatch(/log-entry object/);
    expect(invalidLogEntryReason({ ...entry, id: '' })).toMatch(/id/);
    expect(invalidLogEntryReason({ ...entry, timestamp: 'yesterday' })).toMatch(/timestamp/);
    expect(invalidLogEntryReason({ ...entry, description: 7 })).toMatch(/description/);
    expect(invalidLogEntryReason({ ...entry, entryType: 'note' })).toMatch(/entryType/);
    expect(invalidLogEntryReason({ ...entry, actor: 42 })).toMatch(/actor/);
  });
});
