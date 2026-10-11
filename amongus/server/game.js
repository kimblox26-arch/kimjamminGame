// 게임 진행 엔진 (서버 권한, 모든 맵 공용): 시작·처치·회의·투표·사보타주·문·환풍구·이동 장치·숨바꼭질·승리 판정
import { getMap, spawnAt, stationsFor, canStand, walkable, lineClear, inPoly } from '../public/js/shared/maps/index.js';
import { RULES, shuffle, pick, clamp, maxImpostors, COLORS, anyRoleOn } from '../public/js/shared/data.js';
import { ROLE_DEFS, roleTeam, roleOpt } from '../public/js/shared/roles.js';
import * as RL from './roles.js';

export const now = () => Date.now();
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sec = v => Math.max(0, +v || 0) * 1000;
const fin = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const cnt = v => Math.max(0, Math.floor(fin(v)));
const ms = v => Math.max(0, Math.round(v));
const rnd = n => Math.floor(Math.random() * n);
export const own = (o, k) => o != null && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
// 받침 있으면 첫 번째 조사 ("을/를")
const josa = (s, a, b) => { const ch = String(s).charCodeAt(String(s).length - 1) - 0xac00; return ch >= 0 && ch < 11172 && ch % 28 ? a : b; };
const TOL = 450; // 장치 사용 거리 여유 (지연 보정)
export const pub = c => ({ id: c.id, name: c.name, status: c.status, look: c.look, x: Math.round(c.x || 0), y: Math.round(c.y || 0), bot: !!c.bot, lvl: c.lvl || 1 });

// 게임 객체에 붙이는 도우미 (roles.js 에서도 사용)
function helpers(g) {
  const r = g.r;
  g.P = id => r.players.get(id) || null;
  g.send = (who, m) => { const c = typeof who === 'string' ? r.players.get(who) : who; if (c?.ws) c.ws.send(JSON.stringify(m)); };
  g.bc = (m, f) => { const s = JSON.stringify(m); for (const c of r.players.values()) if (c.ws && (!f || f(c, g.st.get(c.id)))) c.ws.send(s); };
  g.locOf = (x, y) => locOf(g.map, x, y);
  g.kill = (c, st, id) => kill(g, c, st, id);
  g.ventToggle = (c, st, v) => ventToggle(g, c, st, v);
  g.ventOut = (c, st, forced) => ventOut(g, c, st, forced);
  g.sendVitals = st => sendVitals(g, st);
  g.vitalsConsole = (c, st, on) => vitalsConsole(g, c, st, on);
  g.castVote = (c, target) => castVote(g, c, target);
}
// 위치 → 방 이름 ("복도"면 가장 가까운 방 + 근처)
export function locOf(map, x, y) {
  const r = map.roomAt?.(x, y);
  if (r) return { room: r.name, roomId: r.id, near: false };
  let best = null, bd = Infinity;
  for (const q of map.rooms || []) { const dd = Math.hypot(q.label.x - x, q.label.y - y); if (dd < bd) { bd = dd; best = q; } }
  return { room: best?.name || '통로', roomId: best?.id || null, near: true };
}
const closedSet = g => new Set(g.doors.keys());
const canAct = (g, st) => g.phase === 'play' && !st.vent && !st.trans && !st.picking && !st.left;
const aliveCount = g => { let imp = 0, crew = 0; for (const s of g.st.values()) if (s.alive && !s.left) s.team === 'impostor' ? imp++ : crew++; return { imp, crew }; };
const killCd = g => (g.hns ? RULES.hnsKillCd * 1000 : sec(g.s.killCooldown));
function killReach(g) {
  if (g.hns) return RULES.hnsKillDist;
  const kd = fin(g.s.killDistance, 1);
  return kd >= 0 && kd <= 2 ? RULES.killDist[Math.round(kd)] : Math.max(60, kd * 200);
}

