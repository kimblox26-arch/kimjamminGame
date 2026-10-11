// 숨은 mod 메뉴 (서버 쪽): 비밀번호 인증과 mod 전용 동작. 비밀번호는 서버에만 있고 클라이언트에는 key(HMAC)만 준다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './rooms.js';
import * as GM from './game.js';
import * as RL from './roles.js';
import { ROLE_DEFS } from '../public/js/shared/roles.js';
import { MAPS } from '../public/js/shared/data.js';

const DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const PASSWORD = () => process.env.MOD_PASSWORD || 'amongus_2-gamestudio-;;';
let secret = null;
// 서버 비밀값 (DATA_DIR/secret, 없으면 만들어 저장)
function getSecret() {
  if (secret) return secret;
  const f = path.join(DIR, 'secret');
  try { secret = fs.readFileSync(f, 'utf8').trim(); } catch { /* 첫 실행 */ }
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, secret, { mode: 0o600 }); } catch (e) { console.warn('mod secret 저장 실패', e.message); }
  }
  return secret;
}
export const modKey = () => crypto.createHmac('sha256', getSecret()).update('mod').digest('hex');
const same = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
export const checkKey = k => typeof k === 'string' && k.length === 64 && same(k, modKey());

const send = (c, m) => { if (c?.ws) c.ws.send(JSON.stringify(m)); };
// 비밀번호 시도 제한: 연결당 1분에 5번
function tooMany(c) {
  const t = Date.now();
  c.modTries = (c.modTries || []).filter(x => t - x < 60000);
  if (c.modTries.length >= 5) return true;
  c.modTries.push(t);
  return false;
}
const fin = v => (v !== null && v !== '' && Number.isFinite(+v) ? +v : null);
const roleKey = r => (r === 'crew' ? 'crewmate' : r === 'angel' || r === 'guardianAngel' ? 'guardian' : r);

// hello 의 modKey 자동 인증 (index.js 에서 호출)
export function helloKey(c, key) {
  if (key === undefined || key === null || key === '') return;
  c.mod = checkKey(key);
  send(c, { t: 'mod', a: 'hello', ok: c.mod });
}

