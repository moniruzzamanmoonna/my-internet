// Normalises RSS 2.0, RSS 1.0 (RDF) and Atom 1.0 into one shape:
//   { feed: { title, siteUrl, description, language, type }, items: [ ... ] }
// Everything that leaves this module is plain text or an http(s) URL — the
// browser never receives raw HTML from a publisher.

import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export class FeedParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'FeedParseError';
    this.code = code;
  }
}

const ARRAY_TAGS = new Set([
  'item', 'entry', 'link', 'category', 'enclosure', 'dc:creator', 'dc:subject',
  'media:thumbnail', 'media:content', 'media:group', 'atom:link',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  allowBooleanAttributes: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

// ---- text helpers ----------------------------------------------------------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', bull: '•', middot: '·',
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ' ';
      try { return String.fromCodePoint(code); } catch { return ' '; }
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

export function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
}

function flatten(o) {
  if (o == null) return '';
  if (typeof o !== 'object') return String(o);
  if (Array.isArray(o)) return o.map(flatten).join(' ');
  return Object.entries(o)
    .filter(([k]) => !k.startsWith('@_'))
    .map(([, v]) => flatten(v))
    .join(' ');
}

function text(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return '#text' in v ? String(v['#text']) : flatten(v);
  return String(v);
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// ---- URL helpers -----------------------------------------------------------

export function resolveHttpUrl(raw, base) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).trim(), base);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* ignore */ }
  return null;
}

const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|mc_cid|mc_eid|ocid|igshid|ref_src|ref_url|_ga|at_medium|at_campaign|at_custom\d|taid)$/i;

// A stable key for "is this the same article?" — used for IDs and de-duplication.
export function canonicalKey(href) {
  try {
    const u = new URL(href);
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k));
    params.sort(([a], [b]) => a.localeCompare(b));
    const qs = params.map(([k, v]) => `${k}=${v}`).join('&');
    let path = u.pathname.replace(/\/{2,}/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return String(href);
  }
}

export function articleId(href) {
  return crypto.createHash('sha1').update(canonicalKey(href)).digest('hex').slice(0, 16);
}

// ---- date ------------------------------------------------------------------

export function parseDate(raw, now = Date.now()) {
  if (!raw) return null;
  const s = String(raw).trim();
  let t = Date.parse(s);
  if (Number.isNaN(t)) {
    // e.g. "2026-10-19 12:00:00 +0600" -> ISO-ish
    t = Date.parse(s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/\s+([+-]\d{2}):?(\d{2})$/, '$1:$2'));
  }
  if (Number.isNaN(t)) return null;
  if (t < Date.UTC(1990, 0, 1)) return null;
  if (t > now + 10 * 60 * 1000) t = now; // publishers sometimes post future dates; don't let them pin the top
  return new Date(t).toISOString();
}

// ---- XML clean-up ----------------------------------------------------------

function cleanXml(xml) {
  let s = String(xml).replace(/^﻿/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  s = s.replace(/^\s+(?=<)/, '');
  // Drop DOCTYPE entirely: feeds don't need it, and it is the entry point for entity-expansion tricks.
  s = s.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '');
  // Cut anything after the closing root tag (some feeds append HTML comments or junk).
  const closers = [...s.matchAll(/<\/(rss|feed|rdf:RDF|RDF|atom:feed)\s*>/gi)];
  if (closers.length) {
    const last = closers[closers.length - 1];
    s = s.slice(0, last.index + last[0].length);
  }
  // Escape bare ampersands outside CDATA.
  s = s
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')))
    .join('');
  return s;
}

// ---- field extraction ------------------------------------------------------

const ATOM_SKIP_REL = new Set(['self', 'enclosure', 'replies', 'edit', 'related', 'via', 'hub', 'next', 'prev']);

