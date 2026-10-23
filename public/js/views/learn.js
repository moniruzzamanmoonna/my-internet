import { h, shuffle } from '../util.js';
import { dayKeyOf, pickForDay } from '../hub/daily.js';
import { createTimer, formatClock } from '../hub/timer.js';
import { loadFeedGroup } from '../hub/feedgroup.js';
import { fetchFeed, pool } from '../api.js';
import { articleCard } from './card.js';
import { hubCard, moreList, tabBar, badge, fmtTime } from './hubui.js';
import { normaliseUrl } from './home.js';

const TABS = [['vocab', 'Vocabulary'], ['quiz', 'Quiz'], ['discover', 'Science & tech'], ['reading', 'Reading list'], ['checklist', 'Checklist'], ['focus', 'Focus timer']];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function renderLearn(ctx, root, { arg } = {}) {
  const tab = TABS.some(([id]) => id === arg) ? arg : 'vocab';
  root.append(
    h('h1', { class: 'page-title', text: 'Learn & grow' }),
    tabBar(TABS, tab, (id) => (id === 'vocab' ? '#/learn' : `#/learn/${id}`)));
  const body = h('div', {});
  root.append(body);
  return { vocab, quiz, discover, reading, checklist, focus }[tab](ctx, body);
}

// ======================= VOCABULARY =======================
function vocab(ctx, body) {
  const { learn } = ctx;
  const w = pickForDay(learn.vocab, dayKeyOf(), 'word');
  const entries = learn.vocab.map((x) => ({ id: `word-${x.w}`, type: 'word', title: x.w, by: x.pos, blurb: `${x.bn} — “${x.ex}”`, link: `https://en.wiktionary.org/wiki/${encodeURIComponent(x.w)}` }));
  body.append(
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Word of the day' }), badge('static', 'Curated')),
      h('p', { class: 'word big' }, h('strong', { text: w.w }), ` (${w.pos})`),
      h('p', { class: 'bn', lang: 'bn', text: w.bn }),
      h('p', { class: 'hint', text: `“${w.ex}”` })),
    h('section', {},
      h('div', { class: 'panel-head' }, h('h2', { text: 'More words' }), badge('static', 'Curated list')),
      h('p', { class: 'hint', text: 'Use “Save for later” to keep a word, or “Favourite” for the ones you want to revise.' }),
      moreList(ctx, entries, (e) => hubCard(ctx, e, { typeLabel: 'Word', links: [] }))));
}

