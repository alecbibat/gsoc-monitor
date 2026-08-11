import { useFireOutlookStore } from './fireOutlookStore';
import { fmtOutlookDate } from './fireOutlookMeta';

export function FireOutlookControls() {
  const day = useFireOutlookStore((s) => s.day);
  const setDay = useFireOutlookStore((s) => s.setDay);
  const dates = useFireOutlookStore((s) => s.dates);

  return (
    <div className="mt-2 space-y-2">
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/30">
          Outlook day
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <button
              key={i}
              onClick={() => setDay(i)}
              title={fmtOutlookDate(dates[i])}
              className={`flex-1 rounded px-0.5 py-1 text-[11px] font-semibold transition ${
                day === i
                  ? 'bg-amber-500/25 text-amber-300'
                  : 'bg-white/5 text-white/45 hover:bg-white/10'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        {dates[day] && (
          <div className="mt-1 text-center text-[11px] text-white/55">{fmtOutlookDate(dates[day])}</div>
        )}
      </div>
      {/* The category color key lives on the map itself (FireOutlookLegend via
          MapLegends). */}
    </div>
  );
}
