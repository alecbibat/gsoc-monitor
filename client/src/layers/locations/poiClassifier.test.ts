import { describe, it, expect } from 'vitest';
import { classify, isSelfMatch, overpassTiers, TIER, type OsmTags } from './poiClassifier';

// Tag sets below are the real OSM shapes these features carry in the wild —
// the rejected ones are the categories that were being offered as "nearest
// hospital" before this classifier existed.

describe('classify — hospital', () => {
  const asHospital = (tags: OsmTags) => classify(tags, 'hospital');

  it('accepts a general hospital', () => {
    expect(asHospital({ amenity: 'hospital', name: 'Kalispell Regional Medical Center' })).toEqual({
      tier: TIER.HOSPITAL,
      label: 'Hospital',
    });
  });

  it('labels a tagged emergency department without ranking it above a nearer hospital', () => {
    const er = asHospital({ amenity: 'hospital', emergency: 'yes', name: 'St. Vincent' });
    const plain = asHospital({ amenity: 'hospital', name: 'Community Hospital' });
    expect(er?.label).toBe('Hospital · emergency dept');
    // Same tier: `emergency=yes` is inconsistently mapped, so it must not
    // outrank a nearer untagged hospital. Distance decides within a tier.
    expect(er?.tier).toBe(plain?.tier);
  });

  it('accepts healthcare=hospital without an amenity tag', () => {
    expect(asHospital({ healthcare: 'hospital', name: 'Cottage Health' })?.tier).toBe(TIER.HOSPITAL);
  });

  it('keeps a hospital whose speciality is clinical, not disqualifying', () => {
    expect(
      asHospital({
        amenity: 'hospital',
        'healthcare:speciality': 'paediatrics;oncology',
        name: "Children's Hospital",
      })?.tier
    ).toBe(TIER.HOSPITAL);
  });

  // ── The reported wrong answers ──

  it('rejects acupuncture', () => {
    expect(asHospital({ amenity: 'clinic', healthcare: 'alternative', 'healthcare:speciality': 'acupuncture', name: 'Blue Sky Acupuncture' })).toBeNull();
  });

  it('rejects chiropractic', () => {
    expect(asHospital({ amenity: 'clinic', 'healthcare:speciality': 'chiropractic', name: 'Summit Chiropractic' })).toBeNull();
  });

  it('rejects a physio desk inside a sports centre', () => {
    expect(
      asHospital({
        amenity: 'clinic',
        leisure: 'sports_centre',
        'healthcare:speciality': 'sports_medicine',
        name: 'Peak Sports Center',
      })
    ).toBeNull();
  });

  it('rejects a sports centre that carries no healthcare tags at all', () => {
    expect(asHospital({ amenity: 'clinic', name: 'Flagstaff Sports Center' })).toBeNull();
  });

  it('rejects dentists, dialysis, imaging and med spas', () => {
    expect(asHospital({ amenity: 'clinic', healthcare: 'dentist', name: 'Bright Smiles' })).toBeNull();
    expect(asHospital({ amenity: 'clinic', 'healthcare:speciality': 'dialysis', name: 'DaVita' })).toBeNull();
    expect(asHospital({ amenity: 'clinic', name: 'Canyon Imaging & Radiology' })).toBeNull();
    expect(asHospital({ amenity: 'clinic', name: 'Serenity Med Spa' })).toBeNull();
  });

  it('rejects veterinary facilities however they are tagged', () => {
    expect(asHospital({ amenity: 'veterinary', name: 'Paws & Claws' })).toBeNull();
    expect(asHospital({ amenity: 'hospital', name: 'Bozeman Animal Hospital' })).toBeNull();
    expect(asHospital({ amenity: 'clinic', healthcare: 'veterinary', name: 'Elk Valley' })).toBeNull();
  });

  it('rejects a pharmacy counter inside a shop', () => {
    expect(asHospital({ amenity: 'clinic', shop: 'chemist', name: 'Walgreens Clinic' })).toBeNull();
  });

  // ── Honest fallbacks ──

  it('offers urgent care as a distinct, lower tier', () => {
    const uc = asHospital({ amenity: 'clinic', emergency: 'yes', name: 'Whitefish Urgent Care' });
    expect(uc).toEqual({ tier: TIER.URGENT_CARE, label: 'Urgent care' });
    expect(uc!.tier).toBeGreaterThan(TIER.HOSPITAL);
  });

  it('keeps a plain clinic but says it has no emergency department', () => {
    const c = asHospital({ amenity: 'clinic', name: 'Gardiner Family Medicine' });
    expect(c?.tier).toBe(TIER.LIMITED_CARE);
    expect(c?.label).toContain('no emergency dept');
  });

  it('demotes a psychiatric hospital below urgent care and says why', () => {
    const p = asHospital({ amenity: 'hospital', 'healthcare:speciality': 'psychiatry', name: 'Mountain Home' });
    expect(p?.tier).toBe(TIER.LIMITED_CARE);
    expect(p?.label).toBe('Psychiatric hospital — no emergency dept');
    expect(p!.tier).toBeGreaterThan(TIER.URGENT_CARE);
  });

  it('rejects hospitals that are closed, demolished or not yet built', () => {
    expect(asHospital({ amenity: 'hospital', disused: 'yes', name: 'Old General' })).toBeNull();
    expect(asHospital({ amenity: 'hospital', operational_status: 'closed', name: 'St. Jude' })).toBeNull();
    expect(asHospital({ amenity: 'hospital', 'construction:amenity': 'hospital', name: 'New Wing' })).toBeNull();
    expect(asHospital({ amenity: 'proposed', name: 'Planned Hospital' })).toBeNull();
  });
});

