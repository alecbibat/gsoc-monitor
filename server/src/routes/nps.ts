import { Router } from 'express';
import { npsApiStatus } from '../nps/api';
import { getNpsAlerts } from '../nps/alerts';
import { getNpsNews } from '../nps/news';
import { NPS_PARKS } from '../nps/parks';

// ── /api/nps — National Park Service Data API ────────────────────────────────
//   GET /alerts  alerts in effect at the followed parks (the popup notifier)
//   GET /news    their latest news releases
//   GET /feed    both at once, for the ticker and the National Parks panel;
//                one feed failing doesn't hide the other
//   GET /status  key configured? quota left? last error? (no secrets)
// Every upstream call is cached and shared by all viewers (see nps/*.ts).

const router = Router();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

router.get('/alerts', async (_req, res) => {
  try {
    res.json(await getNpsAlerts());
  } catch (err) {
    // An error, not an empty list: see getNpsAlerts.
    res.status(502).json({ error: 'NPS alerts unavailable', detail: message(err) });
  }
});

router.get('/news', async (_req, res) => {
  try {
    res.json(await getNpsNews());
  } catch (err) {
    res.status(502).json({ error: 'NPS news unavailable', detail: message(err) });
  }
});

router.get('/feed', async (_req, res) => {
  const [alerts, news] = await Promise.allSettled([getNpsAlerts(), getNpsNews()]);
  const api = npsApiStatus();
  if (alerts.status === 'rejected' && news.status === 'rejected') {
    res.status(502).json({ error: 'NPS Data API unavailable', detail: message(alerts.reason), api });
    return;
  }
  res.json({
    parks: NPS_PARKS.map(({ code, name, fullName }) => ({ code, name, fullName })),
    alerts: alerts.status === 'fulfilled' ? alerts.value.alerts : null,
    alertsFetchedAt: alerts.status === 'fulfilled' ? alerts.value.fetchedAt : null,
    alertsError: alerts.status === 'rejected' ? message(alerts.reason) : null,
    news: news.status === 'fulfilled' ? news.value.news : null,
    newsFetchedAt: news.status === 'fulfilled' ? news.value.fetchedAt : null,
    newsError: news.status === 'rejected' ? message(news.reason) : null,
    api,
  });
});

router.get('/status', (_req, res) => {
  res.json(npsApiStatus());
});

export default router;
