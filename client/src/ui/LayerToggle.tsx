import type { ReactNode } from 'react';

interface Props {
  label: string;
  active: boolean;
  onToggle: () => void;
  statusText?: string;
  children?: ReactNode;
}

export function LayerToggle({ label, active, onToggle, statusText, children }: Props) {
  return (
    <div className="px-1">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-white/5"
      >
        <span className="text-[13px] text-white/85">{label}</span>
        <span
          className={`relative h-4 w-7 shrink-0 rounded-full transition ${
            active ? 'bg-accent/70' : 'bg-white/15'
          }`}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
              active ? 'translate-x-3.5' : 'translate-x-0.5'
            }`}
          />
        </span>
      </button>
      {statusText && active && (
        <div className="px-2 text-[11px] text-white/40">{statusText}</div>
      )}
      {active && children && <div className="px-2 pb-1">{children}</div>}
    </div>
  );
}
