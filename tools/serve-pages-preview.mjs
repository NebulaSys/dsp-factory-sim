/**
 * Serve `dist/` under a `/dsp-factory-sim/` subpath, the way GitHub Pages does, and log every
 * request with its status. Used to verify the Pages build before publishing: a wrong base path
 * shows up as 404s here rather than as a blank canvas after deploy.
 *
 *   node tools/serve-pages-preview.mjs [port]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const PORT = Number(process.argv[2] ?? 5200);
const BASE = '/dsp-factory-sim/';
const DIST = resolve(import.meta.dirname, '..', 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

let notFound = 0;
let ok = 0;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);

  if (!path.startsWith(BASE)) {
    // Anything outside the subpath is a mistake in the page itself.
    notFound++;
    console.log(`  404  ${path}   (outside ${BASE})`);
    res.writeHead(404).end('outside base');
    return;
  }

  path = path.slice(BASE.length);
  if (path === '' || path.endsWith('/')) path += 'index.html';

  const file = join(DIST, normalize(path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    notFound++;
    console.log(`  404  ${BASE}${path}`);
    res.writeHead(404).end('not found');
    return;
  }

  ok++;
  const body = readFileSync(file);
  console.log(`  200  ${BASE}${path}   ${body.length} B`);
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${DIST}`);
  console.log(`  at http://127.0.0.1:${PORT}${BASE}`);
  console.log('every request is logged with its status\n');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\nrequests served: ${ok} ok, ${notFound} not-found`);
    process.exit(notFound > 0 ? 1 : 0);
  });
}
