// 역할 배정 + 역할 능력 (서버 권한). game.js 가 만든 게임 객체 g 의 도우미(g.send, g.bc, g.P ...)를 사용한다.
import { ROLE_DEFS, ROLE_ORDER, GHOST_ROLES, roleTeam, isImpRole, isGhostRole, roleOpt, INFLUENCER_IMAGES, INFLUENCER } from '../public/js/shared/roles.js';
import { RULES, shuffle, pick, COLORS } from '../public/js/shared/data.js';

const rnd = n => Math.floor(Math.random() * n);
const popRandom = a => a.splice(rnd(a.length), 1)[0];
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sec = v => Math.max(0, +v || 0) * 1000;
const now = () => Date.now();
const opt = (g, role, k) => roleOpt(g.s, role, k);
const TOL = 140; // 지연 보정용 거리 여유
const reach = (g, st) => RULES.targetDist + TOL + (st.alive ? 0 : 120);

// ---------- 시작 역할 배정 (원작 RoleManager.SelectRoles 와 같은 순서) ----------
// 1) 확률 100% 역할 자리 → 2) 확률 역할(자리마다 따로 굴림) → 3) 나머지는 기본 역할. 임포스터 역할은 임포스터 자리를 대체한다.
function assignTeam(pool, team, cap, def, rs, out) {
  pool = [...pool];
  let given = 0;
  const roles = ROLE_ORDER.filter(r => roleTeam(r) === team && !isGhostRole(r));
  const count = r => Math.max(0, Math.min(64, Math.floor(+rs[r]?.max || 0)));
  let slots = [];
  for (const r of roles) if ((+rs[r]?.chance || 0) >= 100) for (let i = 0; i < count(r); i++) slots.push(r);
  while (slots.length && pool.length && given < cap) { out.set(popRandom(pool), popRandom(slots)); given++; }
  slots = [];
  for (const r of roles) {
    const c = +rs[r]?.chance || 0;
    if (c > 0 && c < 100) for (let i = 0; i < count(r); i++) if (rnd(100) < c) slots.push(r);
  }
  while (slots.length && pool.length && given < cap) { out.set(popRandom(pool), popRandom(slots)); given++; }
  for (const id of pool) out.set(id, def);
}
// forced: mod 가 고정한 역할 (Map id → role). 유령 역할은 크루원으로 시작해 죽으면 그 역할이 된다.
export function assignRoles(ids, s, { nImp = 1, forced = new Map(), hns = false, seeker = '' } = {}) {
  const roles = new Map(), ghostForced = new Map();
  if (hns) {
    // 술래: 방 설정에서 고른 사람 → mod 가 임포스터로 고정한 사람 → 무작위
    const fi = [...forced].find(([id, r]) => ids.includes(id) && isImpRole(r));
    const sk = ids.includes(seeker) ? seeker : fi ? fi[0] : pick(ids);
    for (const id of ids) roles.set(id, id === sk ? 'impostor' : 'crewmate');
    return { roles, ghostForced };
  }
  let pool = shuffle([...ids]);
  let fImp = 0, fCrew = 0;
  for (const id of pool) {
    const f = forced.get(id);
    if (!f || !ROLE_DEFS[f]) continue;
    if (isGhostRole(f)) { ghostForced.set(id, f); roles.set(id, 'crewmate'); fCrew++; } else { roles.set(id, f); isImpRole(f) ? fImp++ : fCrew++; }
  }
  pool = pool.filter(id => !roles.has(id));
  // 크루원이 최소 1명은 남도록
  const need = Math.max(0, Math.min(nImp - fImp, pool.length - (fCrew ? 0 : 1)));
  const imps = pool.slice(0, need), crew = pool.slice(need), rs = s.roleSet || {};
  assignTeam(imps, 'impostor', imps.length, 'impostor', rs, roles);
  assignTeam(crew, 'crew', Infinity, 'crewmate', rs, roles);
  return { roles, ghostForced };
}

// ---------- 쿨다운 ----------
export function setCd(g, st, a, ms, extra = {}) {
  st.cds[a] = Math.max(0, ms);
  g.send(st.id, { t: 'abilityCd', a, ms: Math.round(st.cds[a]), ...extra });
  if (a === 'kill' && st.role === 'viper') g.send(st.id, { t: 'abilityCd', a: 'acid', ms: Math.round(st.cds[a]) });
}
export const cdsPub = st => Object.fromEntries(Object.entries(st.cds).map(([k, v]) => [k, Math.max(0, Math.round(v))]));
const ready = (g, st, a) => !(st.cds[a] > 0) || !!g.P(st.id)?.nocd;

