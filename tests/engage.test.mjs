import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLove, handleVisits, memoryStore } from '../netlify/lib/engage-handler.mjs';

const CID = 'abcdefghijklmnop1234';
const post = (url, body) => new Request(`http://x${url}`, { method: 'POST', body: JSON.stringify(body) });
const get = (url) => new Request(`http://x${url}`);

test('love: one vote per visitor, toggle off, counts for many ids', async () => {
  const s = memoryStore();
  let r = await (await handleLove(post('/api/love', { id: 'art123', cid: CID, on: true }), s)).json();
  assert.equal(r.count, 1);
  r = await (await handleLove(post('/api/love', { id: 'art123', cid: CID, on: true }), s)).json();
  assert.equal(r.count, 1, 'same visitor twice still counts once');
  r = await (await handleLove(post('/api/love', { id: 'art123', cid: 'zzzzzzzzzzzzzzzzzzzz', on: true }), s)).json();
  assert.equal(r.count, 2);
  const c = await (await handleLove(get('/api/love?ids=art123,other99'), s)).json();
  assert.deepEqual(c.counts, { art123: 2, other99: 0 });
  r = await (await handleLove(post('/api/love', { id: 'art123', cid: CID, on: false }), s)).json();
  assert.equal(r.count, 1);
  r = await (await handleLove(post('/api/love', { id: 'art123', cid: CID, on: false }), s)).json();
  assert.equal(r.count, 1, 'un-loving twice never goes negative');
});

test('love: rejects bad input', async () => {
  const s = memoryStore();
  assert.equal((await handleLove(post('/api/love', { id: '../x', cid: CID, on: true }), s)).status, 400);
  assert.equal((await handleLove(post('/api/love', { id: 'art123', cid: 'short', on: true }), s)).status, 400);
  assert.equal((await handleLove(post('/api/love', { id: 'art123', cid: CID, on: 'yes' }), s)).status, 400);
  assert.equal((await handleLove(get('/api/love?ids='), s)).status, 400);
  assert.equal((await handleLove(new Request('http://x/api/love', { method: 'DELETE' }), s)).status, 405);
});

test('visits: GET reads, POST increments', async () => {
  const s = memoryStore();
  assert.equal((await (await handleVisits(get('/api/visits'), s)).json()).visits, 0);
  await handleVisits(new Request('http://x/api/visits', { method: 'POST' }), s);
  assert.equal((await (await handleVisits(get('/api/visits'), s)).json()).visits, 1);
});
