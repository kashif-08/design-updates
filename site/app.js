// Radar front end. Reads data/radar.json and draws today's paper plus the archive. No framework, no build step.

const CAT = { ota: 'OTA', rail: 'Rail', platform: 'Platform', consumer: 'Consumer' };
// ?still turns motion off, for screenshots.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('still');
if (reduced) document.documentElement.classList.add('still');
const $ = (s, el = document) => el.querySelector(s);

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : '#');
const domainOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const favicon = (domain, px = 16) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${px}`;

/** The same icon at another size: App Store artwork and Google favicons both take a size in the URL. */
function iconAt(url, px) {
  if (!url) return null;
  if (/mzstatic\.com/.test(url)) return url.replace(/\/\d+x\d+bb\.(png|jpg|webp)$/, `/${px}x${px}bb.png`);
  if (/google\.com\/s2\/favicons/.test(url)) return url.replace(/sz=\d+/, `sz=${Math.min(64, Math.max(16, px))}`);
  return url;
}
const iconFor = (item) => item.icon || favicon(domainOf(item.sources?.[0]?.url));

/* ---------- pixel art ---------- */

/** rows of characters → crisp SVG; each character maps to a fill (and optional class). Runs are merged. */
function pixels(rows, palette, cls = '') {
  const w = Math.max(...rows.map((r) => r.length));
  let out = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const ch = row[x];
      let run = 1;
      while (row[x + run] === ch) run++;
      const p = palette[ch];
      if (p) {
        const [fill, c] = Array.isArray(p) ? p : [p];
        out += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"${c ? ` class="${c}"` : ''}/>`;
      }
      x += run;
    }
  });
  return `<svg class="pixel-art ${cls}" viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${out}</svg>`;
}

function grid(n, fn) {
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => fn(x, y)).join(''));
}

function radarLogo() {
  const n = 15;
  const c = 7;
  const base = grid(n, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (Math.abs(d - 6.6) < 0.55) return 'o';
    if (Math.abs(d - 3.4) < 0.42) return 'i';
    if (x === c && y === c) return 'o';
    return '.';
  });
  let svg = pixels(base, { o: 'var(--ink)', i: 'color-mix(in srgb, var(--ink) 45%, transparent)' });
  // Twelve beams, drawn with Bresenham lines from the centre, shown one at a time by CSS.
  const beams = [];
  for (let i = 0; i < 12; i++) {
    const a = ((i * 30 - 45) * Math.PI) / 180;
    const ex = Math.round(c + 5.6 * Math.cos(a));
    const ey = Math.round(c + 5.6 * Math.sin(a));
    let x = c;
    let y = c;
    const dx = Math.abs(ex - c);
    const dy = -Math.abs(ey - c);
    const sx = c < ex ? 1 : -1;
    const sy = c < ey ? 1 : -1;
    let err = dx + dy;
    let rects = '';
    while (!(x === ex && y === ey)) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
    beams.push(`<g class="beam${i === 0 ? ' rest' : ''}" fill="var(--accent)" style="animation-delay:${(i * 0.2).toFixed(1)}s">${rects}</g>`);
  }
  const blip = '<rect class="blip" x="10" y="9" width="2" height="2" fill="var(--accent)"/>';
  return svg.replace('</svg>', `${beams.join('')}${blip}</svg>`);
}

const SUN = [
  '....a..a....',
  '.a........a.',
  '....oooo....',
  '...oooooo...',
  'a.oooooooo.a',
  '..oooooooo..',
  '..oooooooo..',
  'a.oooooooo.a',
  '...oooooo...',
  '....oooo....',
  '.a........a.',
  '....a..a....',
];
const sun = (cls) => pixels(SUN, { o: 'var(--accent)', a: 'var(--ink-3)' }, cls);

function moon(cls) {
  const rows = grid(12, (x, y) => {
    const inA = Math.hypot(x + 0.5 - 6, y + 0.5 - 6.5) <= 5;
    const inB = Math.hypot(x + 0.5 - 8.6, y + 0.5 - 4.4) <= 4.1;
    if (inA && !inB) return 'o';
    if ((x === 10 && y === 9) || (x === 9 && y === 1)) return 's';
    return '.';
  });
  return pixels(rows, { o: 'var(--ink)', s: 'var(--accent)' }, cls);
}

