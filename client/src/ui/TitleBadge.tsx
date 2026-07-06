import { useEffect } from 'react';
import { useAlertsStatus } from '../layers/alerts/alertsStore';
import { useCrisisStore } from '../crisis/crisisStore';

const BASE_TITLE = 'GSOC Monitor';

// Headless: mirrors the operational state into the browser tab title so a
// backgrounded tab still reads as a status indicator ("⚠ CRISIS · …",
// "(214) …"). An active crisis outranks the alert count.
export function TitleBadge() {
  const alertCount = useAlertsStatus((s) => s.count);
  const activeCrises = useCrisisStore(
    (s) => s.incidents.filter((i) => i.incidentStatus === 'active').length
  );

  useEffect(() => {
    if (activeCrises > 0) document.title = `⚠ CRISIS (${activeCrises}) · ${BASE_TITLE}`;
    else if (alertCount > 0) document.title = `(${alertCount}) ${BASE_TITLE}`;
    else document.title = BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [alertCount, activeCrises]);

  return null;
}
