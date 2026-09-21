// 의존성 없는 정적 서버. 사용법: node server.mjs [포트]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.argv[2]) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gz': 'application/octet-stream', '.wasm': 'application/wasm'
};

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('nf');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
}).listen(port, '0.0.0.0', () => {
  console.log(`\n  그린노트 실행 중\n  PC     : http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  같은 Wi-Fi 폰: http://${i.address}:${port}`);
  console.log('');
});
