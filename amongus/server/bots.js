// AI 봇: 혼자서도 클래식 게임을 할 수 있게 사람처럼 움직이고 판단한다 (서버·브라우저 공용).
// 크루원 봇: 임무 → 시체 신고 → 사보타주 수리, 목격한 처치를 기억했다가 투표.
// 임포스터 봇: 가짜 임무로 돌아다니다 목격자가 없을 때 처치, 가끔 사보타주.
import { RULES } from '../public/js/shared/data.js';
import { canStand, lineClear, walkable, LOBBY } from '../public/js/shared/maps/index.js';
import * as GM from './game.js';

const now = () => Date.now();
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const VISION = 620, WITNESS = 720;

// ---------- 길찾기: 걸을 수 있는 칸 격자 + 이동 장치(사다리·플랫폼·소독실) 연결 ----------
const CELL = 40;
const NAV = new WeakMap();
function nav(m) {
  let n = NAV.get(m);
  if (n) return n;
  const gw = Math.ceil(m.w / CELL), gh = Math.ceil(m.h / CELL), ok = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) ok[j * gw + i] = canStand(m, (i + 0.5) * CELL, (j + 0.5) * CELL) ? 1 : 0;
  const cellOf = (x, y) => { const i = Math.floor(x / CELL), j = Math.floor(y / CELL); return i >= 0 && j >= 0 && i < gw && j < gh ? j * gw + i : -1; };
  // 가장 가까운 걸을 수 있는 칸
  const snap = (x, y) => {
    const c = cellOf(x, y);
    if (c >= 0 && ok[c]) return c;
    const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL);
    for (let r = 1; r < 8; r++) {
      let best = -1, bd = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= gw || j >= gh || !ok[j * gw + i]) continue;
        const dd = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y);
        if (dd < bd) { bd = dd; best = j * gw + i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const links = new Map();
  const comp = new Int32Array(gw * gh); // 연결된 영역 번호 (가장 큰 영역 = 본 맵)
  for (const T of m.transports || []) {
    const a = snap(T.a.x, T.a.y), b = snap(T.b.x, T.b.y);
    if (a < 0 || b < 0) continue;
    (links.get(a) || links.set(a, []).get(a)).push({ to: b, T, end: 'a' });
    if (!T.oneWay) (links.get(b) || links.set(b, []).get(b)).push({ to: a, T, end: 'b' });
  }
  // 연결 영역 계산 (사다리 등 이동 장치 포함) → 고립된 작은 틈으로 스냅되지 않게
  const sizes = [0];
  for (let c0 = 0; c0 < gw * gh; c0++) {
    if (!ok[c0] || comp[c0]) continue;
    const id = sizes.length, st = [c0];
    let size = 0;
    comp[c0] = id;
    while (st.length) {
      const c = st.pop(); size++;
      const ci = c % gw;
      for (const nb of [c + 1, c - 1, c + gw, c - gw]) {
        if (nb < 0 || nb >= gw * gh || !ok[nb] || comp[nb] || Math.abs((nb % gw) - ci) > 1) continue;
        comp[nb] = id; st.push(nb);
      }
      for (const L of links.get(c) || []) if (!comp[L.to]) { comp[L.to] = id; st.push(L.to); }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const snapMain = (x, y) => {
    const c = cellOf(x, y);
    if (c >= 0 && ok[c] && comp[c] === main) return c;
    const i0 = Math.floor(x / CELL), j0 = Math.floor(y / CELL);
    for (let r = 1; r < 12; r++) {
      let best = -1, bd = Infinity;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= gw || j >= gh || comp[j * gw + i] !== main) continue;
        const dd = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y);
        if (dd < bd) { bd = dd; best = j * gw + i; }
      }
      if (best >= 0) return best;
    }
    return snap(x, y);
  };
  n = { gw, gh, ok, links, snap: snapMain, cellOf, comp, main };
  NAV.set(m, n);
  return n;
}
const center = (n, c) => ({ x: ((c % n.gw) + 0.5) * CELL, y: (Math.floor(c / n.gw) + 0.5) * CELL });
// 닫힌 문 칸
function doorBlock(g, n) {
  if (!g?.doors?.size) return null;
  const bl = new Set();
  for (const id of g.doors.keys()) {
    const d = g.map.doorById?.[id];
    if (!d) continue;
    for (let y = d.y - CELL / 2; y <= d.y + d.h + CELL / 2; y += CELL / 2) for (let x = d.x - CELL / 2; x <= d.x + d.w + CELL / 2; x += CELL / 2) { const c = n.cellOf(x, y); if (c >= 0) bl.add(c); }
  }
  return bl;
}
// 시작점 → 목표점 경로 (점 목록, 이동 장치는 {tr} 표시)
function findPath(m, from, to, g, avoid) {
  const n = nav(m), s = n.snap(from.x, from.y), e = n.snap(to.x, to.y);
  if (s < 0 || e < 0) return null;
  if (s === e) return [canStand(m, to.x, to.y) ? { x: to.x, y: to.y } : center(n, e)];
  const bl = doorBlock(g, n), N = n.gw * n.gh, prev = new Int32Array(N).fill(-1), via = new Map();
  prev[s] = s;
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  q[qt++] = s;
  const D = [1, -1, n.gw, -n.gw, n.gw + 1, n.gw - 1, -n.gw + 1, -n.gw - 1];
  while (qh < qt) {
    const c = q[qh++];
    if (c === e) break;
    const ci = c % n.gw;
    for (let k = 0; k < 8; k++) {
      const nb = c + D[k], ni = nb % n.gw;
      if (nb < 0 || nb >= N || Math.abs(ni - ci) > 1 || prev[nb] >= 0 || !n.ok[nb] || bl?.has(nb)) continue;
      if (k >= 4 && (!n.ok[c + (ni - ci)] || !n.ok[nb - (ni - ci)])) continue; // 모서리 끼임 방지
      prev[nb] = c; q[qt++] = nb;
    }
    for (const L of n.links.get(c) || []) {
      if (prev[L.to] >= 0 || avoid?.has(L.T.id)) continue;
      prev[L.to] = c; via.set(L.to, L); q[qt++] = L.to;
    }
  }
  if (prev[e] < 0) return null;
  const cells = [];
  for (let c = e; c !== s; c = prev[c]) cells.push(c);
  cells.reverse();
  const out = [];
  let last = s;
  for (const c of cells) {
    const L = via.get(c);
    if (L) { out.push({ ...center(n, last), tr: L.T }); out.push({ ...center(n, c), after: true }); }
    else out.push(center(n, c));
    last = c;
  }
  // 목표점이 소품 안 등 설 수 없는 곳이면 가장 가까운 걸을 수 있는 칸에서 멈춤
  if (!out[out.length - 1].tr && !out[out.length - 1].after) out[out.length - 1] = canStand(m, to.x, to.y) && n.cellOf(to.x, to.y) === e ? { x: to.x, y: to.y } : center(n, e);
  // 지금 설 수 없는 곳에 있으면 먼저 가까운 칸으로
  const start = canStand(m, from.x, from.y) ? from : center(n, s);
  const path = smooth(n, out, start);
  if (start !== from) path.unshift(start);
  return path;
}
// 직선으로 갈 수 있는 중간점은 건너뜀
function clearLine(n, a, b) {
  const L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.ceil(L / (CELL / 2));
  for (let i = 1; i < k; i++) { const c = n.cellOf(a.x + ((b.x - a.x) * i) / k, a.y + ((b.y - a.y) * i) / k); if (c < 0 || !n.ok[c]) return false; }
  return true;
}
function smooth(n, pts, from) {
  const out = [];
  let cur = from, i = 0;
  while (i < pts.length) {
    if (pts[i].tr || pts[i].after) { out.push(pts[i]); cur = pts[i]; i++; continue; }
    let j = i;
    while (j + 1 < pts.length && !pts[j + 1].tr && !pts[j + 1].after && clearLine(n, cur, pts[j + 1])) j++;
    out.push(pts[j]); cur = pts[j]; i = j + 1;
  }
  return out;
}

