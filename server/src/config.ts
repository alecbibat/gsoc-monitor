export const config = {
  port: Number(process.env.PORT) || 5174,
  nwsUserAgent: process.env.NWS_USER_AGENT || 'gsoc-monitor (no-contact-set)',
  besttimeApiKey: process.env.BESTTIME_API_KEY_PRIVATE || '',
  // aisstream.io API key — free at https://aisstream.io — add as AISSTREAM_API_KEY
  // in Heroku Config Vars. Without it the layer shows a no-key placeholder.
  aisstreamApiKey: process.env.AISSTREAM_API_KEY || '',
  // NPS Data API key — free at https://www.nps.gov/subjects/developer/get-started.htm.
  // DEMO_KEY works out of the box (rate-limited); set NPS_API_KEY in Config Vars
  // for production headroom. Used for park news releases + alerts/closures.
  npsApiKey: process.env.NPS_API_KEY || 'DEMO_KEY',
};
