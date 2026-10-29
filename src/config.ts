// Reads and checks watchlist.yaml, so a typo there gives a clear message instead of a crash mid-run.

import { readFileSync } from 'node:fs';
import { CATEGORIES, type Category } from './types.ts';
import { parseYaml } from './yaml.ts';

export interface App {
  name: string;
  category: Category;
  aliases: string[];
  domains: string[];
  appstoreId: number | null;
  iconDomain: string | null;
}

export interface Group {
  category: Category;
  label: string;
  search: string[];
  apps: App[];
}

export interface Feed {
  name: string;
  url: string;
  kind: 'company' | 'outlet';
  app: string | null;
}

export type Provider = 'company' | 'gemini' | 'anthropic';

export interface Config {
  reader: string;
  /** Where the model calls go. RADAR_PROVIDER overrides it. */
  provider: Provider;
  timezone: string;
  windowHours: number;
  models: { curate: string; search: string; searchTool: string; searchesPerGroup: number; maxCandidates: number };
  prices: Record<string, { input: number; output: number }>;
  webSearchPer1000: number;
  groups: Group[];
  apps: App[];
  feeds: Feed[];
  trust: { outlets: string[]; blockedDomains: string[]; dropWords: string[] };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`watchlist.yaml: ${message}`);
    this.name = 'ConfigError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strList = (v: unknown, where: string): string[] => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ConfigError(`${where} should be a list`);
  return v.map((x) => String(x));
};

export function loadConfig(path = 'watchlist.yaml'): Config {
  return parseConfig(readFileSync(path, 'utf8'), process.env);
}

export function parseConfig(src: string, env: Record<string, string | undefined> = {}): Config {
  const y = parseYaml(src);
  if (!isObj(y)) throw new ConfigError('expected a mapping at the top level');
  const models = isObj(y.models) ? y.models : {};
  const prices = isObj(y.prices) ? y.prices : {};
  if (!isObj(y.groups)) throw new ConfigError('missing "groups"');

  const groups: Group[] = [];
  for (const [key, raw] of Object.entries(y.groups)) {
    if (!CATEGORIES.includes(key as Category)) throw new ConfigError(`group "${key}" must be one of ${CATEGORIES.join(', ')}`);
    if (!isObj(raw)) throw new ConfigError(`group "${key}" should be a mapping`);
    const category = key as Category;
    const apps = (Array.isArray(raw.apps) ? raw.apps : []).map((a, i): App => {
      if (!isObj(a) || !a.name) throw new ConfigError(`groups.${key}.apps[${i}] needs a name`);
      const name = String(a.name);
      return {
        name,
        category,
        aliases: strList(a.aliases, `${name}.aliases`).length ? strList(a.aliases, `${name}.aliases`) : [name],
        domains: strList(a.domains, `${name}.domains`).map((d) => d.toLowerCase().replace(/^www\./, '')),
        appstoreId: a.appstore_id == null ? null : Number(a.appstore_id),
        iconDomain: a.icon_domain ? String(a.icon_domain) : null,
      };
    });
    groups.push({ category, label: String(raw.label ?? key), search: strList(raw.search, `groups.${key}.search`), apps });
  }

  const apps = groups.flatMap((g) => g.apps);
  const seen = new Set<string>();
  for (const a of apps) {
    if (seen.has(a.name)) throw new ConfigError(`app "${a.name}" is listed twice; keep it in one group`);
    seen.add(a.name);
  }

  const feeds = (Array.isArray(y.feeds) ? y.feeds : []).map((f, i): Feed => {
    if (!isObj(f) || !f.url) throw new ConfigError(`feeds[${i}] needs a url`);
    const kind = f.kind === 'company' ? 'company' : 'outlet';
    const app = f.app ? String(f.app) : null;
    if (kind === 'company' && !app) throw new ConfigError(`feed "${f.name ?? f.url}" is kind: company, so it needs app:`);
    if (app && !seen.has(app)) throw new ConfigError(`feed "${f.name ?? f.url}" names app "${app}", which is not in groups`);
    return { name: String(f.name ?? f.url), url: String(f.url), kind, app };
  });

  const trust = isObj(y.trust) ? y.trust : {};
  const priceTable: Config['prices'] = {};
  for (const [model, p] of Object.entries(prices)) {
    if (isObj(p)) priceTable[model] = { input: Number(p.input ?? 0), output: Number(p.output ?? 0) };
  }

  const provider = String(env.RADAR_PROVIDER || y.provider || 'anthropic');
  if (provider !== 'company' && provider !== 'gemini' && provider !== 'anthropic') throw new ConfigError(`provider must be company, gemini or anthropic, not "${provider}"`);
  const company = isObj(y.company) ? y.company : {};
  const gemini = isObj(y.gemini) ? y.gemini : {};
  const curate =
    provider === 'company'
      ? String(company.curate ?? 'kr-claude-opus-5.5')
      : provider === 'gemini'
        ? String(gemini.curate ?? 'gemini-3.8-flash')
        : String(models.curate ?? 'claude-sonnet-5-5');

  return {
    reader: String(y.reader ?? ''),
    provider,
    timezone: String(y.timezone ?? 'Asia/Shanghai'),
    windowHours: Number(y.window_hours ?? 48),
    models: {
      curate,
      search: String(models.search ?? 'claude-haiku-5-5'),
      searchTool: String(models.search_tool ?? 'web_search_20250305'),
      searchesPerGroup: Number(models.searches_per_group ?? 3),
      maxCandidates: Number(models.max_candidates ?? 150),
    },
    prices: priceTable,
    webSearchPer1000: Number(prices.web_search_per_1000 ?? 10),
    groups,
    apps,
    feeds,
    trust: {
      outlets: strList(trust.outlets, 'trust.outlets').map((d) => d.toLowerCase()),
      blockedDomains: strList(trust.blocked_domains, 'trust.blocked_domains').map((d) => d.toLowerCase()),
      dropWords: strList(trust.drop_words, 'trust.drop_words'),
    },
  };
}

export const appByName = (cfg: Config, name: string): App | undefined => cfg.apps.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
