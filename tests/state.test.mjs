import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, mergeMaps, compact } from '../public/js/state.js';
import { buildTimeline, filterItems, groupByDay, compareChrono } from '../public/js/timeline.js';
import { sourceId, b64url, dayLabel, timeAgo, flagEmoji } from '../public/js/util.js';
import { pickCountry, pickOutside, usualCategories } from '../public/js/discover.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const item = (id, extra = {}) => ({ id, title: `Title ${id}`, link: `https://x.test/${id}`, summary: 's', published: '2026-10-20T00:00:00.000Z', sname: 'S', cat: 'world', ...extra });

test('bookmarks, notes and read state persist and survive reload', () => {
  const storage = mem();
  const a = createStore({ storage });
  a.toggleBookmark(item('1'));
  a.setNote(item('2'), 'remember this');
  a.setRead('3', true, 'science');
  const b = createStore({ storage });
  assert.equal(b.isBookmarked('1'), true);
  assert.equal(b.getNote('2'), 'remember this');
  assert.equal(b.isRead('3'), true);
  assert.equal(b.library().length, 2);
  b.toggleBookmark(item('1'));
  assert.equal(b.isBookmarked('1'), false);
  assert.equal(b.library().length, 1, 'an un-bookmarked item without a note is removed');
});

test('read/unread toggles and mark-many', () => {
  const s = createStore({ storage: mem() });
  s.setRead('a', true); assert.equal(s.isRead('a'), true);
  s.setRead('a', false); assert.equal(s.isRead('a'), false);
  s.markManyRead([item('x'), item('y')]);
  assert.equal(s.isRead('x') && s.isRead('y'), true);
});

test('source add / disable / remove, with tombstones', () => {
  const s = createStore({ storage: mem() });
  const id = sourceId('https://a.test/feed');
  s.upsertSource(id, { url: 'https://a.test/feed', name: 'A', cat: 'world', on: 1, kind: 'custom' });
  assert.equal(s.sources().length, 1);
  s.removeSource(id);
  assert.equal(s.sources().length, 0);
  s.upsertSource(id, { url: 'https://a.test/feed', name: 'A', cat: 'world', on: 1, kind: 'custom' });
  assert.equal(s.sources().length, 1, 're-adding after removal works');
});

test('two devices merge last-writer-wins per key, deletions included', () => {
  let t = 1000;
  const A = createStore({ storage: mem(), now: () => t });
  const B = createStore({ storage: mem(), now: () => t });
  t = 1; A.toggleBookmark(item('1'));
  t = 2; B.toggleBookmark(item('2'));
  const rA = A.applyRemote('library', B.state.library);
  B.applyRemote('library', A.state.library);
  assert.equal(rA.changedLocal && rA.changedRemote, true);
  assert.deepEqual(A.library().map((x) => x.id).sort(), ['1', '2']);
  assert.deepEqual(B.library().map((x) => x.id).sort(), ['1', '2']);
  t = 10; A.toggleBookmark(item('1')); // A removes 1 (newer than B's copy)
  B.applyRemote('library', A.state.library);
  assert.deepEqual(B.library().map((x) => x.id), ['2'], 'deletion propagates');
  t = 20; B.toggleBookmark(item('1')); // B re-adds later: newest wins
  A.applyRemote('library', B.state.library);
  assert.equal(A.isBookmarked('1'), true);
});

test('mergeMaps is idempotent and compact() drops old tombstones and caps reads', () => {
  const x = { a: { t: 1, v: 1 }, b: { t: 5, del: true } };
  const y = { a: { t: 2, v: 2 }, c: { t: 3 } };
  const m1 = mergeMaps(x, y).map;
  assert.deepEqual(mergeMaps(m1, y).map, m1);
  const now = 100 * 864e5;
  const c = compact({ old: { t: 1, del: true }, fresh: { t: now - 1000, del: true }, r1: { t: 1 }, r2: { t: 2 }, r3: { t: 3 } }, { now, max: 2 });
  assert.ok(!('old' in c) && 'fresh' in c);
  assert.deepEqual(Object.keys(c).filter((k) => k.startsWith('r')).sort(), ['r2', 'r3']);
});