export function onMod(c, m) {
  const a = String(m.a || '');
  if (a === 'auth') {
    if (tooMany(c)) return send(c, { t: 'mod', a, ok: false, msg: '너무 많이 시도했습니다. 잠시 후 다시 시도하세요.' });
    const ok = typeof m.pw === 'string' && m.pw.length <= 200 && same(m.pw, PASSWORD());
    if (ok) c.mod = true;
    return send(c, ok ? { t: 'mod', a, ok: true, key: modKey() } : { t: 'mod', a, ok: false, msg: '비밀번호가 틀렸습니다' });
  }
  if (a === 'hello' || a === 'key') {
    const ok = checkKey(m.key);
    if (ok) c.mod = true;
    return send(c, { t: 'mod', a: 'hello', ok });
  }
  if (c.mod !== true) return; // mod 가 아닌 연결은 무시
  const r = c.room, g = r?.game || null, st = g?.st.get(c.id) || null;
  const ack = (extra = {}) => send(c, { t: 'mod', a, ok: true, ...extra });
  const no = msg => send(c, { t: 'mod', a, ok: false, msg });
  const needGame = () => (g ? true : (no('게임 중에만 쓸 수 있습니다.'), false));
  switch (a) {
    case 'status':
      return ack({ noclip: !!c.noclip, nocd: !!c.nocd, speed: c.speedMul || 1, possess: c.possess || null, rainbow: r?.rainbow ? r.rainbow.target : null,
        inRoom: !!r, inGame: !!g, role: st?.role || null, map: g?.map.id || r?.settings.map || null, sabs: g ? Object.keys(g.map.sabotages || {}) : [] });
    // 계정 해킹: 역할 바꾸기 (게임 중 즉시 / 로비에서는 다음 게임에 고정)
    case 'role': {
      const role = roleKey(String(m.role || '')), id = m.id == null ? c.id : String(m.id);
      if (!GM.own(ROLE_DEFS, role)) return no('알 수 없는 역할입니다.');
      if (!r || !r.players.has(id)) return no('플레이어를 찾을 수 없습니다.');
      if (g) {
        if (!g.st.has(id)) return no('이 게임에 없는 플레이어입니다.');
        RL.changeRole(g, id, role);
        return ack({ id, role, now: true });
      }
      r.forced.set(id, role);
      return ack({ id, role, now: false });
    }
    case 'level': {
      const v = fin(m.v);
      if (v === null) return no('숫자를 입력하세요.');
      c.lvl = Math.max(0, Math.min(1e9, Math.round(v)));
      R.refresh(c);
      return ack({ v: c.lvl });
    }
    // 플레이어 해킹
    case 'noclip': c.noclip = m.on === undefined ? !c.noclip : !!m.on; return ack({ on: c.noclip });
    case 'speed': { const v = fin(m.v ?? m.mul); c.speedMul = v && v > 0 ? v : 1; return ack({ v: c.speedMul }); }
    case 'kickAll': {
      if (!r) return no('방에 있어야 합니다.');
      const list = [...r.players.values()].filter(p => p !== c);
      for (const p of list) R.kick(r, p, false);
      return ack({ n: list.length });
    }
    case 'nocd': {
      c.nocd = m.on === undefined ? !c.nocd : !!m.on;
      if (c.nocd && g && st) {
        for (const k of Object.keys(st.cds)) if (st.cds[k] > 0) RL.setCd(g, st, k, 0);
        g.sabCd = 0;
        send(c, { t: 'abilityCd', a: 'sab', ms: 0 });
        send(c, { t: 'doors', ...GM.doorsPub(g), cd: {} });
      }
      return ack({ on: c.nocd });
    }
    case 'killAll': if (!needGame()) return; GM.modKillAll(g, c); return ack();
    case 'win': {
      if (!needGame()) return;
      const team = st?.team || 'crew';
      const why = g.hns ? (team === 'crew' ? '크루원이 끝까지 살아남았습니다' : '크루원이 모두 처치당했습니다') : team === 'crew' ? '크루원이 모든 임무를 완료했습니다' : '임포스터 수가 크루원 수와 같아졌습니다';
      GM.end(g, team, why, 'mod');
      return ack({ team });
    }
    // 설정 해킹 (제한 없음). 방 밖이면 클라이언트가 "방 만들 때 쓸 설정"으로 저장만 함
    case 'settings':
      if (!m.s || typeof m.s !== 'object') return no('설정이 없습니다.');
      if (r) R.applySettings(r, m.s, { unlimited: true });
      return ack({ settings: r?.settings || null });
    // 시스템 해킹
    case 'map': {
      const id = String(m.id || '');
      if (!MAPS.some(x => x.id === id)) return no('알 수 없는 맵입니다.');
      if (!r) return no('방에 있어야 합니다.');
      if (g) { GM.changeMap(g, id); R.bcRoom(r); } else R.applySettings(r, { map: id }, { unlimited: true });
      return ack({ id });
    }
    case 'possess': if (!r) return no('방에 있어야 합니다.'); R.possess(r, c, m.id ?? null); return ack({ id: c.possess || null });
    case 'rainbow': if (!r) return no('방에 있어야 합니다.'); R.setRainbow(r, c, !!m.on, m.target); return ack({ on: !!r.rainbow, target: r.rainbow?.target || null });
    case 'doors': if (!needGame()) return; return GM.closeAllDoors(g) ? ack() : no('지금은 문을 닫을 수 없습니다.');
    case 'sab': {
      if (!needGame()) return;
      const k = String(m.k || '');
      if (!GM.own(g.map.sabotages, k)) return no('이 맵에 없는 방해 공작입니다.');
      return GM.startSab(g, c, st, k, true) ? ack({ k }) : no('지금은 방해 공작을 시작할 수 없습니다.');
    }
    case 'meeting': if (!needGame()) return; return GM.callMeeting(g, c, null) ? ack() : no('지금은 회의를 열 수 없습니다.');
    default: return no('알 수 없는 동작입니다.');
  }
}