// ---------- 시작 ----------
const newState = (g, p, role) => ({
  id: p.id, bot: !!p.bot, name: p.name, color: p.look?.color ?? 0, role, team: roleTeam(role), alive: true, left: false, cds: {},
  vent: null, ventEnd: 0, ventUses: 0, shield: 0, shieldBy: null, shift: null, shiftEnd: 0, vanish: 0, track: null,
  vitalsOpen: false, vitalsConsole: false, vitalsNext: 0, doorlogOpen: false, battery: 0, tasks: [], meetingsLeft: cnt(g.s.emergencyMeetings),
  trans: null, picking: false, cases: [], activeCase: null, wheel: null, judgeUsed: false, judgeUnlocked: false, deathPos: null, stat: {},
});
// opt.role: 연습 모드에서 고른 역할
export function startGame(r, opt = {}) {
  const s = r.settings, t = now(), practice = r.mode === 'practice';
  const ps = [...r.players.values()], ids = ps.map(p => p.id);
  const map = getMap(s.map), hns = s.gameType === 'hns' && !practice;
  const pRole = own(ROLE_DEFS, opt.role) ? opt.role : 'crewmate';
  // 소개 화면 길이: "쉿!" → 팀 → (역할이 켜져 있으면) 역할 소개
  const special = practice ? !['crewmate', 'impostor'].includes(pRole) : !hns && anyRoleOn(s.roleSet);
  const intro = practice ? 2500 + (special ? 1500 : 0) : RULES.introMs + (special ? 2600 : 0);
  const g = {
    r, s, map, hns, practice, t0: t, phase: 'intro', phaseEnd: t + intro,
    st: new Map(), bodies: [], evidence: [], doors: new Map(), doorCd: new Map(), platforms: {}, sab: null, sabCd: RULES.sabStartCd * 1000,
    meeting: null, deaths: [], deathRec: new Map(), emergAt: 0, protectedRecently: false, ghostForced: new Map(),
    doorlog: [], sensorIn: new Map(), hnsT: null, over: false,
  };
  helpers(g);
  let roles;
  if (practice) {
    roles = new Map(ids.map(id => [id, 'crewmate']));
    const me = ps.find(p => !p.bot);
    if (me) roles.set(me.id, pRole);
  } else {
    const nImp = hns ? 1 : r.unlimited ? clamp(cnt(s.impostors), 1, Math.max(1, ids.length - 1)) : clamp(cnt(s.impostors), 1, maxImpostors(ids.length));
    const a = RL.assignRoles(ids, s, { nImp, forced: r.forced || new Map(), hns, seeker: s.seeker });
    roles = a.roles; g.ghostForced = a.ghostForced;
    r.forced = new Map();
  }
  for (const p of ps) g.st.set(p.id, newState(g, p, roles.get(p.id) || 'crewmate'));
  assignTasks(g);
  for (const st of g.st.values()) {
    RL.initRole(g, st, true);
    if (ROLE_DEFS[st.role]?.ghost) { st.alive = false; st.deathPos = null; } // 연습 모드: 유령 역할은 유령으로 시작
  }
  g.emergAt = g.phaseEnd + (practice ? 0 : sec(s.emergencyCooldown));
  placeAll(g, map.spawn);
  r.game = g; r.state = 'game';
  const pubs = ps.map(pub);
  for (const p of ps) g.send(p, startMsg(g, g.st.get(p.id), pubs));
  for (const st of g.st.values()) if (st.role === 'judge') RL.checkJudge(g, st, true);
  return g;
}
function startMsg(g, st, pubs) {
  return {
    t: 'start', role: st.role, team: st.team, mates: RL.matesOf(g, st), tasks: st.tasks, players: pubs, settings: g.s, bar: taskBar(g),
    map: g.map.id, kill: ms(st.cds.kill || 0), meetings: st.meetingsLeft, practice: g.practice, hns: g.hns ? hnsInfo(g) : null,
    roleCds: RL.cdsPub(st), spawnPick: null, spawnPoints: g.map.spawnPoints?.length ? g.map.spawnPoints : null, intro: ms(g.phaseEnd - now()),
    alive: st.alive, emerg: ms(g.emergAt - now()), doors: doorsPub(g), roleOpts: g.s.roleSet?.[st.role] || null, sabCd: g.hns ? 0 : ms(g.sabCd),
    seeker: g.hns ? hnsInfo(g).seeker : undefined,
  };
}
// 공통 임무는 모두 같은 장소, 긴/짧은 임무는 사람마다 다름
function assignTasks(g) {
  const T = g.map.tasks || [], s = g.s;
  const [nc, nl, ns] = g.hns ? [s.hnsCommon, s.hnsLong, s.hnsShort] : [s.commonTasks, s.longTasks, s.shortTasks];
  const of = k => T.filter(t => t.kind === k);
  const mk = t => ({ id: t.id, kind: t.kind, st: stationsFor(t), step: 0 });
  const common = shuffle(of('common')).slice(0, cnt(nc)).map(mk);
  for (const st of g.st.values()) {
    st.tasks = [...common.map(t => ({ ...t, st: [...t.st] })), ...shuffle(of('long')).slice(0, cnt(nl)).map(mk), ...shuffle(of('short')).slice(0, cnt(ns)).map(mk)];
  }
}
export function taskBar(g) {
  let total = 0, done = 0;
  for (const st of g.st.values()) {
    if (st.left || st.bot || st.team !== 'crew') continue;
    for (const t of st.tasks) { total++; if (t.step >= t.st.length) done++; }
  }
  return { total, done };
}
const pushBar = g => { if (!g.hns && cnt(g.s.taskBar) === 0) g.bc({ t: 'bar', bar: taskBar(g) }); };
function placeAll(g, area) {
  const ps = [...g.r.players.values()];
  const t = now();
  ps.forEach((p, i) => { const sp = spawnAt(g.map, area || g.map.spawn || { x: g.map.w / 2, y: g.map.h / 2 }, i, ps.length); p.x = sp.x; p.y = sp.y; p.mv = 0; p.mvT = t; });
}
function hnsInfo(g) {
  const s = g.s, seeker = [...g.st.values()].find(x => x.team === 'impostor')?.id || null;
  return {
    seeker, lead: RULES.hnsLead * 1000, hideTime: sec(s.hideTime), finalTime: sec(s.finalTime), flashlight: !!s.flashlight,
    crewLight: fin(s.crewLight, 0.35), impLight: fin(s.impLight, 0.25), crewVision: fin(s.hnsCrewVision, 0.6), impVision: fin(s.hnsImpVision, 0.6),
    showNames: !!s.showNames, ventUses: cnt(s.ventUses), ventTime: sec(s.ventTime), seekerSpeed: RULES.hnsSeekerSpeed, finalSpeed: fin(s.finalSpeed, 1.2),
    finalMap: !!s.finalMap, finalPings: !!s.finalPings, pingInterval: sec(s.pingInterval), pingShow: RULES.hnsPingShow * 1000,
    killCd: RULES.hnsKillCd * 1000, killDist: RULES.hnsKillDist,
  };
}

// ---------- 단계 전환 ----------
function beginPlay(g) {
  if (g.map.spawnPoints?.length) return spawnPhase(g);
  enterPlay(g);
}
function enterPlay(g) {
  g.phase = 'play';
  if (g.hns && !g.hnsT) {
    const t = now();
    g.hnsT = { phase: 'hide', leadEnd: t + RULES.hnsLead * 1000, main: sec(g.s.hideTime), final: sec(g.s.finalTime), nextPing: 0, nextSync: t + 1000 };
    hnsSend(g);
  }
}
// 에어십: 시작 위치 고르기
function spawnPhase(g) {
  const t = now(), pts = g.map.spawnPoints;
  g.phase = 'spawn'; g.phaseEnd = t + RULES.spawnPickMs + 2500; // 클라이언트 고르기 창(10초) + 여유
  for (const st of g.st.values()) {
    if (st.left) continue;
    const c = g.P(st.id);
    if (st.alive && !st.bot && c?.ws) { st.picking = true; g.send(c, { t: 'spawnPick', points: pts, ms: RULES.spawnPickMs }); }
    else if (c) placeAtPoint(g, c, -1);
  }
  if (![...g.st.values()].some(s => s.picking)) finishSpawn(g);
}
function placeAtPoint(g, c, i) {
  const pts = g.map.spawnPoints, p = pts[i] || pick(pts);
  for (let k = 0; k < 16; k++) {
    const x = p.x + (k ? (Math.random() - 0.5) * 160 : 0), y = p.y + (k ? (Math.random() - 0.5) * 110 : 0);
    if (canStand(g.map, x, y)) { c.x = x; c.y = y; c.mv = 0; c.mvT = now(); return; }
  }
  c.x = p.x; c.y = p.y; c.mv = 0; c.mvT = now();
}
function onSpawn(g, c, st, i) {
  if (g.phase !== 'spawn' || !st.picking) return;
  const pts = g.map.spawnPoints, idx = Number.isInteger(i) && pts[i] ? i : rnd(pts.length);
  placeAtPoint(g, c, idx);
  st.picking = false;
  g.bc({ t: 'spawned', id: c.id, x: Math.round(c.x), y: Math.round(c.y), i: idx });
  if (![...g.st.values()].some(s => s.picking && !s.left)) finishSpawn(g);
}
function finishSpawn(g) {
  for (const st of g.st.values()) {
    if (!st.picking) continue;
    st.picking = false;
    const c = g.P(st.id);
    if (c) { placeAtPoint(g, c, -1); g.bc({ t: 'spawned', id: c.id, x: Math.round(c.x), y: Math.round(c.y), i: -1, auto: true }); }
  }
  g.bc({ t: 'spawnDone', pos: [...g.r.players.values()].map(p => [p.id, Math.round(p.x), Math.round(p.y)]) });
  enterPlay(g);
}

