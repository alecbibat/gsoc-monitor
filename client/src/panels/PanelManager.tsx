import { lazy, Suspense } from 'react';
import { usePanelStore } from './panelStore';
import { useIsMobile } from '../ui/useIsMobile';
import { useScreensaverStore } from '../screensaver/screensaverStore';

// Panels only exist after a user click, so the whole shell + content tree
// (react-rnd, every *Details view, the widget registry) loads on demand; a
// blank frame while the chunk fetches is imperceptible.
const PanelHost = lazy(() => import('./PanelHost').then((m) => ({ default: m.PanelHost })));
const MobilePanelDeck = lazy(() =>
  import('./MobilePanelDeck').then((m) => ({ default: m.MobilePanelDeck }))
);

export function PanelManager() {
  const panels = usePanelStore((s) => s.panels);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const isMobile = useIsMobile();

  // Hide all floating panels while the screensaver is running — the ambient
  // scene shouldn't have chrome floating over it. Panels remain in the store
  // and reappear when the screensaver stops.
  if (screensaverActive) return null;

  if (panels.length === 0) return null;

  // On phones, floating/dockable windows are replaced by a single swipeable
  // card deck (no drag, resize, or dock zones).
  if (isMobile) {
    return (
      <Suspense fallback={null}>
        <MobilePanelDeck />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      {panels.map((panel) => (
        <PanelHost key={panel.id} panel={panel} />
      ))}
    </Suspense>
  );
}
