// Reads an article page for its real publish date, og:image and site name.
// Search results often carry no date, or the date a page was last crawled; the page itself is the check.

import { decodeEntities, fetchText, parseDate } from './util.ts';

export interface PageMeta {
  publishedAt: string | null;
  image: string | null;
  siteName: string | null;
  title: string | null;
}

const DATE_KEYS = ['article:published_time', 'og:published_time', 'datepublished', 'pubdate', 'publish-date', 'publishdate', 'date', 'dc.date', 'dc.date.issued', 'sailthru.date', 'parsely-pub-date'];

export function parsePageMeta(html: string, pageUrl: string): PageMeta {
  const head = html.slice(0, 400_000);
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    const key = (t.match(/\s(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    const content = t.match(/\scontent\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (key && content && !meta.has(key)) meta.set(key, decodeEntities(content[2] ?? content[3] ?? ''));
  }

  let published: Date | null = null;
  for (const k of DATE_KEYS) {
    published = parseDate(meta.get(k));
    if (published) break;
  }
  if (!published) {
    const ld = head.match(/"datePublished"\s*:\s*"([^"]+)"/);
    published = parseDate(ld?.[1]);
  }
  if (!published) {
    const time = head.match(/<time\b[^>]*\sdatetime\s*=\s*["']([^"']+)["']/i);
    published = parseDate(time?.[1]);
  }

  let image = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image') ?? meta.get('twitter:image:src') ?? null;
  if (image) {
    try {
      image = new URL(image, pageUrl).toString();
    } catch {
      image = null;
    }
  }
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    publishedAt: published ? published.toISOString() : null,
    image,
    siteName: meta.get('og:site_name') ?? null,
    title: meta.get('og:title') ?? (title ? decodeEntities(title.trim()) : null),
  };
}

export async function fetchPageMeta(url: string, fetchImpl: typeof fetch = fetch): Promise<PageMeta | null> {
  try {
    const html = await fetchText(url, { fetchImpl, timeoutMs: 15_000, maxBytes: 600_000 });
    return parsePageMeta(html, url);
  } catch {
    return null;
  }
}