export const _findPath = findPath, _nav = nav; // 테스트용
// ---------- 봇 상태 ----------
function brain(g, id) {
  g.ai ||= new Map();
  let b = g.ai.get(id);
  if (!b) { b = { goal: null, path: null, wait: 0, think: rand(0, 400), sus: new Map(), stuck: 0, lastPos: null, said: false, voteAt: 0, hunt: null, nextHunt: now() + rand(4000, 9000) }; g.ai.set(id, b); }
  return b;
}
const stationPos = (g, k) => g.map.stations?.[k];
const roomPoint = g => { const r = pickOne(g.map.rooms || []); return r ? { x: r.label.x, y: r.label.y } : null; };
const randomStation = g => { const ks = Object.keys(g.map.stations || {}); return ks.length ? stationPos(g, pickOne(ks)) : roomPoint(g); };
function setGoal(g, c, b, goal) {
  b.goal = goal;
  const t = now(), avoid = b.avoid && b.avoid.until > t ? new Set([b.avoid.id]) : null;
  b.path = goal ? (b.ghost ? [{ x: goal.x, y: goal.y }] : findPath(g.map, c, goal, g, avoid) || (avoid && findPath(g.map, c, goal, g))) : null;
  b.stuck = 0;
  if (goal && !b.path) { b.goal = null; b.wait = rand(500, 1500); }
}
// 조명 고장이면 크루원 봇 시야도 줄어듦
const visible = (g, a, p) => { const st = g.st.get(a.id), R = g.sab?.type === 'lights' && st?.team === 'crew' ? VISION * 0.4 : VISION; return d2(a, p) < R && lineClear(g.map, a.x, a.y - 30, p.x, p.y - 30, new Set(g.doors.keys())); };

