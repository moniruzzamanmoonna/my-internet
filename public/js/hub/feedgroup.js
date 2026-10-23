// Loads a small group of feeds (Bangladesh news, science & tech picks) for a hub page.
// Honest about freshness: every item is tagged "live" (fetched just now) or "cached"
// (an older snapshot kept in this browser because the fetch failed). It never presents
// a cached snapshot as live, and never invents items. DOM-free.
import { buildTimeline } from '../timeline.js';
import { sourceId } from '../util.js';

function readCache(storage, key) {
  try { return JSON.parse(storage.getItem(key) || '{}') || {}; } catch { return {}; }
}

export async function loadFeedGroup({ key, sources, fetchFeed, pool, storage, now = Date.now }) {
  const cache = readCache(storage, key);
  const per = [];
  const results = new Map();
  const stamps = new Map();

  await pool(sources.map((src) => async () => {
    const sid = sourceId(src.url);
    try {
      const r = await fetchFeed(src.url);
      const items = r.items.slice(0, 25).map((it) => ({ ...it, summary: (it.summary || '').slice(0, 260) }));
      cache[sid] = { at: now(), items };
      results.set(sid, { items });
      stamps.set(sid, { state: 'live', at: cache[sid].at });
      per.push({ src, state: 'live', at: cache[sid].at, count: items.length });
    } catch (e) {
      const c = cache[sid];
      if (c && Array.isArray(c.items) && c.items.length) {
        results.set(sid, { items: c.items });
        stamps.set(sid, { state: 'cached', at: c.at });
        per.push({ src, state: 'cached', at: c.at, count: c.items.length, error: e.message });
      } else {
        per.push({ src, state: 'failed', error: (e && e.message) || 'Could not load.' });
      }
    }
  }), 4);

  try { storage.setItem(key, JSON.stringify(cache)); } catch { /* quota/blocked: no snapshot kept */ }

  const timeline = buildTimeline(results, sources.map((s) => ({ id: sourceId(s.url), name: s.name, cat: s.cat })));
  const items = timeline.map((it) => ({ ...it, freshness: stamps.get(it.sid).state, freshAt: stamps.get(it.sid).at }));
  return {
    items, per,
    live: per.filter((p) => p.state === 'live').length,
    cached: per.filter((p) => p.state === 'cached').length,
    failed: per.filter((p) => p.state === 'failed').length,
  };
}