// ======================= QUIZ =======================
function quiz(ctx, body) {
  const { learn } = ctx;
  let topic = 'bangladesh';
  let questions = []; let i = 0; let score = 0; let answered = false;
  const out = h('div', {});
  const topicRow = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Quiz topic' });

  function start() {
    const candidates = learn.quizzes.filter((q) => topic === 'mixed' || q.topic === topic);
    questions = shuffle(candidates).slice(0, 5);
    i = 0; score = 0; answered = false; draw();
  }
  function drawTopics() {
    topicRow.replaceChildren(...[...learn.quizTopics, { id: 'mixed', name: 'Mixed' }].map((t) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(topic === t.id), onclick: () => { topic = t.id; drawTopics(); start(); } }, t.name)));
  }
  function draw() {
    out.replaceChildren();
    if (i >= questions.length) {
      out.append(h('div', { class: 'panel' }, h('h2', { text: 'Set complete' }),
        h('p', { class: 'score', text: `You got ${score} of ${questions.length} right.` }),
        h('p', { class: 'hint', text: 'Whatever the score: you looked things up and learned. There are no streaks to keep.' }),
        h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn primary', onclick: start }, 'Another set'))));
      return;
    }
    const q = questions[i];
    const fb = h('div', { class: 'quiz-fb', 'aria-live': 'polite' });
    const next = h('button', { type: 'button', class: 'btn primary', hidden: true, onclick: () => { i++; answered = false; draw(); } }, i === questions.length - 1 ? 'See result' : 'Next question');
    const opts = q.options.map((text, idx) => h('button', { type: 'button', class: 'opt', onclick: () => {
      if (answered) return;
      answered = true;
      const ok = idx === q.answer;
      if (ok) score++;
      opts.forEach((b, k) => { b.disabled = true; if (k === q.answer) b.classList.add('right'); else if (k === idx) b.classList.add('wrong'); });
      fb.replaceChildren(h('p', { class: ok ? 'ok-text' : 'err', text: ok ? 'Correct.' : `Not quite. The answer is: ${q.options[q.answer]}.` }), h('p', { text: q.explain }));
      next.hidden = false; next.focus();
    } }, text));
    out.append(h('section', { class: 'panel quiz' },
      h('p', { class: 'hint', text: `Question ${i + 1} of ${questions.length}` }),
      h('h2', { class: 'quiz-q', text: q.q }),
      h('div', { class: 'opts' }, opts), fb, h('div', { class: 'row-btns' }, next)));
  }
  drawTopics(); start();
  body.append(h('div', { class: 'panel-head' }, h('p', { class: 'hint', text: 'Five questions at a time, with an explanation after each answer.' }), badge('static', 'Hand-written study aid')),
    topicRow, out,
    h('p', { class: 'hint', text: learn.note }));
}

// ======================= SCIENCE & TECH (live) =======================
function discover(ctx, body) {
  const { learn, catalog } = ctx;
  const names = [...learn.discoverySources.science, ...learn.discoverySources.technology];
  const sources = catalog.sources.filter((s) => names.includes(s.name));
  const AI = /\b(AI|A\.I\.|artificial intelligence|machine learning|LLMs?|chatbots?|neural networks?|generative)\b/i;
  let data = null; let filter = 'all'; let shown = 8;
  const status = h('div', { class: 'panel' });
  const chips = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Topic' });
  const list = h('div', {});
  body.append(status, chips, list);

  function drawStatus() {
    status.replaceChildren();
    if (!data) { status.append(h('p', { class: 'hint', text: 'Loading from publishers…' }), h('div', { class: 'skeleton' })); return; }
    status.append(
      h('div', { class: 'panel-head' }, h('h2', { text: 'Latest in science, technology and AI' }), h('button', { type: 'button', class: 'btn sm', onclick: load }, 'Refresh')),
      h('div', { class: 'badges' }, data.live ? badge('live', `Live: ${data.live} of ${sources.length} sources`) : '', data.cached ? badge('cached', `Cached snapshot: ${data.cached}`) : '', data.failed ? badge('bad', `Unavailable: ${data.failed}`) : ''),
      data.cached ? h('p', { class: 'hint warn-text', text: 'Some items come from an older saved snapshot and are marked “Cached”.' }) : '',
      h('p', { class: 'hint', text: 'Newest first from the publishers’ own feeds. “AI” is a keyword filter over the same articles. Nothing here is generated or summarised by this app.' }));
  }
  function drawChips() {
    chips.replaceChildren(...[['all', 'All'], ['science', 'Science'], ['technology', 'Technology'], ['ai', 'AI']].map(([id, label]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === id), onclick: () => { filter = id; shown = 8; drawChips(); drawList(); } }, label)));
  }
  function drawList() {
    list.replaceChildren();
    if (!data) return;
    if (!data.items.length) { list.append(h('div', { class: 'empty' }, h('h2', { text: 'Nothing to show right now' }), h('p', { text: 'The publisher feeds could not be reached and no saved snapshot exists yet.' }), h('button', { type: 'button', class: 'btn primary', onclick: load }, 'Try again'))); return; }
    const rows = data.items.filter((i) => (filter === 'all' ? true : filter === 'ai' ? AI.test(`${i.title} ${i.summary}`) : i.cat === filter));
    if (!rows.length) list.append(h('p', { class: 'hint', text: 'No articles match this filter in the latest feeds.' }));
    rows.slice(0, shown).forEach((it) => list.append(articleCard(ctx, { ...it, badge: it.freshness === 'cached' ? `Cached ${fmtTime(it.freshAt)}` : '' })));
    if (rows.length > shown) list.append(h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn', onclick: () => { shown += 8; drawList(); } }, `Show more (${rows.length - shown} left)`)));
  }
  async function load() {
    data = null; drawStatus(); drawList();
    data = await loadFeedGroup({ key: 'mi.learnnews.v1', sources, fetchFeed, pool, storage: ctx.storage });
    drawStatus(); drawList();
  }
  drawChips(); load();
}

