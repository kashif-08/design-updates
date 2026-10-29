import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { similar } from '../src/curate.ts';
import type { Llm, MessagesRequest } from '../src/llm.ts';
import { matchApp, prefilter } from '../src/prefilter.ts';
import { mergeDay } from '../src/radar.ts';
import { collect, defaultPaths, SourcesDownError } from '../src/run.ts';
import type { Radar, Seen } from '../src/types.ts';

const CFG = parseConfig(`
reader: ""
timezone: Asia/Shanghai
window_hours: 48
models:
  curate: claude-sonnet-5-5
  search: claude-haiku-5-5
  searches_per_group: 2
prices:
  claude-sonnet-5-5: { input: 3, output: 15 }
  claude-haiku-5-5: { input: 1, output: 5 }
  web_search_per_1000: 10
groups:
  ota:
    label: OTAs
    search: [Airbnb new feature]
    apps:
      - name: Airbnb
        aliases: [Airbnb]
        domains: [airbnb.com]
        appstore_id: 401626263
      - name: Expedia
        aliases: [Expedia]
        domains: [expediagroup.com]
        appstore_id: 427916203
  platform:
    label: Platforms
    apps:
      - name: Apple
        aliases: [Apple, iOS, Liquid Glass]
        domains: [apple.com]
        icon_domain: apple.com
  consumer:
    label: Consumer
    apps:
      - name: Threads
        aliases: [Threads]
        domains: [threads.com]
feeds:
  - name: Airbnb Newsroom
    url: https://news.airbnb.com/feed/
    kind: company
    app: Airbnb
  - name: 9to5Mac
    url: https://9to5mac.com/feed/
    kind: outlet
trust:
  outlets: [9to5mac.com, theverge.com, skift.com]
  blocked_domains: [medium.com]
  drop_words: [funding, deals, "% off"]
`);

const NOW = new Date('2026-10-28T23:00:00Z'); // 07:00 on 29 Oct in Shanghai
const h = (hours: number, from = NOW) => new Date(from.getTime() - hours * 3_600_000).toUTCString();

const rss = (items: [title: string, url: string, date: string][]) =>
  `<rss version="2.0"><channel>${items.map(([t, u, d]) => `<item><title>${t}</title><link>${u}</link><pubDate>${d}</pubDate><description>${t}.</description></item>`).join('')}</channel></rss>`;

interface World {
  feeds: Record<string, string>;
  pages: Record<string, string>;
  down?: boolean;
}

function fakeFetch(world: World): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (world.down) throw new Error('network down');
    if (url.startsWith('https://itunes.apple.com/')) return Response.json({ results: [{ trackName: 'App', artworkUrl512: 'https://is1.mzstatic.com/image/a/512x512bb.jpg' }] });
    const body = world.feeds[url] ?? world.pages[url.replace(/\/$/, '')];
    return body ? new Response(body) : new Response('missing', { status: 404 });
  }) as typeof fetch;
}

const EVENTS: [RegExp, string, number][] = [
  [/Services tab/i, 'airbnb-services-tab', 5],
  [/Liquid Glass/i, 'apple-ios-liquid-glass-slider', 4],
];

/** Stands in for Claude. Search returns fixed results; curate keeps candidates that match EVENTS. */
class FakeLlm implements Llm {
  readonly mode = 'api' as const;
  readonly canSearch = true;
  calls: MessagesRequest[] = [];
  searchItems: unknown[] = [];

  async messages(req: MessagesRequest) {
    this.calls.push(req);
    const usage = { input_tokens: 1000, output_tokens: 200, web_searches: req.tools ? 2 : 0 };
    if (req.tools) {
      const blocks = [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.theverge.com/old-airbnb', page_age: '2 hours ago' }] },
        { type: 'text', text: JSON.stringify({ items: this.searchItems }) },
      ];
      return { content: blocks, stopReason: 'end_turn', usage };
    }
    const input = JSON.parse(req.messages[0].content as string) as { candidates: { cid: string; app: string; title: string }[] };
    const items: unknown[] = [];
    const dropped: unknown[] = [];
    for (const [re, id, importance] of EVENTS) {
      const hits = input.candidates.filter((c) => re.test(c.title));
      if (hits.length) {
        items.push({
          event_id: id,
          app: hits[0].app,
          beta: /beta/i.test(hits[0].title),
          importance,
          headline: `${hits[0].app} ${hits[0].title.replace(/^\S+\s/, '')}!`,
          what: 'A new tab sits next to Stays and Experiences. 🚀 It lists bookable services.',
          why: 'Search results now mix three product types, so filters and the tab bar need to scale.',
          source_cids: hits.map((c) => c.cid),
        });
      }
    }
    for (const c of input.candidates) if (!EVENTS.some(([re]) => re.test(c.title))) dropped.push({ cid: c.cid, reason: 'no UI change' });
    return { content: [{ type: 'text', text: JSON.stringify({ items, dropped, pattern: null }) }], stopReason: 'end_turn', usage };
  }
}

