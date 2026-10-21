import { handleFeed } from '../lib/feed-handler.mjs';

export default async (req) => handleFeed(req);

export const config = { path: ['/api/feed', '/api/feed/*'] };
