import { h, dayLabel } from '../util.js';
import { filterItems, groupByDay } from '../timeline.js';
import { articleCard } from './card.js';

const PAGE = 40;

export function renderFeed(ctx, root, { cat = 'all' } = {}) {
  const { store, feeds } = ctx;
  let shown = PAGE;
  let unreadOnly = !!store.setting('unreadOnly', false);

  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Categories' });
  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const tools = h('div', { class: 'toolbar' });
  const list = h('div', { class: 'feed' });
  const more = h('div', { class: 'more' });
  root.append(chips, status, tools, list, more);

  function renderChips() {
    chips.replaceChildren();
    const cats = ctx.activeCategories();
    const mk = (id, label) => h('a', {
      class: 'chip', role: 'tab', href: id === 'all' ? '#/feed' : `#/feed/${encodeURIComponent(id)}`,
      'aria-selected': String(cat === id), text: label,
    });
    chips.append(mk('all', 'All'), ...cats.map((c) => mk(c.id, c.name)));
  }

  function renderStatus() {
    const s = feeds.summary();
    status.replaceChildren();
    if (!s.total) return;
    const parts = [];
    if (s.pending) parts.push(`Loading ${s.pending} of ${s.total} sources…`);
    else {
      const t = feeds.lastUpdated();
      parts.push(t ? `Updated ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
    }
    if (parts[0]) status.append(h('span', { text: parts[0] }));
    if (s.failed) {
      status.append(h('a', { class: 'warn', href: '#/sources' }, `${s.failed} source${s.failed > 1 ? 's' : ''} couldn’t load — review`));
    }
  }

  function renderTools(visible) {
    tools.replaceChildren(
      h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked: unreadOnly, onchange: (e) => { unreadOnly = e.target.checked; store.setSetting('unreadOnly', unreadOnly); shown = PAGE; renderList(); } }),
        h('span', { text: 'Unread only' })),
      h('span', { class: 'count', text: `${visible.length} article${visible.length === 1 ? '' : 's'}` }),
      h('button', { type: 'button', class: 'link', disabled: !visible.length, onclick: () => {
        const unread = visible.filter((i) => !store.isRead(i.id));
        if (!unread.length) return;
        store.markManyRead(unread);
        ctx.toast(`Marked ${unread.length} as read`);
        renderList();
      } }, 'Mark all read'),
    );
  }

  function emptyState(total, loading) {
    if (!store.sources().some((s) => s.on)) {
      return h('div', { class: 'empty' },
        h('h2', { text: 'No sources yet' }),
        h('p', { text: 'Pick the publications you want to follow. Nothing is chosen for you and nothing is ranked.' }),
        h('a', { class: 'btn primary', href: '#/sources' }, 'Choose sources'));
    }
    if (loading && !total) {
      return h('div', { class: 'skeletons', 'aria-hidden': 'true' }, Array.from({ length: 6 }, () => h('div', { class: 'skeleton' })));
    }
    if (ctx.query) return h('div', { class: 'empty' }, h('h2', { text: 'Nothing matches' }), h('p', { text: `No articles match “${ctx.query}”.` }));
    if (unreadOnly && total) return h('div', { class: 'empty' }, h('h2', { text: 'All caught up' }), h('p', { text: 'You have read everything here. Turn off “Unread only” to see it again.' }));
    return h('div', { class: 'empty' }, h('h2', { text: 'No articles' }), h('p', { text: 'This category has no articles yet. Check the Sources screen for feed errors.' }));
  }

  function renderList() {
    const all = feeds.timeline();
    const visible = filterItems(all, { cat, q: ctx.query, unreadOnly, isRead: (id) => store.isRead(id), getNote: (id) => store.getNote(id) });
    renderTools(visible);
    list.replaceChildren();
    more.replaceChildren();
    if (!visible.length) { list.append(emptyState(all.length, feeds.loading || feeds.summary().pending)); return; }
    const page = visible.slice(0, shown);
    for (const g of groupByDay(page, dayLabel)) {
      list.append(h('section', { class: 'day' },
        h('h2', { class: 'day-label', text: g.label }),
        g.items.map((it) => articleCard(ctx, it))));
    }
    if (visible.length > shown) {
      more.append(h('button', { type: 'button', class: 'btn', onclick: () => { shown += PAGE; renderList(); } }, `Show more (${visible.length - shown} left)`));
    }
  }

  function renderAll() { renderChips(); renderStatus(); renderList(); }

  // First run: tell people what they are looking at.
  if (!store.setting('welcomed', false) && store.sources().some((s) => s.on)) {
    root.prepend(h('div', { class: 'banner' },
      h('p', {}, h('strong', { text: 'Welcome. ' }), 'These are suggested starter sources — plain chronological feeds, no algorithm. Add, remove or change them any time in '),
      h('a', { href: '#/sources', text: 'Sources' }),
      h('button', { type: 'button', class: 'link', onclick: (e) => { store.setSetting('welcomed', true); e.target.closest('.banner').remove(); } }, 'Dismiss')));
  }

  renderAll();
  const unsub = feeds.subscribe(() => { renderChips(); renderStatus(); renderList(); });
  ctx.onQuery = () => { shown = PAGE; renderList(); };
  return () => { unsub(); ctx.onQuery = null; };
}
