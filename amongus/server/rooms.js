// 방(로비) 관리 + 메시지 분배. 게임 규칙은 game.js, 역할 능력은 roles.js, mod 메뉴는 mod.js
import { sanitizeSettings, defaultSettings, applyPreset, buildQuick, COLORS, SETTINGS, HNS_SETTINGS, fmtSetting, PRESETS, CUSTOM,
  REGIONS, MAPS, clamp } from '../public/js/shared/data.js';
import { ROLE_DEFS, ROLE_ORDER } from '../public/js/shared/roles.js';
import { LOBBY, getMap, spawnAt } from '../public/js/shared/maps/index.js';
import * as GM from './game.js';

export const rooms = new Map();
export const MIN = Math.max(1, +process.env.MIN_PLAYERS || 4);
const now = () => Date.now();
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => { let c; do c = Array.from({ length: 6 }, () => L[Math.floor(Math.random() * L.length)]).join(''); while (rooms.has(c)); return c; };

export const send = (c, m) => { if (c?.ws) c.ws.send(JSON.stringify(m)); };
const err = (c, msg) => send(c, { t: 'err', msg });
export function bc(r, m, f) { const s = JSON.stringify(m); for (const c of r.players.values()) if (c.ws && (!f || f(c))) c.ws.send(s); }
const later = (r, f, ms) => r.timers.push(setTimeout(f, ms));
export const pub = GM.pub;
export const info = r => ({ code: r.code, mode: r.mode, host: r.host, settings: r.settings, isPublic: r.isPublic, region: r.region, state: r.state, min: MIN,
  players: [...r.players.values()].map(pub) });
export const bcRoom = r => bc(r, { t: 'room', room: info(r) });
const humans = r => [...r.players.values()].filter(c => !c.bot);
const shareLan = (a, b) => [...a].some(k => b.has(k));
const blockedOnline = c => c.status === 'teal' && !c.verified;
// 받침 있으면 "으로" (ㄹ 받침은 "로")
const ro = s => { s = String(s); const ch = s.charCodeAt(s.length - 1) - 0xac00; return ch >= 0 && ch < 11172 && ch % 28 && ch % 28 !== 8 ? '으로' : '로'; };

const ID_RE = /^[a-z0-9_]{1,16}$/;
export function cleanLook(l = {}) {
  const o = { color: clamp(Math.round(+l?.color) || 0, 0, COLORS.length - 1) };
  for (const k of ['hat', 'visor', 'skin', 'pet', 'plate']) o[k] = ID_RE.test(l?.[k]) ? l[k] : 'none';
  return o;
}
function freeColor(r, c, want) {
  const used = new Set([...r.players.values()].filter(p => p !== c).map(p => p.look.color));
  if (want != null && COLORS[want] && !used.has(want)) return want;
  if (!used.has(c.look.color)) return c.look.color;
  const i = COLORS.findIndex((_, k) => !used.has(k));
  return i < 0 ? c.look.color : i;
}
function lobbySpot(r, i) {
  const n = Math.max(10, r.players.size);
  return spawnAt(LOBBY, LOBBY.spawn, i, n);
}
function listing(r) {
  const h = r.players.get(r.host), s = r.settings;
  return { code: r.code, host: h?.name || '', look: h?.look, n: r.players.size, max: s.maxPlayers, map: s.map, gameType: s.gameType,
    impostors: s.impostors, speed: s.playerSpeed, roles: s.roles, chatType: s.chatType, chatLang: s.chatLang, tag: s.tag,
    kill: s.killCooldown, voting: s.votingTime, visual: s.visualTasks, anon: s.anonVotes };
}
export function listLocal(c) {
  send(c, { t: 'list', kind: 'local', rooms: [...rooms.values()].filter(r => r.mode === 'local' && r.state === 'lobby' && shareLan(r.lan, c.lan)).map(listing) });
}
export function listOnline(c, region) {
  const all = [...rooms.values()].filter(r => r.mode === 'online' && r.region === region);
  const list = all.filter(r => r.isPublic && r.state === 'lobby' && r.players.size < r.settings.maxPlayers).map(listing);
  send(c, { t: 'list', kind: 'online', rooms: list, total: all.length });
}

