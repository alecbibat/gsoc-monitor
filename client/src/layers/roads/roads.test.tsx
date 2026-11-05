import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoadClosure } from '../../types';
import { RoadClosureDetails } from './RoadClosureDetails';
import { summarizeByPark, summaryText } from './roadsMeta';

const closure = (id: string, parkCode: string, impact: RoadClosure['impact'], extra: Partial<RoadClosure> = {}): RoadClosure => ({
  id,
  source: 'yell',
  sourceLabel: 'Yellowstone road status (NPS)',
  parkCode,
  title: 'Grand Loop Rd: Madison Junction to Old Faithful',
  roadNames: ['Grand Loop Rd'],
  description: 'Closed to all wheeled vehicles.',
  impact,
  eventType: 'park road status',
  direction: null,
  start: null,
  end: null,
  updated: null,
  lines: [],
  point: [-110.8, 44.5],
  url: null,
  ...extra,
});

describe('road closure summaries', () => {
  it('counts per park, most closed roads first', () => {
    const out = summarizeByPark([
      closure('a', 'grca', 'restricted'),
      closure('b', 'yell', 'closed'),
      closure('c', 'yell', 'closed'),
      closure('d', 'yell', 'restricted'),
    ]);
    expect(out).toEqual([
      { parkCode: 'yell', closed: 2, restricted: 1 },
      { parkCode: 'grca', closed: 0, restricted: 1 },
    ]);
    expect(out.map(summaryText)).toEqual(['2 closed · 1 restricted', '1 restricted']);
  });
});

describe('RoadClosureDetails', () => {
  it('names the park, the road and that no end time was given', () => {
    const html = renderToStaticMarkup(<RoadClosureDetails payload={closure('a', 'yell', 'closed')} />);
    expect(html).toContain('Road closed');
    expect(html).toContain('Near Yellowstone');
    expect(html).toContain('Grand Loop Rd');
    expect(html).toContain('No end time given');
    expect(html).toContain('https://www.nps.gov/yell/planyourvisit/conditions.htm');
  });

  it('shows a restriction with its window and source link', () => {
    const html = renderToStaticMarkup(
      <RoadClosureDetails
        payload={closure('b', 'grca', 'restricted', {
          source: 'az-wzdx',
          sourceLabel: 'Arizona DOT work zone (AZ511)',
          roadNames: ['I-40'],
          start: '2026-11-01T00:00:00Z',
          end: '2099-11-24T06:30:00Z',
          url: 'https://az511.gov/',
        })}
      />
    );
    expect(html).toContain('Restricted');
    expect(html).toContain('Near Grand Canyon');
    expect(html).toContain('Arizona DOT work zone (AZ511)');
    expect(html).toContain('More from the source');
    expect(html).not.toContain('No end time given');
  });
});
