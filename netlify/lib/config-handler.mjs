// GET /api/config — tells the browser which optional features are configured.
//
// The Firebase "web config" values are identifiers, not secrets (access is
// enforced by Firestore security rules), but they are still read from
// environment variables so nothing project-specific is committed to git.
// No real secret is ever sent to the browser.

import { json, NO_STORE } from './http.mjs';
import { authRequired } from './auth.mjs';

export function handleConfig(req, env = process.env) {
  if (req.method !== 'GET') return json(405, { ok: false, error: { code: 'method_not_allowed' } }, NO_STORE);

  const fb = {
    apiKey: env.FIREBASE_API_KEY,
    authDomain: env.FIREBASE_AUTH_DOMAIN,
    projectId: env.FIREBASE_PROJECT_ID,
    appId: env.FIREBASE_APP_ID,
  };
  const configured = Object.values(fb).every(Boolean);
  if (configured) {
    if (env.FIREBASE_STORAGE_BUCKET) fb.storageBucket = env.FIREBASE_STORAGE_BUCKET;
    if (env.FIREBASE_MESSAGING_SENDER_ID) fb.messagingSenderId = env.FIREBASE_MESSAGING_SENDER_ID;
  }
  return json(200, {
    ok: true,
    firebase: configured ? fb : null,
    authRequired: authRequired(env),
  }, NO_STORE);
}