const CUP = [
  '................',
  '.....s...t......',
  '......s...t.....',
  '.....s...t......',
  '................',
  '..cccccccccc....',
  '..ckkkkkkkkc....',
  '..cwwwwwwwwcccc.',
  '..cwwwwwwwwc..c.',
  '..cwwwwwwwwc..c.',
  '..cwwwwwwwwcccc.',
  '..cwwwwwwwwc....',
  '...cwwwwwwc.....',
  '....cccccc......',
  '.cccccccccccccc.',
  '................',
];
const cup = () => pixels(CUP, { c: 'var(--ink)', k: '#8a5a33', w: 'var(--card)', s: ['var(--ink-3)', 'steam'], t: ['var(--ink-3)', 'steam s2'] });

const TREND = [
  '............',
  '.........aa.',
  '.........aa.',
  '.....ii..aa.',
  '.....ii..aa.',
  '.ii..ii..aa.',
  '.ii..ii..aa.',
  '.ii..ii..aa.',
  '............',
  'oooooooooooo',
];
const trend = () => pixels(TREND, { a: 'var(--accent)', i: 'var(--ink-2)', o: 'var(--ink)' });

/* ---------- dates ---------- */

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromYmd = (s) => new Date(`${s}T12:00:00`);
const fmt = (d, o) => new Intl.DateTimeFormat('en-GB', o).format(d);
const today = new Date();
const todayYmd = ymd(today);
const yesterdayYmd = ymd(new Date(today.getTime() - 86_400_000));

function dayName(date) {
  if (date === todayYmd) return 'Today';
  if (date === yesterdayYmd) return 'Yesterday';
  return fmt(fromYmd(date), { weekday: 'long' });
}

function ago(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const h = (Date.now() - t) / 3_600_000;
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return fmt(new Date(t), { day: 'numeric', month: 'short' });
}

/* ---------- read state ---------- */

// "Unread" means collected after your previous visit. The previous visit is frozen for this tab, so
// reloading does not clear the dots; opening an item does.
let prevVisit = sessionStorage.getItem('radar.prevVisit');
if (prevVisit === null) {
  prevVisit = store.get('radar.lastVisit', '') || new Date(Date.now() - 3 * 86_400_000).toISOString();
  try {
    sessionStorage.setItem('radar.prevVisit', prevVisit);
  } catch {}
}
store.set('radar.lastVisit', new Date().toISOString());
const read = new Set(store.get('radar.read', []));
const isUnread = (item) => !read.has(item.id) && item.collected_at > prevVisit;
function markRead(ids) {
  for (const id of ids) read.add(id);
  store.set('radar.read', [...read].slice(-2000));
}

/* ---------- small pieces ---------- */

function appIcon(item, big = false) {
  const src = iconAt(iconFor(item), 16);
  return `<img class="icon notch${big ? ' icon-lg' : ''}" src="${esc(src)}" alt="" width="${big ? 32 : 24}" height="${big ? 32 : 24}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`;
}

function metaRow(item, big = false) {
  return `<div class="meta">
    <span class="app">${appIcon(item, big)}${esc(item.app)}</span>
    <span class="tag" data-cat="${esc(item.category)}">${CAT[item.category] ?? esc(item.category)}</span>
    ${item.beta ? '<span class="beta">Beta</span>' : ''}
    <span class="when"><time datetime="${esc(item.published_at)}">${ago(item.published_at)}</time></span>
  </div>`;
}

function sources(item) {
  const list = item.sources ?? [];
  const icons = list.map((s) => `<img src="${esc(s.favicon || favicon(domainOf(s.url)))}" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer">`).join('');
  const links = list.map((s) => `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener" data-read="${esc(item.id)}">${esc(s.publisher || domainOf(s.url))}</a>`).join(', ');
  return `<div class="sources"><span class="stack" aria-hidden="true">${icons}</span><span>${list.length} source${list.length === 1 ? '' : 's'}</span><span aria-hidden="true">·</span><span>${links}</span></div>`;
}

