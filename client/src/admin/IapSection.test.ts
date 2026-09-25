import { describe, expect, it } from 'vitest';
import {
  compareIapScopes, findIapDocForScope, groupIapDocs, iapAudience, iapDocScope, iapFileProblem,
  iapMatchForScope, iapNameFromFile, iapResolveUrl, iapScopeLabel, isIapDoc, knownIapScope,
  MAX_IAP_BYTES, parseIapResolve, type IapDoc,
} from './IapSection';

const doc = (id: string, incident_type: string | null, location_group_id: string | null | undefined, name = id): IapDoc => ({
  id, name, incident_type, location_group_id, size: 2048, updated_at: '2026-09-01T12:00:00Z',
});

describe('iapDocScope', () => {
  it('treats a missing property column (older server) as "any property"', () => {
    expect(iapDocScope({ incident_type: 'wildfire' })).toEqual({ incidentType: 'wildfire', propertyId: null });
    expect(iapDocScope({ incident_type: null, location_group_id: 'grand-canyon' }))
      .toEqual({ incidentType: null, propertyId: 'grand-canyon' });
  });
});

describe('isIapDoc', () => {
  it('accepts server rows with and without location_group_id', () => {
    expect(isIapDoc(doc('a', null, null))).toBe(true);
    expect(isIapDoc(doc('a', 'wildfire', undefined))).toBe(true);
  });
  it('rejects malformed rows', () => {
    expect(isIapDoc(null)).toBe(false);
    expect(isIapDoc({ ...doc('a', null, null), size: '12' })).toBe(false);
    expect(isIapDoc({ ...doc('a', null, null), location_group_id: 3 })).toBe(false);
    expect(isIapDoc({ error: 'Not authenticated' })).toBe(false);
  });
});

describe('groupIapDocs', () => {
  it('orders General → type → property → type+property, types in taxonomy order', () => {
    const docs = [
      doc('tp', 'wildfire', 'grand-canyon'),
      doc('p2', null, 'windstar-ships'),
      doc('p1', null, 'glacier'),
      doc('t-unknown', 'zz-retired', null),
      doc('t-fire', 'wildfire', null),
      doc('g', null, null),
    ];
    const groups = groupIapDocs(docs);
    expect(groups.map((g) => g.rank)).toEqual([0, 1, 2, 3]);
    expect(groups[0].docs.map((d) => d.id)).toEqual(['g']);
    // Unknown (retired) type ids sort after every known type.
    expect(groups[1].docs.map((d) => d.id)).toEqual(['t-fire', 't-unknown']);
    // Properties in TEMPLATE_PROPERTIES order: location groups, then the fleet.
    expect(groups[2].docs.map((d) => d.id)).toEqual(['p1', 'p2']);
    expect(groups[3].docs.map((d) => d.id)).toEqual(['tp']);
  });

  it('always shows the General group (its absence matters), and drops other empty groups', () => {
    const groups = groupIapDocs([doc('t', 'wildfire', null)]);
    expect(groups.map((g) => [g.rank, g.docs.length])).toEqual([[0, 0], [1, 1]]);
    expect(groupIapDocs([]).map((g) => g.rank)).toEqual([0]);
  });
});

describe('compareIapScopes', () => {
  it('ranks by resolution order first', () => {
    const general = { incidentType: null, propertyId: null };
    const type = { incidentType: 'wildfire', propertyId: null };
    const prop = { incidentType: null, propertyId: 'glacier' };
    const both = { incidentType: 'wildfire', propertyId: 'glacier' };
    expect([both, prop, general, type].sort(compareIapScopes)).toEqual([general, type, prop, both]);
  });
});

describe('findIapDocForScope', () => {
  it('finds only the exact scope', () => {
    const docs = [doc('g', null, null), doc('t', 'wildfire', null), doc('tp', 'wildfire', 'glacier')];
    expect(findIapDocForScope(docs, { incidentType: 'wildfire', propertyId: null })?.id).toBe('t');
    expect(findIapDocForScope(docs, { incidentType: 'wildfire', propertyId: 'glacier' })?.id).toBe('tp');
    expect(findIapDocForScope(docs, { incidentType: null, propertyId: 'glacier' })).toBeUndefined();
  });
});

