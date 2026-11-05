// Park webcams: a curated catalog (webcams/catalog.ts) served to the browser
// through the image proxy in webcams/proxy.ts. Mirrored in
// client/src/types/index.ts.

export type WebcamKind = 'image' | 'stream';

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
  /** For `stream` cameras: an embeddable player URL (e.g. a YouTube embed). */
  embedUrl?: string;
  lat: number;
  lon: number;
  /** The position is the named place the camera shows, not a surveyed mount. */
  approxLocation?: boolean;
  /** How often the operator replaces the image, in seconds (best known). */
  refreshSec: number;
  /** Sent as the Referer when the host only serves the image to its own pages. */
  referer?: string;
  /** Shown under the image, e.g. what the camera faces. */
  note?: string;
}

/** What the last proxy fetch of a camera's image found. */
export interface WebcamStatus {
  ok: boolean;
  /** When the operator last replaced the image (Last-Modified), ISO. */
  imageUpdated: string | null;
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
  lat: number;
  lon: number;
  approxLocation: boolean;
  refreshSec: number;
  /** The proxied image, for `image` cameras. */
  imagePath: string | null;
  note: string | null;
  status: WebcamStatus | null;
}

export interface WebcamsFeed {
  cams: WebcamInfo[];
  fetchedAt: string;
}
