import { usePanelStore } from './panelStore';
import { Panel } from './Panel';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { PanelContent, panelAccent } from './PanelContent';
import { MobilePanelDeck } from './MobilePanelDeck';
import { useIsMobile } from '../ui/useIsMobile';
import { useScreensaverStore } from '../screensaver/screensaverStore';

export function PanelManager() {
  const panels = usePanelStore((s) => s.panels);
  const screensaverActive = useScreensaverStore((s) => s.active);
  const isMobile = useIsMobile();

  // Hide all floating panels while the screensaver is running — the ambient
  // scene shouldn't have chrome floating over it. Panels remain in the store
  // and reappear when the screensaver stops.
  if (screensaverActive) return null;

  // On phones, floating/dockable windows are replaced by a single swipeable
  // card deck (no drag, resize, or dock zones).
  if (isMobile) return <MobilePanelDeck />;

  return (
    <>
      {panels.map((panel) => (
        <Panel key={panel.id} panel={panel} accentClass={panelAccent(panel.kind)}>
          <PanelErrorBoundary>
            <PanelContent panel={panel} />
          </PanelErrorBoundary>
        </Panel>
      ))}
    </>
  );
}
