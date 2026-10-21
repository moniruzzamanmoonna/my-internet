// Local development server: serves /public and mounts the same API handlers
// that Netlify Functions run in production. No Netlify CLI needed.
//
//   npm run dev:local        ->  http://localhost:8888
//
// Environment variables are read from the shell (or from a .env file if you
// run:  node --env-file=.env scripts/dev-server.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { handleFeed } from '../netlify/lib/feed-handler.mjs';
import { handleWiki } from '../netlify/lib/wiki-handler.mjs';
import { handleConfig } from '../netlify/lib/config-handler.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function createDevServer({ publicDir = path.join(ROOT, 'public') } = {}) {
  return http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = new URL(nodeReq.url, `http://${nodeReq.headers.host || 'localhost'}`);

      if (url.pathname.startsWith('/api/')) {
        const req = new Request(url, { method: nodeReq.method, headers: nodeReq.headers });
        let res;
        if (url.pathname === '/api/feed' || url.pathname.startsWith('/api/feed/')) res = await handleFeed(req);
        else if (url.pathname === '/api/wiki') res = await handleWiki(req);
        else if (url.pathname === '/api/config') res = handleConfig(req);
        else res = new Response(JSON.stringify({ ok: false, error: { code: 'not_found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
        nodeRes.writeHead(res.status, Object.fromEntries(res.headers));
        nodeRes.end(Buffer.from(await res.arrayBuffer()));
        return;
      }

      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir)) { nodeRes.writeHead(403).end('Forbidden'); return; }
      let target = file;
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(publicDir, 'index.html');
      const ext = path.extname(target).toLowerCase();
      nodeRes.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
      fs.createReadStream(target).pipe(nodeRes);
    } catch (e) {
      console.error(e);
      if (!nodeRes.headersSent) nodeRes.writeHead(500);
      nodeRes.end('Server error');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT) || 8888;
  createDevServer().listen(port, () => console.log(`My Internet dev server: http://localhost:${port}`));
}
