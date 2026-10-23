import { h } from '../util.js';
import { loadFeedGroup } from '../hub/feedgroup.js';
import { classifyJob, matchesPrefs, normalisePrefs, parseKeywords, FIELDS } from '../hub/jobs.js';
import { createJobWatch } from '../hub/jobwatch.js';
import { fetchFeed, pool } from '../api.js';
import { articleCard } from './card.js';
import { badge, fmtTime } from './hubui.js';

const PREF_KEY = 'jobprefs';
const SEEN_KEY = 'jobseen';
const CACHE_KEY = 'mi.jobs.v1';
const SECTORS = [['any', 'Any'], ['govt', 'Government'], ['private', 'Non-government']];
const VIEWS = [['mine', 'My matches'], ['all', 'All circulars'], ['news', 'Job-related news']];

// Newspaper feeds from the catalog plus any feed you add under Sources with category "Jobs".
export function jobSources(ctx) {
  const mine = ctx.store.sources().filter((s) => s.cat === 'jobs' && s.on).map((s) => ({ name: s.name, url: s.url, cat: 'jobs' }));
  const seen = new Set(mine.map((s) => s.url));
  return [...ctx.catalog.sources.filter((s) => s.cat === 'bangladesh' && !seen.has(s.url)), ...mine];
}
export const getPrefs = (store) => normalisePrefs(store.setting(PREF_KEY, null));

// ---- notifications while the app is open ------------------------------------
export function createJobNotifier(ctx) {
  const supported = typeof Notification !== 'undefined';
  const watch = createJobWatch({
    storage: ctx.storage,
    getPrefs: () => getPrefs(ctx.store),
    load: async () => (await loadFeedGroup({ key: CACHE_KEY, sources: jobSources(ctx), fetchFeed, pool, storage: ctx.storage })).items,
    notify: (title, opts) => {
      try {
        const n = new Notification(title, opts);
        n.onclick = () => { window.focus(); if (opts.data && opts.data.url) window.open(opts.data.url, '_blank', 'noopener,noreferrer'); n.close(); };
      } catch { /* some browsers only allow notifications via a service worker */ }
    },
  });
  return {
    supported,
    permission: () => (supported ? Notification.permission : 'unsupported'),
    sync() {
      if (supported && Notification.permission === 'granted' && getPrefs(ctx.store).notify) watch.start(); else watch.stop();
    },
  };
}

