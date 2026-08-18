import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { startVisiblePolling } from '../../lib/poll';
import { useShipsStatus } from './shipsStore';
import type { ShipState, ShipsResponse } from '../../types';

// How often to re-read the fleet feed. AIS positions for these ships refresh on
// the order of minutes (CruiseMapper scrape every 2h, live AIS whenever a ship
// is in receiver range), so a 2-minute poll is already faster than the data.
const REFRESH_MS = 2 * 60_000;

export interface FleetPositions {
  ships: ShipState[];
  /** True only before the first response — later refreshes keep the old data. */
  loading: boolean;
  /** Set when the feed itself failed or reported no upstream key. */
  error: string | null;
  /** Feed's own updated stamp (epoch ms), null until a response lands. */
  updated: number | null;
}

/**
 * Live Windstar fleet positions for surfaces that need them without owning the
 * globe's ships layer — the crisis vessel picker and the public share page.
 *
 * Results are written into the shared ships store as well, so a fly-to from the
 * sidebar roster can use them, but the loading/error state is kept local: the
 * globe layer owns the store's status fields and its own "0/7 in range" text.
 */
export function useFleetPositions(enabled: boolean, refreshMs = REFRESH_MS): FleetPositions {
  const ships = useShipsStatus((s) => s.ships);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Re-entering the loading state matters when `enabled` flips on later (the
    // vessel picker opens): without it the first fetch would render as "no
    // position reported" instead of "loading".
    setLoading(true);
    let alive = true;
    const stop = startVisiblePolling(() => {
      void (async () => {
        try {
          const data: ShipsResponse = await api.ships();
          if (!alive) return;
          useShipsStatus.getState().setShips(data.ships);
          setUpdated(data.updated ?? null);
          // A feed with no upstream key returns 200 with an empty list — that
          // is "no positions available", not "every ship is missing", and the
          // vessel cards must say so rather than showing seven blanks.
          setError(
            data.source === 'no-key'
              ? 'Position feed not configured'
              : data.source === 'error'
                ? 'Position feed unavailable'
                : null
          );
        } catch {
          if (alive) setError('Position feed unavailable');
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }, refreshMs);
    return () => {
      alive = false;
      stop();
    };
  }, [enabled, refreshMs]);

  return { ships: enabled ? ships : [], loading: enabled && loading, error, updated };
}
