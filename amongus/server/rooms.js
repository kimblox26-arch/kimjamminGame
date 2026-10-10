// 방(로비) 관리 + 게임 진행 로직 (서버 권한)
import { stationsFor, tasksOfKind, sanitizeSettings, defaultSettings, buildQuick, maxImpostors, COLORS, SETTINGS, fmtSetting,
  SABOTAGES, PRESETS, REGIONS, shuffle, clamp } from '../public/js/shared/data.js';
import { SKELD, LOBBY, ROOM_NAMES } from '../public/js/shared/maps.js';

export const rooms = new Map();
const MIN = Math.max(1, +process.env.MIN_PLAYERS || 4);
const KILL_D = [200, 260, 350];
const now = () => Date.now();
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => { let c; do c = Array.from({ length: 6 }, () => L[Math.floor(Math.random() * L.length)]).join(''); while (rooms.has(c)); return c; };

const send = (c, m) => c.ws?.send(JSON.stringify(m));
const err = (c, msg) => send(c, { t: 'err', msg });
function bc(r, m, f) { const s = JSON.stringify(m); for (const c of r.players.values()) if (c.ws && (!f || f(c))) c.ws.send(s); }
const later = (r, f, ms) => r.timers.push(setTimeout(f, ms));
const pub = c => ({ id: c.id, name: c.name, status: c.status, look: c.look, x: Math.round(c.x), y: Math.round(c.y), bot: !!c.bot, lvl: c.lvl || 1 });
const info = r => ({ code: r.code, mode: r.mode, host: r.host, settings: r.settings, isPublic: r.isPublic, region: r.region, state: r.state, players: [...r.players.values()].map(pub) });
const humans = r => [...r.players.values()].filter(c => !c.bot);
const shareLan = (a, b) => [...a].some(k => b.has(k));
const blockedOnline = c => c.status === 'teal' && !c.verified;
// 받침 있으면 "으로"
const ro = s => { const ch = s.charCodeAt(s.length - 1) - 0xac00; return ch >= 0 && ch < 11172 && ch % 28 && ch % 28 !== 8 ? '으로' : '로'; };

const ID_RE = /^[a-z0-9_]{1,16}$/;
export function cleanLook(l = {}) {
  const o = { color: clamp(Math.round(+l.color) || 0, 0, COLORS.length - 1) };
  for (const k of ['hat', 'visor', 'skin', 'pet', 'plate']) o[k] = ID_RE.test(l[k]) ? l[k] : 'none';
  return o;
}
function freeColor(r, c, want) {
  const used = new Set([...r.players.values()].filter(p => p !== c).map(p => p.look.color));
  if (want != null && COLORS[want] && !used.has(want)) return want;
  if (!used.has(c.look.color)) return c.look.color;
  return COLORS.findIndex((_, i) => !used.has(i));
}
function listing(r) {
  const h = r.players.get(r.host), s = r.settings;
  return { code: r.code, host: h?.name || '', look: h?.look, n: r.players.size, max: s.maxPlayers, map: s.map, gameType: s.gameType,
    impostors: s.impostors, speed: s.playerSpeed, roles: s.roles, chatType: s.chatType, chatLang: s.chatLang, tag: s.tag };
}
export function listLocal(c) {
  send(c, { t: 'list', kind: 'local', rooms: [...rooms.values()].filter(r => r.mode === 'local' && r.state === 'lobby' && shareLan(r.lan, c.lan)).map(listing) });
}
export function listOnline(c, region) {
  const all = [...rooms.values()].filter(r => r.mode === 'online' && r.region === region);
  const list = all.filter(r => r.isPublic && r.state === 'lobby' && r.players.size < r.settings.maxPlayers).map(listing);
  send(c, { t: 'list', kind: 'online', rooms: list, total: all.length });
}

