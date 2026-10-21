import { h, pick, fnv, hostOf, sourceId } from '../util.js';
import { articleCard } from './card.js';
import { wikiSearch } from '../api.js';
import * as D from '../discover.js';

const SEEN_KEY = 'mi.seen.v1';

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function remember(kind, key) {
  try {
    const seen = loadSeen();
    const list = new Set(seen[kind] || []);
    list.add(key);
    seen[kind] = [...list].slice(-400);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* storage blocked: discovery still works, just may repeat */ }
}

export function renderDiscover(ctx, root) {
  const { store, catalog, countries } = ctx;
  const result = h('section', { class: 'result', 'aria-live': 'polite' });
  let busy = false;

  const usual = () => D.usualCategories(D.interestWeights(store, ctx.allCategories().map((c) => c.id)));

  function wikiItem(page, extra = {}) {
    return { id: 'd' + fnv(page.url || page.title), title: page.title, link: page.url, summary: page.extract || page.description || '', image: page.image, published: null, sname: page.project === 'wikivoyage' ? 'Wikivoyage' : 'Wikipedia', cat: '', kind: 'discovery', ...extra };
  }

  function bookmarkButton(item) {
    const btn = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(store.isBookmarked(item.id)), onclick: () => {
      const on = store.toggleBookmark(item);
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '🔖 Saved' : '🔖 Save';
      ctx.toast(on ? 'Saved to bookmarks' : 'Bookmark removed');
    } }, store.isBookmarked(item.id) ? '🔖 Saved' : '🔖 Save');
    return btn;
  }

  function attribution(page) {
    return h('p', { class: 'attrib' }, 'Text from ', h('a', { href: page.url, target: '_blank', rel: 'noopener noreferrer', text: page.project === 'wikivoyage' ? 'Wikivoyage' : 'Wikipedia' }), ', available under CC BY-SA 4.0.');
  }

  function pageBlock(page) {
    return h('div', { class: 'wiki' },
      page.image ? h('img', { class: 'wiki-img', src: page.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      page.description ? h('p', { class: 'kicker', text: page.description }) : null,
      h('p', { class: 'extract', text: page.extract }),
      attribution(page));
  }

  function actions(...btns) { return h('div', { class: 'row-btns' }, ...btns.filter(Boolean)); }

  function searchFeedBtn(term) {
    return h('button', { type: 'button', class: 'btn', onclick: () => ctx.searchFor(term) }, `Search my feed for “${term}”`);
  }

  function renderResult(res, again) {
    const againBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => again() }, 'Another one');
    result.replaceChildren();
    if (res.kind === 'country') {
      const { country, page, travel } = res;
      const item = wikiItem(page, { title: country.name });
      result.append(h('article', { class: 'discovery' },
        h('p', { class: 'eyebrow', text: 'Random country' }),
        h('h2', {}, h('span', { class: 'flag', 'aria-hidden': 'true', text: res.flag }), ` ${country.name}`),
        h('p', { class: 'facts' }, h('span', { class: 'pill', text: country.region }), country.capital ? h('span', { class: 'pill', text: `Capital: ${country.capital}` }) : null),
        pageBlock(page),
        travel ? h('div', { class: 'sub' }, h('h3', { text: 'For travellers' }), h('p', { text: travel.extract }), attribution(travel)) : null,
        actions(againBtn, bookmarkButton(item), searchFeedBtn(country.name))));
    } else if (res.kind === 'topic' || res.kind === 'wiki') {
      const { page } = res;
      const item = wikiItem(page);
      result.append(h('article', { class: 'discovery' },
        h('p', { class: 'eyebrow', text: res.kind === 'topic' ? 'Unknown topic' : 'Random Wikipedia article' }),
        h('h2', { text: page.title }),
        pageBlock(page),
        res.related && res.related.length ? h('div', { class: 'sub' }, h('h3', { text: 'Go deeper' }),
          h('ul', { class: 'related' }, res.related.map((r) => h('li', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title }), h('span', { text: ` — ${r.snippet}` }))))) : null,
        actions(againBtn, bookmarkButton(item), searchFeedBtn(page.title))));
    } else if (res.kind === 'article') {
      const { source, item } = res;
      const id = sourceId(source.url);
      const followed = !!(store.getSource(id) && store.getSource(id).on);
      result.append(h('article', { class: 'discovery' },
        h('p', { class: 'eyebrow', text: 'From a source you don’t follow' }),
        articleCard(ctx, item),
        actions(againBtn, followed ? null : h('button', { type: 'button', class: 'btn', onclick: (e) => {
          store.upsertSource(id, { url: source.url, name: source.name, cat: source.cat, on: 1, kind: 'catalog' });
          ctx.feeds.refresh({ only: [id] }); e.target.disabled = true; e.target.textContent = 'Following ✓';
          ctx.toast(`Now following ${source.name}`);
        } }, `Follow ${source.name}`))));
    } else if (res.kind === 'site') {
      const { site } = res;
      const fid = site.feed ? sourceId(site.feed) : null;
      result.append(h('article', { class: 'discovery' },
        h('p', { class: 'eyebrow', text: 'Interesting website' }),
        h('h2', { text: site.name }),
        h('p', { class: 'kicker', text: hostOf(site.url) }),
        h('p', { class: 'extract', text: site.blurb }),
        actions(againBtn, h('a', { class: 'btn', href: site.url, target: '_blank', rel: 'noopener noreferrer' }, 'Visit site ↗'),
          site.feed && !(store.getSource(fid) && store.getSource(fid).on) ? h('button', { type: 'button', class: 'btn', onclick: (e) => {
            store.upsertSource(fid, { url: site.feed, name: site.name, cat: site.cat, on: 1, kind: 'custom' });
            ctx.feeds.refresh({ only: [fid] }); e.target.disabled = true; e.target.textContent = 'Following ✓';
            ctx.toast(`Now following ${site.name}`);
          } }, 'Follow its feed') : null)));
    }
    result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function run(fn, again) {
    if (busy) return;
    busy = true;
    root.classList.add('busy');
    result.replaceChildren(h('div', { class: 'skeleton tall', 'aria-label': 'Loading' }));
    try {
      const res = await fn();
      if (!res) throw new Error('Nothing came back this time. Try again.');
      renderResult(res, again);
    } catch (e) {
      result.replaceChildren(h('div', { class: 'empty' }, h('h2', { text: 'Couldn’t fetch that' }), h('p', { text: e.message || 'Something went wrong.' }),
        h('button', { type: 'button', class: 'btn primary', onclick: () => again() }, 'Try again')));
    } finally { busy = false; root.classList.remove('busy'); }
  }

  // Each kind accepts the "again" handler: a single-kind button repeats that kind,
  // while Surprise me passes itself so "Another one" is another surprise.
  const randomCountry = (again = randomCountry) => run(async () => {
    const seen = new Set(loadSeen().country || []);
    const c = D.pickCountry(countries, seen);
    const res = await D.exploreCountry(c);
    remember('country', c.code);
    return res;
  }, again);

  const unknownTopic = (again = unknownTopic) => run(async () => {
    const seen = new Set(loadSeen().topic || []);
    const t = D.pickOutside(catalog.topics, usual(), seen, (x) => x.t);
    const res = await D.exploreTopic(t);
    remember('topic', t.t);
    return res;
  }, again);

  const randomWiki = (again = randomWiki) => run(() => D.exploreRandomWikipedia(), again);

  const unfollowedArticle = (again = unfollowedArticle) => run(() => D.exploreUnfollowedArticle({ catalog, store, usual: usual() }), again);

  const randomSite = (again = randomSite) => run(async () => {
    const seen = new Set(loadSeen().site || []);
    const res = D.exploreWebsite({ catalog, store, usual: usual(), seen });
    remember('site', res.site.url);
    return res;
  }, again);

  const kinds = [randomCountry, unknownTopic, randomWiki, unfollowedArticle, randomSite];
  const surprise = () => pick(kinds)(surprise);

  // ---- topic search box ----
  const q = h('input', { type: 'search', placeholder: 'Or look up any topic on Wikipedia…', 'aria-label': 'Look up a topic on Wikipedia', maxlength: '120' });
  const hits = h('ul', { class: 'related hits' });
  const lookup = h('form', { class: 'lookup', onsubmit: async (e) => {
    e.preventDefault();
    const term = q.value.trim();
    if (!term) return;
    hits.replaceChildren(h('li', { text: 'Searching…' }));
    try {
      const r = await wikiSearch(term);
      hits.replaceChildren(...(r.results.length ? r.results.map((x) => h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => { hits.replaceChildren(); const go = () => run(() => D.exploreTopic({ t: x.title }), go); go(); } }, x.title), h('span', { text: ` — ${x.snippet}` }))) : [h('li', { text: 'No results.' })]));
    } catch (err) { hits.replaceChildren(h('li', { class: 'err', text: err.message })); }
  } }, q, h('button', { type: 'submit', class: 'btn', text: 'Look up' }), hits);

  const tile = (emoji, title, text, fn) => h('button', { type: 'button', class: 'tile', onclick: () => fn() },
    h('span', { class: 'tile-ico', 'aria-hidden': 'true', text: emoji }), h('span', { class: 'tile-title', text: title }), h('span', { class: 'tile-text', text }));

  root.append(
    h('h1', { class: 'page-title', text: 'Discover' }),
    h('p', { class: 'lede', text: 'Step outside your usual reading. Everything here is chosen at random — nothing is ranked, tracked or tuned to keep you scrolling.' }),
    h('button', { type: 'button', class: 'btn primary big surprise', onclick: () => surprise() }, '✨ Surprise me'),
    h('div', { class: 'tiles' },
      tile('🌍', 'Random country', 'Meet a country at random, with a travel note.', randomCountry),
      tile('🧭', 'Explore an unknown topic', 'A subject far from what you usually read.', unknownTopic),
      tile('📰', 'Unfamiliar publication', 'One article from a source you don’t follow.', unfollowedArticle),
      tile('🕸️', 'Interesting website', 'A corner of the web worth a visit.', randomSite)),
    lookup, result);

  ctx.runSurprise = () => surprise();
  return () => { ctx.runSurprise = null; };
}
