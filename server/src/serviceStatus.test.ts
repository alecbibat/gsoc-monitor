import { describe, expect, it } from 'vitest';
import {
  checkAllServices,
  parseAwsEvents,
  parseAzureRss,
  parseGoogleIncidents,
  parseMicrosoft365,
  parseSalesforce,
  parseSlack,
  parseStatuspageIncidents,
  parseStatuspageStatus,
} from './serviceStatus';

// Bodies trimmed from the live status pages (2026-11).

describe('Statuspage', () => {
  it('maps the page indicator, treating maintenance as up', () => {
    const page = (indicator: string) => ({ page: { name: 'Zoom' }, status: { indicator, description: 'x' } });
    expect(parseStatuspageStatus(page('none')).level).toBe('ok');
    expect(parseStatuspageStatus(page('minor')).level).toBe('minor');
    expect(parseStatuspageStatus(page('major')).level).toBe('major');
    expect(parseStatuspageStatus(page('critical')).level).toBe('major');
    expect(parseStatuspageStatus(page('maintenance')).level).toBe('ok');
  });

  it('rejects a body that is not a status page (an HTML login redirect parsed as JSON)', () => {
    expect(() => parseStatuspageStatus({})).toThrow();
  });

  it('reads unresolved incidents', () => {
    const incidents = parseStatuspageIncidents({
      incidents: [
        {
          name: 'Elevated error rate for workers startup',
          impact: 'minor',
          shortlink: 'https://www.cloudflarestatus.com/incidents/y03on2svrrxt',
          started_at: '2026-11-13T13:54:01.333Z',
        },
        { name: 'Total outage', impact: 'critical', created_at: '2026-11-13T10:00:00Z' },
      ],
    });
    expect(incidents).toEqual([
      {
        title: 'Elevated error rate for workers startup',
        level: 'minor',
        url: 'https://www.cloudflarestatus.com/incidents/y03on2svrrxt',
        since: '2026-11-13T13:54:01.333Z',
      },
      { title: 'Total outage', level: 'major', url: undefined, since: '2026-11-13T10:00:00Z' },
    ]);
  });
});

describe('Microsoft 365', () => {
  const consumer = [
    { ServiceDisplayName: 'OneDrive', Title: '', Status: 'Operational' },
    { ServiceDisplayName: 'Outlook.com', Title: 'Users cannot send mail', Status: 'Service interruption' },
  ];

  it('combines the public business post with degraded consumer services, worst first', () => {
    const check = parseMicrosoft365(
      {
        Title: 'Users may be unable to connect to multiple Microsoft 365 services',
        Status: 'Service degradation',
        AuthoredDateTime: '2026-11-13T14:56:52+00:00',
      },
      consumer
    );
    expect(check.level).toBe('major');
    expect(check.incidents.map((i) => i.level)).toEqual(['major', 'minor']);
    expect(check.incidents[0].title).toBe('Outlook.com: Users cannot send mail');
    expect(check.summary).toMatch(/\(\+1 more\)$/);
  });

  it('is operational with an empty post and all services up', () => {
    expect(parseMicrosoft365({ Title: '', Status: '' }, [consumer[0]])).toEqual({
      level: 'ok',
      summary: 'Operational',
      incidents: [],
    });
    expect(parseMicrosoft365(null, null).level).toBe('ok');
  });
});

