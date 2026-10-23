import { handleLove } from '../lib/engage-handler.mjs';
import { blobStore } from '../lib/blob-store.mjs';

export default async (req) => handleLove(req, blobStore());

export const config = { path: '/api/love' };