function linkOf(node, base) {
  const links = asArray(node.link);
  let alt = null;
  let plain = null;
  let any = null;
  for (const l of links) {
    if (typeof l === 'string') { plain ||= l; continue; }
    if (l && typeof l === 'object') {
      const rel = (l['@_rel'] || 'alternate').toLowerCase();
      const href = l['@_href'] || l['#text'];
      if (!href) continue;
      if (rel === 'alternate' && (!l['@_type'] || /html/i.test(l['@_type']))) alt ||= href;
      else if (!ATOM_SKIP_REL.has(rel)) any ||= href;
    }
  }
  const orig = text(node['feedburner:origLink']);
  const guid = node.guid && /^https?:\/\//i.test(text(node.guid)) && (node.guid['@_isPermaLink'] || '').toLowerCase() !== 'false'
    ? text(node.guid) : null;
  return resolveHttpUrl(orig || alt || plain || any || guid, base);
}

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;
const JUNK_IMG = /(1x1|pixel|spacer|blank\.|feedburner\.com\/~|\/tracker|doubleclick|\/ads?\/)/i;

function imageOf(item, rawHtml, base) {
  const candidates = [];
  const collectMedia = (m) => {
    for (const x of asArray(m)) {
      if (x && typeof x === 'object') {
        const url = x['@_url'];
        const medium = (x['@_medium'] || '').toLowerCase();
        const type = (x['@_type'] || '').toLowerCase();
        if (url && (medium === 'image' || type.startsWith('image/') || (!medium && !type) || IMG_EXT.test(url))) candidates.push(url);
      }
    }
  };
  collectMedia(item['media:thumbnail']);
  collectMedia(item['media:content']);
  for (const g of asArray(item['media:group'])) {
    if (g && typeof g === 'object') { collectMedia(g['media:thumbnail']); collectMedia(g['media:content']); }
  }
  for (const e of asArray(item.enclosure)) {
    if (e && typeof e === 'object' && (e['@_type'] || '').toLowerCase().startsWith('image/') && e['@_url']) candidates.push(e['@_url']);
  }
  if (item['itunes:image'] && item['itunes:image']['@_href']) candidates.push(item['itunes:image']['@_href']);
  if (typeof item.image === 'string') candidates.push(item.image);
  const m = /<img\b[^>]*?\bsrc=["']([^"']+)["']/i.exec(rawHtml || '');
  if (m) candidates.push(decodeEntities(m[1]));

  for (const c of candidates) {
    let u = resolveHttpUrl(c, base);
    if (!u || JUNK_IMG.test(u)) continue;
    if (u.startsWith('http://')) u = `https://${u.slice(7)}`; // the app is served over https
    return u;
  }
  return null;
}

function authorOf(item) {
  let a = '';
  if (item['dc:creator']) a = text(item['dc:creator']);
  else if (item.author) {
    const au = Array.isArray(item.author) ? item.author[0] : item.author;
    a = typeof au === 'object' && au !== null && au.name !== undefined ? text(au.name) : text(au);
  }
  a = htmlToText(a);
  const paren = /\(([^)]+)\)/.exec(a);
  if (paren && a.includes('@')) a = paren[1];
  if (a.includes('@')) return '';
  return truncate(a, 80);
}

