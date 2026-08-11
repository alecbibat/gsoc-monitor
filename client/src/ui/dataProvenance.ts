import type { BasemapId, LayerId } from '../types';

export interface Provenance {
  name: string;
  icon: string;
  source: string; // who provides it
  method: string; // how it's gathered
  trust: string; // why it can be trusted
  url?: string; // canonical source link
}

// Per-layer provenance shown in the "i" info panel. Each entry explains where
// the data comes from, how it's collected, and why it's trustworthy. Order here
// is the order layers appear in the panel.
export const LAYER_PROVENANCE: Array<{ id: LayerId; info: Provenance }> = [
  {
    id: 'radar',
    info: {
      name: 'Precipitation Radar',
      icon: '🌧',
      source: 'RainViewer',
      method:
        'Aggregates national weather-service radar mosaics into map tiles, refreshed roughly every 10 minutes.',
      trust:
        'Composites official meteorological radar networks (e.g. NOAA/NWS NEXRAD in the US) — the same feed many consumer weather apps use.',
      url: 'https://www.rainviewer.com',
    },
  },
  {
    id: 'earthquakes',
    info: {
      name: 'Earthquakes',
      icon: '⚡',
      source: 'USGS Earthquake Hazards Program',
      method:
        'Real-time GeoJSON feed of seismic events from global and US seismic networks, updated within minutes of each event.',
      trust: 'The authoritative US government source and definitive public record for earthquakes.',
      url: 'https://earthquake.usgs.gov',
    },
  },
  {
    id: 'alerts',
    info: {
      name: 'NWS Alerts',
      icon: '⚠️',
      source: 'US National Weather Service',
      method:
        'Active watches, warnings and advisories pulled live from the official NWS API (api.weather.gov), each with its own polygon/zone geometry.',
      trust: "The US government's official severe-weather alerting system.",
      url: 'https://www.weather.gov',
    },
  },
  {
    id: 'flights',
    info: {
      name: 'Flights (ADS-B)',
      icon: '✈️',
      source: 'adsb.fi community network',
      method:
        'Aircraft broadcast position and altitude over ADS-B; a volunteer network of ground receivers aggregates it. We track specific tail numbers and persist their last position when the transponder goes quiet.',
      trust: "Read straight from each aircraft's own transponder; adsb.fi is an unfiltered community feed.",
      url: 'https://adsb.fi',
    },
  },
  {
    id: 'hurricanes',
    info: {
      name: 'Hurricanes',
      icon: '🌀',
      source: 'NOAA NHC + US Navy JTWC',
      method:
        'Global active tropical-cyclone positions, past + forecast tracks, intensity and forecast cones from NOAA’s ArcGIS feed (covers Atlantic, E/C Pacific, and — via the aggregated feed — W Pacific typhoons & other basins). Also overlays NHC’s Graphical Tropical Weather Outlook: the dashed "areas of disturbance" with 2-day / 7-day formation odds. In the basins NHC doesn’t cover (W Pacific, Indian Ocean, S Hemisphere), it adds JTWC "invests" — developing areas parsed from the Joint Typhoon Warning Center’s Significant Tropical Weather Advisories, with their Low / Medium / High formation potential.',
      trust: 'The official US authorities for tropical-cyclone forecasts: NHC (civilian basins) and JTWC (DoD, all other basins).',
      url: 'https://www.nhc.noaa.gov',
    },
  },
  {
    id: 'lightning',
    info: {
      name: 'Lightning',
      icon: '🌩',
      source: 'Blitzortung.org',
      method:
        'A volunteer network of ground sensors times each strike’s radio signal (time-of-arrival) to triangulate its location, streamed live.',
      trust: 'The same community network behind lightningmaps.org, widely used for real-time strike data.',
      url: 'https://www.blitzortung.org',
    },
  },
  {
    id: 'rivers',
    info: {
      name: 'Rivers & Floods',
      icon: '🌊',
      source: 'NOAA NWPS + USGS',
      method:
        'Live river-gauge levels and flood status from NOAA’s National Water Prediction Service (api.water.noaa.gov), the modern successor to AHPS. Each of ~12,700 forecast points reports its current stage (ft) or flow, classified against official flood-stage thresholds (action → minor → moderate → major) and, where issued, a multi-day forecast crest. Clicking a gauge pulls its thresholds, impact statements, recent/record crests and an observed+forecast hydrograph; the underlying monitor links back to USGS.',
      trust:
        'The authoritative US river-forecast network operated by NOAA/NWS River Forecast Centers — the same data behind water.noaa.gov and official flood warnings.',
      url: 'https://water.noaa.gov',
    },
  },
  {
    id: 'fireOutlook',
    info: {
      name: '7-Day Fire Potential',
      icon: '🔥',
      source: 'NWCG National Predictive Services',
      method:
        'The National 7-Day Significant Wildland Fire Potential Outlook (fsapps.nwcg.gov). Each Predictive Service Area is shaded by fuel dryness (normal → very dry) and flagged when significant fire potential is forecast (Critical / Ignition fire-weather conditions). Pick any of the next 7 days; click an area for its outlook.',
      trust:
        'Produced by NWCG/GACC Predictive Services fire-weather meteorologists — the operational outlook used by the US wildland-fire community.',
      url: 'https://fsapps.nwcg.gov/psp/npsg/forecast',
    },
  },
  {
    id: 'precip',
    info: {
      name: 'Precipitation Forecast',
      icon: '🌧',
      source: 'NOAA Weather Prediction Center (WPC)',
      method:
        "The WPC Quantitative Precipitation Forecast (QPF): forecast total precipitation accumulation over the selected window (24h / 48h / 72h / 5-day), shaded by amount in inches. Rendered live from the NOAA mapservices WPC QPF MapServer over CONUS; issued twice daily (06Z & 18Z).",
      trust:
        'The operational human-refined precipitation forecast produced by WPC meteorologists — the same QPF that anchors NWS flood, hydrology and winter-weather guidance.',
      url: 'https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml',
    },
  },
  {
    id: 'aqi',
    info: {
      name: 'Air Quality Index',
      icon: '🌫',
      source: 'US EPA AirNow + PurpleAir',
      method:
        'Two sources on one EPA AQI scale. Numbered badges are official EPA/state reference monitors from the AirNow Data API (airnowapi.org), reporting the dominant pollutant (PM2.5, Ozone, PM10, CO, NO₂ or SO₂). Dots are PurpleAir community PM2.5 sensors (api.purpleair.com): their raw readings are corrected with the US EPA US-wide equation (Barkjohn 2021) and converted to AQI with the 2024 PM2.5 breakpoints, so the crowd-sourced field lines up with the reference monitors.',
      trust:
        'AirNow is the definitive US government monitoring network behind AirNow.gov and public health advisories. PurpleAir is a large low-cost-sensor network; EPA-corrected, it powers the AirNow Fire & Smoke Map — far denser than the reference network, but treat individual readings as indicative rather than regulatory.',
      url: 'https://www.airnow.gov',
    },
  },
  {
    id: 'wind',
    info: {
      name: 'Wind',
      icon: '🌬',
      source: 'NOAA GFS (via Open-Meteo)',
      method:
        'Current 10 m wind (speed + direction) sampled on a global grid from NOAA’s Global Forecast System and animated client-side: thousands of particles are advected through the bilinearly interpolated field to trace the live flow, colored by wind speed.',
      trust:
        'GFS is NOAA’s flagship global numerical weather model; Open-Meteo serves it as an open, key-free API. The same model underlies most public wind maps.',
      url: 'https://www.nco.ncep.noaa.gov/pmb/products/gfs/',
    },
  },
  {
    id: 'windArrows',
    info: {
      name: 'Wind Streamlines',
      icon: '➳',
      source: 'NOAA GFS (via Open-Meteo)',
      method:
        'The same 10 m GFS wind grid as the particle layer, rendered as streamlines: from a camera-adaptive grid of seed points the flow is integrated forward into continuous glowing lines (density and length follow zoom), each capped with a directional arrowhead and colored/weighted by speed.',
      trust:
        'GFS is NOAA’s flagship global numerical weather model; Open-Meteo serves it as an open, key-free API.',
      url: 'https://www.nco.ncep.noaa.gov/pmb/products/gfs/',
    },
  },
  {
    id: 'smoke',
    info: {
      name: 'Smoke',
      icon: '💨',
      source: 'NOAA Hazard Mapping System (HMS)',
      method:
        'Smoke polygons manually delineated by NOAA analysts from GOES, MODIS, and VIIRS satellite imagery, published once or twice daily in KML format.',
      trust:
        'The official NOAA/NESDIS operational product for satellite-detected smoke plumes — the same dataset used by air-quality and fire-weather forecasters.',
      url: 'https://www.ospo.noaa.gov/Products/land/hms.html',
    },
  },
  {
    id: 'fires',
    info: {
      name: 'Wildfires',
      icon: '🔥',
      source: 'NASA FIRMS (VIIRS / MODIS)',
      method:
        'Thermal anomalies (active-fire hotspots) detected by NASA satellites over the past 24 hours, served via ArcGIS.',
      trust:
        'NASA’s Fire Information for Resource Management System — the standard source for satellite fire detection.',
      url: 'https://firms.modaps.eosdis.nasa.gov',
    },
  },
  {
    id: 'wildfires',
    info: {
      name: 'Named Fires',
      icon: '🚒',
      source: 'NIFC / WFIGS (interagency)',
      method:
        'Named, human-managed wildfire incidents from the interagency Wildland Fire Interagency Geospatial Services (WFIGS) feed — the IRWIN / ICS-209 system of record. Each active incident shows its acres, containment %, assigned personnel, incident-management complexity, and cause, plus the fire perimeter when available. Fetched live from NIFC’s ArcGIS services.',
      trust:
        'The US interagency source of record for wildfire incident reporting (NIFC), used by the agencies actually fighting the fires. Attributes update as incident-management teams file reports (≈ daily), so it lags real-time detection but names the fire and its response — which raw satellite hotspots cannot.',
      url: 'https://www.nifc.gov',
    },
  },
  {
    id: 'outages',
    info: {
      name: 'Power Outages',
      icon: '⚡',
      source: 'Multi-state aggregation (18 feeds)',
      method:
        'Per-outage detail aggregated server-side from three families of public feeds: state emergency-management ArcGIS services (Cal OES statewide CA; SRP + SSVEC AZ; Minnesota Power MN/WI; Riverside PU CA), the KUBRA Storm Center data behind major utilities’ own outage maps (Oncor TX, Georgia Power + Cobb EMC GA, JEA FL, Colorado Springs Utilities CO, LG&E/KU KY, Evergy KS/MO, Versant ME, Appalachian Power VA/WV/TN), and NISC co-op outage maps (Sawnee GA, SLEMCO LA, Price Electric WI, Cloverland MI). Each outage carries the utility, start + estimated-restoration times, cause, and impacted customers where the utility reports them.',
      trust:
        'Every source is either a state-government aggregation or the same data a utility’s own public outage map renders — but utility map endpoints are unofficial and can change without notice, and coverage is ~19 states, not nationwide (no free, sanctioned national per-outage feed exists: PowerOutage.us is paid and prohibits scraping). During large storms, dense areas may collapse into aggregated cluster markers.',
      url: 'https://gis.data.ca.gov',
    },
  },
  {
    id: 'fuel',
    info: {
      name: 'Surface Fuel Models',
      icon: '🌾',
      source: 'LANDFIRE (USGS / USFS)',
      method:
        'Scott & Burgan 40 fire-behavior fuel models (FBFM40) from the LANDFIRE national program, classifying every ~30 m cell of the continental US by its surface vegetation and how fire spreads through it. Served live from the LANDFIRE ImageServer; draw a circle to get the fuel-type breakdown for any area.',
      trust:
        'The interagency USGS/USFS standard used by federal and state agencies for wildfire-behavior modeling and operational fire planning.',
      url: 'https://landfire.gov',
    },
  },
  {
    id: 'ships',
    info: {
      name: 'Ships (AIS)',
      icon: '🚢',
      source: 'AISStream.io',
      method:
        'Vessels broadcast position and identity over AIS; AISStream relays those transponder messages. We track a curated set of vessels.',
      trust: "Direct from each ship's own AIS transponder, the maritime standard for vessel tracking.",
      url: 'https://aisstream.io',
    },
  },
  {
    id: 'satellites',
    info: {
      name: 'Satellites',
      icon: '🛰',
      source: 'CelesTrak',
      method:
        'Two-line element sets from CelesTrak are propagated locally with the SGP4 model (satellite.js) to compute live positions.',
      trust:
        'CelesTrak is the long-standing public clearing-house for orbital data derived from US Space Force tracking.',
      url: 'https://celestrak.org',
    },
  },
  {
    id: 'osmBuildings',
    info: {
      name: '3D Buildings & Terrain',
      icon: '🏙',
      source: 'OpenStreetMap + Cesium World Terrain',
      method:
        'Building footprints and heights from OpenStreetMap, draped over Cesium ion’s global terrain mesh.',
      trust: 'OpenStreetMap is the largest open community mapping project; terrain via Cesium ion.',
      url: 'https://www.openstreetmap.org',
    },
  },
  {
    id: 'timezones',
    info: {
      name: 'Time Zones',
      icon: '🕑',
      source: 'Natural Earth',
      method:
        'Public-domain 10m time-zone boundary polygons; the displayed clock is computed locally from each zone’s UTC offset.',
      trust: 'Natural Earth is a public-domain dataset curated by the cartographic community.',
      url: 'https://www.naturalearthdata.com',
    },
  },
  {
    id: 'locations',
    info: {
      name: 'Property Pins',
      icon: '📍',
      source: 'Curated internal list',
      method: 'Hand-maintained coordinates for the properties and assets this console monitors.',
      trust: 'Maintained by your team — not a third-party feed.',
    },
  },
  {
    id: 'newsMap',
    info: {
      name: 'News (GDELT)',
      icon: '📰',
      source: 'The GDELT Project',
      method:
        'GDELT continuously monitors world news and geocodes the places mentioned in coverage; its GKG GeoJSON feed returns each article as a point (city-level where resolvable). We group them into one pin per location with the article links, a representative image, and average tone. Optionally scoped to within a set radius of the property pins.',
      trust:
        'GDELT is a long-running open research project (supported by Google Jigsaw) widely used in academia and journalism for global news analysis.',
      url: 'https://www.gdeltproject.org',
    },
  },
];

