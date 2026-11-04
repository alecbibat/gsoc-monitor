import { useEffect, useState, type CSSProperties } from 'react';
import { useCesiumViewer } from '../cesium/CesiumContext';
import { flyToBoundingBox } from '../cesium/flyTo';
import {
  alertColorHex, alertRings, fetchActiveAlertsShared, loadCountyAtlas, severityRank,
} from '../layers/alerts/alertsData';
import { alertPanelData } from '../layers/alerts/alertPanel';
import { startVisiblePolling } from '../lib/poll';
import { usePanelStore } from '../panels/panelStore';
import { useScreensaverStore } from '../screensaver/screensaverStore';
import { useLayersStore } from '../store/layersStore';
import { useCrisisStore } from '../crisis/crisisStore';
import { useCrisisDockStore } from '../ui/uiStore';
import { useAlertNotifyStore } from './alertNotifyStore';
import { NOTIFY_RADIUS_MI, detectNewAlertNotices, type AlertNotice, type SeenMap } from './pinAlertMatch';

// ── NWS alert notifications ──────────────────────────────────────────────────
// While notifications are on, poll the national feed (shared with the map
// layer, so one download serves both) and, when a new alert covers or comes
// within 15 mi of a property pin, flash the screen and put a popup in the
// middle of it until someone acknowledges it. Runs whether or not the NWS
// layer is shown, and during the screensaver (the wall-display case).

const POLL_MS = 60_000;

function usePinAlertPolling(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let seen: SeenMap = new Map();
    let baselined = false;
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        // Without the county outlines most alerts have no area to measure,
        // and recording them as "seen, nowhere near" would swallow them for
        // good — so a poll that can't load counties is skipped, not half-done.
        const [alerts, atlas] = await Promise.all([fetchActiveAlertsShared(), loadCountyAtlas()]);
        if (cancelled) return;
        const out = detectNewAlertNotices({
          alerts,
          ringsOf: (a) => alertRings(a, atlas.geometries),
          seen,
          baseline: !baselined,
          now: Date.now(),
        });
        seen = out.seen;
        baselined = true;
        if (out.notices.length > 0) {
          const worst = out.notices.reduce((a, b) =>
            severityRank(b.alert.properties.severity) > severityRank(a.alert.properties.severity) ? b : a
          );
          const p = worst.alert.properties;
          useAlertNotifyStore.getState().push(out.notices, alertColorHex(p.event ?? '', p.severity ?? 'Unknown'));
        }
      } catch (err) {
        console.warn('[alert-notify] poll skipped:', err instanceof Error ? err.message : err);
      } finally {
        busy = false;
      }
    };
    const stop = startVisiblePolling(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]);
}

function fmtTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtUntil(iso: string | undefined, now: number): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  const mins = Math.round((t - now) / 60_000);
  if (mins <= 0) return 'expired';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `in ${h} h ${mins % 60} min` : `in ${h} h`;
}

const MAX_PINS_LISTED = 6;

