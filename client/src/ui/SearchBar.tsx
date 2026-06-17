import { useState } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { flyToBoundingBox, flyToLonLat } from '../cesium/flyTo';
import { api } from '../api/client';

interface Result {
  lat: string;
  lon: string;
  display_name: string;
  boundingbox: string[];
}

const LAT_LON_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export function SearchBar() {
  const viewer = useCesiumViewer();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function flyToResult(r: Result) {
    if (!viewer) return;
    const [south, north, west, east] = r.boundingbox.map(Number);
    if (Number.isFinite(south) && Math.abs(north - south) > 0.01) {
      flyToBoundingBox(viewer, west, south, east, north);
    } else {
      flyToLonLat(viewer, Number(r.lon), Number(r.lat));
    }
    setResults([]);
    setQuery(r.display_name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!viewer || !query.trim()) return;
    setError(null);

    const latLonMatch = query.match(LAT_LON_RE);
    if (latLonMatch) {
      flyToLonLat(viewer, Number(latLonMatch[2]), Number(latLonMatch[1]));
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const data = await api.geocode(query);
      if (data.length === 0) {
        setError('No matches found');
        setResults([]);
      } else if (data.length === 1) {
        flyToResult(data[0]);
      } else {
        setResults(data);
      }
    } catch {
      setError('Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative w-full sm:w-80">
      <form onSubmit={handleSubmit} className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search address, lat/long, or place..."
          className="w-full rounded-lg border border-white/10 bg-ink-900/90 px-3 py-2 text-[13px] text-white placeholder:text-white/35 shadow-panel backdrop-blur-sm focus:border-accent/50 focus:outline-none"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-white/40">
            …
          </div>
        )}
      </form>
      {error && <div className="mt-1 px-1 text-[11px] text-accent-danger">{error}</div>}
      {results.length > 0 && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-ink-900/95 shadow-panel">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => flyToResult(r)}
              className="block w-full truncate px-3 py-2 text-left text-[12px] text-white/75 hover:bg-white/10"
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
