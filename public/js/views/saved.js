import { h } from '../util.js';
import { articleCard } from './card.js';
import { matchesQuery } from '../timeline.js';

export function renderSaved(ctx, root) {
  const { store } = ctx;
  let mode = 'all'; // all | notes

  const tabs = h('div', { class: 'chips', role: 'tablist' });
  const list = h('div', { class: 'feed' });
  root.append(h('h1', { class: 'page-title', text: 'Saved' }), tabs, list);

  function render() {
    const entries = store.library().sort((a, b) => b.t - a.t);
    tabs.replaceChildren(
      ...[['all', `Bookmarks & notes (${entries.length})`], ['notes', `With notes (${entries.filter((e) => e.note).length})`]].map(([id, label]) =>
        h('button', { type: 'button', class: 'chip', role: 'tab', 'aria-selected': String(mode === id), onclick: () => { mode = id; render(); } }, label)));
    list.replaceChildren();
    const rows = entries.filter((e) => e.item && (mode === 'all' || e.note)
      && matchesQuery({ ...e.item, author: '' }, ctx.query, e.note));
    if (!rows.length) {
      list.append(h('div', { class: 'empty' }, h('h2', { text: entries.length ? 'Nothing matches' : 'Nothing saved yet' }),
        h('p', { text: entries.length ? 'Try a different search or filter.' : 'Use “Save” on any article to keep it here, or “Note” to jot down a thought.' })));
      return;
    }
    list.append(h('p', { class: 'hint', text: 'Newest saves first. Saved items stay even if the publisher drops them from their feed.' }));
    for (const e of rows) list.append(articleCard(ctx, { ...e.item, id: e.id }, { showNote: mode === 'notes' }));
  }
  render();
  ctx.onQuery = render;
  return () => { ctx.onQuery = null; };
}
