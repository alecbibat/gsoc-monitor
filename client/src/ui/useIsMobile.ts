import { useEffect, useState } from 'react';

// True when the viewport is phone-sized (below Tailwind's `md` breakpoint).
// On mobile the floating/dockable panel UX is replaced by a full-width,
// swipeable card deck, and the drag-to-dock zones are dropped entirely.
const QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
