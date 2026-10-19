import { useEffect, useId, useRef, useState } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { cameraFocus, flyToPlace } from '../cesium/flyTo';
import { api } from '../api/client';
import { formatLatLon, parseCoordinates, type LatLon } from '../lib/parseCoordinates';
import type { GeocodePlace, PlaceKind } from '../types';
import { useSearchPin } from './useSearchPin';

// A dropdown row: a geocoder result, or coordinates the box parsed itself.
type Item = Omit<GeocodePlace, 'kind' | 'source'> & { kind: PlaceKind | 'coordinates' };

const KIND_LABEL: Record<Item['kind'], string> = {
  country: 'Country',
  state: 'State / region',
  county: 'County',
  city: 'City',
  locality: 'Neighborhood',
  street: 'Street',
  address: 'Address',
  poi: 'Place',
  other: 'Place',
  coordinates: 'Coordinates',
};

const MIN_SUGGEST_CHARS = 2;
const SUGGEST_DELAY_MS = 200;

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

// One text refines or trims back the other, so rows for one still fit the other.
function related(a: string, b: string | null): boolean {
  if (b === null) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

function coordsItem(c: LatLon): Item {
  return {
    id: `coords:${c.lat},${c.lon}`,
    name: formatLatLon(c),
    context: '',
    category: null,
    lat: c.lat,
    lon: c.lon,
    bbox: null,
    kind: 'coordinates',
    fullMatch: true,
  };
}

const labelFor = (item: Item) => (item.context ? `${item.name}, ${item.context}` : item.name);

/**
 * Google-Maps-style place search: suggestions as you type, biased to what the
 * camera is looking at; Enter flies to the best match (or the highlighted
 * row) and drops a pin on it. Coordinates and map links go straight there.
 */
export function SearchBar() {
  const viewer = useCesiumViewer();
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const pin = useSearchPin(viewer);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  // Dropdown rows, and the (normalized) text they answer.
  const [items, setItems] = useState<Item[]>([]);
  const [itemsFor, setItemsFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The in-flight geocode request; a newer request, a pick or a clear aborts it.
  const requestRef = useRef<AbortController | null>(null);
  // A suggestions fetch waiting out the typing pause. Enter, a pick and a
  // clear cancel it: firing after them it would abort the Enter search.
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by every Enter search, pick and clear, so only the latest search
  // drives the spinner.
  const searchSeqRef = useRef(0);
  // The label a pick wrote into the box: echoing it back isn't a new query.
  const committedRef = useRef<string | null>(null);

  function cancelPending() {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    suggestTimerRef.current = null;
    requestRef.current?.abort();
  }

  // Unmounted (the pins tour drops the top bar): nothing may land later and
  // fly the camera mid-tour.
  useEffect(() => () => cancelPending(), []);

  function onType(value: string) {
    setQuery(value);
    // A highlight belongs to the rows as they were; Enter on edited text
    // shouldn't take a row the user never picked for it.
    setActive(-1);
    // New text supersedes an Enter search still in flight — its answer would
    // otherwise overwrite what's being typed and fly the camera.
    if (searching) {
      requestRef.current?.abort();
      searchSeqRef.current++;
      setSearching(false);
    }
  }

  // Rows answer the text in the box only while it refines or trims back the
  // text they were fetched for. Decided here, at render, not by an effect:
  // rows for other text must never be on screen for a quick ArrowDown + Enter
  // to pick while the new text's suggestions are on their way.
  const text = normalize(query);
  const rowsFit = items.length > 0 && text !== '' && related(text, itemsFor);
  const showList = open && rowsFit;

  function request(q: string, mode: 'suggest' | 'search'): Promise<GeocodePlace[] | null> {
    requestRef.current?.abort();
    const ctrl = new AbortController();
    requestRef.current = ctrl;
    const v = viewerRef.current;
    return api
      .geocode(q, { mode, bias: v ? cameraFocus(v) : null, signal: ctrl.signal })
      .then(({ results }) => (ctrl.signal.aborted ? null : results))
      .catch((err) => {
        if (ctrl.signal.aborted) return null;
        throw err;
      })
      .finally(() => {
        if (requestRef.current === ctrl) requestRef.current = null;
      });
  }

  // Suggestions as you type, after a short pause.
  useEffect(() => {
    const q = normalize(query);
    if (q === committedRef.current) return;
    setError(null);
    if (!q) {
      cancelPending();
      setItems([]);
      setItemsFor(null);
      setOpen(false);
      setActive(-1);
      return;
    }
    const coords = parseCoordinates(q);
    if (coords) {
      cancelPending();
      setItems([coordsItem(coords)]);
      setItemsFor(q);
      setActive(-1);
      setOpen(true);
      return;
    }
    if (q.length < MIN_SUGGEST_CHARS) {
      setOpen(false);
      return;
    }
    suggestTimerRef.current = setTimeout(() => {
      suggestTimerRef.current = null;
      request(q, 'suggest')
        .then((results) => {
          if (!results) return;
          setItems(results);
          setItemsFor(q);
          setActive(-1);
          setOpen(results.length > 0 && document.activeElement === inputRef.current);
        })
        .catch(() => {
          // Best-effort: Enter still runs a full search.
        });
    }, SUGGEST_DELAY_MS);
    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
      suggestTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on typing only
  }, [query]);

  function choose(item: Item, alternatives: Item[] = items) {
    cancelPending();
    searchSeqRef.current++;
    setSearching(false);
    const label = labelFor(item);
    committedRef.current = normalize(label);
    setQuery(label);
    // Keep the other matches: refocusing the box offers them, the pick first.
    setItems([item, ...alternatives.filter((a) => a.id !== item.id)]);
    setItemsFor(committedRef.current);
    setOpen(false);
    setActive(-1);
    setError(null);
    // Hands the keyboard back to the map (and closes a phone's keyboard so
    // the destination is visible).
    inputRef.current?.blur();
    const v = viewerRef.current;
    if (v) flyToPlace(v, item);
    pin.show({ lat: item.lat, lon: item.lon, label: item.name });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = normalize(query);
    if (!q) return;
    if (showList && active >= 0 && items[active]) {
      choose(items[active]);
      return;
    }
    const coords = parseCoordinates(q);
    if (coords) {
      choose(coordsItem(coords));
      return;
    }
    // The dropdown already answers exactly this text: go now, no round trip —
    // as long as its top row accounts for the whole query. Otherwise the full
    // search, which can consult the second geocoder, gets its say.
    const top = itemsFor === q ? items[0] : undefined;
    if (top && (top.fullMatch || q === committedRef.current)) {
      choose(top);
      return;
    }

    cancelPending();
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setError(null);
    try {
      const results = await request(q, 'search');
      if (!results) return; // superseded by more typing, a pick or a clear
      if (results.length === 0) {
        setItems([]);
        setItemsFor(q);
        setOpen(false);
        setError(`No places found for “${q}”`);
        return;
      }
      choose(results[0], results);
    } catch {
      if (seq === searchSeqRef.current) setError('Search is unavailable right now — try again in a moment');
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  }

  function clear() {
    cancelPending();
    searchSeqRef.current++;
    setSearching(false);
    committedRef.current = null;
    setQuery('');
    setItems([]);
    setItemsFor(null);
    setOpen(false);
    setActive(-1);
    setError(null);
    pin.clear();
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (!rowsFit) return;
      e.preventDefault();
      const n = items.length;
      if (!showList) {
        setOpen(true);
        setActive(key === 'ArrowDown' ? 0 : n - 1);
        return;
      }
      setActive((i) => (key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (key === 'Escape') {
      e.preventDefault();
      if (showList) {
        setOpen(false);
        setActive(-1);
      } else {
        inputRef.current?.blur();
      }
    }
  }

  return (
    <div className="relative w-full sm:w-80">
      <form onSubmit={submit} role="search" className="relative">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (items.length > 0 && itemsFor === text) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          placeholder="Search a place, address, business, or lat/long"
          role="combobox"
          aria-label="Search the map"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          className="w-full rounded-lg border border-white/10 bg-ink-900/90 py-2 pl-3 pr-8 text-[13px] text-white placeholder:text-white/35 shadow-panel backdrop-blur-sm focus:border-accent/50 focus:outline-none"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
          {searching ? (
            <div
              className="m-1 h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-accent"
              aria-label="Searching"
            />
          ) : query ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
              aria-label="Clear search"
              title="Clear search"
              className="flex h-6 w-6 items-center justify-center rounded text-[15px] leading-none text-white/40 hover:bg-white/10 hover:text-white/80"
            >
              ×
            </button>
          ) : null}
        </div>
      </form>
      {error && <div className="mt-1 px-1 text-[11px] text-accent-danger">{error}</div>}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-ink-900/95 py-1 shadow-panel backdrop-blur-sm"
        >
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              title={labelFor(item)}
              // mousedown would blur the input (closing this list) before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
              // Move, not enter: a list scrolling under a still pointer
              // shouldn't steal the keyboard highlight.
              onMouseMove={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-white/10' : ''}`}
            >
              <div className="truncate text-[12.5px] text-white/90">{item.name}</div>
              <div className="truncate text-[11px] text-white/45">
                {[item.category ?? KIND_LABEL[item.kind], item.context].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
