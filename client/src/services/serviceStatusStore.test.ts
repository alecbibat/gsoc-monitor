import { describe, expect, it } from 'vitest';
import { summarizeChip } from './serviceStatusStore';
import type { ServiceLevel, ServiceStatus } from '../types';

const svc = (id: string, level: ServiceLevel): ServiceStatus => ({
  id,
  name: id.toUpperCase(),
  url: `https://${id}.example`,
  level,
  summary: '',
  incidents: [],
  checkedAt: 0,
});

describe('summarizeChip', () => {
  const all = [svc('a', 'ok'), svc('b', 'minor'), svc('c', 'major'), svc('d', 'unknown'), svc('e', 'ok')];

  it('counts only the chosen services', () => {
    const s = summarizeChip(all, ['a', 'e']);
    expect(s).toMatchObject({ level: 'ok', headline: '2/2', label: 'services up' });
  });

  it('names the worst chosen service and how many more have issues', () => {
    const s = summarizeChip(all, ['a', 'b', 'c']);
    expect(s).toMatchObject({ level: 'major', headline: 'C +1', label: 'outage' });
    expect(summarizeChip(all, ['a', 'b'])).toMatchObject({ level: 'minor', headline: 'B', label: 'degraded' });
  });

  it('does not count an unreadable status page as up', () => {
    expect(summarizeChip(all, ['a', 'd'])).toMatchObject({ level: 'ok', headline: '1/2' });
    expect(summarizeChip(all, ['d'])).toMatchObject({ level: 'unknown', headline: '0/1' });
  });

  it('ignores chosen ids the server no longer lists, and handles an empty choice', () => {
    expect(summarizeChip(all, ['a', 'gone']).shown.map((s) => s.id)).toEqual(['a']);
    expect(summarizeChip(all, [])).toMatchObject({ level: 'unknown', headline: '—' });
  });
});
