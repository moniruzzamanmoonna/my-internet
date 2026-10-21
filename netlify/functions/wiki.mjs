import { handleWiki } from '../lib/wiki-handler.mjs';

export default async (req) => handleWiki(req);

export const config = { path: '/api/wiki' };