describe('Azure RSS', () => {
  const feed = (items: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>Azure Status</title>${items}</channel></rss>`;

  it('is operational when the feed has no items', () => {
    expect(parseAzureRss(feed('')).level).toBe('ok');
  });

  it('lists each item as an active incident', () => {
    const check = parseAzureRss(
      feed(
        '<item><title>Azure Front Door &amp; CDN - connectivity issues</title><link>https://azure.status.microsoft/x</link><pubDate>Fri, 13 Nov 2026 15:12:00 Z</pubDate></item>'
      )
    );
    expect(check.level).toBe('minor');
    expect(check.incidents[0]).toEqual({
      title: 'Azure Front Door & CDN - connectivity issues',
      level: 'minor',
      url: 'https://azure.status.microsoft/x',
      since: '2026-11-13T15:12:00.000Z',
    });
  });

  it('rejects a body that is not RSS', () => {
    expect(() => parseAzureRss('<html>blocked</html>')).toThrow();
  });
});

describe('AWS', () => {
  const event = (region: string, status: string, extra: object = {}) => ({
    date: '1772369485',
    arn: `arn:aws:health:${region}::event/EC2/AWS_EC2_OPERATIONAL_ISSUE/X`,
    region_name: region === 'us-east-1' ? 'N. Virginia' : 'UAE',
    status,
    service_name: 'Multiple services',
    summary: 'Region Availability',
    ...extra,
  });

  it('lists an event outside the US without raising the level', () => {
    const check = parseAwsEvents([event('me-central-1', '3')]);
    expect(check.level).toBe('ok');
    expect(check.summary).toBe('US regions operational · 1 event elsewhere');
    expect(check.incidents[0].title).toBe('Multiple services: Region Availability (UAE)');
  });

  it('raises the level for US and global events, and skips ended ones', () => {
    expect(parseAwsEvents([event('me-central-1', '3'), event('us-east-1', '2')]).level).toBe('minor');
    expect(parseAwsEvents([event('us-east-1', '3')]).level).toBe('major');
    expect(parseAwsEvents([event('global', '3')]).level).toBe('major');
    expect(parseAwsEvents([event('us-east-1', '3', { end_time: '1772370000' })]).level).toBe('ok');
    expect(parseAwsEvents([])).toEqual({ level: 'ok', summary: 'Operational', incidents: [] });
  });
});

describe('Google incidents', () => {
  const base = 'https://status.cloud.google.com';
  const incident = (extra: object) => ({
    begin: '2026-10-20T06:00:00+00:00',
    external_desc: '**Summary:**\nMultiple services were experiencing issues.\n**Description:**\nMore.',
    status_impact: 'SERVICE_DISRUPTION',
    service_name: 'Multiple Products',
    uri: 'incidents/Xs2X',
    ...extra,
  });

  it('ignores incidents that have ended', () => {
    expect(parseGoogleIncidents([incident({ end: '2026-10-20T12:08:00+00:00' })], base).level).toBe('ok');
  });

  it('reports open incidents by impact, with the summary line as the title', () => {
    const check = parseGoogleIncidents([incident({}), incident({ status_impact: 'SERVICE_OUTAGE' })], base);
    expect(check.level).toBe('major');
    expect(check.incidents[0].title).toBe('Multiple Products: Multiple services were experiencing issues.');
    expect(check.incidents[0].url).toBe('https://status.cloud.google.com/incidents/Xs2X');
    expect(parseGoogleIncidents([incident({ status_impact: 'SERVICE_INFORMATION' })], base).level).toBe('ok');
  });
});

describe('Slack and Salesforce', () => {
  it('Slack: no active incidents is operational; an outage is major', () => {
    expect(parseSlack({ status: 'ok', active_incidents: [] }).level).toBe('ok');
    expect(parseSlack({ active_incidents: [{ title: 'Cannot connect', type: 'outage' }] }).level).toBe('major');
    expect(parseSlack({ active_incidents: [{ title: 'Slow search', type: 'incident' }] }).level).toBe('minor');
    expect(() => parseSlack({})).toThrow();
  });

  it('Salesforce: only a core or all-instance disruption is major', () => {
    const inc = (extra: object) => ({
      id: 20004579,
      type: 'Degradation',
      isCore: false,
      affectsAll: false,
      instanceKeys: ['AUS4S', 'USA352'],
      serviceKeys: ['MCGrowth'],
      ...extra,
    });
    const minor = parseSalesforce([inc({})]);
    expect(minor.level).toBe('minor');
    expect(minor.incidents[0].title).toBe('Degradation: MCGrowth (2 instances)');
    expect(parseSalesforce([inc({ type: 'Service Disruption' })]).level).toBe('minor');
    expect(parseSalesforce([inc({ type: 'Service Disruption', isCore: true })]).level).toBe('major');
    expect(parseSalesforce([]).level).toBe('ok');
  });
});

describe('checkAllServices', () => {
  const ok = { level: 'ok' as const, summary: 'Operational', incidents: [] };

  it('reports a failing page as unknown without failing the others', async () => {
    const out = await checkAllServices([
      { id: 't-a', name: 'A', url: 'https://a.example', check: async () => ok },
      { id: 't-b', name: 'B', url: 'https://b.example', check: async () => { throw new Error('timeout'); } },
    ]);
    expect(out.map((s) => s.level)).toEqual(['ok', 'unknown']);
    expect(out[1].summary).toBe('Status page unreachable');
  });

  it('keeps the last good answer through a failed refresh', async () => {
    let fail = false;
    const provider = {
      id: 't-c',
      name: 'C',
      url: 'https://c.example',
      check: async () => {
        if (fail) throw new Error('timeout');
        return { level: 'minor' as const, summary: 'Slow', incidents: [] };
      },
    };
    await checkAllServices([provider]);
    fail = true;
    const [again] = await checkAllServices([provider]);
    expect(again.level).toBe('minor');
    expect(again.summary).toBe('Slow');
  });
});
