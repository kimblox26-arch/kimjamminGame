// AMONG US 팬 제작 서버: 정적 파일 + WebSocket 게임 서버
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './ws.js';
import * as A from './accounts.js';
import * as R from './rooms.js';
import * as MOD from './mod.js';
import { ageOf, CHILD_AGE, randomName, isRandomName } from '../public/js/shared/data.js';

const PORT = +process.env.PORT || 8080;
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>
<body style="background:#000;color:#fff;font-family:sans-serif;padding:24px;line-height:1.6">${body}</body>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/verify') {
    const acc = A.verifyParent(u.searchParams.get('token'));
    if (acc) for (const c of clients.values()) if (c.acc?.id === acc.id) { c.verified = true; send(c, { t: 'account', account: A.publicAcc(acc) }); }
    res.writeHead(acc ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('보호자 인증', acc ? `<h2>✅ 보호자 인증 완료</h2><p>${esc(acc.name)} 계정이 온라인에서 플레이할 수 있게 되었습니다.<br>(만 14세 미만 계정은 계속 빠른 채팅만 사용할 수 있습니다.)</p>`
      : '<h2>링크가 만료되었거나 올바르지 않습니다.</h2>'));
  }
  if (u.pathname === '/outbox') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (A.smtpReady()) return res.end(page('보낸편지함', '<p>SMTP가 설정되어 있어 실제 메일로 발송됩니다.</p>'));
    return res.end(page('개발용 보낸편지함', '<h2>📮 개발용 보낸편지함</h2><p>SMTP를 설정하지 않아 메일이 여기에 표시됩니다. (README 참고)</p>' +
      (A.outbox.map(m => `<div style="border:1px solid #555;border-radius:8px;padding:12px;margin:12px 0"><b>${esc(m.subject)}</b><br>받는 사람: ${esc(m.to)} · ${m.at}
      <pre style="white-space:pre-wrap">${esc(m.text).replace(/(https?:\/\/\S+)/g, '<a style="color:#4ff" href="$1">$1</a>')}</pre></div>`).join('') || '<p>아직 메일이 없습니다.</p>')));
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

// "같은 와이파이" 판별용 네트워크 키: 사설 IP는 /24 대역, 공인 IP는 그대로 (같은 공유기 뒤의 기기는 공인 IP가 같음)
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const serverLans = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && PRIVATE.test(i.address))
  .map(i => i.address.split('.').slice(0, 3).join('.'));
function lanOf(req) {
  let ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return new Set(['loopback', ...serverLans()]);
  if (PRIVATE.test(ip)) return new Set([ip.split('.').slice(0, 3).join('.')]);
  if (ip.includes(':')) return new Set([ip.split(':').slice(0, 4).join(':')]);
  return new Set([ip]);
}

