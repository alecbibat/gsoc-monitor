export const config = {
  port: Number(process.env.PORT) || 5174,
  nwsUserAgent: process.env.NWS_USER_AGENT || 'gsoc-monitor (no-contact-set)',
  besttimeApiKey: process.env.BESTTIME_API_KEY_PRIVATE || '',
  // aisstream.io API key — free at https://aisstream.io — add as AISSTREAM_API_KEY
  // in Heroku Config Vars. Without it the layer shows a no-key placeholder.
  aisstreamApiKey: process.env.AISSTREAM_API_KEY || '',
  // Optional paid AIS providers for reliable by-IMO positions (free aisstream
  // can't always see the fleet). Set EITHER one and the server polls the fleet's
  // positions and drops them onto the map as pins. VesselFinder is self-serve
  // (https://api.vesselfinder.com); MyShipTracking is the other supported option.
  vesselfinderApiKey: process.env.VESSELFINDER_API_KEY || '',
  myshiptrackingApiKey: process.env.MYSHIPTRACKING_API_KEY || '',
  // Free fallback: scrape CruiseMapper's public ship pages by IMO when no paid
  // key is set. CruiseMapper carries satellite-AIS positions (it sees the fleet
  // at sea, unlike free aisstream) but sits behind Cloudflare, so a plain server
  // fetch may be blocked — watch /api/ships/debug to see if it gets through.
  // Set SHIPS_SCRAPE_CRUISEMAPPER=0 to disable.
  cruisemapperScrape: process.env.SHIPS_SCRAPE_CRUISEMAPPER !== '0',
  // NPS Data API key — free at https://www.nps.gov/subjects/developer/get-started.htm.
  // DEMO_KEY works out of the box (rate-limited); set NPS_API_KEY in Config Vars
  // for production headroom. Used for park news releases + alerts/closures.
  npsApiKey: process.env.NPS_API_KEY || 'DEMO_KEY',
  // State DOT traffic-camera keys (free per-state developer keys) power the
  // webcam layer. California (Caltrans) needs none. Read directly from env in
  // routes/webcams.ts: AZ511_API_KEY, GA511_API_KEY, FL511_API_KEY,
  // WI511_API_KEY. Add more states there as their endpoints are confirmed.
};
