import { useScreensaverStore } from '../screensaver/screensaverStore';

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {muted ? (
        <line x1="23" y1="9" x2="17" y2="15" />
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
      {muted && <line x1="17" y1="9" x2="23" y2="15" />}
    </svg>
  );
}

// One button runs the pins tour (orbit each tracked property and ship with a
// cinematic close-up): click to start it, click again to stop. The voice
// announce toggle sits beside it while the tour runs.
export function ScreensaverControls({ className = '' }: { className?: string }) {
  const active       = useScreensaverStore((s) => s.active);
  const voiceEnabled = useScreensaverStore((s) => s.voiceEnabled);
  const toggleVoice  = useScreensaverStore((s) => s.toggleVoice);

  const toggleTour = () => {
    const ss = useScreensaverStore.getState();
    if (ss.active) ss.stop();
    else ss.toggle('pins');
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* Voice announce toggle — only shown while screensaver is running */}
      {active && (
        <button
          onClick={toggleVoice}
          title={voiceEnabled ? 'Mute location announcements' : 'Announce location names aloud'}
          className={`pointer-events-auto flex items-center justify-center rounded-lg border p-2 shadow-panel backdrop-blur-sm transition-all ${
            voiceEnabled
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-white/10 bg-ink-900/80 text-white/30 hover:text-white/60'
          }`}
          aria-label={voiceEnabled ? 'Mute announcements' : 'Enable announcements'}
        >
          <SpeakerIcon muted={!voiceEnabled} />
        </button>
      )}
      <button
        onClick={toggleTour}
        aria-pressed={active}
        className={`pointer-events-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold tracking-widest shadow-panel backdrop-blur-sm transition-all ${
          active
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-white/10 bg-ink-900/80 text-white/40 hover:text-white/70'
        }`}
        title={active ? 'Stop the screensaver' : 'Start the screensaver: tour each property and ship'}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${active ? 'animate-pulse bg-accent' : 'bg-white/20'}`} />
        <span className="uppercase">Screensaver</span>
      </button>
    </div>
  );
}
