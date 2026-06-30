import { useLayersStore } from '../../store/layersStore';
import { useWindStatus } from './windStore';
import { useWindProbeStore } from './windProbeStore';
import { useWindUnit } from './windUnitStore';
import { speedColorHex, formatSpeed, WIND_UNIT_LABEL, type WindReading, type WindUnit } from './windProbe';

// A small compass with an arrow pointing the way the wind is blowing (toward
// `toDeg`), tinted by speed.
function Compass({ reading }: { reading: WindReading | null }) {
  const toDeg = reading?.toDeg ?? 0;
  const color = reading ? speedColorHex(reading.speedMps) : '#5b6b7a';
  return (
    <svg width="72" height="72" viewBox="0 0 80 80" className="shrink-0">
      <circle cx="40" cy="40" r="33" fill="#0b1622" stroke="#ffffff22" strokeWidth="1.5" />
      {/* cardinal ticks */}
      {[0, 90, 180, 270].map((a) => (
        <line
          key={a}
          x1="40"
          y1="9"
          x2="40"
          y2="15"
          stroke="#ffffff44"
          strokeWidth="1.5"
          transform={`rotate(${a} 40 40)`}
        />
      ))}
      <text x="40" y="20" textAnchor="middle" fontSize="9" fill="#ffffff66">N</text>
      <text x="63" y="43" textAnchor="middle" fontSize="9" fill="#ffffff44">E</text>
      <text x="40" y="68" textAnchor="middle" fontSize="9" fill="#ffffff44">S</text>
      <text x="17" y="43" textAnchor="middle" fontSize="9" fill="#ffffff44">W</text>
      {reading && (
        <g transform={`rotate(${toDeg} 40 40)`}>
          <path
            d="M40 17 L48 41 L41 41 L41 60 L39 60 L39 41 L32 41 Z"
            fill={color}
            stroke="#0a1722"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
}

// Fixed corner HUD for the wind point-probe. Visible whenever the wind layer is
// on: hover the globe for a live reading, right-click to pin one.
export function WindReadout() {
  const active = useLayersStore((s) => s.active.wind);
  const probeEnabled = useWindProbeStore((s) => s.probeEnabled);
  const ready = useWindStatus((s) => s.ready);
  const error = useWindStatus((s) => s.error);
  const stale = useWindStatus((s) => s.stale);
  const hover = useWindProbeStore((s) => s.hover);
  const pins = useWindProbeStore((s) => s.pins);
  const clearPins = useWindProbeStore((s) => s.clearPins);
  const unit = useWindUnit((s) => s.unit);

  if (!active || !probeEnabled) return null;

  const calm = hover != null && hover.speedMps < 0.5;
  // Show the other two units beneath the primary reading for quick reference.
  const others = (['mph', 'kt', 'ms'] as WindUnit[]).filter((u) => u !== unit);

  return (
    <div className="pointer-events-none absolute bottom-24 right-4 z-30 w-[230px]">
      <div className="pointer-events-auto rounded-xl border border-white/10 bg-ink-900/90 p-3 shadow-panel backdrop-blur-md">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
            🌬 Wind probe
            {ready && stale && (
              <span className="ml-1.5 rounded bg-amber-400/15 px-1 py-0.5 text-[8px] font-bold text-amber-300/90">
                HISTORICAL
              </span>
            )}
          </span>
          {pins.length > 0 && (
            <button
              onClick={clearPins}
              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/45 transition hover:text-white"
            >
              Clear {pins.length}
            </button>
          )}
        </div>

        {!ready ? (
          <p className="py-2 text-center text-[12px] text-white/45">
            {error ?? 'Reading wind field…'}
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Compass reading={hover} />
            <div className="min-w-0 flex-1">
              {hover ? (
                <>
                  {calm ? (
                    <span className="font-mono text-[17px] font-bold text-white/80">Calm</span>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[20px] font-bold tabular-nums text-white">
                        {formatSpeed(hover.speedMps, unit)}
                      </span>
                      <span className="text-[11px] text-white/45">{WIND_UNIT_LABEL[unit]}</span>
                    </div>
                  )}
                  <div className="mt-0.5 text-[12px] font-semibold text-white/80">
                    from {hover.cardinal}
                    <span className="ml-1 font-normal text-white/40">
                      {Math.round(hover.fromDeg)}°
                    </span>
                  </div>
                  {!calm && (
                    <div className="text-[10px] text-white/35">
                      {others.map((u) => `${formatSpeed(hover.speedMps, u)} ${WIND_UNIT_LABEL[u]}`).join(' · ')}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[12px] leading-snug text-white/45">
                  Hover the map for a live reading.
                </p>
              )}
            </div>
          </div>
        )}

        <p className="mt-2 border-t border-white/5 pt-1.5 text-[10px] text-white/30">
          Right-click to pin · click a pin for its forecast
        </p>
      </div>
    </div>
  );
}