function day1World(): World {
  return {
    feeds: {
      'https://news.airbnb.com/feed/': rss([
        ['Airbnb introduces a Services tab', 'https://news.airbnb.com/services-tab/', h(2)],
        ['Airbnb celebrates hosts in Lisbon', 'https://news.airbnb.com/lisbon/', h(5)],
        ['Airbnb Summer Release recap', 'https://news.airbnb.com/summer/', h(24 * 5)],
      ]),
      'https://9to5mac.com/feed/': rss([
        ['Airbnb adds Services tab to its iPhone app', 'https://9to5mac.com/airbnb-services/', h(3)],
        ['iOS 26.2 beta adds a Liquid Glass slider', 'https://9to5mac.com/ios-26-2-glass/', h(4)],
        ['Expedia closes funding round', 'https://9to5mac.com/expedia-funding/', h(6)],
        ['Best Apple Watch deals this week', 'https://9to5mac.com/deals/', h(1)],
        ['Samsung unveils a new foldable', 'https://9to5mac.com/samsung/', h(2)],
        ['Gmail email threads get a new look', 'https://9to5mac.com/gmail/', h(2)],
      ]),
    },
    pages: {
      'https://news.airbnb.com/services-tab': '<meta property="og:image" content="https://news.airbnb.com/hero.jpg">',
      'https://9to5mac.com/ios-26-2-glass': '<meta property="og:image" content="https://9to5mac.com/glass.jpg"><meta property="article:published_time" content="2026-10-28T19:00:00Z">',
      // Search says "2 hours ago", the page says July: the page wins.
      'https://theverge.com/old-airbnb': '<meta property="article:published_time" content="2026-07-01T10:00:00Z">',
    },
  };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'radar-'));
  const paths = { ...defaultPaths(dir), cache: join(dir, '.cache') };
  const llm = new FakeLlm();
  llm.searchItems = [
    { url: 'https://medium.com/@someone/airbnb-redesign', title: 'I redesigned Airbnb', publisher: 'Medium', app: 'Airbnb' },
    { url: 'https://travel-seo-blog.example/airbnb', title: 'Airbnb Services: 10 things', publisher: 'Blog', app: 'Airbnb' },
    { url: 'https://www.theverge.com/old-airbnb', title: 'Airbnb tests a new map', publisher: 'The Verge', app: 'Airbnb' },
  ];
  const read = <T>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;
  return { dir, paths, llm, read };
}

