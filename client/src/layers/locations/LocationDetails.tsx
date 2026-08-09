import * as Cesium from 'cesium';
import { useEffect, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import { fetchDirections, fetchDriveRoute } from './directionsClient';
import { PulseLineMaterialProperty } from './pulseLineMaterial';
import { LOCATION_GROUPS } from './locations';
import type { DirectionsResponse, DirectionsLeg, DriveResult } from '../../types';

export interface LocationPayload {
  name: string;
  group: string;
  lat: number;
  lon: number;
  altitudeM: number;
  color: string;
  icon: string;
}

const LEG_META = {
  hospital: { label: 'Hospital', icon: '🏥', color: '#ef4444' },
  police: { label: 'Police', icon: '🚓', color: '#2563eb' },
  hotel: { label: 'Hotel', icon: '🏨', color: '#38bdf8' },
  fire_station: { label: 'Fire Station', icon: '🚒', color: '#f97316' },
} as const;

type LegKind = keyof typeof LEG_META;

const BTN =
  'rounded px-2 py-1 text-[11px] font-medium transition border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90';

function fmtDist(m: number): string {
  const mi = m / 1609.34;
  return mi < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
}

function fmtDur(s: number): string | null {
  if (!s) return null;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function gmapsUrl(oLat: number, oLon: number, dLat: number, dLon: number): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${oLat},${oLon}&destination=${dLat},${dLon}&travelmode=driving`
  );
}

// ─── Emergency response compact card ────────────────────────────────────────

function EmergencyResponseCard({
  police,
  fireStation,
  loading,
}: {
  police: DirectionsLeg | null;
  fireStation: DirectionsLeg | null;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-red-500/25 bg-red-500/8 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-red-400/90">
          Emergency Response
        </span>
        <span className="ml-auto text-[8px] italic text-white/25">estimates only</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-1.5 py-0.5 text-[11px] text-white/40">
          <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-white/60" />
          Calculating…
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/55">🚓 Police</span>
            {police ? (
              <span className="text-right">
                <span className="text-[11px] font-medium text-white/80">{fmtDist(police.distanceM)}</span>
                {fmtDur(police.durationS) && (
                  <span className="ml-1.5 text-[10px] text-white/40">{fmtDur(police.durationS)}</span>
                )}
              </span>
            ) : (
              <span className="text-[10px] text-white/30">Not found</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/55">🚒 Fire</span>
            {fireStation ? (
              <span className="text-right">
                <span className="text-[11px] font-medium text-white/80">{fmtDist(fireStation.distanceM)}</span>
                {fmtDur(fireStation.durationS) && (
                  <span className="ml-1.5 text-[10px] text-white/40">{fmtDur(fireStation.durationS)}</span>
                )}
              </span>
            ) : (
              <span className="text-[10px] text-white/30">Not found</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-1.5 text-[8px] leading-snug text-white/20">
        Possible response distances &amp; times — not guaranteed
      </div>
    </div>
  );
}

// ─── Full directions card (hospital / hotel) ─────────────────────────────────

function LegCard({
  leg,
  kind,
  origin,
  optionLabel,
}: {
  leg: DirectionsLeg;
  kind: LegKind;
  origin: { lat: number; lon: number };
  optionLabel?: string | null;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = LEG_META[kind];

  const url = gmapsUrl(origin.lat, origin.lon, leg.lat, leg.lon);
  const dur = fmtDur(leg.durationS);

  const share = async () => {
    const text = `Directions to ${leg.name} (${fmtDist(leg.distanceM)}${dur ? `, ${dur} drive` : ''}):\n${url}`;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await navigator.share({ title: `Directions to ${leg.name}`, text, url }); return; } catch { /* fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };

  const copySteps = async () => {
    const lines = [`Directions to ${leg.name} (${fmtDist(leg.distanceM)}${dur ? `, ${dur} drive` : ''}):`];
    leg.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.instruction} (${fmtDist(s.distanceM)})`));
    lines.push('', `Open in Google Maps: ${url}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      className="rounded-lg border p-2.5"
      style={{ borderColor: `${meta.color}40`, background: `${meta.color}12` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
            {meta.icon} {meta.label}
            {optionLabel ? ` · Option ${optionLabel}` : ''}
          </div>
          <div className="truncate text-[13px] font-medium text-white/90">{leg.name}</div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-white/70">
          <div>{fmtDist(leg.distanceM)}</div>
          {dur && <div className="text-white/40">{dur}</div>}
        </div>
      </div>

      {!leg.routed && (
        <div className="mt-1 text-[10px] text-amber-300/80">
          Straight-line estimate — open Maps for live routing
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <a href={url} target="_blank" rel="noopener noreferrer" className={BTN}>
          🧭 Google Maps
        </a>
        <button onClick={share} className={BTN}>
          {shared ? '✓ Link copied' : '🔗 Share'}
        </button>
        {leg.steps.length > 0 && (
          <button onClick={() => setShowSteps((v) => !v)} className={BTN}>
            {showSteps ? 'Hide steps' : '🧾 Directions'}
          </button>
        )}
      </div>

      {showSteps && leg.steps.length > 0 && (
        <div className="mt-2 rounded-md bg-black/20 p-2">
          <ol className="space-y-1">
            {leg.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-snug text-white/70">
                <span className="shrink-0 text-white/30">{i + 1}.</span>
                <span className="flex-1">{s.instruction}</span>
                <span className="shrink-0 text-white/30">{fmtDist(s.distanceM)}</span>
              </li>
            ))}
          </ol>
          <button onClick={copySteps} className={`${BTN} mt-2 w-full`}>
            {copied ? '✓ Copied to clipboard' : '📋 Copy directions'}
          </button>
        </div>
      )}
    </div>
  );
}

function optionLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

function LegSection({
  legs,
  kind,
  origin,
  selectedIdx,
  onSelect,
}: {
  legs: DirectionsLeg[];
  kind: LegKind;
  origin: { lat: number; lon: number };
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  const meta = LEG_META[kind];

  if (!legs || legs.length === 0) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/4 p-2.5 text-[12px] text-white/40">
        {meta.icon} No {kind === 'police' ? 'police station' : kind === 'fire_station' ? 'fire station' : kind} found within range
      </div>
    );
  }

  const idx = Math.min(selectedIdx, legs.length - 1);
  const leg = legs[idx];

  return (
    <div className="space-y-1.5">
      {legs.length > 1 && (
        <div className="flex gap-1">
          {legs.map((l, i) => {
            const active = i === idx;
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                className="flex-1 rounded-md border px-1.5 py-1 text-center text-[11px] transition"
                style={
                  active
                    ? { borderColor: `${meta.color}aa`, background: `${meta.color}22`, color: '#fff' }
                    : { borderColor: 'rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)' }
                }
              >
                <span className="font-semibold">{optionLetter(i)}</span>
                <span className="ml-1 opacity-75">{fmtDist(l.distanceM)}</span>
              </button>
            );
          })}
        </div>
      )}
      <LegCard
        leg={leg}
        kind={kind}
        origin={origin}
        optionLabel={legs.length > 1 ? optionLetter(idx) : null}
      />
    </div>
  );
}

// ─── Nearest other pins ──────────────────────────────────────────────────────

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface NearbyPin {
  name: string;
  group: string;
  lat: number;
  lon: number;
  color: string;
  icon: string;
  distanceMi: number;
  route: DriveResult | null;
}

function computeNearestPins(lat: number, lon: number, selfName: string, count: number) {
  return LOCATION_GROUPS
    .flatMap((g) =>
      g.locations.map((l) => ({
        name: l.name,
        group: g.name,
        lat: l.lat,
        lon: l.lon,
        color: g.color,
        icon: g.icon,
        distanceMi: haversineMi(lat, lon, l.lat, l.lon),
      }))
    )
    .filter((l) => l.name !== selfName)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, count);
}

function NearbyPinCard({
  pin,
  originLat,
  originLon,
}: {
  pin: NearbyPin;
  originLat: number;
  originLon: number;
}) {
  const viewer = useCesiumViewer();
  const [showSteps, setShowSteps] = useState(false);
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);

  const dist = pin.route?.routed ? fmtDist(pin.route.distanceM) : `${pin.distanceMi.toFixed(1)} mi`;
  const dur = pin.route?.routed ? fmtDur(pin.route.durationS) : null;
  const url = gmapsUrl(originLat, originLon, pin.lat, pin.lon);

  const share = async () => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await navigator.share({ title: `Directions to ${pin.name}`, url }); return; } catch { /* fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch { window.open(url, '_blank', 'noopener'); }
  };

  const copySteps = async () => {
    if (!pin.route) return;
    const lines = [`Directions to ${pin.name} (${dist}${dur ? `, ${dur} drive` : ''}):`];
    pin.route.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.instruction} (${fmtDist(s.distanceM)})`));
    lines.push('', `Open in Google Maps: ${url}`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      className="rounded-lg border p-2.5"
      style={{ borderColor: `${pin.color}40`, background: `${pin.color}12` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: pin.color }}>
            {pin.icon} {pin.group}
          </div>
          <div className="truncate text-[13px] font-medium text-white/90">{pin.name}</div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-white/70">
          <div>{dist}</div>
          {dur && <div className="text-white/40">{dur}</div>}
          {!pin.route?.routed && pin.route !== null && (
            <div className="text-[9px] text-white/30">straight-line</div>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <a href={url} target="_blank" rel="noopener noreferrer" className={BTN}>
          🧭 Google Maps
        </a>
        <button onClick={share} className={BTN}>
          {shared ? '✓ Copied' : '🔗 Share'}
        </button>
        {pin.route && pin.route.steps.length > 0 && (
          <button onClick={() => setShowSteps((v) => !v)} className={BTN}>
            {showSteps ? 'Hide steps' : '🧾 Directions'}
          </button>
        )}
        <button
          onClick={() => viewer && flyToLonLat(viewer, pin.lon, pin.lat, 0)}
          className={BTN}
        >
          ↗ Fly there
        </button>
      </div>

      {showSteps && pin.route && pin.route.steps.length > 0 && (
        <div className="mt-2 rounded-md bg-black/20 p-2">
          <ol className="space-y-1">
            {pin.route.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[11px] leading-snug text-white/70">
                <span className="shrink-0 text-white/30">{i + 1}.</span>
                <span className="flex-1">{s.instruction}</span>
                <span className="shrink-0 text-white/30">{fmtDist(s.distanceM)}</span>
              </li>
            ))}
          </ol>
          <button onClick={copySteps} className={`${BTN} mt-2 w-full`}>
            {copied ? '✓ Copied to clipboard' : '📋 Copy directions'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function LocationDetails({ payload }: { payload: LocationPayload }) {
  const viewer = useCesiumViewer();
  const [data, setData] = useState<DirectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hospitalIdx, setHospitalIdx] = useState(0);
  const [hotelIdx, setHotelIdx] = useState(0);
  const [nearbyPins, setNearbyPins] = useState<NearbyPin[]>([]);
  const [pinsLoading, setPinsLoading] = useState(true);

  // Emergency response uses nearest only (index 0, no A/B/C selector).
  const selPolice = data?.police?.[0] ?? null;
  const selFireStation = data?.fireStations?.[0] ?? null;
  const selHospital = data && data.hospitals.length
    ? data.hospitals[Math.min(hospitalIdx, data.hospitals.length - 1)]
    : null;
  const selHotel = data && data.hotels.length
    ? data.hotels[Math.min(hotelIdx, data.hotels.length - 1)]
    : null;

  useEffect(() => {
    if (!viewer) return;
    flyToLonLat(viewer, payload.lon, payload.lat, payload.altitudeM);
  }, [viewer, payload.lat, payload.lon, payload.altitudeM]);

  // Fetch emergency services + hotel/hospital directions directly from the
  // browser (Overpass + OSRM) so server-side network restrictions don't apply.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchDirections(payload.lat, payload.lon)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setHospitalIdx(0);
          setHotelIdx(0);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [payload.lat, payload.lon, reloadKey]);

  // Compute nearest 3 pins client-side, then fetch drive routes for each.
  useEffect(() => {
    let cancelled = false;
    setPinsLoading(true);
    const near = computeNearestPins(payload.lat, payload.lon, payload.name, 3);
    Promise.all(
      near.map((pin) =>
        fetchDriveRoute(payload.lat, payload.lon, pin.lat, pin.lon)
          .then((route) => ({ ...pin, route }))
          .catch(() => ({ ...pin, route: null }))
      )
    ).then((results) => {
      if (!cancelled) {
        setNearbyPins(results);
        setPinsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [payload.lat, payload.lon, payload.name]);

  // Draw emergency + hotel/hospital routes on the globe.
  useEffect(() => {
    if (!viewer || !data) return;
    const ds = new Cesium.CustomDataSource(`routes:${payload.lat},${payload.lon}`);
    viewer.dataSources.add(ds);

    const pts: Cesium.Cartesian3[] = [Cesium.Cartesian3.fromDegrees(payload.lon, payload.lat)];

    ds.entities.add({
      // Surface anchor + default depth test — the globe occludes these route
      // markers when the user rotates the planet away from the location.
      position: Cesium.Cartesian3.fromDegrees(payload.lon, payload.lat, 0),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(payload.color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
      },
    });

    for (const leg of [selHospital, selPolice, selFireStation, selHotel]) {
      if (!leg) continue;
      const meta = LEG_META[leg.category];
      const color = Cesium.Color.fromCssColorString(meta.color);
      const positions = leg.geometry.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la));
      pts.push(...positions);

      if (leg.routed) {
        ds.entities.add({
          polyline: {
            positions,
            width: 5,
            material: new PulseLineMaterialProperty(
              color,
              8.0,
              0.16
            ) as unknown as Cesium.MaterialProperty,
          },
        });
      } else {
        ds.entities.add({
          polyline: {
            positions,
            width: 3,
            clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({ color }),
          },
        });
      }

      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(leg.lon, leg.lat, 0),
        point: {
          pixelSize: new Cesium.CallbackProperty(
            () => 7 + 2.5 * (0.5 + 0.5 * Math.sin(Date.now() / 240)),
            false
          ) as unknown as Cesium.Property,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: `${meta.icon} ${leg.name}`,
          font: '600 12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0a0c10').withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          pixelOffset: new Cesium.Cartesian2(0, -16),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          scale: 0.9,
        },
      });
    }

    viewer.scene.requestRender();

    if (pts.length > 1) {
      const sphere = Cesium.BoundingSphere.fromPoints(pts);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2.5, Math.max(sphere.radius * 2.6, 4000)),
      });
    }

    let raf = 0;
    if (selHospital || selPolice || selFireStation || selHotel) {
      const tick = () => {
        viewer.scene.requestRender();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      viewer.dataSources.remove(ds, true);
      viewer.scene.requestRender();
    };
  }, [viewer, selHospital, selPolice, selFireStation, selHotel, payload.lat, payload.lon, payload.color]);

  return (
    <div className="space-y-3 p-1">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ backgroundColor: `${payload.color}22`, border: `1px solid ${payload.color}55` }}
        >
          {payload.icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-tight text-white/90">
            {payload.name}
          </div>
          <div className="mt-0.5 text-[11px] text-white/45">{payload.group}</div>
        </div>
      </div>

      {/* Coordinates */}
      <div className="space-y-2 rounded-lg border border-white/8 bg-white/4 p-3 text-[11px]">
        <div className="flex justify-between">
          <span className="text-white/40">Latitude</span>
          <span className="font-mono text-white/70">{payload.lat.toFixed(5)}°</span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/40">Longitude</span>
          <span className="font-mono text-white/70">{payload.lon.toFixed(5)}°</span>
        </div>
      </div>

      {/* Emergency response compact card — always shown, loading state while fetching */}
      <EmergencyResponseCard
        police={selPolice}
        fireStation={selFireStation}
        loading={loading}
      />

      <button
        onClick={() => viewer && flyToLonLat(viewer, payload.lon, payload.lat, payload.altitudeM)}
        className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-[12px] font-medium text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white/90"
      >
        ↗ Fly here
      </button>

      {/* Hospital & Hotel directions (A/B/C) */}
      <div className="border-t border-white/8 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Nearby &amp; Directions
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-2 text-[12px] text-white/50">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            Finding nearest hospital, hotel &amp; emergency services…
          </div>
        )}

        {error && !loading && (
          <div className="text-[12px] text-red-400">
            Couldn&apos;t load directions.{' '}
            <button onClick={() => setReloadKey((k) => k + 1)} className="underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-3">
            <LegSection
              legs={data.hospitals}
              kind="hospital"
              origin={data.origin}
              selectedIdx={hospitalIdx}
              onSelect={setHospitalIdx}
            />
            <LegSection
              legs={data.hotels}
              kind="hotel"
              origin={data.origin}
              selectedIdx={hotelIdx}
              onSelect={setHotelIdx}
            />
          </div>
        )}
      </div>

      {/* Nearest other properties */}
      <div className="border-t border-white/8 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Nearest Properties
        </div>

        {pinsLoading ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-white/50">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            Finding nearest properties…
          </div>
        ) : (
          <div className="space-y-3">
            {nearbyPins.map((pin) => (
              <NearbyPinCard
                key={pin.name}
                pin={pin}
                originLat={payload.lat}
                originLon={payload.lon}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
