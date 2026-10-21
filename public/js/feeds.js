// Fetches every enabled source through the proxy, tracks per-source health,
// keeps a small cache so the app opens instantly, and never lets one broken
// feed affect the others.
import { pool } from './api.js';
import { buildTimeline } from './timeline.js';

const CACHE_KEY = 'mi.cache.v1';
const FRESH_MS = 10 * 60 * 1000;
const KEEP_PER_SOURCE = 30;

export function createFeeds({ store, api, storage }) {
  const results = new Map();  // sid -> {items, fetchedAt, feed}
  const status = new Map();   // sid -> {state:'loading'|'ok'|'error', message, code, at, count, stale, discovered}
  const listeners = new Set();
  let loading = false;
  let timer = null;
  const inflight = new Map(); // sid -> Promise, so one source is never fetched twice at once

  const emit = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; listeners.forEach((fn) => fn()); }, 120);
  };

  function loadCache() {
    try {
      const raw = storage && storage.getItem(CACHE_KEY);
      if (!raw) return;
      for (const [sid, v] of Object.entries(JSON.parse(raw))) {
        if (v && Array.isArray(v.items)) results.set(sid, v);
      }
    } catch { /* ignore a corrupt cache */ }
  }

  function saveCache() {
    if (!storage) return;
    const live = new Set(store.sources().map((s) => s.id));
    const out = {};
    for (const [sid, v] of results) {
      if (!live.has(sid)) continue;
      out[sid] = {
        fetchedAt: v.fetchedAt,
        feed: v.feed && { title: v.feed.title, siteUrl: v.feed.siteUrl },
        items: v.items.slice(0, KEEP_PER_SOURCE).map((it) => ({ ...it, summary: (it.summary || '').slice(0, 220) })),
      };
    }
    try { storage.setItem(CACHE_KEY, JSON.stringify(out)); }
    catch { try { storage.removeItem(CACHE_KEY); } catch { /* quota: run without a cache */ } }
  }

  function refreshOne(src, force) {
    if (inflight.has(src.id)) return inflight.get(src.id);
    const p = doRefresh(src, force).finally(() => inflight.delete(src.id));
    inflight.set(src.id, p);
    return p;
  }

  async function doRefresh(src, force) {
    const cached = results.get(src.id);
    if (!force && cached && Date.now() - cached.fetchedAt < FRESH_MS) {
      status.set(src.id, { state: 'ok', at: cached.fetchedAt, count: cached.items.length });
      return;
    }
    status.set(src.id, { ...(status.get(src.id) || {}), state: 'loading' });
    emit();
    try {
      const r = await api.fetchFeed(src.url);
      results.set(src.id, { items: r.items, fetchedAt: Date.now(), feed: r.feed });
      status.set(src.id, { state: 'ok', at: Date.now(), count: r.items.length });
    } catch (e) {
      status.set(src.id, {
        state: 'error', code: e.code, message: e.message || 'Could not load this feed.',
        discovered: e.discovered, at: Date.now(), stale: !!cached, count: cached ? cached.items.length : 0,
      });
    }
    emit();
  }

  return {
    results, status,
    get loading() { return loading; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    loadCache,
    async refresh({ force = false, only = null } = {}) {
      const sources = store.sources().filter((s) => s.on && (!only || only.includes(s.id)));
      if (!sources.length) { emit(); return; }
      loading = true;
      sources.forEach((s) => { if (!status.has(s.id)) status.set(s.id, { state: 'loading' }); });
      emit();
      await pool(sources.map((s) => () => refreshOne(s, force)), 6);
      loading = false;
      saveCache();
      emit();
    },
    timeline() {
      const enabled = store.sources().filter((s) => s.on);
      return buildTimeline(results, enabled);
    },
    summary() {
      const enabled = store.sources().filter((s) => s.on);
      let ok = 0; let failed = 0; let pending = 0;
      for (const s of enabled) {
        const st = status.get(s.id);
        if (!st || st.state === 'loading') pending++;
        else if (st.state === 'error') failed++;
        else ok++;
      }
      return { total: enabled.length, ok, failed, pending };
    },
    lastUpdated() {
      let t = 0;
      for (const v of results.values()) t = Math.max(t, v.fetchedAt || 0);
      return t || null;
    },
  };
}
