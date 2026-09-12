// The palette RainViewer's tiles actually arrive in, lightest echo first,
// sampled from live tiles (2026-09). Echo edges are deep blue, brightening to
// cyan through moderate rain, then yellow → orange → red for heavy cells and
// pink for the most intense cores. Drives the legend only — the tiles are
// rendered exactly as served.
export const RADAR_PALETTE: string[] = [
  '#004768',
  '#006295',
  '#007fb4',
  '#00a3e0',
  '#51c5e8',
  '#88ddee',
  '#ffee00',
  '#ffaa00',
  '#ff4400',
  '#c10000',
  '#760000',
  '#ffaaff',
];