// ======================= READING LIST =======================
function reading(ctx, body) {
  const { store } = ctx;
  let filter = 'all';
  const STATES = [['todo', 'To read'], ['reading', 'Reading'], ['done', 'Done']];
  const title = h('input', { type: 'text', placeholder: 'Title or topic', 'aria-label': 'Title', maxlength: '120' });
  const url = h('input', { type: 'text', placeholder: 'Link (optional)', 'aria-label': 'Link', inputmode: 'url', autocapitalize: 'off', maxlength: '300' });
  const msg = h('p', { class: 'form-msg', role: 'status' });
  const chips = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Filter' });
  const list = h('div', {});
  const form = h('form', { class: 'inline-form', onsubmit: (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) { msg.className = 'form-msg err'; msg.textContent = 'Please enter a title.'; return; }
    let link = '';
    if (url.value.trim()) { link = normaliseUrl(url.value) || ''; if (!link) { msg.className = 'form-msg err'; msg.textContent = 'That link does not look valid. Leave it empty or fix it.'; return; } }
    store.setSetting(`rl:${uid()}`, { title: t, url: link, status: 'todo' });
    title.value = ''; url.value = ''; msg.textContent = ''; draw();
  } }, title, url, h('button', { type: 'submit', class: 'btn sm', text: 'Add' }));
  function draw() {
    const all = store.settingEntries('rl:');
    chips.replaceChildren(...[['all', `All (${all.length})`], ...STATES.map(([id, l]) => [id, `${l} (${all.filter(([, v]) => v.status === id).length})`])].map(([id, label]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(filter === id), onclick: () => { filter = id; draw(); } }, label)));
    const rows = all.filter(([, v]) => filter === 'all' || v.status === filter);
    list.replaceChildren(rows.length ? h('ul', { class: 'todo' }, rows.map(([key, v]) => h('li', {},
      h('div', { class: 'rl-main' }, v.url ? h('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer', text: v.title }) : h('span', { text: v.title })),
      h('select', { 'aria-label': `Status of ${v.title}`, onchange: (e) => { store.setSetting(key, { ...v, status: e.target.value }); draw(); } }, ...STATES.map(([id, l]) => h('option', { value: id, text: l, selected: v.status === id }))),
      h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${v.title}`, onclick: () => { store.removeSetting(key); draw(); } }, '×')))) : h('p', { class: 'hint', text: 'Your reading list is empty. Add a title or paste a link to save for later.' }));
  }
  body.append(h('section', { class: 'panel' }, h('h2', { text: 'Reading list' }), form, msg, chips, list));
  draw();
}

// ======================= CHECKLIST =======================
function checklist(ctx, body) {
  const { store, learn } = ctx;
  const input = h('input', { type: 'text', placeholder: 'Add something to learn or practise…', 'aria-label': 'New checklist item', maxlength: '120' });
  const list = h('div', {});
  const sugg = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Suggestions' });
  const add = (t) => { if (store.settingEntries('cl:').some(([, v]) => v.t === t)) return; store.setSetting(`cl:${uid()}`, { t, done: false }); draw(); };
  const form = h('form', { class: 'inline-form', onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) add(t); input.value = ''; } }, input, h('button', { type: 'submit', class: 'btn sm', text: 'Add' }));
  function draw() {
    const items = store.settingEntries('cl:');
    const done = items.filter(([, v]) => v.done).length;
    sugg.replaceChildren(...learn.checklistStarters.filter((s) => !items.some(([, v]) => v.t === s)).map((s) => h('button', { type: 'button', class: 'chip', onclick: () => add(s) }, `+ ${s}`)));
    list.replaceChildren(
      items.length ? h('p', { class: 'hint', text: `${done} of ${items.length} done` }) : h('p', { class: 'hint', text: 'Nothing yet. Add your own items or tap a suggestion.' }),
      h('ul', { class: 'todo' }, items.map(([key, v]) => h('li', {},
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!v.done, onchange: (e) => { store.setSetting(key, { ...v, done: e.target.checked }); draw(); } }), h('span', { class: v.done ? 'done' : '', text: v.t })),
        h('button', { type: 'button', class: 'x', 'aria-label': `Delete ${v.t}`, onclick: () => { store.removeSetting(key); draw(); } }, '×')))),
      done ? h('button', { type: 'button', class: 'btn sm', onclick: () => { items.filter(([, v]) => v.done).forEach(([k]) => store.removeSetting(k)); draw(); } }, 'Clear completed') : null);
  }
  body.append(h('section', { class: 'panel' }, h('h2', { text: 'Learning checklist' }), form, sugg, list));
  draw();
}

// ======================= FOCUS TIMER =======================
function focus(ctx, body) {
  const timer = createTimer({ storage: ctx.storage, key: 'mi.focus.v1' });
  const display = h('div', { class: 'timer-display', role: 'timer', 'aria-label': 'Time remaining' });
  const msg = h('p', { class: 'hint', 'aria-live': 'polite' });
  const controls = h('div', { class: 'row-btns' });
  const custom = h('input', { type: 'number', min: '1', max: '180', value: '25', 'aria-label': 'Minutes', class: 'num-in' });
  const presets = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Length' }, [10, 15, 25, 45].map((m) => h('button', { type: 'button', class: 'chip', onclick: () => { custom.value = String(m); } }, `${m} min`)));
  const origTitle = document.title;
  let iv = null;

  function draw() {
    const s = timer.status();
    display.textContent = s.state === 'idle' || s.state === 'idle-done' ? formatClock((Number(custom.value) || 25) * 60000) : formatClock(s.remainingMs);
    controls.replaceChildren();
    if (s.state === 'running') {
      document.title = `${formatClock(s.remainingMs)} · Focus`;
      controls.append(h('button', { type: 'button', class: 'btn', onclick: () => { timer.pause(); draw(); } }, 'Pause'), h('button', { type: 'button', class: 'btn', onclick: () => { timer.reset(); document.title = origTitle; msg.textContent = ''; draw(); } }, 'Stop'));
      msg.textContent = 'Focus on one thing. Everything else can wait.';
    } else if (s.state === 'paused') {
      controls.append(h('button', { type: 'button', class: 'btn primary', onclick: () => { timer.resume(); draw(); } }, 'Resume'), h('button', { type: 'button', class: 'btn', onclick: () => { timer.reset(); document.title = origTitle; draw(); } }, 'Reset'));
      msg.textContent = 'Paused.';
    } else if (s.state === 'done') {
      timer.acknowledge(); document.title = origTitle;
      msg.textContent = 'Time’s up. Well done. Stretch, drink some water and rest your eyes for a few minutes.';
      controls.append(h('button', { type: 'button', class: 'btn primary', onclick: () => { timer.start(Number(custom.value) || 25); draw(); } }, 'Start another'));
    } else {
      controls.append(h('button', { type: 'button', class: 'btn primary', onclick: () => { const m = Math.min(180, Math.max(1, Number(custom.value) || 25)); timer.start(m); msg.textContent = ''; draw(); } }, 'Start'));
      if (s.state === 'idle') msg.textContent = msg.textContent.startsWith('Time') ? msg.textContent : 'Pick a length and start. A gentle message appears when time is up: no sound, no streaks.';
    }
  }
  iv = setInterval(draw, 1000);
  document.addEventListener('visibilitychange', draw);
  custom.addEventListener('input', () => { if (timer.status().state === 'idle' || timer.status().state === 'idle-done') draw(); });
  body.append(h('section', { class: 'panel focus' }, h('h2', { text: 'Focus timer' }), display, presets, h('label', { for: 'focus-min', class: 'sr', text: 'Minutes' }), h('div', { class: 'inline-form' }, custom, h('span', { text: 'minutes' })), controls, msg));
  custom.id = 'focus-min';
  draw();
  return () => { clearInterval(iv); document.removeEventListener('visibilitychange', draw); document.title = origTitle; };
}
