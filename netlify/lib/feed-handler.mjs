// GET /api/feed/<base64url(feedUrl)>   (CDN-cacheable)
// GET /api/feed?url=<feedUrl>           (never CDN-cached; handy for debugging)

import { safeGet, decodeBody, FetchError } from './safe-fetch.mjs';
import { parseFeed, findFeedLinks, FeedParseError } from './parse-feed.mjs';
import { checkAccess, authRequired } from './auth.mjs';
import { json, errorResponse, methodNotAllowed, NO_STORE } from './http.mjs';

const ACCEPT = 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5';

export function decodeKey(key) {
  try {
    const b64 = String(key).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export async function handleFeed(req) {
  if (req.method !== 'GET') return methodNotAllowed();

  const access = await checkAccess(req);
  if (!access.ok) {
    return json(access.status, { ok: false, error: { code: 'unauthorized', message: access.message } }, NO_STORE);
  }

  const reqUrl = new URL(req.url);
  let target = reqUrl.searchParams.get('url');
  let cacheable = false;
  if (!target) {
    const m = /\/api\/feed\/([^/?#]+)/.exec(reqUrl.pathname);
    if (m) {
      target = decodeKey(m[1]);
      // Auth-gated responses must never sit in a shared cache.
      cacheable = !authRequired();
    }
  }
  if (!target) {
    return json(400, { ok: false, error: { code: 'invalid_url', message: 'No feed URL was provided.' } }, NO_STORE);
  }

  try {
    const res = await safeGet(target, { accept: ACCEPT });
    if (res.status >= 400) {
      const note = res.status === 404 || res.status === 410 ? 'The feed was not found (it may have moved).'
        : res.status === 401 || res.status === 403 ? 'The site refused access to this feed.'
          : res.status === 429 ? 'The site is rate-limiting requests right now.'
            : `The site answered with HTTP ${res.status}.`;
      return json(502, { ok: false, error: { code: 'upstream_status', status: res.status, message: note } }, NO_STORE);
    }

    const body = decodeBody(res.body, res.headers['content-type']);
    let parsed;
    try {
      parsed = parseFeed(body, { feedUrl: res.url });
    } catch (e) {
      if (e instanceof FeedParseError) {
        const discovered = /<html|<head|<!doctype html/i.test(body.slice(0, 2000)) ? findFeedLinks(body, res.url) : [];
        const message = discovered.length
          ? 'That is a web page, not a feed — but it advertises feeds you can use.'
          : e.message;
        return json(422, { ok: false, error: { code: 'not_a_feed', message }, discovered }, NO_STORE);
      }
      throw e;
    }

    const headers = cacheable
      ? {
        'cache-control': 'public, max-age=120',
        'netlify-cdn-cache-control': 'public, s-maxage=600, stale-while-revalidate=1800',
      }
      : { 'cache-control': 'private, max-age=60' };

    return json(200, {
      ok: true,
      feed: { ...parsed.feed, url: target, finalUrl: res.url },
      items: parsed.items,
      fetchedAt: new Date().toISOString(),
    }, headers);
  } catch (e) {
    if (e instanceof FetchError) return errorResponse(e);
    return errorResponse(e);
  }
}
