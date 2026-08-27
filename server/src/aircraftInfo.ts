// Static airframe metadata for the tracked tails: make/model/operator from
// adsbdb.com and a photo from the Planespotters public API. Both are free,
// keyless community services; an airframe's identity never changes, so one
// successful lookup per tail is essentially permanent (callers cache and
// persist it, with a slow refresh in case a photo or owner changes).

export interface AircraftPhoto {
  /** Direct thumbnail URL (t.plnspttrs.net — hotlinking is the API's purpose). */
  src: string;
  /** Photo page on planespotters.net — attribution requires linking to it. */
  link: string;
  photographer: string;
}

export interface AircraftInfo {
  manufacturer: string | null;
  /** Marketing model name, e.g. "Citation Excel". */
  model: string | null;
  /** ICAO type designator, e.g. "C56X". */
  icaoType: string | null;
  /** Registered owner/operator from the registry. */
  owner: string | null;
  photo: AircraftPhoto | null;
  fetchedAt: number;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Parse adsbdb's aircraft envelope: `{ response: { aircraft: {...} } }`.
 * Unknown aircraft come back as `{ response: "unknown aircraft" }` (HTTP 404);
 * both that and any unexpected shape return null.
 */
export function parseAdsbdbAircraft(
  json: unknown
): Pick<AircraftInfo, 'manufacturer' | 'model' | 'icaoType' | 'owner'> | null {
  const response = (json as { response?: unknown } | null)?.response;
  if (!response || typeof response !== 'object') return null;
  const a = (response as { aircraft?: unknown }).aircraft;
  if (!a || typeof a !== 'object') return null;
  const rec = a as Record<string, unknown>;
  const parsed = {
    manufacturer: str(rec.manufacturer),
    model: str(rec.type),
    icaoType: str(rec.icao_type),
    owner: str(rec.registered_owner),
  };
  return parsed.manufacturer || parsed.model || parsed.icaoType || parsed.owner ? parsed : null;
}

/**
 * Parse the Planespotters pub API's photo list, keeping the first photo's
 * large thumbnail. `{ photos: [] }` (no photo of this airframe) returns null.
 */
export function parsePlanespottersPhoto(json: unknown): AircraftPhoto | null {
  const photos = (json as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const p = photos[0] as Record<string, unknown>;
  const src =
    str((p.thumbnail_large as Record<string, unknown> | undefined)?.src) ??
    str((p.thumbnail as Record<string, unknown> | undefined)?.src);
  const link = str(p.link);
  if (!src || !link) return null;
  return { src, link, photographer: str(p.photographer) ?? 'unknown' };
}

async function getJson(url: string, userAgent: string): Promise<unknown> {
  const r = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Look up one registration against both services. Partial results are fine
 * (registry data without a photo, or vice versa); null means neither source
 * answered, so the caller should retry later rather than cache the miss.
 */
export async function fetchAircraftInfo(
  reg: string,
  userAgent: string
): Promise<AircraftInfo | null> {
  const [registry, photos] = await Promise.allSettled([
    getJson(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(reg)}`, userAgent),
    getJson(`https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(reg)}`, userAgent),
  ]);
  const meta = registry.status === 'fulfilled' ? parseAdsbdbAircraft(registry.value) : null;
  const photo = photos.status === 'fulfilled' ? parsePlanespottersPhoto(photos.value) : null;
  if (!meta && !photo) return null;
  return {
    manufacturer: meta?.manufacturer ?? null,
    model: meta?.model ?? null,
    icaoType: meta?.icaoType ?? null,
    owner: meta?.owner ?? null,
    photo,
    fetchedAt: Date.now(),
  };
}
