import { getRadarLut } from './palettes';

// Precipitation intensity key, built from the same LUT the tiles are painted
// with so it can never drift from the map.
//
// The registry requires legends to be store-free (they render on the operator
// app and on the anonymous share page alike), so this shows the default Storm
// ramp rather than following the palette picker. That is the ramp that ships,
// and the alternatives are the same intensity scale in other hues.
const MIN_DBZ = 5;
const MAX_DBZ = 70;
const STEPS = 48;

// The palette carries per-pixel alpha — light rain is deliberately airy — so
// the swatches are composited over the panel's dark ground to read the way
// they actually do over the globe.
const BACKDROP = [12, 16, 22];

function swatches(): string[] {
  const lut = getRadarLut('storm').rain;
  const out: string[] = [];
  for (let i = 0; i < STEPS; i++) {
    const dbz = MIN_DBZ + ((MAX_DBZ - MIN_DBZ) * i) / (STEPS - 1);
    const m = Math.max(0, Math.min(127, Math.round(dbz + 32)));
    const a = lut[m * 4 + 3] / 255;
    const mix = (channel: number, ground: number) =>
      Math.round(lut[m * 4 + channel] * a + ground * (1 - a));
    out.push(`rgb(${mix(0, BACKDROP[0])}, ${mix(1, BACKDROP[1])}, ${mix(2, BACKDROP[2])})`);
  }
  return out;
}

export function RadarLegend() {
  const ramp = swatches();
  return (
    <div className="pt-1">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
        Reflectivity (dBZ)
      </div>
      <div className="flex h-3 overflow-hidden rounded-sm ring-1 ring-white/10">
        {ramp.map((color, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-white/40">
        <span>5</span>
        <span>20</span>
        <span>35</span>
        <span>50</span>
        <span>70+</span>
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-white/25">
        <span>light</span>
        <span>heavy</span>
      </div>
    </div>
  );
}