export function create(c, m) {
  const mode = ['local', 'practice'].includes(m.mode) ? m.mode : 'online';
  if (mode === 'online' && blockedOnline(c)) return err(c, '보호자 인증을 완료해야 온라인에서 플레이할 수 있습니다.');
  const r = { code: newCode(), mode, lan: c.lan, region: REGIONS.some(g => g[0] === m.region) ? m.region : 'as', isPublic: mode === 'online',
    host: c.id, settings: sanitizeSettings(m.settings || {}), state: 'lobby', players: new Map(), game: null, timers: [] };
  rooms.set(r.code, r);
  enter(c, r);
  if (mode === 'practice') startPractice(r, c, m.role);
}
export function join(c, m) {
  const r = rooms.get(String(m.code || '').trim().toUpperCase());
  if (!r || r.mode === 'practice') return err(c, '게임을 찾을 수 없습니다. 코드를 확인하세요.');
  if (r.mode === 'local' && !shareLan(r.lan, c.lan)) return err(c, '로컬 게임은 같은 와이파이(네트워크)에 연결된 사람만 참가할 수 있습니다.');
  if (r.mode === 'online' && blockedOnline(c)) return err(c, '보호자 인증을 완료해야 온라인에서 플레이할 수 있습니다.');
  if (r.state !== 'lobby') return err(c, '이미 게임이 시작되었습니다.');
  if (r.players.size >= r.settings.maxPlayers) return err(c, '게임이 가득 찼습니다.');
  if (r.banned?.has(c.id)) return err(c, '이 게임에서 추방당했습니다.');
  enter(c, r);
}
function enter(c, r) {
  if (c.room) leave(c);
  c.room = r;
  c.look.color = freeColor(r, c);
  const sp = LOBBY.spawn(r.players.size); c.x = sp.x; c.y = sp.y; c.dir = 1; c.mv = 0;
  r.players.set(c.id, c);
  send(c, { t: 'joined', room: info(r), you: c.id, min: MIN });
  bc(r, { t: 'room', room: info(r) }, p => p !== c);
  bc(r, { t: 'chat', sys: true, text: `${c.name}님이 게임에 참가했습니다.` }, p => p !== c);
}
export function leave(c) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  r.players.delete(c.id);
  const g = r.game;
  if (g) { g.alive.delete(c.id); g.left.add(c.id); g.vent.delete(c.id); g.meeting?.votes.delete(c.id); }
  if (!humans(r).length) return close(r);
  if (r.host === c.id) r.host = humans(r)[0].id;
  bc(r, { t: 'room', room: info(r) });
  bc(r, { t: 'gone', id: c.id, name: c.name });
  if (g) { pushBar(r); if (g.meeting?.stage === 'vote') maybeTally(r); checkWin(r); }
}
function close(r) {
  r.timers.forEach(clearTimeout);
  r.game?.mt?.forEach(clearTimeout);
  rooms.delete(r.code);
}
export const refresh = c => { if (c.room) bc(c.room, { t: 'room', room: info(c.room) }); };

export function onMessage(c, m) {
  const r = c.room;
  if (!r) return;
  const g = r.game, host = r.host === c.id;
  switch (m.t) {
    case 'leave': leave(c); send(c, { t: 'leftRoom' }); break;
    case 'move':
      if (typeof m.x === 'number' && typeof m.y === 'number' && isFinite(m.x + m.y) && (!g || (g.phase === 'play' && !g.vent.has(c.id)))) {
        c.x = clamp(m.x, -500, 10000); c.y = clamp(m.y, -500, 6000); c.dir = m.d ? 1 : 0; c.mv = m.m ? 1 : 0;
      }
      break;
    case 'look':
      if (!g) { const l = cleanLook(m.look); l.color = freeColor(r, c, l.color); c.look = l; bc(r, { t: 'room', room: info(r) }); }
      break;
    case 'chat': chat(c, r, m); break;
    case 'settings': if (host && !g) applySettings(r, m.s); break;
    case 'privacy': if (host && r.mode === 'online') { r.isPublic = !!m.v; bc(r, { t: 'room', room: info(r) }); } break;
    case 'kick': {
      const t = r.players.get(m.id);
      if (host && !g && t && t !== c && !t.bot) { if (m.ban) (r.banned ||= new Set()).add(t.id); leave(t); send(t, { t: 'kicked', ban: !!m.ban }); }
      break;
    }
    case 'start': if (host && !g && !r.countdown) countdown(r, c); break;
    default: if (g) gameMsg(c, r, g, m);
  }
}

