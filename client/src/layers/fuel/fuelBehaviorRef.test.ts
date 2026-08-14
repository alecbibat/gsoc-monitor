import { describe, expect, it } from 'vitest';
import { FBFM40 } from './fbfm40';
import {
  BEHAVIOR_CLASSES, FUEL_BEHAVIOR_REF, SUPPRESSION_BANDS,
  suppressionBandsForFlameClass,
} from './fuelBehaviorRef';

describe('FUEL_BEHAVIOR_REF integrity', () => {
  it('covers every burnable FBFM40 model and no nonburnable one', () => {
    for (const [value, cls] of Object.entries(FBFM40)) {
      const ref = FUEL_BEHAVIOR_REF[Number(value)];
      if (cls.group === 'Nonburnable') {
        expect(ref, `${cls.code} should have no behavior ref`).toBeUndefined();
      } else {
        expect(ref, `${cls.code} missing behavior ref`).toBeDefined();
      }
    }
  });

  it('references only defined classes', () => {
    for (const ref of Object.values(FUEL_BEHAVIOR_REF)) {
      expect(BEHAVIOR_CLASSES[ref.ros]).toBeDefined();
      expect(BEHAVIOR_CLASSES[ref.fl]).toBeDefined();
    }
  });

  it('class flame-length ranges tile without gaps (GTR-153 Table 5)', () => {
    const ordered = Object.values(BEHAVIOR_CLASSES).sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].flRange[0]).toBe(ordered[i - 1].flRange[1]);
    }
  });

  it('spot-checks published ratings (GTR-153 selection guide)', () => {
    expect(FUEL_BEHAVIOR_REF[102]).toMatchObject({ ros: 'high', fl: 'moderate' });     // GR2
    expect(FUEL_BEHAVIOR_REF[109]).toMatchObject({ ros: 'extreme', fl: 'extreme' });   // GR9
    expect(FUEL_BEHAVIOR_REF[141]).toMatchObject({ ros: 'very-low', fl: 'very-low' }); // SH1
    expect(FUEL_BEHAVIOR_REF[124]).toMatchObject({ ros: 'high', fl: 'very-high' });    // GS4
    expect(FUEL_BEHAVIOR_REF[181]).toMatchObject({ ros: 'very-low', fl: 'very-low' }); // TL1
  });
});

describe('suppressionBandsForFlameClass', () => {
  it('maps low flame classes to the hand-crew band only', () => {
    expect(suppressionBandsForFlameClass('very-low')).toEqual([SUPPRESSION_BANDS[0]]);
    expect(suppressionBandsForFlameClass('low')).toEqual([SUPPRESSION_BANDS[0]]);
  });
  it('maps Moderate (4–8 ft) to the equipment band', () => {
    expect(suppressionBandsForFlameClass('moderate')).toEqual([SUPPRESSION_BANDS[1]]);
  });
  it('High (8–12 ft) spans BOTH the 8–11 and 11+ bands', () => {
    expect(suppressionBandsForFlameClass('high')).toEqual([SUPPRESSION_BANDS[2], SUPPRESSION_BANDS[3]]);
  });
  it('Very High / Extreme land in the head-attack-ineffective band', () => {
    expect(suppressionBandsForFlameClass('very-high')).toEqual([SUPPRESSION_BANDS[3]]);
    expect(suppressionBandsForFlameClass('extreme')).toEqual([SUPPRESSION_BANDS[3]]);
  });
});
