import type { CSSProperties } from 'react';
import { useHurricaneHover } from './hurricaneHoverStore';

function ktToMph(kt: number): number {
  return Math.round(kt * 1.15078);
}

export function HurricaneTooltip() {
  const info = useHurricaneHover((s) => s.info);
  const x = useHurricaneHover((s) => s.x);
  const y = useHurricaneHover((s) => s.y);

  if (!info) return null;

  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;
  const flipX = x > W - 240;
  const flipY = y > H - 170;
  const style: CSSProperties = {
    left: flipX ? undefined : x + 16,
    right: flipX ? W - x + 16 : undefined,
    top: flipY ? undefined : y + 16,
    bottom: flipY ? H - y + 16 : undefined,
  };

  const tauLabel =
    info.tau == null ? null : info.tau === 0 ? 'Current position' : `Forecast +${info.tau}h`;

  return (
    <div
      className="pointer-events-none fixed z-50 w-56 rounded-lg border border-white/10 bg-ink-900/90 px-3 py-2 shadow-panel backdrop-blur-sm"
      style={style}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-white/90">{info.name}</span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-ink-950"
          style={{ backgroundColor: info.color }}
        >
          {info.category != null ? `CAT ${info.category}` : 'TS/TD'}
        </span>
      </div>

      <div className="mt-0.5 text-[11px] text-white/45">{info.classLabel}</div>

      {(tauLabel || info.validLabel) && (
        <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] leading-snug text-white/70">
          {tauLabel && <div className="font-medium text-white/80">{tauLabel}</div>}
          {info.validLabel && <div className="text-white/55">{info.validLabel}</div>}
        </div>
      )}

      <dl className="mt-1.5 space-y-0.5 text-[11px]">
        {info.windKt != null && (
          <div className="flex justify-between">
            <dt className="text-white/45">Max wind</dt>
            <dd className="tabular-nums text-white/85">
              {ktToMph(info.windKt)} mph · {info.windKt} kt
            </dd>
          </div>
        )}
        {info.gustKt != null && (
          <div className="flex justify-between">
            <dt className="text-white/45">Gusts</dt>
            <dd className="tabular-nums text-white/85">
              {ktToMph(info.gustKt)} mph · {info.gustKt} kt
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
