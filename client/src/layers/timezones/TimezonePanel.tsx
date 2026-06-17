import { useEffect, useState } from 'react';

interface Payload {
  offset: number;
  label: string;
  tzName: string;
}

function currentTimeAt(utcHours: number): string {
  const now = Date.now();
  const offsetMs = utcHours * 3_600_000;
  const d = new Date(now + new Date().getTimezoneOffset() * 60_000 + offsetMs);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function currentDateAt(utcHours: number): string {
  const now = Date.now();
  const offsetMs = utcHours * 3_600_000;
  const d = new Date(now + new Date().getTimezoneOffset() * 60_000 + offsetMs);
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function TimezonePanel({ payload }: { payload: Record<string, unknown> }) {
  const { offset, label, tzName } = payload as unknown as Payload;
  const [time, setTime] = useState(() => currentTimeAt(offset));
  const [date, setDate] = useState(() => currentDateAt(offset));

  useEffect(() => {
    const tick = () => {
      setTime(currentTimeAt(offset));
      setDate(currentDateAt(offset));
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [offset]);

  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/35">
        {label}
        {tzName !== label && (
          <span className="ml-2 font-normal normal-case tracking-normal text-white/25">
            {tzName}
          </span>
        )}
      </div>

      <div className="font-mono text-[52px] font-bold leading-none tabular-nums text-white/92 tracking-tight">
        {time}
      </div>

      <div className="text-[12px] text-white/40">{date}</div>
    </div>
  );
}
