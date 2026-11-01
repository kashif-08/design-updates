// Before / after pictures for kept items, instead of a generic photo of the company.
// 1. Version notes from the stores: last version's screenshot next to this one's, when they differ.
// 2. Articles: captions, alt text and file names usually say which picture is the old design ("the previous
//    logo") and which the new. Clear cases are matched here; the rest go to one small model call that sees only
//    those words, never the pictures, and answers "not sure" when they don't say.
// When there's only a picture of the new design, it replaces the generic photo.

import type { Config } from './config.ts';
import { textOf, usageOf, type Llm } from './llm.ts';
import type { PageImage } from './pagemeta.ts';
import type { CallUsage, Compare, Item } from './types.ts';
import { parseJsonLoose } from './util.ts';

const OLD = /\b(before|old|older|previous|former|original|outgoing|legacy|prior|was)\b|\b(19|20)\d\d\b.*\b(logo|mark|identity|design)\b/i;
const NEW = /\b(after|new|updated|redesign(ed)?|refreshed|revamped|current|now)\b/i;
const BOTH = /\b(before (and|&|\/|vs\.?) after|old (and|&|\/|vs\.?) new|side[- ]by[- ]side|comparison|compared)\b/i;
const FILE_OLD = /[-_/](old|before|previous|prev|legacy)[-_.]/i;
const FILE_NEW = /[-_/](new|after|updated|redesign)[-_.]/i;

const words = (img: PageImage) => `${img.alt} ${img.caption}`.trim();

/** Clear cases only. Returns null when the words don't settle it. */
export function pairFromWords(images: PageImage[]): Compare | null {
  const both = images.find((i) => BOTH.test(words(i)));
  if (both) return { before: null, after: both.src, combined: true, from: 'article' };
  const isOld = (i: PageImage) => (OLD.test(words(i)) && !NEW.test(words(i).replace(OLD, ''))) || FILE_OLD.test(i.src);
  const isNew = (i: PageImage) => (NEW.test(words(i)) && !OLD.test(words(i))) || FILE_NEW.test(i.src);
  const before = images.find(isOld);
  const after = images.find((i) => i !== before && isNew(i));
  return before && after ? { before: before.src, after: after.src, from: 'article' } : null;
}

/** A picture whose words or file name say it shows the new design, when there is no old one to pair it with. */
export function newOnly(images: PageImage[]): string | null {
  return images.find((i) => (NEW.test(words(i)) && !OLD.test(words(i))) || FILE_NEW.test(i.src))?.src ?? null;
}

const COMPARE_SYSTEM = `You help a design news page show before/after pictures. For each item you get its headline and the pictures in the source articles, described ONLY by their alt text, caption and file name. You cannot see the pictures.

For each item, pick:
- "before": the index of a picture that shows the OLD design (previous logo, old screen, old app icon), or null.
- "after": the index of a picture that shows the NEW design, or null.
- "combined": the index of ONE picture that shows old and new together, or null.

Only pick an index when its words clearly say what it shows. Photos of people, offices, events and products in use are neither. If you are not sure, use null. A wrong pair is worse than none.

Reply with JSON only: {"items": [{"id": "...", "before": null, "after": 2, "combined": null}]}`;

export interface CompareResult {
  items: Item[];
  usage: CallUsage | null;
  notes: string[];
}

/**
 * Adds `compare` (and a better `image`) to kept items.
 * imagesFor gives the article pictures for an item's sources; it may read saved page details or the network.
 */
export async function addCompares(cfg: Config, items: Item[], imagesFor: (item: Item) => Promise<PageImage[]>, llm: Llm | null, releaseShots: Map<string, { before: string | null; after: string | null; beforeVersion: string | null }>): Promise<CompareResult> {
  const notes: string[] = [];
  const out = items.map((i) => ({ ...i }));
  const ask: { item: Item; images: PageImage[] }[] = [];

  for (const item of out) {
    const shots = releaseShots.get(item.id);
    if (shots) {
      if (shots.after && shots.before && shots.before !== shots.after) {
        item.compare = { before: shots.before, after: shots.after, from: 'app-store', before_version: shots.beforeVersion ?? undefined };
        notes.push(`${item.id}: App Store screenshots of ${shots.beforeVersion} and ${item.release?.version}`);
      } else if (shots.after) item.image = shots.after;
      continue;
    }
    if (item.kind !== 'ui' && item.kind !== 'brand') continue;
    const images = (await imagesFor(item)).slice(0, 12);
    if (images.length < 1) continue;
    const pair = pairFromWords(images);
    const fresh = pair ? null : newOnly(images);
    if (pair) {
      item.compare = pair;
      notes.push(`${item.id}: ${pair.combined ? 'one before/after picture' : 'before and after'} from captions`);
    } else if (fresh) {
      item.image = fresh;
      notes.push(`${item.id}: picture of the new design from captions`);
    } else ask.push({ item, images });
  }

  let usage: CallUsage | null = null;
  if (ask.length && llm && llm.mode !== 'manual' && cfg.models.compare) {
    const input = {
      items: ask.map(({ item, images }) => ({
        id: item.id,
        headline: item.headline,
        kind: item.kind,
        pictures: images.map((img, i) => ({ i, alt: img.alt, caption: img.caption, file: img.src.split('/').pop()?.split('?')[0] ?? '' })),
      })),
    };
    try {
      const res = await llm.messages({ model: cfg.models.compare, system: COMPARE_SYSTEM, messages: [{ role: 'user', content: JSON.stringify(input) }], maxTokens: 2000 });
      usage = usageOf('compare', cfg.models.compare, res);
      const answer = parseJsonLoose(textOf(res.content)) as { items?: { id?: string; before?: unknown; after?: unknown; combined?: unknown }[] };
      for (const a of answer.items ?? []) {
        const job = ask.find((j) => j.item.id === a.id);
        if (!job) continue;
        const pick = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < job.images.length ? job.images[v as number].src : null);
        const combined = pick(a.combined);
        const before = pick(a.before);
        const after = pick(a.after);
        if (combined) {
          job.item.compare = { before: null, after: combined, combined: true, from: 'article' };
          notes.push(`${job.item.id}: one before/after picture (model)`);
        } else if (before && after && before !== after) {
          job.item.compare = { before, after, from: 'article' };
          notes.push(`${job.item.id}: before and after (model)`);
        } else if (after) {
          job.item.image = after;
          notes.push(`${job.item.id}: picture of the new design (model)`);
        }
      }
    } catch (err) {
      notes.push(`before/after step skipped: ${(err as Error).message}`);
    }
  }
  return { items: out, usage, notes };
}