// 역할에 맞게 쿨다운/상태 초기화 (start: 게임 시작 시)
export function initRole(g, st, start) {
  const role = st.role, cds = (st.cds ||= {});
  for (const k of ['vent', 'vitals', 'protect', 'track', 'interrogate', 'message', 'shift', 'vanish']) delete cds[k];
  if (st.team === 'impostor') { if (cds.kill === undefined) cds.kill = g.hns ? RULES.hnsKillCd * 1000 : RULES.killStart * 1000; }
  else delete cds.kill;
  if (g.hns && st.team === 'crew') cds.vent = 0;
  switch (role) {
    case 'engineer': cds.vent = 0; break;
    case 'scientist': cds.vitals = 0; st.battery = sec(opt(g, 'scientist', 'battery')); break;
    case 'tracker': cds.track = 0; break;
    case 'detective': cds.interrogate = 0; st.cases ||= []; break;
    case 'judge': st.judgeUsed = false; st.judgeUnlocked = false; break;
    case 'guardian': cds.protect = start ? 0 : 10000; break;
    case 'influencer': cds.message = start ? 0 : 10000; break;
    case 'shapeshifter': cds.shift = Math.min(10000, sec(opt(g, 'shapeshifter', 'shiftCd'))); break;
    case 'phantom': cds.vanish = Math.min(10000, sec(opt(g, 'phantom', 'vanishCd'))); break;
  }
}

// ---------- 유령 역할 (죽거나 방출된 크루원) ----------
export function rollGhostRole(g, st) {
  if (g.hns || st.team !== 'crew' || st.left) return null;
  const f = g.ghostForced.get(st.id);
  if (f) { g.ghostForced.delete(st.id); return f; }
  for (const R of GHOST_ROLES) {
    const set = g.s.roleSet?.[R];
    if (!set || !(+set.max > 0) || !(+set.chance > 0)) continue;
    const cnt = [...g.st.values()].filter(x => x.role === R).length;
    if (cnt < +set.max && (+set.chance >= 100 || rnd(100) < +set.chance)) return R;
  }
  return null;
}
export const matesOf = (g, st) => (g.hns ? [...g.st.values()].filter(x => x.team === 'impostor').map(x => x.id)
  : st.team === 'impostor' ? [...g.st.values()].filter(x => x.team === 'impostor').map(x => x.id) : []);
function sendRole(g, st, quiet) {
  g.send(st.id, { t: 'roleSet', role: st.role, team: st.team, mates: matesOf(g, st), cds: cdsPub(st), alive: st.alive, quiet: !!quiet, tasks: st.tasks });
  if (st.role === 'judge') judgeState(g, st);
  if (st.role === 'detective') sendCases(g, st);
}
// 죽은 뒤 처리: 능력 상태 정리 + 유령 역할 굴리기
export function onDeath(g, st) {
  endAbilities(g, st, 'death');
  const R = rollGhostRole(g, st);
  if (R) { st.role = R; initRole(g, st, false); sendRole(g, st); }
}
// mod 계정 해킹: 즉시 역할 변경
export function changeRole(g, id, role) {
  const st = g.st.get(id);
  if (!st || !ROLE_DEFS[role]) return false;
  endAbilities(g, st, 'role');
  const oldTeam = st.team;
  st.role = role; st.team = roleTeam(role);
  if (oldTeam !== st.team && st.team === 'impostor') delete st.cds.kill;
  initRole(g, st, false);
  if (st.team === 'impostor' && st.cds.kill === undefined) st.cds.kill = 0;
  if (role === 'judge') checkJudge(g, st, true);
  sendRole(g, st);
  if (oldTeam !== st.team) for (const x of g.st.values()) if (x !== st && (x.team === 'impostor' || g.hns)) sendRole(g, x, true);
  return true;
}