// ---------- 메시지 ----------
export function onMsg(c, m) {
  const g = c.room?.game;
  if (!g || g.over) return;
  const st = g.st.get(c.id);
  if (!st || st.left) return;
  switch (m.t) {
    case 'kill': kill(g, c, st, String(m.id)); return;
    case 'report': return report(g, c, st, String(m.id));
    case 'emergency': return emergency(g, c, st);
    case 'vote': if (m.id !== undefined && m.id !== null) castVote(g, c, m.id === 'skip' ? 'skip' : String(m.id)); return;
    case 'task': return task(g, c, st, m.i, m.step);
    case 'visual': if (!g.hns && g.s.visualTasks && st.alive && g.phase === 'play') g.bc({ t: 'visual', id: c.id, k: String(m.k ?? '').slice(0, 12), on: !!m.on }); return;
    case 'sab': startSab(g, c, st, String(m.k)); return;
    case 'fix': return fix(g, c, st, String(m.k), String(m.p), m.on);
    case 'vent': return ventMsg(g, c, st, m.a, String(m.v));
    case 'door': closeDoors(g, c, st, String(m.room)); return;
    case 'openDoor': return openDoor(g, c, st, String(m.id));
    case 'transport': return useTransport(g, c, st, String(m.id));
    case 'spawn': return onSpawn(g, c, st, +m.i);
    case 'ability': return RL.ability(g, c, st, m);
    case 'vitals': return vitalsConsole(g, c, st, m.on);
    case 'doorlog': return doorlogConsole(g, c, st, m.on);
  }
}
// 이동 허용 여부 (rooms.js 의 move 처리에서 사용)
export function canMove(g, c) {
  if (g.over) return true;
  const st = g.st.get(c.id);
  if (!st || (g.phase !== 'play' && g.phase !== 'intro') || st.vent || st.trans || st.picking) return false;
  if (g.hns && st.team === 'impostor' && g.hnsT?.phase === 'hide') return false;
  return true;
}
export function speedMul(g, c) {
  const st = g.st.get(c.id);
  let m = Math.max(0.1, fin(g.s.playerSpeed, 1));
  if (st && !st.alive) m *= RULES.ghostSpeed; // 유령은 1.2배 (3.0 / 2.5 u/s)
  if (g.hns && st?.team === 'impostor') m *= RULES.hnsSeekerSpeed * (g.hnsT?.phase === 'final' ? fin(g.s.finalSpeed, 1.2) : 1);
  return m;
}
// pos 플래그: 1 환풍구, 2 투명, 4 변신, 8 사다리 등 이동 중
export function flags(g, id) {
  const st = g.st.get(id);
  return st ? (st.vent ? 1 : 0) | (st.vanish ? 2 : 0) | (st.shift ? 4 : 0) | (st.trans ? 8 : 0) : 0;
}
export const hiddenPos = (g, id) => !!g.st.get(id)?.picking;
// 서버 이동 검사 (살아있는 플레이어): 도착점이 걸을 수 있는 곳이어야 하고, 닫힌 문을 가로지를 수 없고, 속도상 가능한 거리여야 함.
// 유령·벽뚫(mod)은 통과. 거리 한도는 마지막으로 받아들인 이동 이후 경과 시간에 비례하므로 지연으로 어긋나도 곧 회복된다.
const inR = (x, y, d) => x > d.x && x < d.x + d.w && y > d.y && y < d.y + d.h;
export function moveOk(g, c, x, y) {
  const st = g.st.get(c.id), t = now();
  if (!st || !st.alive || c.noclip) { c.mvT = t; return true; }
  const ds = g.doors.size ? [...g.doors.keys()].map(id => g.map.doorById?.[id]).filter(Boolean) : [];
  const dist = Math.hypot(x - c.x, y - c.y);
  const el = Math.min(5000, t - (c.mvT || 0)) / 1000;
  const lim = RULES.speed * speedMul(g, c) * Math.max(1, +c.speedMul || 1) * 1.5 * el + 150;
  if (dist > lim) return false;
  const inDoor = ds.some(d => inR(c.x, c.y, d));
  if (inDoor) { // 문이 닫히는 순간 문간에 서 있던 경우: 빠져나가는 짧은 움직임은 허용
    if (dist < 90 && walkable(g.map, x, y)) { c.mvT = t; return true; }
    return false;
  }
  if (!walkable(g.map, x, y, ds.length ? new Set(g.doors.keys()) : null)) return false;
  if (ds.length && dist > 10) {
    const n = Math.ceil(dist / 15);
    for (let i = 1; i < n; i++) { const px = c.x + ((x - c.x) * i) / n, py = c.y + ((y - c.y) * i) / n; if (ds.some(d => inR(px, py, d))) return false; }
  }
  c.mvT = t;
  return true;
}

// ---------- 처치 ----------
function kill(g, c, st, vid, o = {}) {
  const t = now(), v = g.P(vid), vs = g.st.get(vid);
  if (!v || !vs || !vs.alive || vs.left || g.over) return false;
  if (!o.force) {
    if (!st || st.team !== 'impostor' || !st.alive || !canAct(g, st) || st.vanish) return false;
    if (g.hns && g.hnsT?.phase === 'hide') return false;
    if (st.cds.kill > 250 && !c.nocd) return false;
    if (vs.team === 'impostor' || vs.vent || vs.trans || vs.picking) return false;
    const dd = d2(c, v);
    if (dd > killReach(g) * 1.25 + 90) return false;
    if (dd > 150 && !lineClear(g.map, c.x, c.y, v.x, v.y, closedSet(g))) return false;
    if (vs.shield > t) { RL.shieldBreak(g, c, st, v, vs); return false; }
  }
  const acid = !o.force && st?.role === 'viper', x = v.x, y = v.y;
  // 사망 기록: 탐정 심문용으로 그 순간 모든 사람의 실제 위치를 저장
  const snap = new Map([...g.r.players.values()].map(p => [p.id, { x: p.x, y: p.y }]));
  const rec = { id: vid, name: v.name, color: v.look?.color ?? 0, at: t, x, y, loc: locOf(g.map, x, y), snap, dissolved: false, by: c?.id || null };
  g.deathRec.set(vid, rec);
  g.deaths.push(rec);
  vs.alive = false; vs.deathPos = { x, y }; vs.deadAt = t;
  const dur = acid ? Math.max(500, sec(roleOpt(g.s, 'viper', 'dissolveTime'))) : 0;
  g.bodies.push({ id: vid, x, y, at: t, look: { ...v.look }, acid: acid ? { start: t, dur, stage: 1 } : null });
  if (!o.force && st) {
    c.x = x; c.y = y;
    st.stat.kills = (st.stat.kills || 0) + 1;
    if (st.shift) st.stat.shiftKills = (st.stat.shiftKills || 0) + 1;
    RL.setCd(g, st, 'kill', killCd(g));
  }
  const left = aliveCount(g).crew;
  g.bc({ t: 'kill', id: vid, by: c?.id || null, as: st?.shift || null, x: Math.round(x), y: Math.round(y), cd: ms(st?.cds.kill || 0), acid: dur, dissolve: dur, left, hns: g.hns });
  RL.onKilled(g, vs, x, y);
  RL.onDeath(g, vs);
  checkWin(g);
  return true;
}
export function modKillAll(g, c) {
  const st = g.st.get(c.id);
  for (const x of [...g.st.values()]) { if (g.over) break; if (x.id !== c.id && x.alive && !x.left) kill(g, c, st, x.id, { force: true }); }
}

