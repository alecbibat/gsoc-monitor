import { api } from '../api/client';
import { fetchLightningNear, LightningHttpError } from '../api/lightningApi';
import type { LightningHistoryResponse } from '../types';
import type { LightningNearResponse } from '../types/lightning';
import { buildLightningSection, legacyLightningSection, type LightningSectionResult } from './lightningSection';
import type { RiskTarget } from './riskTypes';

// ── Lightning input for the wildfire report ──────────────────────────────────
// /near first: exact server-side counts, the nearest strike over everything
// stored, and map points. A server from before /near existed gets the legacy
// radius-filtered history instead, so a client deployed ahead of (or rolled
// back behind) its server still produces a lightning section.

/**
 * `receivedAt` is the client clock when the response arrived. Paired with the
 * server's response-time clock it removes the skew for the map; the time the
 * report later spends waiting on other feeds must not age the strikes.
 */
export type LightningFeed =
  | { kind: 'near'; near: LightningNearResponse; receivedAt: number }
  | { kind: 'legacy'; history: LightningHistoryResponse; receivedAt: number };

/**
 * An older server has no /near route. Express 404s it only when there is no
 * client build to serve; in production the SPA fallback answers 200 with
 * index.html, so the JSON parse failing is the same "no such route" signal.
 */
const isMissingRoute = (e: unknown) =>
  (e instanceof LightningHttpError && e.status === 404) || e instanceof SyntaxError;

export async function fetchLightningFeed(
  target: Pick<RiskTarget, 'lat' | 'lon'>,
  signal?: AbortSignal
): Promise<LightningFeed> {
  try {
    const near = await fetchLightningNear({
      lat: target.lat,
      lon: target.lon,
      // Past the 110 mi map view, so strikes at its edges still draw.
      radiusMi: 130,
      hours: 24,
      maxPoints: 6000,
      signal,
    });
    return { kind: 'near', near, receivedAt: Date.now() };
  } catch (e) {
    if (signal?.aborted || !isMissingRoute(e)) throw e;
    const history = await api.lightningHistory(1440, { lat: target.lat, lon: target.lon, radiusMi: 130 });
    return { kind: 'legacy', history, receivedAt: Date.now() };
  }
}

export function lightningSectionFromFeed(feed: LightningFeed, target: RiskTarget): LightningSectionResult {
  return feed.kind === 'near'
    ? buildLightningSection(feed.near, feed.receivedAt)
    : legacyLightningSection(feed.history, target, feed.receivedAt);
}
