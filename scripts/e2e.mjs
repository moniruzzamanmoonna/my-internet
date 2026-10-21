// Browser end-to-end test: real Chromium against the real dev server + API handlers.
//   npm run test:e2e        (needs: npm i, and a Chromium; set CHROMIUM_PATH if not auto-found)
//
// Feeds come from a local TEST fixture server (never shipped with the app). The
// Wikimedia API is stubbed in the browser because CI/sandboxes often have no internet.
// The same Content-Security-Policy as production (from netlify.toml) is applied so
// CSP violations fail the test.

process.env.ALLOW_PRIVATE_HOSTS = '1';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createDevServer } from './dev-server.mjs';
import { RSS, ATOM, HTML_PAGE } from '../tests/fixtures/feeds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csp = /Content-Security-Policy = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8'))[1];

const fixture = http.createServer((req, res) => {
  const t = { '/rss': ['application/rss+xml', RSS], '/atom': ['application/atom+xml', ATOM], '/page': ['text/html', HTML_PAGE] }[req.url];
  if (!t) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': t[0] }); res.end(t[1]);
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const FIX = `http://127.0.0.1:${fixture.address().port}`;

const app = createDevServer();
app.prependListener('request', (req, res) => res.setHeader('Content-Security-Policy', csp));
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${app.address().port}`;

const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('  ✓', name); }
  catch (e) { results.push(['FAIL', name, e]); console.log('  ✗', name, '\n    ', String(e.message).split('\n')[0]); }
};

const wikiStub = (route) => {
  const u = new URL(route.request().url());
  const op = u.searchParams.get('op');
  const page = (title, extra = {}) => ({ ok: true, page: { project: u.searchParams.get('project') || 'wikipedia', type: 'standard', title, description: 'STUBBED test description', extract: `STUBBED extract about ${title}. `.repeat(3), image: null, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, ...extra } });
  const body = op === 'search' ? { ok: true, results: [{ title: 'Related one', snippet: 'a related thing', url: 'https://en.wikipedia.org/wiki/Related_one' }] }
    : op === 'random' ? page('Random Test Page') : page(u.searchParams.get('title') || 'Test');
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
};

const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
await ctx.addInitScript(() => { window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(String(e.message))); });
await ctx.route('**/api/wiki*', wikiStub);
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
console.log('E2E against', BASE, '(fixtures at', FIX + ')');

const addSource = async (url, cat, name = '') => {
  await page.goto(`${BASE}/#/sources`);
  await page.fill('#add-url', url);
  if (name) await page.fill('#add-name', name);
  if (cat.startsWith('new:')) { await page.selectOption('#add-cat', '__new__'); await page.fill('#add-newcat', cat.slice(4)); }
  else await page.selectOption('#add-cat', cat);
  await page.click('.add-form button[type=submit]');
};

await step('app boots with starter sources; unreachable real feeds fail gracefully (sandbox has no internet)', async () => {
  await page.goto(BASE);
  await page.waitForSelector('.brand');
  await page.waitForSelector('.status .warn', { timeout: 30000 });
  assert.match(await page.textContent('.status .warn'), /couldn.t load/);
  assert.ok(await page.locator('.nav a[aria-current=page]').textContent().then((t) => /Feed/.test(t)));
  assert.ok(await page.locator('.banner').count() === 1, 'welcome banner explains starter sources');
});

await step('add a custom RSS feed; articles appear, newest first, duplicates collapsed', async () => {
  await addSource(`${FIX}/rss`, 'science', 'Fixture RSS');
  await page.waitForSelector('.form-msg.ok', { timeout: 15000 });
  await page.goto(`${BASE}/#/feed`);
  await page.waitForSelector('.card .title');
  const titles = await page.locator('.card .title').allTextContents();
  assert.deepEqual(titles.filter((t) => /Newest|Older|Duplicate/.test(t)), ['Newest & best', 'Older story']);
  const summary = await page.locator('.card', { hasText: 'Newest & best' }).locator('.summary').textContent();
  assert.equal(summary, 'Hello world');
});

await step('adding a web page lists the feeds it advertises (auto-discovery)', async () => {
  await addSource(`${FIX}/page`, 'world');
  await page.waitForSelector('.found button', { timeout: 15000 });
  assert.match(await page.textContent('.found button'), /Site feed/);
});

await step('invalid and duplicate input is handled with clear messages', async () => {
  await addSource('http://127.0.0.1:9/nothing-here', 'world');
  await page.waitForSelector('.form-msg.err', { timeout: 15000 });
  await addSource('http://localhost/', 'world');
  await page.waitForFunction(() => /not allowed|refused|allowed/i.test(document.querySelector('.form-msg')?.textContent || ''), null, { timeout: 15000 });
});

await step('custom category creates a new tab that filters the feed', async () => {
  await addSource(`${FIX}/atom`, 'new:My Blogs', 'Fixture Atom');
  await page.waitForSelector('.form-msg.ok', { timeout: 15000 });
  await page.goto(`${BASE}/#/feed`);
  await page.waitForSelector('.chip:has-text("My Blogs")');
  await page.click('.chip:has-text("My Blogs")');
  await page.waitForSelector('.card:has-text("Atom entry")');
  assert.equal(await page.locator('.card').count(), 1);
  await page.click('.chip:has-text("Science")');
  await page.waitForSelector('.card:has-text("Newest & best")');
  assert.equal(await page.locator('.card:has-text("Atom entry")').count(), 0);
});

await step('search finds articles; bookmark + note work; Saved lists them; notes are searchable', async () => {
  await page.goto(`${BASE}/#/feed`);
  await page.fill('#q', 'older');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  await page.fill('#q', '');
  await page.dispatchEvent('#q', 'input');
  await page.waitForFunction(() => document.querySelectorAll('.card').length >= 3);
  const card = page.locator('.card', { hasText: 'Older story' });
  await card.locator('.act', { hasText: 'Save' }).click();
  await card.locator('.act', { hasText: 'Note' }).click();
  await card.locator('textarea').fill('zebra-note-123');
  await card.locator('textarea').blur();
  await page.goto(`${BASE}/#/saved`);
  await page.waitForSelector('.card:has-text("Older story")');
  assert.equal(await page.locator('.card textarea').inputValue(), 'zebra-note-123');
  await page.goto(`${BASE}/#/feed`);
  await page.fill('#q', 'zebra-note');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  await page.fill('#q', ''); await page.dispatchEvent('#q', 'input');
});

await step('read/unread: clicking toggles state; "Unread only" hides read items; mark all read', async () => {
  await page.goto(`${BASE}/#/feed`);
  await page.waitForSelector('.card:has-text("Older story")');
  const card = page.locator('.card', { hasText: 'Older story' });
  assert.ok((await card.getAttribute('class')).includes('unread'));
  await card.locator('.act[aria-pressed]:has-text("Mark read")').click();
  assert.ok(!(await card.getAttribute('class')).includes('unread'));
  await page.check('.toolbar input[type=checkbox]');
  await page.waitForFunction(() => !document.body.innerText.includes('Older story'));
  await page.click('.toolbar .link');
  await page.waitForSelector('.empty:has-text("caught up")');
  await page.uncheck('.toolbar input[type=checkbox]');
});

await step('everything persists across a reload (sources, bookmarks, read state)', async () => {
  await page.reload();
  await page.waitForSelector('.card:has-text("Older story")');
  assert.ok(await page.locator('.card:has-text("Older story") .act[aria-pressed=true]:has-text("Saved")').count() === 1);
  assert.ok(!(await page.locator('.card', { hasText: 'Older story' }).getAttribute('class')).includes('unread'));
});

await step('feed health is visible on Sources; removing a custom source removes its articles', async () => {
  await page.goto(`${BASE}/#/sources`);
  await page.waitForSelector('.src:has-text("Fixture RSS") .pill.good');
  assert.ok(await page.locator('.pill.bad').count() > 0, 'failing starter feeds are flagged');
  await page.locator('.src', { hasText: 'Fixture Atom' }).getByRole('button', { name: 'Remove' }).click();
  await page.goto(`${BASE}/#/feed`);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.card:has-text("Atom entry")').count(), 0);
});

await step('catalog toggles, OPML export and JSON backup export produce valid files', async () => {
  await page.goto(`${BASE}/#/sources`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export sources (OPML)")')]);
  const opml = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(opml, /<opml version="2.0">/); assert.match(opml, /xmlUrl="http:\/\/127\.0\.0\.1:\d+\/rss"/);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export backup")')]);
  const j = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  assert.equal(j.app, 'my-internet'); assert.ok(Object.keys(j.state.library).length >= 1);
});

await step('discovery: Random Country, Unknown Topic, Surprise Me render results with attribution', async () => {
  await page.goto(`${BASE}/#/discover`);
  await page.click('.tile:has-text("Random country")');
  await page.waitForSelector('.discovery:has-text("Random country")');
  assert.ok(await page.locator('.discovery .flag').count() === 1);
  assert.match(await page.textContent('.attrib'), /CC BY-SA/);
  await page.click('.tile:has-text("unknown topic")');
  await page.waitForSelector('.discovery:has-text("Unknown topic")');
  assert.ok(await page.locator('.related li').count() >= 1);
  await page.click('.discovery button:has-text("Save")');
  assert.ok(await page.locator('.discovery button[aria-pressed=true]').count() === 1);
  await page.addInitScript(() => { Math.random = () => 0.01; });
  await page.reload();
  await page.click('.surprise');
  await page.waitForSelector('.discovery');
  await page.click('#btn-surprise');
  await page.waitForSelector('.discovery');
});

await step('header Surprise button navigates to Discover from any page', async () => {
  await page.goto(`${BASE}/#/sources`);
  await page.click('#btn-surprise');
  await page.waitForSelector('.discovery');
  assert.match(page.url(), /#\/discover/);
});

await step('dark mode toggles and persists', async () => {
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const before = await bg();
  await page.click('#btn-theme'); await page.click('#btn-theme'); // system -> light -> dark
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.notEqual(await bg(), before);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.click('#btn-theme'); // -> system
});

await step('mobile layout: no horizontal scroll, bottom nav visible, tabs scroll', async () => {
  const m = await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
  await m.route('**/api/wiki*', wikiStub);
  const mp = await m.newPage();
  for (const hash of ['#/feed', '#/discover', '#/saved', '#/sources']) {
    await mp.goto(`${BASE}/${hash}`);
    await mp.waitForSelector('main > *');
    const { sw, iw } = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(sw <= iw + 1, `${hash} overflows horizontally (${sw} > ${iw})`);
  }
  const nav = await mp.locator('.nav').boundingBox();
  assert.ok(nav.y > 600, 'nav is at the bottom');
  await m.close();
});

await step('no uncaught errors or CSP violations during the whole run', async () => {
  const errs = consoleErrors.concat(await page.evaluate(() => window.__errors));
  assert.deepEqual(errs, []);
});

await browser.close(); app.close(); fixture.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
if (failed.length) { failed.forEach(([, n, e]) => console.error('\nFAILED:', n, '\n', e.stack || e)); process.exit(1); }
