import { recordVisit } from './engage.js';
import { h, sourceId, debounce } from './util.js';
import { createStore } from './state.js';
import * as api from './api.js';
import { createFeeds } from './feeds.js';
import { createSync } from './sync.js';
import { renderFeed } from './views/feed.js';
import { renderSaved } from './views/saved.js';
import { renderSources } from './views/sources.js';
import { renderDiscover } from './views/discover.js';
import { renderHome } from './views/home.js';
import { renderEntertainment } from './views/entertainment.js';
import { renderBangladesh } from './views/bangladesh.js';
import { renderJobs, createJobNotifier } from './views/jobs.js';
import { renderAI } from './views/ai.js';
import { renderNovel } from './views/novel.js';
import { renderLearn } from './views/learn.js';
import { createSession } from './hub/session.js';

// ---------- storage (works even if the browser blocks it) ----------
function safeStorage() {
  try {
    const k = '__mi_test__';
    localStorage.setItem(k, '1'); localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), memory: true };
  }
}

const storage = safeStorage();
const store = createStore({ storage });
const feeds = createFeeds({ store, api, storage });
const $main = document.getElementById('main');

const ctx = {
  store, feeds, storage, catalog: { categories: [], sources: [], sites: [], topics: [] }, countries: [],
  fun: null, learn: null, bd: null, openSession() {},
  query: '', syncEnabled: false, onQuery: null, runSurprise: null,
  toast(message, { kind = 'info' } = {}) {
    const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
    document.getElementById('toasts').append(el);
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 2600);
  },
  catName(id) {
    const c = ctx.catalog.categories.find((x) => x.id === id);
    return c ? c.name : (id || '');
  },
  allCategories() {
    const out = [...ctx.catalog.categories];
    const known = new Set(out.map((c) => c.id));
    for (const s of store.sources()) {
      if (s.cat && !known.has(s.cat)) { known.add(s.cat); out.push({ id: s.cat, name: s.cat }); }
    }
    return out;
  },
  activeCategories() {
    const on = new Set(store.sources().filter((s) => s.on).map((s) => s.cat));
    return ctx.allCategories().filter((c) => on.has(c.id));
  },
  searchFor(term) {
    const q = document.getElementById('q');
    q.value = term; ctx.query = term;
    location.hash = '#/feed';
    if (ctx.onQuery) ctx.onQuery();
  },
};

// ---------- theme ----------
const THEMES = ['system', 'light', 'dark'];
function currentTheme() { try { return JSON.parse(storage.getItem('mi.theme') || '"system"'); } catch { return 'system'; } }
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const btn = document.getElementById('btn-theme');
  const label = { system: 'Theme: match device', light: 'Theme: light', dark: 'Theme: dark' }[t];
  btn.title = label; btn.setAttribute('aria-label', label);
  btn.textContent = { system: '🌓', light: '☀️', dark: '🌙' }[t];
}
document.getElementById('btn-theme').addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  try { storage.setItem('mi.theme', JSON.stringify(next)); } catch { /* ignore */ }
  applyTheme(next);
});
applyTheme(currentTheme());

// ---------- sync (optional) ----------
let sync = null;
let syncStatus = { state: 'off' };
let initDone = false;
let authGate = false;

function maybeInitStarter() {
  if (initDone) return;
  initDone = true;
  if (!store.setting('init', false) && !store.sources().length) {
    for (const s of ctx.catalog.sources.filter((x) => x.starter)) {
      store.upsertSource(sourceId(s.url), { url: s.url, name: s.name, cat: s.cat, on: 1, kind: 'catalog' });
    }
  }
  store.setSetting('init', true);
}