// ---------- 방 만들기 / 참가 / 나가기 ----------
function newRoom(c, mode, region, settings) {
  const r = { code: newCode(), mode, lan: c.lan, region, isPublic: mode === 'online', host: c.id, settings, state: 'lobby', players: new Map(), game: null,
    timers: [], forced: new Map(), banned: new Set(), unlimited: false, rainbow: null, countdown: 0, lastLook: 0 };
  r.hooks = { toLobby: () => toLobby(r) };
  rooms.set(r.code, r);
  return r;
}
export function create(c, m = {}) {
  const mode = ['local', 'practice'].includes(m.mode) ? m.mode : 'online';
  if (mode === 'online' && blockedOnline(c)) return err(c, '보호자 인증을 완료해야 온라인에서 플레이할 수 있습니다.');
  const region = REGIONS.some(g => g[0] === m.region) ? m.region : 'as';
  const unl = !!c.mod; // mod 연결: 설정 제한 없음
  const r = newRoom(c, mode, region, sanitizeSettings(m.settings || {}, defaultSettings(), { unlimited: unl }));
  r.unlimited = unl;
  enter(c, r);
  if (mode === 'practice') startPractice(r, c, m);
}
export function join(c, m) {
  const r = rooms.get(String(m.code || '').trim().toUpperCase());
  if (!r || r.mode === 'practice') return err(c, '게임을 찾을 수 없습니다. 코드를 확인하세요.');
  if (r.mode === 'local' && !shareLan(r.lan, c.lan)) return err(c, '로컬 게임은 같은 와이파이(네트워크)에 연결된 사람만 참가할 수 있습니다.');
  if (r.mode === 'online' && blockedOnline(c)) return err(c, '보호자 인증을 완료해야 온라인에서 플레이할 수 있습니다.');
  if (r.state !== 'lobby') return err(c, '이미 게임이 시작되었습니다.');
  if (r.players.size >= r.settings.maxPlayers && !c.mod) return err(c, '게임이 가득 찼습니다.');
  if (r.banned.has(c.acc?.id || c.id)) return err(c, '이 게임에서 추방당했습니다.');
  enter(c, r);
}
function enter(c, r) {
  if (c.room) leave(c);
  c.room = r;
  c.look.color = freeColor(r, c);
  const sp = lobbySpot(r, r.players.size); c.x = sp.x; c.y = sp.y; c.dir = 1; c.mv = 0;
  c.possess = null; c.possessedBy = null;
  r.players.set(c.id, c);
  send(c, { t: 'joined', room: info(r), you: c.id, min: MIN });
  bc(r, { t: 'room', room: info(r) }, p => p !== c);
  bc(r, { t: 'chat', sys: true, text: `${c.name}님이 게임에 참가했습니다.` }, p => p !== c);
}
export function leave(c) {
  const r = c.room;
  if (!r) return;
  const g = r.game;
  releasePossess(r, c);
  if (c.possessedBy) { const m = r.players.get(c.possessedBy); if (m) releasePossess(r, m); }
  if (r.rainbow?.by === c.id) stopRainbow(r);
  if (g) GM.onLeave(g, c);
  c.room = null;
  r.players.delete(c.id);
  r.forced.delete(c.id);
  if (!humans(r).length) return close(r);
  if (r.host === c.id) r.host = humans(r)[0].id;
  bcRoom(r);
  bc(r, { t: 'gone', id: c.id, name: c.name });
  bc(r, { t: 'chat', sys: true, text: `${c.name}님이 게임을 나갔습니다.` });
}
function close(r) {
  r.timers.forEach(clearTimeout);
  if (r.game) r.game.over = true;
  r.game = null;
  rooms.delete(r.code);
}
export const refresh = c => { if (c.room) bcRoom(c.room); };
// 강퇴 (방장 또는 mod)
export function kick(r, t, ban) {
  if (!t || t.room !== r) return;
  if (ban) r.banned.add(t.acc?.id || t.id);
  if (t.bot) {
    if (r.game) GM.onLeave(r.game, t);
    r.players.delete(t.id);
    bcRoom(r);
    bc(r, { t: 'gone', id: t.id, name: t.name });
    return;
  }
  leave(t);
  send(t, { t: 'kicked', ban: !!ban });
}