describe('classify — police', () => {
  it('accepts a responding station and names the operator', () => {
    expect(classify({ amenity: 'police', operator: 'Flathead County Sheriff' }, 'police')).toEqual({
      tier: TIER.PRIMARY,
      label: 'Police · Flathead County Sheriff',
    });
  });

  it('rejects offices, academies and holding facilities', () => {
    expect(classify({ amenity: 'police', police: 'offices' }, 'police')).toBeNull();
    expect(classify({ amenity: 'police', police: 'academy' }, 'police')).toBeNull();
    expect(classify({ amenity: 'police', police: 'detention' }, 'police')).toBeNull();
  });

  it('rejects a decommissioned station', () => {
    expect(classify({ amenity: 'police', 'disused:amenity': 'police' }, 'police')).toBeNull();
  });
});

describe('classify — fire station', () => {
  it('accepts a station and flags volunteer crews', () => {
    expect(classify({ amenity: 'fire_station' }, 'fire_station')?.label).toBe('Fire station');
    expect(
      classify({ amenity: 'fire_station', 'fire_station:type': 'volunteer' }, 'fire_station')?.label
    ).toBe('Fire station · volunteer');
  });

  it('rejects an abandoned station', () => {
    expect(classify({ amenity: 'fire_station', abandoned: 'yes' }, 'fire_station')).toBeNull();
  });
});

describe('classify — lodging', () => {
  it('accepts motels and resorts, which the old tourism=hotel filter missed', () => {
    expect(classify({ tourism: 'motel', name: 'Swiftcurrent Motor Inn' }, 'hotel')?.label).toBe('Motel');
    expect(classify({ tourism: 'resort', name: 'Sea Island' }, 'hotel')?.label).toBe('Resort');
  });

  it('rejects a non-lodging tourism feature', () => {
    expect(classify({ tourism: 'attraction', name: 'Old Faithful' }, 'hotel')).toBeNull();
  });
});

describe('isSelfMatch', () => {
  it('rejects a candidate sharing the pin building', () => {
    expect(isSelfMatch('Many Glacier Hotel', 'Many Glacier Hotel', 30)).toBe(true);
  });

  it('rejects a polygon centroid sitting off the pin', () => {
    // The old flat 80 m guard let this through and the panel offered a
    // property directions to itself.
    expect(isSelfMatch('Many Glacier Hotel', 'Many Glacier Hotel', 260)).toBe(true);
  });

  it('keeps a genuinely different nearby hotel', () => {
    expect(isSelfMatch('Village Inn', 'Village Lodge', 260)).toBe(false);
  });

  it('keeps a same-named hotel that is far away', () => {
    expect(isSelfMatch('Many Glacier Hotel', 'Many Glacier Hotel', 5_000)).toBe(false);
  });
});

describe('overpassTiers', () => {
  it('asks for hospitals before anything clinic-shaped', () => {
    const tiers = overpassTiers('hospital');
    expect(tiers[0].clauses.join(' ')).toContain('"amenity"="hospital"');
    expect(tiers[0].clauses.join(' ')).not.toContain('clinic');
    expect(tiers[2].clauses.join(' ')).toContain('clinic');
  });

  it('gives every category at least one tier', () => {
    for (const kind of ['hospital', 'hotel', 'police', 'fire_station'] as const) {
      expect(overpassTiers(kind).length).toBeGreaterThan(0);
      for (const t of overpassTiers(kind)) expect(t.clauses.length).toBeGreaterThan(0);
    }
  });
});
