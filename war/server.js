// 픽셀 월드 워 멀티플레이 서버: 정적 파일 + WebSocket(/ws) + 10Hz 게임 루프
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const { Game } = require('./public/sim.js');

const PORT = +process.env.PORT || 3000;
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/countries.json'), 'utf8'));
const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'data/map.bin.gz')));
const grid = new Uint16Array(raw.length / 2);
Buffer.from(grid.buffer).set(raw);
const game = new Game(meta, grid);
const metaMsg = JSON.stringify({ t: 'meta', ...meta });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.gz': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.slice(1);
  const base = rel.startsWith('data/') ? __dirname : path.join(__dirname, 'public');
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

// 현재 지도 스냅샷 (같은 틱 안에서는 재사용)
let snap = { tick: -1, buf: null };
function mapSnapshot() {
  if (snap.tick !== game.tick) {
    const gz = zlib.gzipSync(Buffer.from(game.owner.buffer), { level: 1 });
    snap = { tick: game.tick, buf: Buffer.concat([Buffer.from([1]), gz]) };
  }
  return snap.buf;
}

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 2048 } });
const clients = new Map();
let nextId = 1;
wss.on('connection', (ws) => {
  const pid = 'p' + nextId++;
  clients.set(pid, ws);
  game.addPlayer(pid);
  ws.send(metaMsg);
  ws.send(mapSnapshot());
  ws.send(JSON.stringify(game.stats()));
  ws.on('message', (data, isBinary) => {
    if (isBinary || data.length > 64 * 1024) return;
    try {
      game.command(pid, JSON.parse(data));
    } catch (e) {
      /* 잘못된 메시지는 무시 */
    }
  });
  ws.on('close', () => {
    clients.delete(pid);
    game.removePlayer(pid);
  });
  console.log(`접속: ${pid} (현재 ${clients.size}명)`);
});

function broadcast(data) {
  for (const ws of clients.values()) if (ws.readyState === 1) ws.send(data);
}

setInterval(() => {
  game.step();
  broadcast(game.encodeTick(game.tick % 2 === 0));
  for (const { to, msg } of game.drainOut()) {
    const s = JSON.stringify(msg);
    if (!to) broadcast(s);
    else if (clients.get(to)?.readyState === 1) clients.get(to).send(s);
  }
  if (game.tick % 10 === 0) broadcast(JSON.stringify(game.stats()));
}, 100);

server.listen(PORT, () => console.log(`🌍 픽셀 월드 워 서버 실행 중: http://localhost:${PORT}`));
