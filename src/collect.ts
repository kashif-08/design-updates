// npm run collect [-- --dry-run] [--no-search] [--verbose] [--manual] [--gather-only] [--backfill N]
// Prints what was kept and what was dropped, with the reason for each.

import { appendFileSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { AnswerPendingError, apiLlm, LlmUnavailableError, manualLlm, type Llm } from './llm.ts';
import { collect, defaultPaths, SourcesDownError, type Report } from './run.ts';
import type { Dropped } from './types.ts';
import { ago, localDate, parseDate, readJson, truncate } from './util.ts';
import type { Radar } from './types.ts';

const argv = process.argv.slice(2);
const backfillAt = argv.indexOf('--backfill');
const backfill = backfillAt >= 0 ? Number(argv.splice(backfillAt, 2)[1]) : 0;
if (backfillAt >= 0 && !(backfill >= 1 && backfill <= 14)) {
  console.error('--backfill needs a number of days from 1 to 14.');
  process.exit(2);
}
const args = new Set(argv);
const flag = (name: string) => args.has(`--${name}`);
for (const a of args) {
  if (!['--dry-run', '--no-search', '--verbose', '--manual', '--gather-only', '--help'].includes(a)) {
    console.error(`Unknown option ${a}. Try --help.`);
    process.exit(2);
  }
}
if (flag('help')) {
  console.log(`npm run collect -- [options]
  --dry-run       read feeds and apply the rules, but call no model and write nothing
  --no-search     skip the web-search step (feeds only)
  --manual        answer the model step by hand instead of using the API (no key needed)
  --gather-only   read feeds and pages and save them to .cache for a later --manual run
  --backfill N    also fill the N-1 days before today, oldest first (feeds only for past days)
  --verbose       list every dropped item, including the hundreds of old and off-topic ones`);
  process.exit(0);
}

function pickLlm(): Llm | null {
  if (flag('manual') || process.env.RADAR_LLM === 'manual') return manualLlm('.cache/llm');
  if (process.env.ANTHROPIC_API_KEY) return apiLlm(process.env.ANTHROPIC_API_KEY);
  return null;
}

const lines: string[] = [];
const out = (s = '') => {
  lines.push(s);
  console.log(s);
};

function printDropped(title: string, list: Dropped[], verbose: boolean) {
  if (!list.length) return;
  out(`\n${title} (${list.length})`);
  const bulk = list.filter((d) => d.bulk);
  const each = verbose ? list : list.filter((d) => !d.bulk);
  for (const d of each) out(`  - ${truncate(d.title, 90)}  [${d.source}]\n      ${d.reason}`);
  if (!verbose && bulk.length) {
    const counts = new Map<string, number>();
    for (const d of bulk) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
    for (const [reason, n] of [...counts].sort((a, b) => b[1] - a[1])) out(`  - ${n} × ${reason}  (--verbose to list them)`);
  }
}

function print(r: Report, now: Date, verbose: boolean) {
  out(`App Change Radar · ${r.date} · ${r.mode}`);
  out(`\nSources`);
  out(`  feeds: ${r.feeds.ok} ok, ${r.feeds.failed.length} failed, ${r.feeds.entries} entries`);
  for (const f of r.feeds.failed) out(`    ! ${f.name}: ${f.error}`);
  if (!r.search.ran) out(`  search: skipped (${r.search.skippedReason})`);
  for (const g of r.search.groups) out(`  search ${g.group}: ${g.ok ? `${g.found} results` : `failed: ${g.error}`}`);
  out(`  ${r.candidates} candidates → ${r.sentToModel.length} passed the rules`);

  if (r.mode === 'dry run' || r.mode === 'gather only') {
    out(`\nWould go to the model (${r.sentToModel.length})`);
    for (const c of r.sentToModel) {
      const d = parseDate(c.publishedAt);
      out(`  ${c.cid.padEnd(4)} ${(c.app ?? '?').padEnd(14)} ${truncate(c.title, 80)}  [${c.source}, ${d ? ago(d, now) : '?'}]`);
    }
  } else {
    out(`\nKept (${r.kept.length})`);
    if (!r.kept.length) out('  nothing');
    for (const i of r.kept) {
      const isNew = r.added.some((a) => a.id === i.id);
      out(`  + ${i.app}: ${i.headline}${i.beta ? ' [beta]' : ''}${isNew ? '' : '  (already on today’s page)'}`);
      out(`      ${i.sources.map((s) => s.publisher).join(' · ')}  importance ${i.importance}`);
    }
    if (r.pattern) out(`\nPattern: ${r.pattern}`);
    printDropped('Dropped by the model', r.modelDropped, true);
  }
  printDropped('Dropped by the rules', r.preDropped, verbose);
  for (const w of r.warnings) out(`\n  ! ${w}`);

  if (r.wrote) {
    out(
      `\nResult: ${
        r.dayExisted
          ? r.added.length
            ? `added ${r.added.length} to today’s entry`
            : 'nothing new since the earlier run today; radar.json unchanged'
          : r.quiet
            ? 'quiet day recorded'
            : `new day with ${r.added.length} item${r.added.length === 1 ? '' : 's'}`
      }`,
    );
  }
  if (r.usage.length) {
    out('\nUsage');
    for (const u of r.usage) out(`  ${u.step.padEnd(16)} ${u.model.padEnd(20)} in ${u.input_tokens}  out ${u.output_tokens}${u.web_searches ? `  searches ${u.web_searches}` : ''}`);
    out(`  estimated cost: $${r.costUsd.toFixed(4)}`);
  }
}

/** Backfill reads the same feeds for every day; fetch each URL once. */
function memoFetch(): typeof fetch {
  const cache = new Map<string, Promise<{ status: number; body: string; type: string }>>();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!cache.has(url)) {
      cache.set(
        url,
        fetch(url, init).then(async (r) => ({ status: r.status, body: await r.text(), type: r.headers.get('content-type') ?? '' })),
      );
    }
    const hit = await cache.get(url)!;
    return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.type } });
  }) as typeof fetch;
}

