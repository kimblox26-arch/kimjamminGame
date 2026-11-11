// 어린이 주식 놀이터 - 게임 서버 (의존성 없음)
// 실행: node server.js   ->  http://localhost:3000
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};
const ALLOWED = ['index.html', 'css/', 'js/'];

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path.endsWith('/')) path += 'index.html';
    const rel = normalize(path).replace(/^([/\\])+/, '');
    if (rel.includes('..') || !ALLOWED.some(a => rel === a || rel.startsWith(a))) throw Object.assign(new Error('not found'), { code: 404 });
    const file = join(ROOT, rel);
    const st = await stat(file);
    if (!st.isFile()) throw Object.assign(new Error('not found'), { code: 404 });
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('페이지를 찾을 수 없어요.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`어린이 주식 놀이터 서버가 열렸어요: http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) console.log(`  같은 와이파이의 다른 기기에서: http://${n.address}:${PORT}`);
  }
});