function categoriesOf(item) {
  const out = [];
  for (const c of [...asArray(item.category), ...asArray(item['dc:subject'])]) {
    const t = htmlToText(typeof c === 'object' && c !== null ? (c['@_term'] || c['@_label'] || text(c)) : c);
    if (t && t.length <= 40 && !out.includes(t)) out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

const BOILERPLATE = /\s*The post .{1,200}? appeared first on .{1,100}?\.?\s*$/i;

function normalizeItem(item, base, now) {
  const link = linkOf(item, base);
  const rawSummary = text(item['content:encoded']) || text(item.description) || text(item.summary) || text(item.content) || '';
  const rawShort = text(item.description) || text(item.summary) || '';
  const rawLong = text(item['content:encoded']) || text(item.content) || rawShort;

  let title = truncate(htmlToText(text(item.title)), 300);
  let summary = htmlToText(rawShort || rawLong).replace(BOILERPLATE, '');
  summary = truncate(summary, 300);
  if (!title && summary) title = truncate(summary, 90);
  if (!link || !title) return null;
  if (summary === title) summary = '';

  const published = parseDate(
    text(item.pubDate) || text(item['dc:date']) || text(item.published) || text(item.updated) || text(item.issued) || text(item.modified) || text(item['dcterms:modified']),
    now,
  );

  return {
    id: articleId(link),
    title,
    link,
    summary,
    image: imageOf(item, `${rawLong}\n${rawSummary}`, link),
    author: authorOf(item),
    published,
    categories: categoriesOf(item),
  };
}

// ---- public API ------------------------------------------------------------

export function parseFeed(xml, { feedUrl = '', now = Date.now(), maxItems = 60 } = {}) {
  let doc;
  try {
    doc = parser.parse(cleanXml(xml));
  } catch {
    throw new FeedParseError('not_a_feed', 'This does not look like an RSS or Atom feed.');
  }
  const rootKey = Object.keys(doc || {}).find((k) => !k.startsWith('?') && !k.startsWith('#'));
  if (!rootKey) throw new FeedParseError('not_a_feed', 'This does not look like an RSS or Atom feed.');
  const root = doc[rootKey];
  if (!root || typeof root !== 'object') throw new FeedParseError('not_a_feed', 'This does not look like an RSS or Atom feed.');

  let type;
  let meta;
  let rawItems;
  if (/^(?:[\w-]+:)?feed$/i.test(rootKey)) {
    type = 'atom';
    meta = root;
    rawItems = asArray(root.entry);
  } else if (/^rss$/i.test(rootKey)) {
    type = 'rss';
    const ch = Array.isArray(root.channel) ? root.channel[0] : root.channel;
    if (!ch || typeof ch !== 'object') throw new FeedParseError('not_a_feed', 'This RSS feed has no channel.');
    meta = ch;
    rawItems = asArray(ch.item);
  } else if (/^(?:rdf:)?RDF$/i.test(rootKey)) {
    type = 'rdf';
    const ch = Array.isArray(root.channel) ? root.channel[0] : root.channel;
    meta = ch && typeof ch === 'object' ? ch : {};
    rawItems = asArray(root.item).length ? asArray(root.item) : asArray(meta.item);
  } else {
    throw new FeedParseError('not_a_feed', 'This does not look like an RSS or Atom feed.');
  }

  const siteUrl = linkOf(meta, feedUrl);
  const items = [];
  const seen = new Set();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const it = normalizeItem(raw, siteUrl || feedUrl, now);
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
    if (items.length >= maxItems) break;
  }

  return {
    feed: {
      type,
      title: truncate(htmlToText(text(meta.title)), 120),
      description: truncate(htmlToText(text(meta.description) || text(meta.subtitle) || text(meta.tagline)), 300),
      siteUrl,
      language: htmlToText(text(meta.language) || text(meta['@_xml:lang']) || text(root['@_xml:lang'])).slice(0, 12),
    },
    items,
  };
}

// Feed auto-discovery: read <link rel="alternate" type="application/rss+xml"> tags
// from the <head> of a page the user typed in. Nothing else on the page is read.
export function findFeedLinks(html, base) {
  const out = [];
  const head = String(html).slice(0, 300_000);
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const attr = (name) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : '';
    };
    if (!/\balternate\b/i.test(attr('rel'))) continue;
    if (!/(rss|atom)\+xml|application\/(rdf\+xml|xml)|text\/xml/i.test(attr('type'))) continue;
    const url = resolveHttpUrl(attr('href'), base);
    if (url && !out.some((o) => o.url === url)) out.push({ url, title: truncate(htmlToText(attr('title')), 80), type: attr('type') });
    if (out.length >= 8) break;
  }
  return out;
}
