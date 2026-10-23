import { handleVisits } from '../lib/engage-handler.mjs';
import { blobStore } from '../lib/blob-store.mjs';

export default async (req) => handleVisits(req, blobStore());

export const config = { path: '/api/visits' };
