import {
  intensityLabel,
  LUT_MIN_DBZ,
  LUT_SIZE,
  LUT_STEPS_PER_DBZ,
  paletteLut,
  type RadarPaletteId,
} from './radarPalettes';

// Pure helpers for the radar hover readout (RadarHoverReadout): what it says
// for a reading, the colour the map paints it in, and where the tooltip sits
// beside the cursor.

// Below this palette alpha (of 255) the echo is effectively invisible on the
// map — the recoloured ramps fade in from nothing (Classic rain from 8 dBZ,
// Vivid from 6, snow from 2) — so the readout stays hidden rather than
// naming rain nobody can see.
const MIN_VISIBLE_ALPHA = 24;

export interface EchoSwatch {
  css: string; // the palette colour at full strength, for the readout's dot
  visible: boolean; // painted visibly on the map at all
}

// `snowRamp`: the reading is painted in the snow ramp, i.e. it is snow and
// snow is coloured separately (otherwise snow is painted as rain).
export function echoSwatch(palette: RadarPaletteId, dbz: number, snowRamp: boolean): EchoSwatch {
  const lut = paletteLut(palette);
  const table = snowRamp ? lut.snow : lut.rain;
  const i = Math.min(LUT_SIZE - 1, Math.max(0, Math.round((dbz - LUT_MIN_DBZ) * LUT_STEPS_PER_DBZ)));
  const k = i * 4;
  return {
    css: `rgb(${table[k]}, ${table[k + 1]}, ${table[k + 2]})`,
    visible: table[k + 3] >= MIN_VISIBLE_ALPHA,
  };
}

export interface RadarReadout {
  label: string; // "Heavy rain", "Light snow"
  dbz: number; // whole dBZ, as shown
  css: string; // dot colour
}

// The readout for a probed reading, or null where the map shows nothing.
// Snow is named as snow either way; its dot and whether it shows at all
// follow the ramp it's actually painted in (`snowPref`: the "colour snow
// separately" setting). The label comes from the shown, rounded value so
// "35 dBZ" never reads as the band below.
export function radarReadout(
  palette: RadarPaletteId,
  reading: { dbz: number; snow: boolean },
  snowPref: boolean
): RadarReadout | null {
  const swatch = echoSwatch(palette, reading.dbz, reading.snow && snowPref);
  if (!swatch.visible) return null;
  const dbz = Math.round(reading.dbz);
  return { label: intensityLabel(dbz, reading.snow), dbz, css: swatch.css };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export const READOUT_OFFSET_PX = 14;
const EDGE_PX = 4;

// Top-left of a `boxW` × `boxH` tooltip for a cursor at (x, y) inside `area`
// (all in one coordinate space). Below-right of the cursor by default, else
// the first other corner — above-right, below-left, above-left — that fits
// inside the area and isn't `blocked` (the timeline dock, legend cards,
// another tooltip). With no free corner it flips away from the edges it would
// run off and stays inside the area.
export function readoutPlacement(
  x: number,
  y: number,
  boxW: number,
  boxH: number,
  area: Box,
  blocked: (b: Box) => boolean = () => false,
  offset: number = READOUT_OFFSET_PX
): { left: number; top: number } {
  const right = x + offset;
  const below = y + offset;
  const left = x - offset - boxW;
  const above = y - offset - boxH;
  for (const [l, t] of [
    [right, below],
    [right, above],
    [left, below],
    [left, above],
  ]) {
    const b = { left: l, top: t, right: l + boxW, bottom: t + boxH };
    const inside =
      b.left >= area.left + EDGE_PX &&
      b.top >= area.top + EDGE_PX &&
      b.right <= area.right - EDGE_PX &&
      b.bottom <= area.bottom - EDGE_PX;
    if (inside && !blocked(b)) return { left: l, top: t };
  }
  const l = right + boxW > area.right - EDGE_PX ? left : right;
  const t = below + boxH > area.bottom - EDGE_PX ? above : below;
  return {
    left: Math.max(area.left + EDGE_PX, Math.min(l, area.right - boxW - EDGE_PX)),
    top: Math.max(area.top + EDGE_PX, Math.min(t, area.bottom - boxH - EDGE_PX)),
  };
}

// The corner of the cursor HurricaneTooltip occupies (viewport px): 16 px
// below-right, flipped left/up within 240/170 px of the window's right/bottom
// edge, exactly as it places itself. Open-ended on its far sides so the
// readout keeps to a different corner whatever the card's height.
export function hurricaneTooltipZone(x: number, y: number, viewW: number, viewH: number): Box {
  const flipX = x > viewW - 240;
  const flipY = y > viewH - 170;
  return {
    left: flipX ? -Infinity : x,
    right: flipX ? x : Infinity,
    top: flipY ? -Infinity : y,
    bottom: flipY ? y : Infinity,
  };
}
