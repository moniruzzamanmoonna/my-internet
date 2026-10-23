import { getStore } from '@netlify/blobs';

// Netlify Blobs: built into every Netlify site, free tier, no credit card.
export function blobStore() {
  const s = getStore('engagement');
  return {
    async get(k) { return (await s.get(k, { type: 'json' })) ?? null; },
    async set(k, v) { await s.setJSON(k, v); },
  };
}
