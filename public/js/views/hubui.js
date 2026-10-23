// Shared building blocks for the Home / Entertainment / Bangladesh / Learn pages.
import { h, fnv, pick } from '../util.js';
import { wikiSummary, wikiRandom } from '../api.js';

export const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
export const spotify = (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;
export const wikiPage = (title) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(title)}`;

const TYPE_LABEL = { song: 'Music', movie: 'Movie', documentary: 'Documentary', podcast: 'Podcast', video: 'Video', fact: 'Fact', word: 'Word', place: 'Place', article: 'Article', riddle: 'Riddle' };

// ---- honest status badges ----------------------------------------------------
// live = fetched just now · cached = older snapshot, NOT live · static = written by hand
export function badge(kind, text) {
  const icon = { live: '●', cached: '◐', static: '▣', bad: '!' }[kind] || '';
  return h('span', { class: `badge ${kind}`, title: { live: 'Fetched from the publisher just now', cached: 'An older snapshot saved in this browser. Not live.', static: 'Written by hand and not updated automatically', bad: 'Could not be loaded' }[kind] || '' }, `${icon} ${text}`.trim());
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---- hidden items ------------------------------------------------------------
export const hiddenKey = (id) => `hide:${id}`;
export const isHidden = (store, id) => !!store.setting(hiddenKey(id), false);
export const hiddenCount = (store) => store.settingEntries('hide:').length;

// Turns a catalog entry into the item shape the store/Saved page understand.
export function toItem(it) {
  const link = it.link || (it.q && ['song', 'video'].includes(it.type) ? yt(it.q) : wikiPage(it.wiki || it.title));
  return {
    id: `h:${it.id}`, title: it.title, link, summary: it.blurb || it.t || '', image: null, published: null,
    sname: TYPE_LABEL[it.type] || 'Pick', cat: '', kind: 'hub',
  };
}

// ---- Wikipedia summary, on demand -------------------------------------------
export function wikiBlock(page) {
  return h('div', { class: 'wiki-inline' },
    page.description ? h('p', { class: 'kicker', text: page.description }) : null,
    h('p', { class: 'extract', text: page.extract }),
    h('p', { class: 'attrib' }, 'Text from ', h('a', { href: page.url, target: '_blank', rel: 'noopener noreferrer', text: 'Wikipedia' }), ', CC BY-SA 4.0.'));
}

export function aboutButton(title) {
  const slot = h('div', { class: 'about-slot', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'act', 'aria-expanded': 'false', onclick: async () => {
    if (btn.getAttribute('aria-expanded') === 'true') { slot.replaceChildren(); btn.setAttribute('aria-expanded', 'false'); return; }
    btn.setAttribute('aria-expanded', 'true');
    slot.replaceChildren(h('p', { class: 'hint', text: 'Loading from Wikipedia…' }));
    try {
      const r = await wikiSummary(title);
      slot.replaceChildren(wikiBlock(r.page));
    } catch (e) {
      slot.replaceChildren(h('p', { class: 'hint err', text: `Couldn’t load a Wikipedia summary (${e.message || 'error'}). ` }, h('a', { href: wikiPage(title), target: '_blank', rel: 'noopener noreferrer', text: 'Search Wikipedia' })));
      btn.setAttribute('aria-expanded', 'false');
    }
  } }, h('span', { class: 'ico', 'aria-hidden': 'true', text: 'ℹ️' }), h('span', { class: 'lbl', text: 'About' }));
  return { btn, slot };
}

// ---- the item card: Save for later · Favourite · Hide -------------------------
export function hubCard(ctx, entry, { onHide, typeLabel, links = [] } = {}) {
  const { store } = ctx;
  const item = toItem(entry);
  const by = entry.by ? h('span', { class: 'by', text: entry.by }) : null;

  const save = h('button', { type: 'button', class: 'act', 'aria-pressed': 'false', onclick: () => { const on = store.toggleBookmark(item); ctx.toast(on ? 'Saved for later' : 'Removed from saved'); paint(); } },
    h('span', { class: 'ico', 'aria-hidden': 'true', text: '🔖' }), h('span', { class: 'lbl' }));
  const fav = h('button', { type: 'button', class: 'act', 'aria-pressed': 'false', onclick: () => { const on = store.toggleFavourite(item); ctx.toast(on ? 'Added to favourites' : 'Removed from favourites'); paint(); } },
    h('span', { class: 'ico', 'aria-hidden': 'true', text: '♥' }), h('span', { class: 'lbl' }));
  const hide = h('button', { type: 'button', class: 'act', title: 'Hide this item from the lists', onclick: () => {
    store.setSetting(hiddenKey(entry.id), 1);
    ctx.toast('Hidden. You can restore hidden items at the bottom of the page.');
    root.remove();
    if (onHide) onHide();
  } }, h('span', { class: 'ico', 'aria-hidden': 'true', text: '🚫' }), h('span', { class: 'lbl', text: 'Hide' }));
  const about = entry.wiki ? aboutButton(entry.wiki) : null;

  const linkEls = [
    h('a', { class: 'btn sm', href: item.link, target: '_blank', rel: 'noopener noreferrer' }, ['song', 'video'].includes(entry.type) && entry.q ? 'Find on YouTube ↗' : entry.link ? 'Open ↗' : 'Wikipedia ↗'),
    entry.q && entry.type === 'podcast' ? h('a', { class: 'btn sm', href: spotify(entry.q), target: '_blank', rel: 'noopener noreferrer' }, 'Search Spotify ↗') : null,
    entry.q && entry.type === 'podcast' ? h('a', { class: 'btn sm', href: yt(entry.q), target: '_blank', rel: 'noopener noreferrer' }, 'Search YouTube ↗') : null,
    ...links,
  ].filter(Boolean);
  // Podcasts: the primary link above is Wikipedia-or-YouTube; avoid showing YouTube twice.
  const uniq = entry.type === 'podcast' ? linkEls.slice(1) : linkEls;

  const root = h('article', { class: 'card hub', dataset: { id: entry.id } },
    h('div', { class: 'body' },
      h('div', { class: 'meta' }, h('span', { class: 'from', text: typeLabel || TYPE_LABEL[entry.type] || 'Pick' }), by),
      h('h3', { class: 'title', text: entry.title }),
      entry.blurb || entry.t ? h('p', { class: 'summary open', text: entry.blurb || entry.t }) : null,
      h('div', { class: 'row-btns tight' }, ...uniq)),
    h('div', { class: 'actions' }, save, fav, hide, about && about.btn),
    about && about.slot);

  function paint() {
    const s = store.isBookmarked(item.id);
    const f = store.isFavourite(item.id);
    save.setAttribute('aria-pressed', String(s)); save.querySelector('.lbl').textContent = s ? 'Saved' : 'Save for later';
    fav.setAttribute('aria-pressed', String(f)); fav.querySelector('.lbl').textContent = f ? 'Favourite' : 'Favourite';
  }
  paint();
  return root;
}

// ---- "Show more" list: small curated selection, never infinite ---------------
export function moreList(ctx, entries, render, { initial = 6, step = 6, empty = 'Nothing here yet.' } = {}) {
  const wrap = h('div', { class: 'more-list' });
  let shown = initial;
  function draw() {
    wrap.replaceChildren();
    const live = entries.filter((e) => !isHidden(ctx.store, e.id));
    if (!live.length) { wrap.append(h('p', { class: 'hint', text: empty })); return; }
    live.slice(0, shown).forEach((e) => wrap.append(render(e, draw)));
    if (live.length > shown) {
      wrap.append(h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn', onclick: () => { shown += step; draw(); } }, `Show more (${live.length - shown} left)`)));
    }
    const hidden = entries.length - live.length;
    if (hidden) {
      wrap.append(h('p', { class: 'hint' }, `${hidden} hidden here. `, h('button', { type: 'button', class: 'link', onclick: () => { entries.forEach((e) => ctx.store.removeSetting(hiddenKey(e.id))); draw(); } }, 'Restore')));
    }
  }
  draw();
  return wrap;
}

export function tabBar(tabs, current, hrefFor) {
  return h('div', { class: 'chips', role: 'tablist' }, tabs.map(([id, label]) =>
    h('a', { class: 'chip', role: 'tab', href: hrefFor(id), 'aria-selected': String(current === id), text: label })));
}

// ---- "I'm bored": one random pick, never ranked, never repeated back-to-back --
let lastBored = null;
export function pickBored(ctx, { fun, rnd = Math.random }) {
  const pool = [
    ...fun.items.map((e) => ({ kind: 'item', e })),
    ...fun.facts.map((e) => ({ kind: 'fact', e })),
    ...fun.riddles.map((e) => ({ kind: 'riddle', e })),
    { kind: 'wiki' },
  ].filter((p) => p.kind === 'wiki' || !isHidden(ctx.store, p.e.id));
  let choice = pick(pool, rnd);
  if (pool.length > 1 && lastBored === (choice.e && choice.e.id)) choice = pick(pool, rnd);
  lastBored = choice.e && choice.e.id;
  return choice;
}

export async function renderBored(ctx, container, fun) {
  container.replaceChildren(h('div', { class: 'skeleton' }));
  const again = h('button', { type: 'button', class: 'btn primary', onclick: () => renderBored(ctx, container, fun) }, 'Something else');
  const choice = pickBored(ctx, { fun });
  try {
    if (choice.kind === 'item') {
      container.replaceChildren(h('p', { class: 'eyebrow', text: 'Try this' }), hubCard(ctx, choice.e), h('div', { class: 'row-btns' }, again));
    } else if (choice.kind === 'fact') {
      container.replaceChildren(h('p', { class: 'eyebrow', text: 'Did you know?' }), hubCard(ctx, { ...choice.e, type: 'fact', title: 'Fact', blurb: choice.e.t }), h('div', { class: 'row-btns' }, again));
    } else if (choice.kind === 'riddle') {
      container.replaceChildren(h('p', { class: 'eyebrow', text: 'A riddle' }), riddleCard(choice.e), h('div', { class: 'row-btns' }, again));
    } else {
      const r = await wikiRandom();
      container.replaceChildren(h('p', { class: 'eyebrow', text: 'Random Wikipedia article' }), wikiCard(ctx, r.page), h('div', { class: 'row-btns' }, again));
    }
  } catch (e) {
    container.replaceChildren(h('p', { class: 'hint err', text: `Couldn’t load that one (${e.message || 'error'}).` }), h('div', { class: 'row-btns' }, again));
  }
}

export function riddleCard(r) {
  const ans = h('p', { class: 'answer', hidden: true, text: r.a });
  const btn = h('button', { type: 'button', class: 'btn sm', 'aria-expanded': 'false', onclick: () => { ans.hidden = !ans.hidden; btn.setAttribute('aria-expanded', String(!ans.hidden)); btn.textContent = ans.hidden ? 'Show answer' : 'Hide answer'; } }, 'Show answer');
  return h('article', { class: 'card hub riddle', lang: r.lang === 'bn' ? 'bn' : 'en' }, h('div', { class: 'body' }, h('p', { class: 'riddle-q', text: r.q }), btn, ans));
}

export function wikiCard(ctx, page) {
  const item = { id: `h:w${fnv(page.url || page.title)}`, title: page.title, link: page.url, summary: page.extract || page.description || '', image: page.image, published: null, sname: 'Wikipedia', cat: '', kind: 'hub' };
  const save = h('button', { type: 'button', class: 'act', 'aria-pressed': String(ctx.store.isBookmarked(item.id)), onclick: () => { const on = ctx.store.toggleBookmark(item); save.setAttribute('aria-pressed', String(on)); save.querySelector('.lbl').textContent = on ? 'Saved' : 'Save for later'; ctx.toast(on ? 'Saved for later' : 'Removed'); } },
    h('span', { class: 'ico', 'aria-hidden': 'true', text: '🔖' }), h('span', { class: 'lbl', text: ctx.store.isBookmarked(item.id) ? 'Saved' : 'Save for later' }));
  const fav = h('button', { type: 'button', class: 'act', 'aria-pressed': String(ctx.store.isFavourite(item.id)), onclick: () => { const on = ctx.store.toggleFavourite(item); fav.setAttribute('aria-pressed', String(on)); ctx.toast(on ? 'Added to favourites' : 'Removed'); } },
    h('span', { class: 'ico', 'aria-hidden': 'true', text: '♥' }), h('span', { class: 'lbl', text: 'Favourite' }));
  return h('article', { class: 'card hub' },
    h('div', { class: 'body' },
      h('div', { class: 'meta' }, h('span', { class: 'from', text: 'Wikipedia' })),
      h('h3', { class: 'title' }, h('a', { href: page.url, target: '_blank', rel: 'noopener noreferrer', text: page.title })),
      wikiBlock(page)),
    page.image ? h('img', { class: 'thumb', src: page.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('div', { class: 'actions' }, save, fav));
}