function why(item) {
  return `<p class="why"><b>Why it matters</b>${esc(item.why)}</p>`;
}

/** A photo if there is one; otherwise the app icon blown up into a pixel mosaic. */
function media(item, { reveal = false, ratio } = {}) {
  const href = esc(safeUrl(item.sources?.[0]?.url));
  const style = `--c: var(--${esc(item.category)})${ratio ? `; aspect-ratio: ${ratio}` : ''}`;
  if (item.image) {
    return `<a class="frame photo" href="${href}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true" data-read="${esc(item.id)}">
      <div class="media notch${reveal && !reduced ? ' pending' : ''}" style="${style}" data-mosaic="${esc(iconAt(iconFor(item), 16))}">
        <img src="${esc(item.image)}" alt="" loading="${reveal ? 'eager' : 'lazy'}" referrerpolicy="no-referrer" decoding="async">
      </div></a>`;
  }
  return `<a class="frame" href="${href}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true" data-read="${esc(item.id)}">
    <div class="media notch mosaic" style="${style}"><img src="${esc(iconAt(iconFor(item), 16))}" alt="" loading="lazy" referrerpolicy="no-referrer"></div></a>`;
}

/* ---------- today ---------- */

function leadHtml(item) {
  return `<article class="lead rise" style="--i:0" data-id="${esc(item.id)}">
    ${media(item, { reveal: true })}
    <div class="lead-text">
      ${metaRow(item, true)}
      <h2 class="lead-headline"><a href="${esc(safeUrl(item.sources?.[0]?.url))}" target="_blank" rel="noopener" data-read="${esc(item.id)}">${esc(item.headline)}</a></h2>
      <p class="lead-what">${esc(item.what)}</p>
      ${why(item)}
      ${sources(item)}
    </div>
  </article>`;
}

function cardHtml(item, i, withMedia) {
  return `<article class="card rise" style="--i:${i}" data-id="${esc(item.id)}">
    ${withMedia ? media(item, { reveal: true }) : ''}
    ${metaRow(item)}
    <h3 class="headline"><a href="${esc(safeUrl(item.sources?.[0]?.url))}" target="_blank" rel="noopener" data-read="${esc(item.id)}">${esc(item.headline)}</a></h3>
    ${why(item)}
    <button class="more" type="button" aria-expanded="false" aria-controls="what-${esc(item.id)}">What changed</button>
    <p class="what" id="what-${esc(item.id)}" hidden>${esc(item.what)}</p>
    ${sources(item)}
  </article>`;
}

function patternHtml(text) {
  return `<aside class="pattern rise" style="--i:3">${trend()}<p><span class="label">Pattern</span>${esc(text)}</p></aside>`;
}

function quietHtml(day) {
  return `<div class="quiet rise">${cup()}<p><strong>Quiet day.</strong>Nothing worth your time${day.date === todayYmd ? ' today' : ''}. The radar checked every source and nothing met the bar, which is the point.</p></div>`;
}

function renderToday(day) {
  const el = $('#today');
  if (!day) {
    el.innerHTML = '';
    return;
  }
  if (day.quiet || !day.items.length) {
    el.innerHTML = quietHtml(day);
    return;
  }
  const [lead, ...rest] = day.items;
  // Two stories beside the lead, the rest in rows of three. Take a third beside the lead rather than leave one card alone on a row.
  const sideCount = rest.length - 2 > 1 && (rest.length - 2) % 3 === 1 ? 3 : 2;
  const side = rest.slice(0, sideCount);
  const cards = rest.slice(sideCount);
  el.classList.toggle('solo', day.items.length === 1);
  el.innerHTML = [
    leadHtml(lead),
    side.length ? `<div class="side">${side.map((it, i) => cardHtml(it, i + 1, false)).join('')}</div>` : '',
    day.pattern ? patternHtml(day.pattern) : '',
    cards.length ? `<div class="cards">${cards.map((it, i) => cardHtml(it, i + sideCount + 1, true)).join('')}</div>` : '',
  ].join('');
}

/* ---------- archive ---------- */

const filter = { cat: 'all', unread: false };