test('collect: keeps real changes, merges syndicated copies, drops everything else with a reason', async () => {
  const { paths, llm, read } = setup();
  const r = await collect({ cfg: CFG, now: NOW, llm, fetchImpl: fakeFetch(day1World()), paths });

  assert.equal(r.date, '2026-10-29');
  assert.deepEqual(r.kept.map((i) => i.id), ['airbnb-services-tab', 'apple-ios-liquid-glass-slider']);
  const [airbnb, apple] = r.kept;
  assert.equal(airbnb.sources.length, 2);
  assert.equal(airbnb.sources[0].publisher, 'Airbnb Newsroom', 'company post first');
  assert.equal(airbnb.image, 'https://news.airbnb.com/hero.jpg');
  assert.match(airbnb.icon ?? '', /mzstatic\.com\/.*128x128bb\.png$/);
  assert.equal(apple.beta, true);
  assert.equal(apple.icon, 'https://www.google.com/s2/favicons?domain=apple.com&sz=64');
  assert.doesNotMatch(airbnb.what, /🚀/, 'emojis are stripped');
  assert.doesNotMatch(airbnb.headline, /!/, 'no exclamation marks');

  const reasons = Object.fromEntries([...r.preDropped, ...r.modelDropped].map((d) => [d.title, d.reason]));
  assert.equal(reasons['Airbnb Summer Release recap'], 'older than 48h');
  assert.equal(reasons['Expedia closes funding round'], 'headline matches drop word "funding"');
  assert.equal(reasons['Best Apple Watch deals this week'], 'headline matches drop word "deals"');
  assert.equal(reasons['Samsung unveils a new foldable'], 'not about a watchlist app');
  assert.equal(reasons['Gmail email threads get a new look'], 'not about a watchlist app', 'aliases match exact capitals only');
  assert.equal(reasons['I redesigned Airbnb'], 'blocked source (medium.com)');
  assert.equal(reasons['Airbnb Services: 10 things'], 'not a trusted source (travel-seo-blog.example)');
  assert.equal(reasons['Airbnb tests a new map'], 'older than 48h', 'page date beats the search date');
  assert.equal(reasons['Airbnb celebrates hosts in Lisbon'], 'no UI change');

  const radar = read<Radar>(paths.radar);
  assert.equal(radar.days.length, 1);
  assert.equal(radar.days[0].quiet, false);
  assert.ok(read<Seen>(paths.seen).events['airbnb-services-tab']);
  const runs = read<{ usage: unknown[]; cost_usd: number }[]>(paths.runs);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].usage.length, 2, 'one search call (only ota has queries) + one curate call');
  assert.ok(runs[0].cost_usd > 0);
  assert.equal(llm.calls.filter((c) => !c.tools).length, 1, 'one curate call per run');
});

test('collect twice on the same day: no duplicates, nothing rewritten', async () => {
  const { paths, llm, read } = setup();
  const world = day1World();
  await collect({ cfg: CFG, now: NOW, llm, fetchImpl: fakeFetch(world), paths });
  const before = readFileSync(paths.radar, 'utf8');
  const r2 = await collect({ cfg: CFG, now: new Date(NOW.getTime() + 2 * 3_600_000), llm, fetchImpl: fakeFetch(world), paths });
  assert.equal(r2.added.length, 0);
  assert.equal(r2.dayExisted, true);
  const radar = read<Radar>(paths.radar);
  assert.equal(radar.days.length, 1);
  assert.equal(radar.days[0].items.length, 2);
  assert.deepEqual(radar.days[0].items, (JSON.parse(before) as Radar).days[0].items);
});

test('next day: a re-syndicated launch is not reported again, and an empty day is recorded as quiet', async () => {
  const { paths, llm, read } = setup();
  await collect({ cfg: CFG, now: NOW, llm, fetchImpl: fakeFetch(day1World()), paths });
  const day1 = read<Radar>(paths.radar).days[0];

  const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000);
  const world = day1World();
  world.feeds['https://9to5mac.com/feed/'] = rss([
    ['Airbnb Services tab now live in more countries', 'https://9to5mac.com/airbnb-services-more/', h(3, tomorrow)],
    ['Best iPad deals', 'https://9to5mac.com/ipad-deals/', h(1, tomorrow)],
  ]);
  llm.searchItems = [];
  const r = await collect({ cfg: CFG, now: tomorrow, llm, fetchImpl: fakeFetch(world), paths });

  assert.equal(r.date, '2026-10-30');
  assert.equal(r.kept.length, 0);
  assert.match(r.modelDropped.find((d) => /more countries/.test(d.title))!.reason, /^already reported on 2026-10-29/);
  assert.ok(r.preDropped.some((d) => d.reason === 'already reported on an earlier day'), 'yesterday’s URLs are filtered before the model');
  const radar = read<Radar>(paths.radar);
  assert.equal(radar.days.length, 2);
  assert.deepEqual(radar.days[0], { date: '2026-10-30', collected_at: tomorrow.toISOString(), quiet: true, pattern: null, items: [] });
  assert.deepEqual(radar.days[1], day1, 'past day untouched');
});

test('quiet day with nothing new from any source skips the model call', async () => {
  const { paths, llm, read } = setup();
  llm.searchItems = [];
  const world: World = { feeds: { 'https://news.airbnb.com/feed/': rss([]), 'https://9to5mac.com/feed/': rss([['Best iPad deals', 'https://9to5mac.com/d/', h(1)]]) }, pages: {} };
  const r = await collect({ cfg: CFG, now: NOW, llm, fetchImpl: fakeFetch(world), paths });
  assert.equal(r.quiet, true);
  assert.equal(llm.calls.filter((c) => !c.tools).length, 0);
  assert.equal(read<Radar>(paths.radar).days[0].quiet, true);
});