export function renderJobs(ctx, root) {
  const { store } = ctx;
  let prefs = getPrefs(store);
  let view = 'mine'; let shown = 10; let data = null;
  const seenAt = Number(store.setting(SEEN_KEY, 0)) || 0;
  if (!seenAt) store.setSetting(SEEN_KEY, Date.now()); // first visit: nothing is "new" yet
  const sources = jobSources(ctx);

  const prefBox = h('section', { class: 'panel' });
  const status = h('div', { class: 'panel' });
  const tabs = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' });
  const list = h('div', {});
  root.append(
    h('h1', { class: 'page-title', text: 'Jobs in Bangladesh' }),
    h('p', { class: 'lede', text: 'Job circulars and hiring news found in publisher feeds, filtered by what you choose. Whether an item is “government” or in a field is a keyword guess, so always open the original notice and check the deadline and how to apply.' }),
    prefBox, status, tabs, list);

  function save(next) {
    prefs = normalisePrefs(next);
    store.setSetting(PREF_KEY, JSON.stringify(prefs));
    drawPrefs(); drawList();
    ctx.jobNotifier.sync();
  }

  function drawPrefs() {
    const chip = (label, on, fn) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(on), onclick: fn }, label);
    const kw = h('input', { type: 'text', value: prefs.keywords.join(', '), placeholder: 'e.g. teacher, accountant, শিক্ষক', 'aria-label': 'Keywords' });
    const note = h('p', { class: 'hint' });
    const notify = h('input', { type: 'checkbox', id: 'job-notify' });
    notify.checked = prefs.notify && ctx.jobNotifier.permission() === 'granted';
    notify.addEventListener('change', async () => {
      if (!notify.checked) { save({ ...prefs, notify: false }); return; }
      if (!ctx.jobNotifier.supported) { notify.checked = false; note.textContent = 'This browser does not support notifications.'; return; }
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') { notify.checked = false; note.textContent = 'Notifications are blocked for this site. Allow them in your browser’s site settings, then tick again.'; return; }
      save({ ...prefs, notify: true });
    });
    prefBox.replaceChildren(
      h('h2', { text: 'My preferences' }),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Sector' }),
        h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Sector' }, SECTORS.map(([id, label]) => chip(label, prefs.sector === id, () => save({ ...prefs, sector: id }))))),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Fields (pick any, or none for everything)' }),
        h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'Fields' }, FIELDS.map((f) => chip(f.name, prefs.fields.includes(f.id), () => save({ ...prefs, fields: prefs.fields.includes(f.id) ? prefs.fields.filter((x) => x !== f.id) : [...prefs.fields, f.id] }))))),
      h('div', { class: 'field' }, h('label', { for: 'job-kw', class: 'lbl', text: 'Keywords (comma separated, English or Bangla)' }),
        h('div', { class: 'inline-form' }, Object.assign(kw, { id: 'job-kw' }), h('button', { type: 'button', class: 'btn', onclick: () => save({ ...prefs, keywords: parseKeywords(kw.value) }) }, 'Save keywords'))),
      h('label', { class: 'check', for: 'job-notify' }, notify, ' Notify me in this browser when a new matching circular appears'),
      h('p', { class: 'hint', text: 'Notifications only arrive while My Internet is open in a browser tab. Nothing is sent when the app is closed.' }),
      note);
  }

  function drawStatus() {
    status.replaceChildren();
    if (!data) { status.append(h('p', { class: 'hint', text: 'Looking through job feeds…' }), h('div', { class: 'skeleton' })); return; }
    const mineCount = sources.filter((s) => s.cat === 'jobs').length;
    status.append(...[
      h('div', { class: 'panel-head' }, h('h2', { text: 'Sources' }), h('button', { type: 'button', class: 'btn sm', onclick: load }, 'Refresh')),
      h('div', { class: 'badges' }, data.live ? badge('live', `Live: ${data.live} of ${sources.length}`) : '', data.cached ? badge('cached', `Cached snapshot: ${data.cached}`) : '', data.failed ? badge('bad', `Unavailable: ${data.failed}`) : ''),
      data.cached ? h('p', { class: 'hint warn-text', text: 'Some items come from an older snapshot and are marked “Cached”. Their deadlines may have passed.' }) : '',
      h('p', { class: 'hint' }, `Searching ${sources.length - mineCount} newspaper feeds${mineCount ? ` and ${mineCount} job feed${mineCount > 1 ? 's' : ''} you added` : ''}. Most Bangladeshi job sites do not offer a public feed, so this will miss circulars that are only on those sites. Found a site with an RSS feed? `, h('a', { href: '#/sources', text: 'Add it under Sources' }), ' with the category “Jobs”.'),
    ].filter(Boolean));
  }

  function drawTabs() {
    tabs.replaceChildren(...VIEWS.map(([id, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(view === id), onclick: () => { view = id; shown = 10; drawTabs(); drawList(); } }, label)));
  }

  function drawList() {
    list.replaceChildren();
    if (!data) return;
    const all = data.items.map((it) => ({ it, cls: classifyJob(it) }));
    const rows = all.filter(({ it, cls }) => (view === 'mine' ? matchesPrefs(it, prefs, cls) : view === 'all' ? cls.circular : cls.jobish && !cls.circular));
    const fresh = rows.filter(({ it }) => it.published && Date.parse(it.published) > seenAt).length;
    if (view === 'mine') list.append(h('div', { class: 'panel-head' },
      h('p', { class: 'hint', text: fresh ? `${fresh} new since your last visit.` : 'Nothing new since your last visit.' }),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { store.setSetting(SEEN_KEY, Date.now()); ctx.toast('Marked as seen'); } }, 'Mark all as seen')));
    if (!rows.length) {
      list.append(h('div', { class: 'empty' }, h('h2', { text: data.items.length ? 'No matching job items right now' : 'Nothing to show right now' }),
        h('p', { text: data.items.length ? 'Try “All circulars”, loosen your preferences, or check the official sites below. Nothing is invented here.' : 'The feeds could not be reached and no saved snapshot exists yet.' }),
        h('button', { type: 'button', class: 'btn primary', onclick: load }, 'Try again')));
      return;
    }
    rows.slice(0, shown).forEach(({ it, cls }) => {
      const tags = [
        it.published && Date.parse(it.published) > seenAt ? h('span', { class: 'badge live', text: 'New' }) : '',
        cls.sector !== 'unknown' ? h('span', { class: 'badge static', title: 'Guessed from keywords in the title or summary', text: cls.sector === 'govt' ? 'Looks like government' : 'Looks non-government' }) : '',
        ...cls.fields.slice(0, 3).map((f) => h('span', { class: 'badge static', text: FIELDS.find((x) => x.id === f).name })),
      ].filter(Boolean);
      list.append(h('div', { class: 'job-item' }, tags.length ? h('div', { class: 'badges' }, ...tags) : '', articleCard(ctx, { ...it, cat: 'jobs', badge: it.freshness === 'cached' ? `Cached ${fmtTime(it.freshAt)}` : '' })));
    });
    if (rows.length > shown) list.append(h('div', { class: 'more' }, h('button', { type: 'button', class: 'btn', onclick: () => { shown += 10; drawList(); } }, `Show more (${rows.length - shown} left)`)));
  }

  const official = ctx.bd.services.filter((s) => (ctx.bd.newsLinks.jobs || []).includes(s.name));
  const officialBox = h('section', { class: 'panel' }, h('h2', { text: 'Official sites' }),
    h('p', { class: 'hint', text: 'Check these directly for circulars and how to apply.' }),
    h('ul', { class: 'plain' }, official.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name }), ` — ${s.desc}`))));

  async function load() {
    data = null; drawStatus(); drawList();
    data = await loadFeedGroup({ key: CACHE_KEY, sources, fetchFeed, pool, storage: ctx.storage });
    drawStatus(); drawList();
  }
  drawPrefs(); drawTabs(); load();
  root.append(officialBox);
  return undefined;
}