function chat(c, r, m) {
  const g = r.game;
  if (g && g.phase !== 'meeting' && g.alive.has(c.id)) return; // 살아있으면 회의 중에만 채팅
  if (g && g.practice) return;
  let text;
  if (m.q) text = buildQuick(m.q, [...r.players.values()].map(p => p.name), ROOM_NAMES);
  else {
    if (c.status !== 'green') return err(c, c.status === 'teal' ? '만 14세 미만 계정은 빠른 채팅만 쓸 수 있습니다.' : '게스트 계정은 빠른 채팅만 쓸 수 있습니다.');
    if (r.settings.chatType !== 'free') return err(c, '이 로비는 빠른 채팅 전용입니다.');
    text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  }
  if (!text || now() - (c.lastChat || 0) < 500) return;
  c.lastChat = now();
  const ghost = !!g && !g.alive.has(c.id);
  bc(r, { t: 'chat', id: c.id, name: c.name, look: c.look, text, quick: !!m.q, ghost }, p => !ghost || !g.alive.has(p.id));
}

function applySettings(r, s = {}) {
  const old = r.settings;
  let next;
  if (s.preset && PRESETS[s.preset]) {
    next = sanitizeSettings({ ...PRESETS[s.preset], preset: s.preset },
      { ...defaultSettings(), map: old.map, gameType: old.gameType, maxPlayers: old.maxPlayers, tag: old.tag, chatType: old.chatType, chatLang: old.chatLang, roles: old.roles });
  } else {
    next = sanitizeSettings(s, old);
    if (SETTINGS.some(d => next[d[0]] !== old[d[0]])) next.preset = '커스텀';
  }
  next.maxPlayers = Math.max(next.maxPlayers, r.players.size);
  const lines = SETTINGS.filter(d => next[d[0]] !== old[d[0]]).map(d => { const v = fmtSetting(d, next[d[0]], true); return `${d[1]} 항목을 ${v}${ro(v)} 설정함.`; });
  if (next.maxPlayers !== old.maxPlayers) lines.push(`최대 인원 항목을 ${next.maxPlayers}${ro(String(next.maxPlayers))} 설정함.`);
  if (next.gameType !== old.gameType) lines.push(`게임 유형을 ${next.gameType === 'hns' ? '숨바꼭질' : '클래식'}(으)로 설정함.`);
  r.settings = next;
  bc(r, { t: 'room', room: info(r) });
  if (lines.length) bc(r, { t: 'log', lines });
}

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

function startGame(r, pre) {
  const s = r.settings, ps = [...r.players.values()], ids = ps.map(p => p.id), hns = s.gameType === 'hns';
  const nImp = pre ? pre.nImp : hns ? 1 : Math.min(s.impostors, maxImpostors(ids.length));
  const order = pre ? pre.order : shuffle([...ids]);
  const roles = new Map(ids.map(id => [id, 'crew']));
  order.slice(0, nImp).forEach(id => roles.set(id, 'impostor'));
  if (s.roles && !hns && !pre) {
    const crew = shuffle(ids.filter(id => roles.get(id) === 'crew'));
    if (crew[0] && Math.random() < 0.7) roles.set(crew[0], 'engineer');
    if (crew[1] && Math.random() < 0.7) roles.set(crew[1], 'scientist');
  }
  // 일반 임무는 모두 같은 위치, 나머지는 사람마다 다름
  const common = shuffle(tasksOfKind('common')).slice(0, s.commonTasks).map(id => ({ id, st: stationsFor(id) }));
  const tasks = new Map(ids.map(id => [id, [...common.map(t => ({ ...t, st: [...t.st], step: 0 })),
    ...[...shuffle(tasksOfKind('long')).slice(0, s.longTasks), ...shuffle(tasksOfKind('short')).slice(0, s.shortTasks)].map(t => ({ id: t, st: stationsFor(t), step: 0 }))]]));
  const t0 = now();
  r.game = { roles, alive: new Set(ids), left: new Set(), tasks, bodies: [], killAt: new Map(ids.map(id => [id, t0 + 10000])),
    meetings: new Map(ids.map(id => [id, s.emergencyMeetings])), emergAt: t0 + s.emergencyCooldown * 1000, phase: 'play', sab: null,
    sabAt: t0 + 15000, vent: new Map(), meeting: null, mt: [], hnsEnd: hns ? t0 + (s.hnsTime + 6) * 1000 : 0, practice: r.mode === 'practice' };
  r.state = 'game';
  ps.forEach((p, i) => { const sp = SKELD.spawn(i, ps.length); p.x = sp.x; p.y = sp.y; p.mv = 0; });
  const imps = ids.filter(id => roles.get(id) === 'impostor');
  for (const p of ps) {
    const role = roles.get(p.id);
    send(p, { t: 'start', role, mates: role === 'impostor' || hns ? imps : [], tasks: tasks.get(p.id), players: ps.map(pub), settings: s,
      bar: taskBar(r.game), hnsLeft: hns ? r.game.hnsEnd - t0 : 0, kill: 10000, meetings: s.emergencyMeetings, practice: !!pre });
  }
}
function startPractice(r, c, role) {
  r.settings = sanitizeSettings({ killCooldown: 10, emergencyMeetings: 9, emergencyCooldown: 0, discussionTime: 0, votingTime: 30, commonTasks: 2, longTasks: 3, shortTasks: 5 });
  const bots = [];
  for (let i = 0; i < 5; i++) {
    const b = { id: `b${r.code}${i}`, bot: true, name: `더미 ${i + 1}`, status: 'pink', look: cleanLook({ color: 0 }), dir: 1, mv: 0, x: 0, y: 0 };
    b.look.color = freeColor(r, b, (c.look.color + 1 + i * 3) % COLORS.length);
    r.players.set(b.id, b); bots.push(b.id);
  }
  startGame(r, role === 'impostor' ? { nImp: 1, order: [c.id, ...bots] } : { nImp: 0, order: [] });
}

