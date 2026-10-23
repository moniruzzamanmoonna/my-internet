// Application state: four "namespaces", each a map of key -> record.
// Every record carries a timestamp `t`; removal is a tombstone {t, del:true}.
// That makes merging two devices a simple last-writer-wins per key, which is
// all Firebase sync needs. Works fully offline with localStorage only.
//
//   sources  : id  -> {t, url, name, cat, on, kind:'catalog'|'custom'}
//   library  : id  -> {t, bm:1|0, note:'', item:{...snapshot}}    (bookmarks + notes)
//   reads    : id  -> {t, c:categoryId}                           (present = read)
//   settings : key -> {t, v}

export const NAMESPACES = ['sources', 'library', 'reads', 'settings'];
export const STORAGE_KEY = 'mi.state.v1';
const TOMBSTONE_TTL = 45 * 864e5;
const MAX_READS = 4000;

export function emptyState() {
  return { sources: {}, library: {}, reads: {}, settings: {} };
}

export const isLive = (rec) => !!rec && !rec.del;

export function liveEntries(map) {
  return Object.entries(map || {}).filter(([, r]) => isLive(r));
}

// Merge two maps. Returns {map, changedLocal, changedRemote}:
//   changedLocal  = result differs from `local`  (remote had newer info)
//   changedRemote = result differs from `remote` (local had newer info)
export function mergeMaps(local = {}, remote = {}) {
  const map = {};
  let changedLocal = false;
  let changedRemote = false;
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[key];
    const b = remote[key];
    if (a && !b) { map[key] = a; changedRemote = true; }
    else if (b && !a) { map[key] = b; changedLocal = true; }
    else if ((b.t || 0) > (a.t || 0)) { map[key] = b; changedLocal = true; }
    else {
      map[key] = a;
      if ((a.t || 0) > (b.t || 0)) changedRemote = true;
    }
  }
  return { map, changedLocal, changedRemote };
}

export function compact(map, { now = Date.now(), max = Infinity } = {}) {
  const out = {};
  for (const [k, r] of Object.entries(map)) {
    if (r.del && now - (r.t || 0) > TOMBSTONE_TTL) continue;
    out[k] = r;
  }
  if (max !== Infinity) {
    const live = Object.entries(out).filter(([, r]) => isLive(r)).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
    for (const [k] of live.slice(max)) delete out[k];
  }
  return out;
}

export function snapshotItem(item) {
  return {
    id: item.id,
    title: item.title,
    link: item.link,
    summary: (item.summary || '').slice(0, 240),
    image: item.image || null,
    published: item.published || null,
    sname: item.sname || item.source || '',
    cat: item.cat || '',
    kind: item.kind || 'article',
  };
}