test('when every source fails, nothing is written (not a fake quiet day)', async () => {
  const { paths, llm } = setup();
  const failing: Llm = { mode: 'api', canSearch: true, messages: async () => Promise.reject(new Error('API down')) };
  await assert.rejects(collect({ cfg: CFG, now: NOW, llm: failing, fetchImpl: fakeFetch({ feeds: {}, pages: {}, down: true }), paths }), SourcesDownError);
  assert.equal(existsSync(paths.radar), false);
  void llm;
});

test('dry run calls no model and writes nothing', async () => {
  const { paths } = setup();
  const r = await collect({ cfg: CFG, now: NOW, llm: null, fetchImpl: fakeFetch(day1World()), paths, dryRun: true });
  assert.ok(r.sentToModel.length >= 3);
  assert.equal(existsSync(paths.radar), false);
});

test('manual mode: saves the question, then finishes offline from the saved sources', async () => {
  const { paths, read } = setup();
  const { manualLlm, AnswerPendingError } = await import('../src/llm.ts');
  const llm = manualLlm(join(paths.cache, 'llm'));
  await assert.rejects(collect({ cfg: CFG, now: NOW, llm, fetchImpl: fakeFetch(day1World()), paths }), AnswerPendingError);
  const [req] = (await import('node:fs')).readdirSync(join(paths.cache, 'llm', 'requests'));
  const q = read<{ answer_to: string; user: string }>(join(paths.cache, 'llm', 'requests', req));
  const answer = await new FakeLlm().messages({ model: 'x', system: '', maxTokens: 1, messages: [{ role: 'user', content: q.user }] });
  (await import('node:fs')).writeFileSync(q.answer_to, answer.content[0].text!);

  // Second run with the network gone: everything comes from the snapshot.
  const r = await collect({ cfg: CFG, now: NOW, llm, fetchImpl: fakeFetch({ feeds: {}, pages: {}, down: true }), paths });
  assert.deepEqual(r.kept.map((i) => i.id), ['airbnb-services-tab', 'apple-ios-liquid-glass-slider']);
  assert.equal(r.kept[1].image, 'https://9to5mac.com/glass.jpg', 'og:image read during the online run');
  assert.equal(r.search.ran, false);
  assert.equal(read<Radar>(paths.radar).days[0].items.length, 2);
});

test('mergeDay refuses to write a day older than the newest one', () => {
  const radar: Radar = { version: 1, updated_at: '', days: [{ date: '2026-10-29', collected_at: '', quiet: true, pattern: null, items: [] }] };
  assert.throws(() => mergeDay(radar, { date: '2026-10-28', items: [], pattern: null, now: NOW }), /never rewritten/);
});

test('matchApp uses whole words and the earliest alias', () => {
  assert.equal(matchApp(CFG, 'Threads adds a new feed for Apple fans')?.name, 'Threads');
  assert.equal(matchApp(CFG, 'Pineapple prices')?.name, undefined);
  assert.equal(matchApp(CFG, 'iOS 26: what is new')?.name, 'Apple');
});

test('prefilter numbers candidates and puts company posts first', () => {
  const c = (title: string, trust: 'company' | 'outlet', hours: number) => ({
    cid: '', title, url: `https://x.com/${title}`, source: 's', domain: 'x.com', publishedAt: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
    summary: '', image: null, via: 'feed' as const, trust, app: 'Airbnb',
  });
  const { kept } = prefilter(CFG, [c('a', 'outlet', 1), c('b', 'company', 10)], { now: NOW, seenUrls: new Set() });
  assert.deepEqual(kept.map((k) => [k.cid, k.title]), [['c1', 'b'], ['c2', 'a']]);
});

test('similar() catches the same headline written twice', () => {
  assert.ok(similar('Airbnb adds a Services tab to the app', 'Airbnb adds Services tab to the app') >= 0.8);
  assert.ok(similar('iOS 26.1 beta 1 adds a slider', 'Airbnb adds Services tab') < 0.3);
});
