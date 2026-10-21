// Discovery logic. Content comes from permitted sources only:
//  - Wikipedia / Wikivoyage via the official Wikimedia APIs (through our proxy)
//  - the publishers' own RSS feeds from the catalog
// Nothing is scraped. "Outside my usual interests" is worked out locally from
// what you follow and read; it never leaves your browser.

import { pick, shuffle, flagEmoji, sourceId } from './util.js';
import { fetchFeed, wikiSummary, wikiRandom, wikiSearch } from './api.js';

// Wikipedia/Wikivoyage article titles that differ from our country names.
const WIKI_TITLE = {
  'Congo (Republic of the)': 'Republic of the Congo',
  'Gambia': 'The Gambia',
  'Bahamas': 'The Bahamas',
  'Georgia': 'Georgia (country)',
  'Micronesia': 'Federated States of Micronesia',
  'Palestine': 'State of Palestine',
  'Türkiye': 'Turkey',
  'Cabo Verde': 'Cape Verde',
  'Niger': 'Niger',
};
export const wikiTitleFor = (name) => WIKI_TITLE[name] || name;

// How much do you already engage with each category? (follows, reads, bookmarks)
export function interestWeights(store, categories) {
  const w = Object.fromEntries(categories.map((c) => [c, 0]));
  for (const s of store.sources()) if (s.on && s.cat in w) w[s.cat] += 0.2;
  for (const r of Object.values(store.state.reads)) if (r && !r.del && r.c in w) w[r.c] += 1;
  for (const l of store.library()) if (l.item && l.item.cat in w) w[l.item.cat] += 2;
  return w;
}

// The categories you engage with most (top 2, only if there is real signal).
export function usualCategories(weights) {
  const ranked = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3) return new Set();
  return new Set(ranked.slice(0, 2).filter(([, v]) => v > 0).map(([k]) => k));
}

export function pickOutside(list, usual, seen = new Set(), key = (x) => x, rnd = Math.random) {
  const unseen = list.filter((x) => !seen.has(key(x)));
  const pool = unseen.length ? unseen : list;
  const outside = pool.filter((x) => !usual.has(x.c || x.cat));
  return pick(outside.length ? outside : pool, rnd);
}

export function pickCountry(countries, seen = new Set(), rnd = Math.random) {
  const unseen = countries.filter((c) => !seen.has(c.code));
  return pick(unseen.length ? unseen : countries, rnd);
}

async function maybe(p) { try { return await p; } catch { return null; } }

export async function exploreCountry(country) {
  const title = wikiTitleFor(country.name);
  const [wp, wv] = await Promise.all([
    wikiSummary(title, 'wikipedia'),
    maybe(wikiSummary(title, 'wikivoyage')),
  ]);
  return {
    kind: 'country',
    flag: flagEmoji(country.code),
    country,
    page: wp.page,
    travel: wv && wv.page && wv.page.type === 'standard' ? wv.page : null,
  };
}

export async function exploreTopic(topic) {
  const [wp, rel] = await Promise.all([
    wikiSummary(topic.t),
    maybe(wikiSearch(topic.t)),
  ]);
  const related = ((rel && rel.results) || []).filter((r) => r.title.toLowerCase() !== wp.page.title.toLowerCase()).slice(0, 5);
  return { kind: 'topic', topic, page: wp.page, related };
}

export async function exploreRandomWikipedia() {
  const r = await wikiRandom();
  return { kind: 'wiki', page: r.page };
}

// A random article from a publisher the user does NOT follow yet.
export async function exploreUnfollowedArticle({ catalog, store, usual, rnd = Math.random }) {
  const followed = new Set(store.sources().filter((s) => s.on).map((s) => s.id));
  const candidates = catalog.sources.filter((s) => !followed.has(sourceId(s.url)));
  const outside = candidates.filter((s) => !usual.has(s.cat));
  const order = shuffle(outside.length ? outside : candidates, rnd).slice(0, 4);
  for (const src of order) {
    const res = await maybe(fetchFeed(src.url));
    const items = res && res.items ? res.items.slice(0, 25) : [];
    if (items.length) {
      const item = pick(items, rnd);
      return { kind: 'article', source: src, item: { ...item, sname: src.name, cat: src.cat } };
    }
  }
  return null;
}

export function exploreWebsite({ catalog, store, usual, seen = new Set(), rnd = Math.random }) {
  const followed = new Set(store.sources().filter((s) => s.on).map((s) => sourceId(s.feed || s.url)));
  const sites = catalog.sites.filter((s) => !(s.feed && followed.has(sourceId(s.feed))));
  const site = pickOutside(sites, usual, seen, (s) => s.url, rnd);
  return { kind: 'site', site };
}
