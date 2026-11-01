// npm run backfill-compare [-- --dry-run]
// Adds before/after pictures to items already in radar.json that have none, by re-reading their source pages.
// It only adds `compare` (and a better `image`); headlines and text are never changed.

import { addCompares } from './compare.ts';
import { loadConfig } from './config.ts';
import { companyLlm, companyLogin, type Llm } from './llm.ts';
import { fetchPageMeta } from './pagemeta.ts';
import type { Item, Radar } from './types.ts';
import { readJson, writeJson } from './util.ts';

const dry = process.argv.includes('--dry-run');
const cfg = loadConfig();
const radar = readJson<Radar>('data/radar.json', { version: 1, updated_at: '', days: [] });
const login = cfg.provider === 'company' ? companyLogin() : null;
const llm: Llm | null = login ? companyLlm(login) : null;
if (!llm) console.log('No company login found; only captions that clearly say "before"/"after" are used.');

const todo = radar.days.flatMap((d) => d.items).filter((i) => !i.compare && (i.kind === 'ui' || i.kind === 'brand'));
console.log(`${todo.length} items without before/after`);
const pages = new Map<string, Awaited<ReturnType<typeof fetchPageMeta>>>();
const imagesFor = async (item: Item) => {
  const out = [];
  for (const s of item.sources) {
    if (!pages.has(s.url)) pages.set(s.url, await fetchPageMeta(s.url));
    out.push(...(pages.get(s.url)?.images ?? []));
  }
  return out;
};
const r = await addCompares(cfg, todo, imagesFor, llm, new Map());
for (const n of r.notes) console.log(`  ${n}`);
if (r.usage) console.log(`  model: ${r.usage.model} in ${r.usage.input_tokens} out ${r.usage.output_tokens}${r.usage.credits ? ` credits ${r.usage.credits.toFixed(3)}` : ''}`);

const changed = new Map(r.items.filter((i, n) => i.compare || i.image !== todo[n].image).map((i) => [i.id, i]));
console.log(`${changed.size} items get a new picture`);
if (!dry && changed.size) {
  for (const d of radar.days) d.items = d.items.map((i) => (changed.has(i.id) ? { ...i, compare: changed.get(i.id)!.compare ?? null, image: changed.get(i.id)!.image } : i));
  writeJson('data/radar.json', radar);
  console.log('Saved data/radar.json');
}