test('backup export/import round-trips', () => {
  const a = createStore({ storage: mem() });
  a.toggleBookmark(item('1')); a.setNote(item('1'), 'n');
  const b = createStore({ storage: mem() });
  b.importJSON(a.exportJSON());
  assert.equal(b.getNote('1'), 'n');
  assert.throws(() => b.importJSON('{"hello":1}'));
});

test('timeline: strictly chronological, de-duplicated, undated last, stable', () => {
  const results = new Map([
    ['s1', { items: [item('a', { published: '2026-10-19T00:00:00.000Z' }), item('b', { published: '2026-10-21T00:00:00.000Z' }), item('u', { published: null })] }],
    ['s2', { items: [item('a', { published: '2026-10-19T00:00:00.000Z' }), item('c', { title: 'A long enough shared headline for dedupe', published: '2026-10-20T00:00:00.000Z' })] }],
    ['s3', { items: [item('d', { title: 'a long enough shared headline for dedupe!', published: '2026-10-20T01:00:00.000Z', image: 'https://i.test/1.jpg' })] }],
  ]);
  const tl = buildTimeline(results, [{ id: 's1', name: 'One', cat: 'world' }, { id: 's2', name: 'Two', cat: 'science' }, { id: 's3', name: 'Three', cat: 'science' }]);
  assert.deepEqual(tl.map((i) => i.id), ['b', 'c', 'a', 'u']);
  assert.equal(tl.find((i) => i.id === 'c').image, 'https://i.test/1.jpg', 'dedupe keeps the richer copy');
  for (let i = 1; i < tl.length - 1; i++) assert.ok(compareChrono(tl[i - 1], tl[i]) <= 0);
});

test('filters: category, unread, search incl. notes; day grouping', () => {
  const items = [item('1', { title: 'Volcano erupts', cat: 'science' }), item('2', { title: 'Markets rally', cat: 'economics' }), item('3', { title: 'Quiet day', cat: 'science' })];
  assert.equal(filterItems(items, { cat: 'science' }).length, 2);
  assert.equal(filterItems(items, { q: 'volcano' }).length, 1);
  assert.equal(filterItems(items, { q: 'MARKETS rally' }).length, 1);
  assert.equal(filterItems(items, { q: 'nothing-here' }).length, 0);
  assert.equal(filterItems(items, { unreadOnly: true, isRead: (id) => id === '1' }).length, 2);
  assert.equal(filterItems(items, { q: 'jotted', getNote: (id) => (id === '3' ? 'jotted down' : '') }).length, 1, 'notes are searchable');
  const groups = groupByDay(items, () => 'Today');
  assert.equal(groups.length, 1);
});

test('utilities', () => {
  assert.equal(sourceId('https://A.test/feed/'), sourceId('https://a.test/feed'));
  assert.equal(b64url('https://x.test/?a=b&c=d'), Buffer.from('https://x.test/?a=b&c=d').toString('base64url'));
  assert.equal(b64url('বাংলা'), Buffer.from('বাংলা').toString('base64url'), 'unicode safe');
  assert.equal(flagEmoji('BD'), '🇧🇩');
  const now = Date.parse('2026-10-21T12:00:00Z');
  assert.equal(timeAgo('2026-10-21T11:00:00Z', now), '1h ago');
  assert.equal(dayLabel('2026-10-21T11:00:00Z', now), 'Today');
});

test('discovery: prefers unseen countries and topics outside your usual categories', () => {
  const countries = [{ code: 'A' }, { code: 'B' }, { code: 'C' }];
  for (let i = 0; i < 30; i++) assert.notEqual(pickCountry(countries, new Set(['A', 'B'])).code, 'A');
  assert.ok(['A', 'B', 'C'].includes(pickCountry(countries, new Set(['A', 'B', 'C'])).code), 'falls back when all seen');
  const topics = [{ t: 'x', c: 'science' }, { t: 'y', c: 'history' }, { t: 'z', c: 'culture' }];
  const usual = usualCategories({ science: 50, history: 20, culture: 0 });
  assert.deepEqual([...usual].sort(), ['history', 'science']);
  for (let i = 0; i < 30; i++) assert.equal(pickOutside(topics, usual, new Set(), (x) => x.t).t, 'z');
  assert.equal(usualCategories({ science: 1, history: 0 }).size, 0, 'no strong signal → no exclusion');
});
