import type { ReactNode } from 'react';
import { RADAR_SPEEDS, useRadarStore } from './radarStore';
import { legendGradient, RADAR_PALETTES, type RadarPaletteId } from './radarPalettes';
import { RADAR_WINDOWS, windowLabel, type RadarWindow } from './radarTimeline';
import { speedLabel } from './RadarTimeline';

const PALETTE_HINT: Record<RadarPaletteId, string> = {
  classic: 'Broadcast ramp: green → yellow → red → magenta',
  vivid: 'Blue → cyan → yellow → red: reads well over satellite imagery',
  rainviewer: "RainViewer's own colour scheme",
};

// What "Colour snow separately" paints snow in, per palette; off, snow is
// painted in the rain colours like everything else.
const SNOW_HINT: Record<RadarPaletteId, string> = {
  classic: 'Paint snow in its own near-white to ice-blue ramp instead of the rain colours',
  vivid: 'Paint snow in its own near-white to ice-blue ramp instead of the rain colours',
  rainviewer: "Paint snow in RainViewer's cyan-to-blue snow ramp instead of the rain colours",
};

const WINDOW_HINT: Record<RadarWindow, string> = {
  30: 'Loop the last 30 minutes',
  60: 'Loop the last hour',
  120: 'Loop the last 2 hours',
};

const segment = (on: boolean) =>
  `rounded text-[11px] font-medium transition ${
    on ? 'bg-sky-500/30 text-sky-300' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
  }`;

function Group({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={className}>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">{label}</div>
      {children}
    </div>
  );
}

// Sidebar controls under the radar toggle: loop length, playback speed,
// palette, opacity and snow colouring. Playback itself and scrubbing live on
// the map (RadarTimeline); the colour key is the map legend (RadarLegend).
export function RadarControls() {
  const windowMinutes = useRadarStore((s) => s.windowMinutes);
  const setWindowMinutes = useRadarStore((s) => s.setWindowMinutes);
  const speed = useRadarStore((s) => s.speed);
  const setSpeed = useRadarStore((s) => s.setSpeed);
  const palette = useRadarStore((s) => s.palette);
  const setPalette = useRadarStore((s) => s.setPalette);
  const opacity = useRadarStore((s) => s.opacity);
  const setOpacity = useRadarStore((s) => s.setOpacity);
  const snow = useRadarStore((s) => s.snow);
  const setSnow = useRadarStore((s) => s.setSnow);

  return (
    <div className="mt-2 space-y-2.5 rounded-md bg-black/20 p-2">
      <div className="flex gap-2">
        <Group label="Loop" className="min-w-0 flex-[3]">
          <div className="grid grid-cols-3 gap-1">
            {RADAR_WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowMinutes(w)}
                aria-pressed={windowMinutes === w}
                title={WINDOW_HINT[w]}
                className={`${segment(windowMinutes === w)} whitespace-nowrap px-1 py-1`}
              >
                {windowLabel(w)}
              </button>
            ))}
          </div>
        </Group>
        <Group label="Speed" className="min-w-0 flex-[2]">
          <div className="grid grid-cols-3 gap-1">
            {RADAR_SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                aria-label={`${s === 0.5 ? 'Half' : s === 1 ? 'Normal' : 'Double'} speed`}
                title={`Playback speed ${speedLabel(s)}`}
                className={`${segment(speed === s)} px-1 py-1 font-mono`}
              >
                {speedLabel(s)}
              </button>
            ))}
          </div>
        </Group>
      </div>

      <Group label="Palette">
        <div className="grid grid-cols-3 gap-1">
          {RADAR_PALETTES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPalette(p.id)}
              aria-pressed={palette === p.id}
              title={PALETTE_HINT[p.id]}
              className={`${segment(palette === p.id)} flex flex-col items-stretch gap-1 px-1.5 pb-1.5 pt-1`}
            >
              <span className="truncate">{p.label}</span>
              <span
                aria-hidden="true"
                className="h-1 rounded-full ring-1 ring-white/10"
                style={{ background: legendGradient(p.id) }}
              />
            </button>
          ))}
        </div>
      </Group>

      <label className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">Opacity</span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="min-w-0 flex-1 accent-accent"
        />
        <span className="w-8 text-right font-mono text-[10px] tabular-nums text-white/45">
          {Math.round(opacity * 100)}%
        </span>
      </label>

      <label className="flex cursor-pointer items-center gap-2" title={SNOW_HINT[palette]}>
        <input
          type="checkbox"
          checked={snow}
          onChange={(e) => setSnow(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-[11px] text-white/55">Colour snow separately</span>
      </label>
    </div>
  );
}