// ---------- 이동 ----------
function follow(g, c, st, b, dt) {
  if (!b.path?.length) { c.mv = 0; return true; }
  let left = RULES.speed * GM.speedMul(g, c) * 0.92 * (dt / 1000);
  while (left > 0 && b.path.length) {
    const p = b.path[0];
    if (p.tr) { // 이동 장치 끝에 도착하면 사용
      if (d2(c, p) > 60) { step(c, p, left); return false; }
      c.mv = 0;
      const t = now();
      if (!b.trStart || b.trId !== p.tr.id) { b.trStart = t; b.trId = p.tr.id; }
      if (t > (b.trT || 0)) { b.trT = t + 900; GM.onMsg(c, { t: 'transport', id: p.tr.id }); }
      if (st.trans) { b.path.shift(); if (b.path[0]?.after) b.path.shift(); b.trStart = 0; }
      else if (t - b.trStart > 10000) { b.avoid = { id: p.tr.id, until: t + 25000 }; b.trStart = 0; if (b.goal) setGoal(g, c, b, b.goal); } // 플랫폼을 못 타면 다른 길로
      return false;
    }
    const dd = d2(c, p);
    if (dd <= left) { c.x = p.x; c.y = p.y; left -= dd; b.path.shift(); }
    else { step(c, p, left); left = 0; }
  }
  c.mv = b.path.length ? 1 : 0;
  return !b.path.length;
}
function step(c, p, len) {
  const dx = p.x - c.x, dy = p.y - c.y, L = Math.hypot(dx, dy) || 1;
  c.x += (dx / L) * len; c.y += (dy / L) * len;
  if (Math.abs(dx) > 2) c.dir = dx > 0 ? 1 : 0;
  c.mv = 1;
}

