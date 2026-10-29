export const CATEGORIES = ['ota', 'rail', 'platform', 'consumer'] as const;
export type Category = (typeof CATEGORIES)[number];

/** A news item collected from a feed or a web search, before the model has looked at it. */
export interface Candidate {
  cid: string;
  title: string;
  url: string;
  /** Publisher name, e.g. "9to5Mac" or "Airbnb Newsroom". */
  source: string;
  domain: string;
  publishedAt: string | null;
  summary: string;
  image: string | null;
  via: 'feed' | 'search';
  trust: 'company' | 'outlet';
  /** App the item is about, when the feed or search already knows. */
  app: string | null;
}

export interface Dropped {
  title: string;
  url: string;
  source: string;
  reason: string;
  /** Groups noisy reasons in the log ("older than 48h" happens hundreds of times a day). */
  bulk?: boolean;
}

export interface Source {
  title: string;
  url: string;
  publisher: string;
}

/** One reported change, as stored in radar.json and shown on the page. */
export interface Item {
  id: string;
  app: string;
  category: Category;
  /** Publish date in the reader's timezone, YYYY-MM-DD. */
  date: string;
  published_at: string;
  beta: boolean;
  importance: number;
  headline: string;
  what: string;
  why: string;
  sources: Source[];
  image: string | null;
  icon: string | null;
  collected_at: string;
}

export interface Day {
  /** The run date in the reader's timezone, YYYY-MM-DD. */
  date: string;
  collected_at: string;
  quiet: boolean;
  pattern: string | null;
  items: Item[];
}

export interface Radar {
  version: 1;
  updated_at: string;
  days: Day[];
}

export interface SeenEvent {
  app: string;
  headline: string;
  date: string;
  urls: string[];
}

export interface Seen {
  events: Record<string, SeenEvent>;
}

export interface CallUsage {
  step: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  web_searches: number;
  /** Company Coding Plan quota used, when the gateway reports it. */
  credits?: number;
}
