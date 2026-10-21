// Turns per-source feed results into one chronological timeline. DOM-free.
import { normTitle } from './util.js';

// results: Map(sourceId -> {items:[...]}); sources: [{id,name,cat,on}] in display order.
// De-duplicates by article id and by identical normalised title (syndicated copies).
export function buildTimeline(results, sources) {
  const byId = new Map();
  const byTitle = new Map();
  for (const src of sources) {
    const res = results.get(src.id);
    if (!res || !res.items) continue;
    for (const it of res.items) {
      const item = { ...it, sid: src.id, sname: src.name, cat: src.cat };
      if (byId.has(item.id)) continue;
      const nt = normTitle(item.title);
      if (nt.length >= 25 && byTitle.has(nt)) {
        const prev = byTitle.get(nt);
        if (!prev.image && item.image) prev.image = item.image; // keep the richer copy
        continue;
      }
      byId.set(item.id, item);
      if (nt.length >= 25) byTitle.set(nt, item);
    }
  }
  return [...byId.values()].sort(compareChrono);
}

// Newest first. Undated items go last. Ties are broken by title so order is stable.
export function compareChrono(a, b) {
  const ta = a.published ? Date.parse(a.published) : -Infinity;
  const tb = b.published ? Date.parse(b.published) : -Infinity;
  if (ta !== tb) return tb > ta ? 1 : -1;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

export function matchesQuery(item, q, note = '') {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [item.title, item.summary, item.sname, item.author, (item.categories || []).join(' '), note]
    .join(' \n ').toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function filterItems(items, { cat = 'all', q = '', unreadOnly = false, isRead = () => false, getNote = () => '' } = {}) {
  return items.filter((it) => {
    if (cat !== 'all' && it.cat !== cat) return false;
    if (unreadOnly && isRead(it.id)) return false;
    return matchesQuery(it, q, getNote(it.id));
  });
}

export function groupByDay(items, labelFn) {
  const groups = [];
  let cur = null;
  for (const it of items) {
    const label = labelFn(it.published);
    if (!cur || cur.label !== label) { cur = { label, items: [] }; groups.push(cur); }
    cur.items.push(it);
  }
  return groups;
}