// ---------- 공통 ----------
const comms = g => g.sab?.type === 'comms';
const commsErr = (g, st) => g.send(st.id, { t: 'err', msg: '통신 방해 중에는 능력을 사용할 수 없습니다.' });
const canUse = (g, st) => g.phase === 'play' && !st.vent && !st.trans && !st.picking && !st.left;
const target = (g, id) => { const c = g.P(id), s = g.st.get(id); return c && s && !s.left ? [c, s] : [null, null]; };
// 쉴드가 보이는 사람: 수호천사 본인, 유령, (설정 시) 살아있는 임포스터
const shieldAud = (g, by) => (c, s) => !s || !s.alive || c.id === by || (opt(g, 'guardian', 'protectVisible') && s.team === 'impostor');

// 능력 강제 종료 (회의, 죽음, 역할 변경)
export function endAbilities(g, st, why) {
  if (st.shift) unshift(g, st, { quiet: why === 'meeting' });
  if (st.vanish) appear(g, st, true);
  if (st.track) untrack(g, st);
  if (st.vitalsOpen) closeVitals(g, st, why);
  st.vitalsConsole = false; st.doorlogOpen = false;
  if (st.wheel) { st.wheel = null; g.send(st.id, { t: 'msgWheel', close: true }); }
}

// ---------- 능력 메시지 ----------
export function ability(g, c, st, m) {
  const a = String(m.a || '');
  switch (a) {
    case 'vent': return g.ventToggle(c, st, m.v);
    case 'vitals': return st.role === 'scientist' && vitals(g, c, st, m.on === undefined ? !st.vitalsOpen : !!m.on);
    case 'protect': return st.role === 'guardian' && protect(g, c, st, m.id);
    case 'shift': return st.role === 'shapeshifter' && (st.shift && !m.id ? unshift(g, st) : shift(g, c, st, m.id));
    case 'unshift': return st.role === 'shapeshifter' && st.shift && unshift(g, st);
    case 'vanish': return st.role === 'phantom' && (st.vanish ? appear(g, st) : vanish(g, c, st));
    case 'appear': return st.role === 'phantom' && st.vanish && appear(g, st);
    case 'track': return st.role === 'tracker' && (st.track && !m.id ? untrack(g, st, true) : track(g, c, st, m.id));
    case 'untrack': return st.role === 'tracker' && st.track && untrack(g, st, true);
    case 'interrogate': return st.role === 'detective' && interrogate(g, c, st, m.id);
    case 'notes': return st.role === 'detective' && notes(g, st, m);
    case 'overrule': return st.role === 'judge' && overrule(g, c, st, m.id);
    case 'message': return st.role === 'influencer' && (Array.isArray(m.imgs) && st.wheel ? sendMsg(g, st, m.imgs) : openWheel(g, c, st, m.id));
    case 'refresh': return st.role === 'influencer' && refreshWheel(g, st);
    case 'send': return st.role === 'influencer' && sendMsg(g, st, m.imgs);
    case 'close': if (st.wheel) st.wheel = null; return;
    case 'acid': case 'kill': return g.kill(c, st, m.id);
  }
}

// ---- 과학자: 휴대용 바이탈 (배터리는 열어 둔 동안 닳고, 임무 완료 시 완충) ----
function vitals(g, c, st, on) {
  if (!on) return closeVitals(g, st);
  if (!st.alive || !canUse(g, st)) return;
  if (comms(g)) return g.send(st.id, { t: 'vitalsData', list: null, comms: true });
  if (st.battery <= 0) return g.send(st.id, { t: 'abilityCd', a: 'vitals', ms: Math.round(st.cds.vitals || 0), battery: 0, max: sec(opt(g, 'scientist', 'battery')), empty: true });
  st.vitalsOpen = true; st.vitalsNext = 0;
  g.sendVitals(st);
}
function closeVitals(g, st, why) {
  if (!st.vitalsOpen) return;
  st.vitalsOpen = false;
  g.send(st.id, { t: 'vitalsData', list: null, closed: true, why: why || 'close' });
  g.send(st.id, { t: 'abilityCd', a: 'vitals', ms: Math.round(st.cds.vitals || 0), battery: Math.round(st.battery), max: sec(opt(g, 'scientist', 'battery')) });
}

