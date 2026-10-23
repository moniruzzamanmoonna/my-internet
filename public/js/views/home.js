import { h, debounce, hostOf } from '../util.js';
import { formatBangla } from '../hub/bdcal.js';
import { dayKeyOf, pickForDay } from '../hub/daily.js';
import { buildIndex, searchIndex } from '../hub/hubsearch.js';
import { renderBored, hubCard, badge } from './hubui.js';
import { articleCard } from './card.js';

const DEFAULT_LINKS = [
  { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { title: 'বাংলা উইকিপিডিয়া', url: 'https://bn.wikipedia.org' },
  { title: 'National Portal of Bangladesh', url: 'https://bangladesh.gov.bd' },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function normaliseUrl(raw) {
  let t = String(raw || '').trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = `https://${t}`;
  try { const u = new URL(t); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.href : null; } catch { return null; }
}

export function renderHome(ctx, root) {
  const { store, fun, learn, bd } = ctx;
  const now = new Date();
  const today = dayKeyOf(now);
  const timers = [];

  // ---------- clock, date, Bangla date ----------
  const clock = h('span', { class: 'clock' });
  const hello = h('h1', { class: 'hello' });
  const dateEn = h('p', { class: 'date-en' });
  const dateBn = h('p', { class: 'date-bn', lang: 'bn' });
  function tick() {
    const d = new Date();
    const hr = d.getHours();
    hello.textContent = hr < 5 ? 'Still up?' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 21 ? 'Good evening' : 'Good night';
    clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    dateEn.textContent = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const b = formatBangla(d);
    dateBn.textContent = `${b.weekdayBn}, ${b.bn}`;
    dateBn.title = `Bangla calendar as revised in Bangladesh: ${b.en}`;
  }
  tick();
  timers.push(setInterval(tick, 30000));

  const head = h('section', { class: 'panel hero' }, h('div', { class: 'hero-row' }, hello, clock), dateEn, dateBn);

  // ---------- fact of the day ----------
  const fact = pickForDay(fun.facts, today, 'fact');
  const factPanel = h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { text: 'Fact of the day' }), badge('static', 'Curated')),
    hubCard(ctx, { ...fact, type: 'fact', title: 'Did you know?', blurb: fact.t }, { typeLabel: 'Fact' }));

  // ---------- dashboard search ----------
  const results = h('div', { class: 'search-results', 'aria-live': 'polite' });
  const q = h('input', { type: 'search', id: 'hub-q', placeholder: 'Search the dashboard: facts, words, places, links, goals…', 'aria-label': 'Search the dashboard', maxlength: '80' });
  const doSearch = debounce(() => {
    const term = q.value.trim();
    results.replaceChildren();
    if (!term) return;
    const index = buildIndex({
      fun: fun.items, facts: fun.facts, riddles: fun.riddles, vocab: learn.vocab, quizzes: learn.quizzes,
      destinations: bd.destinations, divisions: bd.divisions, services: bd.services, emergency: bd.emergency,
      history: bd.history, culture: bd.culture,
      links: store.settingEntries('ql:').map(([, v]) => v),
      goals: store.settingEntries('goal:').map(([, v]) => v),
      reading: store.settingEntries('rl:').map(([, v]) => v),
      checklist: store.settingEntries('cl:').map(([, v]) => v),
    });
    const hits = searchIndex(index, term, 30);
    if (!hits.length) { results.append(h('p', { class: 'hint', text: `Nothing on the dashboard matches “${term}”.` })); return; }
    results.append(h('ul', { class: 'hits-list' }, hits.map((e) => h('li', {},
      h('span', { class: 'pill', text: e.type }), ' ',
      h('a', { href: e.route, text: e.title })))));
    results.append(h('p', { class: 'hint', text: 'To search articles in your feed, use the search box at the top.' }));
  }, 150);
  q.addEventListener('input', doSearch);
  const searchPanel = h('section', { class: 'panel' }, h('label', { for: 'hub-q', class: 'sr', text: 'Search the dashboard' }), q, results);

  // ---------- I'm bored + session ----------
  const boredOut = h('div', { class: 'bored-out' });
  const boredPanel = h('section', { class: 'panel' },
    h('div', { class: 'row-btns tight' },
      h('button', { type: 'button', class: 'btn primary big', onclick: () => renderBored(ctx, boredOut, fun) }, '🎲 I’m bored'),
      h('button', { type: 'button', class: 'btn big', onclick: () => ctx.openSession() }, '⏳ Set a browsing time')),
    h('p', { class: 'hint', text: 'One random suggestion at a time. Nothing autoplays and nothing is ranked.' }),
    boredOut);

  // ---------- quick links ----------
  const linksBox = h('div', { class: 'quick-links' });
  if (!store.setting('ql-seeded', false)) {
    DEFAULT_LINKS.forEach((l) => store.setSetting(`ql:${uid()}`, l));
    store.setSetting('ql-seeded', true);
  }
  const lTitle = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Link name', maxlength: '40' });
  const lUrl = h('input', { type: 'text', placeholder: 'example.com', 'aria-label': 'Link address', inputmode: 'url', autocapitalize: 'off', maxlength: '300' });
  const lMsg = h('p', { class: 'form-msg', role: 'status' });
  function drawLinks() {
    const links = store.settingEntries('ql:');
    linksBox.replaceChildren(links.length ? h('ul', { class: 'chip-list' }, links.map(([key, l]) => h('li', {},
      h('a', { class: 'chip-link', href: l.url, target: '_blank', rel: 'noopener noreferrer', title: hostOf(l.url), text: l.title }),
      h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${l.title}`, onclick: () => { store.removeSetting(key); drawLinks(); } }, '×')))) : h('p', { class: 'hint', text: 'No quick links yet. Add your favourite sites below.' }));
  }
  const linkForm = h('form', { class: 'inline-form', onsubmit: (e) => {
    e.preventDefault();
    const url = normaliseUrl(lUrl.value);
    if (!url) { lMsg.className = 'form-msg err'; lMsg.textContent = 'Please enter a valid web address, for example example.com.'; return; }
    store.setSetting(`ql:${uid()}`, { title: lTitle.value.trim() || hostOf(url), url });
    lTitle.value = ''; lUrl.value = ''; lMsg.textContent = ''; drawLinks();
  } }, lTitle, lUrl, h('button', { type: 'submit', class: 'btn sm', text: 'Add link' }));
  drawLinks();
  const linksPanel = h('section', { class: 'panel' }, h('h2', { text: 'Quick links' }), linksBox, linkForm, lMsg);

  // ---------- daily goals (no streaks, resets each day) ----------
  for (const [key] of store.settingEntries('goal:')) {
    const day = key.split(':')[1];
    if (day < dayKeyOf(new Date(Date.now() - 14 * 864e5))) store.removeSetting(key);
  }
  const goalsBox = h('div', {});
  const gIn = h('input', { type: 'text', placeholder: 'One thing I want to do today…', 'aria-label': 'New goal for today', maxlength: '120' });
  function drawGoals() {
    const goals = store.settingEntries(`goal:${today}:`);
    const done = goals.filter(([, g]) => g.done).length;
    goalsBox.replaceChildren(
      goals.length ? h('p', { class: 'hint', text: `${done} of ${goals.length} done today` }) : h('p', { class: 'hint', text: 'Add one to three small goals. This list starts fresh every day: no streaks, no scores.' }),
      h('ul', { class: 'todo' }, goals.map(([key, g]) => h('li', {},
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!g.done, onchange: (e) => { store.setSetting(key, { ...g, done: e.target.checked }); drawGoals(); } }), h('span', { class: g.done ? 'done' : '', text: g.t })),
        h('button', { type: 'button', class: 'x', 'aria-label': `Delete goal: ${g.t}`, onclick: () => { store.removeSetting(key); drawGoals(); } }, '×')))));
  }
  const goalForm = h('form', { class: 'inline-form', onsubmit: (e) => {
    e.preventDefault();
    const t = gIn.value.trim();
    if (!t) return;
    store.setSetting(`goal:${today}:${uid()}`, { t, done: false });
    gIn.value = ''; drawGoals();
  } }, gIn, h('button', { type: 'submit', class: 'btn sm', text: 'Add goal' }));
  drawGoals();
  const goalsPanel = h('section', { class: 'panel' }, h('h2', { text: 'Today’s goals' }), goalsBox, goalForm);

  // ---------- favourite categories ----------
  const favBox = h('div', {});
  const latestBox = h('div', {});
  const getFav = () => { const v = store.setting('favcats', []); return Array.isArray(v) ? v : []; };
  function drawFav() {
    const fav = getFav();
    favBox.replaceChildren(h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Favourite categories' },
      ctx.allCategories().map((c) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(fav.includes(c.id)), onclick: () => {
        const next = fav.includes(c.id) ? fav.filter((x) => x !== c.id) : [...fav, c.id];
        store.setSetting('favcats', next); drawFav(); drawLatest();
      } }, c.name))));
  }
  function drawLatest() {
    const fav = getFav();
    latestBox.replaceChildren();
    if (!fav.length) { latestBox.append(h('p', { class: 'hint', text: 'Pick the categories you care about and the three newest stories from each will appear here, newest first.' })); return; }
    const all = ctx.feeds.timeline();
    for (const id of fav) {
      const items = all.filter((i) => i.cat === id).slice(0, 3);
      latestBox.append(h('h3', { class: 'sub-title', text: ctx.catName(id) }),
        items.length ? items.map((it) => articleCard(ctx, it)) : h('p', { class: 'hint', text: ctx.feeds.loading ? 'Loading…' : 'No articles yet. Add or enable sources in this category.' }),
        h('p', { class: 'hint' }, h('a', { href: `#/feed/${encodeURIComponent(id)}`, text: `More in ${ctx.catName(id)} →` })));
    }
  }
  drawFav(); drawLatest();
  const unsub = ctx.feeds.subscribe(drawLatest);
  const favPanel = h('section', { class: 'panel' }, h('h2', { text: 'My categories' }), favBox, latestBox);

  // ---------- word of the day ----------
  const w = pickForDay(learn.vocab, today, 'word');
  const wordPanel = h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', { text: 'Word of the day' }), badge('static', 'Curated')),
    h('p', { class: 'word' }, h('strong', { text: w.w }), ` (${w.pos})`),
    h('p', { class: 'bn', lang: 'bn', text: w.bn }),
    h('p', { class: 'hint', text: `“${w.ex}”` }),
    h('a', { class: 'btn sm', href: '#/learn/vocab', text: 'More words →' }));

  root.append(head, searchPanel, boredPanel,
    h('div', { class: 'grid-2' }, factPanel, wordPanel),
    h('div', { class: 'grid-2' }, goalsPanel, linksPanel),
    favPanel);

  return () => { timers.forEach(clearInterval); unsub(); };
}
