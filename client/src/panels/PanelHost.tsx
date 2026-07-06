import { Panel } from './Panel';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { PanelContent, panelAccent } from './PanelContent';
import type { PanelData } from './panelStore';

// One desktop floating panel: the draggable shell wrapping its content view.
// Lives behind a lazy() boundary in PanelManager so react-rnd and the ~20
// detail views stay out of the entry chunk until a panel actually opens.
export function PanelHost({ panel }: { panel: PanelData }) {
  return (
    <Panel panel={panel} accentClass={panelAccent(panel.kind)}>
      <PanelErrorBoundary>
        <PanelContent panel={panel} />
      </PanelErrorBoundary>
    </Panel>
  );
}
