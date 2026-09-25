// Lightning: a persistent server-side Blitzortung collector that keeps EVERY
// strike of the last 24 h (store.ts), persists them to Postgres (persist.ts)
// so a restart or deploy loses at most the last unsaved minute of what was
// collected (the time no collector ran is lost too, and flagged as blind), and
// serves the display field, near-location counts and collector health under
// /api/lightning.
//
// This module holds the process singleton; service.ts does the wiring.

import { pool } from '../db';
import { syntheticRateFromEnv } from './collector';
import { createLightningRouter } from './routes';
import { type LightningService, createLightningService } from './service';

let service: LightningService | null = null;

/** Start collecting (immediately), restore history in the background, start the timers. Idempotent. */
export function initLightning(): void {
  if (service) return;
  service = createLightningService({ db: pool, syntheticRate: syntheticRateFromEnv() });
  service.start();
}

/**
 * SIGTERM: phase 1 flushes everything now and keeps collecting; phase 2 (when
 * serverClosed resolves, or 20 s at the latest) stops the collector and makes
 * one final flush bounded at 3 s. Idempotent; resolves within ~23 s.
 */
export function shutdownLightning(serverClosed: Promise<void>): Promise<void> {
  return service ? service.shutdown(serverClosed) : Promise.resolve();
}

const router = createLightningRouter(() => service?.ctx ?? null);
export default router;