// ---- 수호천사: 보호 ----
function protect(g, c, st, id) {
  const [tc, ts] = target(g, id);
  if (!tc || !ts.alive || tc.id === c.id || g.phase !== 'play') return;
  if (comms(g)) return commsErr(g, st);
  if (!ready(g, st, 'protect') || d2(c, tc) > reach(g, st)) return;
  const t = now();
  if (ts.shield && ts.shieldBy !== st.id) g.bc({ t: 'shield', id: tc.id, on: false }, shieldAud(g, ts.shieldBy));
  ts.shield = t + sec(opt(g, 'guardian', 'protectTime')); ts.shieldBy = st.id;
  st.stat.protects = (st.stat.protects || 0) + 1;
  g.bc({ t: 'shield', id: tc.id, on: true, by: st.id, ms: ts.shield - t }, shieldAud(g, st.id));
  setCd(g, st, 'protect', sec(opt(g, 'guardian', 'protectCd')));
}
// 처치 시도가 보호막에 막힘: 보호막 깨짐 + 처치 쿨다운 절반
export function shieldBreak(g, killer, ks, victim, vs) {
  const by = vs.shieldBy;
  vs.shield = 0; vs.shieldBy = null;
  g.protectedRecently = true;
  setCd(g, ks, 'kill', sec(g.s.killCooldown) / 2, { shield: true });
  g.bc({ t: 'shieldHit', id: victim.id, by: killer.id }, (c, s) => c.id === killer.id || !s || !s.alive);
  g.bc({ t: 'shield', id: victim.id, on: false, broken: true }, shieldAud(g, by));
}

// ---- 형상 변환자: 변신 ----
function shift(g, c, st, id) {
  if (st.shift || !st.alive || !canUse(g, st) || st.vanish) return;
  if (comms(g)) return commsErr(g, st);
  if (!ready(g, st, 'shift')) return;
  const [tc, ts] = target(g, id);
  if (!tc || tc.id === c.id) return;
  // 대상: 살아있는 플레이어, 또는 시체가 맵에 남아있는 죽은 플레이어
  if (!ts.alive && !g.bodies.some(b => b.id === tc.id && !b.gone)) return;
  const t = now(), dur = sec(opt(g, 'shapeshifter', 'shiftTime'));
  st.shift = tc.id; st.shiftEnd = dur ? t + dur : 0;
  const ev = !!opt(g, 'shapeshifter', 'evidence');
  if (ev) g.evidence.push({ id: st.id, x: c.x, y: c.y });
  g.bc({ t: 'shift', id: st.id, as: tc.id, x: Math.round(c.x), y: Math.round(c.y), evidence: ev, ms: dur || 0 });
}
function unshift(g, st, { quiet } = {}) {
  if (!st.shift) return;
  const c = g.P(st.id), ev = !quiet && !st.vent && !!opt(g, 'shapeshifter', 'evidence');
  st.shift = null; st.shiftEnd = 0;
  if (ev && c) g.evidence.push({ id: st.id, x: c.x, y: c.y });
  g.bc({ t: 'shift', id: st.id, as: null, x: Math.round(c?.x || 0), y: Math.round(c?.y || 0), evidence: ev, quiet: !!quiet });
  if (st.role === 'shapeshifter') setCd(g, st, 'shift', sec(opt(g, 'shapeshifter', 'shiftCd')));
}
export const unshiftAll = g => { for (const st of g.st.values()) if (st.shift) unshift(g, st); };

// ---- 팬텀: 사라지기 / 나타나기 ----
function vanish(g, c, st) {
  if (st.vanish || !st.alive || !canUse(g, st)) return;
  if (comms(g)) return commsErr(g, st);
  if (!ready(g, st, 'vanish')) return;
  const t = now(), dur = sec(opt(g, 'phantom', 'vanishTime'));
  st.vanish = t + (dur || 1000);
  g.bc({ t: 'vanish', id: st.id, on: true, x: Math.round(c.x), y: Math.round(c.y), ms: st.vanish - t });
}
function appear(g, st, quiet) {
  if (!st.vanish) return;
  st.vanish = 0;
  const c = g.P(st.id);
  g.bc({ t: 'vanish', id: st.id, on: false, x: Math.round(c?.x || 0), y: Math.round(c?.y || 0), quiet: !!quiet });
  if (st.role === 'phantom') setCd(g, st, 'vanish', sec(opt(g, 'phantom', 'vanishCd')));
}

