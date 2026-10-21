// GET /api/wiki?op=summary&title=Kyoto[&project=wikipedia|wikivoyage]
// GET /api/wiki?op=random
// GET /api/wiki?op=search&q=mycology
//
// Uses the public Wikimedia REST/Action APIs (free, no key, built for this).
// Wikimedia asks API clients to send a descriptive User-Agent — safe-fetch does.

import { safeGet, decodeBody } from './safe-fetch.mjs';
import { htmlToText, truncate } from './parse-feed.mjs';
import { checkAccess } from './auth.mjs';
import { json, errorResponse, methodNotAllowed, NO_STORE } from './http.mjs';

const HOSTS = { wikipedia: 'en.wikipedia.org', wikivoyage: 'en.wikivoyage.org' };
const ACCEPT = 'application/json; charset=utf-8';

function normaliseSummary(j, project) {
  const page = j?.content_urls?.desktop?.page;
  return {
    project,
    type: j.type || 'standard',
    title: truncate(htmlToText(j.title || ''), 150),
    description: truncate(htmlToText(j.description || ''), 200),
    extract: truncate(htmlToText(j.extract || ''), 900),
    image: j?.thumbnail?.source && /^https:\/\//.test(j.thumbnail.source) ? j.thumbnail.source : null,
    url: page && /^https:\/\//.test(page) ? page : null,
  };
}

async function getJson(url) {
  const res = await safeGet(url, { accept: ACCEPT, maxBytes: 1024 * 1024, timeoutMs: 8000 });
  if (res.status === 404) return { notFound: true };
  if (res.status >= 400) return { failed: res.status };
  try {
    return { data: JSON.parse(decodeBody(res.body, res.headers['content-type'])) };
  } catch {
    return { failed: 502 };
  }
}

export async function handleWiki(req) {
  if (req.method !== 'GET') return methodNotAllowed();
  const access = await checkAccess(req);
  if (!access.ok) {
    return json(access.status, { ok: false, error: { code: 'unauthorized', message: access.message } }, NO_STORE);
  }

  const q = new URL(req.url).searchParams;
  const op = q.get('op') || 'summary';
  const project = q.get('project') === 'wikivoyage' ? 'wikivoyage' : 'wikipedia';
  const host = HOSTS[project];

  try {
    if (op === 'summary') {
      const title = (q.get('title') || '').trim();
      if (!title || title.length > 200) {
        return json(400, { ok: false, error: { code: 'invalid_title', message: 'A title is required.' } }, NO_STORE);
      }
      const r = await getJson(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
      if (r.notFound) return json(404, { ok: false, error: { code: 'not_found', message: 'No page with that title.' } }, NO_STORE);
      if (r.failed) return json(502, { ok: false, error: { code: 'upstream_status', message: `Wikimedia answered with HTTP ${r.failed}.` } }, NO_STORE);
      return json(200, { ok: true, page: normaliseSummary(r.data, project) }, { 'cache-control': 'public, max-age=3600' });
    }

    if (op === 'random') {
      // Skip disambiguation pages and stubs with no text; try a few times.
      for (let i = 0; i < 5; i++) {
        const r = await getJson(`https://${host}/api/rest_v1/page/random/summary`);
        if (r.data && r.data.type === 'standard' && (r.data.extract || '').length > 120) {
          return json(200, { ok: true, page: normaliseSummary(r.data, project) }, NO_STORE);
        }
        if (r.failed) return json(502, { ok: false, error: { code: 'upstream_status', message: `Wikimedia answered with HTTP ${r.failed}.` } }, NO_STORE);
      }
      return json(502, { ok: false, error: { code: 'no_result', message: 'Could not find a suitable random page. Try again.' } }, NO_STORE);
    }

    if (op === 'search') {
      const term = (q.get('q') || '').trim();
      if (!term || term.length > 200) {
        return json(400, { ok: false, error: { code: 'invalid_query', message: 'A search term is required.' } }, NO_STORE);
      }
      const url = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=8&srnamespace=0&format=json&formatversion=2`;
      const r = await getJson(url);
      if (r.failed || r.notFound) return json(502, { ok: false, error: { code: 'upstream_status', message: 'Wikimedia search is unavailable right now.' } }, NO_STORE);
      const results = (r.data?.query?.search || []).map((s) => ({
        title: truncate(htmlToText(s.title || ''), 150),
        snippet: truncate(htmlToText(s.snippet || ''), 220),
        url: `https://${host}/wiki/${encodeURIComponent(String(s.title || '').replace(/ /g, '_'))}`,
      }));
      return json(200, { ok: true, results }, { 'cache-control': 'public, max-age=3600' });
    }

    return json(400, { ok: false, error: { code: 'invalid_op', message: 'Unknown operation.' } }, NO_STORE);
  } catch (e) {
    return errorResponse(e);
  }
}