// ---------- 신고 / 긴급회의 / 회의 ----------
function report(g, c, st, id) {
  if (!st.alive || !canAct(g, st) || g.hns || st.vanish) return;
  const b = g.bodies.find(b => b.id === id && !b.gone);
  if (!b) return;
  const dd = d2(c, b);
  if (dd > RULES.reportDist + 150 || (dd > 300 && !lineClear(g.map, c.x, c.y, b.x, b.y, closedSet(g)))) return;
  st.stat.reports = (st.stat.reports || 0) + 1;
  callMeeting(g, c, b.id);
}
function emergency(g, c, st) {
  if (!st.alive || !canAct(g, st) || g.hns || st.vanish) return;
  if (st.meetingsLeft <= 0) return g.send(c, { t: 'err', msg: '긴급회의를 모두 사용했습니다.' });
  if (now() < g.emergAt) return g.send(c, { t: 'err', msg: `크루원은 다음 긴급회의를 소집하기까지 ${Math.ceil((g.emergAt - now()) / 1000)}초 기다려야 합니다.` });
  if (g.sab) return g.send(c, { t: 'err', msg: '위기 상황에서는 긴급회의를 소집할 수 없습니다.' });
  const b = g.map.button;
  if (!b || d2(c, b) > RULES.buttonDist + 250) return;
  st.meetingsLeft--;
  callMeeting(g, c, null);
}
export function callMeeting(g, caller, bodyId) {
  if (g.over || (g.phase !== 'play' && g.phase !== 'spawn')) return false;
  const t = now(), s = g.s, body = bodyId && g.bodies.find(b => b.id === bodyId);
  for (const st of g.st.values()) {
    const c = g.P(st.id);
    if (st.vent) { st.vent = null; st.ventEnd = 0; }
    if (st.trans) { if (c) { c.x = st.trans.to.x; c.y = st.trans.to.y; } st.trans = null; }
    st.picking = false;
  }
  RL.onMeeting(g, bodyId);
  if (g.sab && (g.sab.type === 'critical' || g.sab.type === 'mixup')) endSab(g, null);
  if (g.doors.size) { g.doors.clear(); bcDoors(g); }
  g.bodies = []; g.evidence = []; g.platforms = {};
  g.phase = 'meeting';
  const intro = RULES.meetIntro, disc = sec(s.discussionTime), vote = sec(s.votingTime);
  const M = g.meeting = { caller: caller?.id || null, body: bodyId || null, votes: new Map(), stage: 'discuss', start: t, voteAt: t + intro + disc,
    voteEnd: t + intro + disc + vote, overrule: null, commsAtStart: g.sab?.type === 'comms' };
  g.bc({
    t: 'meeting', caller: M.caller, body: M.body, bodyLook: body?.look || null, emergency: !bodyId,
    dead: [...g.st.values()].filter(x => !x.alive).map(x => x.id), intro, discuss: disc, vote,
    bar: cnt(s.taskBar) !== 2 ? taskBar(g) : null, sab: sabPub(g), meetings: Object.fromEntries([...g.st.values()].map(x => [x.id, x.meetingsLeft])),
    protected: g.protectedRecently,
  });
  g.protectedRecently = false;
  return true;
}
function meetingTick(g, t) {
  const M = g.meeting;
  if (!M) return;
  if (M.stage === 'discuss' && t >= M.voteAt) {
    M.stage = 'vote';
    g.bc({ t: 'voting', ms: ms(M.voteEnd - t) });
    for (const st of g.st.values()) if (st.bot && st.alive) castVote(g, g.P(st.id), 'skip');
    maybeTally(g);
  } else if (M.stage === 'vote' && t >= M.voteEnd) tally(g);
  else if (M.stage === 'result' && t >= M.ejectAt) eject(g);
}
function castVote(g, c, target) {
  const M = g.meeting, st = c && g.st.get(c.id);
  if (!M || M.stage !== 'vote' || !st?.alive || st.left || M.votes.has(c.id)) return false;
  if (target !== 'skip') { const ts = g.st.get(target); if (!ts || !ts.alive || ts.left) return false; }
  M.votes.set(c.id, target);
  const left = [...g.st.values()].filter(x => x.alive && !x.left && !M.votes.has(x.id)).length;
  g.bc({ t: 'voted', id: c.id, left });
  maybeTally(g);
  return true;
}
function maybeTally(g) {
  const M = g.meeting;
  if (M?.stage === 'vote' && [...g.st.values()].every(x => !x.alive || x.left || M.votes.has(x.id))) tally(g);
}
function tally(g) {
  const M = g.meeting;
  if (!M || M.stage === 'result') return;
  M.stage = 'result';
  const valid = [...M.votes].filter(([v, tg]) => g.st.get(v)?.alive && (tg === 'skip' || g.st.get(tg)?.alive));
  let ejected = null, tie = false, skipped = false, judge = null;
  const O = M.overrule, js = O && g.st.get(O.judge), ts = O && g.st.get(O.target);
  if (O && js?.alive && !js.left && ts?.alive && !ts.left) {
    // 판사의 기각: 다른 투표는 모두 무시
    const ok = ts.team === 'impostor';
    ejected = ok ? O.target : O.judge;
    judge = { id: O.judge, judge: O.judge, by: O.judge, target: O.target, correct: ok };
    js.stat[ok ? 'overruleOk' : 'overruleFail'] = 1;
  } else {
    const count = new Map();
    for (const [, tg] of valid) count.set(tg, (count.get(tg) || 0) + 1);
    let best = null, max = 0;
    for (const [tg, n] of count) { if (n > max) { max = n; best = tg; tie = false; } else if (n === max) tie = true; }
    if (!tie && best && best !== 'skip') ejected = best;
    else if (!tie) skipped = true;
  }
  M.result = { ejected, tie, skipped, judge };
  M.ejectAt = now() + RULES.resultMs;
  g.bc({ t: 'result', votes: g.s.anonVotes ? valid.map(([, tg]) => [null, tg]) : valid, ejected, tie, skipped, judge });
}
function eject(g) {
  const M = g.meeting, R = M.result, t = now();
  g.meeting = null; g.phase = 'eject'; g.phaseEnd = t + RULES.ejectMs;
  const id = R.ejected, p = id ? g.P(id) : null, st = id ? g.st.get(id) : null;
  const wasImp = st ? st.team === 'impostor' : null;
  if (st && st.alive) { st.alive = false; st.ejected = true; RL.onDeath(g, st); }
  const ce = !!g.s.confirmEjects;
  const impLeft = aliveCount(g).imp, name = p?.name || st?.name || '';
  const was = `${name} 님은 임포스터${wasImp ? '였습니다' : '가 아니었습니다'}.`;
  let text, sub = ce ? `임포스터가 ${impLeft}명 남았습니다.` : '';
  if (R.judge) { text = '판결이 내려졌습니다...'; if (id && ce) sub = `${was} ${sub}`; }
  else if (!id) text = `아무도 방출되지 않았습니다. (${R.tie ? '동점' : '건너뜀'})`;
  else text = ce ? was : `${name} 님이 방출됐습니다.`;
  g.bc({ t: 'eject', id: id || null, tie: R.tie, skipped: R.skipped, name, look: p?.look || null, imp: ce && id ? wasImp : null,
    impLeft: ce ? impLeft : null, text, sub, verdict: !!R.judge, judge: R.judge, map: g.map.id });
}
function resume(g) {
  const t = now(), s = g.s, ps = [...g.r.players.values()];
  placeAll(g, g.map.meetingSpawn || g.map.spawn);
  for (const st of g.st.values()) if (st.team === 'impostor' && st.alive) st.cds.kill = killCd(g);
  RL.afterMeeting(g);
  g.emergAt = t + sec(s.emergencyCooldown);
  const pts = g.map.spawnPoints?.length ? g.map.spawnPoints : null;
  const pos = ps.map(q => [q.id, Math.round(q.x), Math.round(q.y)]);
  for (const p of ps) {
    const st = g.st.get(p.id);
    const cds = st ? RL.cdsPub(st) : {};
    g.send(p, { t: 'resume', pos, sab: sabPub(g), kill: ms(st?.cds.kill || 0), emerg: ms(g.emergAt - t), cds, roleCds: cds, sabCd: ms(g.sabCd),
      meetings: st?.meetingsLeft, spawnPick: null, spawnPoints: pts, doors: doorsPub(g), bar: cnt(s.taskBar) === 0 ? taskBar(g) : undefined });
  }
  if (pts) spawnPhase(g); else enterPlay(g);
}

