import { usePanelStore } from './panelStore';
import { Panel } from './Panel';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { PanelContent, panelAccent } from './PanelContent';
import { MobilePanelDeck } from './MobilePanelDeck';
import { useIsMobile } from '../ui/useIsMobile';

export function PanelManager() {
  const panels = usePanelStore((s) => s.panels);
  const isMobile = useIsMobile();

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
