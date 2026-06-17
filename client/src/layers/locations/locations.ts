export interface Location {
  name: string;
  lat: number;
  lon: number;
  altitudeM?: number;
}

export interface LocationGroup {
  id: string;
  name: string;
  color: string;
  icon: string;
  locations: Location[];
}

export const LOCATION_GROUPS: LocationGroup[] = [
  {
    id: 'glacier',
    name: 'Glacier NP',
    color: '#22d3ee',
    icon: '🏔',
    locations: [
      { name: 'Cedar Creek Lodge', lat: 48.37014, lon: -114.18468 },
      { name: 'Village Inn', lat: 48.52903, lon: -113.99417 },
      { name: 'Lake MacDonald Lodge', lat: 48.61749, lon: -113.87903 },
      { name: 'Swiftcurrent Motor Inn', lat: 48.79781, lon: -113.67699 },
      { name: 'Many Glacier Hotel', lat: 48.79667, lon: -113.65770 },
    ],
  },
  {
    id: 'death-valley',
    name: 'Death Valley NP',
    color: '#f97316',
    icon: '🏜',
    locations: [
      { name: 'Oasis Death Valley Ranch', lat: 36.45840, lon: -116.86996 },
      { name: 'Oasis Death Valley Inn', lat: 36.45059, lon: -116.85343 },
    ],
  },
  {
    id: 'grand-canyon',
    name: 'Grand Canyon',
    color: '#c2410c',
    icon: '🏔',
    locations: [
      { name: 'Grand Canyon Railway & Hotel', lat: 35.25185, lon: -112.19152 },
      { name: 'Grand Canyon Village', lat: 36.05624, lon: -112.13939 },
    ],
  },
  {
    id: 'corporate',
    name: 'Xanterra HQ',
    color: '#8b5cf6',
    icon: '🏢',
    locations: [
      { name: 'Xanterra Corporate Office', lat: 39.60323, lon: -104.89349, altitudeM: 80_000 },
    ],
  },
  {
    id: 'centennial-airport',
    name: 'Centennial Airport',
    color: '#f59e0b',
    icon: '✈️',
    locations: [
      {
        name: 'Centennial Airport - Anschutz Hangar',
        lat: 39.57483310207554,
        lon: -104.8476671226168,
        altitudeM: 12_000,
      },
    ],
  },
  {
    id: 'yellowstone',
    name: 'Yellowstone NP',
    color: '#10b981',
    icon: '🌋',
    locations: [
      { name: 'Gardiner, Montana', lat: 45.03199, lon: -110.70578 },
      { name: 'Mammoth Hot Springs', lat: 44.97636, lon: -110.70170 },
      { name: 'Roosevelt Lodge Cabins', lat: 44.91266, lon: -110.41686 },
      { name: 'Canyon Village', lat: 44.73417, lon: -110.49071 },
      { name: 'Lake Yellowstone Hotel', lat: 44.55047, lon: -110.40003 },
      { name: 'Grant Village', lat: 44.39323, lon: -110.55551 },
      { name: 'Old Faithful Inn', lat: 44.45968, lon: -110.83115 },
      { name: 'Madison Campground', lat: 44.64424, lon: -110.86255 },
    ],
  },
  {
    id: 'rushmore',
    name: 'Mt. Rushmore',
    color: '#3b82f6',
    icon: '🗿',
    locations: [
      { name: 'Mount Rushmore National Memorial', lat: 43.87533, lon: -103.45342 },
    ],
  },
  {
    id: 'windstar',
    name: 'Windstar Cruises',
    color: '#0ea5e9',
    icon: '⛵',
    locations: [
      { name: 'Windstar Corporate Office', lat: 25.80916, lon: -80.33307, altitudeM: 80_000 },
    ],
  },
  {
    id: 'holiday',
    name: 'Holiday Vacations',
    color: '#ec4899',
    icon: '🌴',
    locations: [
      { name: 'Holiday Vacations Office', lat: 44.79093, lon: -91.46245, altitudeM: 80_000 },
    ],
  },
  {
    id: 'vermont',
    name: 'VBT Bicycling',
    color: '#22c55e',
    icon: '🚴',
    locations: [
      { name: 'Vermont Bike Tours Office', lat: 44.46096, lon: -73.12281, altitudeM: 80_000 },
    ],
  },
  {
    id: 'sea-island',
    name: 'Sea Island Resort',
    color: '#a855f7',
    icon: '🏖',
    locations: [
      { name: 'Sea Island Resort', lat: 31.18122, lon: -81.35020 },
    ],
  },
  {
    id: 'cog-railway',
    name: 'Cog Railway',
    color: '#ef4444',
    icon: '🚂',
    locations: [
      { name: 'Cog Railway', lat: 38.85606, lon: -104.93156, altitudeM: 60_000 },
    ],
  },
];