// ---------- 메시지 ----------
export function onMessage(c, m) {
  const r = c.room;
  if (!r) return;
  const g = r.game, host = r.host === c.id;
  switch (m.t) {
    case 'leave': leave(c); send(c, { t: 'leftRoom' }); return;
    case 'move': return onMove(r, c, m);
    case 'look':
      if (!g && !r.rainbow) { const l = cleanLook(m.look); l.color = freeColor(r, c, l.color); c.look = l; bcRoom(r); }
      return;
    case 'chat': return chat(c, r, m);
    case 'settings': if (host && !g && !r.countdown) applySettings(r, m.s); return;
    case 'privacy': if (host && r.mode === 'online') { r.isPublic = !!m.v; bcRoom(r); } return;
    case 'kick': {
      const t = r.players.get(m.id);
      if (host && !g && t && t !== c && !t.bot) kick(r, t, !!m.ban);
      return;
    }
    case 'start': if (host && !g && !r.countdown) countdown(r, c); return;
    default: if (g) GM.onMsg(c, m);
  }
}

// 이동: mod 조종(possess)이면 대상이 움직이고, 조종당하는 사람의 이동은 무시
function onMove(r, c, m) {
  if (typeof m.x !== 'number' || typeof m.y !== 'number' || !isFinite(m.x + m.y)) return;
  let who = c;
  if (m.as != null && m.as !== c.id) {
    if (!c.mod || c.possess !== m.as) return;
    who = r.players.get(m.as);
    if (!who) return;
  } else if (c.possessedBy && r.players.get(c.possessedBy)?.possess === c.id) return;
  const g = r.game, x = clamp(m.x, -500, 12000), y = clamp(m.y, -500, 9000);
  if (g) {
    if (!GM.canMove(g, who)) return;
    if (!(c.noclip || who.noclip) && !GM.moveOk(g, who, x, y)) return;
  }
  who.x = x; who.y = y; who.dir = m.d ? 1 : 0; who.mv = m.m ? 1 : 0;
}