function renderAccount() {
  const dlg = document.getElementById('account');
  const st = syncStatus;
  const body = [h('h2', { text: 'Account & sync' })];
  if (!ctx.syncEnabled) {
    body.push(h('p', { text: 'Sync is off. Your sources, bookmarks, notes and read status are saved in this browser only.' }),
      h('p', { class: 'hint', text: 'To sync across devices, add your Firebase settings as environment variables — see the README (“Optional: Firebase sync”).' }));
  } else if (st.user) {
    body.push(h('p', {}, 'Signed in as ', h('strong', { text: st.user.email || st.user.displayName || 'your account' }), '.'),
      h('p', { class: 'hint', text: { synced: 'Everything is synced.', syncing: 'Syncing…', error: st.detail || 'Sync problem.' }[st.state] || '' }),
      h('button', { class: 'btn', type: 'button', onclick: async () => { await sync.signOut(); dlg.close(); } }, 'Sign out'));
  } else {
    body.push(h('p', { text: 'Sign in with Google to keep your sources, bookmarks and notes in sync across devices. Local data is merged, never overwritten.' }),
      st.state === 'error' ? h('p', { class: 'err', text: st.detail }) : null,
      h('button', { class: 'btn primary', type: 'button', onclick: () => sync.signIn() }, 'Sign in with Google'));
  }
  body.push(h('form', { method: 'dialog', class: 'dlg-close' }, h('button', { class: 'btn', text: 'Close' })));
  dlg.replaceChildren(...body.filter(Boolean));
}
document.getElementById('btn-account').addEventListener('click', () => {
  renderAccount();
  const dlg = document.getElementById('account');
  if (!dlg.open) dlg.showModal();
});

function onSyncStatus(s) {
  syncStatus = s;
  const dot = document.getElementById('sync-dot');
  dot.hidden = !s.user;
  dot.dataset.state = s.state;
  if (document.getElementById('account').open) renderAccount();
  const first = ['signed-out', 'synced', 'error'].includes(s.state);
  if (first && !initDone) { maybeInitStarter(); if (!authGate) route(); startFeeds(); }
  if (authGate && s.user) { authGate = false; route(); startFeeds(); }
  if (s.state === 'signed-out' && ctx.authRequired) { authGate = true; route(); }
  if (s.state === 'error' && s.detail) ctx.toast(s.detail, { kind: 'error' });
}

// ---------- routing ----------
let cleanup = null;
const VIEWS = { home: renderHome, feed: renderFeed, bangladesh: renderBangladesh, entertainment: renderEntertainment, learn: renderLearn, ai: renderAI, jobs: renderJobs, novel: renderNovel, discover: renderDiscover, saved: renderSaved, sources: renderSources };
const TITLES = { home: 'Home', feed: 'Feed', bangladesh: 'Bangladesh', entertainment: 'Entertainment', learn: 'Learn', ai: 'AI', jobs: 'Jobs', novel: 'Novels', discover: 'Discover', saved: 'Saved', sources: 'Sources' };
const MORE_ROUTES = ['jobs', 'ai', 'novel', 'discover', 'saved', 'sources'];
let pendingSurprise = false;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = VIEWS[parts[0]] ? parts[0] : 'home';
  return { name, arg: parts[1] };
}

function renderGate() {
  $main.replaceChildren(h('div', { class: 'empty gate' },
    h('h1', { text: 'Please sign in' }),
    h('p', { text: ctx.syncEnabled ? 'This deployment is private. Sign in with an allowed Google account to continue.' : 'This deployment requires sign-in, but Firebase is not configured. Set the FIREBASE_* variables (see the README).' }),
    ctx.syncEnabled ? h('button', { class: 'btn primary', type: 'button', onclick: () => sync.signIn() }, 'Sign in with Google') : null));
}

function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  $main.replaceChildren();
  if (authGate) { renderGate(); return; }
  const { name, arg } = parseHash();
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.getElementById('btn-more').classList.toggle('current', MORE_ROUTES.includes(name));
  document.title = `${TITLES[name]} · My Internet`;
  document.querySelector('.search').classList.toggle('dim', name !== 'feed' && name !== 'saved');
  cleanup = VIEWS[name](ctx, $main, { cat: arg || 'all', arg });
  window.scrollTo(0, 0);
  if (pendingSurprise && name === 'discover' && ctx.runSurprise) { pendingSurprise = false; ctx.runSurprise(); }
}
window.addEventListener('hashchange', route);

