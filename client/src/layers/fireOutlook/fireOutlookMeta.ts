// NWCG 7-Day Significant Fire Potential styling — the official renderer palette:
// significant-fire-potential types override the fuel-dryness shading.
export interface OutlookStyle {
  hex: string;
  label: string;
  sig: boolean; // a significant-fire-potential category (Critical/Ignition)
}

export function outlookStyle(dryness: number | null, type: string | null): OutlookStyle {
  if (type === 'IGNITION') return { hex: '#ff0000', label: 'Ignition', sig: true };
  if (type === 'CRITICAL') return { hex: '#ff8c00', label: 'Critical', sig: true };
  switch (dryness) {
    case 3:
      return { hex: '#d9b46f', label: 'Very dry fuels', sig: false };
    case 2:
      return { hex: '#ffff40', label: 'Dry fuels', sig: false };
    case 1:
      return { hex: '#5fb336', label: 'Normal fuels', sig: false };
    default:
      return { hex: '#9c9c9c', label: 'No data', sig: false };
  }
}

export function drynessLabel(d: number | null): string {
  return d === 3 ? 'Very dry' : d === 2 ? 'Dry' : d === 1 ? 'Normal' : '—';
}

export const OUTLOOK_LEGEND: Array<{ hex: string; label: string }> = [
  { hex: '#ff0000', label: 'Sig. fire potential — Ignition' },
  { hex: '#ff8c00', label: 'Sig. fire potential — Critical' },
  { hex: '#d9b46f', label: 'Very dry fuels' },
  { hex: '#ffff40', label: 'Dry fuels' },
  { hex: '#5fb336', label: 'Normal fuels' },
];

// "YYYY-MM-DD" → "Mon, Jun 30" (parsed as UTC so the calendar day can't shift).
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtOutlookDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return iso;
  return `${WD[dt.getUTCDay()]}, ${MO[m - 1]} ${d}`;
}