// ---------- 승리 판정 ----------
export function checkWin(g) {
  if (!g || g.over || g.practice) return false;
  const { imp, crew } = aliveCount(g);
  let w = null;
  const impsGone = [...g.st.values()].filter(x => x.team === 'impostor').every(x => x.left);
  if (g.hns) {
    if (imp === 0) w = ['crew', '술래가 게임을 떠났습니다', 'disconnect'];
    else if (crew === 0) w = ['impostor', '크루원이 모두 처치당했습니다', 'hnsKill'];
  } else if (imp === 0) w = ['crew', impsGone ? '임포스터가 게임을 떠났습니다' : '임포스터를 모두 방출했습니다', impsGone ? 'disconnect' : 'vote'];
  else if (imp >= crew) w = ['impostor', crew === 0 ? '크루원이 모두 처치당했습니다' : '임포스터 수가 크루원 수와 같아졌습니다', 'kill'];
  else { const b = taskBar(g); if (b.total && b.done >= b.total) w = ['crew', '크루원이 모든 임무를 완료했습니다', 'tasks']; }
  if (w) end(g, ...w);
  return !!w;
}
export function end(g, winner, reason, code = '') {
  if (!g || g.over) return;
  g.over = true;
  const r = g.r, all = [...g.st.values()];
  g.bc({ t: 'over', winner, reason, code, roles: all.map(x => [x.id, x.role]), winners: all.filter(x => x.team === winner).map(x => x.id),
    players: [...r.players.values()].map(pub), stats: Object.fromEntries(all.map(x => [x.id, x.stat])) });
  if (r.game === g) { r.game = null; r.state = 'lobby'; }
  r.hooks?.toLobby?.();
}

// ---------- 임무 ----------
function task(g, c, st, i, step) {
  const tk = st.tasks[i | 0];
  if (!tk || st.team !== 'crew' || tk.step >= tk.st.length || g.phase !== 'play' || st.vent || st.trans || st.vanish || st.picking) return;
  if (step !== undefined && step !== null && +step !== tk.step) return g.send(c, { t: 'tasks', tasks: st.tasks }); // 중복/늦은 메시지
  if (g.hns && (!st.alive || g.hnsT?.phase === 'final')) return;
  const sp = g.map.stations?.[tk.st[tk.step]];
  if (sp && d2(c, sp) > TOL && !c.mod) return g.send(c, { t: 'tasks', tasks: st.tasks });
  tk.step++;
  g.send(c, { t: 'tasks', tasks: st.tasks });
  if (tk.step < tk.st.length) return;
  st.stat.tasks = (st.stat.tasks || 0) + 1;
  RL.onTaskDone(g, st, tk);
  if (g.hns) return hnsTaskDone(g, tk.kind);
  pushBar(g);
  checkWin(g);
}

