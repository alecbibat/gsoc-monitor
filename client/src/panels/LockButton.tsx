// The header padlock shared by the desktop floating panel and the mobile card
// deck. Lives in its own file so the mobile chunk doesn't drag react-rnd in
// through Panel.tsx.

// Padlock: closed shackle when locked, swung open when not.
export function LockIcon({ locked, size = 13 }: { locked: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      {locked ? <path d="M7 11V7a5 5 0 0 1 10 0v4" /> : <path d="M7 11V7a5 5 0 0 1 9.9-1" />}
    </svg>
  );
}

// Header lock toggle. A locked panel survives the "one popup at a time" rule
// (see panelStore.open), so the title says what the click will do.
export function LockButton({
  locked,
  onToggle,
  size,
}: {
  locked: boolean;
  onToggle: () => void;
  size?: number;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={locked ? 'Unlock panel' : 'Lock panel'}
      aria-pressed={locked}
      title={
        locked
          ? 'Locked — stays open when you click elsewhere on the map. Click to unlock.'
          : 'Lock — keep this window open when you click elsewhere on the map.'
      }
      className={`rounded p-1 ${
        locked
          ? 'bg-accent/15 text-accent hover:bg-accent/25'
          : 'text-white/40 hover:bg-white/10 hover:text-white'
      }`}
    >
      <LockIcon locked={locked} size={size} />
    </button>
  );
}