// 채팅: 자유 채팅은 초록불 + 자유 채팅 로비만, 살아있으면 회의 중에만, 유령 채팅은 유령끼리만
function chat(c, r, m) {
  const g = r.game, st = g?.st.get(c.id);
  const ghost = !!g && (!st || !st.alive);
  if (g && !ghost && g.phase !== 'meeting') return;
  if (g?.practice) return;
  let text;
  if (m.q) {
    const map = g ? g.map : getMap(r.settings.map);
    text = buildQuick(m.q, [...r.players.values()].map(p => p.name), map.roomNames || []);
  } else {
    if (c.status !== 'green') return err(c, c.status === 'teal' ? '만 14세 미만 계정은 빠른 채팅만 쓸 수 있습니다.' : '게스트 계정은 빠른 채팅만 쓸 수 있습니다.');
    if (r.settings.chatType !== 'free') return err(c, '이 로비는 빠른 채팅 전용입니다.');
    text = String(m.text || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
  }
  if (!text || now() - (c.lastChat || 0) < 500) return;
  c.lastChat = now();
  bc(r, { t: 'chat', id: c.id, name: c.name, look: c.look, text, quick: !!m.q, ghost }, p => !ghost || !g.st.get(p.id)?.alive);
}

// ---------- 설정 ----------
const roleLabel = r => ROLE_DEFS[r]?.name || r;
// opts.unlimited: mod 설정 해킹 (범위 제한 없음, 게임 중에도 적용)
export function applySettings(r, s = {}, opts = {}) {
  if (!s || typeof s !== 'object') return;
  const old = r.settings, unl = !!opts.unlimited;
  let next;
  if (GM.own(PRESETS, s.preset) && (s.preset !== old.preset || Object.keys(s).length === 1)) {
    next = applyPreset(s.preset, old);
  } else {
    next = sanitizeSettings({ ...s, preset: undefined }, old, { unlimited: unl });
    const rows = [...SETTINGS, ...HNS_SETTINGS];
    const changed = rows.some(d => next[d[0]] !== old[d[0]]) || JSON.stringify(next.roleSet) !== JSON.stringify(old.roleSet);
    if (next.gameType !== old.gameType && old.preset !== CUSTOM) next.preset = next.gameType === 'hns' ? (next.flashlight ? '손전등' : '피치 다크') : (next.roles ? '다양한 역할' : '핵심 설정');
    else if (changed) next.preset = CUSTOM;
    if (typeof s.preset === 'string' && s.preset === CUSTOM) next.preset = CUSTOM;
  }
  if (!unl) next.maxPlayers = Math.max(next.maxPlayers, r.players.size);
  if (unl) r.unlimited = true;
  // 설정 변경 기록 (원작: "{0} 항목을 {1}로 설정함.")
  const lines = [], hns = next.gameType === 'hns';
  for (const d of hns ? HNS_SETTINGS : SETTINGS) {
    if (next[d[0]] === old[d[0]]) continue;
    let v = fmtSetting(d, next[d[0]], true);
    if (d[2] === 'p') v = r.players.get(next[d[0]])?.name || '무작위';
    lines.push(`${d[1]} 항목을 ${v}${ro(v)} 설정함.`);
  }
  if (!hns) {
    for (const k of ROLE_ORDER) {
      const a = old.roleSet?.[k] || {}, b = next.roleSet?.[k] || {};
      if (a.max !== b.max || a.chance !== b.chance) lines.push(`${roleLabel(k)} 항목을 ${b.max}${ro(String(b.max))} 설정함. 확률:${b.chance}%`);
      for (const d of ROLE_DEFS[k].opts || []) if (a[d[0]] !== b[d[0]]) { const v = fmtSetting(d, b[d[0]], true); lines.push(`${roleLabel(k)}: ${d[1]} 항목을 ${v}${ro(v)} 설정함.`); }
    }
  }
  if (next.maxPlayers !== old.maxPlayers) lines.push(`최대 인원 항목을 ${next.maxPlayers}${ro(next.maxPlayers)} 설정함.`);
  if (next.gameType !== old.gameType) lines.push(`게임 유형을 ${next.gameType === 'hns' ? '숨바꼭질' : '클래식'}${ro(next.gameType === 'hns' ? '숨바꼭질' : '클래식')} 설정함.`);
  if (next.map !== old.map) { const n = MAPS.find(x => x.id === next.map)?.ko || next.map; lines.push(`맵 항목을 ${n}${ro(n)} 설정함.`); }
  if (next.preset !== old.preset && next.preset !== CUSTOM) lines.push(`프리셋을 ${next.preset}${ro(next.preset)} 설정함.`);
  if (next.chatType !== old.chatType) lines.push(`채팅 유형을 ${next.chatType === 'free' ? '자유 채팅' : '빠른 채팅 전용'}${ro(next.chatType === 'free' ? '자유 채팅' : '빠른 채팅 전용')} 설정함.`);
  r.settings = next;
  bcRoom(r);
  if (lines.length) bc(r, { t: 'log', lines: lines.slice(0, 40) });
  if (next.map !== old.map && !r.game) bc(r, { t: 'mapChange', map: next.map });
  if (r.game) { r.game.s = next; GM.onSettings(r.game); }
}

// ---------- 시작 ----------
function countdown(r, c) {
  if (r.players.size < MIN) return err(c, `게임을 시작하려면 최소 ${MIN}명이 필요합니다.`);
  r.countdown = 5;
  bc(r, { t: 'countdown', n: 5 });
  const tick = () => {
    if (!rooms.has(r.code) || r.game) return;
    if (r.players.size < MIN) { r.countdown = 0; return bc(r, { t: 'countdown', n: 0 }); }
    if (--r.countdown <= 0) { r.countdown = 0; return startGame(r); }
    bc(r, { t: 'countdown', n: r.countdown });
    later(r, tick, 1000);
  };
  later(r, tick, 1000);
}
export function startGame(r, opt) {
  r.countdown = 0;
  if (r.mode === 'practice' && !opt) opt = { role: r.practiceRole }; // 연습 방에서 다시 시작: 마지막에 고른 역할
  for (const p of r.players.values()) { p.mv = 0; }
  return GM.startGame(r, opt);
}
// 연습 모드: 고른 역할·맵 + 더미 플레이어 (승리 판정 없음)
const PRACTICE = { killCooldown: 10, emergencyMeetings: 9, emergencyCooldown: 0, discussionTime: 0, votingTime: 30, commonTasks: 2, longTasks: 3, shortTasks: 5, impostors: 1 };
function startPractice(r, c, m) {
  const map = MAPS.some(x => x.id === m.map) ? m.map : MAPS.some(x => x.id === m.settings?.map) ? m.settings.map : 'skeld';
  r.settings = sanitizeSettings({ ...PRACTICE, map }, defaultSettings(), { unlimited: true });
  r.isPublic = false;
  for (let i = 0; i < 6; i++) {
    const b = { id: `b${r.code}${i}`, bot: true, name: `더미 ${i + 1}`, status: 'pink', look: cleanLook({ color: 0 }), dir: 1, mv: 0, x: 0, y: 0, lvl: 1, room: r };
    b.look.color = freeColor(r, b, (c.look.color + 1 + i * 3) % COLORS.length);
    r.players.set(b.id, b);
  }
  bcRoom(r);
  const role = GM.own(ROLE_DEFS, m.role) ? m.role : 'crewmate';
  r.practiceRole = role;
  startGame(r, { role });
}
// 게임이 끝나면 대기실로
function toLobby(r) {
  r.forced = new Map();
  const ps = [...r.players.values()];
  ps.forEach((p, i) => { const sp = lobbySpot(r, i); p.x = sp.x; p.y = sp.y; p.mv = 0; });
  later(r, () => { if (rooms.has(r.code) && !r.game) bcRoom(r); }, 50);
}

// ---------- mod: 조종 / 무지개 ----------
export function possess(r, c, id) {
  releasePossess(r, c);
  const t = id != null && r.players.get(String(id));
  if (!t || t === c) return send(c, { t: 'possess', by: c.id, target: null });
  if (t.possessedBy && t.possessedBy !== c.id) { const o = r.players.get(t.possessedBy); if (o) releasePossess(r, o); }
  c.possess = t.id; t.possessedBy = c.id;
  const msg = { t: 'possess', by: c.id, target: t.id };
  send(c, msg); send(t, msg);
}
export function releasePossess(r, c) {
  if (!c.possess) return;
  const t = r.players.get(c.possess);
  c.possess = null;
  if (t && t.possessedBy === c.id) { t.possessedBy = null; send(t, { t: 'possess', by: c.id, target: null, prev: t.id }); }
  send(c, { t: 'possess', by: c.id, target: null, prev: t?.id || null });
}
export function setRainbow(r, c, on, target) {
  if (!on) return stopRainbow(r);
  stopRainbow(r);
  r.rainbow = { by: c.id, target: target === 'all' ? 'all' : 'me', orig: new Map([...r.players.values()].map(p => [p.id, p.look.color])), i: 0 };
}
function stopRainbow(r) {
  const R = r.rainbow;
  if (!R) return;
  r.rainbow = null;
  for (const p of r.players.values()) if (R.orig.has(p.id) && (R.target === 'all' || p.id === R.by)) { p.look = { ...p.look, color: R.orig.get(p.id) }; bc(r, { t: 'look', id: p.id, look: p.look }); }
  if (!r.game) bcRoom(r);
}
function rainbowTick(r) {
  const R = r.rainbow;
  R.i++;
  const list = [...r.players.values()].filter(p => R.target === 'all' || p.id === R.by);
  if (!list.length) { r.rainbow = null; return; }
  list.forEach((p, k) => { p.look = { ...p.look, color: (R.i + k * 3) % COLORS.length }; bc(r, { t: 'look', id: p.id, look: p.look }); });
}

// ---------- 위치 동기화 + 게임 시간 처리 (15Hz) ----------
let lastT = now();
setInterval(() => {
  const t = now(), dt = Math.min(250, t - lastT);
  lastT = t;
  for (const r of [...rooms.values()]) {
    try {
      const g = r.game;
      if (g) GM.tick(g, dt);
      if (r.rainbow && t - r.lastLook >= 250) { r.lastLook = t; rainbowTick(r); }
      if (!humans(r).length) continue;
      const g2 = r.game;
      const p = [];
      for (const q of r.players.values()) {
        if (g2 && GM.hiddenPos(g2, q.id)) continue;
        p.push([q.id, Math.round(q.x), Math.round(q.y), q.dir ? 1 : 0, q.mv ? 1 : 0, g2 ? GM.flags(g2, q.id) : 0]);
      }
      bc(r, { t: 'pos', p });
    } catch (e) { console.error('room tick', r.code, e); }
  }
}, 66);