// ---------- 사보타주 (맵 정의 sabotages 사용) ----------
export function sabPub(g) {
  const S = g.sab;
  if (!S) return null;
  const parts = [...new Set(Object.values(S.def.fix || {}))];
  return { k: S.k, name: S.def.name, type: S.type, room: S.def.room || null, game: S.def.game, together: !!S.def.together,
    left: S.until ? ms(S.until - now()) : 0, parts: parts.filter(p => S.parts[p]), need: parts, held: S.def.together ? { ...S.parts } : null,
    window: S.winEnd ? ms(S.winEnd - now()) : 0, mix: S.mix || null };
}
export function startSab(g, c, st, k, force) {
  const def = own(g.map.sabotages, k) ? g.map.sabotages[k] : null, t = now();
  if (!def || g.over) return false;
  if (!force) {
    if (!st || st.team !== 'impostor' || g.hns || g.phase !== 'play' || st.trans || st.picking) return false;
    if (g.sab) { g.send(c, { t: 'err', msg: '이미 방해 공작이 진행 중입니다.' }); return false; }
    if (g.sabCd > 0 && !c?.nocd) { g.send(c, { t: 'err', msg: `방해 공작 쿨다운: ${Math.ceil(g.sabCd / 1000)}초` }); return false; }
  } else {
    if (g.phase !== 'play') return false;
    if (g.sab) endSab(g, null);
  }
  const type = def.type || 'lights';
  g.sab = { k, def, type, t0: t, until: type === 'critical' ? t + sec(def.time || 30) : type === 'mixup' ? t + sec(def.time || 10) : 0, parts: {}, winEnd: 0, by: c?.id || null };
  if (type === 'mixup') { const cols = shuffle(COLORS.map((_, i) => i)); g.sab.mix = Object.fromEntries([...g.st.keys()].map((id, i) => [id, cols[i % cols.length]])); }
  g.bc({ t: 'sab', sab: sabPub(g) });
  if (type === 'comms') { RL.onComms(g); g.doorlog = []; }
  return true;
}
export function endSab(g, by) {
  const S = g.sab;
  if (!S) return;
  g.sab = null; g.sabCd = RULES.sabCd * 1000;
  if (S.type === 'mixup') RL.unshiftAll(g);
  g.bc({ t: 'sab', sab: null, fixed: S.k, by: by || null });
}
function fix(g, c, st, k, p, on) {
  const S = g.sab;
  if (!S || S.k !== k || !st.alive || g.phase !== 'play' || st.vanish || st.vent || st.trans) return;
  const fx = S.def.fix || {}, sid = Object.keys(fx).find(s => fx[s] === p);
  if (!sid) return;
  const sp = g.map.stations?.[sid];
  if (sp && d2(c, sp) > TOL && !c.mod) return;
  const parts = [...new Set(Object.values(fx))];
  on = on === undefined ? true : !!on;
  if (S.def.together) {
    // 동시에 눌러야 하는 장치: 한 사람은 한 곳만 누를 수 있음
    for (const q in S.parts) if (S.parts[q] === c.id) delete S.parts[q];
    if (on) S.parts[p] = c.id;
  } else {
    if (!on || S.parts[p]) return;
    S.parts[p] = c.id;
    // 미라 통신(2곳)·에어십 추락(2곳): 한 곳을 고치면 10초 안에 나머지도 고쳐야 함
    const win = S.def.window ?? (parts.length > 1 && (S.type === 'comms' || S.def.game === 'crash') ? 10 : 0);
    if (win && !S.winEnd) S.winEnd = now() + sec(win);
  }
  let done = parts.every(q => S.parts[q]);
  if (done && S.def.together && !g.practice) done = new Set(parts.map(q => S.parts[q])).size === parts.length;
  if (!done && g.practice && S.def.together && on) done = true; // 연습 모드: 혼자서도 고칠 수 있게
  if (done) { st.stat.fixes = (st.stat.fixes || 0) + 1; endSab(g, c.id); } else g.bc({ t: 'sab', sab: sabPub(g) });
}

// ---------- 문 ----------
export function doorsPub(g) {
  const t = now(), cd = {};
  for (const [room, until] of g.doorCd) if (until > t) cd[room] = until - t;
  return { closed: [...g.doors.keys()], cd, mode: g.map.doorMode };
}
const bcDoors = g => g.bc({ t: 'doors', ...doorsPub(g) });
// 자동 문(스켈드): doorTime 초 뒤 열림 / 수동 문(폴러스·에어십·펑글): 패널로 열어야 하고, 아무도 안 열면 오래 뒤 자동으로 열림
const doorHold = g => sec(g.map.doorMode === 'manual' ? g.map.doorAutoOpen ?? Math.max(fin(g.map.doorTime, 10) * 3, 30) : fin(g.map.doorTime, 10));
export function closeDoors(g, c, st, room, force) {
  const ds = (g.map.doors || []).filter(d => d.room === room), t = now();
  if (!ds.length || g.over || g.phase !== 'play') return false;
  if (!force) {
    if (!st || st.team !== 'impostor' || g.hns) return false;
    if ((g.doorCd.get(room) || 0) > t && !c?.nocd) return false;
  }
  const until = t + doorHold(g);
  for (const d of ds) g.doors.set(d.id, { room, until });
  g.doorCd.set(room, t + RULES.doorCd * 1000);
  bcDoors(g);
  return true;
}
export function closeAllDoors(g) {
  if (g.phase !== 'play') return false;
  for (const room of g.map.doorRooms || []) closeDoors(g, null, null, room, true);
  return true;
}
function openDoor(g, c, st, id) {
  const d = g.map.doorById?.[id];
  if (!d || !g.doors.has(id) || !st.alive || st.vanish || g.phase !== 'play') return;
  if (g.map.doorMode !== 'manual') return; // 자동 문(스켈드)은 손으로 못 엶
  if (d2(c, { x: d.x + d.w / 2, y: d.y + d.h / 2 }) > TOL + 50 && !c.mod) return;
  g.doors.delete(id);
  bcDoors(g);
}

// ---------- 환풍구 ----------
function ventAllowed(g, st) {
  if (g.hns) return st.team === 'crew';
  return st.team === 'impostor' || st.role === 'engineer';
}
function ventMsg(g, c, st, a, vid) {
  const V = g.map.vents || {}, t = now(), eng = st.role === 'engineer' && !g.hns;
  if (g.phase !== 'play' || !st.alive || st.trans || st.picking || !ventAllowed(g, st)) return;
  if (a === 'in') {
    const v = own(V, vid) ? V[vid] : null;
    if (!v || st.vent || (d2(c, v) > RULES.ventDist + 160 && !c.mod)) return;
    if (eng && g.sab?.type === 'comms') return g.send(c, { t: 'err', msg: '통신 방해 중에는 환풍구를 쓸 수 없습니다.' });
    if ((eng || g.hns) && st.cds.vent > 0 && !c.nocd) return;
    if (g.hns && st.ventUses >= cnt(g.s.ventUses)) return g.send(c, { t: 'err', msg: '환풍구를 더 이상 사용할 수 없습니다.' });
    st.vent = vid; c.x = v.x; c.y = v.y; c.mv = 0;
    if (eng) { const mt = sec(roleOpt(g.s, 'engineer', 'ventMaxTime')); st.ventEnd = mt ? t + mt : 0; st.stat.vents = (st.stat.vents || 0) + 1; }
    if (g.hns) { st.ventUses++; st.ventEnd = t + Math.max(500, sec(g.s.ventTime)); }
  } else if (a === 'move') {
    const v = own(V, vid) ? V[vid] : null;
    if (!v || !st.vent || !V[st.vent]?.links?.includes(vid)) return;
    st.vent = vid; c.x = v.x; c.y = v.y;
  } else if (a === 'out') {
    if (st.vent) ventOut(g, c, st);
    return;
  } else return;
  g.bc({ t: 'vent', id: c.id, v: st.vent, a, x: Math.round(c.x), y: Math.round(c.y), ms: st.ventEnd ? ms(st.ventEnd - t) : 0,
    uses: g.hns && st.team === 'crew' ? Math.max(0, cnt(g.s.ventUses) - st.ventUses) : undefined });
}
function ventOut(g, c, st, forced) {
  if (!st.vent) return;
  const v = g.map.vents?.[st.vent];
  st.vent = null; st.ventEnd = 0;
  if (c && v) { c.x = v.x; c.y = v.y; }
  g.bc({ t: 'vent', id: st.id, v: null, a: 'out', x: Math.round(c?.x || 0), y: Math.round(c?.y || 0), forced: !!forced });
  if (st.role === 'engineer' && !g.hns) RL.setCd(g, st, 'vent', sec(roleOpt(g.s, 'engineer', 'ventCooldown')));
  else if (g.hns && st.team === 'crew') RL.setCd(g, st, 'vent', 1000, { uses: Math.max(0, cnt(g.s.ventUses) - st.ventUses) });
  else if (st.team === 'impostor') g.send(st.id, { t: 'abilityCd', a: 'kill', ms: ms(st.cds.kill || 0) });
}
// 능력 버튼(ability{a:'vent'}): 안에 있으면 나가고, 아니면 가장 가까운 환풍구로 들어감
function ventToggle(g, c, st, v) {
  if (st.vent) return ventOut(g, c, st);
  let id = own(g.map.vents, v) ? v : null;
  if (!id) {
    let bd = Infinity;
    for (const [k, x] of Object.entries(g.map.vents || {})) { const dd = d2(c, x); if (dd < bd) { bd = dd; id = k; } }
  }
  if (id) ventMsg(g, c, st, 'in', id);
}

