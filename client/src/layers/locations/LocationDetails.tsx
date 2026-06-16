import * as Cesium from 'cesium';
import { useEffect, useState } from 'react';
import { useCesiumViewer } from '../../cesium/CesiumContext';
import { flyToLonLat } from '../../cesium/flyTo';
import { api } from '../../api/client';
import { PulseLineMaterialProperty } from './pulseLineMaterial';
import type { DirectionsResponse, DirectionsLeg } from '../../types';

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
  hotel: { label: 'Hotel', icon: '🏨', color: '#38bdf8' },
} as const;

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

function gmapsUrl(oLat: number, oLon: number, leg: DirectionsLeg): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${oLat},${oLon}&destination=${leg.lat},${leg.lon}&travelmode=driving`
  );
}

function shareText(leg: DirectionsLeg, url: string): string {
  const dur = fmtDur(leg.durationS);
  const lines = [`Directions to ${leg.name} (${fmtDist(leg.distanceM)}${dur ? `, ${dur} drive` : ''}):`];
  leg.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.instruction} (${fmtDist(s.distanceM)})`));
  lines.push('', `Open in Google Maps: ${url}`);
  return lines.join('\n');
}

function LegCard({
  leg,
  kind,
  origin,
  optionLabel,
}: {
  leg: DirectionsLeg;
  kind: 'hospital' | 'hotel';
  origin: { lat: number; lon: number };
  optionLabel?: string | null;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);
  const meta = LEG_META[kind];

  const url = gmapsUrl(origin.lat, origin.lon, leg);
  const dur = fmtDur(leg.durationS);

  const share = async () => {
    const text = shareText(leg, url);
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: `Directions to ${leg.name}`, text, url });
        return;
      } catch {
        /* user cancelled or unsupported — fall through to clipboard */
      }
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
    try {
      await navigator.clipboard.writeText(shareText(leg, url));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn =
    'rounded px-2 py-1 text-[11px] font-medium transition border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white/90';

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
        <a href={url} target="_blank" rel="noopener noreferrer" className={btn}>
          🧭 Google Maps
        </a>
        <button onClick={share} className={btn}>
          {shared ? '✓ Link copied' : '🔗 Share'}
        </button>
        {leg.steps.length > 0 && (
          <button onClick={() => setShowSteps((v) => !v)} className={btn}>
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
          <button onClick={copySteps} className={`${btn} mt-2 w-full`}>
            {copied ? '✓ Copied to clipboard' : '📋 Copy directions'}
          </button>
        </div>
      )}
    </div>
  );
}

function optionLetter(i: number): string {
  return String.fromCharCode(65 + i); // 0 → A, 1 → B, …
}

function LegSection({
  legs,
  kind,
  origin,
  selectedIdx,
  onSelect,
}: {
  legs: DirectionsLeg[];
  kind: 'hospital' | 'hotel';
  origin: { lat: number; lon: number };
  selectedIdx: number;
  onSelect: (i: number) => void;
}) {
  const meta = LEG_META[kind];

  if (!legs || legs.length === 0) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/4 p-2.5 text-[12px] text-white/40">
        {meta.icon} No {kind} found within range
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

export function LocationDetails({ payload }: { payload: LocationPayload }) {
  const viewer = useCesiumViewer();
  const [data, setData] = useState<DirectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hospitalIdx, setHospitalIdx] = useState(0);
  const [hotelIdx, setHotelIdx] = useState(0);

  const selHospital = data && data.hospitals.length ? data.hospitals[Math.min(hospitalIdx, data.hospitals.length - 1)] : null;
  const selHotel = data && data.hotels.length ? data.hotels[Math.min(hotelIdx, data.hotels.length - 1)] : null;

  // Fly to the pin when the panel opens.
  useEffect(() => {
    if (!viewer) return;
    flyToLonLat(viewer, payload.lon, payload.lat, payload.altitudeM);
  }, [viewer, payload.lat, payload.lon, payload.altitudeM]);

  // Fetch nearest hospital + hotel routes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    api
      .directions(payload.lat, payload.lon)
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
    return () => {
      cancelled = true;
    };
  }, [payload.lat, payload.lon, reloadKey]);

  // Draw the routes on the globe and frame them.
  useEffect(() => {
    if (!viewer || !data) return;
    const ds = new Cesium.CustomDataSource(`routes:${payload.lat},${payload.lon}`);
    viewer.dataSources.add(ds);

    const pts: Cesium.Cartesian3[] = [Cesium.Cartesian3.fromDegrees(payload.lon, payload.lat)];

    // Origin marker (the pin itself).
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(payload.lon, payload.lat),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(payload.color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    for (const leg of [selHospital, selHotel]) {
      if (!leg) continue;
      const meta = LEG_META[leg.category];
      const color = Cesium.Color.fromCssColorString(meta.color);
      const positions = leg.geometry.map(([lo, la]) => Cesium.Cartesian3.fromDegrees(lo, la));
      pts.push(...positions);

      if (leg.routed) {
        // Real route: a glowing pulse sweeps from the pin toward the destination.
        // Drawn unclamped (the app has no terrain, so this sits on the surface);
        // the dense road geometry keeps it hugging the globe.
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
        // Fallback estimate: a draped dashed line (clamped, since it's one long
        // straight chord that would otherwise cut through the globe).
        ds.entities.add({
          polyline: {
            positions,
            width: 3,
            clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({ color }),
          },
        });
      }

      // Destination marker with a gentle "ping" pulse.
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(leg.lon, leg.lat),
        point: {
          pixelSize: new Cesium.CallbackProperty(
            () => 7 + 2.5 * (0.5 + 0.5 * Math.sin(Date.now() / 240)),
            false
          ) as unknown as Cesium.Property,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
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

    // The globe only renders on demand, so drive a render loop to animate the
    // pulse while a route is on screen. Stops when the panel closes.
    let raf = 0;
    if (selHospital || selHotel) {
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
  }, [viewer, selHospital, selHotel, payload.lat, payload.lon, payload.color]);

  return (
    <div className="space-y-3 p-1">
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

      <button
        onClick={() => viewer && flyToLonLat(viewer, payload.lon, payload.lat, payload.altitudeM)}
        className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-[12px] font-medium text-white/60 transition hover:border-white/20 hover:bg-white/10 hover:text-white/90"
      >
        ↗ Fly here
      </button>

      {/* Nearby + directions */}
      <div className="border-t border-white/8 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
          Nearby & Directions
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-2 text-[12px] text-white/50">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            Finding nearest hospital &amp; hotel…
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
    </div>
  );
}
