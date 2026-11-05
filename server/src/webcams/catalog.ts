import { NPS_PARK_BY_CODE } from '../nps/parks';
import type { WebcamDef } from './types';

// ── The followed parks' webcams ──────────────────────────────────────────────
// Curated by hand: each entry was checked live (the image loads from a fixed
// URL and changes on its own schedule, or the stream plays). Includes the
// cameras NPS runs and those of the parks' official partners (conservancies
// and others). A camera that later breaks shows as unavailable or stale in
// the panel rather than disappearing; prune or fix it here.

// Arizona DOT's camera stills stamp Last-Modified with the request time and
// print the capture time on the image; NPS lists these gateway cameras on its
// own Grand Canyon webcam page ("courtesy Arizona Dept. of Transportation 511").
const ADOT = { operator: 'Arizona DOT (AZ511)', refreshSec: 900, trustLastModified: false, timeOnImage: true } as const;

// NPS's own stills (nps.gov/webcams-<park>/…): a new frame every 30–60 s.
// Its CDN can hold a frame for a few minutes, so fetches carry a timestamp,
// as nps.gov's own webcam pages do.
const NPS = { operator: 'NPS', refreshSec: 60, bustCache: true } as const;

// The Glacier National Park Conservancy runs the Logan Pass and Many Glacier
// cameras that NPS shows. glacier.org's CDN caches each file for a year, so a
// load without a timestamp can be half a day old; and the site turns away
// server-side fetches, so these load straight into the viewer's browser —
// exactly as nps.gov's own webcam pages show them.
const GNPC = { operator: 'Glacier National Park Conservancy', refreshSec: 60, bustCache: true, browserDirect: true } as const;

// USGS Yellowstone Volcano Observatory cameras: a new image every 15 min over
// a cellular link that can drop out.
const YVO = { operator: 'USGS Yellowstone Volcano Observatory', refreshSec: 900, bustCache: true } as const;

// The Grand Canyon Conservancy's live players (Pixelcaster) sit on a bare page
// that keeps the browser's default 8 px white margin; the panel crops it off.
const PIXELCASTER_PAGE_MARGIN = 8;

