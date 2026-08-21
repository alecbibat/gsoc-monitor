import { useEffect } from 'react';
import { selectActiveCrisisCount, useCrisisStore } from '../crisis/crisisStore';

const BASE_TITLE = 'GSOC Monitor';

// Headless: mirrors crisis response into the browser tab title so a
// backgrounded tab still reads as a status indicator. The only number the
// title ever shows is the count of open Active incidents ("⚠ CRISIS (2) · …");
// with none, the title stays bare.
export function TitleBadge() {
  const activeCrises = useCrisisStore(selectActiveCrisisCount);

  useEffect(() => {
    document.title =
      activeCrises > 0 ? `⚠ CRISIS (${activeCrises}) · ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [activeCrises]);

  return null;
}
