// radar.json holds every day, newest first. A run only ever adds a new day at the top, or adds items to
// today's day if it already exists (a second run on the same day). Past days are never changed.

import type { Day, Item, Radar, Seen } from './types.ts';

export const emptyRadar = (): Radar => ({ version: 1, updated_at: new Date(0).toISOString(), days: [] });

export interface MergeResult {
  radar: Radar;
  added: Item[];
  day: Day;
  created: boolean;
}

const order = (a: Item, b: Item) => b.importance - a.importance || b.published_at.localeCompare(a.published_at);

export function mergeDay(radar: Radar, input: { date: string; items: Item[]; pattern: string | null; now: Date }): MergeResult {
  const latest = radar.days[0];
  if (latest && input.date < latest.date) {
    throw new Error(`refusing to write ${input.date}: radar.json already has a newer day (${latest.date}). Past days are never rewritten.`);
  }
  const now = input.now.toISOString();
  if (latest && latest.date === input.date) {
    const have = new Set(latest.items.map((i) => i.id));
    const added = input.items.filter((i) => !have.has(i.id));
    const day: Day = {
      ...latest,
      items: [...latest.items, ...added].sort(order),
      quiet: latest.items.length + added.length === 0,
      pattern: latest.pattern ?? (added.length ? input.pattern : null),
    };
    return { radar: { ...radar, updated_at: now, days: [day, ...radar.days.slice(1)] }, added, day, created: false };
  }
  const items = [...input.items].sort(order);
  const day: Day = { date: input.date, collected_at: now, quiet: items.length === 0, pattern: items.length ? input.pattern : null, items };
  return { radar: { ...radar, updated_at: now, days: [day, ...radar.days] }, added: items, day, created: true };
}

export function recordSeen(seen: Seen, items: Item[]): Seen {
  const events = { ...seen.events };
  for (const i of items) events[i.id] = { app: i.app, headline: i.headline, date: i.date, urls: i.sources.map((s) => s.url) };
  return { events };
}

export function seenUrls(seen: Seen): Set<string> {
  return new Set(Object.values(seen.events).flatMap((e) => e.urls));
}

/** What the model is told the reader has already seen: the last two weeks. */
export function recentItems(radar: Radar, today: string, days = 14) {
  const cutoff = new Date(new Date(`${today}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return radar.days
    .filter((d) => d.date >= cutoff)
    .flatMap((d) => d.items.map((i) => ({ event_id: i.id, app: i.app, date: i.date, headline: i.headline })));
}
