// Health-check every feed in public/data/catalog.json using the SAME code the
// live API uses (safe fetcher + parser). Run it from your own computer:
//
//     npm run check-feeds
//
// Exit code 1 if any feed fails, so you can also run it on a schedule (e.g. GitHub Actions).
// Feeds are fetched once each, politely (4 at a time), with the app's User-Agent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFeed } from '../netlify/lib/feed-handler.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/catalog.json'), 'utf8'));

const urls = new Map();
for (const s of catalog.sources) urls.set(s.url, s.name);
for (const s of catalog.sites) if (s.feed && !urls.has(s.feed)) urls.set(s.feed, `${s.name} (site list)`);

const STALE_DAYS = 60;
const rows = [];
const queue = [...urls];
async function worker() {
  while (queue.length) {
    const [url, name] = queue.shift();
    const res = await handleFeed(new Request(`http://local/api/feed?url=${encodeURIComponent(url)}`));
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body && body.ok) {
      const newest = body.items.map((i) => i.published).filter(Boolean).sort().pop();
      const age = newest ? (Date.now() - Date.parse(newest)) / 864e5 : Infinity;
      const state = !body.items.length ? 'EMPTY' : age > STALE_DAYS ? 'STALE' : 'OK';
      rows.push({ state, name, url, detail: `${body.items.length} items, newest ${newest ? newest.slice(0, 10) : 'n/a'}` });
    } else {
      rows.push({ state: 'FAIL', name, url, detail: (body && body.error && body.error.message) || `HTTP ${res.status}` });
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const order = { FAIL: 0, EMPTY: 1, STALE: 2, OK: 3 };
rows.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
for (const r of rows) console.log(`${r.state.padEnd(5)} ${r.name.padEnd(38)} ${r.detail}${r.state === 'OK' ? '' : `\n      ${r.url}`}`);
const bad = rows.filter((r) => r.state !== 'OK');
console.log(`\n${rows.length - bad.length}/${rows.length} feeds healthy.${bad.length ? ' Fix or remove the ones above in public/data/catalog.json.' : ''}`);
process.exit(rows.some((r) => r.state === 'FAIL') ? 1 : 0);
