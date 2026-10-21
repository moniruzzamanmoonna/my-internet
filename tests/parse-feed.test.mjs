import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, FeedParseError, findFeedLinks, parseDate } from '../netlify/lib/parse-feed.mjs';
import { RSS, ATOM, RDF, HTML_PAGE, XXE } from './fixtures/feeds.mjs';

const NOW = Date.parse('2026-10-21T00:00:00Z');

test('RSS: normalises, strips HTML, drops unsafe links, de-duplicates tracking variants', () => {
  const { feed, items } = parseFeed(RSS, { feedUrl: 'https://fixture.test/rss', now: NOW });
  assert.equal(feed.title, 'Fixture RSS');
  assert.equal(feed.type, 'rss');
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Newest & best'));
  assert.ok(!titles.includes('Bad link item'), 'javascript: links must be dropped');
  assert.equal(items.filter((i) => /fixture\.test\/a/.test(i.link)).length, 1, 'utm / www / trailing slash variants collapse to one');
  const first = items.find((i) => i.title === 'Newest & best');
  assert.equal(first.summary, 'Hello world');
  assert.ok(!/[<>]/.test(first.summary) && !/alert/.test(first.summary), 'no markup or script text leaks through');
  assert.equal(first.image, 'https://fixture.test/i.jpg');
  assert.equal(first.author, 'Ann');
  assert.equal(first.published, '2026-10-20T10:00:00.000Z');
});

test('Atom and RDF parse into the same shape', () => {
  const a = parseFeed(ATOM, { feedUrl: 'https://atom.test/feed', now: NOW });
  assert.equal(a.feed.type, 'atom');
  assert.equal(a.items[0].link, 'https://atom.test/1');
  assert.equal(a.items[0].published, '2026-10-18T08:00:00.000Z');
  const r = parseFeed(RDF, { feedUrl: 'https://rdf.test/feed', now: NOW });
  assert.equal(r.feed.type, 'rdf');
  assert.equal(r.items[0].title, 'RDF item');
});

test('non-feeds are rejected with a typed error', () => {
  assert.throws(() => parseFeed('<html><body>nope</body></html>'), FeedParseError);
  assert.throws(() => parseFeed('not xml at all'), FeedParseError);
  assert.throws(() => parseFeed(''), FeedParseError);
});

test('DOCTYPE / entity-expansion payloads are neutralised', () => {
  const { feed } = parseFeed(XXE, { feedUrl: 'https://x.test/', now: NOW });
  assert.ok(!/AAAAAAAA/.test(feed.title), 'entities must not be expanded');
});

test('future dates are clamped so they cannot pin the top of the feed', () => {
  assert.equal(parseDate('Wed, 01 Jan 2200 00:00:00 GMT', NOW), new Date(NOW).toISOString());
  assert.equal(parseDate('garbage', NOW), null);
});

test('feed auto-discovery reads only <link rel=alternate> tags', () => {
  const links = findFeedLinks(HTML_PAGE, 'https://site.test/');
  assert.deepEqual(links.map((l) => l.url), ['https://site.test/feed.xml']);
});
