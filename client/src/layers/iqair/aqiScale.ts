// US EPA AQI scale shared by the IQAir layer's badges, details panel, and
// forecast charts. Matches the official AirNow legend (and the colors the
// existing CONUS AQI layer uses), keyed by category number 1–6.

export const CATEGORY_COLOR: Record<number, string> = {
  1: '#00e400', // Good
  2: '#ffff00', // Moderate
  3: '#ff7e00', // Unhealthy for Sensitive Groups
  4: '#ff0000', // Unhealthy
  5: '#8f3f97', // Very Unhealthy
  6: '#7e0023', // Hazardous
};

// Badge text: dark on the light Good/Moderate fills, white elsewhere.
export const TEXT_COLOR: Record<number, string> = {
  1: '#003300',
  2: '#555500',
  3: '#ffffff',
  4: '#ffffff',
  5: '#ffffff',
  6: '#ffffff',
};

export const CATEGORY_STYLE: Record<
  number,
  { bg: string; text: string; label: string; desc: string }
> = {
  1: { bg: 'bg-green-500/20',  text: 'text-green-400',  label: 'Good',                           desc: 'Air quality is satisfactory with little or no risk.' },
  2: { bg: 'bg-yellow-400/20', text: 'text-yellow-300', label: 'Moderate',                       desc: 'Acceptable, but some pollutants may be a concern for sensitive individuals.' },
  3: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Unhealthy for Sensitive Groups', desc: 'Sensitive groups (elderly, children, heart/lung conditions) should limit exposure.' },
  4: { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'Unhealthy',                      desc: 'Everyone may begin to experience health effects.' },
  5: { bg: 'bg-purple-700/20', text: 'text-purple-400', label: 'Very Unhealthy',                 desc: 'Health alert — everyone may experience serious health effects.' },
  6: { bg: 'bg-rose-900/20',   text: 'text-rose-400',   label: 'Hazardous',                      desc: 'Emergency conditions — the entire population is likely to be affected.' },
};

// Map an AQI value to its EPA category number via the official breakpoints.
export function aqiCategory(aqi: number): number {
  if (!Number.isFinite(aqi) || aqi <= 50) return 1;
  if (aqi <= 100) return 2;
  if (aqi <= 150) return 3;
  if (aqi <= 200) return 4;
  if (aqi <= 300) return 5;
  return 6;
}

export function aqiColor(aqi: number): string {
  return CATEGORY_COLOR[aqiCategory(aqi)];
}
