import { afterAll, describe, expect, it, vi } from 'vitest';

// In-memory localStorage: the persisted stores need one at import (node has none).
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function saved(storage: MemoryStorage, key: string): Record<string, unknown> {
  return JSON.parse(storage.getItem(key) ?? 'null')?.state;
}

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('share page radar preferences', () => {
  it("reads and writes the share-only key, never the operator's", async () => {
    const storage = new MemoryStorage();
    storage.setItem('gsoc-radar', JSON.stringify({ state: { palette: 'vivid', speed: 2 }, version: 1 }));
    storage.setItem('gsoc-share-radar', JSON.stringify({ state: { palette: 'rainviewer', speed: 0.5 }, version: 1 }));
    vi.stubGlobal('localStorage', storage);

    const { useRadarStore } = await import('../layers/radar/radarStore');
    expect(useRadarStore.getState().palette).toBe('vivid'); // hydrated from the operator's key at import
    await import('./CrisisShareGlobe');
    expect(useRadarStore.getState().palette).toBe('rainviewer');
    expect(useRadarStore.getState().speed).toBe(0.5);

    useRadarStore.getState().setPalette('classic');
    expect(saved(storage, 'gsoc-share-radar')?.palette).toBe('classic');
    expect(saved(storage, 'gsoc-radar')).toEqual({ palette: 'vivid', speed: 2 });
  }, 60_000);
});
