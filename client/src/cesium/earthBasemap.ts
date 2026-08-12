// The "Earth" map type: NASA's daily global true-color mosaic from the MODIS
// instruments on Terra (morning orbit, ~10:30 AM local pass) and Aqua
// (afternoon orbit, ~1:30 PM local pass), tiled by NASA GIBS. Unlike the other
// basemaps this one has state — a UTC date and an AM/PM satellite choice — so
// the definition in basemaps.ts builds its provider through here, and
// CesiumGlobe rebuilds the base imagery whenever this store changes (the
// zoom.earth "HD satellite" experience: step through days, toggle passes,
// back through the archive).

import * as Cesium from 'cesium';
import { create } from 'zustand';

// Archive starts: first day each instrument's imagery exists in GIBS.
export const TERRA_START = '2000-02-24'; // AM pass
export const AQUA_START = '2002-07-04'; // PM pass

// GIBS dates daily mosaics by UTC day.
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysUtc(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function clampDate(date: string): string {
  const max = todayUtc();
  if (date < TERRA_START) return TERRA_START;
  if (date > max) return max;
  return date;
}

export type EarthPass = 'am' | 'pm';

interface EarthBasemapState {
  date: string; // YYYY-MM-DD (UTC day)
  pass: EarthPass; // am = Terra, pm = Aqua
  // False until the user picks a date themselves. While false the date is
  // "latest complete mosaic" and freshen() keeps it tracking that as UTC
  // midnights pass on this long-running dashboard; a deliberate date choice
  // pins the view and stops the auto-advance.
  userPinnedDate: boolean;
  setDate: (d: string) => void;
  setPass: (p: EarthPass) => void;
  stepDays: (n: number) => void;
  freshen: () => void;
}

export const useEarthBasemapStore = create<EarthBasemapState>((set, get) => ({
  // Default to yesterday: today's mosaic fills in swath by swath through the
  // day (black wedges where the satellite hasn't flown yet), so the most
  // recent COMPLETE image is the sensible landing point. "Today" is one arrow
  // away for whoever wants the partial live picture.
  date: addDaysUtc(todayUtc(), -1),
  pass: 'pm',
  userPinnedDate: false,
  setDate: (d) => {
    const date = clampDate(d);
    // Aqua launched two years after Terra — stepping earlier than its archive
    // while on PM falls back to the morning satellite instead of a black globe.
    set((s) => ({ date, userPinnedDate: true, pass: date < AQUA_START ? 'am' : s.pass }));
  },
  setPass: (p) => {
    if (p === 'pm' && get().date < AQUA_START) return; // no Aqua imagery yet
    set({ pass: p });
  },
  stepDays: (n) => get().setDate(addDaysUtc(get().date, n)),
  // Re-derive the default "latest complete" date. The module-load default goes
  // stale on a page that runs for days (and across UTC midnight on a wall
  // display), so the EarthTimeBar calls this on activation and once a minute.
  freshen: () => {
    const s = get();
    if (s.userPinnedDate) return;
    const d = addDaysUtc(todayUtc(), -1);
    if (d !== s.date) set({ date: d });
  },
}));

// Fresh provider for the store's current date/pass. Tiles are immutable per
// (layer, date) so stepping back to a viewed day comes from browser cache.
// 250 m imagery ends at level 9 of the GoogleMapsCompatible matrix; Cesium
// magnifies the deepest texture beyond that instead of requesting more.
export function buildEarthProvider(): Cesium.ImageryProvider {
  const { date, pass } = useEarthBasemapStore.getState();
  const layer =
    pass === 'pm' && date >= AQUA_START
      ? 'MODIS_Aqua_CorrectedReflectance_TrueColor'
      : 'MODIS_Terra_CorrectedReflectance_TrueColor';
  return new Cesium.UrlTemplateImageryProvider({
    url:
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}` +
      `/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 9,
    credit: new Cesium.Credit('NASA EOSDIS GIBS · MODIS Terra/Aqua'),
  });
}
