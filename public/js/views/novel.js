import { h, pick } from '../util.js';
import { hubCard, moreList, tabBar, isHidden } from './hubui.js';

const TABS = [['bangla', 'Bangla novels'], ['world', 'World classics']];
const enc = encodeURIComponent;
const wikisourceBn = (q) => `https://bn.wikisource.org/w/index.php?search=${enc(q)}`;
const wikipediaBn = (q) => `https://bn.wikipedia.org/w/index.php?search=${enc(q)}`;
const wikipediaEn = (q) => `https://en.wikipedia.org/w/index.php?search=${enc(q)}`;
const gutenberg = (q) => `https://www.gutenberg.org/ebooks/search/?query=${enc(q)}`;

// Links are searches on purpose: this app does not claim a particular book is
// online or free. Older books are often on Wikisource / Project Gutenberg;
// newer ones usually are not.
function decorate(e) {
  if (e.lang === 'bn') {
    return { ...e, link: wikisourceBn(e.title), linkLabel: 'Search Wikisource ↗', extra: [{ href: wikipediaBn(e.title), label: 'বাংলা উইকিপিডিয়া ↗' }] };
  }
  return { ...e, link: gutenberg(`${e.title} ${e.by}`), linkLabel: 'Search Project Gutenberg ↗', extra: [{ href: wikipediaEn(e.title), label: 'Wikipedia ↗' }] };
}

export function renderNovel(ctx, root, { arg } = {}) {
  const tab = TABS.some(([id]) => id === arg) ? arg : 'bangla';
  const entries = ctx.novels[tab].map(decorate);

  root.append(
    h('h1', { class: 'page-title', text: 'Novels' }),
    h('p', { class: 'lede', text: 'A small hand-picked shelf. Every button opens a search on another site in a new tab. Old books are often free on Wikisource or Project Gutenberg, but newer ones usually are not: this page does not promise that any book is available.' }),
    tabBar(TABS, tab, (id) => (id === 'bangla' ? '#/novel' : `#/novel/${id}`)));

  const out = h('div', { class: 'bored-out' });
  const render = (e, redraw) => hubCard(ctx, e, { typeLabel: e.lang === 'bn' ? 'Bangla novel' : 'Classic', onHide: redraw, links: e.extra.map((l) => h('a', { class: 'btn sm', href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.label)) });
  let last = null;
  const choose = h('button', { type: 'button', class: 'btn primary', onclick: () => {
    const live = entries.filter((e) => !isHidden(ctx.store, e.id) && e.id !== last);
    if (!live.length) { out.replaceChildren(h('p', { class: 'hint', text: 'Nothing to pick from. Restore hidden books below.' })); return; }
    const e = pick(live);
    last = e.id;
    out.replaceChildren(h('p', { class: 'eyebrow', text: 'Your pick' }), render(e, () => out.replaceChildren()));
  } }, '📖 Pick a novel for me');

  root.append(h('section', { class: 'panel' }, choose, h('p', { class: 'hint', text: 'One random book at a time, never ranked.' }), out),
    moreList(ctx, entries, render, { initial: 6 }));
  return undefined;
}
