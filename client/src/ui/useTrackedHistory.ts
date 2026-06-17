import { useEffect, useRef, useState } from 'react';
import { useAlertsStatus } from '../layers/alerts/alertsStore';
import { useFlightsStatus } from '../layers/flights/flightsStore';
import { useHurricanesStatus } from '../layers/hurricanes/hurricanesStore';
import { useFiresStatus } from '../layers/fires/firesStore';
import { useShipsStatus } from '../layers/ships/shipsStore';
import { useSatellitesStatus } from '../layers/satellites/satellitesStore';

const SAMPLE_INTERVAL_MS = 5_000;
const MAX_SAMPLES = 40; // ~3.3 min of history

// Aggregates live "items tracked" counts from every layer's status store and
// keeps a rolling sample history for the sparkline. Ships and satellites may
// count 0 when inactive, which is correct — the counter reflects what is
// currently visible on the map.
export function useTrackedHistory(): { total: number; history: number[] } {
  const a = useAlertsStatus((s) => s.count);
  const f = useFlightsStatus((s) => s.count);
  const h = useHurricanesStatus((s) => s.count);
  const fi = useFiresStatus((s) => s.count);
  const sh = useShipsStatus((s) => s.count);
  const sat = useSatellitesStatus((s) => s.count);

  const total = a + f + h + fi + sh + sat;
  const totalRef = useRef(total);
  totalRef.current = total;

  const historyRef = useRef<number[]>([]);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    // Take an initial sample right away so the sparkline isn't blank on mount.
    historyRef.current = [totalRef.current];
    setHistory([...historyRef.current]);

    const id = setInterval(() => {
      historyRef.current = [...historyRef.current.slice(-(MAX_SAMPLES - 1)), totalRef.current];
      setHistory([...historyRef.current]);
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(id);
  }, []); // intentionally no deps — reads totalRef live

  return { total, history };
}
