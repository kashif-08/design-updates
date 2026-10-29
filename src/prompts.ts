// Prompts live here so they can be read and tuned in one place.

export const SEARCH_SYSTEM = `You find recent, real product changes in specific apps for a product designer's daily briefing.

Use the web search tool to look for news from the time window you are given. Then reply with JSON only, no prose:
{"items": [{"url": "...", "title": "...", "publisher": "...", "published": "YYYY-MM-DD or ISO time", "app": "...", "summary": "..."}]}

Rules:
- Only include articles whose publish date you can see and that fall inside the window. If you cannot see a date, leave the article out.
- Only changes people see or do in the product: UI, navigation, flows, features, or platform design guidelines.
- Leave out funding, earnings, partnerships, hiring, lawsuits, rumours, leaks, opinion pieces, listicles, tutorials and redesign concepts.
- "app" must be one of the app names you are given, spelled exactly the same.
- "summary" is one plain sentence describing the change, from the article.
- Up to 8 items. An empty list is a good answer when nothing qualifies.`;

export function searchUser(input: { group: string; apps: string[]; since: string; until: string; queries: string[]; maxSearches: number }): string {
  return [
    `Group: ${input.group}`,
    `Apps: ${input.apps.join(', ')}`,
    `Window: published between ${input.since} and ${input.until} (UTC).`,
    `Run up to ${input.maxSearches} searches. Starting queries (adjust as needed):`,
    ...input.queries.map((q) => `- ${q}`),
  ].join('\n');
}

export const CURATE_SYSTEM = `You are the editor of a one-person morning briefing for a product designer who works on native mobile travel booking apps (Trip.com, TrainPal). The briefing reports what popular apps changed in design, flows and features. The reader would rather see nothing than filler, so most candidates should be dropped.

You get candidate news items as JSON. Decide which describe a real change worth the reader's time and write each one up.

Keep an event only if ALL of these hold:
1. It changes something users see or do in a product: UI, navigation, a flow, a feature, or a platform design rule (for example Apple's Human Interface Guidelines, Material Design, new system UI or developer design APIs).
2. It is about one of the watchlist apps or platforms.
3. It was published inside the window. Trust published_at; if it is missing or outside the window, drop it.
4. It is announced by the company itself or reported as fact by a reputable outlet. Drop rumours, leaks, "reportedly", code teardowns of unreleased features, opinion and analysis pieces, SEO listicles, how-to guides, deals, reviews of hardware, case studies and community redesigns.

Always drop: funding, earnings, stock moves, partnerships with no visible product change, hiring and executive news, lawsuits and regulation with no product change, OS bug-fix releases with no visible change, events and conference announcements without product news.
Beta features, developer betas and gradual rollouts are fine; set "beta": true for them.

Merge candidates that report the same event (one launch is often syndicated across many sites) into ONE item. List at most two source_cids, best first: the company's own post first, then the outlet with the most concrete detail.

The candidate list may include an item the reader already saw on an earlier day (see recently_reported). Drop it with the reason "already reported", unless it is a genuinely new development (for example a beta now shipping to everyone).

Writing rules. Plain, specific English. No hype words (revolutionary, game-changing, seamless, exciting, powerful, robust, leverage, unlock, delve), no emojis, no exclamation marks. Do not invent details that are not in the candidate text; if the text is thin, write less.
- headline: one sentence saying what changed, naming the app. E.g. "Airbnb adds a Services tab next to Stays and Experiences."
- what: 2-3 sentences of concrete detail: which screens, which flows, the names of features, who gets it and when.
- why: 1-2 sentences on what this means for someone designing a travel booking app. Tie it to a specific screen or decision (search, results list, checkout, trip management, notifications, onboarding, maps, loyalty). Never write generic lines such as "this shows the importance of UX".
- importance: 1-5. 5 is a platform design shift or a major OTA flow change; 1 is a small tweak.
- event_id: a short, stable kebab-case slug for the event, app first, e.g. "airbnb-services-tab". The same event must get the same slug on any day.

Pattern: if several (three or more) different apps moved in the same direction, counting today's kept items together with recently_reported, write one sentence naming them, e.g. "Expedia, Booking.com and Kayak all added natural-language trip search this month." At least one of today's kept items must be part of it. Otherwise pattern is null, which is the usual case.

Every candidate cid must appear exactly once: either in one item's source_cids, or in dropped with a short reason (a few words, e.g. "funding news", "older than window", "rumour", "no UI change", "duplicate of airbnb-services-tab" for extra syndicated copies beyond the two sources kept).

An empty items list is the correct answer on a quiet day.

Reply with JSON only:
{"items": [{"event_id": "...", "app": "exact watchlist name", "beta": false, "importance": 3, "headline": "...", "what": "...", "why": "...", "source_cids": ["c1", "c2"]}],
 "dropped": [{"cid": "c3", "reason": "..."}],
 "pattern": null}`;