// ---------- 사다리·짚라인·승강장·소독실 ----------
function useTransport(g, c, st, id) {
  const T = (g.map.transports || []).find(x => x.id === id), t = now();
  if (!T || g.phase !== 'play' || !st.alive || st.vent || st.trans || st.picking) return;
  const da = d2(c, T.a), db = d2(c, T.b), R = 320;
  let from, to, side;
  if (da <= db && da <= R) { from = T.a; to = T.b; side = 'a'; } else if (db <= R && !T.oneWay) { from = T.b; to = T.a; side = 'b'; } else return;
  const dur = Math.max(300, sec(T.time ?? 2));
  if (T.kind === 'platform') {
    const P = (g.platforms[id] ||= { side: 'a', busy: 0 });
    if (P.busy > t) return;
    if (P.side !== side) { // 반대편에 있으면 먼저 불러옴
      P.side = side; P.busy = t + dur;
      g.bc({ t: 'transport', id, pid: null, from: side === 'a' ? T.b : T.a, to: from, ms: dur, call: true });
      return;
    }
    P.side = side === 'a' ? 'b' : 'a'; P.busy = t + dur;
  }
  st.trans = { id, until: t + dur, to: { x: to.x, y: to.y }, from: { x: from.x, y: from.y } };
  c.x = from.x; c.y = from.y; c.mv = 0;
  g.bc({ t: 'transport', id, pid: c.id, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, ms: dur, kind: T.kind });
}
function finishTrans(g, st) {
  const c = g.P(st.id), T = st.trans;
  st.trans = null;
  if (c) { c.x = T.to.x; c.y = T.to.y; c.mv = 0; }
  g.bc({ t: 'transportDone', id: T.id, pid: st.id, x: Math.round(T.to.x), y: Math.round(T.to.y) });
}

// ---------- 장비: 바이탈 / 문 기록 ----------
export const vitalsList = g => [...g.st.values()].map(x => [x.id, x.left ? 'gone' : x.alive ? 'alive' : 'dead']);
function sendVitals(g, st) {
  st.vitalsNext = now() + 500;
  if (g.sab?.type === 'comms') return g.send(st.id, { t: 'vitalsData', list: null, comms: true });
  g.send(st.id, { t: 'vitalsData', list: vitalsList(g), battery: st.vitalsOpen ? ms(st.battery) : undefined });
}
function vitalsConsole(g, c, st, on) {
  if (on === false) { st.vitalsConsole = false; return; }
  const sp = g.map.vitals && g.map.stations?.[g.map.vitals];
  if (!sp || (d2(c, sp) > TOL && !c.mod)) return;
  st.vitalsConsole = true;
  sendVitals(g, st);
}
function doorlogConsole(g, c, st, on) {
  if (on === false) { st.doorlogOpen = false; return; }
  const sp = g.map.doorlog && g.map.stations?.[g.map.doorlog];
  if (!sp || (d2(c, sp) > TOL && !c.mod)) return;
  st.doorlogOpen = true;
  g.send(c, g.sab?.type === 'comms' ? { t: 'doorlogData', list: null, comms: true } : { t: 'doorlogData', list: g.doorlog });
}
// 문 기록 센서 (맵에 sensors:[{id,name,x,y,w,h} | {id,name,x,y,r}] 가 있으면): 5초에 한 번만 기록
function sensorTick(g, t) {
  const S = g.map.sensors;
  if (!S?.length || g.sab?.type === 'comms') return;
  for (const st of g.st.values()) {
    if (!st.alive || st.left || st.vent) continue;
    const c = g.P(st.id);
    if (!c) continue;
    for (const s of S) {
      const inside = s.r ? Math.hypot(c.x - s.x, c.y - s.y) < s.r : s.poly ? inPoly(c.x, c.y, s.poly) : c.x > s.x && c.x < s.x + (s.w || 0) && c.y > s.y && c.y < s.y + (s.h || 0);
      const key = st.id + '|' + (s.id || s.name), last = g.sensorIn.get(key);
      if (inside && !last?.in && t - (last?.at || 0) >= 5000) {
        g.doorlog.push({ id: st.id, name: c.name, color: c.look?.color ?? 0, sensor: s.name || s.id, at: t - g.t0 });
        if (g.doorlog.length > 30) g.doorlog.shift();
        g.sensorIn.set(key, { in: true, at: t });
      } else if (!inside && last?.in) g.sensorIn.set(key, { in: false, at: last.at });
    }
  }
}

