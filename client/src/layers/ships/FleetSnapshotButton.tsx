import { useEffect, useRef, useState } from 'react';

// The snapshot renderer carries ~100 kB of packed coastline data, so it's
// loaded on demand — prefetched when the button mounts so the click itself
// stays inside the user-gesture window that the clipboard API needs.
const loadSnapshotModule = () => import('./fleetSnapshot');

type Phase = 'idle' | 'busy' | 'both' | 'copied' | 'downloaded' | 'error';

// One-click fleet-snapshot button for the daily digest — copies the PNG to
// the clipboard and downloads it. Two skins: 'header' matches the dashboard
// header's bordered buttons, 'sidebar' matches the accent quick-action style
// (like "Track the ISS").
export function FleetSnapshotButton({ variant }: { variant: 'header' | 'sidebar' }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadSnapshotModule().catch(() => undefined); // warm the chunk; retried on click
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const run = async () => {
    if (phase === 'busy') return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setPhase('busy');
    setError(null);
    const result = await loadSnapshotModule()
      .then((m) => m.copyFleetSnapshot())
      .catch((err: unknown) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : 'Failed to load the snapshot renderer',
      }));
    if (result.ok) {
      setPhase(result.copied ? (result.downloadStarted ? 'both' : 'copied') : 'downloaded');
    } else {
      setPhase('error');
      setError(result.error);
    }
    resetTimer.current = setTimeout(() => setPhase('idle'), 4_000);
  };

  const label =
    phase === 'busy'
      ? 'Rendering snapshot…'
      : phase === 'both'
        ? '✓ Copied & PNG downloaded'
        : phase === 'copied'
          ? "✓ Copied (download didn't start)"
          : phase === 'downloaded'
            ? '✓ PNG downloaded (clipboard unavailable)'
            : phase === 'error'
              ? `Failed: ${error ?? 'unknown error'}`
              : variant === 'header'
                ? '🚢 Copy fleet snapshot'
                : '📸 Copy fleet snapshot';

  const done = phase === 'both' || phase === 'copied' || phase === 'downloaded';

  if (variant === 'header') {
    return (
      <button
        onClick={run}
        disabled={phase === 'busy'}
        title="Copy an image of all ship positions + status table to the clipboard and download it as a PNG"
        className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition ${
          done
            ? 'border-accent-ok/40 bg-accent-ok/10 text-accent-ok'
            : phase === 'error'
              ? 'border-accent-danger/40 bg-accent-danger/10 text-accent-danger'
              : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
        } ${phase === 'busy' ? 'cursor-wait opacity-60' : ''}`}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      onClick={run}
      disabled={phase === 'busy'}
      title="Copy an image of all ship positions + status table to the clipboard and download it as a PNG"
      className={`mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px] font-medium transition ${
        done
          ? 'border-accent-ok/30 bg-accent-ok/10 text-accent-ok'
          : phase === 'error'
            ? 'border-accent-danger/30 bg-accent-danger/10 text-accent-danger'
            : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
      } ${phase === 'busy' ? 'cursor-wait opacity-60' : ''}`}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