describe('knownIapScope', () => {
  it('defaults to General and drops ids the pickers cannot show', () => {
    expect(knownIapScope(null)).toEqual({ incidentType: null, propertyId: null });
    expect(knownIapScope({ incidentType: 'wildfire', propertyId: 'grand-canyon' }))
      .toEqual({ incidentType: 'wildfire', propertyId: 'grand-canyon' });
    expect(knownIapScope({ incidentType: 'not-a-type', propertyId: 'nowhere' }))
      .toEqual({ incidentType: null, propertyId: null });
  });
});

describe('iapResolveUrl', () => {
  it('omits the parts that are none', () => {
    expect(iapResolveUrl({ incidentType: null, propertyId: null })).toBe('/api/iap/resolve');
    expect(iapResolveUrl({ incidentType: 'wildfire', propertyId: null })).toBe('/api/iap/resolve?type=wildfire');
    expect(iapResolveUrl({ incidentType: 'wildfire', propertyId: 'grand-canyon' }))
      .toBe('/api/iap/resolve?type=wildfire&property=grand-canyon');
    expect(iapResolveUrl({ incidentType: null, propertyId: 'windstar-ships' }))
      .toBe('/api/iap/resolve?property=windstar-ships');
  });
});

describe('parseIapResolve', () => {
  it('passes a well-formed answer through', () => {
    const d = doc('t', 'wildfire', null);
    expect(parseIapResolve({ doc: d, match: 'type' })).toEqual({ doc: d, match: 'type' });
    expect(parseIapResolve({ doc: null, match: null })).toEqual({ doc: null, match: null });
  });
  it('derives a missing or unknown match from the document scope', () => {
    expect(parseIapResolve({ doc: doc('tp', 'wildfire', 'glacier') })?.match).toBe('type+property');
    expect(parseIapResolve({ doc: doc('p', null, 'glacier'), match: 'bogus' })?.match).toBe('property');
    expect(parseIapResolve({ doc: doc('g', null, null), match: 'toString' })?.match).toBe('general');
  });
  it('rejects garbage', () => {
    expect(parseIapResolve(null)).toBeNull();
    expect(parseIapResolve('nope')).toBeNull();
    expect(parseIapResolve({ doc: { id: 1 } })).toBeNull();
  });
});

describe('iapMatchForScope', () => {
  it('maps each scope kind', () => {
    expect(iapMatchForScope({ incidentType: null, propertyId: null })).toBe('general');
    expect(iapMatchForScope({ incidentType: 'wildfire', propertyId: null })).toBe('type');
    expect(iapMatchForScope({ incidentType: null, propertyId: 'glacier' })).toBe('property');
    expect(iapMatchForScope({ incidentType: 'wildfire', propertyId: 'glacier' })).toBe('type+property');
  });
});

describe('iapFileProblem', () => {
  it('accepts a PDF by extension or MIME type', () => {
    expect(iapFileProblem({ name: 'plan.PDF', type: '', size: 1000 })).toBeNull();
    expect(iapFileProblem({ name: 'plan', type: 'application/pdf', size: 1000 })).toBeNull();
  });
  it('rejects other files, empty files and files over the cap', () => {
    expect(iapFileProblem({ name: 'plan.docx', type: 'application/msword', size: 1000 })).toMatch(/PDF/);
    expect(iapFileProblem({ name: 'plan.pdf', type: 'application/pdf', size: 0 })).toMatch(/empty/);
    expect(iapFileProblem({ name: 'plan.pdf', type: 'application/pdf', size: MAX_IAP_BYTES })).toBeNull();
    expect(iapFileProblem({ name: 'plan.pdf', type: 'application/pdf', size: MAX_IAP_BYTES + 1 })).toMatch(/15 MB/);
  });
});

describe('iapNameFromFile', () => {
  it('strips the extension and caps the length like the server', () => {
    expect(iapNameFromFile('Wildfire IAP v3.pdf')).toBe('Wildfire IAP v3');
    expect(iapNameFromFile(`${'x'.repeat(200)}.pdf`)).toHaveLength(120);
  });
});

describe('labels', () => {
  it('names the unscoped row as the general default', () => {
    expect(iapScopeLabel({ incidentType: null, propertyId: null })).toBe('General default (all incidents)');
    expect(iapScopeLabel({ incidentType: 'wildfire', propertyId: null })).toMatch(/Wildfire/);
  });
  it('explains who each scope serves', () => {
    expect(iapAudience({ incidentType: null, propertyId: null })).toMatch(/no more specific plan/);
    expect(iapAudience({ incidentType: 'wildfire', propertyId: 'glacier' })).toMatch(/^Serves only Wildfire incidents at Glacier/);
  });
});
