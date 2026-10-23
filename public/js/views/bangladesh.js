import { h, timeAgo, hostOf } from '../util.js';
import { fetchFeed, pool, wikiSummary } from '../api.js';
import { loadFeedGroup } from '../hub/feedgroup.js';
import { BD_CATEGORIES, inCategory } from '../hub/classify.js';
import { articleCard } from './card.js';
import { hubCard, moreList, tabBar, badge, fmtTime, wikiBlock, wikiPage } from './hubui.js';

const TABS = [['news', 'News'], ['explore', 'Explore'], ['history', 'History & culture'], ['services', 'Services & emergency']];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function renderBangladesh(ctx, root, { arg } = {}) {
  const tab = TABS.some(([id]) => id === arg) ? arg : 'news';
  root.append(
    h('h1', { class: 'page-title', text: 'Bangladesh' }),
    tabBar(TABS, tab, (id) => (id === 'news' ? '#/bangladesh' : `#/bangladesh/${id}`)));
  const body = h('div', {});
  root.append(body);
  if (tab === 'news') return news(ctx, body);
  if (tab === 'explore') return explore(ctx, body);
  if (tab === 'history') return history(ctx, body);
  return services(ctx, body);
}

// ======================= NEWS =======================
function news(ctx, body) {
  const { bd, catalog } = ctx;
  const sources = catalog.sources.filter((s) => s.cat === 'bangladesh');
  const placeNames = bd.divisions.flatMap((d) => [d.name, ...d.districts]);
  let data = null;
  let cat = 'all';
  let place = '';
  let shown = 10;

  const status = h('div', { class: 'panel' });
  const chips = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'News category' });
  const localPick = h('div', { class: 'inline-form', hidden: true });
  const list = h('div', {});
  const links = h('div', {});
  body.append(status, chips, localPick, list, links);

  function drawStatus() {
    status.replaceChildren();
    if (!data) { status.append(h('p', { class: 'hint', text: 'Loading Bangladesh news from official publisher feeds…' }), h('div', { class: 'skeleton' })); return; }
    const parts = [];
    if (data.live) parts.push(badge('live', `Live: ${data.live} of ${sources.length} sources`));
    if (data.cached) parts.push(badge('cached', `Cached snapshot: ${data.cached}`));
    if (data.failed) parts.push(badge('bad', `Unavailable: ${data.failed}`));
    status.append(
      h('div', { class: 'panel-head' }, h('h2', { text: 'Latest from Bangladeshi publishers' }), h('button', { type: 'button', class: 'btn sm', onclick: () => load() }, 'Refresh')),
      h('div', { class: 'badges' }, ...parts),
      data.cached ? h('p', { class: 'hint warn-text', text: 'Some articles below come from an older snapshot saved in this browser because the live feed could not be reached. They are marked “Cached” and may be out of date.' }) : '',
      h('details', { class: 'src-status' }, h('summary', { text: 'Source status' }),
        h('ul', {}, data.per.map((p) => h('li', {}, h('strong', { text: p.src.name }), ' — ',
          p.state === 'live' ? `live, ${p.count} items (${fmtTime(p.at)})` : p.state === 'cached' ? `cached snapshot from ${fmtTime(p.at)} (${p.error})` : `unavailable (${p.error})`)))),
      h('p', { class: 'hint', text: 'Articles link to the original publisher. Categories are matched by keywords in titles and summaries, so they can be imperfect; “National” means “did not match a more specific topic”. Add more sources under Sources.' }));
  }

  function drawChips() {
    chips.replaceChildren(...[{ id: 'all', name: 'All' }, ...BD_CATEGORIES].map((c) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(cat === c.id), onclick: () => { cat = c.id; shown = 10; drawChips(); drawList(); } }, c.name)));
    localPick.hidden = cat !== 'local';
    if (cat === 'local') {
      const divSel = h('select', { 'aria-label': 'Division' }, h('option', { value: '', text: 'Choose a division…' }), ...bd.divisions.map((d) => h('option', { value: d.name, text: d.name })));
      const distSel = h('select', { 'aria-label': 'District' }, h('option', { value: '', text: 'or a district…' }), ...bd.divisions.flatMap((d) => d.districts.map((x) => h('option', { value: x, text: `${x} (${d.name})` }))));
      divSel.value = placeNames.includes(place) && bd.divisions.some((d) => d.name === place) ? place : '';
      distSel.value = bd.divisions.some((d) => d.districts.includes(place)) ? place : '';
      divSel.addEventListener('change', () => { place = divSel.value; distSel.value = ''; shown = 10; drawList(); });
      distSel.addEventListener('change', () => { place = distSel.value; divSel.value = ''; shown = 10; drawList(); });
      localPick.replaceChildren(divSel, distSel);
    }
  }

  function drawList() {
    list.replaceChildren();
    links.replaceChildren();
    if (!data) return;
    if (!data.items.length) {
      list.append(h('div', { class: 'empty' }, h('h2', { text: 'No news available right now' }), h('p', { text: 'None of the publisher feeds could be reached and there is no saved snapshot yet, so nothing is shown rather than anything out of date.' }), h('button', { type: 'button', class: 'btn primary', onclick: () => load() }, 'Try again')));
      return;
    }
    if (cat === 'local' && !place) { list.append(h('p', { class: 'hint', text: 'Choose a division or district to see articles that mention it. Matching is by name in the title or summary.' })); return; }
    const rows = data.items.filter((i) => inCategory(i, cat === 'all' ? 'all' : cat, { place }));
    if (!rows.length) list.append(h('p', { class: 'hint', text: 'No articles match this category in the latest feeds.' }));
    rows.slice(0, shown).forEach((it) => list.append(articleCard(ctx, { ...it, cat: 'bangladesh', badge: it.freshness === 'cached' ? `Cached ${timeAgo(new Date(it.freshAt).toISOString())}` : '' })));
    if (rows.length > shown) list.append(h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn', onclick: () => { shown += 10; drawList(); } }, `Show more (${rows.length - shown} left)`)));
    const names = bd.newsLinks[cat];
    if (names) {
      const picks = bd.services.filter((s) => names.includes(s.name));
      links.append(h('section', { class: 'panel' }, h('h2', { text: `Official sites for ${cat}` }),
        h('p', { class: 'hint', text: 'These open the official websites: check them directly for circulars and notices.' }),
        h('ul', { class: 'plain' }, picks.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name }), ` — ${s.desc}`)))));
    }
  }

  async function load() {
    data = null; drawStatus(); drawList();
    data = await loadFeedGroup({ key: 'mi.bdnews.v1', sources, fetchFeed, pool, storage: ctx.storage });
    drawStatus(); drawList();
  }
  drawChips();
  load();
}

