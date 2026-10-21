// End-to-end test of the API handlers against a local fixture server.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';

process.env.ALLOW_PRIVATE_HOSTS = '1'; // test-only: lets handlers reach 127.0.0.1 fixtures

const { handleFeed } = await import('../netlify/lib/feed-handler.mjs');
const { handleConfig } = await import('../netlify/lib/config-handler.mjs');
const { checkAccess } = await import('../netlify/lib/auth.mjs');
const { RSS, ATOM, HTML_PAGE } = await import('./fixtures/feeds.mjs');
const { b64url } = await import('../public/js/util.js');

let server; let base;
before(async () => {
  server = http.createServer((req, res) => {
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, ...extra }); res.end(body); };
    if (req.url === '/rss') return send(200, 'application/rss+xml', RSS);
    if (req.url === '/atom') return send(200, 'application/atom+xml; charset=utf-8', ATOM);
    if (req.url === '/gz') return send(200, 'application/xml', zlib.gzipSync(RSS), { 'content-encoding': 'gzip' });
    if (req.url === '/page') return send(200, 'text/html', HTML_PAGE);
    if (req.url === '/404') return send(404, 'text/plain', 'nope');
    if (req.url === '/redir') return send(302, 'text/plain', '', { location: '/rss' });
    if (req.url === '/huge') return send(200, 'application/xml', '<rss><channel>' + 'x'.repeat(4 * 1024 * 1024));
    if (req.url === '/slow') return; // never answers
    send(500, 'text/plain', 'boom');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (path) => handleFeed(new Request(`http://app.test${path}`));
const viaKey = (url) => get(`/api/feed/${b64url(url)}`);

test('serves normalised JSON via the cacheable base64url route', async () => {
  const res = await viaKey(`${base}/rss`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('netlify-cdn-cache-control') || '', /s-maxage/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.feed.title, 'Fixture RSS');
  assert.ok(body.items.length >= 2);
});

test('handles Atom, gzip and redirects', async () => {
  assert.equal((await (await viaKey(`${base}/atom`)).json()).feed.type, 'atom');
  assert.equal((await (await viaKey(`${base}/gz`)).json()).ok, true);
  assert.equal((await (await viaKey(`${base}/redir`)).json()).ok, true);
});

test('broken feeds yield clear errors, never a crash', async () => {
  const r404 = await viaKey(`${base}/404`);
  assert.equal(r404.status, 502);
  assert.equal((await r404.json()).error.code, 'upstream_status');
  const r500 = await viaKey(`${base}/nothing`);
  assert.equal(r500.status, 502);
  const bad = await get('/api/feed');
  assert.equal(bad.status, 400);
  const garbage = await get('/api/feed?url=' + encodeURIComponent('::::'));
  assert.equal(garbage.status, 400);
});

test('an HTML page returns not_a_feed plus the feeds it advertises', async () => {
  const res = await get('/api/feed?url=' + encodeURIComponent(`${base}/page`));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, 'not_a_feed');
  assert.equal(body.discovered.length, 1);
  assert.match(body.discovered[0].url, /\/feed\.xml$/);
});

test('oversized responses are cut off', async () => {
  const res = await viaKey(`${base}/huge`);
  assert.notEqual(res.status, 200);
  assert.equal((await res.json()).error.code, 'too_large');
});

test('only GET is allowed', async () => {
  const res = await handleFeed(new Request('http://app.test/api/feed?url=x', { method: 'POST' }));
  assert.equal(res.status, 405);
});

test('config endpoint exposes Firebase web config only when complete, never secrets', () => {
  const none = handleConfig(new Request('http://x/api/config'), {});
  const partial = handleConfig(new Request('http://x/api/config'), { FIREBASE_API_KEY: 'k' });
  const full = handleConfig(new Request('http://x/api/config'), { FIREBASE_API_KEY: 'k', FIREBASE_AUTH_DOMAIN: 'd', FIREBASE_PROJECT_ID: 'p', FIREBASE_APP_ID: 'a', ALLOWED_EMAILS: 'me@x.com', REQUIRE_AUTH: 'true' });
  return Promise.all([none.json(), partial.json(), full.json()]).then(([n, p, f]) => {
    assert.equal(n.firebase, null);
    assert.equal(p.firebase, null);
    assert.equal(f.firebase.projectId, 'p');
    assert.equal(f.authRequired, true);
    assert.ok(!JSON.stringify(f).includes('me@x.com'), 'allow-list must never be sent to the browser');
  });
});

test('auth gate: open by default; rejects missing/invalid tokens when REQUIRE_AUTH=true', async () => {
  const req = new Request('http://x/api/feed');
  assert.equal((await checkAccess(req, { env: {} })).ok, true);
  const env = { REQUIRE_AUTH: 'true', FIREBASE_PROJECT_ID: 'p' };
  assert.equal((await checkAccess(req, { env })).status, 401);
  const bad = new Request('http://x/api/feed', { headers: { authorization: 'Bearer not.a.jwt' } });
  assert.equal((await checkAccess(bad, { env })).status, 401);
  assert.equal((await checkAccess(req, { env: { REQUIRE_AUTH: 'true' } })).status, 500);
});
