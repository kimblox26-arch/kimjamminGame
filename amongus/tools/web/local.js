// 브라우저 전용판 서버: 원래 Node 서버(index.js)가 하던 메시지 처리를 이 페이지 안에서 한다.
// 클라이언트(core.js net)는 WebSocket 대신 globalThis.AU_LOCAL.connect() 로 만든 가짜 소켓을 쓴다.
import './env.js';
import * as R from './rooms.js';
import * as MOD from './mod.js';
import { ageOf, CHILD_AGE, randomName, isRandomName } from '../shared/data.js';

let nextId = 1;
const BOTS = 7; // 방을 만들면 자동으로 넣는 AI 봇 수
const send = (c, m) => c.ws.send(JSON.stringify(m));
function welcome(c) {
  c.status = ageOf(c.birth) >= 0 && ageOf(c.birth) < CHILD_AGE ? 'teal' : 'pink';
  c.verified = false;
  send(c, { t: 'welcome', id: c.id, status: c.status, name: c.name, account: null });
}
const NO_ACC = '브라우저 전용판에서는 계정을 쓸 수 없어요. 게스트로 플레이해 주세요.';

function handle(c, m) {
  switch (m.t) {
    case 'ping': return send(c, { t: 'pong', ts: m.ts });
    case 'hello':
      c.birth = String(m.birth || '');
      if (isRandomName(m.guestName)) c.name = m.guestName;
      if (m.look && !c.room) c.look = R.cleanLook(m.look);
      welcome(c);
      MOD.helloKey(c, m.modKey);
      if (m.lvl !== undefined) c.lvl = c.mod ? Math.max(0, Math.min(1e9, Math.round(+m.lvl) || 1)) : Math.max(1, Math.min(999, m.lvl | 0));
      send(c, { t: 'friends', friends: [], requests: [] });
      if (!c.greeted) { c.greeted = true; setTimeout(() => send(c, { t: 'toast', msg: '브라우저 전용판: AI 봇과 함께 플레이해요' }), 2600); }
      return R.refresh(c);
    case 'register': case 'login': return send(c, { t: 'authErr', msg: NO_ACC });
    case 'logout': case 'deleteAccount': welcome(c); return;
    case 'resendParent': case 'invite': return;
    case 'rename': case 'friendAdd': case 'friendAccept': case 'friendRemove': return send(c, { t: 'err', msg: NO_ACC });
    case 'look': if (c.room) R.onMessage(c, m); else c.look = R.cleanLook(m.look); return;
    case 'listLocal': return R.listLocal(c);
    case 'listOnline': return R.listOnline(c, m.region);
    case 'create':
      R.create(c, m);
      if (c.room && c.room.mode !== 'practice') R.addBots(c.room, Math.min(BOTS, c.room.settings.maxPlayers - 1));
      return;
    case 'join': return R.join(c, m);
    case 'mod': return MOD.onMod(c, m);
    default: return R.onMessage(c, m);
  }
}

globalThis.AU_LOCAL = {
  connect() {
    // 클라이언트 쪽 소켓 (WebSocket 과 같은 모양)
    const sock = { readyState: 0, onopen: null, onmessage: null, onclose: null,
      send(s) { setTimeout(() => { let m; try { m = JSON.parse(s); } catch { return; } if (!m || typeof m.t !== 'string') return; try { handle(c, m); } catch (e) { console.error(e); send(c, { t: 'err', msg: e.message }); } }, 0); },
      close() {} };
    // 서버 쪽 연결 객체
    const c = { id: 'p' + nextId++, ws: { send: s => setTimeout(() => sock.onmessage?.({ data: s }), 0) }, lan: new Set(['local']), name: randomName(), status: 'pink',
      look: R.cleanLook(), x: 0, y: 0, room: null, acc: null, birth: '' };
    setTimeout(() => { sock.readyState = 1; sock.onopen?.(); }, 0);
    return sock;
  },
};
