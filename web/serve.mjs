#!/usr/bin/env node
/* Tiny static server for the Battle Royale build.
 *
 *   node web/serve.mjs [port]
 *
 * Binds 0.0.0.0 so the Arena preview proxy can reach it. Sends CORS headers
 * and the correct MIME types for ES modules.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';

const ROOT = resolve(new URL('.', import.meta.url).pathname);
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  // Never serve outside the web/ directory.
  const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
      // The preview runs inside an iframe on another origin.
      'cross-origin-opener-policy': 'same-origin-allow-popups',
      'cross-origin-embedder-policy': 'unsafe-none',
      // Do not set X-Frame-Options or a restrictive frame-ancestors CSP:
      // that would block the Arena preview iframe.
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + pathname);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[battle-royale] serving ${ROOT}`);
  console.log(`[battle-royale] http://0.0.0.0:${PORT}/`);
});