// ======================= EXPLORE =======================
function explore(ctx, body) {
  const { bd } = ctx;
  const panel = h('section', { class: 'panel', hidden: true, 'aria-live': 'polite' });
  async function showPlace(title, label) {
    panel.hidden = false;
    panel.replaceChildren(h('h2', { text: label }), h('p', { class: 'hint', text: 'Loading from Wikipedia…' }));
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    try {
      const r = await wikiSummary(title);
      panel.replaceChildren(h('h2', { text: r.page.title }), wikiBlock(r.page), h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { panel.hidden = true; } }, 'Close')));
    } catch (e) {
      panel.replaceChildren(h('h2', { text: label }), h('p', { class: 'hint err', text: `No Wikipedia summary found for “${title}” (${e.message || 'error'}). ` }, h('a', { href: wikiPage(title), target: '_blank', rel: 'noopener noreferrer', text: 'Search Wikipedia' })));
    }
  }

  body.append(panel,
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: '8 divisions · 64 districts' }), badge('static', 'Reference list')),
      h('p', { class: 'hint', text: 'Tap a name to read a summary from Wikipedia.' }),
      ...bd.divisions.map((d) => h('details', { class: 'cat-group' },
        h('summary', {}, `${d.name} · `, h('span', { lang: 'bn', text: d.bn }), ` (${d.districts.length})`),
        h('div', { class: 'chips wrap' },
          h('button', { type: 'button', class: 'chip strong', onclick: () => showPlace(d.wiki, `${d.name} Division`) }, `${d.name} Division`),
          ...d.districts.map((x) => h('button', { type: 'button', class: 'chip', onclick: () => showPlace(`${x} District`, `${x} District`) }, x)))))),
    h('section', {},
      h('div', { class: 'panel-head' }, h('h2', { text: 'Places to visit' }), badge('static', 'Curated list')),
      moreList(ctx, bd.destinations.map((d) => ({ id: `dest-${slug(d.name)}`, type: 'place', title: d.name, by: d.division, blurb: d.blurb, wiki: d.wiki })), (e) => hubCard(ctx, e, { typeLabel: 'Place' }))));
}

// ======================= HISTORY & CULTURE =======================
function history(ctx, body) {
  const { bd } = ctx;
  body.append(
    h('section', {},
      h('div', { class: 'panel-head' }, h('h2', { text: 'History' }), badge('static', 'Curated')),
      moreList(ctx, bd.history.map((x, i) => ({ id: `hist-${i}`, type: 'article', title: `${x.era}: ${x.title}`, blurb: x.text, wiki: x.wiki })), (e) => hubCard(ctx, e, { typeLabel: 'History' }), { initial: 5 })),
    h('section', {},
      h('div', { class: 'panel-head' }, h('h2', { text: 'Culture' }), badge('static', 'Curated')),
      moreList(ctx, bd.culture.map((x, i) => ({ id: `cult-${i}`, type: 'article', title: x.title, blurb: x.text, wiki: x.wiki })), (e) => hubCard(ctx, e, { typeLabel: 'Culture' }), { initial: 5 })),
    h('p', { class: 'hint', text: 'For recent events, see the News tab: this section covers settled history only.' }));
}

// ======================= SERVICES & EMERGENCY =======================
function services(ctx, body) {
  const { bd } = ctx;
  const groups = [...new Set(bd.services.map((s) => s.group))];
  body.append(
    h('section', { class: 'panel emergency' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Emergency & helpline numbers' }), badge('static', 'Checked 22 Oct 2026')),
      h('p', { class: 'hint warn-text', text: 'These numbers come from published lists dated 2020–2022 (named below). Numbers can change: confirm on the official website or in your phone’s emergency settings before relying on them.' }),
      h('ul', { class: 'emergency-list' }, bd.emergency.map((e) => h('li', {},
        h('a', { class: 'num', href: `tel:${e.number}`, 'aria-label': `Call ${e.number}`, text: e.number }),
        h('span', { class: 'what' }, h('strong', { text: e.name }), h('small', { text: ` Source: ${e.source}` })))))),
    ...groups.map((g) => h('section', { class: 'panel' },
      h('h2', { text: g }),
      h('ul', { class: 'plain' }, bd.services.filter((s) => s.group === g).map((s) => h('li', {},
        h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name }), h('span', { class: 'host', text: ` ${hostOf(s.url)}` }), ` — ${s.desc}`))))),
    h('p', { class: 'hint', text: 'Links open official websites. This app does not collect or submit anything for you. If a site does not load, search for the organisation’s name.' }));
}
