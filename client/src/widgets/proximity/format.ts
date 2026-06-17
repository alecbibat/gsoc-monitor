// Small formatting helpers shared by the Property Watch widget and the
// popped-out property detail panel.

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function expiresText(iso: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = t - Date.now();
  if (diff <= 0) return 'expiring';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m left`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h left`;
  return `${Math.round(diff / 86_400_000)}d left`;
}

export function fmtMiles(mi: number): string {
  return mi < 10 ? mi.toFixed(1) : Math.round(mi).toString();
}

// Matches the earthquake layer's magnitude-tier palette.
export function quakeColor(mag: number): string {
  if (mag >= 6) return '#ff5d5d';
  if (mag >= 4.5) return '#ffb84d';
  if (mag >= 2.5) return '#ffe14d';
  return '#52e3a4';
}