const clients = new Map();
let nextId = 1;
const send = (c, m) => c.ws.send(JSON.stringify(m));
const online = id => [...clients.values()].some(c => c.acc?.id === id);
const baseUrl = req => `${process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
function welcome(c) {
  const a = c.acc;
  c.status = a ? A.status(a) : ageOf(c.birth) >= 0 && ageOf(c.birth) < CHILD_AGE ? 'teal' : 'pink';
  c.verified = !!a?.parentVerified;
  if (a) c.name = a.name;
  send(c, { t: 'welcome', id: c.id, status: c.status, name: c.name, account: a ? A.publicAcc(a) : null });
}
function friendsOf(c) { if (c.acc) send(c, { t: 'friends', ...A.friendList(c.acc, online) }); }
const notifyFriends = acc => { for (const x of clients.values()) if (x.acc && acc.friends.includes(x.acc.id)) friendsOf(x); };

server.on('upgrade', (req, sock) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return sock.destroy();
  acceptUpgrade(req, sock, ws => {
    const c = { id: 'p' + nextId++, ws, lan: lanOf(req), name: randomName(), status: 'pink', look: R.cleanLook(), x: 0, y: 0, room: null, acc: null, birth: '' };
    clients.set(c.id, c);
    ws.on('close', () => { R.leave(c); clients.delete(c.id); if (c.acc) notifyFriends(c.acc); });
    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      try { handle(c, m, req); } catch (e) { console.error(e); send(c, { t: 'err', msg: e.message }); }
    });
  });
});

function handle(c, m, req) {
  const ok = (extra = {}) => send(c, { t: 'authOk', ...extra });
  const fail = e => send(c, { t: 'authErr', msg: e.message });
  switch (m.t) {
    case 'ping': return send(c, { t: 'pong', ts: m.ts });
    case 'hello': {
      c.acc = A.byToken(m.token) || null;
      c.birth = String(m.birth || '');
      if (!c.acc && isRandomName(m.guestName)) c.name = m.guestName;
      if (m.look && !c.room) c.look = R.cleanLook(m.look);
      welcome(c);
      MOD.helloKey(c, m.modKey); // 저장된 mod key 로 자동 인증
      if (m.lvl !== undefined) c.lvl = c.mod ? Math.max(0, Math.min(1e9, Math.round(+m.lvl) || 1)) : Math.max(1, Math.min(999, m.lvl | 0));
      friendsOf(c);
      if (c.acc) notifyFriends(c.acc);
      R.refresh(c);
      return;
    }
    case 'register':
      try { const { acc, token } = A.register(m, baseUrl(req)); c.acc = acc; ok({ token, created: true }); welcome(c); friendsOf(c); } catch (e) { fail(e); }
      return;
    case 'login':
      try { const { acc, token } = A.login(m.email, m.pass); c.acc = acc; ok({ token }); welcome(c); friendsOf(c); notifyFriends(acc); } catch (e) { fail(e); }
      return;
    case 'logout': if (c.acc) { A.logout(c.acc, m.token); notifyFriends(c.acc); c.acc = null; c.name = m.guestName && isRandomName(m.guestName) ? m.guestName : randomName(); welcome(c); } return;
    case 'deleteAccount': if (c.acc) { A.remove(c.acc); c.acc = null; c.name = randomName(); welcome(c); } return;
    case 'resendParent':
      if (c.acc?.parentEmail && !c.acc.parentVerified) { A.sendParentMail(c.acc, baseUrl(req)); send(c, { t: 'toast', msg: '보호자 이메일로 인증 메일을 다시 보냈습니다.' }); }
      return;
    case 'rename':
      if (!c.acc || c.status !== 'green') return send(c, { t: 'err', msg: '이름 변경은 로그인한 계정(초록불)에서만 할 수 있습니다.' });
      if (c.room?.game) return send(c, { t: 'err', msg: '게임 중에는 이름을 바꿀 수 없습니다.' });
      try { A.rename(c.acc, m.name); c.name = c.acc.name; welcome(c); R.refresh(c); } catch (e) { send(c, { t: 'err', msg: e.message }); }
      return;
    case 'friendAdd': case 'friendAccept': case 'friendRemove': {
      if (c.status !== 'green') return send(c, { t: 'err', msg: '친구 기능은 로그인한 계정(초록불)에서만 쓸 수 있습니다.' });
      try {
        const t = m.t === 'friendAdd' ? A.addFriend(c.acc, m.code) : m.t === 'friendAccept' ? A.acceptFriend(c.acc, m.id) : (A.removeFriend(c.acc, m.id), A.byId(m.id));
        friendsOf(c);
        for (const x of clients.values()) if (t && x.acc?.id === t.id) friendsOf(x);
        if (m.t === 'friendAdd') send(c, { t: 'toast', msg: '친구 요청을 보냈습니다.' });
      } catch (e) { send(c, { t: 'err', msg: e.message }); }
      return;
    }
    case 'invite': {
      const t = [...clients.values()].find(x => x.acc?.id === m.id);
      if (c.acc && t && c.room && c.acc.friends.includes(m.id)) send(t, { t: 'invite', from: c.name, code: c.room.code, mode: c.room.mode });
      return;
    }
    case 'look': if (c.room) R.onMessage(c, m); else c.look = R.cleanLook(m.look); return;
    case 'listLocal': return R.listLocal(c);
    case 'listOnline': return R.listOnline(c, m.region);
    case 'create': return R.create(c, m);
    case 'join': return R.join(c, m);
    case 'mod': return MOD.onMod(c, m);
    default: return R.onMessage(c, m);
  }
}

server.listen(PORT, () => {
  console.log(`\n  AMONG US (팬 제작) 서버 실행 중`);
  console.log(`  이 컴퓨터:   http://localhost:${PORT}`);
  for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) console.log(`  같은 와이파이: http://${i.address}:${PORT}`);
  if (!A.smtpReady()) console.log(`  메일(보호자 인증)은 SMTP 미설정 → http://localhost:${PORT}/outbox 에서 확인\n`);
});
