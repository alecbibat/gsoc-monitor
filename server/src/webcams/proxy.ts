import type { WebcamDef, WebcamStatus } from './types';

// ── Webcam image proxy ───────────────────────────────────────────────────────
// Every camera image reaches the browser through the server, for four reasons:
// one fetch per camera per refresh serves every viewer; http-only cameras come
// through on the dashboard's https origin; hosts that only serve their images
// to their own pages get the Referer they expect; and the server can see how
// old each image is (Last-Modified), so a frozen camera is flagged instead of
// passing for live. Only cameras in the catalog are proxied — never a URL a
// client supplies.

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 gsoc-monitor/1.0';
const TIMEOUT_MS = 15_000;
/** Large panoramas run to a few MB; anything bigger isn't a webcam still. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface CachedImage {
  body: Buffer;
  contentType: string;
  /** Last-Modified from the operator, epoch ms (null when the host doesn't say). */
  imageUpdated: number | null;
  fetchedAt: number;
}

const cache = new Map<string, CachedImage>();
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

async function fetchImage(cam: WebcamDef, now: () => number): Promise<CachedImage> {
  if (!cam.imageUrl) throw new Error('not an image camera');
  const res = await fetch(cam.imageUrl, {
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
  const lm = Date.parse(res.headers.get('last-modified') ?? '');
  return { body, contentType, imageUpdated: Number.isNaN(lm) ? null : lm, fetchedAt: now() };
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
      checkedAt: new Date(fresh.fetchedAt).toISOString(),
      error: null,
    });
    return { ...fresh, stale: false };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    note(cam.id, {
      ok: false,
      imageUpdated: hit?.imageUpdated != null ? new Date(hit.imageUpdated).toISOString() : null,
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
}