// ---------- 처치 목격 기억 ----------
function witness(g) {
  g.aiDeaths ||= 0;
  while (g.aiDeaths < g.deaths.length) {
    const rec = g.deaths[g.aiDeaths++];
    for (const st of g.st.values()) {
      if (!st.ai || !st.alive || st.team !== 'crew') continue;
      const c = g.P(st.id), b = brain(g, st.id), at = rec.snap?.get(st.id) || c;
      if (!c || !at) continue;
      const near = Math.hypot(at.x - rec.x, at.y - rec.y);
      if (rec.by && near < WITNESS && lineClear(g.map, at.x, at.y - 30, rec.x, rec.y - 30)) b.sus.set(rec.by, 100);
      else if (near < 1100) { // 가까이 있었다면 시체 근처에 있던 사람을 의심
        let best = null, bd = Infinity;
        for (const [pid, pos] of rec.snap || []) {
          if (pid === rec.id || pid === st.id || !g.st.get(pid)?.alive) continue;
          const dd = Math.hypot(pos.x - rec.x, pos.y - rec.y);
          if (dd < bd) { bd = dd; best = pid; }
        }
        if (best && bd < 700) b.sus.set(best, Math.max(b.sus.get(best) || 0, 35));
      }
    }
  }
}

// ---------- 매 틱 ----------
export function tick(g, dt) {
  if (!g || g.over || !g.ai && ![...g.st.values()].some(s => s.ai)) return;
  if (g.phase === 'meeting') return meeting(g);
  if (g.phase !== 'play') { for (const st of g.st.values()) if (st.ai) { const c = g.P(st.id); if (c) c.mv = 0; } return; }
  witness(g);
  for (const st of g.st.values()) {
    if (!st.ai || st.left) continue;
    const c = g.P(st.id);
    if (!c) continue;
    const b = brain(g, st.id);
    b.ghost = !st.alive;
    b.said = false; b.voteAt = 0;
    if (st.trans || st.vent || st.picking) { c.mv = 0; continue; }
    if (!st.alive && st.team === 'impostor') { c.mv = 0; continue; }
    b.think -= dt;
    if (b.think <= 0) { b.think = rand(250, 400); decide(g, c, st, b); }
    if (b.wait > 0) { b.wait -= dt; c.mv = 0; if (b.wait <= 0) arrive(g, c, st, b); continue; }
    const before = { x: c.x, y: c.y };
    const done = follow(g, c, st, b, dt);
    if (done && b.goal && !b.goal.arrived) { b.goal.arrived = true; b.wait = b.goal.dur ?? 0; if (!b.wait) arrive(g, c, st, b); }
    // 막혔으면(문 등) 다시 길 찾기, 수동 문이면 열기
    if (b.path?.length && d2(before, c) < 0.5) {
      b.stuck += dt;
      if (b.stuck > 1500) {
        b.stuck = 0;
        if (g.map.doorMode === 'manual') for (const id of g.doors.keys()) { const d = g.map.doorById?.[id]; if (d && d2(c, { x: d.x + d.w / 2, y: d.y + d.h / 2 }) < 300) GM.onMsg(c, { t: 'openDoor', id }); }
        if (b.goal) setGoal(g, c, b, b.goal);
      }
    }
  }
}