// ---- 추적자 ----
function track(g, c, st, id) {
  if (st.track || !st.alive || !canUse(g, st)) return;
  if (comms(g)) return commsErr(g, st);
  if (!ready(g, st, 'track')) return;
  const [tc, ts] = target(g, id);
  if (!tc || tc.id === c.id || !ts.alive || d2(c, tc) > reach(g, st)) return;
  const t = now();
  st.track = { id: tc.id, until: t + sec(opt(g, 'tracker', 'trackTime')), next: 0 };
  sendTrack(g, st, t);
}
function sendTrack(g, st, t) {
  const T = st.track, tc = g.P(T.id), ts = g.st.get(T.id);
  const p = ts && !ts.alive && ts.deathPos ? ts.deathPos : tc || T.last || { x: 0, y: 0 };
  T.last = { x: Math.round(p.x), y: Math.round(p.y) };
  T.next = t + Math.max(200, sec(opt(g, 'tracker', 'trackDelay')));
  g.send(st.id, { t: 'track', id: T.id, ms: Math.max(0, T.until - t), x: T.last.x, y: T.last.y, dead: !!ts && !ts.alive, color: tc?.look?.color });
}
function untrack(g, st, manual) {
  if (!st.track) return;
  st.track = null;
  g.send(st.id, { t: 'track', id: null, ms: 0, manual: !!manual });
  if (st.role === 'tracker') setCd(g, st, 'track', sec(opt(g, 'tracker', 'trackCd')));
}

// ---- 탐정: 노트 + 심문 ----
export function sendCases(g, st) {
  g.send(st.id, { t: 'cases', list: st.cases || [], active: st.activeCase || null, limit: Math.max(0, Math.floor(+opt(g, 'detective', 'suspects') || 0)) });
}
function interrogate(g, c, st, id) {
  if (!st.alive || !canUse(g, st)) return;
  if (comms(g)) return commsErr(g, st);
  const cs = st.cases?.find(x => x.id === st.activeCase);
  if (!cs) return g.send(st.id, { t: 'err', msg: '진행 중인 사건이 없습니다. 시체가 신고되어야 심문할 수 있습니다.' });
  const limit = Math.max(0, Math.floor(+opt(g, 'detective', 'suspects') || 0));
  if (cs.suspects.length >= limit) return g.send(st.id, { t: 'err', msg: '이 사건의 용의자 수를 모두 채웠습니다.' });
  if (!ready(g, st, 'interrogate')) return;
  const [tc, ts] = target(g, id);
  if (!tc || tc.id === c.id || !ts.alive || d2(c, tc) > reach(g, st)) return;
  const shown = ts.shift || tc.id; // 변신 중이면 변신한 모습으로 기록
  if (cs.suspects.some(x => x.real === tc.id)) return g.send(st.id, { t: 'err', msg: '이미 이 사건에서 심문한 사람입니다.' });
  const rec = g.deathRec.get(cs.id), snap = rec?.snap?.get(tc.id);
  const loc = cs.dissolved || !snap ? null : g.locOf(snap.x, snap.y);
  const sp = g.P(shown) || tc;
  cs.suspects.push({ id: shown, real: tc.id, name: sp.name, color: sp.look?.color ?? 0, room: loc?.room ?? null, near: !!loc?.near });
  st.stat.questioned = (st.stat.questioned || 0) + 1;
  setCd(g, st, 'interrogate', 0);
  g.send(tc.id, { t: 'interrogated', by: st.id });
  sendCases(g, st);
}
const txt = (v, n) => String(v ?? '').replace(/[<>]/g, '').slice(0, n);
function notes(g, st, m) {
  const cs = st.cases?.find(x => x.id === (m.case ?? st.activeCase));
  if (!cs) return sendCases(g, st);
  st.activeCase = cs.id;
  if (m.guess !== undefined) cs.guess = txt(m.guess, 20);
  if (m.prep !== undefined) cs.prep = txt(m.prep, 10);
  if (m.note !== undefined) cs.note = txt(m.note, 200);
  sendCases(g, st);
}

