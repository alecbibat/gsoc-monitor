import type * as Cesium from 'cesium';
import { flyToBoundingBox } from '../cesium/flyTo';
import { NPS_PARK_BY_CODE } from './parks';

/** The park's boundary extent with a margin; small units (Mount Rushmore) get a minimum frame. */
export function parkFrame(parkCode: string): [number, number, number, number] | null {
  const park = NPS_PARK_BY_CODE.get(parkCode);
  if (!park) return null;
  const [w, s, e, n] = park.bbox;
  const padLon = Math.max((e - w) * 0.15, 0.12);
  const padLat = Math.max((n - s) * 0.15, 0.08);
  return [w - padLon, s - padLat, e + padLon, n + padLat];
}

export function flyToPark(viewer: Cesium.Viewer, parkCode: string): void {
  const frame = parkFrame(parkCode);
  if (frame && !viewer.isDestroyed()) flyToBoundingBox(viewer, ...frame);
}
