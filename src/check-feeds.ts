// npm run check-feeds: tries every feed in watchlist.yaml and says which work, how many items each has,
// and how old the newest one is. Use it after adding a source.

import { loadConfig } from './config.ts';
import { readFeed } from './feeds.ts';
import { ago, mapLimit, parseDate } from './util.ts';

const cfg = loadConfig();
const now = new Date();
const results = await mapLimit(cfg.feeds, 6, (f) => readFeed(f));
let bad = 0;
for (const r of results) {
  if (!r.ok) {
    bad++;
    console.log(`FAIL  ${r.feed.name.padEnd(26)} ${r.error}\n      ${r.feed.url}`);
    continue;
  }
  const dates = r.entries.map((e) => parseDate(e.publishedAt)).filter((d): d is Date => !!d);
  const newest = dates.sort((a, b) => b.getTime() - a.getTime())[0];
  const undated = r.entries.length - dates.length;
  console.log(`ok    ${r.feed.name.padEnd(26)} ${String(r.entries.length).padStart(3)} items, newest ${newest ? ago(newest, now) : 'undated'}${undated ? `, ${undated} without a date` : ''}`);
}
console.log(`\n${results.length - bad} of ${results.length} feeds work.`);
process.exit(bad ? 1 : 0);
