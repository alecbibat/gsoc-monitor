import { useEffect, useRef, useState } from 'react';
import { useAlertNotifyStore } from './alertNotifyStore';
import { NOTICE_CATEGORIES } from './notices';

function BellIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

const buttonClass = (on: boolean) =>
  `pointer-events-auto flex items-center justify-center rounded-lg border p-2 shadow-panel backdrop-blur-sm transition-all ${
    on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
  }`;

/**
 * The alert-popup bell. `simple` is a plain on/off toggle — for the mobile
 * tools menu, which closes on any click inside it; otherwise the bell opens a
 * menu with the master switch and one switch per kind of popup.
 */
export function NotifyMenu({ simple = false }: { simple?: boolean }) {
  const enabled = useAlertNotifyStore((s) => s.enabled);
  const categories = useAlertNotifyStore((s) => s.categories);
  const toggle = useAlertNotifyStore((s) => s.toggle);
  const setCategory = useAlertNotifyStore((s) => s.setCategory);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (simple) {
    return (
      <button
        onClick={toggle}
        aria-pressed={enabled}
        className={buttonClass(enabled)}
        title={enabled ? 'Alert popups on. Tap to turn off.' : 'Alert popups off. Tap to turn on.'}
        aria-label={enabled ? 'Turn off alert popups' : 'Turn on alert popups'}
      >
        <BellIcon off={!enabled} />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={buttonClass(enabled)}
        title="Alert popups: what flashes the screen and opens a popup"
        aria-label="Alert popup settings"
      >
        <BellIcon off={!enabled} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Alert popups"
          className="pointer-events-auto absolute left-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-white/12 bg-ink-900/95 text-white shadow-2xl backdrop-blur-md"
        >
          <label className="flex cursor-pointer items-center gap-2.5 border-b border-white/8 px-3 py-2.5">
            <span className="flex-1">
              <span className="block text-[12.5px] font-semibold text-white/90">Alert popups</span>
              <span className="block text-[10.5px] text-white/40">Flash the screen and open a popup</span>
            </span>
            <input type="checkbox" checked={enabled} onChange={toggle} className="h-4 w-4 accent-accent" />
          </label>
          <div className={`py-1 ${enabled ? '' : 'opacity-50'}`}>
            {NOTICE_CATEGORIES.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-start gap-2.5 px-3 py-1.5 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={categories[c.id]}
                  disabled={!enabled}
                  onChange={(e) => setCategory(c.id, e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-white/85">{c.label}</span>
                  <span className="block text-[10.5px] leading-snug text-white/40">{c.detail}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="border-t border-white/8 px-3 py-1.5 text-[10px] text-white/30">Saved in this browser.</p>
        </div>
      )}
    </div>
  );
}
