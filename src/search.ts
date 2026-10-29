// One web-search call per app group, to catch launches the feeds miss.
// Searches are limited to the apps' own domains and the trusted outlets in watchlist.yaml.

import type { Config, Group } from './config.ts';
import { textOf, usageOf, type ContentBlock, type Llm, type Message } from './llm.ts';
import { SEARCH_SYSTEM, searchUser } from './prompts.ts';
import type { CallUsage, Candidate } from './types.ts';
import { domainOf, normalizeUrl, parseDate, parseJsonLoose, truncate } from './util.ts';

export interface SearchResult {
  group: string;
  ok: boolean;
  error?: string;
  candidates: Candidate[];
  usage: CallUsage[];
}

type Raw = { url?: unknown; title?: unknown; publisher?: unknown; published?: unknown; app?: unknown; summary?: unknown };

/** page_age from the search tool, keyed by normalised URL. It is often "3 days ago" or a date. */
function pageAges(blocks: ContentBlock[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of blocks) {
    if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
    for (const r of b.content as { url?: string; page_age?: string }[]) if (r.url && r.page_age) out.set(normalizeUrl(r.url), r.page_age);
  }
  return out;
}

function ageToDate(age: string | undefined, now: Date): Date | null {
  if (!age) return null;
  const rel = age.match(/^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i);
  if (rel) {
    const mult = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[rel[2].toLowerCase() as 'day'];
    return new Date(now.getTime() - Number(rel[1]) * mult);
  }
  return parseDate(age);
}

export async function searchGroup(cfg: Config, group: Group, llm: Llm, now: Date): Promise<SearchResult> {
  const usage: CallUsage[] = [];
  const since = new Date(now.getTime() - cfg.windowHours * 3_600_000);
  const domains = [...new Set([...group.apps.flatMap((a) => a.domains), ...cfg.trust.outlets])];
  const tool = { type: cfg.models.searchTool, name: 'web_search', max_uses: cfg.models.searchesPerGroup, allowed_domains: domains };
  const messages: Message[] = [
    {
      role: 'user',
      content: searchUser({
        group: group.label,
        apps: group.apps.map((a) => a.name),
        since: since.toISOString().slice(0, 16),
        until: now.toISOString().slice(0, 16),
        queries: group.search,
        maxSearches: cfg.models.searchesPerGroup,
      }),
    },
  ];
  const allBlocks: ContentBlock[] = [];
  try {
    // A long search turn can pause; send it back to let the model finish (at most twice).
    for (let turn = 0; turn < 3; turn++) {
      const res = await llm.messages({ model: cfg.models.search, system: SEARCH_SYSTEM, messages, maxTokens: 4000, tools: [tool] });
      usage.push(usageOf(`search:${group.category}`, cfg.models.search, res));
      allBlocks.push(...res.content);
      if (res.stopReason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
    const ages = pageAges(allBlocks);
    // The JSON answer is the text after the last search result.
    const lastResult = allBlocks.findLastIndex((b) => b.type === 'web_search_tool_result');
    const parsed = parseJsonLoose(textOf(allBlocks.slice(lastResult + 1)) || textOf(allBlocks)) as { items?: Raw[] };
    const candidates: Candidate[] = [];
    for (const r of parsed.items ?? []) {
      if (typeof r.url !== 'string' || typeof r.title !== 'string') continue;
      const url = normalizeUrl(r.url);
      const fromTool = ageToDate(ages.get(url), now);
      // The model's own "published" is not trusted: it is often a guess. The run checks the page itself;
      // until then only the date the search tool saw counts.
      const published = fromTool;
      candidates.push({
        cid: '',
        title: truncate(r.title, 200),
        url,
        source: typeof r.publisher === 'string' && r.publisher ? r.publisher : domainOf(url),
        domain: domainOf(url),
        publishedAt: published ? published.toISOString() : null,
        summary: typeof r.summary === 'string' ? truncate(r.summary, 400) : '',
        image: null,
        via: 'search',
        trust: 'outlet',
        app: typeof r.app === 'string' ? r.app : null,
      });
    }
    return { group: group.category, ok: true, candidates, usage };
  } catch (err) {
    return { group: group.category, ok: false, error: (err as Error).message, candidates: [], usage };
  }
}
