import { useScreensaverStore } from './screensaverStore';

const ICON: Record<string, string> = {
  earthquake: '⚡',
  weather: '⚠️',
  landmark: '◎',
  hurricane: '🌀',
};

const LABEL_COLOR: Record<string, string> = {
  earthquake: 'text-accent-warn',
  weather: 'text-accent-danger',
  landmark: 'text-accent',
  hurricane: 'text-pink-400',
};

const LABEL: Record<string, string> = {
  earthquake: 'SEISMIC',
  weather: 'WEATHER ALERT',
  landmark: 'POINT OF INTEREST',
  hurricane: 'TROPICAL CYCLONE',
};

export function ScreensaverToast() {
  const active = useScreensaverStore((s) => s.active);
  const phase = useScreensaverStore((s) => s.phase);
  const poi = useScreensaverStore((s) => s.currentPoi);

  const visible = active && phase === 'at-poi' && poi !== null;

  return (
    <div
      className={`pointer-events-none absolute bottom-10 left-1/2 z-30 -translate-x-1/2 transition-all duration-700 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      {poi && (
        <div className="min-w-[320px] max-w-[520px] rounded-xl border border-white/10 bg-ink-900/90 px-6 py-4 shadow-2xl backdrop-blur-md">
          <div className="mb-1 text-[10px] font-semibold tracking-[0.2em] text-white/30">
            {LABEL[poi.category] ?? 'MONITORING'}
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-xl leading-none">{ICON[poi.category] ?? '◎'}</span>
            <div className="min-w-0">
              <div className={`text-[15px] font-bold leading-tight ${LABEL_COLOR[poi.category] ?? 'text-accent'}`}>
                {poi.title}
              </div>
              <div className="mt-1 text-[12px] leading-snug text-white/60">
                {poi.description}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
