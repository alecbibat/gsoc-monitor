export const config = {
  port: Number(process.env.PORT) || 5174,
  nwsUserAgent: process.env.NWS_USER_AGENT || 'gsoc-monitor (no-contact-set)',
  // BestTime.app private API key for live venue busyness (Pentagon Pizza widget).
  // When unset, the widget falls back to its modeled time-of-day signal.
  besttimeApiKey: process.env.BESTTIME_API_KEY_PRIVATE || '',
};