function taskBar(g) {
  let total = 0, done = 0;
  for (const [id, list] of g.tasks) {
    if (g.left.has(id) || g.roles.get(id) === 'impostor' || id.startsWith?.('b')) continue;
    for (const t of list) { total++; if (t.step >= t.st.length) done++; }
  }
  return { total, done };
}
const pushBar = r => { if (r.settings.taskBar === 0) bc(r, { t: 'bar', bar: taskBar(r.game) }); };
const sabPub = g => g.sab && { k: g.sab.k, left: g.sab.until ? g.sab.until - now() : 0, parts: Object.keys(g.sab.parts).filter(p => g.sab.parts[p]) };

function gameMsg(c, r, g, m) {
  const alive = g.alive.has(c.id), role = g.roles.get(c.id), imp = role === 'impostor', hns = r.settings.gameType === 'hns';
  switch (m.t) {
    case 'kill': {
      const v = r.players.get(m.id);
      if (!imp || !alive || g.phase !== 'play' || g.vent.has(c.id) || now() < g.killAt.get(c.id) - 300) return;
      if (!v || !g.alive.has(v.id) || g.roles.get(v.id) === 'impostor' || g.vent.has(v.id)) return;
      if (d2(c, v) > KILL_D[r.settings.killDistance] * 1.4 + 80) return;
      g.alive.delete(v.id);
      g.bodies.push({ id: v.id, x: v.x, y: v.y });
      c.x = v.x; c.y = v.y;
      g.killAt.set(c.id, now() + (hns ? 5 : r.settings.killCooldown) * 1000);
      bc(r, { t: 'kill', id: v.id, by: c.id, x: v.x, y: v.y, cd: (hns ? 5 : r.settings.killCooldown) * 1000 });
      checkWin(r);
      break;
    }
    case 'report': {
      const b = g.bodies.find(b => b.id === m.id);
      if (alive && g.phase === 'play' && !hns && b && d2(c, b) < 450) meeting(r, c, b.id);
      break;
    }
    case 'emergency': {
      if (!alive || g.phase !== 'play' || hns || (g.meetings.get(c.id) || 0) <= 0 || now() < g.emergAt) return;
      if (g.sab && SABOTAGES[g.sab.k].critical) return err(c, '긴급 상황 중에는 회의를 소집할 수 없습니다.');
      if (d2(c, SKELD.button) > 520) return;
      g.meetings.set(c.id, g.meetings.get(c.id) - 1);
      meeting(r, c, null);
      break;
    }
    case 'vote': vote(r, g, c, m.id); break;
    case 'task': {
      const list = g.tasks.get(c.id), t = list?.[m.i];
      if (!t || imp || t.step >= t.st.length || g.phase !== 'play') return;
      t.step++;
      send(c, { t: 'tasks', tasks: list });
      if (t.step >= t.st.length) { pushBar(r); checkWin(r); }
      break;
    }
    case 'visual': if (r.settings.visualTasks && alive) bc(r, { t: 'visual', id: c.id, k: String(m.k).slice(0, 10), on: !!m.on }); break;
    case 'sab': {
      const S = SABOTAGES[m.k];
      if (!S || !imp || g.phase !== 'play' || g.sab || hns) return;
      if (now() < g.sabAt) return err(c, `사보타주 쿨다운: ${Math.ceil((g.sabAt - now()) / 1000)}초`);
      g.sab = { k: m.k, until: S.time ? now() + S.time * 1000 : 0, parts: {} };
      bc(r, { t: 'sab', sab: sabPub(g) });
      break;
    }
    case 'fix': {
      const sab = g.sab, S = sab && SABOTAGES[sab.k];
      if (!sab || sab.k !== m.k || !alive || g.phase !== 'play' || !S.parts.includes(m.p)) return;
      sab.parts[m.p] = S.together ? (m.on ? c.id : null) : c.id;
      if (S.parts.every(p => sab.parts[p])) { g.sab = null; g.sabAt = now() + 30000; bc(r, { t: 'sab', sab: null, fixed: sab.k }); }
      else bc(r, { t: 'sab', sab: sabPub(g) });
      break;
    }
    case 'vent': {
      if (!alive || g.phase !== 'play' || !(imp || role === 'engineer') || hns) return;
      const cur = g.vent.get(c.id), v = SKELD.vents[m.v];
      if (m.a === 'in') { if (!v || cur || d2(c, v) > 300) return; g.vent.set(c.id, m.v); c.x = v.x; c.y = v.y; }
      else if (m.a === 'move') { if (!v || !cur || !SKELD.vents[cur].links.includes(m.v)) return; g.vent.set(c.id, m.v); c.x = v.x; c.y = v.y; }
      else if (m.a === 'out') { if (!cur) return; g.vent.delete(c.id); }
      else return;
      bc(r, { t: 'vent', id: c.id, v: g.vent.get(c.id) || null, a: m.a, x: c.x, y: c.y });
      break;
    }
  }
}

