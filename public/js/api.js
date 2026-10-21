// Thin client for the server-side proxy (/api/*). Every failure becomes an ApiError
// with a human-readable message so the UI never has to guess.
import { b64url } from './util.js';

export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

let authProvider = null;
export function setAuthProvider(fn) { authProvider = fn; }

async function call(path, { timeoutMs = 20000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = {};
    if (authProvider) {
      const token = await authProvider();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await fetch(path, { signal: ctl.signal, headers });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new ApiError('timeout', 'The request took too long.');
      throw new ApiError('offline', 'Could not reach the server. Check your connection.');
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok || !body || body.ok === false) {
      const err = (body && body.error) || {};
      throw new ApiError(err.code || `http_${res.status}`, err.message || `The server answered with HTTP ${res.status}.`, {
        status: res.status,
        discovered: body && body.discovered,
      });
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export const getConfig = () => call('/api/config', { timeoutMs: 6000 });
export const fetchFeed = (url) => call(`/api/feed/${b64url(url)}`);       // CDN-cacheable
export const previewFeed = (url) => call(`/api/feed?url=${encodeURIComponent(url)}`); // never cached
export const wikiSummary = (title, project = 'wikipedia') =>
  call(`/api/wiki?op=summary&project=${project}&title=${encodeURIComponent(title)}`);
export const wikiRandom = () => call('/api/wiki?op=random');
export const wikiSearch = (q) => call(`/api/wiki?op=search&q=${encodeURIComponent(q)}`);

// Run async tasks with limited concurrency; never rejects (tasks handle their own errors).
export async function pool(tasks, limit = 6) {
  let i = 0;
  const worker = async () => { while (i < tasks.length) { const t = tasks[i++]; await t(); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}
