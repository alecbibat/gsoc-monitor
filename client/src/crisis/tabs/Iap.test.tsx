import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  fmtIapSize, iapEmptyTitle, iapFallbackNote, iapMatchOf, iapMatchSummary, iapResolvePath,
  IapDocSummary, parseIapResolveResponse, type IapDocInfo,
} from './Iap';

const DOC: IapDocInfo = {
  id: 'doc-1',
  name: 'Wildfire IAP',
  incident_type: 'wildfire',
  location_group_id: null,
  size: 240 * 1024,
  updated_at: '2026-09-01T12:00:00.000Z',
};

describe('iapResolvePath', () => {
  it('names the type, and the property only when the incident has one', () => {
    expect(iapResolvePath('wildfire', null)).toBe('/api/iap/resolve?type=wildfire');
    expect(iapResolvePath('wildfire', undefined)).toBe('/api/iap/resolve?type=wildfire');
    expect(iapResolvePath('wildfire', 'grand-canyon')).toBe('/api/iap/resolve?type=wildfire&property=grand-canyon');
    expect(iapResolvePath('maritime', 'windstar-ships'))
      .toBe('/api/iap/resolve?type=maritime&property=windstar-ships');
  });

  it('drops a malformed property rather than letting the server reject the whole lookup', () => {
    expect(iapResolvePath('wildfire', 'Grand Canyon')).toBe('/api/iap/resolve?type=wildfire');
    expect(iapResolvePath('wildfire', '')).toBe('/api/iap/resolve?type=wildfire');
  });
});

describe('parseIapResolveResponse', () => {
  it('reads "nothing on file"', () => {
    expect(parseIapResolveResponse({ doc: null, match: null })).toEqual({ doc: null, match: null });
    expect(parseIapResolveResponse({})).toEqual({ doc: null, match: null });
  });

  it('keeps a known match and the document fields', () => {
    expect(parseIapResolveResponse({ doc: DOC, match: 'type' })).toEqual({ doc: DOC, match: 'type' });
  });

  it('derives a missing or unknown match from the document scope', () => {
    expect(parseIapResolveResponse({ doc: { ...DOC, location_group_id: 'glacier' } })?.match).toBe('type+property');
    expect(parseIapResolveResponse({ doc: { ...DOC, incident_type: null }, match: 'bogus' })?.match).toBe('general');
  });

  it('treats an absent location_group_id (older server) as "any property"', () => {
    const { location_group_id: _omit, ...legacy } = DOC;
    expect(parseIapResolveResponse({ doc: legacy, match: 'type' })?.doc?.location_group_id).toBeNull();
  });

  it('rejects malformed answers', () => {
    expect(parseIapResolveResponse(null)).toBeNull();
    expect(parseIapResolveResponse('nope')).toBeNull();
    expect(parseIapResolveResponse({ doc: 'x' })).toBeNull();
    expect(parseIapResolveResponse({ doc: { ...DOC, id: '' } })).toBeNull();
    expect(parseIapResolveResponse({ doc: { ...DOC, size: '12' } })).toBeNull();
    expect(parseIapResolveResponse({ doc: { ...DOC, incident_type: 7 } })).toBeNull();
  });
});

describe('match wording', () => {
  it('ranks a document by its own scope', () => {
    expect(iapMatchOf({ incident_type: 'wildfire', location_group_id: 'glacier' })).toBe('type+property');
    expect(iapMatchOf({ incident_type: 'wildfire', location_group_id: null })).toBe('type');
    expect(iapMatchOf({ incident_type: null, location_group_id: 'glacier' })).toBe('property');
    expect(iapMatchOf({ incident_type: null, location_group_id: null })).toBe('general');
  });

  it('names the matched scope', () => {
    expect(iapMatchSummary('type', DOC)).toMatch(/^Type-specific plan · .*Wildfire$/);
    expect(iapMatchSummary('type+property', { incident_type: 'wildfire', location_group_id: 'grand-canyon' }))
      .toMatch(/^Type \+ property plan · .*Wildfire · .*Grand Canyon$/);
    expect(iapMatchSummary('property', { incident_type: null, location_group_id: 'grand-canyon' }))
      .toMatch(/^Property plan · .*Grand Canyon$/);
    expect(iapMatchSummary('general', { incident_type: null, location_group_id: null })).toBe('General default');
  });

  it('explains a fallback only when no plan exists for the incident type', () => {
    expect(iapFallbackNote('type+property', 'wildfire', 'glacier')).toBeNull();
    expect(iapFallbackNote('type', 'wildfire', 'glacier')).toBeNull();
    expect(iapFallbackNote('property', 'wildfire', 'glacier')).toMatch(/No .*Wildfire plan .*property's plan applies/);
    expect(iapFallbackNote('general', 'wildfire', 'glacier')).toMatch(/Wildfire or .*Glacier.*general default/);
    expect(iapFallbackNote('general', 'wildfire', null)).toMatch(/No .*Wildfire plan .*general default/);
  });

  it('says what is missing when nothing applies', () => {
    expect(iapEmptyTitle('wildfire', 'grand-canyon')).toMatch(/^No Incident Action Plan uploaded for .*Wildfire \/ .*Grand Canyon$/);
    expect(iapEmptyTitle('wildfire', null)).toMatch(/^No Incident Action Plan uploaded for .*Wildfire incidents$/);
  });
});

describe('fmtIapSize', () => {
  it('formats KB / MB and hides nonsense', () => {
    expect(fmtIapSize(200)).toBe('1 KB');
    expect(fmtIapSize(240 * 1024)).toBe('240 KB');
    expect(fmtIapSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(fmtIapSize(0)).toBe('');
    expect(fmtIapSize(Number.NaN)).toBe('');
  });
});

describe('IapDocSummary', () => {
  it('shows the name, the matched scope, the size and a new-tab link to the file', () => {
    const html = renderToStaticMarkup(
      <IapDocSummary doc={{ ...DOC, id: 'a b' }} match="type" fallbackNote={null} />
    );
    expect(html).toContain('Wildfire IAP');
    expect(html).toContain('Type-specific plan');
    expect(html).toContain('240 KB');
    expect(html).toContain('href="/api/iap/a%20b/file"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('adds the fallback note when a less specific plan applies', () => {
    const html = renderToStaticMarkup(
      <IapDocSummary doc={{ ...DOC, incident_type: null }} match="general" fallbackNote="No plan here." />
    );
    expect(html).toContain('General default');
    expect(html).toContain('No plan here.');
  });
});
