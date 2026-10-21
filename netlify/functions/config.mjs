import { handleConfig } from '../lib/config-handler.mjs';

export default async (req) => handleConfig(req);

export const config = { path: '/api/config' };
