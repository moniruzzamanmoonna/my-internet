import { h } from '../util.js';
import { loadFeedGroup } from '../hub/feedgroup.js';
import { fetchFeed, pool } from '../api.js';
import { articleCard } from './card.js';
import { hubCard, moreList, tabBar, badge, fmtTime } from './hubui.js';

const TABS = [['news', 'AI news'], ['explained', 'Explained'], ['wisely', 'Use it wisely']];
// General tech publishers are filtered by keyword; AI-only sources are shown whole.
const AI = /\b(AI|A\.I\.|artificial intelligence|machine learning|LLMs?|chatbots?|neural networks?|generative|OpenAI|Anthropic|Gemini|ChatGPT|Claude|Copilot)\b/i;
const GENERAL = ['Ars Technica', 'MIT Technology Review', 'WIRED', 'The Verge'];

export function renderAI(ctx, root, { arg } = {}) {
  const tab = TABS.some(([id]) => id === arg) ? arg : 'news';
  root.append(
    h('h1', { class: 'page-title', text: 'AI' }),
    h('p', { class: 'lede', text: 'News straight from publishers, plain-language explanations and a few habits for using AI well. Nothing on this page is written or summarised by AI.' }),
    tabBar(TABS, tab, (id) => (id === 'news' ? '#/ai' : `#/ai/${id}`)));
  const body = h('div', {});
  root.append(body);
  return { news, explained, wisely }[tab](ctx, body);
}

function news(ctx, body) {
  const sources = ctx.catalog.sources.filter((s) => s.cat === 'ai' || GENERAL.includes(s.name));
  let data = null; let shown = 8;
  const status = h('div', { class: 'panel' });
  const list = h('div', {});
  body.append(status, list);

  function drawStatus() {
    status.replaceChildren();
    if (!data) { status.append(h('p', { class: 'hint', text: 'Loading from publishers…' }), h('div', { class: 'skeleton' })); return; }
    status.append(
      h('div', { class: 'panel-head' }, h('h2', { text: 'Latest AI news' }), h('button', { type: 'button', class: 'btn sm', onclick: load }, 'Refresh')),
      h('div', { class: 'badges' }, data.live ? badge('live', `Live: ${data.live} of ${sources.length} sources`) : '', data.cached ? badge('cached', `Cached snapshot: ${data.cached}`) : '', data.failed ? badge('bad', `Unavailable: ${data.failed}`) : ''),
      data.cached ? h('p', { class: 'hint warn-text', text: 'Some items come from an older saved snapshot and are marked “Cached”.' }) : '',
      h('p', { class: 'hint', text: 'Newest first. Articles from general tech sites are included only when they mention AI keywords, so a few off-topic or missing items are possible.' }),
      data.per && data.per.length ? h('details', {}, h('summary', { text: 'Source status' }),
        h('ul', { class: 'plain' }, data.per.map((p) => h('li', {}, `${p.src.name}: ${p.state === 'failed' ? 'unavailable' : p.state}`)))) : '');
  }
  function drawList() {
    list.replaceChildren();
    if (!data) return;
    const rows = data.items.filter((i) => i.cat === 'ai' || AI.test(`${i.title} ${i.summary}`));
    if (!rows.length) {
      list.append(h('div', { class: 'empty' }, h('h2', { text: 'Nothing to show right now' }),
        h('p', { text: 'The publisher feeds could not be reached and no saved snapshot exists yet. Nothing is invented here.' }),
        h('button', { type: 'button', class: 'btn primary', onclick: load }, 'Try again')));
      return;
    }
    rows.slice(0, shown).forEach((it) => list.append(articleCard(ctx, { ...it, badge: it.freshness === 'cached' ? `Cached ${fmtTime(it.freshAt)}` : '' })));
    if (rows.length > shown) list.append(h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn', onclick: () => { shown += 8; drawList(); } }, `Show more (${rows.length - shown} left)`)));
  }
  async function load() {
    data = null; drawStatus(); drawList();
    data = await loadFeedGroup({ key: 'mi.ainews.v1', sources, fetchFeed, pool, storage: ctx.storage });
    drawStatus(); drawList();
  }
  load();
}

function explained(ctx, body) {
  body.append(
    h('p', { class: 'hint', text: 'Short definitions written for this app. “About” loads a Wikipedia summary when you ask for it.' }),
    moreList(ctx, ctx.ai.glossary.map((g) => ({ id: g.id, type: 'article', title: g.title, by: g.bn || '', blurb: g.def, wiki: g.wiki })),
      (e) => hubCard(ctx, e, { typeLabel: 'Term' }), { initial: 6 }));
}

function wisely(ctx, body) {
  body.append(h('section', { class: 'panel' }, h('h2', { text: 'Habits for using AI well' }),
    h('ul', { class: 'plain tips' }, ctx.ai.tips.map((t) => h('li', { text: t })))));
}
