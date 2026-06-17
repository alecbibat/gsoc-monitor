import { useMeasureStore } from './measureStore';
import {
  totalDistanceM,
  polygonAreaM2,
  perimeterM,
  formatDistance,
  formatArea,
} from './measureMath';

function ModeButton({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] font-semibold tracking-wide transition ${
        on ? 'bg-accent/20 text-accent' : 'bg-white/5 text-white/50 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-white/10 bg-ink-900/80 px-2.5 py-1 text-[11px] font-semibold text-white/60 transition hover:text-white disabled:opacity-30"
    >
      {label}
    </button>
  );
}

// Floating control + live readout for the measure tool. Only mounts while the
// tool is active.
export function MeasureOverlay() {
  const active = useMeasureStore((s) => s.active);
  const mode = useMeasureStore((s) => s.mode);
  const points = useMeasureStore((s) => s.points);
  const finished = useMeasureStore((s) => s.finished);
  const setMode = useMeasureStore((s) => s.setMode);
  const undo = useMeasureStore((s) => s.undo);
  const clear = useMeasureStore((s) => s.clear);
  const finish = useMeasureStore((s) => s.finish);
  const exit = useMeasureStore((s) => s.exit);

  if (!active) return null;

  const distance = totalDistanceM(points);
  const area = polygonAreaM2(points);
  const perim = perimeterM(points);

  const readout =
    mode === 'distance' ? (
      <div className="flex flex-col">
        <span className="font-mono text-[15px] font-bold tabular-nums text-accent">
          {points.length >= 2 ? formatDistance(distance) : '—'}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-white/35">
          path distance{points.length > 0 ? ` · ${points.length} pts` : ''}
        </span>
      </div>
    ) : (
      <div className="flex flex-col">
        <span className="font-mono text-[15px] font-bold tabular-nums text-accent">
          {points.length >= 3 ? formatArea(area) : '—'}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-white/35">
          {points.length >= 3 ? `area · perimeter ${formatDistance(perim)}` : 'area'}
        </span>
      </div>
    );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-3">
      <div className="pointer-events-auto flex flex-col gap-2.5 rounded-xl border border-white/10 bg-ink-900/90 p-3 shadow-panel backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-black/30 p-0.5">
            <ModeButton
              label="DISTANCE"
              on={mode === 'distance'}
              onClick={() => setMode('distance')}
            />
            <ModeButton label="AREA" on={mode === 'area'} onClick={() => setMode('area')} />
          </div>
          <div className="min-w-[150px]">{readout}</div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-white/30">
            {finished ? 'Done — clear to restart' : 'Click to add · double-click to finish'}
          </span>
          <div className="flex items-center gap-1.5">
            <ActionButton label="Undo" onClick={undo} disabled={points.length === 0} />
            <ActionButton label="Clear" onClick={clear} disabled={points.length === 0} />
            {!finished && (
              <ActionButton
                label="Finish"
                onClick={finish}
                disabled={
                  (mode === 'distance' && points.length < 2) ||
                  (mode === 'area' && points.length < 3)
                }
              />
            )}
            <button
              onClick={exit}
              className="rounded border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
