import { useEffect } from 'react';
import { useAlertsStatus } from '../layers/alerts/alertsStore';
import { useCrisisStore } from '../crisis/crisisStore';

const BASE_TITLE = 'GSOC Monitor';

// Headless: mirrors the operational state into the browser tab title so a
// backgrounded tab still reads as a status indicator ("⚠ CRISIS · …",
// "(214) …"). An active crisis outranks the alert count.
export function TitleBadge() {
  const alertCount = useAlertsStatus((s) => s.count);
  // Archived (stood-down) incidents never count, even if their stored status
  // was left 'active' — that combination kept the ⚠ CRISIS badge lit forever.
  const activeCrises = useCrisisStore(
    (s) => s.incidents.filter((i) => i.incidentStatus === 'active' && !i.archivedAt).length
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
