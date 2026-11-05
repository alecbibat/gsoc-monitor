import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Notice, NoticeCategory } from './notices';

// Alert-popup notifications: the master switch and one switch per kind
// (persisted per browser, all on by default), and the queue of notices
// waiting to be acknowledged.

const ALL_ON: Record<NoticeCategory, boolean> = { nws: true, warn: true, quake: true, nps: true, flight: true, ship: true };

interface AlertNotifyState {
  enabled: boolean;
  categories: Record<NoticeCategory, boolean>;
  /** The popup shows the head; the rest wait most urgent first (see `enqueue`). */
  queue: Notice[];
  /** Keys and aliases announced this session: one event, one popup. */
  announced: ReadonlySet<string>;
  /** Bumped per batch of new notices — each bump replays the screen flash. */
  flashSeq: number;
  /** Colour of the flash: the most urgent notice in the latest batch. */
  flashColor: string;
  toggle: () => void;
  setCategory: (category: NoticeCategory, on: boolean) => void;
  push: (notices: Notice[]) => void;
  dismiss: (key: string) => void;
  dismissAll: () => void;
}

type Settings = Pick<AlertNotifyState, 'enabled' | 'categories'>;

/**
 * The card on screen stays put, so it never swaps out from under a click;
 * everything behind it waits most urgent first, in arrival order among equals
 * (the sort is stable). A batch into an empty queue leads with its most urgent.
 */
export function enqueue(queue: readonly Notice[], added: readonly Notice[]): Notice[] {
  const [head, ...waiting] = queue;
  const rest = [...waiting, ...added].sort((a, b) => b.rank - a.rank);
  return head ? [head, ...rest] : rest;
}

/**
 * Saved settings over the defaults. A kind added later starts on, rather than
 * reading as off because an older browser's saved settings never mentioned it.
 */
export function mergeNotifySettings<S extends Settings>(persisted: unknown, current: S): S {
  const p = (persisted ?? {}) as Partial<Settings>;
  return {
    ...current,
    ...(typeof p.enabled === 'boolean' ? { enabled: p.enabled } : {}),
    categories: { ...current.categories, ...(p.categories ?? {}) },
  };
}

export const useAlertNotifyStore = create<AlertNotifyState>()(
  persist(
    (set) => ({
      enabled: true,
      categories: { ...ALL_ON },
      queue: [],
      announced: new Set(),
      flashSeq: 0,
      flashColor: '#ff5d5d',
      // Turning notifications off also clears anything still on screen.
      toggle: () => set((s) => (s.enabled ? { enabled: false, queue: [] } : { enabled: true })),
      setCategory: (category, on) =>
        set((s) => ({
          categories: { ...s.categories, [category]: on },
          queue: on ? s.queue : s.queue.filter((n) => n.category !== category),
        })),
      push: (notices) =>
        set((s) => {
          const announced = new Set(s.announced);
          const added: Notice[] = [];
          for (const n of notices) {
            if (!s.categories[n.category]) continue;
            const keys = [n.key, ...(n.aliases ?? [])];
            if (keys.some((k) => announced.has(k))) continue;
            keys.forEach((k) => announced.add(k));
            added.push(n);
          }
          if (added.length === 0) return {};
          const lead = added.reduce((a, b) => (b.rank > a.rank ? b : a));
          return { queue: enqueue(s.queue, added), announced, flashSeq: s.flashSeq + 1, flashColor: lead.color };
        }),
      dismiss: (key) => set((s) => ({ queue: s.queue.filter((n) => n.key !== key) })),
      dismissAll: () => set({ queue: [] }),
    }),
    {
      name: 'gsoc-alert-notify',
      partialize: (s) => ({ enabled: s.enabled, categories: s.categories }),
      merge: mergeNotifySettings,
    }
  )
);
