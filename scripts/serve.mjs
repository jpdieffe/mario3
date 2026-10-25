import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../site/',import.meta.url));
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.zip':'application/zip'};
export function createServer(port = 4173) {
  return http.createServer(async (request,response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      const file = path.resolve(root,'.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch { response.writeHead(404).end('Not found'); }
  }).listen(port,'127.0.0.1');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  createServer(port); console.log(`Local: http://127.0.0.1:${port}`);
}
