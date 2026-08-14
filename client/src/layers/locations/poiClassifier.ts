// Classification of raw Overpass/OSM features into the four service categories
// the location panel shows.
//
// Why this exists: `amenity=clinic` is OSM's catch-all for outpatient
// facilities. Acupuncturists, chiropractors, physiotherapy desks inside sports
// centres, dentists, dialysis and imaging centres all carry it. Clinics
// outnumber hospitals and sit closer to town, so the old
// `amenity~"^(hospital|clinic)$"` query sorted purely by distance surfaced one
// of those instead of a hospital almost every time in a populated area.
//
// Deliberately dependency-free (no DOM, no imports, no framework): the server
// takes over this lookup in the next step and moves this module as-is.

export type LegKind = 'hospital' | 'hotel' | 'police' | 'fire_station';

export type OsmTags = Record<string, string | undefined>;

/**
 * Ranking group. Lower is a better answer for the requested category.
 *
 * Ordering rule, which is subtle enough to be worth stating: candidates are
 * ranked by tier FIRST and distance only *within* a tier — but a tier is only
 * ever populated when every tier above it came back completely empty across
 * the full radius sweep. So a tier never competes with distance in practice.
 * That matters because `emergency=yes` is inconsistently mapped: treating it
 * as its own tier would rank a tagged ER 200 km away above an untagged
 * hospital 3 km away. It is a label here, not a rank.
 */
export const TIER = {
  /** A real hospital: acute care, somewhere you can take a casualty. */
  HOSPITAL: 0,
  /** Walk-in urgent care — a genuine fallback when there is no hospital. */
  URGENT_CARE: 1,
  /** Specialised (psychiatric / rehab / hospice) or a plain clinic. */
  LIMITED_CARE: 2,
  /** Everything non-medical: exactly one tier, no fallbacks. */
  PRIMARY: 0,
} as const;

export interface Classification {
  tier: number;
  /** What the place actually is. Shown verbatim in the panel. */
  label: string;
}

/** One Overpass pass. Tiers run in order; a tier that yields a `satisfies`
 *  result wins outright and later tiers are never queried. */
export interface QueryTier {
  /** Overpass clauses, without the `(around:…)` suffix. */
  clauses: string[];
  /**
   * The classification tier this pass is trying to find. The radius sweep
   * stops expanding once it has enough candidates at or below it, and no
   * further query tier runs. Needed because a pass can return something worse
   * than it asked for — the hospital query also matches psychiatric hospitals,
   * and three of those nearby must not stop the search for a general one.
   */
  satisfies: number;
}

// ─── Overpass query tiers ────────────────────────────────────────────────────

/**
 * Narrow queries beat one broad query for two reasons. Accuracy: `out center
 * 200` truncates in roughly id order, not by distance, so a broad
 * hospital-or-clinic query in a dense metro can drop the actual hospital to
 * stay under the cap. Cost: the strict hospital query returns a handful of
 * features instead of hundreds, so it is cheaper on Overpass too.
 */
