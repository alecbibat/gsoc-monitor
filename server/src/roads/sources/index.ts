import type { RoadSource } from '../service';
import { arizonaWzdxSource } from './arizona';
import { caltransD9Source } from './caltrans';
import { npsRoadSource } from './nps';
import { deathValleyRoadSource, glacierRoadSource, yellowstoneRoadSource } from './parkRoads';

/**
 * Every road-closure feed the layer draws from, all keyless:
 *   in the parks   — Yellowstone, Glacier and Death Valley's own road-status
 *                    maps; the NPS Data API's road events (parks that publish)
 *   access roads   — Caltrans in Inyo County (CA-190, US-395), Arizona DOT
 *                    work zones (I-40, US-180, SR-64)
 * Grand Canyon, Rocky Mountain and Mount Rushmore have no keyless feed of
 * their own; their closures come through the NPS alerts (popups and panel).
 */
export const ROAD_SOURCES: RoadSource[] = [
  yellowstoneRoadSource,
  glacierRoadSource,
  deathValleyRoadSource,
  npsRoadSource,
  caltransD9Source,
  arizonaWzdxSource,
];