export const WEBCAMS: readonly WebcamDef[] = [
  // ── Glacier ─────────────────────────────────────────────────────────────────
  { ...NPS, id: 'glac-apgar-lookout', parkCode: 'glac', name: 'Apgar Lookout', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4691B-1DD8-B71B-0BB9DBEE21A59335', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/ApgarLookout-01.jpg', lat: 48.507, lon: -114.034, approxLocation: true, note: 'From the Apgar Mountain fire lookout, northeast up Lake McDonald.' },
  { ...NPS, id: 'glac-apgar-village', parkCode: 'glac', name: 'Apgar Village', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4692D-1DD8-B71B-0B9AE4B7C186B022', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/ApgarVillage.jpg', lat: 48.528, lon: -113.993, approxLocation: true, note: 'Apgar Village, at the foot of Lake McDonald.' },
  { ...NPS, id: 'glac-lake-mcdonald', parkCode: 'glac', name: 'Lake McDonald', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4690A-1DD8-B71B-0B2D069E1CB02E6A', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/LakeMcDonald1.jpg', lat: 48.528, lon: -113.993, approxLocation: true, note: 'Up Lake McDonald from Apgar.' },
  { ...NPS, id: 'glac-lake-mcdonald-ptz', parkCode: 'glac', name: 'Lake McDonald (pan camera)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=D428B88A-BC1A-A5BF-88E3D63CF89D3452', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/lakemcdonaldptz.jpg', lat: 48.528, lon: -113.993, approxLocation: true, note: 'A camera that pans across Lake McDonald from Apgar.' },
  { ...NPS, id: 'glac-apgar-vc', parkCode: 'glac', name: 'Apgar Visitor Center', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=7290EA71-A74E-A7B4-74805070A3996FAC', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/ApgarVisitorCenter.jpg', lat: 48.523, lon: -113.989, approxLocation: true, note: 'The visitor center plaza at Apgar.' },
  { ...NPS, id: 'glac-west-entrance', parkCode: 'glac', name: 'West Entrance', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=33478DF3-1DD8-B71B-0B8C97DB0A03B0F7', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/WestEntrance.jpg', lat: 48.506, lon: -113.988, approxLocation: true, refreshSec: 30, note: 'The West Entrance station on Going-to-the-Sun Road.' },
  { ...NPS, id: 'glac-middle-fork', parkCode: 'glac', name: 'Middle Fork of the Flathead', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B46955-1DD8-B71B-0B698C4D88410C05', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/MiddleForkBridge.jpg', lat: 48.496, lon: -113.982, approxLocation: true, note: 'The Middle Fork of the Flathead River at West Glacier.' },
  { ...NPS, id: 'glac-headquarters', parkCode: 'glac', name: 'Park Headquarters', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B46943-1DD8-B71B-0B46D68861599592', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/Headquarters.jpg', lat: 48.496, lon: -113.982, approxLocation: true, note: 'Park headquarters, West Glacier.' },
  { ...GNPC, id: 'glac-logan-pass-lot', parkCode: 'glac', name: 'Logan Pass parking lot', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=325AE6AF-BAEB-F65D-EF3D638BF683E78E', kind: 'image', imageUrl: 'https://glacier.org/webcam/lpp_nps.jpg', lat: 48.695, lon: -113.718, approxLocation: true, note: 'The top of Going-to-the-Sun Road.' },
  { ...GNPC, id: 'glac-logan-pass-hidden-lake', parkCode: 'glac', name: 'Logan Pass, Hidden Lake Trailhead', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=6E559311-9E10-3A12-2442A20797C7B6C6', kind: 'image', imageUrl: 'https://glacier.org/webcam/hlt_nps.jpg', lat: 48.695, lon: -113.718, approxLocation: true, note: 'The Hidden Lake Trailhead behind the Logan Pass Visitor Center.' },
  { ...GNPC, id: 'glac-logan-pass-east', parkCode: 'glac', name: 'Logan Pass, looking east', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=7A5DA146-CE8D-E071-2C00362A062A3D0E', kind: 'image', imageUrl: 'https://glacier.org/webcam/smv_nps.jpg', lat: 48.695, lon: -113.718, approxLocation: true, note: 'East from Logan Pass toward the St. Mary Valley; it swings between views.' },
  { ...GNPC, id: 'glac-many-glacier', parkCode: 'glac', name: 'Many Glacier', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=2ABFE780-E817-D105-9B14697AEB43EBA6', kind: 'image', imageUrl: 'https://glacier.org/webcam/mg_nps.jpg', lat: 48.797, lon: -113.658, approxLocation: true, note: 'Swiftcurrent Lake at Many Glacier.' },
  { ...NPS, id: 'glac-st-mary', parkCode: 'glac', name: 'St. Mary Visitor Center', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=AE7C9B53-910E-6D3A-D6133266826C6977', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/StMaryPTZ.jpg', lat: 48.747, lon: -113.439, approxLocation: true, note: 'The east end of Going-to-the-Sun Road, from the St. Mary Visitor Center.' },
  { ...NPS, id: 'glac-two-medicine', parkCode: 'glac', name: 'Two Medicine (Sinopah)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=29CE45EA-EF1D-13A4-9C8E92F1FBFED9C7', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/TwoMedicine.jpg', lat: 48.486, lon: -113.367, approxLocation: true, note: 'Two Medicine Lake toward Sinopah Mountain.' },
  { ...NPS, id: 'glac-two-medicine-rising-wolf', parkCode: 'glac', name: 'Two Medicine (Rising Wolf)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=1F7197E2-FF96-18D7-0AC05A501EBA2571', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-glac/TwoMedicine1.jpg', lat: 48.486, lon: -113.367, approxLocation: true, note: 'Two Medicine toward Rising Wolf Mountain.' },

  // ── Yellowstone ─────────────────────────────────────────────────────────────
  {
    id: 'yell-old-faithful',
    parkCode: 'yell',
    name: 'Old Faithful (live video)',
    operator: 'NPS and Yellowstone Forever',
    pageUrl: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm',
    // Its player only runs on nps.gov and yellowstone.org.
    kind: 'link',
    lat: 44.45986,
    lon: -110.83102,
    approxLocation: true,
    refreshSec: 60,
    note: 'Live video of Old Faithful and the Upper Geyser Basin, usually sunrise to sunset.',
  },
  { ...NPS, id: 'yell-north-entrance-arch', parkCode: 'yell', name: 'North Entrance (Roosevelt Arch)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B468BC-1DD8-B71B-0BBA4C383E179188', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/mammoth_arch.jpg', lat: 45.029, lon: -110.709, approxLocation: true, refreshSec: 30, note: 'Out of the park through the Roosevelt Arch toward Gardiner.' },
  { ...NPS, id: 'yell-north-entrance-electric', parkCode: 'yell', name: 'North Entrance (Electric Peak)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B468AB-1DD8-B71B-0BE84D8E8E0F1112', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/mammoth_electric.jpg', lat: 45.029, lon: -110.709, approxLocation: true, refreshSec: 30, note: 'From the North Entrance toward Electric Peak.' },
  { ...NPS, id: 'yell-mammoth-terraces', parkCode: 'yell', name: 'Mammoth Hot Springs', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=696F20E1-F421-B232-FE72D6D85B157422', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/mammoth_parade.jpg', lat: 44.977, lon: -110.701, approxLocation: true, note: 'The travertine terraces at Mammoth Hot Springs.' },
  { ...NPS, id: 'yell-washburn-ne', parkCode: 'yell', name: 'Mount Washburn, northeast', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B46891-1DD8-B71B-0B6575944D4DECD5', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/washburn_ne.jpg', lat: 44.798, lon: -110.434, approxLocation: true, refreshSec: 30, note: 'From the Mount Washburn fire lookout, looking northeast.' },
  { ...NPS, id: 'yell-washburn-south', parkCode: 'yell', name: 'Mount Washburn, south', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4689E-1DD8-B71B-0B8741319EA29FD3', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/washburn_sw.jpg', lat: 44.798, lon: -110.434, approxLocation: true, refreshSec: 30, note: 'From the Mount Washburn fire lookout, looking south.' },
  { ...NPS, id: 'yell-west-entrance-out', parkCode: 'yell', name: 'West Entrance (leaving)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B468C8-1DD8-B71B-0BFE5983E4D2E421', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/west_gate.jpg', lat: 44.659, lon: -111.097, approxLocation: true, refreshSec: 30, note: 'The West Entrance, traffic leaving for West Yellowstone.' },
  { ...NPS, id: 'yell-west-entrance-in', parkCode: 'yell', name: 'West Entrance (arriving)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B468D6-1DD8-B71B-0B9C2E324EF5F9F8', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/west_into.jpg', lat: 44.659, lon: -111.097, approxLocation: true, refreshSec: 30, note: 'The West Entrance, traffic coming into the park.' },
  { ...NPS, id: 'yell-east-entrance-out', parkCode: 'yell', name: 'East Entrance (leaving)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=45FDA0AC-0A10-4ACA-A0C6-44F440575AE1', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/east_out.jpg', lat: 44.5, lon: -109.96, approxLocation: true, refreshSec: 30, note: 'The East Entrance, toward Cody.' },
  { ...NPS, id: 'yell-east-entrance-in', parkCode: 'yell', name: 'East Entrance (arriving)', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=E3772256-9585-4859-A1FD-FC47F15F7226', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-yell/east_in.jpg', lat: 44.5, lon: -109.96, approxLocation: true, refreshSec: 30, note: 'The East Entrance, into the park toward Sylvan Pass.' },
  { ...YVO, id: 'yell-biscuit-basin', parkCode: 'yell', name: 'Biscuit Basin', pageUrl: 'https://www.usgs.gov/media/webcams/biscuit-basin-webcam-0', kind: 'image', imageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/ys-bbsn2/current.jpg', lat: 44.485762, lon: -110.855136, note: 'Watches the site of the hydrothermal explosion that closed Biscuit Basin, north of Old Faithful.' },
  { ...YVO, id: 'yell-black-diamond-pool', parkCode: 'yell', name: 'Black Diamond Pool', pageUrl: 'https://www.usgs.gov/media/webcams/black-diamond-pool-biscuit-basin-webcam', kind: 'image', imageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/ys-bbsn/current.jpg', lat: 44.48531, lon: -110.85388, note: 'Black Diamond Pool in Biscuit Basin.' },
  { ...YVO, id: 'yell-lake', parkCode: 'yell', name: 'Yellowstone Lake', pageUrl: 'https://www.usgs.gov/media/webcams/webcam-yellowstone-lake', kind: 'image', imageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/ys-lake/current.jpg', lat: 44.565366, lon: -110.399878, note: 'Yellowstone Lake, north of Lake Yellowstone Hotel.' },

  // ── Grand Canyon ────────────────────────────────────────────────────────────
  {
    id: 'grca-south-entrance',
    parkCode: 'grca',
    name: 'South Entrance Station',
    operator: 'NPS',
    pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=9B5FC6BA-9FE6-EC6B-61637825D562D367',
    kind: 'image',
    imageUrl: 'https://www.nps.gov/webcams-grca/camera.jpg',
    bustCache: true,
    lat: 36.0001,
    lon: -112.1216,
    approxLocation: true,
    // NPS says every minute; uploads land about every 3.
    refreshSec: 180,
    timeOnImage: true,
    note: 'AZ-64 at the South Entrance Station, 1.6 mi north of Tusayan: the line into the South Rim.',
  },
  {
    id: 'grca-kolb-north',
    parkCode: 'grca',
    name: 'Kolb Studio, looking north',
    operator: 'Grand Canyon Conservancy',
    pageUrl: 'https://www.grandcanyon.org/experience-grand-canyon/webcams',
    kind: 'image',
    imageUrl: 'https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/grandcanyon-2/latest.jpg',
    embedUrl: 'https://pixelcaster.com/live/grandcanyon/cam2.html',
    embedMarginPx: PIXELCASTER_PAGE_MARGIN,
    lat: 36.058,
    lon: -112.1426,
    approxLocation: true,
    refreshSec: 120,
    timeOnImage: true,
    note: 'From Kolb Studio in Grand Canyon Village, across the canyon toward Battleship and Havasupai Gardens.',
  },
  {
    id: 'grca-bright-angel',
    parkCode: 'grca',
    name: 'Bright Angel Trailhead',
    operator: 'Grand Canyon Conservancy',
    pageUrl: 'https://www.grandcanyon.org/experience-grand-canyon/webcams',
    kind: 'image',
    imageUrl: 'https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/grandcanyon-1/latest.jpg',
    embedUrl: 'https://pixelcaster.com/live/grandcanyon/cam1.html',
    embedMarginPx: PIXELCASTER_PAGE_MARGIN,
    lat: 36.058,
    lon: -112.1426,
    approxLocation: true,
    refreshSec: 120,
    timeOnImage: true,
    note: 'Looking west from Kolb Studio over the Bright Angel Trailhead.',
  },
  {
    id: 'grca-yavapai',
    parkCode: 'grca',
    name: 'Yavapai Point (air quality)',
    operator: 'NPS Air Resources',
    pageUrl: 'https://www.nps.gov/subjects/air/webcams.htm?site=grca',
    kind: 'image',
    imageUrl: 'https://www.nps.gov/featurecontent/ard/webcams/images/grca.jpg',
    bustCache: true,
    lat: 36.0661,
    lon: -112.1176,
    approxLocation: true,
    refreshSec: 900,
    // The host re-publishes the file every few minutes with a new
    // Last-Modified even when the picture hasn't changed.
    trustLastModified: false,
    note: 'Visibility camera at the Yavapai Geology Museum, looking northwest across the canyon.',
  },
  {
    ...ADOT,
    id: 'grca-az64-tusayan',
    parkCode: 'grca',
    name: 'AZ-64 at Tusayan',
    pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=7D6A3936-E1C5-C480-4FA08472583AA182',
    kind: 'image',
    imageUrl: 'https://az511.com/map/Cctv/709',
    lat: 35.9736,
    lon: -112.1266,
    approxLocation: true,
    note: 'AZ-64 by the Grand Canyon Airport road, 2.6 mi south of the South Entrance.',
  },
  {
    ...ADOT,
    id: 'grca-az64-valle',
    parkCode: 'grca',
    name: 'AZ-64 at Valle',
    pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=692DB1BB-E2E6-22EC-034062D3C0C936B5',
    kind: 'image',
    imageUrl: 'https://az511.com/map/Cctv/702',
    lat: 35.6581,
    lon: -112.1387,
    note: 'AZ-64 at the US-180 junction (Valle), 26 mi south of the South Rim.',
  },
  {
    ...ADOT,
    id: 'grca-i40-williams',
    parkCode: 'grca',
    name: 'I-40 at Williams',
    pageUrl: 'https://az511.com/',
    kind: 'image',
    imageUrl: 'https://az511.com/map/Cctv/700',
    lat: 35.259,
    lon: -112.114,
    note: 'I-40 westbound at Williams, by the AZ-64 turn to the Grand Canyon — home of the Grand Canyon Railway & Hotel.',
  },
  {
    ...ADOT,
    id: 'grca-i40-flagstaff',
    parkCode: 'grca',
    name: 'I-40 at Flagstaff',
    pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=69687067-BE16-062D-2F789E22263AABA3',
    kind: 'image',
    imageUrl: 'https://az511.com/map/Cctv/25--15',
    lat: 35.1988,
    lon: -111.6518,
    approxLocation: true,
    note: 'I-40 eastbound at Flagstaff.',
  },
  {
    ...ADOT,
    id: 'grca-us89a-jacob-lake',
    parkCode: 'grca',
    name: 'US-89A at Jacob Lake',
    pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=B08B53F1-D1E6-7E94-3AAA19135F31B142',
    kind: 'image',
    imageUrl: 'https://az511.com/map/Cctv/1351',
    lat: 36.715,
    lon: -112.2157,
    note: 'The North Rim gateway, at the AZ-67 junction, 30 mi north of the North Rim entrance.',
  },

  // ── Death Valley ────────────────────────────────────────────────────────────
  // No working park or partner camera as of Nov 2026: the park's webcam page
  // is gone, and the one third-party panorama stopped in July.

  // ── Rocky Mountain ──────────────────────────────────────────────────────────
  { ...NPS, id: 'romo-beaver-meadows', parkCode: 'romo', name: 'Beaver Meadows Entrance', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4686B-1DD8-B71B-0B122CB864D072FC', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/bme.jpeg', lat: 40.367, lon: -105.562, approxLocation: true, note: 'US-36 at the Beaver Meadows Entrance, the main way in from Estes Park.' },
  { ...NPS, id: 'romo-fall-river', parkCode: 'romo', name: 'Fall River Entrance', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B46856-1DD8-B71B-0B8636427EFFC938', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/fre.jpg', lat: 40.402, lon: -105.587, approxLocation: true, note: 'US-34 at the Fall River Entrance, west of Estes Park.' },
  { ...NPS, id: 'romo-grand-lake', parkCode: 'romo', name: 'Grand Lake Entrance', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=3F33B673-957B-51DD-612B99E4A9FDF417', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/Grand_Lake_Entrance.jpg', lat: 40.266, lon: -105.833, approxLocation: true, note: 'US-34 at the Grand Lake Entrance, the west end of Trail Ridge Road.' },
  { ...NPS, id: 'romo-alpine-vc', parkCode: 'romo', name: 'Alpine Visitor Center', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4681E-1DD8-B71B-0B8311E4FAC15EF4', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/alpine_visitor_center.jpg', lat: 40.441, lon: -105.755, approxLocation: true, note: 'Fall River Pass, on Trail Ridge Road.' },
  { ...NPS, id: 'romo-kawuneeche', parkCode: 'romo', name: 'Kawuneeche Valley', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4682A-1DD8-B71B-0BBC127D2E00ACD9', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/kawuneeche_valley.jpeg', lat: 40.27, lon: -105.83, approxLocation: true, note: 'Harbison Meadow in the Kawuneeche Valley, near Grand Lake.' },
  { ...NPS, id: 'romo-longs-peak', parkCode: 'romo', name: 'Longs Peak', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B46847-1DD8-B71B-0B46D032F33B54DF', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/longs_peak.jpg', lat: 40.272, lon: -105.557, approxLocation: true, note: 'Longs Peak from the Tahosa Valley.' },
  { ...NPS, id: 'romo-glacier-basin', parkCode: 'romo', name: 'Continental Divide', pageUrl: 'https://www.nps.gov/media/webcam/view.htm?id=81B4683A-1DD8-B71B-0B01974CAAE7F372', kind: 'image', imageUrl: 'https://www.nps.gov/webcams-romo/glacier_basin.jpeg', lat: 40.329, lon: -105.595, approxLocation: true, note: 'The Continental Divide from the Glacier Basin meadow, off Bear Lake Road.' },
  {
    id: 'romo-big-thompson',
    parkCode: 'romo',
    name: 'Big Thompson River',
    operator: 'USGS',
    pageUrl: 'https://apps.usgs.gov/hivis/camera/CO_Big_Thompson_bl_Moraine_Park_nr_Estes_Park',
    kind: 'image',
    imageUrl: 'https://usgs-nims-images.s3.amazonaws.com/overlay/CO_Big_Thompson_bl_Moraine_Park_nr_Estes_Park/CO_Big_Thompson_bl_Moraine_Park_nr_Estes_Park_newest.jpg',
    lat: 40.353861,
    lon: -105.584139,
    refreshSec: 900,
    timeOnImage: true,
    note: 'River-gauge camera below Moraine Park: high water and ice.',
  },
  {
    id: 'romo-colorado-river',
    parkCode: 'romo',
    name: 'Colorado River',
    operator: 'USGS',
    pageUrl: 'https://waterdata.usgs.gov/monitoring-location/USGS-09010500/',
    kind: 'image',
    imageUrl: 'https://usgs-nims-images.s3.amazonaws.com/overlay/CO_Colorado_River_below_Baker_Gulch_nr_Grand_Lake/CO_Colorado_River_below_Baker_Gulch_nr_Grand_Lake_newest.jpg',
    lat: 40.325833,
    lon: -105.856111,
    refreshSec: 900,
    timeOnImage: true,
    note: 'River-gauge camera below Baker Gulch, near Grand Lake.',
  },

  // ── Mount Rushmore ──────────────────────────────────────────────────────────
  // The memorial's own camera is EarthCam's, whose terms rule out embedding
  // without a licence: it opens on EarthCam. The Keystone road camera is the
  // nearest live view of the approach.
  {
    id: 'moru-earthcam',
    parkCode: 'moru',
    name: 'Mount Rushmore (EarthCam)',
    operator: 'EarthCam',
    pageUrl: 'https://www.earthcam.com/usa/southdakota/keystone/mountrushmore/',
    kind: 'link',
    lat: 43.8791,
    lon: -103.4591,
    refreshSec: 60,
    note: 'Live video of the memorial, run by EarthCam with NPS.',
  },
  {
    id: 'moru-keystone-wye',
    parkCode: 'moru',
    name: 'US-16 at the Keystone Wye',
    operator: 'South Dakota DOT (SD511)',
    pageUrl: 'https://www.sd511.org/',
    kind: 'image',
    imageUrl: 'https://sd.cdn.iteris-atis.com/camera_images/CSDKEY/1/latest.jpg',
    lat: 43.927,
    lon: -103.433,
    refreshSec: 900,
    timeOnImage: true,
    note: 'US-16 north of Keystone, 3.6 mi from the memorial.',
  },

];

export const WEBCAM_BY_ID: ReadonlyMap<string, WebcamDef> = new Map(WEBCAMS.map((c) => [c.id, c]));

/** What's wrong with a catalog, if anything: duplicate ids, unknown parks, missing URLs, bad coordinates. */
export function catalogProblems(list: readonly WebcamDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    if (!/^[a-z0-9-]+$/.test(c.id)) problems.push(`${c.id}: id must be a lowercase slug`);
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (!NPS_PARK_BY_CODE.has(c.parkCode)) problems.push(`${c.id}: unknown park ${c.parkCode}`);
    if (!/^https?:\/\//.test(c.pageUrl)) problems.push(`${c.id}: pageUrl must be http(s)`);
    if (c.kind === 'image' && !/^https?:\/\//.test(c.imageUrl ?? '')) problems.push(`${c.id}: image camera without imageUrl`);
    if (c.kind === 'stream' && !/^https:\/\//.test(c.embedUrl ?? '')) problems.push(`${c.id}: stream camera without an https embedUrl`);
    if (c.kind === 'link' && (c.imageUrl || c.embedUrl)) problems.push(`${c.id}: a link camera must not be fetched or embedded`);
    if (c.browserDirect && (c.kind !== 'image' || !/^https:\/\//.test(c.imageUrl ?? ''))) {
      problems.push(`${c.id}: a browser-direct camera needs an https image (the dashboard is served over https)`);
    }
    if (c.embedUrl !== undefined && !/^https:\/\//.test(c.embedUrl)) problems.push(`${c.id}: embedUrl must be https`);
    if (c.embedMarginPx !== undefined && !(c.embedUrl && Number.isInteger(c.embedMarginPx) && c.embedMarginPx >= 0 && c.embedMarginPx <= 24)) {
      problems.push(`${c.id}: embedMarginPx needs an embedUrl and 0–24 px`);
    }
    if (!(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180) || (c.lat === 0 && c.lon === 0)) {
      problems.push(`${c.id}: bad coordinates`);
    }
    if (!(c.refreshSec >= 10)) problems.push(`${c.id}: refreshSec must be at least 10`);
  }
  return problems;
}
