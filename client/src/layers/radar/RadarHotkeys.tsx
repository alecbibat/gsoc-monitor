import { useEffect } from 'react';
import { useLayersStore } from '../../store/layersStore';
import { useCrisisStore } from '../../crisis/crisisStore';
import { useMeasureStore } from '../../measure/measureStore';
import { useFuelZoneStore } from '../../fuelzone/fuelZoneStore';
import { useScreensaverStore } from '../../screensaver/screensaverStore';
import { useHoverStore } from '../../screensaver/hoverStore';
import { useRiskReportStore } from '../../riskreport/riskReportStore';
import { usePickChooserStore } from '../../panels/pickChooserStore';
import { radarPlayhead } from './radarPlayhead';
import { radarKeyAction, runRadarKeyAction } from './radarKeys';

// Another mode owns the keyboard (and usually the screen): the crisis
// workspace or its map drawing, the measure / fuel-zone tools, a tour, the
// wildfire risk report, the pick chooser.
function radarKeysBlocked(): boolean {
  const crisis = useCrisisStore.getState();
  const hover = useHoverStore.getState();
  return (
    crisis.open ||
    crisis.activeDrawLayerId !== null ||
    useMeasureStore.getState().active ||
    useFuelZoneStore.getState().active ||
    useScreensaverStore.getState().active ||
    hover.active ||
    hover.picking ||
    useRiskReportStore.getState().target !== null ||
    usePickChooserStore.getState().open
  );
}

// Page-wide radar loop keys while the layer is on: Space play/pause, ←/→ step
// a frame (Shift: three), Home/End oldest/latest. Operator app only — on the
// share page Space must keep scrolling the report.
export function RadarHotkeys() {
  const active = useLayersStore((s) => s.active.radar);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const action = radarKeyAction(e, {
        active: radarPlayhead.get().total >= 2,
        blocked: radarKeysBlocked(),
      });
      if (!action) return;
      e.preventDefault();
      runRadarKeyAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  return null;
}
