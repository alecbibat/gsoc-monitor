import { describe, expect, it } from 'vitest';
import { fleetName } from './ships';

describe('fleetName', () => {
  it('labels a fleet ship by its fleet name, whatever its AIS broadcasts', () => {
    // The Star Explorer's AIS still sends its former name, WORLD EXPLORER.
    expect(fleetName('255806193', 9835719)).toBe('Star Explorer');
    expect(fleetName('311001759', null)).toBe('Star Seeker');
  });

  it('finds a fleet ship by IMO under an MMSI it has not used before (a reflag)', () => {
    expect(fleetName('311999999', 9835719)).toBe('Star Explorer');
  });

  it('leaves vessels outside the fleet to their AIS name', () => {
    expect(fleetName('538008859', 9870977)).toBeNull(); // a container ship also named STAR EXPLORER
    expect(fleetName('123456789', null)).toBeNull();
  });
});