function meeting(r, caller, body) {
  const g = r.game, s = r.settings;
  g.phase = 'meeting'; g.vent.clear(); g.bodies = [];
  if (g.sab && SABOTAGES[g.sab.k].critical) { g.sab = null; g.sabAt = now() + 15000; }
  const intro = 3500, disc = s.discussionTime * 1000, vote = s.votingTime * 1000;
  g.meeting = { caller: caller.id, body, votes: new Map(), stage: 'discuss' };
  bc(r, { t: 'meeting', caller: caller.id, body, dead: [...g.roles.keys()].filter(id => !g.alive.has(id)), intro, discuss: disc, vote,
    bar: s.taskBar !== 2 ? taskBar(g) : null, sab: sabPub(g), meetings: Object.fromEntries(g.meetings) });
  g.mt.forEach(clearTimeout);
  g.mt = [
    setTimeout(() => {
      if (!g.meeting) return;
      g.meeting.stage = 'vote';
      bc(r, { t: 'voting' });
      for (const p of r.players.values()) if (p.bot && g.alive.has(p.id)) { g.meeting.votes.set(p.id, 'skip'); bc(r, { t: 'voted', id: p.id }); }
      maybeTally(r);
    }, intro + disc),
    setTimeout(() => tally(r), intro + disc + vote),
  ];
}
function vote(r, g, c, target) {
  const M = g.meeting;
  if (!M || M.stage !== 'vote' || !g.alive.has(c.id) || M.votes.has(c.id)) return;
  if (target !== 'skip' && !g.alive.has(target)) return;
  M.votes.set(c.id, target);
  bc(r, { t: 'voted', id: c.id });
  maybeTally(r);
}
function maybeTally(r) {
  const g = r.game, M = g?.meeting;
  if (M?.stage === 'vote' && [...g.alive].every(id => M.votes.has(id))) tally(r);
}
function tally(r) {
  const g = r.game, M = g?.meeting;
  if (!M || M.stage === 'done') return;
  M.stage = 'done';
  g.mt.forEach(clearTimeout);
  const votes = [...M.votes].filter(([v, t]) => g.alive.has(v) && (t === 'skip' || g.alive.has(t)));
  const count = new Map();
  for (const [, t] of votes) count.set(t, (count.get(t) || 0) + 1);
  let best = null, max = 0, tie = false;
  for (const [t, n] of count) { if (n > max) { max = n; best = t; tie = false; } else if (n === max) tie = true; }
  const ejected = !tie && best && best !== 'skip' ? best : null;
  bc(r, { t: 'result', votes: r.settings.anonVotes ? votes.map(([, t]) => [null, t]) : votes, ejected, tie });
  later(r, () => eject(r, ejected, tie), 5000);
}
function eject(r, id, tie) {
  const g = r.game;
  if (!g) return;
  g.phase = 'eject'; g.meeting = null;
  if (id) g.alive.delete(id);
  const p = r.players.get(id), ce = r.settings.confirmEjects;
  const impLeft = [...g.alive].filter(i => g.roles.get(i) === 'impostor').length;
  bc(r, { t: 'eject', id, tie, name: p?.name, look: p?.look, imp: ce && id ? g.roles.get(id) === 'impostor' : null, impLeft: ce ? impLeft : null });
  later(r, () => { if (!checkWin(r)) resume(r); }, 7000);
}
function resume(r) {
  const g = r.game;
  if (!g) return;
  g.phase = 'play';
  const ps = [...r.players.values()], t = now();
  ps.forEach((p, i) => { const sp = SKELD.spawn(i, ps.length); p.x = sp.x; p.y = sp.y; p.mv = 0; });
  for (const id of g.alive) if (g.roles.get(id) === 'impostor') g.killAt.set(id, t + r.settings.killCooldown * 1000);
  g.emergAt = t + r.settings.emergencyCooldown * 1000;
  bc(r, { t: 'resume', pos: ps.map(p => [p.id, p.x, p.y]), sab: sabPub(g), kill: r.settings.killCooldown * 1000, emerg: r.settings.emergencyCooldown * 1000 });
}
function checkWin(r) {
  const g = r.game;
  if (!g || g.practice) return false;
  const alive = [...g.alive], imps = alive.filter(i => g.roles.get(i) === 'impostor').length, crew = alive.length - imps;
  const hns = r.settings.gameType === 'hns';
  let w = null;
  if (imps === 0) w = ['crew', '임포스터를 모두 찾아냈습니다'];
  else if (hns ? crew === 0 : imps >= crew) w = ['impostor', '크루원이 모두 처치당했습니다'];
  else { const b = taskBar(g); if (b.total && b.done >= b.total) w = ['crew', '모든 임무를 완료했습니다']; }
  if (w) end(r, ...w);
  return !!w;
}
function end(r, winner, reason) {
  const g = r.game;
  bc(r, { t: 'over', winner, reason, roles: [...g.roles], players: [...r.players.values()].map(pub) });
  g.mt.forEach(clearTimeout);
  r.timers.forEach(clearTimeout); r.timers = [];
  r.game = null; r.state = 'lobby';
  [...r.players.values()].forEach((p, i) => { const sp = LOBBY.spawn(i); p.x = sp.x; p.y = sp.y; p.mv = 0; });
  bc(r, { t: 'room', room: info(r) });
}

// 위치 동기화 + 시간 제한 처리 (15Hz)
setInterval(() => {
  const t = now();
  for (const r of rooms.values()) {
    const g = r.game;
    if (g?.phase === 'play' && g.sab?.until && t > g.sab.until) {
      if (g.practice) { g.sab = null; bc(r, { t: 'sab', sab: null }); }
      else { end(r, 'impostor', g.sab.k === 'reactor' ? '원자로가 녹아내렸습니다' : '산소가 고갈되었습니다'); continue; }
    }
    if (g?.phase === 'play' && g.hnsEnd && t > g.hnsEnd) { end(r, 'crew', '크루원이 끝까지 살아남았습니다'); continue; }
    if (humans(r).length) bc(r, { t: 'pos', p: [...r.players.values()].map(p => [p.id, Math.round(p.x), Math.round(p.y), p.dir ? 1 : 0, p.mv ? 1 : 0, g?.vent.has(p.id) ? 1 : 0]) });
  }
}, 66);
