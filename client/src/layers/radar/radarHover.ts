import { LUT_MIN_DBZ, LUT_SIZE, LUT_STEPS_PER_DBZ, paletteLut, type RadarPaletteId } from './radarPalettes';

// Pure helpers for the radar hover readout (RadarHoverReadout): the colour the
// map paints a reading in, and where the tooltip sits beside the cursor.

// Below this palette alpha (of 255) the echo is effectively invisible on the
// map — the palettes fade sub-8 dBZ clutter out — so the readout stays hidden
// rather than naming rain nobody can see.
const MIN_VISIBLE_ALPHA = 24;

export interface EchoSwatch {
  css: string; // the palette colour at full strength, for the readout's dot
  visible: boolean; // painted visibly on the map at all
}

export function echoSwatch(palette: RadarPaletteId, dbz: number, snow: boolean): EchoSwatch {
  const lut = paletteLut(palette);
  const table = snow ? lut.snow : lut.rain;
  const i = Math.min(LUT_SIZE - 1, Math.max(0, Math.round((dbz - LUT_MIN_DBZ) * LUT_STEPS_PER_DBZ)));
  const k = i * 4;
  return {
    css: `rgb(${table[k]}, ${table[k + 1]}, ${table[k + 2]})`,
    visible: table[k + 3] >= MIN_VISIBLE_ALPHA,
  };
}

export const READOUT_OFFSET_PX = 14;
const EDGE_PX = 4;

// Top-left of a `boxW` × `boxH` tooltip for a cursor at (x, y) inside an
// `areaW` × `areaH` map: below-right of the cursor, flipped to the other side
// on either axis when it would run off the edge.
export function readoutPlacement(
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  areaW: number,
  areaH: number,
  offset: number = READOUT_OFFSET_PX
): { left: number; top: number } {
  let left = x + offset;
  if (left + boxW > areaW - EDGE_PX) left = x - offset - boxW;
  let top = y + offset;
  if (top + boxH > areaH - EDGE_PX) top = y - offset - boxH;
  return {
    left: Math.max(EDGE_PX, Math.min(left, areaW - boxW - EDGE_PX)),
    top: Math.max(EDGE_PX, Math.min(top, areaH - boxH - EDGE_PX)),
  };
}
