export interface StormClass {
  /** Human-readable status, e.g. "Category 3 Hurricane" or "Tropical Storm". */
  label: string;
  /** Saffir–Simpson category 1–5, or null for sub-hurricane systems. */
  category: number | null;
  /** Display colour (hex) keyed to intensity. */
  color: string;
}

const CAT_COLORS = {
  cat5: '#ff5ad8',
  cat4: '#ff4d4d',
  cat3: '#ff7a3d',
  cat2: '#ffb13d',
  cat1: '#ffd84d',
  storm: '#4dd2ff',
  depression: '#8fb3c9',
} as const;

/**
 * Derive a storm's classification primarily from its max sustained wind (knots),
 * which is what the Saffir–Simpson scale is defined on. The NHC storm-type code
 * is only used to distinguish special, non-category states (potential / post-
 * tropical / disturbance) and the subtropical prefix.
 */
export function classifyStorm(typeCode?: string, windKt?: number): StormClass {
  const t = (typeCode ?? '').toUpperCase();

  if (t === 'PTC') return { label: 'Potential Tropical Cyclone', category: null, color: CAT_COLORS.depression };
  if (t === 'EX') return { label: 'Post-Tropical Cyclone', category: null, color: CAT_COLORS.depression };
  if (t === 'LO' || t === 'DB' || t === 'WV')
    return { label: 'Remnant / Disturbance', category: null, color: CAT_COLORS.depression };

  const subtropical = t.startsWith('S'); // STS (storm) / STD (depression)
  const w = windKt ?? 0;

  if (w >= 137) return { label: 'Category 5 Hurricane', category: 5, color: CAT_COLORS.cat5 };
  if (w >= 113) return { label: 'Category 4 Hurricane', category: 4, color: CAT_COLORS.cat4 };
  if (w >= 96) return { label: 'Category 3 Hurricane', category: 3, color: CAT_COLORS.cat3 };
  if (w >= 83) return { label: 'Category 2 Hurricane', category: 2, color: CAT_COLORS.cat2 };
  if (w >= 64) return { label: 'Category 1 Hurricane', category: 1, color: CAT_COLORS.cat1 };
  if (w >= 34)
    return {
      label: subtropical ? 'Subtropical Storm' : 'Tropical Storm',
      category: null,
      color: CAT_COLORS.storm,
    };
  return {
    label: subtropical ? 'Subtropical Depression' : 'Tropical Depression',
    category: null,
    color: CAT_COLORS.depression,
  };
}