function NoticeCard({ notice, index, total, onShow, onDismiss, onDismissAll, onTurnOff }: {
  notice: AlertNotice;
  index: number;
  total: number;
  onShow: () => void;
  onDismiss: () => void;
  onDismissAll: () => void;
  onTurnOff: () => void;
}) {
  const p = notice.alert.properties;
  const color = alertColorHex(p.event ?? '', p.severity ?? 'Unknown');
  const issued = fmtTime(p.sent ?? p.effective);
  const expires = fmtTime(p.expires);
  const until = fmtUntil(p.expires, Date.now());
  const listed = notice.hits.slice(0, MAX_PINS_LISTED);
  const more = notice.hits.length - listed.length;

  return (
    <div
      role="alert"
      aria-labelledby="alert-notice-title"
      className="gsoc-notice-pop pointer-events-auto w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-ink-900/95 text-white shadow-2xl backdrop-blur-md"
      style={{ borderColor: `${color}aa`, boxShadow: `0 0 0 1px ${color}55, 0 0 48px ${color}55, 0 24px 64px rgba(0,0,0,0.7)` }}
    >
      <div className="flex items-center gap-2 px-4 py-2" style={{ background: `${color}33`, borderBottom: `1px solid ${color}66` }}>
        <span aria-hidden className="text-[15px]">⚠</span>
        <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color }}>
          {notice.isUpdate ? 'NWS alert update near your locations' : 'New NWS alert near your locations'}
        </span>
        {total > 1 && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
            {index + 1} of {total}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <div>
          <h2 id="alert-notice-title" className="text-[22px] font-bold leading-tight" style={{ color }}>
            {p.event ?? 'NWS Alert'}
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {p.severity && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/75">{p.severity}</span>}
            {p.urgency && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/75">{p.urgency}</span>}
            {p.senderName && <span className="rounded bg-white/5 px-1.5 py-0.5 normal-case tracking-normal text-white/55">{p.senderName}</span>}
          </div>
          {p.headline && <p className="mt-2 text-[12.5px] leading-snug text-white/80">{p.headline}</p>}
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Within {NOTIFY_RADIUS_MI} mi
          </div>
          <ul className="space-y-0.5">
            {listed.map(({ pin, distanceMi }) => (
              <li key={pin.key} className="flex items-baseline gap-2 text-[12.5px]">
                <span aria-hidden className="text-white/40">📍</span>
                <span className="min-w-0 flex-1 truncate text-white/90">
                  {pin.name} <span className="text-white/35">· {pin.groupName}</span>
                </span>
                <span className={`shrink-0 text-[11px] font-semibold ${distanceMi === 0 ? '' : 'text-white/60'}`} style={distanceMi === 0 ? { color } : undefined}>
                  {distanceMi === 0 ? 'Inside alert area' : `${distanceMi.toFixed(1)} mi away`}
                </span>
              </li>
            ))}
          </ul>
          {more > 0 && <div className="mt-1 text-[11px] text-white/45">+{more} more location{more === 1 ? '' : 's'}</div>}
        </div>

        {(issued || expires) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/55">
            {issued && <span><span className="text-white/35">Issued</span> {issued}</span>}
            {expires && <span><span className="text-white/35">Expires</span> {expires}{until ? ` (${until})` : ''}</span>}
          </div>
        )}
        {p.areaDesc && <p className="line-clamp-2 text-[11px] leading-snug text-white/40">{p.areaDesc}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/8 px-4 py-2.5">
        <button
          onClick={onTurnOff}
          className="mr-auto text-[10.5px] text-white/35 underline-offset-2 transition hover:text-white/70 hover:underline"
        >
          Turn off notifications
        </button>
        {total > 1 && (
          <button
            onClick={onDismissAll}
            className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-white/60 transition hover:bg-white/8 hover:text-white"
          >
            Dismiss all
          </button>
        )}
        <button
          onClick={onDismiss}
          className="rounded-md border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          {total > 1 ? 'Next' : 'Dismiss'}
        </button>
        <button
          onClick={onShow}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-ink-950 transition hover:brightness-110"
          style={{ background: color }}
        >
          Show on map
        </button>
      </div>
    </div>
  );
}

export function AlertNotifier() {
  const viewer = useCesiumViewer();
  const enabled = useAlertNotifyStore((s) => s.enabled);
  const queue = useAlertNotifyStore((s) => s.queue);
  const flashSeq = useAlertNotifyStore((s) => s.flashSeq);
  const flashColor = useAlertNotifyStore((s) => s.flashColor);
  usePinAlertPolling(enabled);

  // Re-render once a minute so "expires in …" stays true while a popup waits.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (queue.length === 0) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [queue.length]);

  const head = queue[0];

  // Escape acknowledges the notice on screen — unless something else (a menu,
  // a modal) already handled that Escape.
  useEffect(() => {
    if (!head) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      useAlertNotifyStore.getState().dismiss(head.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [head]);

  const showOnMap = (n: AlertNotice) => {
    const ss = useScreensaverStore.getState();
    if (ss.active) ss.stop();
    const layers = useLayersStore.getState();
    if (!layers.active.alerts) layers.toggleLayer('alerts');
    // The crisis workspace covers the map unless an incident's map dock is out.
    const crisis = useCrisisStore.getState();
    if (crisis.open && (crisis.activeIncidentId === null || useCrisisDockStore.getState().collapsed)) crisis.close();
    if (viewer && !viewer.isDestroyed()) {
      const [w, s, e, nn] = n.bbox;
      const padLon = Math.max((e - w) * 0.25, 0.25);
      const padLat = Math.max((nn - s) * 0.25, 0.25);
      flyToBoundingBox(viewer, w - padLon, s - padLat, e + padLon, nn + padLat);
    }
    // Opened on purpose, so it starts locked like the other deliberately
    // launched windows: the next click on the globe won't close it.
    usePanelStore.getState().open({ ...alertPanelData(n.alert), locked: true });
    useAlertNotifyStore.getState().dismiss(n.id);
  };

  return (
    <>
      {flashSeq > 0 && (
        <div
          key={flashSeq}
          aria-hidden
          className="gsoc-alert-flash pointer-events-none fixed inset-0 z-[4500]"
          style={{ '--flash': flashColor } as CSSProperties}
        />
      )}
      {head && (
        <div className="pointer-events-none fixed inset-0 z-[4600] flex items-center justify-center p-4">
          <NoticeCard
            key={head.id}
            notice={head}
            index={0}
            total={queue.length}
            onShow={() => showOnMap(head)}
            onDismiss={() => useAlertNotifyStore.getState().dismiss(head.id)}
            onDismissAll={() => useAlertNotifyStore.getState().dismissAll()}
            onTurnOff={() => useAlertNotifyStore.getState().toggle()}
          />
        </div>
      )}
    </>
  );
}
