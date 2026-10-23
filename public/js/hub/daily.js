// "Of the day" picks. Deterministic per calendar day so the page doesn't reshuffle on
// every visit (and so there is nothing to refresh for). DOM-free.
import { fnv } from '../util.js';

export function dayKeyOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickForDay(list, key, salt = '') {
  if (!list.length) return null;
  return list[parseInt(fnv(`${salt}|${key}`), 16) % list.length];
}

// n distinct items, stable for the same (key, salt).
export function pickManyForDay(list, key, n, salt = '') {
  const rnd = mulberry32(parseInt(fnv(`${salt}|${key}`), 16));
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
