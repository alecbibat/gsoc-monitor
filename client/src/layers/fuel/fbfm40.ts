// LANDFIRE "40 Scott & Burgan Fire Behavior Fuel Models" (FBFM40) codebook.
//
// The LANDFIRE FBFM40 raster encodes each ~30 m cell of the continental US as
// one of these integer class codes. The ImageServer applies the official
// colormap when it renders tiles, but the raw pixel values (used by the
// zonal-histogram "draw a circle" analysis) are these numeric codes — so the
// value→name/group/color lookup has to live here in the app.
//
// Values, names and RGB colors are the official LANDFIRE colormap (verified
// against the LF2023/LF2022 F40 CSV attribute table and the ImageServer
// /legend endpoint). See https://landfire.gov.

export interface Fbfm40Class {
  code: string; // e.g. "GR2"
  name: string; // human-readable description
  group: FuelGroupKey; // coarse fuel group
  rgb: [number, number, number];
}

export type FuelGroupKey =
  | 'Nonburnable'
  | 'Grass'
  | 'Grass-Shrub'
  | 'Shrub'
  | 'Timber-Understory'
  | 'Timber-Litter'
  | 'Slash-Blowdown';

export const FBFM40: Record<number, Fbfm40Class> = {
  91: { code: 'NB1', name: 'Urban / Developed', group: 'Nonburnable', rgb: [104, 104, 104] },
  92: { code: 'NB2', name: 'Snow / Ice', group: 'Nonburnable', rgb: [225, 225, 225] },
  93: { code: 'NB3', name: 'Agricultural', group: 'Nonburnable', rgb: [255, 237, 237] },
  98: { code: 'NB8', name: 'Open Water', group: 'Nonburnable', rgb: [0, 14, 214] },
  99: { code: 'NB9', name: 'Barren', group: 'Nonburnable', rgb: [77, 110, 112] },
  101: { code: 'GR1', name: 'Short, sparse dry climate grass', group: 'Grass', rgb: [255, 235, 190] },
  102: { code: 'GR2', name: 'Low load, dry climate grass', group: 'Grass', rgb: [255, 211, 115] },
  103: { code: 'GR3', name: 'Low load, very coarse, humid climate grass', group: 'Grass', rgb: [255, 236, 139] },
  104: { code: 'GR4', name: 'Moderate load, dry climate grass', group: 'Grass', rgb: [255, 255, 115] },
  105: { code: 'GR5', name: 'Low load, humid climate grass', group: 'Grass', rgb: [245, 222, 41] },
  106: { code: 'GR6', name: 'Moderate load, humid climate grass', group: 'Grass', rgb: [230, 230, 64] },
  107: { code: 'GR7', name: 'High load, dry climate grass', group: 'Grass', rgb: [205, 198, 115] },
  108: { code: 'GR8', name: 'High load, very coarse, humid climate grass', group: 'Grass', rgb: [139, 134, 78] },
  109: { code: 'GR9', name: 'Very high load, humid climate grass', group: 'Grass', rgb: [168, 112, 0] },
  121: { code: 'GS1', name: 'Low load, dry climate grass-shrub', group: 'Grass-Shrub', rgb: [255, 170, 0] },
  122: { code: 'GS2', name: 'Moderate load, dry climate grass-shrub', group: 'Grass-Shrub', rgb: [255, 167, 127] },
  123: { code: 'GS3', name: 'Moderate load, humid climate grass-shrub', group: 'Grass-Shrub', rgb: [255, 99, 0] },
  124: { code: 'GS4', name: 'High load, humid climate grass-shrub', group: 'Grass-Shrub', rgb: [205, 102, 0] },
  141: { code: 'SH1', name: 'Low load, dry climate shrub', group: 'Shrub', rgb: [215, 194, 158] },
  142: { code: 'SH2', name: 'Moderate load, dry climate shrub', group: 'Shrub', rgb: [215, 176, 158] },
  143: { code: 'SH3', name: 'Moderate load, humid climate shrub', group: 'Shrub', rgb: [205, 137, 102] },
  144: { code: 'SH4', name: 'Low load, humid climate timber-shrub', group: 'Shrub', rgb: [137, 90, 68] },
  145: { code: 'SH5', name: 'High load, dry climate shrub', group: 'Shrub', rgb: [205, 170, 102] },
  146: { code: 'SH6', name: 'Low load, humid climate shrub', group: 'Shrub', rgb: [237, 112, 68] },
  147: { code: 'SH7', name: 'Very high load, dry climate shrub', group: 'Shrub', rgb: [205, 125, 57] },
  148: { code: 'SH8', name: 'High load, humid climate shrub', group: 'Shrub', rgb: [168, 56, 0] },
  149: { code: 'SH9', name: 'Very high load, humid climate shrub', group: 'Shrub', rgb: [115, 26, 0] },
  161: { code: 'TU1', name: 'Low load, dry climate timber-grass-shrub', group: 'Timber-Understory', rgb: [233, 255, 190] },
  162: { code: 'TU2', name: 'Moderate load, humid climate timber-shrub', group: 'Timber-Understory', rgb: [170, 255, 0] },
  163: { code: 'TU3', name: 'Moderate load, humid climate timber-grass-shrub', group: 'Timber-Understory', rgb: [180, 215, 158] },
  164: { code: 'TU4', name: 'Dwarf conifer with understory', group: 'Timber-Understory', rgb: [112, 168, 0] },
  165: { code: 'TU5', name: 'Very high load, dry climate timber-shrub', group: 'Timber-Understory', rgb: [38, 115, 0] },
  181: { code: 'TL1', name: 'Low load, compact conifer litter', group: 'Timber-Litter', rgb: [190, 255, 232] },
  182: { code: 'TL2', name: 'Low load broadleaf litter', group: 'Timber-Litter', rgb: [0, 255, 197] },
  183: { code: 'TL3', name: 'Moderate load conifer litter', group: 'Timber-Litter', rgb: [190, 210, 255] },
  184: { code: 'TL4', name: 'Small downed logs', group: 'Timber-Litter', rgb: [123, 104, 238] },
  185: { code: 'TL5', name: 'High load conifer litter', group: 'Timber-Litter', rgb: [190, 232, 255] },
  186: { code: 'TL6', name: 'Moderate load broadleaf litter', group: 'Timber-Litter', rgb: [0, 197, 255] },
  187: { code: 'TL7', name: 'Large downed logs', group: 'Timber-Litter', rgb: [0, 132, 168] },
  188: { code: 'TL8', name: 'Long-needle litter', group: 'Timber-Litter', rgb: [0, 92, 230] },
  189: { code: 'TL9', name: 'Very high load broadleaf litter', group: 'Timber-Litter', rgb: [77, 110, 145] },
  201: { code: 'SB1', name: 'Low load activity fuel', group: 'Slash-Blowdown', rgb: [232, 190, 255] },
  202: { code: 'SB2', name: 'Moderate load activity fuel / low blowdown', group: 'Slash-Blowdown', rgb: [197, 0, 255] },
  203: { code: 'SB3', name: 'High load activity fuel / moderate blowdown', group: 'Slash-Blowdown', rgb: [255, 190, 232] },
  204: { code: 'SB4', name: 'High load blowdown', group: 'Slash-Blowdown', rgb: [255, 127, 127] },
};