// ---------- 숨바꼭질 ----------
function seekMapOn(g) {
  const H = g.hnsT, N = g.st.size, { crew } = aliveCount(g);
  return (H?.phase === 'final' && !!g.s.finalMap) || crew <= Math.floor((N - 1) / 3);
}
function hnsSend(g, extra = {}) {
  const H = g.hnsT, t = now();
  if (!H) return;
  const seeker = [...g.st.values()].find(x => x.team === 'impostor');
  g.bc({ t: 'hns', phase: H.phase, left: ms(H.phase === 'final' ? H.final : H.main), main: ms(H.main), final: ms(H.final), lead: ms(H.leadEnd - t),
    seeker: seeker?.id || null, seekMap: seekMapOn(g), speed: g.hns ? RULES.hnsSeekerSpeed * (H.phase === 'final' ? fin(g.s.finalSpeed, 1.2) : 1) : 1,
    crewLeft: aliveCount(g).crew, ...extra });
}
function hnsTaskDone(g, kind) {
  const H = g.hnsT;
  if (!H || H.phase === 'final') return;
  const N = g.st.size, cut = (kind === 'long' ? Math.max(0, 20 - N) : Math.max(0, 10 - N / 2)) * 1000;
  H.main = Math.max(0, H.main - cut);
  hnsSend(g, { cut });
}
function hnsTick(g, dt, t) {
  const H = g.hnsT;
  if (H.phase === 'hide' && t >= H.leadEnd) { H.phase = 'seek'; hnsSend(g); }
  if (H.phase !== 'final') {
    H.main -= dt;
    if (H.main <= 0) {
      H.main = 0; H.phase = 'final'; H.nextPing = t;
      for (const st of g.st.values()) if (st.team === 'crew' && !st.left) { st.tasks = []; g.send(st.id, { t: 'tasks', tasks: [] }); }
      hnsSend(g);
    }
  } else {
    H.final -= dt;
    if (H.final <= 0) return end(g, 'crew', '크루원이 끝까지 살아남았습니다', 'hnsTime');
    if (g.s.finalPings && t >= H.nextPing) {
      H.nextPing = t + Math.max(1000, sec(g.s.pingInterval));
      const ping = [...g.st.values()].filter(x => x.alive && !x.left && x.team === 'crew').map(x => { const c = g.P(x.id); return [x.id, Math.round(c?.x || 0), Math.round(c?.y || 0)]; });
      const seeker = [...g.st.values()].find(x => x.team === 'impostor' && x.alive);
      if (seeker) g.send(seeker.id, { t: 'hns', phase: 'final', left: ms(H.final), pings: ping, pingMs: RULES.hnsPingShow * 1000, seekMap: seekMapOn(g) });
    }
  }
  if (t >= H.nextSync) { H.nextSync = t + 1000; hnsSend(g); }
}

// ---------- 매 틱 (66ms) ----------
export function tick(g, dt) {
  if (g.over) return;
  const t = now();
  if (g.phase === 'intro') { if (t >= g.phaseEnd) beginPlay(g); return; }
  if (g.phase === 'spawn') { if (t >= g.phaseEnd) finishSpawn(g); return; }
  if (g.phase === 'meeting') return meetingTick(g, t);
  if (g.phase === 'eject') { if (t >= g.phaseEnd && !checkWin(g)) resume(g); return; }
  if (g.phase !== 'play') return;
  RL.tick(g, dt, t);
  if (g.over) return;
  for (const st of g.st.values()) {
    if (st.vent && st.ventEnd && t >= st.ventEnd) ventOut(g, g.P(st.id), st, true);
    if (st.trans && t >= st.trans.until) finishTrans(g, st);
    if (st.vitalsConsole && t >= st.vitalsNext && !st.vitalsOpen) sendVitals(g, st);
    if (st.doorlogOpen && t >= (st.doorlogNext || 0)) { st.doorlogNext = t + 1000; g.send(st.id, g.sab?.type === 'comms' ? { t: 'doorlogData', list: null, comms: true } : { t: 'doorlogData', list: g.doorlog }); }
  }
  const S = g.sab;
  if (S) {
    if (S.type === 'critical' && t >= S.until) {
      if (g.practice) endSab(g, null);
      else { const n = S.def.name || '방해 공작'; return end(g, 'impostor', `${n}${josa(n, '을', '를')} 막지 못했습니다`, 'sab'); }
    } else if (S.type === 'mixup' && S.until && t >= S.until) endSab(g, null);
    else if (S.winEnd && t >= S.winEnd) { S.parts = {}; S.winEnd = 0; g.bc({ t: 'sab', sab: sabPub(g), reset: true }); }
  } else if (g.sabCd > 0) g.sabCd = Math.max(0, g.sabCd - dt);
  let ch = false;
  for (const [id, d] of g.doors) if (t >= d.until) { g.doors.delete(id); ch = true; }
  if (ch) bcDoors(g);
  // 바이퍼 산: 3단계로 녹다가 사라짐
  for (const b of g.bodies) {
    if (!b.acid) continue;
    const f = (t - b.acid.start) / b.acid.dur;
    if (f >= 1) {
      b.gone = true;
      g.bc({ t: 'bodyGone', id: b.id });
      const rec = g.deathRec.get(b.id);
      if (rec) rec.dissolved = true;
      const k = rec && g.st.get(rec.by);
      if (k) k.stat.dissolved = (k.stat.dissolved || 0) + 1;
    } else {
      const stage = Math.min(3, 1 + Math.floor(f * 3));
      if (stage !== b.acid.stage) { b.acid.stage = stage; g.bc({ t: 'bodyStage', id: b.id, stage }); }
    }
  }
  if (g.bodies.some(b => b.gone)) g.bodies = g.bodies.filter(b => !b.gone);
  sensorTick(g, t);
  if (g.hns && g.hnsT) hnsTick(g, dt, t);
}

// ---------- 퇴장 ----------
export function onLeave(g, c) {
  const st = g.st.get(c.id);
  if (!st || st.left) return;
  RL.endAbilities(g, st, 'leave');
  st.left = true; st.alive = false; st.vent = null; st.trans = null; st.picking = false;
  if (g.sab?.def?.together) for (const p in g.sab.parts) if (g.sab.parts[p] === c.id) delete g.sab.parts[p];
  if (g.meeting) { g.meeting.votes.delete(c.id); if (g.meeting.overrule?.judge === c.id) g.meeting.overrule = null; maybeTally(g); }
  for (const x of g.st.values()) if (x.track?.id === c.id) x.track.until = 0;
  if (g.phase === 'spawn' && ![...g.st.values()].some(s => s.picking)) finishSpawn(g);
  pushBar(g);
  checkWin(g);
}

// ---------- 맵 변경 (mod) ----------
export function changeMap(g, id) {
  const map = getMap(id);
  g.map = map; g.s.map = map.id;
  for (const st of g.st.values()) { st.vent = null; st.ventEnd = 0; st.trans = null; st.picking = false; st.vitalsConsole = false; st.doorlogOpen = false; }
  g.bodies = []; g.evidence = []; g.doors.clear(); g.doorCd.clear(); g.platforms = {}; g.doorlog = []; g.sensorIn.clear();
  if (g.sab) { g.sab = null; g.bc({ t: 'sab', sab: null }); }
  assignTasks(g);
  placeAll(g, map.spawn);
  if (g.phase === 'spawn') enterPlay(g);
  const pos = [...g.r.players.values()].map(p => [p.id, Math.round(p.x), Math.round(p.y)]);
  for (const p of g.r.players.values()) { const st = g.st.get(p.id); g.send(p, { t: 'mapChange', map: map.id, tasks: st?.tasks || [], pos, bar: taskBar(g), doors: doorsPub(g) }); }
  for (const st of g.st.values()) if (st.role === 'judge') { st.judgeUnlocked = false; RL.checkJudge(g, st, true); }
}
// 설정이 게임 중에 바뀜 (mod 설정 해킹)
export function onSettings(g) {
  g.bc({ t: 'settings', settings: g.s });
  if (g.s.map !== g.map.id) changeMap(g, g.s.map);
}
