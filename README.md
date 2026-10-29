# Radar

A morning paper for one: what popular apps changed in design, flows and features, filtered so only real changes get through.

Once a day a job reads news feeds and runs a few web searches, applies strict rules, asks Claude to pick what is worth your time and write it up, and publishes a static page. Today's changes are on top; older days are listed below with a date rail, category filters and unread dots.

| Phone (375px) | Desktop (1280px) |
| --- | --- |
| ![Phone](docs/phone-375.png) | ![Desktop](docs/desktop-1280.png) |

## How a run works

1. **Feeds.** Every RSS/Atom feed in `watchlist.yaml` is read.
2. **Search.** One Claude call per app group (OTAs, rail, platforms, consumer) with the web search tool, limited to the apps' own sites and the trusted outlets list. This catches newsrooms that have no feed.
3. **Rules (no model).** Each item is dropped, with a reason, if it comes from a blocked or unknown site, has no real publish date or is older than 48 hours, is not about a watchlist app, has a drop word in the headline ("funding", "deals", "rumor"...), or was already reported. Search results are dated by the article page itself, not by the search engine.
4. **One curate call.** Claude gets everything that passed, plus what was reported in the last two weeks. It merges syndicated copies of one launch into one item (keeping the two best sources), drops the rest with a reason, and writes `headline`, `what` and `why` for each item it keeps. It adds a `pattern` note only when three or more apps moved the same way.
5. **Checks.** The answer is validated in code: unknown apps, missing sources and incomplete write-ups are dropped; emojis and exclamation marks are removed; hype words are flagged in the log. Each kept page is re-read for its `og:image` and to make sure it is not an old story with a new date.
6. **Write.** `data/radar.json` gets a new day at the top. A quiet day is recorded as `"quiet": true` with no items. `data/seen.json` remembers every reported event, so a launch never shows up again on a later day. `data/runs.json` logs token use and estimated cost per run.

Running twice on the same day only adds genuinely new items to today. Past days are never rewritten. If no source could be read at all, the run fails and writes nothing, rather than claiming a quiet day.

## Commands

Needs Node 24 or newer. There are no npm packages to install.

```bash
npm run collect
```

Runs the job and prints what it kept and what it dropped, with the reason for each. Options (after `--`):

| Option | What it does |
| --- | --- |
| `--dry-run` | Read feeds and apply the rules, call no model, write nothing. |
| `--no-search` | Feeds only. |
| `--manual` | Do the model step by hand instead of using the API (see below). |
| `--gather-only` | Read sources and pages, save them to `.cache/`, stop. |
| `--backfill N` | Also fill the N−1 days before today, oldest first. Past days use feeds only. |
| `--verbose` | List every dropped item, including the hundreds of old and off-topic ones. |

Other commands:

- `npm run check-feeds`: tests every feed URL and says how fresh each one is. Run it after adding a source.
- `npm run icons`: looks up app icons again (App Store artwork, or a favicon) and saves them to `data/icons.json`.
- `npm run build`: builds the site into `dist/`.
- `npm run dev`: builds and serves the site at http://localhost:5180.
- `npm test`: runs the tests.

### Running locally with a key

Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. `.env` is git-ignored.

### Running without a key

`npm run collect -- --manual` saves the model's question to `.cache/llm/requests/<id>.json` and stops. Write the JSON answer to the `answer_to` path in that file (for example by pasting the question into a Claude chat), then run the same command again. The second run reuses the sources saved the first time, so it works offline. Web search is skipped in this mode. The seed data in this repo (23 to 29 October 2026) was made this way from real feeds.

## Editing the watchlist

Everything is in `watchlist.yaml`; no code changes needed.

**Add an app.** Add an entry under one of the four groups:

```yaml
      - name: Kayak
        aliases: [Kayak]             # words that mark a headline as about this app (exact capitals)
        domains: [kayak.com]         # its own sites; count as first-party sources
        appstore_id: 305204535       # optional, for the icon
```

Then run `npm run icons` to fetch its icon. An app can only be in one group. The group decides its category dot on the page.

**Remove an app.** Delete its entry. Items already published stay in `radar.json`.

**Change what gets searched.** Each group has a `search:` list of starting queries. `models.searches_per_group` caps how many searches the model may run per group; set it to `0` to turn search off and cut cost.

**Change the rules.** `window_hours` (default 48), `trust.outlets` (sites trusted for search results), `trust.blocked_domains` (never kept) and `trust.drop_words` (headline words that drop an item before the model sees it). Keep drop words specific: `shares` alone would also drop "Apple shares new design guidance".

**Your name in the greeting.** Set `reader:`.

## Adding a source

Add a feed under `feeds:`:

```yaml
  - name: Kayak Newsroom
    url: https://www.kayak.com/news/feed/
    kind: company      # company: every item is about `app`
    app: Kayak         # outlet: items are matched to apps by alias instead
```

Run `npm run check-feeds` to confirm it works. If a site has no feed, add its domain to the app's `domains` (for a company) or to `trust.outlets` (for a news site) so the search step covers it instead.

When this was set up (October 2026) there was no working public feed for the Airbnb, Expedia Group, Agoda, Trainline and Omio newsrooms, Google Design / Material Design, or PhocusWire (it blocks automated readers). Those are covered by search.

## Changing the run time

The schedule is in `.github/workflows/radar.yml`:

```yaml
  schedule:
    - cron: '0 23 * * *'   # 23:00 UTC = 07:00 Shanghai
```

GitHub cron is always UTC. For 06:30 Shanghai use `30 22 * * *`. The page's "today" follows the timezone in `watchlist.yaml` (`timezone:`). Scheduled runs can start a few minutes late, and GitHub pauses schedules on repositories with no activity for 60 days (the daily commit counts as activity).

To run it now: Actions tab → Daily radar → Run workflow.

## Hosting on GitHub

1. Create a repository and push this folder to `main`.
2. Settings → Secrets and variables → Actions → New repository secret: `ANTHROPIC_API_KEY`.
3. Settings → Pages → Source: **GitHub Actions**.
4. Actions tab → Daily radar → Run workflow, to publish the first edition.

The workflow commits `data/` after each run, so the repository holds the full history. Edits to `site/` or `watchlist.yaml` pushed to `main` republish the page without a new collection.

## Cost

Per run: one curate call (Sonnet, roughly 10–25k input tokens) and up to four search calls (Haiku, up to 3 searches each). Web search is billed per search (about $10 per 1,000). Expect a few US cents a day. Every run logs tokens and an estimate to `data/runs.json` and to the Actions run summary. Prices used for the estimate are in `watchlist.yaml` under `prices:`.

## Files

```
watchlist.yaml        apps, feeds, search queries, trust rules
src/collect.ts        CLI for a run
src/run.ts            the run: gather → rules → curate → checks → write
src/prompts.ts        the prompts sent to Claude
src/prefilter.ts      rule checks before the model
src/curate.ts         the model call and the checks on its answer
src/radar.ts          append-only merge into radar.json, seen events
site/                 the page (plain HTML, CSS, JS)
data/radar.json       every day, newest first
data/seen.json        events already reported
data/runs.json        per-run token use and cost
data/icons.json       cached app icons
```

## The page

Light by default, with a dark mode toggle (top right). Pixelify Sans for headlines, Geist for reading. One accent colour; each category has its own square dot (OTA blue, rail green, platform violet, consumer pink). Images arrive blocky and sharpen in a few steps; items without an image show their app icon as a pixel mosaic. Unread dots mark items collected since your previous visit (kept in your browser's localStorage) and clear when you open an item. Motion is switched off when your system asks for reduced motion.