export interface FuelGroupMeta {
  key: FuelGroupKey;
  label: string;
  short: string; // GR, GS, SH, TU, TL, SB, NB
  rgb: [number, number, number]; // representative legend color (matches the colormap family)
  burnable: boolean;
  blurb: string;
}

// Display order for the legend and the zone-analysis rollup: burnable groups
// first (roughly increasing canopy), nonburnable last. The representative color
// of each group matches the LANDFIRE colormap family so the legend reads against
// the raster.
export const FUEL_GROUPS: FuelGroupMeta[] = [
  { key: 'Grass',             label: 'Grass',              short: 'GR', rgb: [255, 211, 115], burnable: true,  blurb: 'Grass-dominated surface fuels' },
  { key: 'Grass-Shrub',       label: 'Grass-Shrub',        short: 'GS', rgb: [255, 150, 40],  burnable: true,  blurb: 'Mixed grass and shrub fuels' },
  { key: 'Shrub',             label: 'Shrub',              short: 'SH', rgb: [200, 120, 75],  burnable: true,  blurb: 'Shrub / brush fuels' },
  { key: 'Timber-Understory', label: 'Timber-Understory',  short: 'TU', rgb: [112, 168, 0],   burnable: true,  blurb: 'Forest with grass/shrub understory' },
  { key: 'Timber-Litter',     label: 'Timber-Litter',      short: 'TL', rgb: [40, 120, 220],  burnable: true,  blurb: 'Forest-floor litter under timber' },
  { key: 'Slash-Blowdown',    label: 'Slash-Blowdown',     short: 'SB', rgb: [197, 0, 255],   burnable: true,  blurb: 'Logging slash or blowdown debris' },
  { key: 'Nonburnable',       label: 'Nonburnable',        short: 'NB', rgb: [130, 130, 130], burnable: false, blurb: 'Urban, water, agriculture, snow, barren' },
];

export const FUEL_GROUP_BY_KEY: Record<FuelGroupKey, FuelGroupMeta> = Object.fromEntries(
  FUEL_GROUPS.map((g) => [g.key, g])
) as Record<FuelGroupKey, FuelGroupMeta>;

const UNKNOWN_CLASS: Fbfm40Class = {
  code: '—',
  name: 'Unclassified',
  group: 'Nonburnable',
  rgb: [136, 136, 136],
};

// Resolve a raster pixel value to its FBFM40 class, falling back to a neutral
// "unclassified" entry so an unexpected value never breaks the breakdown math.
export function fbfm40Class(value: number): Fbfm40Class {
  return FBFM40[value] ?? { ...UNKNOWN_CLASS, code: String(value) };
}

export function rgbCss([r, g, b]: [number, number, number], alpha = 1): string {
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