// ---- 판사: 기각 ----
export function checkJudge(g, st, silent) {
  if (st.role !== 'judge' || st.judgeUnlocked) return;
  const need = Math.max(0, +opt(g, 'judge', 'taskPct') || 0), total = st.tasks.length, done = st.tasks.filter(t => t.step >= t.st.length).length;
  if (!total || (done / total) * 100 >= need - 1e-9) {
    st.judgeUnlocked = true;
    if (!silent) g.send(st.id, { t: 'toast', msg: '기각 능력이 해금되었습니다!' });
  }
  judgeState(g, st);
}
function judgeState(g, st) {
  const total = st.tasks.length, done = st.tasks.filter(t => t.step >= t.st.length).length;
  g.send(st.id, { t: 'abilityCd', a: 'overrule', ms: 0, locked: !st.judgeUnlocked, used: !!st.judgeUsed, done, total, need: +opt(g, 'judge', 'taskPct') || 0 });
}
function overrule(g, c, st, id) {
  const M = g.meeting;
  if (!M || M.stage !== 'vote' || !st.alive || st.judgeUsed || !st.judgeUnlocked || M.votes.has(c.id)) return;
  if (M.commsAtStart || comms(g)) return g.send(st.id, { t: 'err', msg: '통신 방해 중에는 기각할 수 없습니다.' });
  const [tc, ts] = target(g, id);
  if (!tc || tc.id === c.id || !ts.alive) return;
  if (M.overrule) { // 다른 판사가 먼저 — 사용 횟수 돌려받음
    g.send(st.id, { t: 'overrule', ok: false, beaten: true, msg: '다른 판사가 먼저 판결했습니다.' });
    return;
  }
  M.overrule = { judge: c.id, target: tc.id };
  st.judgeUsed = true;
  g.send(st.id, { t: 'overrule', ok: true, target: tc.id });
  judgeState(g, st);
  g.castVote(c, tc.id, true); // 다른 사람에게는 평범한 투표처럼 보임
}

// ---- 인플루언서: 메시지 ----
const rollImgs = () => shuffle(INFLUENCER_IMAGES.map(i => i.id)).slice(0, INFLUENCER.wheel);
function openWheel(g, c, st, id) {
  if (g.phase !== 'play' || st.left || !ready(g, st, 'message')) return;
  const [tc, ts] = target(g, id);
  if (!tc || tc.id === c.id || !ts.alive || d2(c, tc) > reach(g, st)) return;
  st.wheel = { target: tc.id, imgs: rollImgs(), refreshes: INFLUENCER.refreshes, sendAt: 0 };
  wheelMsg(g, st);
}
function wheelMsg(g, st) {
  const W = st.wheel;
  g.send(st.id, { t: 'msgWheel', target: W.target, imgs: W.imgs, refresh: W.refreshes, sendIn: Math.max(0, W.sendAt - now()), max: INFLUENCER.maxSend });
}
function refreshWheel(g, st) {
  const W = st.wheel;
  if (!W || W.refreshes <= 0) return;
  W.refreshes--; W.imgs = rollImgs(); W.sendAt = now() + sec(opt(g, 'influencer', 'msgCd')) / 2;
  wheelMsg(g, st);
}
function sendMsg(g, st, imgs) {
  const W = st.wheel;
  if (!W || !Array.isArray(imgs) || g.phase !== 'play' || now() < W.sendAt) return;
  const pickd = [...new Set(imgs.map(String))].filter(i => W.imgs.includes(i)).slice(0, INFLUENCER.maxSend);
  const [tc, ts] = target(g, W.target);
  if (!pickd.length) return;
  st.wheel = null;
  if (!tc || !ts.alive) return g.send(st.id, { t: 'msgWheel', close: true });
  g.send(tc.id, { t: 'message', imgs: pickd, ms: INFLUENCER.showMs });
  g.send(st.id, { t: 'msgWheel', close: true, sent: pickd });
  st.stat.messages = (st.stat.messages || 0) + 1;
  setCd(g, st, 'message', sec(opt(g, 'influencer', 'msgCd')));
}

