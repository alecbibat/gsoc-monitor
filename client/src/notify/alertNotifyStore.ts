import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AlertNotice } from './pinAlertMatch';

// NWS-alert-near-a-pin notifications: the on/off switch (persisted per
// browser, on by default) and the queue of notices waiting to be acknowledged.

interface AlertNotifyState {
  enabled: boolean;
  /** Oldest first; the popup shows the head. */
  queue: AlertNotice[];
  /** Bumped per batch of new notices — each bump replays the screen flash. */
  flashSeq: number;
  /** Colour of the flash: the most severe notice in the latest batch. */
  flashColor: string;
  toggle: () => void;
  push: (notices: AlertNotice[], flashColor: string) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

export const useAlertNotifyStore = create<AlertNotifyState>()(
  persist(
    (set) => ({
      enabled: true,
      queue: [],
      flashSeq: 0,
      flashColor: '#ff5d5d',
      // Turning notifications off also clears anything still on screen.
      toggle: () => set((s) => (s.enabled ? { enabled: false, queue: [] } : { enabled: true })),
      push: (notices, flashColor) =>
        set((s) => {
          const have = new Set(s.queue.map((n) => n.id));
          const added = notices.filter((n) => !have.has(n.id));
          if (added.length === 0) return {};
          return { queue: [...s.queue, ...added], flashSeq: s.flashSeq + 1, flashColor };
        }),
      dismiss: (id) => set((s) => ({ queue: s.queue.filter((n) => n.id !== id) })),
      dismissAll: () => set({ queue: [] }),
    }),
    { name: 'gsoc-alert-notify', partialize: (s) => ({ enabled: s.enabled }) }
  )
);