export function overpassTiers(kind: LegKind): QueryTier[] {
  switch (kind) {
    case 'hospital':
      return [
        {
          clauses: ['nwr["amenity"="hospital"]', 'nwr["healthcare"="hospital"]'],
          satisfies: TIER.HOSPITAL,
        },
        {
          clauses: [
            'nwr["amenity"="clinic"]["emergency"="yes"]',
            'nwr["healthcare:speciality"~"urgent_care"]',
          ],
          satisfies: TIER.URGENT_CARE,
        },
        {
          clauses: ['nwr["amenity"="clinic"]', 'nwr["healthcare"="centre"]'],
          satisfies: TIER.LIMITED_CARE,
        },
      ];
    case 'hotel':
      return [
        { clauses: ['nwr["tourism"~"^(hotel|motel|resort)$"]'], satisfies: TIER.PRIMARY },
        {
          clauses: ['nwr["tourism"~"^(guest_house|hostel|chalet|apartment)$"]'],
          satisfies: TIER.PRIMARY,
        },
      ];
    case 'police':
      return [{ clauses: ['nwr["amenity"="police"]'], satisfies: TIER.PRIMARY }];
    case 'fire_station':
      return [{ clauses: ['nwr["amenity"="fire_station"]'], satisfies: TIER.PRIMARY }];
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

// A feature retagged into a lifecycle namespace (`disused:amenity=hospital`)
// no longer matches `amenity=hospital`, so Overpass filters most of these out
// for us. Some mappers set both, though, and fire stations in particular are
// often left tagged after decommissioning.
const DEAD_PREFIXES = [
  'disused',
  'abandoned',
  'was',
  'demolished',
  'razed',
  'removed',
  'proposed',
  'construction',
  'planned',
];

const DEAD_STATUS = new Set(['closed', 'abandoned', 'disused', 'out_of_service', 'demolished']);

function low(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function isDefunct(tags: OsmTags): boolean {
  if (low(tags.disused) === 'yes' || low(tags.abandoned) === 'yes') return true;
  if (tags.amenity === 'construction' || tags.amenity === 'proposed') return true;
  if (DEAD_STATUS.has(low(tags.operational_status))) return true;
  if (low(tags.opening_hours) === 'closed') return true;
  for (const p of DEAD_PREFIXES) {
    if (tags[`${p}:amenity`] || tags[`${p}:healthcare`] || tags[`${p}:tourism`]) return true;
  }
  return false;
}

// ─── Healthcare filtering ────────────────────────────────────────────────────

/** `healthcare:speciality` is a semicolon-delimited list. */
function specialities(tags: OsmTags): string[] {
  return low(tags['healthcare:speciality'])
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

const VETERINARY_NAME =
  /\b(veterinar|animal (hospital|clinic|care)|pet (hospital|clinic|care)|equine|spay|neuter)/i;

function isVeterinary(tags: OsmTags): boolean {
  if (tags.amenity === 'veterinary' || low(tags.healthcare) === 'veterinary') return true;
  if (specialities(tags).some((s) => s.includes('veterinary'))) return true;
  return VETERINARY_NAME.test(tags.name ?? '');
}

// `healthcare=*` values that are never a hospital, whatever else is tagged.
const NON_HOSPITAL_HEALTHCARE = new Set([
  'alternative',
  'audiologist',
  'birthing_centre',
  'blood_bank',
  'blood_donation',
  'counselling',
  'dentist',
  'dietitian',
  'laboratory',
  'midwife',
  'nurse',
  'nutrition_counselling',
  'occupational_therapist',
  'optometrist',
  'pharmacy',
  'physiotherapist',
  'podiatrist',
  'psychotherapist',
  'sample_collection',
  'speech_therapist',
  'vaccination_centre',
]);

// The specialities behind the wrong answers this fixes. Applied to
// clinic-shaped features only — a hospital's paediatrics or oncology tag must
// not disqualify the hospital.
const NON_HOSPITAL_SPECIALITY = new Set([
  'acupuncture',
  'allergology',
  'alternative',
  'audiology',
  'ayurveda',
  'beauty',
  'chiropodist',
  'chiropody',
  'chiropractic',
  'chiropractor',
  'cosmetic',
  'cosmetic_surgery',
  'counselling',
  'dental',
  'dental_hygiene',
  'dentistry',
  'dialysis',
  'dietetics',
  'fertility',
  'hair_removal',
  'herbalism',
  'homeopathy',
  'kinesiology',
  'laboratory',
  'massage',
  'naturopathy',
  'nutrition',
  'occupational_therapy',
  'optometry',
  'orthodontics',
  'osteopathy',
  'physiotherapy',
  'podiatry',
  'radiology',
  'speech_therapy',
  'sports',
  'sports_medicine',
  'tattoo_removal',
  'vaccination',
  'weight_loss',
  'wellness',
]);

// Specialities that make a facility real but not acute care. A psychiatric or
// rehabilitation hospital is a hospital, so it is kept — but it is not where
// you take a trauma casualty, so it drops below urgent care and says so.
const NON_ACUTE_SPECIALITY = new Set([
  'community',
  'hospice',
  'long_term_care',
  'nursing',
  'palliative',
  'psychiatry',
  'rehabilitation',
]);

// Last-resort backstop for features that carry no useful healthcare tags at
// all — common for imported or hand-added clinic nodes. Never applied to
// `amenity=hospital`.
const NON_HOSPITAL_NAME =
  /\b(acupunctur|chiropract|naturopath|homeopath|ayurved|day spa|med(ical)? spa|wellness|massage|dental|dentist|orthodont|physical therapy|physiotherapy|sports medicine|sports (centre|center)|fitness|dialysis|imaging|radiolog|laborator|optical|optometr|eye care|vision care|hearing|audiolog|fertility|ivf|cosmetic|botox|weight loss|counsel(l)?ing|methadone)/i;

/**
 * A gym with an in-house physio desk, or a pharmacy counter inside a store,
 * carries both sets of tags. Whatever else it is, it is not a hospital — this
 * is what let "sports centre" through before.
 */
function isNonMedicalPremises(tags: OsmTags): boolean {
  return Boolean(tags.leisure || tags.shop || tags.craft || tags.club);
}

function classifyHospital(tags: OsmTags): Classification | null {
  if (isVeterinary(tags)) return null;
  if (isNonMedicalPremises(tags)) return null;

  const healthcare = low(tags.healthcare);
  if (NON_HOSPITAL_HEALTHCARE.has(healthcare)) return null;

  const specs = specialities(tags);
  const isHospital = tags.amenity === 'hospital' || healthcare === 'hospital';

  if (isHospital) {
    // Real hospital. Only its *own* specialisation can demote it, and only to
    // "not acute care" — never to rejected.
    const nonAcute = specs.length > 0 && specs.every((s) => NON_ACUTE_SPECIALITY.has(s));
    if (nonAcute) {
      return { tier: TIER.LIMITED_CARE, label: hospitalSpecialityLabel(specs) };
    }
    return {
      tier: TIER.HOSPITAL,
      label: low(tags.emergency) === 'yes' ? 'Hospital · emergency dept' : 'Hospital',
    };
  }

  // Clinic-shaped from here down: the full denylist applies.
  if (specs.some((s) => NON_HOSPITAL_SPECIALITY.has(s))) return null;
  if (NON_HOSPITAL_NAME.test(tags.name ?? '')) return null;

  const isClinic = tags.amenity === 'clinic' || healthcare === 'centre' || healthcare === 'clinic';
  if (!isClinic) return null;

  if (low(tags.emergency) === 'yes' || specs.some((s) => s.includes('urgent_care'))) {
    return { tier: TIER.URGENT_CARE, label: 'Urgent care' };
  }
  return { tier: TIER.LIMITED_CARE, label: 'Clinic — no emergency dept' };
}

function hospitalSpecialityLabel(specs: string[]): string {
  if (specs.includes('psychiatry')) return 'Psychiatric hospital — no emergency dept';
  if (specs.includes('rehabilitation')) return 'Rehabilitation hospital — no emergency dept';
  if (specs.includes('hospice') || specs.includes('palliative')) return 'Hospice — no emergency dept';
  return 'Specialist hospital — no emergency dept';
}

// ─── Other categories ────────────────────────────────────────────────────────

// `amenity=police` also covers administrative offices, academies and holding
// facilities. They are not where a patrol car is dispatched from.
const NON_RESPONDING_POLICE = new Set([
  'academy',
  'barracks',
  'detention',
  'offices',
  'storage',
  'training',
]);

function classifyPolice(tags: OsmTags): Classification | null {
  if (tags.amenity !== 'police') return null;
  const kindTag = low(tags.police);
  if (NON_RESPONDING_POLICE.has(kindTag)) return null;
  const operator = tags.operator?.trim();
  return { tier: TIER.PRIMARY, label: operator ? `Police · ${operator}` : 'Police station' };
}

function classifyFireStation(tags: OsmTags): Classification | null {
  if (tags.amenity !== 'fire_station') return null;
  const volunteer = low(tags['fire_station:type']) === 'volunteer' || low(tags.volunteer) === 'yes';
  return { tier: TIER.PRIMARY, label: volunteer ? 'Fire station · volunteer' : 'Fire station' };
}

const TOURISM_LABEL: Record<string, string> = {
  hotel: 'Hotel',
  motel: 'Motel',
  resort: 'Resort',
  guest_house: 'Guest house',
  hostel: 'Hostel',
  chalet: 'Chalet',
  apartment: 'Serviced apartment',
};

function classifyLodging(tags: OsmTags): Classification | null {
  const t = low(tags.tourism);
  const label = TOURISM_LABEL[t];
  if (!label) return null;
  return { tier: TIER.PRIMARY, label };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/** Returns null when the feature must not be offered for this category. */
export function classify(tags: OsmTags, kind: LegKind): Classification | null {
  if (isDefunct(tags)) return null;
  switch (kind) {
    case 'hospital':
      return classifyHospital(tags);
    case 'hotel':
      return classifyLodging(tags);
    case 'police':
      return classifyPolice(tags);
    case 'fire_station':
      return classifyFireStation(tags);
  }
}

// ─── Self-match ──────────────────────────────────────────────────────────────

/** Strip punctuation and collapse whitespace; keeps every word so
 *  "Village Inn" and "Village Lodge" stay distinct. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when a candidate is the pin itself. Several pins *are* hotels, and OSM
 * stores a building as both a node and a polygon whose centroid can sit well
 * off the pin — the old flat 80 m radius guard missed those, so a property
 * offered directions to itself.
 */
export function isSelfMatch(
  candidateName: string,
  pinName: string | undefined,
  distanceM: number
): boolean {
  if (distanceM < 80) return true;
  if (distanceM > 400 || !pinName) return false;
  const a = normalizeName(candidateName);
  const b = normalizeName(pinName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
