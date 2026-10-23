import { h, pick, shuffle } from '../util.js';
import { dayKeyOf, pickForDay } from '../hub/daily.js';
import { wikiRandom } from '../api.js';
import { hubCard, moreList, tabBar, badge, riddleCard, renderBored, wikiCard, isHidden } from './hubui.js';

const TABS = [['mix', 'Mix'], ['music', 'Music'], ['movies', 'Movies'], ['docs', 'Documentaries'], ['listen', 'Podcasts & video'], ['facts', 'Facts & riddles'], ['wiki', 'Wikipedia']];

export function renderEntertainment(ctx, root, { arg } = {}) {
  const { fun, store } = ctx;
  const tab = TABS.some(([id]) => id === arg) ? arg : 'mix';
  const items = fun.items;
  const byType = {
    music: items.filter((i) => i.type === 'song'),
    movies: items.filter((i) => i.type === 'movie'),
    docs: items.filter((i) => i.type === 'documentary' || i.id.startsWith('doc-')),
    listen: items.filter((i) => i.type === 'podcast' || (i.type === 'video' && !i.id.startsWith('doc-'))),
  };

  root.append(
    h('h1', { class: 'page-title', text: 'Entertainment' }),
    h('p', { class: 'lede', text: 'A small, hand-picked selection. Everything opens on the original site in a new tab: nothing autoplays here.' }),
    tabBar(TABS, tab, (id) => (id === 'mix' ? '#/entertainment' : `#/entertainment/${id}`)));

  const body = h('div', {});
  root.append(body);

  // ---------- Mix: I'm bored + mood picks ----------
  if (tab === 'mix') {
    const boredOut = h('div', { class: 'bored-out' });
    body.append(h('section', { class: 'panel' },
      h('button', { type: 'button', class: 'btn primary big', onclick: () => renderBored(ctx, boredOut, fun) }, '🎲 I’m bored'),
      h('p', { class: 'hint', text: 'Picks one thing at random: a song, a film, a fact, a riddle or a Wikipedia article.' }),
      boredOut));

    const picksOut = h('div', {});
    let mood = null;
    const moodBtns = h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Mood' });
    function drawPicks() {
      picksOut.replaceChildren();
      if (!mood) return;
      const pool = [
        ...items.filter((i) => i.moods.includes(mood)).map((e) => ({ e })),
        ...(mood === 'playful' ? fun.riddles.map((r) => ({ riddle: r })) : []),
      ].filter((p) => p.riddle || !isHidden(store, p.e.id));
      const chosen = shuffle(pool).slice(0, 3);
      if (!chosen.length) { picksOut.append(h('p', { class: 'hint', text: 'Nothing left for this mood. Restore hidden items below a list to see more.' })); return; }
      chosen.forEach((p) => picksOut.append(p.riddle ? riddleCard(p.riddle) : hubCard(ctx, p.e, { onHide: drawPicks })));
      picksOut.append(h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn', onclick: drawPicks }, 'Three more for this mood')));
    }
    function drawMoods() {
      moodBtns.replaceChildren(...fun.moods.map((m) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(mood === m.id), onclick: () => { mood = mood === m.id ? null : m.id; drawMoods(); drawPicks(); } }, `${m.emoji} ${m.name}`)));
    }
    drawMoods();
    body.append(h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'How are you feeling?' }), badge('static', 'Curated')),
      h('p', { class: 'hint', text: 'Pick a mood to get three suggestions. They are chosen at random from a hand-tagged list, not predicted from your behaviour.' }),
      moodBtns, picksOut));
    return;
  }

  // ---------- list tabs ----------
  if (byType[tab]) {
    const intros = {
      music: 'Songs and genres from Bengal. “Find on YouTube” opens a search so the link never goes stale.',
      movies: 'Landmark Bengali films. Check which legal streaming or library options are available to you.',
      docs: 'Documentaries and topic searches about Bangladesh and its land.',
      listen: 'Podcasts and video channels for listening, learning and English practice. You can also add any podcast’s RSS feed under Sources.',
    };
    body.append(h('div', { class: 'panel-head' }, h('p', { class: 'hint', text: intros[tab] }), badge('static', 'Curated list')),
      moreList(ctx, byType[tab], (e) => hubCard(ctx, e)));
    return;
  }

  // ---------- facts & riddles ----------
  if (tab === 'facts') {
    const factOut = h('div', {});
    const riddleOut = h('div', {});
    const todayFact = pickForDay(fun.facts, dayKeyOf(), 'fact');
    let lastFact = todayFact;
    const showFact = (f) => { lastFact = f; factOut.replaceChildren(hubCard(ctx, { ...f, type: 'fact', title: 'Did you know?', blurb: f.t }, { typeLabel: 'Fact' })); };
    const showRiddle = (r) => riddleOut.replaceChildren(riddleCard(r));
    showFact(todayFact);
    showRiddle(pick(fun.riddles));
    body.append(
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', { text: 'A fact' }), badge('static', 'Curated')),
        factOut,
        h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn', onclick: () => { let f; do { f = pick(fun.facts); } while (fun.facts.length > 1 && f.id === lastFact.id); showFact(f); } }, 'Another fact'))),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', { text: 'A riddle · ধাঁধা' }), badge('static', 'Curated')),
        riddleOut,
        h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn', onclick: () => showRiddle(pick(fun.riddles)) }, 'Another riddle'))),
      h('p', { class: 'hint' }, 'Want a quiz? ', h('a', { href: '#/learn/quiz', text: 'Try a short quiz →' })));
    return;
  }

  // ---------- Wikipedia ----------
  if (tab === 'wiki') {
    const out = h('div', {});
    async function another() {
      out.replaceChildren(h('div', { class: 'skeleton' }));
      try {
        const r = await wikiRandom();
        out.replaceChildren(wikiCard(ctx, r.page));
      } catch (e) {
        out.replaceChildren(h('p', { class: 'hint err', text: `Couldn’t reach Wikipedia right now (${e.message || 'error'}).` }));
      }
    }
    body.append(h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'An interesting article' }), badge('live', 'Live from Wikipedia')),
      h('p', { class: 'hint', text: 'A random article from Wikipedia, skipping stubs and disambiguation pages. Want a specific topic? Use Discover.' }),
      out,
      h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn primary', onclick: another }, 'Show me one'), h('a', { class: 'btn', href: '#/discover', text: 'Go to Discover' }))));
  }
}