export function createStore({ storage, now = () => Date.now() } = {}) {
  let state = emptyState();
  const subs = new Set();
  const changeHooks = new Set();
  let lastT = 0;
  const stamp = () => { lastT = Math.max(now(), lastT + 1); return lastT; };

  function load() {
    try {
      const raw = storage && storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { ...emptyState(), ...parsed };
      }
    } catch { state = emptyState(); }
  }

  let persistFailed = false;
  function persist() {
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state));
      persistFailed = false;
    } catch { persistFailed = true; }
  }

  function emit(ns, local) {
    persist();
    subs.forEach((fn) => fn(ns));
    if (local) changeHooks.forEach((fn) => fn(ns));
  }

  function put(ns, key, rec) {
    state[ns] = { ...state[ns], [key]: { ...rec, t: stamp() } };
    if (ns === 'reads') state.reads = compact(state.reads, { now: now(), max: MAX_READS });
    emit(ns, true);
  }

  load();

  return {
    get state() { return state; },
    get persistFailed() { return persistFailed; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    onLocalChange(fn) { changeHooks.add(fn); return () => changeHooks.delete(fn); },

    // sources
    sources() { return liveEntries(state.sources).map(([id, r]) => ({ id, ...r })); },
    getSource(id) { const r = state.sources[id]; return isLive(r) ? { id, ...r } : null; },
    upsertSource(id, rec) { put('sources', id, { ...state.sources[id], ...rec, del: undefined }); },
    removeSource(id) { put('sources', id, { del: true }); },

    // reads
    isRead(id) { return isLive(state.reads[id]); },
    setRead(id, read, cat = '') {
      if (read === this.isRead(id)) return;
      put('reads', id, read ? { c: cat } : { del: true });
    },
    markManyRead(items) {
      const t = stamp();
      const next = { ...state.reads };
      for (const it of items) if (!isLive(next[it.id])) next[it.id] = { t, c: it.cat || '' };
      state.reads = compact(next, { now: now(), max: MAX_READS });
      emit('reads', true);
    },

    // library (bookmarks, favourites, notes)
    isBookmarked(id) { const r = state.library[id]; return isLive(r) && !!r.bm; },
    isFavourite(id) { const r = state.library[id]; return isLive(r) && !!r.fav; },
    getNote(id) { const r = state.library[id]; return isLive(r) ? r.note || '' : ''; },
    toggleBookmark(item) {
      const cur = isLive(state.library[item.id]) ? state.library[item.id] : {};
      const bm = cur.bm ? 0 : 1;
      this.writeLibrary(item, { bm, fav: cur.fav ? 1 : 0, note: cur.note || '' });
      return !!bm;
    },
    toggleFavourite(item) {
      const cur = isLive(state.library[item.id]) ? state.library[item.id] : {};
      const fav = cur.fav ? 0 : 1;
      this.writeLibrary(item, { bm: cur.bm ? 1 : 0, fav, note: cur.note || '' });
      return !!fav;
    },
    setNote(item, note) {
      const cur = isLive(state.library[item.id]) ? state.library[item.id] : {};
      this.writeLibrary(item, { bm: cur.bm ? 1 : 0, fav: cur.fav ? 1 : 0, note: String(note || '').slice(0, 5000) });
    },
    writeLibrary(item, { bm, fav = 0, note = '' }) {
      if (!bm && !fav && !note.trim()) { put('library', item.id, { del: true }); return; }
      const prev = state.library[item.id];
      put('library', item.id, { bm: bm ? 1 : 0, fav: fav ? 1 : 0, note: note.trim() ? note : '', item: isLive(prev) && prev.item ? prev.item : snapshotItem(item) });
    },
    library() { return liveEntries(state.library).map(([id, r]) => ({ id, ...r })); },

    // settings
    setting(key, fallback) { const r = state.settings[key]; return isLive(r) && 'v' in r ? r.v : fallback; },
    setSetting(key, v) { put('settings', key, { v }); },
    removeSetting(key) { if (isLive(state.settings[key])) put('settings', key, { del: true }); },
    // All live settings whose key starts with `prefix`, as [[key, value], ...] (used for goals, links, reading list...).
    settingEntries(prefix) {
      return Object.entries(state.settings).filter(([k, r]) => k.startsWith(prefix) && isLive(r) && 'v' in r).map(([k, r]) => [k, r.v]);
    },

    // sync
    applyRemote(ns, remoteMap) {
      const { map, changedLocal, changedRemote } = mergeMaps(state[ns], remoteMap || {});
      if (changedLocal) { state[ns] = map; emit(ns, false); }
      return { changedLocal, changedRemote, merged: map };
    },
    replaceAll(next) { state = { ...emptyState(), ...next }; emit('*', false); },
    exportJSON() { return JSON.stringify({ app: 'my-internet', version: 1, exportedAt: new Date(now()).toISOString(), state }, null, 1); },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.app !== 'my-internet' || !parsed.state) throw new Error('This is not a My Internet backup file.');
      for (const ns of NAMESPACES) {
        const { map } = mergeMaps(state[ns], (parsed.state && parsed.state[ns]) || {});
        state[ns] = map;
      }
      emit('*', true);
    },
  };
}
