import { create } from 'zustand';

// Unsaved-changes flag for the admin page's template editors. An editor sets it
// while its draft differs from what the server has; the page shell checks it
// before closing, switching section, or leaving via the browser.

interface AdminDirtyState {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
}

export const useAdminDirtyStore = create<AdminDirtyState>((set) => ({
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
}));

/** Ask before discarding unsaved edits; true = go ahead. */
export function confirmDiscardIfDirty(): boolean {
  if (!useAdminDirtyStore.getState().dirty) return true;
  const ok = window.confirm('You have unsaved changes. Discard them?');
  if (ok) useAdminDirtyStore.getState().setDirty(false);
  return ok;
}
