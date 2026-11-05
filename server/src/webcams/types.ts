// Park webcams: a curated catalog (webcams/catalog.ts) served to the browser
// through the image proxy in webcams/proxy.ts. Mirrored in
// client/src/types/index.ts.

/**
 * image  — a still the operator refreshes at a fixed URL (proxied);
 * stream — live video in the operator's embeddable player;
 * link   — shown only on the operator's own site (its terms rule out embedding).
 */
export type WebcamKind = 'image' | 'stream' | 'link';

/** One camera, as curated. */
export interface WebcamDef {
  /** Stable slug, e.g. 'yell-old-faithful'. */
  id: string;
  parkCode: string;
  name: string;
  /** Who runs it: 'NPS', 'Yellowstone Forever', 'USGS', … */
  operator: string;
  /** The public page the camera lives on. */
  pageUrl: string;
  kind: WebcamKind;
  /** For `image` cameras: the still that the operator refreshes in place. */
  imageUrl?: string;
  /**
   * The operator's own embeddable live player (https). Required for `stream`
   * cameras; on an `image` camera it adds a "Live video" view beside the still.
   */
  embedUrl?: string;
  /**
   * Bare page margin (px) the embed page leaves around its player: the panel
   * crops it off. Pixelcaster's page keeps the browser's default 8 px, white.
   */
  embedMarginPx?: number;
  lat: number;
  lon: number;
  /** The position is the named place the camera shows, not a surveyed mount. */
  approxLocation?: boolean;
  /** How often the operator replaces the image, in seconds (best known). */
  refreshSec: number;
  /** Sent as the Referer when the host only serves the image to its own pages. */
  referer?: string;
  /** Add a timestamp query to each fetch: the host's CDN otherwise serves hours-old frames. */
  bustCache?: boolean;
  /**
   * The host serves its images to browsers but turns away servers (bot
   * protection): the viewer's browser loads it straight from the host, as the
   * park's own webcam pages do, and the proxy never fetches it. No freshness
   * tracking for these.
   */
  browserDirect?: boolean;
  /**
   * False when the host's Last-Modified isn't the upload time (it re-stamps an
   * unchanged file, or stamps every response with the request time): the age
   * then comes only from watching the bytes change.
   */
  trustLastModified?: boolean;
  /** The camera prints its capture time on the image. */
  timeOnImage?: boolean;
  /** Shown under the image, e.g. what the camera faces. */
  note?: string;
}

/** What the last proxy fetch of a camera's image found. */
export interface WebcamStatus {
  ok: boolean;
  /** When the operator last replaced the image, ISO (Last-Modified, or a change the server saw); null = unknown. */
  imageUpdated: string | null;
  /** Since when the server has seen these exact bytes, ISO. */
  unchangedSince: string | null;
  /** When the server last fetched it, ISO. */
  checkedAt: string | null;
  error: string | null;
}

/** One camera, as the browser sees it. */
export interface WebcamInfo {
  id: string;
  parkCode: string;
  park: string;
  name: string;
  operator: string;
  pageUrl: string;
  kind: WebcamKind;
  embedUrl: string | null;
  /** Page margin around the embed's player to crop off, px (0 = none). */
  embedMarginPx: number;
  lat: number;
  lon: number;
  approxLocation: boolean;
  refreshSec: number;
  /** The proxied image, for `image` cameras. */
  imagePath: string | null;
  /** For browser-direct cameras: the host's own image URL, loaded by the browser (null otherwise). */
  directUrl: string | null;
  /** Add a timestamp to directUrl on each load (the host's CDN caches stale frames). */
  directBustCache: boolean;
  timeOnImage: boolean;
  note: string | null;
  status: WebcamStatus | null;
}

export interface WebcamsFeed {
  cams: WebcamInfo[];
  fetchedAt: string;
}
