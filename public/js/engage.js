// Shared ❤ counts and the total-visits counter (server: /api/love, /api/visits).
// Anonymous: a random id kept in this browser stands in for an account.

const LOVED_KEY = 'mi.loved.v1';
const CID_KEY = 'mi.cid.v1';
const SESSION_KEY = 'mi.visited.v1';

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

let mem = null; // fallback if storage is blocked
function clientId() {
  let id = lsGet(CID_KEY) || mem;
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    lsSet(CID_KEY, id);
    mem = id;
  }
  return id;
}

function loadLoved() {
  try { return new Set(JSON.parse(lsGet(LOVED_KEY) || '[]')); } catch { return new Set(); }
}
const loved = loadLoved();
const saveLoved = () => lsSet(LOVED_KEY, JSON.stringify([...loved]));

export const isLoved = (id) => loved.has(id);

// --- batched count lookups: many cards on one page -> one request per 60 ids
const cache = new Map();   // id -> number
const waiting = new Map(); // id -> [resolve]
let timer = null;

async function flush() {
  timer = null;
  const ids = [...waiting.keys()];
  const batches = [];
  for (let i = 0; i < ids.length; i += 60) batches.push(ids.slice(i, i + 60));
  await Promise.all(batches.map(async (batch) => {
    let counts = null;
    try {
      const res = await fetch(`/api/love?ids=${batch.join(',')}`);
      const body = res.ok ? await res.json() : null;
      counts = body && body.ok ? body.counts : null;
    } catch { /* offline */ }
    for (const id of batch) {
      const n = counts && Number.isInteger(counts[id]) ? counts[id] : null;
      if (n !== null) cache.set(id, n);
      (waiting.get(id) || []).forEach((r) => r(n));
      waiting.delete(id);
    }
  }));
}

export function getCount(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  return new Promise((resolve) => {
    if (!waiting.has(id)) waiting.set(id, []);
    waiting.get(id).push(resolve);
    if (!timer) timer = setTimeout(flush, 30);
  });
}

// Returns the new server count, or null if the server could not be reached
// (in which case nothing is changed locally either).
export async function setLoved(id, on) {
  try {
    const res = await fetch('/api/love', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, cid: clientId(), on }),
    });
    const body = res.ok ? await res.json() : null;
    if (!body || !body.ok) return null;
    if (body.on) loved.add(id); else loved.delete(id);
    saveLoved();
    cache.set(id, body.count);
    return body.count;
  } catch { return null; }
}

// Counts one visit per browser tab session (not per page view or route change).
export async function recordVisit() {
  let first = true;
  try { first = !sessionStorage.getItem(SESSION_KEY); sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* count it */ }
  try {
    const res = await fetch('/api/visits', { method: first ? 'POST' : 'GET' });
    const body = res.ok ? await res.json() : null;
    return body && body.ok ? body.visits : null;
  } catch { return null; }
}