const cfg = loadConfig();
const now = process.env.RADAR_NOW ? new Date(process.env.RADAR_NOW) : new Date();
const noModel = flag('dry-run') || flag('gather-only');
const llm = noModel ? null : pickLlm();
if (!noModel && !llm) {
  console.error(`No model available. Either:
  - put ANTHROPIC_API_KEY in .env (see .env.example), or
  - run with --manual to answer the model step by hand, or
  - run with --dry-run to see what the rules keep without a model.`);
  process.exit(2);
}

try {
  const paths = defaultPaths();
  const fetchImpl = backfill ? memoFetch() : fetch;
  for (let back = Math.max(backfill - 1, 0); back >= 0; back--) {
    const at = new Date(now.getTime() - back * 86_400_000);
    const date = localDate(at, cfg.timezone);
    const latest = readJson<Radar>(paths.radar, { version: 1, updated_at: '', days: [] }).days[0]?.date;
    if (back > 0 && latest && date <= latest && !noModel) {
      out(`${date}: already in radar.json, skipped\n`);
      continue;
    }
    const report = await collect({
      cfg,
      now: at,
      llm,
      fetchImpl,
      paths,
      dryRun: flag('dry-run'),
      gatherOnly: flag('gather-only'),
      // Searching "the last 48 hours" only makes sense for today.
      noSearch: flag('no-search') || back > 0,
    });
    print(report, at, flag('verbose'));
    if (back > 0) out('\n' + '─'.repeat(60) + '\n');
  }
} catch (err) {
  if (err instanceof AnswerPendingError) {
    console.log(`\nManual mode: the model question is saved at\n  ${err.requestPath}\nWrite the JSON answer to the "answer_to" path in that file, then run the same command again.`);
    process.exit(3);
  }
  const msg = err instanceof SourcesDownError || err instanceof LlmUnavailableError ? err.message : (err as Error).stack;
  console.error(`\nRun failed: ${msg}`);
  process.exit(1);
} finally {
  if (process.env.GITHUB_STEP_SUMMARY && lines.length) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
}
