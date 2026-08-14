import { type ReactNode } from 'react';
import { useSectionsStore } from './uiStore';

export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  // Collapse state persists across reloads (keyed by title); a section the
  // operator has never toggled follows its default.
  const collapsed = useSectionsStore((s) => s.collapsed[title]);
  const setCollapsed = useSectionsStore((s) => s.setCollapsed);
  const open = collapsed === undefined ? defaultOpen : !collapsed;
  return (
    <div className="border-b border-white/5 py-2">
      <button
        onClick={() => setCollapsed(title, open)}
        className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/60"
      >
        {title}
        <span className={`transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}>▾</span>
      </button>
      {open && <div className="mt-1 space-y-1">{children}</div>}
    </div>
  );
}
