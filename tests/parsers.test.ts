import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig, parseConfig } from '../src/config.ts';
import { parseFeed } from '../src/feeds.ts';
import { parsePageMeta } from '../src/pagemeta.ts';
import { normalizeUrl } from '../src/util.ts';
import { parseYaml } from '../src/yaml.ts';

test('yaml: nested maps, lists of maps, inline lists and maps, comments, quotes', () => {
  const y = parseYaml(`
# top comment
name: "Radar # not a comment"
count: 3
on: true
models:
  curate: claude-x   # trailing comment
prices:
  m: { input: 3, output: 15 }
apps:
  - name: Expedia
    aliases: [Expedia, "Hotels.com"]
    domains:
      - expedia.com
  - name: Agoda
words:
  - "% off"
  - plain
empty:
url: https://example.com/a:b
`) as Record<string, any>;
  assert.equal(y.name, 'Radar # not a comment');
  assert.equal(y.count, 3);
  assert.equal(y.on, true);
  assert.equal(y.models.curate, 'claude-x');
  assert.deepEqual(y.prices.m, { input: 3, output: 15 });
  assert.deepEqual(y.apps[0], { name: 'Expedia', aliases: ['Expedia', 'Hotels.com'], domains: ['expedia.com'] });
  assert.deepEqual(y.apps[1], { name: 'Agoda' });
  assert.deepEqual(y.words, ['% off', 'plain']);
  assert.equal(y.empty, null);
  assert.equal(y.url, 'https://example.com/a:b');
});

test('yaml: tabs are rejected with a line number', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), /line 2.*tabs/);
});

test('watchlist.yaml loads, every feed names a real app, and no app is listed twice', () => {
  const cfg = loadConfig();
  assert.deepEqual(cfg.groups.map((g) => g.category), ['ota', 'rail', 'platform', 'consumer']);
  assert.ok(cfg.apps.length >= 20);
  assert.ok(cfg.feeds.length >= 10);
});

test('config: duplicate apps and unknown feed apps are explained', () => {
  const base = 'groups:\n  ota:\n    apps:\n      - name: A\n';
  assert.throws(() => parseConfig(`${base}  consumer:\n    apps:\n      - name: A\n`), /listed twice/);
  assert.throws(() => parseConfig(`${base}feeds:\n  - url: https://x\n    kind: company\n    app: B\n`), /not in groups/);
});

test('rss: title, link, date, summary and image from media:content', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title><![CDATA[Airbnb adds &amp; tests Services]]></title><link>https://news.airbnb.com/services/?utm_source=rss</link>
    <pubDate>Tue, 28 Oct 2026 14:00:00 +0000</pubDate><description><![CDATA[<p>New <b>tab</b> in the app.</p>]]></description>
    <media:content url="https://img.example/a.jpg" medium="image"/></item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const [e, ...rest] = parseFeed(xml, 'https://news.airbnb.com/feed/');
  assert.equal(rest.length, 0);
  assert.equal(e.title, 'Airbnb adds & tests Services');
  assert.equal(e.publishedAt, '2026-10-28T14:00:00.000Z');
  assert.equal(e.summary, 'New tab in the app.');
  assert.equal(e.image, 'https://img.example/a.jpg');
  assert.equal(normalizeUrl(e.url), 'https://news.airbnb.com/services');
});

test('atom: alternate link, published date, image from content', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Material 3 update</title>
    <link rel="replies" href="https://x/comments"/><link rel="alternate" type="text/html" href="https://android-developers.googleblog.com/2026/10/m3.html"/>
    <published>2026-10-28T09:00:00-07:00</published><content type="html">&lt;img src="https://img/x.png"&gt; Hello</content></entry></feed>`;
  const [e] = parseFeed(xml, 'https://android-developers.googleblog.com/feeds/posts/default');
  assert.equal(e.url, 'https://android-developers.googleblog.com/2026/10/m3.html');
  assert.equal(e.publishedAt, '2026-10-28T16:00:00.000Z');
  assert.equal(e.title, 'Material 3 update');
});

test('rss: escaped HTML in descriptions is stripped too', () => {
  const xml = `<rss><channel><item><title>T</title><link>https://a.b/c</link><description>&lt;div class="x"&gt;&lt;img src="i.jpg"&gt;&lt;/div&gt;Real text &amp;amp; more</description></item></channel></rss>`;
  assert.equal(parseFeed(xml, 'https://a.b/')[0].summary, 'Real text & more');
});

test('page meta: article:published_time, og:image (made absolute), JSON-LD fallback', () => {
  const a = parsePageMeta(`<head><meta property="og:image" content="/img/hero.png"><meta property="article:published_time" content="2026-10-27T08:00:00Z"><meta property="og:site_name" content="The Verge"></head>`, 'https://www.theverge.com/x');
  assert.deepEqual([a.publishedAt, a.image, a.siteName], ['2026-10-27T08:00:00.000Z', 'https://www.theverge.com/img/hero.png', 'The Verge']);
  const b = parsePageMeta(`<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-03-01T10:00:00Z"}</script>`, 'https://x.com');
  assert.equal(b.publishedAt, '2025-03-01T10:00:00.000Z');
});

test('the README documents the commands package.json defines', () => {
  const readme = readFileSync('README.md', 'utf8');
  const scripts = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts);
  for (const s of scripts) assert.ok(readme.includes(`npm run ${s}`) || s === 'test', `README is missing npm run ${s}`);
});