// 다음 할 일 고르기
function decide(g, c, st, b) {
  const t = now(), G = b.goal;
  if (st.team === 'impostor') return impDecide(g, c, st, b, t);
  if (g.hns) { // 숨바꼭질: 술래가 보이면 도망
    const seeker = [...g.st.values()].find(x => x.team === 'impostor' && x.alive);
    const sc = seeker && g.P(seeker.id);
    if (st.alive && sc && visible(g, c, sc) && G?.kind !== 'flee') {
      let far = null, fd = 0;
      for (let i = 0; i < 6; i++) { const p = randomStation(g); const dd = p ? d2(p, sc) : 0; if (dd > fd) { fd = dd; far = p; } }
      if (far) setGoal(g, c, b, { kind: 'flee', x: far.x, y: far.y, dur: 0 });
      return;
    }
  }
  if (st.alive && !g.hns) {
    // 1) 보이는 시체 신고
    const body = g.bodies.find(x => !x.gone && visible(g, c, x));
    if (body) {
      if (d2(c, body) < RULES.reportDist * 0.5) { GM.onMsg(c, { t: 'report', id: body.id }); return; }
      if (G?.kind !== 'report') setGoal(g, c, b, { kind: 'report', id: body.id, x: body.x, y: body.y, dur: 0 });
      return;
    }
    // 2) 사보타주 수리
    const fixGoal = sabJob(g, c, st);
    if (fixGoal) {
      if (G?.kind === 'fix' && G.p === fixGoal.p && G.k === fixGoal.k) { if (G.arrived) holdFix(g, c, G); return; }
      setGoal(g, c, b, fixGoal);
      return;
    }
    if (G?.kind === 'fix') { if (G.hold) GM.onMsg(c, { t: 'fix', k: G.k, p: G.p, on: false }); b.goal = null; b.path = null; }
  }
  if (G && !G.arrived && G.kind !== 'report') return;
  if (G?.kind === 'report') return; // 시체가 사라질 때까지 계속
  if (b.wait > 0) return;
  // 3) 임무
  const i = st.tasks.findIndex(tk => tk.step < tk.st.length);
  if (i >= 0 && !g.hns || i >= 0 && g.hns && st.alive) {
    const tk = st.tasks[i], p = stationPos(g, tk.st[tk.step]);
    if (p) return setGoal(g, c, b, { kind: 'task', i, step: tk.step, x: p.x + rand(-20, 20), y: p.y + rand(10, 40), dur: tk.kind === 'long' ? rand(5000, 9000) : rand(2500, 5500) });
  }
  // 4) 할 일이 없으면 돌아다니기
  const p = roomPoint(g);
  if (p) setGoal(g, c, b, { kind: 'wander', x: p.x + rand(-60, 60), y: p.y + rand(-40, 40), dur: rand(2000, 6000) });
}
// 지금 고칠 사보타주 장소 (봇마다 나눠 맡음)
function sabJob(g, c, st) {
  const S = g.sab;
  if (!S || S.type === 'mixup') return null;
  const fx = S.def.fix || {}, entries = Object.entries(fx).filter(([, p]) => !S.parts[p] || S.def.together);
  if (!entries.length) return null;
  const crew = [...g.st.values()].filter(x => x.ai && x.alive && x.team === 'crew').map(x => x.id).sort();
  const k = crew.indexOf(st.id);
  if (k < 0) return null;
  const parts = [...new Set(entries.map(([, p]) => p))];
  const need = S.type === 'critical' ? Math.max(parts.length * 2, 3) : parts.length;
  if (k >= need) return null;
  const p = parts[k % parts.length];
  // 같은 부품을 고칠 수 있는 곳 중 가장 가까운 곳
  const sid = entries.filter(([, q]) => q === p).map(([s]) => s).sort((a, b2) => d2(c, stationPos(g, a)) - d2(c, stationPos(g, b2)))[0];
  const sp = stationPos(g, sid);
  return sp ? { kind: 'fix', k: S.k, p, x: sp.x, y: sp.y + 30, dur: S.def.together ? 0 : rand(1500, 3500), hold: !!S.def.together } : null;
}
function holdFix(g, c, G) { if (G.hold && now() > (G.sent || 0)) { G.sent = now() + 1500; GM.onMsg(c, { t: 'fix', k: G.k, p: G.p, on: true }); } }

// 목적지에서 할 일
function arrive(g, c, st, b) {
  const G = b.goal;
  if (!G) return;
  if (G.kind === 'task') {
    const tk = st.tasks[G.i];
    if (tk && tk.step === G.step) GM.onMsg(c, { t: 'task', i: G.i, step: G.step });
    b.goal = null;
  } else if (G.kind === 'fix') {
    if (G.hold) { holdFix(g, c, G); return; }
    GM.onMsg(c, { t: 'fix', k: G.k, p: G.p, on: true });
    b.goal = null;
  } else if (G.kind === 'report') {
    const body = g.bodies.find(x => x.id === G.id && !x.gone);
    if (body) GM.onMsg(c, { t: 'report', id: body.id });
    b.goal = null;
  } else b.goal = null;
}

