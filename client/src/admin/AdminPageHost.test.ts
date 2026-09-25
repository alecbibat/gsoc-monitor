import { describe, expect, it } from 'vitest';
import { adminHash, parseAdminHash } from './AdminPageHost';
import { ADMIN_SECTIONS } from './adminPageStore';

describe('parseAdminHash', () => {
  it('reads every section back from its own hash', () => {
    for (const s of ADMIN_SECTIONS) expect(parseAdminHash(adminHash(s.id))).toEqual({ section: s.id });
  });

  it('opens on the current section for a bare or unknown section', () => {
    expect(parseAdminHash('#admin')).toEqual({});
    expect(parseAdminHash('#admin/')).toEqual({});
    expect(parseAdminHash('#admin/nope')).toEqual({});
    expect(parseAdminHash('#admin/iap/')).toEqual({ section: 'iap' });
  });

  it('ignores hashes that are not the admin page', () => {
    expect(parseAdminHash('')).toBeNull();
    expect(parseAdminHash('#')).toBeNull();
    expect(parseAdminHash('#administrator')).toBeNull();
    expect(parseAdminHash('#admin/iap/extra')).toBeNull();
    expect(parseAdminHash('#map')).toBeNull();
  });
});