export const BASEMAP_PROVENANCE: Record<BasemapId, Provenance> = {
  dark: {
    name: 'Dark Basemap',
    icon: '🗺',
    source: 'CARTO + OpenStreetMap',
    method: 'CARTO “dark matter” raster tiles rendered from OpenStreetMap data.',
    trust: 'OpenStreetMap geometry styled by CARTO, a widely used basemap provider.',
    url: 'https://carto.com',
  },
  light: {
    name: 'Light Basemap',
    icon: '🗺',
    source: 'CARTO + OpenStreetMap',
    method: 'CARTO “positron” raster tiles rendered from OpenStreetMap data.',
    trust: 'OpenStreetMap geometry styled by CARTO, a widely used basemap provider.',
    url: 'https://carto.com',
  },
  satellite: {
    name: 'Satellite Basemap',
    icon: '🛰',
    source: 'Esri World Imagery',
    method:
      'High-resolution aerial/satellite imagery (Esri, Maxar, Earthstar) with an Esri boundary + place-label overlay.',
    trust: 'Esri’s standard imagery basemap, sourced from commercial and government providers.',
    url: 'https://www.esri.com',
  },
  topo: {
    name: 'Topographic Basemap',
    icon: '🗺',
    source: 'OpenTopoMap',
    method: 'Topographic raster tiles rendered from OpenStreetMap + SRTM elevation data.',
    trust: 'Community topographic styling of open data (CC-BY-SA).',
    url: 'https://opentopomap.org',
  },
};
