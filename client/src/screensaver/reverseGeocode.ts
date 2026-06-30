// Reverse geocode a lat/lon via BigDataCloud (free, no key required). Returns a
// short label like "Portland, OR", "Caribbean Sea", etc. — null over open ocean
// or on any failure. Shared by the pins + hover context minimaps.
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal },
    );
    if (!r.ok || signal.aborted) return null;
    const d = (await r.json()) as {
      city?: string;
      locality?: string;
      principalSubdivisionCode?: string;
      countryCode?: string;
      countryName?: string;
    };
    const parts: string[] = [];
    if (d.city) parts.push(d.city);
    else if (d.locality) parts.push(d.locality);
    if (d.countryCode === 'US' || d.countryCode === 'CA') {
      if (d.principalSubdivisionCode) parts.push(d.principalSubdivisionCode);
    } else if (d.countryName) {
      parts.push(d.countryName);
    }
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}
