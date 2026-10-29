// npm run build: copies the static site and today's data into dist/ for GitHub Pages.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { emptyRadar } from './radar.ts';
import { readJson, writeJson } from './util.ts';

const cfg = loadConfig();
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/data', { recursive: true });
cpSync('site', 'dist', { recursive: true });
writeJson('dist/data/radar.json', readJson('data/radar.json', emptyRadar()));
// Page settings the site needs from watchlist.yaml: the name in the greeting and the category labels.
writeJson('dist/data/meta.json', {
  reader: cfg.reader,
  timezone: cfg.timezone,
  feeds: cfg.feeds.length,
  search: cfg.provider === 'anthropic' && cfg.models.searchesPerGroup > 0 && cfg.groups.some((g) => g.search.length),
  ai: cfg.provider === 'gemini' ? 'Gemini' : 'Claude',
  categories: Object.fromEntries(cfg.groups.map((g) => [g.category, g.label])),
});
writeFileSync('dist/.nojekyll', '');
console.log('Built dist/');
