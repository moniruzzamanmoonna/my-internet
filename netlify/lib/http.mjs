// Small shared helpers for the API handlers.

import { FetchError } from './safe-fetch.mjs';

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export const NO_STORE = { 'cache-control': 'no-store' };

export function errorResponse(e) {
  if (e instanceof FetchError) {
    const status = {
      invalid_url: 400,
      blocked_address: 403,
      timeout: 504,
    }[e.code] || 502;
    return json(status, { ok: false, error: { code: e.code, message: e.message } }, NO_STORE);
  }
  // Never leak internals.
  console.error('Unexpected error:', e && e.stack ? e.stack : e);
  return json(500, { ok: false, error: { code: 'internal', message: 'Something went wrong on the server.' } }, NO_STORE);
}

export function methodNotAllowed() {
  return json(405, { ok: false, error: { code: 'method_not_allowed', message: 'Use GET.' } }, { ...NO_STORE, allow: 'GET' });
}