function rowHtml(item) {
  const unread = isUnread(item);
  const thumb = item.image
    ? `<span class="row-thumb notch"><img src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-mosaic="${esc(iconAt(iconFor(item), 16))}"></span>`
    : `<span class="row-thumb notch mosaic" style="--c: var(--${esc(item.category)})"><img src="${esc(iconAt(iconFor(item), 16))}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  return `<li class="row ${unread ? 'unread' : 'read'}" data-cat="${esc(item.category)}" data-id="${esc(item.id)}">
    <button class="row-btn" type="button" aria-expanded="false" aria-controls="row-${esc(item.id)}">
      <span class="dot" aria-hidden="true"></span>
      ${appIcon(item).replace('class="icon', 'class="icon row-icon')}
      <span class="row-main">
        <span class="row-top"><span class="app">${esc(item.app)}</span><span class="tag" data-cat="${esc(item.category)}"><span class="tag-label">${CAT[item.category] ?? ''}</span></span>${item.beta ? '<span class="beta">Beta</span>' : ''}<span class="when">${ago(item.published_at)}</span>${unread ? '<span class="sr-only">Unread</span>' : ''}</span>
        <span class="row-title">${esc(item.headline)}</span>
        <span class="row-sub">${esc(item.why)}</span>
      </span>
      ${thumb}
    </button>
    <div class="row-body" id="row-${esc(item.id)}" hidden>
      <p class="what">${esc(item.what)}</p>
      ${why(item)}
      ${sources(item)}
    </div>
  </li>`;
}

function dayHtml(day) {
  const d = fromYmd(day.date);
  const rail = `<div class="rail"><div class="rail-inner"><span class="rail-day">${dayName(day.date)}</span><span class="rail-date">${fmt(d, { day: 'numeric', month: 'short' })}</span></div></div>`;
  if (day.quiet || !day.items.length) {
    return `<section class="day quiet-day" data-date="${day.date}" aria-label="${fmt(d, { dateStyle: 'full' })}">${rail}<div class="rows">Quiet day. Nothing worth your time.</div></section>`;
  }
  const unread = day.items.some(isUnread);
  return `<section class="day${unread ? ' has-unread' : ''}" data-date="${day.date}" aria-label="${fmt(d, { dateStyle: 'full' })}">${rail}
    <div>
      ${day.pattern ? `<p class="day-pattern"><b>Pattern</b>${esc(day.pattern)}</p>` : ''}
      <ul class="rows">${day.items.map(rowHtml).join('')}</ul>
    </div>
  </section>`;
}

function renderFilters(days) {
  const items = days.flatMap((d) => d.items);
  const counts = Object.fromEntries(Object.keys(CAT).map((c) => [c, items.filter((i) => i.category === c).length]));
  const unread = items.filter(isUnread).length;
  $('#archive-title').innerHTML = `Earlier${unread ? `<span class="count">${unread} unread</span>` : ''}`;
  $('#filters').innerHTML = [
    `<button class="chip" type="button" data-filter="all" aria-pressed="${filter.cat === 'all'}">All <span class="n">${items.length}</span></button>`,
    ...Object.entries(CAT)
      .filter(([c]) => counts[c])
      .map(([c, label]) => `<button class="chip" type="button" data-filter="${c}" data-cat="${c}" aria-pressed="${filter.cat === c}">${label} <span class="n">${counts[c]}</span></button>`),
    unread || filter.unread ? `<button class="chip unread-chip" type="button" data-filter="unread" aria-pressed="${filter.unread}">Unread <span class="n">${unread}</span></button>` : '',
  ].join('');
}

function applyFilters() {
  let shown = 0;
  for (const day of document.querySelectorAll('#archive .day')) {
    const rows = [...day.querySelectorAll('.row')];
    let visible = 0;
    for (const r of rows) {
      const ok = (filter.cat === 'all' || r.dataset.cat === filter.cat) && (!filter.unread || r.classList.contains('unread'));
      r.hidden = !ok;
      if (ok) visible++;
    }
    const quiet = day.classList.contains('quiet-day');
    day.hidden = quiet ? filter.cat !== 'all' || filter.unread : visible === 0;
    if (!day.hidden) shown++;
  }
  let empty = $('#archive .empty');
  if (!shown && document.querySelector('#archive .day')) {
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'empty';
      $('#archive').append(empty);
    }
    empty.innerHTML = `Nothing here with these filters.<button type="button" data-filter="reset">Show everything</button>`;
  } else empty?.remove();
}

function renderArchive(days) {
  const el = $('#archive');
  if (!days.length) {
    el.innerHTML = '<p class="empty">Earlier days will collect here.</p>';
    $('#filters').innerHTML = '';
    return;
  }
  el.innerHTML = days.map(dayHtml).join('');
  renderFilters(days);
  applyFilters();
}

/* ---------- top of the page ---------- */

function greeting() {
  const h = today.getHours();
  if (h >= 4 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 23) return 'Good evening';
  return 'Still up';
}

function appList(items) {
  const apps = [...new Set(items.map((i) => i.app))];
  return apps.length > 5 ? `${apps.slice(0, 5).join(', ')} and ${apps.length - 5} more` : apps.join(', ');
}

function summaryHtml(latest) {
  if (!latest) return 'No editions yet. The first one arrives after the next daily run.';
  const n = latest.items.length;
  const changes = (k) => `<span class="count">${k}</span> change${k === 1 ? '' : 's'}`;
  if (latest.date === todayYmd) {
    return n ? `${changes(n)} today · <b>${esc(appList(latest.items))}</b>` : 'Quiet day, nothing worth your time.';
  }
  const when = latest.date === yesterdayYmd ? 'yesterday' : fmt(fromYmd(latest.date), { weekday: 'long', day: 'numeric', month: 'short' });
  const stale = latest.date < yesterdayYmd ? ' The daily run may have failed; check the Actions tab on GitHub.' : '';
  return n
    ? `No edition yet today. From ${when}: ${changes(n)} · <b>${esc(appList(latest.items))}</b>.${stale}`
    : `No edition yet today. ${when[0].toUpperCase()}${when.slice(1)} was quiet.${stale}`;
}

function typeInto(el, html) {
  if (reduced) {
    el.innerHTML = html;
    return;
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const text = tmp.textContent;
  el.setAttribute('aria-label', text);
  let i = 0;
  const tick = () => {
    i = Math.min(text.length, i + 2);
    el.textContent = text.slice(0, i);
    if (i < text.length) setTimeout(tick, 22);
    else {
      el.innerHTML = `${html}<span class="cursor" aria-hidden="true"></span>`;
      el.removeAttribute('aria-label');
    }
  };
  setTimeout(tick, 380);
}

function renderTop(radar, meta, latest) {
  const name = (meta.reader || '').trim();
  const h = today.getHours();
  const sky = h >= 5 && h < 18 ? sun('sky') : moon('sky');
  $('#greeting').innerHTML = `${sky}<span>${esc(greeting())}${name ? `, ${esc(name)}` : ''}.</span>`;
  typeInto($('#summary'), summaryHtml(latest));
  const issue = radar.days.length;
  $('#issue').innerHTML = `${issue ? `<b>No. ${issue}</b> · ` : ''}${fmt(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
  const updated = radar.updated_at && radar.days.length ? new Date(radar.updated_at) : null;
  $('#footer').innerHTML = `<span>Radar · a morning paper for one</span><span>${
    updated ? `Last run ${fmt(updated, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ` : ''
  }${meta.feeds ?? 'Several'} feeds${meta.search ? ' and web search' : ''}, filtered by ${esc(meta.ai || 'Claude')}</span>`;
}

/* ---------- motion ---------- */

function drawCover(ctx, img, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = w / h;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (ir > cr) {
    sw = sh * cr;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = sw / cr;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

/** Images arrive blocky and sharpen in a few steps, like a slow modem. */
function pixelReveal(box) {
  const img = box.querySelector('img');
  const done = () => box.classList.remove('pending');
  const run = () => {
    if (!img.naturalWidth) return done();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    box.append(canvas);
    done();
    const steps = [5, 10, 20, 40, 80];
    let i = 0;
    const tick = () => {
      if (i === steps.length) return canvas.remove();
      const w = steps[i++];
      const h = Math.max(1, Math.round((w * box.clientHeight) / Math.max(1, box.clientWidth)));
      canvas.width = w;
      canvas.height = h;
      try {
        drawCover(ctx, img, w, h);
      } catch {
        return canvas.remove();
      }
      setTimeout(tick, 85);
    };
    tick();
  };
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    if (img.complete) run();
    else img.addEventListener('load', run, { once: true });
  });
  io.observe(box);
  setTimeout(done, 3000); // never leave an image hidden
}

/** A photo that fails to load (hotlink protection, gone) turns into the app-icon mosaic. */
function mosaicOnError(img) {
  img.addEventListener(
    'error',
    () => {
      const holder = img.parentElement;
      const fallback = holder.dataset.mosaic || img.dataset.mosaic;
      holder.classList.remove('pending');
      if (!fallback || img.src === fallback) {
        img.remove();
        return;
      }
      holder.classList.add('mosaic');
      holder.closest('.frame')?.classList.remove('photo');
      img.src = fallback;
    },
    { once: true },
  );
}

function wireImages() {
  for (const img of document.querySelectorAll('.media img, .row-thumb img')) mosaicOnError(img);
  for (const box of document.querySelectorAll('.media.pending')) pixelReveal(box);
}

function wireLogo() {
  const logo = $('#logo');
  logo.innerHTML = radarLogo();
  if (reduced) return;
  logo.classList.add('sweeping');
  setTimeout(() => logo.classList.remove('sweeping'), 4800);
  const mark = $('.wordmark');
  mark.addEventListener('mouseenter', () => logo.classList.add('sweeping'));
  mark.addEventListener('mouseleave', () => logo.classList.remove('sweeping'));
}

/* ---------- theme ---------- */

function wireTheme() {
  const btn = $('#theme');
  const paint = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    btn.innerHTML = dark ? sun() : moon();
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    $('meta[name="theme-color"]').content = dark ? '#16140f' : '#f3efe6';
  };
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('radar.theme', next);
    } catch {}
    paint();
  });
  paint();
}

