export const config = {
  port: Number(process.env.PORT) || 5174,
  nwsUserAgent: process.env.NWS_USER_AGENT || 'gsoc-monitor (no-contact-set)',
  openSky: {
    clientId: process.env.OPENSKY_CLIENT_ID || '',
    clientSecret: process.env.OPENSKY_CLIENT_SECRET || '',
  },
};
