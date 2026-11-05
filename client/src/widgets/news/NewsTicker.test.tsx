import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NewsItem } from '../../types';
import { TickerBar, type TickerEntry } from './NewsTicker';

const headline: NewsItem = {
  id: 'w1',
  title: 'World headline',
  url: 'https://example.com/w1',
  source: 'Al Jazeera',
  image: null,
  publishedAt: 0,
  severity: 'alert',
  category: 'politics',
  countryName: null,
  lat: null,
  lon: null,
};

const parkAlert: TickerEntry = {
  nps: true,
  item: { kind: 'alert', id: 'a1', parkCode: 'yell', park: 'Yellowstone', title: 'Most Park Roads Closed', category: 'closure' },
};
const parkNews: TickerEntry = {
  nps: true,
  item: { kind: 'news', id: 'n1', parkCode: 'glac', park: 'Glacier', title: 'Bats', url: 'https://www.nps.gov/glac/n1.htm' },
};

const noop = () => {};
const render = (props: Partial<Parameters<typeof TickerBar>[0]>) =>
  renderToStaticMarkup(
    <TickerBar
      npsOnly={false}
      entries={[]}
      npsAlertCount={0}
      showNpsKey={false}
      emptyText=""
      insetForSidebar
      onToggleMode={noop}
      onOpenNpsPanel={noop}
      onOpenModePanel={noop}
      {...props}
    />
  );

describe('TickerBar', () => {
  it('runs headlines and park chips under a BREAKING label that switches to park alerts', () => {
    const html = render({
      entries: [parkAlert, { nps: false, item: headline }, parkNews],
      npsAlertCount: 1,
      showNpsKey: true,
    });
    expect(html).toContain('Breaking');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Click to show only National Park Service alerts');
    expect(html).toContain('World headline');
    expect(html).toContain('Most Park Roads Closed');
    expect(html).toContain('Closure');
    expect(html).toContain('1 alert');
    expect(html).toContain('Open the Breaking News panel');
  });

  it('reads NPS ALERTS with the count in the alerts-only mode, opening the parks panel', () => {
    const html = render({ npsOnly: true, entries: [parkAlert], npsAlertCount: 1 });
    expect(html).toContain('NPS alerts');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Click to show all headlines');
    expect(html).toContain('Most Park Roads Closed');
    expect(html).not.toContain('World headline');
    expect(html).not.toContain('1 alert<');
    expect(html).toContain('Open the National Parks panel');
  });

  it('repeats a short list so one pass spans the bar', () => {
    const html = render({ npsOnly: true, entries: [parkAlert], npsAlertCount: 1 });
    // One alert → six per pass, two passes in the loop.
    expect(html.match(/Most Park Roads Closed/g)).toHaveLength(12);
  });

  it('keeps the bar, and the way back, when there are no park alerts', () => {
    const html = render({ npsOnly: true, entries: [], emptyText: 'No National Park Service alerts in effect' });
    expect(html).toContain('NPS alerts');
    expect(html).toContain('No National Park Service alerts in effect');
    expect(html).not.toContain('animate-marquee');
  });
});
