// The article card, shared by the feed, saved items and discovery.
import { h, timeAgo, debounce } from '../util.js';
import { getCount, setLoved, isLoved } from '../engage.js';

export function articleCard(ctx, item, { showNote = false } = {}) {
  const { store } = ctx;
  const catName = ctx.catName(item.cat);
  const root = h('article', { class: 'card', dataset: { id: item.id } });

  const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
  const link = h('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', text: item.title });
  const markRead = () => { store.setRead(item.id, true, item.cat); paint(); };
  link.addEventListener('click', markRead);
  link.addEventListener('auxclick', markRead);

  const when = item.published ? h('time', { datetime: item.published, title: new Date(item.published).toLocaleString(), text: timeAgo(item.published) }) : null;

  const bmBtn = h('button', { type: 'button', class: 'act', 'aria-pressed': 'false', title: 'Bookmark', onclick: () => {
    const on = store.toggleBookmark(item);
    ctx.toast(on ? 'Bookmarked' : 'Bookmark removed');
    paint();
  } }, h('span', { class: 'ico', 'aria-hidden': 'true', text: '🔖' }), h('span', { class: 'lbl', text: 'Save' }));

  // ❤ is shared: the number is how many visitors loved this article.
  const loveBtn = h('button', { type: 'button', class: 'act love', 'aria-pressed': String(isLoved(item.id)), title: 'Love this article' },
    h('span', { class: 'ico', 'aria-hidden': 'true', text: '❤' }), h('span', { class: 'lbl', text: 'Love' }));
  const loveCount = h('span', { class: 'love-n', 'aria-live': 'polite' });
  loveBtn.append(loveCount);
  const showCount = (n) => { loveCount.textContent = n > 0 ? String(n) : ''; };
  getCount(item.id).then((n) => { if (n !== null) showCount(n); else loveBtn.title = 'Love counter unavailable right now'; });
  loveBtn.addEventListener('click', async () => {
    const want = loveBtn.getAttribute('aria-pressed') !== 'true';
    loveBtn.disabled = true;
    const n = await setLoved(item.id, want);
    loveBtn.disabled = false;
    if (n === null) { ctx.toast("Couldn't reach the love counter. Try again."); return; }
    loveBtn.setAttribute('aria-pressed', String(want));
    showCount(n);
  });

  const readBtn = h('button', { type: 'button', class: 'act', 'aria-pressed': 'false', onclick: () => {
    store.setRead(item.id, !store.isRead(item.id), item.cat); paint();
  } }, h('span', { class: 'ico', 'aria-hidden': 'true', text: '✓' }), h('span', { class: 'lbl' }));

  const noteBtn = h('button', { type: 'button', class: 'act', 'aria-expanded': 'false', onclick: () => {
    box.hidden = !box.hidden;
    noteBtn.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) ta.focus();
  } }, h('span', { class: 'ico', 'aria-hidden': 'true', text: '📝' }), h('span', { class: 'lbl', text: 'Note' }));

  const ta = h('textarea', { rows: '3', maxlength: '5000', placeholder: 'Your private note…', 'aria-label': `Note for ${item.title}` });
  const save = debounce(() => { store.setNote(item, ta.value); paint(); }, 600);
  ta.addEventListener('input', save);
  ta.addEventListener('blur', () => save.flush());
  ta.value = store.getNote(item.id);
  const box = h('div', { class: 'note-box', hidden: !(showNote || ta.value) }, ta, h('p', { class: 'hint', text: 'Saved automatically. Only you can see notes.' }));

  const img = item.image ? h('img', { class: 'thumb', src: item.image, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null;
  if (img) img.addEventListener('error', () => img.remove());

  root.append(...[
    h('div', { class: 'body' },
      h('div', { class: 'meta' }, dot, h('span', { class: 'from', text: item.sname || '' }), catName && h('span', { class: 'cat', text: catName }), when, item.badge ? h('span', { class: 'badge cached', text: `◐ ${item.badge}`, title: 'An older snapshot saved in this browser. Not live.' }) : null),
      h('h3', { class: 'title' }, link),
      item.summary && h('p', { class: 'summary', text: item.summary }),
    ),
    img,
    h('div', { class: 'actions' }, loveBtn, bmBtn, readBtn, noteBtn),
    box,
  ].filter(Boolean)); // native append() would print "null" for a missing image

  function paint() {
    const read = store.isRead(item.id);
    const bm = store.isBookmarked(item.id);
    root.classList.toggle('unread', !read);
    bmBtn.setAttribute('aria-pressed', String(bm));
    bmBtn.querySelector('.lbl').textContent = bm ? 'Saved' : 'Save';
    readBtn.setAttribute('aria-pressed', String(read));
    readBtn.querySelector('.lbl').textContent = read ? 'Mark unread' : 'Mark read';
    readBtn.title = read ? 'Mark as unread' : 'Mark as read';
    noteBtn.classList.toggle('has-note', !!store.getNote(item.id));
  }
  paint();
  return root;
}
