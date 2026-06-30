import { create } from 'zustand';

// NOAA/WPC Quantitative Precipitation Forecast (QPF) accumulation overlay.
// The WPC QPF MapServer exposes the same forecast over several accumulation
// windows as separate sublayers; we let the user pick the window and drive the
// imagery layer from it.
export type QpfPeriod = '24h' | '48h' | '72h' | '5day';

export const QPF_PERIODS: QpfPeriod[] = ['24h', '48h', '72h', '5day'];

// WPC QPF MapServer sublayer id per accumulation window.
export const QPF_LAYER: Record<QpfPeriod, number> = {
  '24h': 1, // QPF 24 Hour — Day 1
  '48h': 8, // QPF 48 Hour — Day 1–2
  '72h': 9, // QPF 72 Hour — Day 1–3
  '5day': 10, // QPF 120 Hour — Day 1–5 total
};

// Short label for the toggle buttons.
export const QPF_PERIOD_SHORT: Record<QpfPeriod, string> = {
  '24h': '24h',
  '48h': '48h',
  '72h': '72h',
  '5day': '5-day',
};

// Longer label for the sidebar status line.
export const QPF_PERIOD_LABEL: Record<QpfPeriod, string> = {
  '24h': 'Day 1 · 24-hour total',
  '48h': 'Day 1–2 · 48-hour total',
  '72h': 'Day 1–3 · 72-hour total',
  '5day': 'Day 1–5 · 5-day total',
};

// The exact WPC QPF colour ramp (inches), read from the MapServer's renderer so
// the legend matches the rendered tiles precisely.
export const QPF_LEGEND: Array<{ inches: number; rgb: [number, number, number] }> = [
  { inches: 0.01, rgb: [127, 255, 0] },
  { inches: 0.1, rgb: [0, 255, 0] },
  { inches: 0.25, rgb: [8, 139, 0] },
  { inches: 0.5, rgb: [16, 78, 139] },
  { inches: 0.75, rgb: [30, 144, 255] },
  { inches: 1, rgb: [0, 178, 238] },
  { inches: 1.25, rgb: [0, 238, 238] },
  { inches: 1.5, rgb: [137, 104, 205] },
  { inches: 1.75, rgb: [145, 44, 238] },
  { inches: 2, rgb: [139, 0, 139] },
  { inches: 2.5, rgb: [139, 0, 0] },
  { inches: 3, rgb: [255, 0, 0] },
  { inches: 4, rgb: [238, 64, 0] },
  { inches: 5, rgb: [255, 127, 0] },
  { inches: 7, rgb: [206, 133, 0] },
  { inches: 10, rgb: [255, 215, 0] },
  { inches: 15, rgb: [255, 255, 0] },
  { inches: 20, rgb: [255, 192, 183] },
];

interface PrecipState {
  period: QpfPeriod;
  opacity: number;
  setPeriod: (p: QpfPeriod) => void;
  setOpacity: (o: number) => void;
}

export const usePrecipStore = create<PrecipState>((set) => ({
  period: '72h',
  opacity: 0.75,
  setPeriod: (period) => set({ period }),
  setOpacity: (opacity) => set({ opacity }),
}));
