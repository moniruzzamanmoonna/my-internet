// Optional access gate for the API.
//
// By default the API is open (it only returns parsed public feeds, and every
// outbound request is SSRF-guarded). If you would rather nobody else can use
// your Netlify function quota, set REQUIRE_AUTH=true. Requests must then carry
// a valid Firebase ID token (Google sign-in in the app), and, if ALLOWED_EMAILS
// is set, belong to one of those verified email addresses.
//
// Verification uses Google's public signing keys only — no service-account
// secret is needed anywhere.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let remoteKeys;

export function authRequired(env = process.env) {
  return String(env.REQUIRE_AUTH || '').toLowerCase() === 'true';
}

export async function checkAccess(req, { env = process.env, jwks } = {}) {
  if (!authRequired(env)) return { ok: true };

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    return { ok: false, status: 500, message: 'Server misconfigured: FIREBASE_PROJECT_ID is not set.' };
  }
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, message: 'Please sign in to use this app.' };

  try {
    const keys = jwks || (remoteKeys ||= createRemoteJWKSet(new URL(JWKS_URL)));
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });
    if (!payload.sub) throw new Error('no subject');

    const allowed = String(env.ALLOWED_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length) {
      const email = String(payload.email || '').toLowerCase();
      if (!payload.email_verified || !allowed.includes(email)) {
        return { ok: false, status: 403, message: 'This account is not allowed to use this app.' };
      }
    }
    return { ok: true, uid: payload.sub };
  } catch {
    return { ok: false, status: 401, message: 'Your session is invalid or has expired. Please sign in again.' };
  }
}