// ---------- 임포스터 ----------
function impDecide(g, c, st, b, t) {
  const G = b.goal;
  if (!st.alive) return;
  const killReady = (st.cds.kill || 0) <= 250;
  // 사냥 중: 목격자가 생기거나 너무 오래 걸리면 포기
  if (G?.kind === 'hunt') {
    const v = g.P(G.id), vs = g.st.get(G.id);
    if (!v || !vs?.alive || vs.vent || vs.trans || !killReady || t > G.until || (!g.hns && witnesses(g, c, v) > 0)) { b.goal = null; b.nextHunt = t + rand(3000, 7000); return; }
    if (d2(c, v) <= killDist(g)) {
      if (GM.onMsg(c, { t: 'kill', id: v.id }) !== false && !vs.alive) {
        b.goal = null; b.nextHunt = t + rand(6000, 12000);
        const far = farStation(g, c); // 처치 뒤 멀리 도망
        if (far) setGoal(g, c, b, { kind: 'wander', x: far.x, y: far.y, dur: rand(1500, 3000) });
      }
      return;
    }
    if (t > (G.repath || 0)) { G.repath = t + 600; setGoal(g, c, b, { ...G, x: v.x, y: v.y }); }
    return;
  }
  // 처치 기회 찾기
  if (killReady && (g.hns || t > b.nextHunt)) {
    const victims = [...g.st.values()].filter(x => x.alive && !x.left && x.team !== 'impostor' && !x.vent && !x.trans).map(x => g.P(x.id)).filter(v => v && visible(g, c, v));
    const v = victims.filter(v => g.hns || witnesses(g, c, v) === 0).sort((a, b2) => d2(c, a) - d2(c, b2))[0];
    if (v && (g.hns || Math.random() < 0.55)) { setGoal(g, c, b, { kind: 'hunt', id: v.id, x: v.x, y: v.y, dur: 0, until: t + 7000 }); return; }
    if (!g.hns) b.nextHunt = t + rand(1200, 2500);
  }
  // 가끔 사보타주
  if (!g.hns && !g.sab && g.sabCd <= 0 && Math.random() < 0.006) {
    const ks = Object.entries(g.map.sabotages || {}).filter(([, d]) => d.type !== 'critical' || Math.random() < 0.35).map(([k]) => k);
    if (ks.length) GM.onMsg(c, { t: 'sab', k: pickOne(ks) });
  }
  if (G && !G.arrived) return;
  if (b.wait > 0) return;
  // 임무하는 척 돌아다니기
  const p = randomStation(g);
  if (p) setGoal(g, c, b, { kind: 'fake', x: p.x + rand(-20, 20), y: p.y + rand(10, 40), dur: rand(2500, 6000) });
}
const killDist = g => (g.hns ? RULES.hnsKillDist : RULES.killDist[Math.max(0, Math.min(2, Math.round(+g.s.killDistance || 1)))]) * 0.9;
function witnesses(g, killer, v) {
  let n = 0;
  for (const st of g.st.values()) {
    if (!st.alive || st.left || st.id === killer.id || st.id === v.id || st.team === 'impostor' || st.vent) continue;
    const p = g.P(st.id);
    if (p && d2(p, v) < WITNESS && lineClear(g.map, p.x, p.y - 30, v.x, v.y - 30, new Set(g.doors.keys()))) n++;
  }
  return n;
}
function farStation(g, c) {
  let far = null, fd = 0;
  for (let i = 0; i < 8; i++) { const p = randomStation(g); const dd = p ? d2(p, c) : 0; if (dd > fd) { fd = dd; far = p; } }
  return far;
}

