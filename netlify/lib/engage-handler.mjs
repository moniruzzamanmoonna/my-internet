// Shared counters: ❤ per article and total site visits.
//
//   GET  /api/love?ids=a,b,c      -> { ok, counts: { a: 3, b: 0 } }
//   POST /api/love  {id, cid, on} -> { ok, count, on }
//   GET  /api/visits              -> { ok, visits }
//   POST /api/visits              -> { ok, visits }   (increments by one)
//
// `store` is any object with async get(key) -> object|null and set(key, obj).
// In production it is a Netlify Blobs store (free, no card); locally it is memory.
//
// Honest limits: there are no accounts, so a "voter" is an anonymous random id kept
// in the visitor's browser. Someone who clears site data can love again. Counters
// are read-modify-write, so two taps in the same instant can lose one count.

import { createHash } from 'node:crypto';
import { json, NO_STORE } from './http.mjs';

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const CID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_IDS = 60;
const MAX_VOTERS = 20000; // keeps one record comfortably small

const bad = (status, code, message) => json(status, { ok: false, error: { code, message } }, NO_STORE);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

export async function handleLove(req, store) {
  if (req.method === 'GET') {
    const ids = [...new Set((new URL(req.url).searchParams.get('ids') || '').split(',').filter(Boolean))];
    if (!ids.length || ids.length > MAX_IDS || ids.some((i) => !ID_RE.test(i))) return bad(400, 'bad_ids', 'Send 1–60 valid article ids.');
    const counts = {};
    await Promise.all(ids.map(async (id) => {
      const rec = await store.get(`love/${id}`);
      counts[id] = rec && Number.isInteger(rec.n) ? rec.n : 0;
    }));
    return json(200, { ok: true, counts }, NO_STORE);
  }
  if (req.method === 'POST') {
    const b = await readBody(req);
    if (!b || !ID_RE.test(String(b.id)) || !CID_RE.test(String(b.cid)) || typeof b.on !== 'boolean') {
      return bad(400, 'bad_request', 'Expected {id, cid, on}.');
    }
    const key = `love/${b.id}`;
    const rec = (await store.get(key)) || { n: 0, v: [] };
    const voter = hash(b.cid);
    const has = rec.v.includes(voter);
    if (b.on && !has) {
      if (rec.v.length >= MAX_VOTERS) return bad(429, 'full', 'This article has reached its reaction limit.');
      rec.v.push(voter);
    } else if (!b.on && has) {
      rec.v = rec.v.filter((x) => x !== voter);
    }
    rec.n = rec.v.length;
    await store.set(key, rec);
    return json(200, { ok: true, count: rec.n, on: rec.v.includes(voter) }, NO_STORE);
  }
  return bad(405, 'method_not_allowed', 'Use GET or POST.');
}

export async function handleVisits(req, store) {
  const key = 'stats/visits';
  const rec = (await store.get(key)) || { n: 0 };
  if (req.method === 'POST') {
    rec.n = (Number.isInteger(rec.n) ? rec.n : 0) + 1;
    await store.set(key, rec);
  } else if (req.method !== 'GET') {
    return bad(405, 'method_not_allowed', 'Use GET or POST.');
  }
  return json(200, { ok: true, visits: rec.n }, NO_STORE);
}

export function memoryStore() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async set(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
