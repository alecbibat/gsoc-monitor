import { describe, expect, it } from 'vitest';
import { accessBadge, filterTeam } from './TeamSection';

describe('accessBadge', () => {
  it('prefers SSO, then password, else pending', () => {
    expect(accessBadge({ sso_linked: true, has_password: true }).label).toBe('SSO');
    expect(accessBadge({ sso_linked: false, has_password: true }).label).toBe('Password');
    expect(accessBadge({}).label).toBe('Pending');
  });
});

describe('filterTeam', () => {
  const users = [
    { name: 'Ada Lovelace', email: 'ada@example.com' },
    { name: 'Grace Hopper', email: 'ghopper@example.com' },
  ];
  it('matches name or email, case-insensitively', () => {
    expect(filterTeam(users, 'GRACE').map((u) => u.name)).toEqual(['Grace Hopper']);
    expect(filterTeam(users, 'ada@')).toHaveLength(1);
  });
  it('returns everyone for a blank query', () => {
    expect(filterTeam(users, '  ')).toHaveLength(2);
  });
});