// ---------- 회의 ----------
const LINES = ['누구 봤어?', '나는 임무하고 있었어', '증거 없으면 스킵하자', '어디서 죽었어?', '나 아니야', '스킵!', '확실하지 않으면 건너뛰자', '난 계속 혼자 있었어'];
function meeting(g) {
  const M = g.meeting, t = now();
  if (!M) return;
  const alive = [...g.st.values()].filter(x => x.alive && !x.left);
  for (const st of g.st.values()) {
    if (!st.ai || !st.alive || st.left) continue;
    const c = g.P(st.id), b = brain(g, st.id);
    if (!c) continue;
    c.mv = 0; b.goal = null; b.path = null; b.wait = 0;
    if (st.team === 'impostor') for (const [id] of b.sus) b.sus.delete(id);
    // 한 번 말하기
    if (!b.said) {
      b.said = true;
      b.sayAt = t + rand(1500, 9000);
      b.line = speech(g, st, b, alive);
    }
    if (b.line && t >= b.sayAt && (M.stage === 'discuss' || M.stage === 'vote')) {
      g.bc({ t: 'chat', id: c.id, name: c.name, look: c.look, text: b.line, quick: true, ghost: false }, (p, ps) => true);
      b.line = null;
    }
    // 투표
    if (M.stage === 'vote' && !M.votes.has(st.id)) {
      if (!b.voteAt) b.voteAt = t + rand(1500, 7000);
      if (t >= b.voteAt) g.castVote(c, voteFor(g, st, b, alive, M));
    }
  }
}
function topSus(b, alive) {
  let best = null, v = 0;
  for (const [id, s] of b.sus) if (s > v && alive.some(x => x.id === id)) { v = s; best = id; }
  return best ? { id: best, v } : null;
}
function speech(g, st, b, alive) {
  const name = id => g.P(id)?.name || g.st.get(id)?.name || '';
  if (st.team === 'crew') {
    const s = topSus(b, alive);
    if (s?.v >= 100) return `${name(s.id)} 이(가) 죽이는 걸 봤어!`;
    if (s?.v >= 30) return `${name(s.id)} 수상해`;
    return Math.random() < 0.6 ? pickOne(LINES) : null;
  }
  if (Math.random() < 0.3) { const v = pickOne(alive.filter(x => x.team !== 'impostor')); if (v) return `${name(v.id)} 수상한데?`; }
  return Math.random() < 0.6 ? pickOne(LINES) : null;
}
function voteFor(g, st, b, alive, M) {
  const human = [...M.votes].find(([v]) => !g.st.get(v)?.bot)?.[1];
  if (st.team === 'impostor') {
    if (human && human !== 'skip' && g.st.get(human)?.team !== 'impostor' && Math.random() < 0.6) return human;
    const crew = alive.filter(x => x.team !== 'impostor');
    return Math.random() < 0.4 && crew.length ? pickOne(crew).id : 'skip';
  }
  const s = topSus(b, alive);
  if (s && s.v >= 60) return s.id;
  if (s && s.v >= 30 && Math.random() < 0.5) return s.id;
  if (human && human !== 'skip' && human !== st.id && Math.random() < 0.35) return human;
  if (Math.random() < 0.12) { const o = alive.filter(x => x.id !== st.id); if (o.length) return pickOne(o).id; }
  return 'skip';
}

// ---------- 대기실(로비)에서 어슬렁거리기 ----------
export function lobbyTick(r, dt) {
  for (const c of r.players.values()) {
    if (!c.ai) continue;
    const b = (c.lb ||= { wait: rand(500, 4000), path: null });
    if (b.wait > 0) { b.wait -= dt; c.mv = 0; continue; }
    if (!b.path?.length) {
      const sp = LOBBY.spawn, p = { x: sp.x + rand(-sp.rx, sp.rx) * 0.9, y: sp.y + rand(-sp.ry, sp.ry) * 0.9 };
      if (!walkable(LOBBY, p.x, p.y)) { b.wait = 300; continue; }
      b.path = findPath(LOBBY, c, p, null) || [];
      if (!b.path.length) { b.wait = 800; continue; }
    }
    let left = RULES.speed * 0.6 * (dt / 1000);
    while (left > 0 && b.path.length) {
      const p = b.path[0], dd = d2(c, p);
      if (dd <= left) { c.x = p.x; c.y = p.y; left -= dd; b.path.shift(); } else { step(c, p, left); left = 0; }
    }
    c.mv = b.path.length ? 1 : 0;
    if (!b.path.length) b.wait = rand(1500, 6000);
  }
}
