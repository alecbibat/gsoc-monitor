// Unified OSINT intel model. Every source adapter normalizes into IntelItem so
// scanner CAD, DOT crashes, city crime, RSS news, and social posts all flow
// into one feed + map layer.

export type SourceKind =
  | 'rss' // arbitrary RSS/Atom URL — also covers Mastodon .rss and Reddit .rss
  | 'google-news' // Google News RSS search (the "add a topic we care about" primitive)
  | 'bluesky-author' // a Bluesky handle's posts
  | 'bluesky-search' // a Bluesky keyword search across the network
  | 'pulsepoint' // fire/EMS CAD dispatch (scanner alerts) for one agency
  | 'chp' // California CHP traffic/incident dispatch (statewide)
  | 'socrata'; // a city crime open-data dataset (Socrata)

export const SOURCE_KINDS: SourceKind[] = [
  'rss',
  'google-news',
  'bluesky-author',
  'bluesky-search',
  'pulsepoint',
  'chp',
  'socrata',
];

export type IntelCategory =
  | 'scanner'
  | 'crime'
  | 'crash'
  | 'fire'
  | 'weather'
  | 'news'
  | 'social'
  | 'other';

// A watchlist source — a built-in default or a team-added row from the DB.
export interface IntelSource {
  id: string;
  kind: SourceKind;
  label: string;
  url?: string; // rss
  config?: {
    query?: string; // google-news, bluesky-search
    handle?: string; // bluesky-author
    agencyId?: string; // pulsepoint
    domain?: string; // socrata host, e.g. data.cityofchicago.org
    dataset?: string; // socrata resource id
    dateField?: string; // socrata timestamp column
    latField?: string;
    lonField?: string;
    typeField?: string;
    descField?: string;
    category?: IntelCategory; // override the item category
    staticGeo?: { lat: number; lon: number; place: string }; // pin ungeocoded items here
  };
  builtin?: boolean;
  active?: boolean;
}

export interface IntelItem {
  id: string; // stable dedup key
  kind: SourceKind;
  source: string; // source label
  category: IntelCategory;
  title: string;
  text: string | null;
  author: string | null; // social handle / dispatch unit / byline
  url: string;
  publishedAt: number; // epoch ms
  lat: number | null;
  lon: number | null;
  place: string | null; // human-readable place (also the geocode key)
  severity: 'info' | 'watch' | 'urgent';
}

export interface IntelResponse {
  items: IntelItem[];
  updated: number;
  sourceCount: number;
  errors: string[]; // labels of sources that failed this cycle
}