// ---------- header controls ----------
const qEl = document.getElementById('q');
document.querySelector('.search').addEventListener('submit', (e) => e.preventDefault());
const applyQuery = debounce(() => {
  ctx.query = qEl.value.trim();
  const { name } = parseHash();
  if (name === 'feed' || name === 'saved') { if (ctx.onQuery) ctx.onQuery(); }
  else if (ctx.query) location.hash = '#/feed';
}, 160);
qEl.addEventListener('input', applyQuery);
qEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { qEl.value = ''; applyQuery.flush(); qEl.blur(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); qEl.focus(); }
});

document.getElementById('btn-refresh').addEventListener('click', () => {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spin');
  feeds.refresh({ force: true }).finally(() => btn.classList.remove('spin'));
  ctx.toast('Refreshing…');
});
document.getElementById('btn-surprise').addEventListener('click', () => {
  if (parseHash().name === 'discover' && ctx.runSurprise) ctx.runSurprise();
  else { pendingSurprise = true; location.hash = '#/discover'; }
});

// ---------- session reminder + "More" menu ----------
const session = createSession({ storage, toast: (m) => ctx.toast(m) });
ctx.openSession = () => session.open();
ctx.jobNotifier = createJobNotifier(ctx);
document.getElementById('btn-more').addEventListener('click', () => {
  const dlg = document.getElementById('more-dialog');
  dlg.replaceChildren(h('h2', { text: 'More' }),
    h('ul', { class: 'plain more-links' }, [['#/jobs', '💼 Jobs', 'Bangladesh job circulars by your preferences'], ['#/ai', '🤖 AI', 'AI news, explained simply'], ['#/novel', '📖 Novels', 'Bangla and world classics'], ['#/discover', '🧭 Discover', 'Surprise me, random country, unknown topics'], ['#/saved', '🔖 Saved', 'Bookmarks, favourites and notes'], ['#/sources', '⚙️ Sources', 'Add, remove and manage your feeds']].map(([href, label, desc]) =>
      h('li', {}, h('a', { href, onclick: () => dlg.close() }, label), h('span', { class: 'host', text: ` ${desc}` })))),
    h('form', { method: 'dialog', class: 'dlg-close' }, h('button', { class: 'btn', text: 'Close' })));
  dlg.showModal();
});

// ---------- boot ----------
let feedsStarted = false;
function startFeeds() {
  if (feedsStarted || authGate) return;
  feedsStarted = true;
  feeds.refresh();
  ctx.jobNotifier.sync();
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) feeds.refresh();
  });
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  try {
    [ctx.catalog, ctx.countries, ctx.bd, ctx.fun, ctx.learn, ctx.ai, ctx.novels] = await Promise.all([
      getJSON('/data/catalog.json'), getJSON('/data/countries.json').then((d) => d.countries),
      getJSON('/data/bd.json'), getJSON('/data/fun.json'), getJSON('/data/learn.json'), getJSON('/data/ai.json'), getJSON('/data/novels.json'),
    ]);
  } catch (e) {
    $main.replaceChildren(h('div', { class: 'empty' }, h('h1', { text: 'Couldn’t start' }), h('p', { text: 'The app’s data files failed to load. Check your connection and reload.' })));
    return;
  }
  if (storage.memory) ctx.toast('Your browser is blocking storage, so changes won’t be remembered after you close this tab.', { kind: 'error' });
  feeds.loadCache();
  recordVisit().then((n) => {
    const el = document.getElementById('visits');
    if (el && n !== null) { el.textContent = `· ${n.toLocaleString()} total visits`; el.hidden = false; }
  });

  let config = { firebase: null, authRequired: false };
  try { config = await api.getConfig(); } catch { /* local mode */ }
  ctx.authRequired = !!config.authRequired;
  ctx.syncEnabled = !!config.firebase;

  if (ctx.syncEnabled) {
    sync = createSync({ store, config: config.firebase, onStatus: onSyncStatus });
    if (ctx.authRequired) api.setAuthProvider(() => sync.getToken());
    authGate = ctx.authRequired;
    route();
    sync.init();
    return;
  }
  if (ctx.authRequired) { authGate = true; route(); return; }
  maybeInitStarter();
  route();
  startFeeds();
}

store.subscribe((ns) => { if (ns === 'sources' && feedsStarted) feeds.refresh(); });
boot();