/* ---------- events ---------- */

function wireEvents(archiveDays) {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t) return;

    if (t.dataset.read) {
      markRead([t.dataset.read]);
      const row = document.querySelector(`.row[data-id="${CSS.escape(t.dataset.read)}"]`);
      if (row) {
        row.classList.replace('unread', 'read');
        renderFilters(archiveDays);
      }
    }

    if (t.classList.contains('more')) {
      const open = t.getAttribute('aria-expanded') !== 'true';
      t.setAttribute('aria-expanded', String(open));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !open;
    }

    if (t.classList.contains('row-btn')) {
      const row = t.closest('.row');
      const open = t.getAttribute('aria-expanded') !== 'true';
      t.setAttribute('aria-expanded', String(open));
      row.classList.toggle('open', open);
      document.getElementById(t.getAttribute('aria-controls')).hidden = !open;
      if (open && row.classList.contains('unread')) {
        markRead([row.dataset.id]);
        row.classList.replace('unread', 'read');
        const day = row.closest('.day');
        day.classList.toggle('has-unread', !!day.querySelector('.row.unread'));
        renderFilters(archiveDays);
      }
    }

    const f = t.dataset.filter;
    if (f) {
      if (f === 'unread') filter.unread = !filter.unread;
      else if (f === 'reset') Object.assign(filter, { cat: 'all', unread: false });
      else filter.cat = f;
      renderFilters(archiveDays);
      applyFilters();
    }
  });
}

/* ---------- start ---------- */

async function main() {
  wireLogo();
  wireTheme();
  let radar = { days: [] };
  let meta = {};
  try {
    const [r, m] = await Promise.all([fetch('data/radar.json', { cache: 'no-store' }), fetch('data/meta.json', { cache: 'no-store' })]);
    if (r.ok) radar = await r.json();
    if (m.ok) meta = await m.json();
  } catch {
    $('#summary').textContent = 'Could not load data/radar.json.';
    return;
  }
  const days = radar.days ?? [];
  const latest = days[0];
  // Today's paper is the newest day; the archive is everything before it.
  renderTop(radar, meta, latest);
  renderToday(latest);
  const archiveDays = days.slice(1);
  renderArchive(archiveDays);
  wireImages();
  wireEvents(archiveDays);
}

main();
