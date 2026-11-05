import { createHash } from 'crypto';
import type { WebcamDef, WebcamStatus } from './types';

// ── Webcam image proxy ───────────────────────────────────────────────────────
// Every camera image reaches the browser through the server, for four reasons:
// one fetch per camera per refresh serves every viewer; http-only cameras come
// through on the dashboard's https origin; hosts that only serve their images
// to their own pages get the Referer they expect; and the server can see how
// old each image is (Last-Modified), so a frozen camera is flagged instead of
// passing for live. Only cameras in the catalog are proxied — never a URL a
// client supplies.
//
// Last-Modified alone can't be trusted for that: some hosts re-stamp an
// unchanged file every few minutes, others stamp every response with the
// request time. So the proxy also fingerprints each image and remembers since
// when it has seen the same bytes — a picture that hasn't changed for longer
// than the camera ever goes without one is stale, whatever the headers say.

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 gsoc-monitor/1.0';
const TIMEOUT_MS = 15_000;
/** Large panoramas run to a few MB; anything bigger isn't a webcam still. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface CachedImage {
  body: Buffer;
  contentType: string;
  /**
   * When the operator replaced the image, epoch ms: its Last-Modified where
   * that's trusted, else the moment the server saw the bytes change; null
   * when neither is known.
   */
  imageUpdated: number | null;
  /** Since when the server has seen these exact bytes, epoch ms. */
  unchangedSince: number;
  fetchedAt: number;
}

interface Seen {
  hash: string;
  since: number;
  /** When the server saw the bytes change to these; null if they were already there on its first look. */
  changedAt: number | null;
}

const cache = new Map<string, CachedImage>();
const seenBytes = new Map<string, Seen>();
const inflight = new Map<string, Promise<CachedImage>>();
const statuses = new Map<string, WebcamStatus>();

/** How long one fetch of a camera's image is reused: half its refresh, 20 s – 2 min. */
export function imageTtlMs(cam: Pick<WebcamDef, 'refreshSec'>): number {
  return Math.min(120_000, Math.max(20_000, (cam.refreshSec * 1000) / 2));
}

export function webcamStatus(id: string): WebcamStatus | null {
  return statuses.get(id) ?? null;
}

function note(id: string, s: WebcamStatus): void {
  statuses.set(id, s);
}

/** The URL to fetch: with a cache-busting timestamp when the host's CDN needs one. */
export function imageFetchUrl(cam: Pick<WebcamDef, 'imageUrl' | 'bustCache'>, t: number): string {
  const url = cam.imageUrl ?? '';
  return cam.bustCache ? `${url}${url.includes('?') ? '&' : '?'}_=${t}` : url;
}

async function fetchImage(cam: WebcamDef, now: () => number): Promise<CachedImage> {
  if (!cam.imageUrl) throw new Error('not an image camera');
  const res = await fetch(imageFetchUrl(cam, now()), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8',
      ...(cam.referer ? { Referer: cam.referer } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error(`not an image (${contentType || 'no content-type'})`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error('image too large');
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length === 0) throw new Error('empty image');
  if (body.length > MAX_IMAGE_BYTES) throw new Error('image too large');
  const t = now();
  const hash = createHash('sha1').update(body).digest('hex');
  const prev = seenBytes.get(cam.id);
  const seen: Seen =
    prev && prev.hash === hash ? prev : { hash, since: t, changedAt: prev ? t : null };
  seenBytes.set(cam.id, seen);
  const lm = Date.parse(res.headers.get('last-modified') ?? '');
  const trusted = cam.trustLastModified !== false && !Number.isNaN(lm);
  return {
    body,
    contentType,
    imageUpdated: trusted ? lm : seen.changedAt,
    unchangedSince: seen.since,
    fetchedAt: t,
  };
}

export interface ProxiedImage extends CachedImage {
  /** Served from the last good copy because the refresh failed. */
  stale: boolean;
}

/**
 * The camera's current image: the cached copy while it's fresh, otherwise one
 * shared upstream fetch. A failed refresh falls back to the last good copy
 * (flagged stale); with none, it throws.
 */
export async function getWebcamImage(cam: WebcamDef, now: () => number = Date.now): Promise<ProxiedImage> {
  const hit = cache.get(cam.id);
  if (hit && now() - hit.fetchedAt < imageTtlMs(cam)) return { ...hit, stale: false };
  let pending = inflight.get(cam.id);
  if (!pending) {
    pending = fetchImage(cam, now).finally(() => inflight.delete(cam.id));
    inflight.set(cam.id, pending);
  }
  try {
    const fresh = await pending;
    cache.set(cam.id, fresh);
    note(cam.id, {
      ok: true,
      imageUpdated: fresh.imageUpdated !== null ? new Date(fresh.imageUpdated).toISOString() : null,
      unchangedSince: new Date(fresh.unchangedSince).toISOString(),
      checkedAt: new Date(fresh.fetchedAt).toISOString(),
      error: null,
    });
    return { ...fresh, stale: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    note(cam.id, {
      ok: false,
      imageUpdated: hit?.imageUpdated != null ? new Date(hit.imageUpdated).toISOString() : null,
      unchangedSince: hit ? new Date(hit.unchangedSince).toISOString() : null,
      checkedAt: new Date(now()).toISOString(),
      error,
    });
    if (hit) return { ...hit, stale: true };
    throw new Error(error);
  }
}

/** Test hook: forget every cached image and status. */
export function resetWebcamCache(): void {
  cache.clear();
  inflight.clear();
  statuses.clear();
  seenBytes.clear();
}