// ---------- 처치 연동 ----------
// 노이즈 메이커 경보 (방출 X, 통신 방해 중 X)
export function onKilled(g, vs, x, y) {
  if (vs.role === 'noisemaker' && !comms(g)) {
    const imp = !!opt(g, 'noisemaker', 'impAlert');
    g.bc({ t: 'noise', id: vs.id, x: Math.round(x), y: Math.round(y), ms: sec(opt(g, 'noisemaker', 'alertTime')) },
      (c, s) => !s || !s.alive || s.team !== 'impostor' || imp);
  }
}
// 임무 완료 연동: 과학자 배터리 완충, 판사 해금
export function onTaskDone(g, st) {
  if (st.role === 'scientist') {
    st.battery = sec(opt(g, 'scientist', 'battery')); st.cds.vitals = 0;
    st.stat.charges = (st.stat.charges || 0) + 1;
    g.send(st.id, { t: 'abilityCd', a: 'vitals', ms: 0, battery: st.battery, max: st.battery, charged: true });
  }
  if (st.role === 'judge') checkJudge(g, st);
}
// 통신 방해 시작: 기술자 환풍구 퇴출, 바이탈 닫기, 추적 점 사라짐
export function onComms(g) {
  for (const st of g.st.values()) {
    if (st.vent && st.role === 'engineer' && !g.hns) g.ventOut(g.P(st.id), st, true);
    if (st.vitalsOpen) closeVitals(g, st, 'comms');
    if (st.vitalsConsole) g.send(st.id, { t: 'vitalsData', list: null, comms: true });
    if (st.track) g.send(st.id, { t: 'track', id: st.track.id, ms: Math.max(0, st.track.until - now()), comms: true });
  }
}
// 회의 시작: 변신/투명/추적/바이탈/보호막 끝 + 탐정 사건 파일 생성
export function onMeeting(g, reported) {
  for (const st of g.st.values()) {
    endAbilities(g, st, 'meeting');
    if (st.shield) { const by = st.shieldBy; st.shield = 0; st.shieldBy = null; g.bc({ t: 'shield', id: st.id, on: false }, shieldAud(g, by)); }
  }
  const fresh = g.deaths.splice(0);
  for (const st of g.st.values()) {
    if (st.role !== 'detective' || !fresh.length) continue;
    for (const d of fresh) st.cases.push({ id: d.id, name: d.name, color: d.color, at: d.at, room: d.dissolved ? null : d.loc?.room ?? null,
      near: !!d.loc?.near, dissolved: !!d.dissolved, suspects: [], guess: '', prep: '', note: '' });
    st.activeCase = st.cases.some(x => x.id === reported) ? reported : st.cases[st.cases.length - 1].id;
    st.stat.cases = st.cases.length;
    sendCases(g, st);
  }
}
// 회의 후: 탐정 심문 10초 쿨다운
export function afterMeeting(g) {
  for (const st of g.st.values()) if (st.role === 'detective' && st.alive) st.cds.interrogate = RULES.detectiveMeetingCd * 1000;
}

// ---------- 매 틱 (play 단계에서만) ----------
export function tick(g, dt, t) {
  for (const st of g.st.values()) {
    if (st.left) continue;
    for (const k in st.cds) if (st.cds[k] > 0 && !(k === 'kill' && (st.vent || st.trans))) st.cds[k] = Math.max(0, st.cds[k] - dt);
    if (st.shield && t >= st.shield) { const by = st.shieldBy; st.shield = 0; st.shieldBy = null; g.bc({ t: 'shield', id: st.id, on: false }, shieldAud(g, by)); }
    if (st.shift && st.shiftEnd && t >= st.shiftEnd) unshift(g, st);
    if (st.vanish && t >= st.vanish) appear(g, st);
    if (st.track) {
      const ts = g.st.get(st.track.id);
      if (t >= st.track.until || !ts || ts.left) untrack(g, st);
      else if (!comms(g) && t >= st.track.next) sendTrack(g, st, t);
    }
    if (st.role === 'scientist') {
      if (st.vitalsOpen) {
        st.battery -= dt;
        if (st.battery <= 0) {
          st.battery = 0;
          st.cds.vitals = sec(opt(g, 'scientist', 'vitalsCd'));
          closeVitals(g, st, 'battery');
        } else if (t >= (st.vitalsNext || 0)) g.sendVitals(st);
      } else if (st.battery <= 0 && st.cds.vitals <= 0 && st.alive) {
        // 모든 임무를 끝냈으면 쿨다운 뒤 자동 충전
        if (st.tasks.every(x => x.step >= x.st.length)) {
          st.battery = sec(opt(g, 'scientist', 'battery'));
          g.send(st.id, { t: 'abilityCd', a: 'vitals', ms: 0, battery: st.battery, max: st.battery, charged: true });
        }
      }
    }
  }
}
export const IMG_IDS = INFLUENCER_IMAGES.map(i => i.id);
export { COLORS };
