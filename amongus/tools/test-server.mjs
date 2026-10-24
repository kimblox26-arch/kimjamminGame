// 서버 통합 테스트 (의존성 없음: Node 22 내장 WebSocket 사용)
// 사용법: node tools/test-server.mjs            → 임시 서버를 직접 띄워서 테스트 (포트: TEST_PORT 또는 8101)
//         TEST_URL=ws://localhost:8080/ws node tools/test-server.mjs  → 이미 실행 중인 서버에 연결 (MIN_PLAYERS=2 필요)
//         node tools/test-server.mjs 이름1 이름2  → 이름에 해당 문자열이 들어간 테스트만 실행
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_LIST, getMap, canStand, walkable } from '../public/js/shared/maps/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.MOD_PASSWORD || 'amongus_2-gamestudio-;;';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
let URL_ = process.env.TEST_URL || '';

// ---------- 서버 띄우기 ----------
async function boot(port, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-test-'));
  const p = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), MIN_PLAYERS: '2', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.stderr.on('data', d => { out += d; if (process.env.VERBOSE) process.stderr.write(d); });
  for (let i = 0; i < 100; i++) {
    if (out.includes('서버 실행 중')) return `ws://127.0.0.1:${port}/ws`;
    if (p.exitCode !== null) throw new Error('서버가 시작되지 않음:\n' + out);
    await sleep(100);
  }
  throw new Error('서버 시작 시간 초과:\n' + out);
}
const cleanup = () => { for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM'); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ---------- 테스트 클라이언트 ----------
class Cli {
  constructor(name, url = URL_) { this.name = name; this.url = url; this.log = []; this.waiters = []; this.pos = new Map(); }
  connect() {
    return new Promise((res, rej) => {
      const ws = (this.ws = new WebSocket(this.url));
      ws.onopen = () => res(this);
      ws.onerror = () => rej(new Error(`${this.name}: 연결 실패`));
      ws.onclose = () => { this.closed = true; };
      ws.onmessage = ev => this.onmsg(JSON.parse(ev.data));
    });
  }
  onmsg(m) {
    if (m.t === 'pos') { for (const a of m.p) this.pos.set(a[0], a); this.posN = (this.posN || 0) + 1; return; }
    this.log.push(m);
    for (const w of this.waiters) if (!m._used && w.test(m)) { m._used = true; this.waiters.splice(this.waiters.indexOf(w), 1); clearTimeout(w.timer); w.res(m); break; }
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  // 아직 쓰지 않은 메시지 중 조건에 맞는 첫 메시지 (없으면 기다림)
  wait(t, pred = () => true, ms = 4000) {
    const test = m => m.t === t && pred(m);
    const old = this.log.find(m => !m._used && test(m));
    if (old) { old._used = true; return Promise.resolve(old); }
    return new Promise((res, rej) => {
      const w = { test, res, timer: setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error(`${this.name}: '${t}' 메시지를 ${ms}ms 안에 받지 못함`)); }, ms) };
      this.waiters.push(w);
    });
  }
  // ms 동안 조건에 맞는 새 메시지가 오지 않아야 함
  async none(t, pred = () => true, ms = 600, why = '') {
    const from = this.log.length;
    await sleep(ms);
    const bad = this.log.slice(from).find(m => m.t === t && pred(m));
    if (bad) throw new Error(`${this.name}: 오면 안 되는 '${t}' 메시지 ${why} ${JSON.stringify(bad).slice(0, 200)}`);
  }
  clear() { for (const m of this.log) m._used = true; }
  close() { try { this.ws.close(); } catch { /* 이미 닫힘 */ } }
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: 기대값 ${JSON.stringify(b)}, 실제값 ${JSON.stringify(a)}`); };

async function client(name, extra = {}) {
  const c = await new Cli(name).connect();
  c.send({ t: 'hello', birth: '1990-01-01', look: { color: 0 }, lvl: 1, ...extra });
  const w = await c.wait('welcome');
  c.id = w.id;
  return c;
}
async function modAuth(c) {
  c.send({ t: 'mod', a: 'auth', pw: PW });
  const r = await c.wait('mod', m => m.a === 'auth');
  ok(r.ok && /^[0-9a-f]{64}$/.test(r.key), 'mod 인증 실패');
  c.key = r.key;
  return r.key;
}
async function mod(c, a, extra = {}) {
  c.send({ t: 'mod', a, ...extra });
  const r = await c.wait('mod', m => m.a === a);
  ok(r.ok, `mod ${a} 실패: ${r.msg || ''}`);
  return r;
}
// 걸을 수 있는 가까운 지점 찾기
function spot(map, x, y, minD = 0, maxD = 700) {
  for (let r = minD; r <= maxD; r += 15) {
    const n = r ? Math.max(8, Math.round(r / 12)) : 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (px > 0 && py > 0 && px < map.w && py < map.h && canStand(map, px, py)) return { x: Math.round(px), y: Math.round(py) };
    }
  }
  throw new Error(`(${x},${y}) 근처에 설 곳이 없음 (${map.id})`);
}
const near = (map, p, d = 60) => spot(map, p.x, p.y, d);

// n명이 한 방에: 0번이 방장. opt: settings, mod(모두 mod 인증 + 벽뚫), forced{번호: 역할}
async function squad(n, opt = {}) {
  const cls = [];
  for (let i = 0; i < n; i++) cls.push(await client(`${opt.tag || 'P'}${i}`));
  if (opt.mod !== false) for (const c of cls) await modAuth(c);
  const [A] = cls;
  A.send({ t: 'create', mode: 'online', region: 'as', settings: opt.settings || {} });
  const j = await A.wait('joined');
  const code = j.room.code;
  for (const c of cls.slice(1)) { c.send({ t: 'join', code }); await c.wait('joined'); }
  for (const [i, role] of Object.entries(opt.forced || {})) await mod(A, 'role', { id: cls[i].id, role });
  return { cls, code, A };
}
// 게임 시작 → 소개 화면 끝까지 기다림 (스폰 고르기 맵이면 0번 위치 선택)
async function begin(S, { noclip = true } = {}) {
  const { cls, A } = S;
  for (const c of cls) c.clear();
  A.send({ t: 'start' });
  const st = await Promise.all(cls.map(c => c.wait('start', () => true, 9000)));
  S.start = st; S.map = getMap(st[0].map);
  for (const [i, c] of cls.entries()) { c.role = st[i].role; c.st = st[i]; }
  if (S.map.spawnPoints?.length) {
    await Promise.all(cls.map(async (c, i) => { await c.wait('spawnPick', () => true, 12000); c.send({ t: 'spawn', i: i % S.map.spawnPoints.length }); }));
    await A.wait('spawnDone', () => true, 6000);
  } else await sleep(st[0].intro + 250);
  if (noclip) for (const c of cls) if (c.key) await mod(c, 'noclip', { on: true });
  return st;
}
const role = (S, r) => S.cls.find(c => c.role === r);
// 위치 옮기기 (벽뚫 상태면 어디든)
async function tp(c, p) { c.send({ t: 'move', x: p.x, y: p.y, d: 1, m: 0 }); c.at = p; await sleep(90); }
const posOf = (obs, id) => { const a = obs.pos.get(id); return a ? { x: a[1], y: a[2], f: a[5] } : null; };
const end = S => { for (const c of S.cls) c.close(); };
// 회의: 투표 시작까지 기다렸다가 votes{번호: 대상 id | 'skip'}
async function vote(S, votes) {
  await S.A.wait('voting', () => true, 9000);
  for (const [i, v] of Object.entries(votes)) S.cls[i].send({ t: 'vote', id: v });
  return S.A.wait('result', () => true, 20000);
}

// ---------- 테스트 ----------
const T = {};

// 모든 맵에서 로비 → 시작 (임무 장소·시작 위치 검사, 스폰 고르기)
T['맵별 로비/시작'] = async () => {
  await Promise.all(MAP_LIST.map(async map => {
    const S = await squad(2, { settings: { map: map.id }, mod: false, tag: map.id });
    try {
      const st = await begin(S, { noclip: false });
      eq(st[0].map, map.id, '시작 맵');
      for (const s of st) {
        for (const t of s.tasks) for (const sid of t.st) ok(map.stations[sid], `${map.id}: 임무 ${t.id} 장소 ${sid} 없음`);
        for (const p of s.players) ok(walkable(map, p.x, p.y) || map.spawnPoints?.length, `${map.id}: 시작 위치 (${p.x},${p.y}) 가 걸을 수 없는 곳`);
      }
      eq(new Set(st.map(s => s.role)).size >= 1, true, '역할');
      ok(st.filter(s => s.team === 'impostor').length === 1, `${map.id}: 임포스터 1명이어야 함`);
    } finally { end(S); }
  }));
};

// 역할 배정 (확률 100%) + 유령 역할(수호천사) + 보호막
T['역할 배정 100% / 수호천사'] = async () => {
  const S = await squad(4, { settings: { killCooldown: 20, roleSet: { engineer: { max: 3, chance: 100 }, shapeshifter: { max: 1, chance: 100 }, guardian: { max: 1, chance: 100 } } } });
  try {
    const st = await begin(S);
    eq(st.filter(s => s.role === 'engineer').length, 3, '기술자 수');
    eq(st.filter(s => s.role === 'shapeshifter').length, 1, '형상 변환자 수');
    ok(st.find(s => s.role === 'shapeshifter').mates.length === 1, '임포스터 동료 목록');
    const imp = role(S, 'shapeshifter'), [v, w] = S.cls.filter(c => c !== imp);
    await mod(imp, 'nocd', { on: true });
    const p0 = spot(S.map, S.map.button.x, S.map.button.y, 200);
    await tp(v, p0); await tp(imp, near(S.map, p0, 50));
    imp.send({ t: 'kill', id: v.id });
    await w.wait('kill', m => m.id === v.id);
    const rs = await v.wait('roleSet', m => m.role === 'guardian');
    ok(!rs.alive, '수호천사는 유령');
    // 수호천사 보호 → 처치 막힘 + 쿨다운 절반
    const p1 = spot(S.map, p0.x + 300, p0.y, 0);
    await tp(w, p1); await tp(v, near(S.map, p1, 50));
    v.send({ t: 'ability', a: 'protect', id: w.id }); // 수호천사가 된 직후 10초 쿨다운
    await v.none('shield', () => true, 300, '(수호천사가 된 직후 쿨다운)');
    await mod(v, 'nocd', { on: true });
    v.send({ t: 'ability', a: 'protect', id: w.id });
    const sh = await v.wait('shield', m => m.id === w.id && m.on);
    ok(sh.ms > 9000, '보호 지속 시간 10초');
    await v.wait('abilityCd', m => m.a === 'protect' && m.ms > 59000);
    await w.none('shield', () => true, 300, '(보호받는 크루원에게는 보이지 않음)');
    await tp(imp, near(S.map, p1, 60));
    imp.send({ t: 'kill', id: w.id });
    await imp.wait('shieldHit', m => m.id === w.id);
    const cd = await imp.wait('abilityCd', m => m.a === 'kill' && m.shield);
    eq(cd.ms, 10000, '보호막에 막히면 처치 쿨다운 절반');
    await w.none('kill', m => m.id === w.id, 300);
    imp.send({ t: 'kill', id: w.id }); // 보호막이 깨졌으니 이번엔 처치됨 (mod 쿨타임 없음)
    await w.wait('kill', m => m.id === w.id);
    const over = await imp.wait('over', () => true, 4000);
    eq(over.winner, 'impostor', '임포스터 수 ≥ 크루원 수 → 임포스터 승리');
  } finally { end(S); }
};

// 처치 / 신고 / 회의 / 동점 / 추방 / 채팅 규칙
T['처치·신고·회의·투표·추방'] = async () => {
  const S = await squad(4, { settings: { discussionTime: 0, votingTime: 30, emergencyCooldown: 0 }, forced: { 0: 'impostor', 1: 'crewmate', 2: 'crewmate', 3: 'crewmate' } });
  const [A, B, C, D] = S.cls;
  try {
    await begin(S);
    eq(A.role, 'impostor', 'mod 고정 역할'); eq(B.role, 'crewmate', '고정 역할');
    const p0 = spot(S.map, S.map.button.x, S.map.button.y, 220);
    await tp(B, p0); await tp(A, near(S.map, p0, 50));
    A.send({ t: 'kill', id: B.id }); // 시작 처치 쿨다운 10초 → 실패해야 함
    await B.none('kill', () => true, 500, '(처치 쿨다운 무시됨)');
    // 살아있는 사람은 회의 밖에서 채팅 불가
    C.send({ t: 'chat', q: { c: 0, i: 0 } });
    await D.none('chat', m => m.id === C.id, 400);
    // 긴급회의 → 동점 → 아무도 방출되지 않음
    await tp(D, spot(S.map, S.map.button.x, S.map.button.y, 150));
    D.send({ t: 'emergency' });
    const mt = await A.wait('meeting');
    ok(mt.emergency && mt.caller === D.id, '긴급회의 정보');
    C.send({ t: 'chat', q: { c: 0, i: 0 } }); // 회의 중 빠른 채팅
    await B.wait('chat', m => m.id === C.id && m.text === '안녕!');
    C.send({ t: 'chat', text: '자유 채팅' }); // 게스트(핑크)는 자유 채팅 불가
    await C.wait('err', m => /빠른 채팅/.test(m.msg));
    const r1 = await vote(S, { 0: C.id, 1: C.id, 2: B.id, 3: B.id });
    ok(r1.tie && !r1.ejected, '동점이어야 함');
    const e1 = await B.wait('eject', () => true, 8000);
    ok(/동점/.test(e1.text) && !e1.id, '동점 문구');
    await A.wait('resume', () => true, 9000);
    // 처치 → 신고 → 임포스터 추방 → 크루원 승리
    await mod(A, 'nocd', { on: true });
    const p1 = spot(S.map, S.map.button.x + 400, S.map.button.y, 0);
    await tp(B, p1); await tp(A, near(S.map, p1, 50));
    A.send({ t: 'kill', id: B.id });
    const k = await C.wait('kill', m => m.id === B.id);
    eq(k.by, A.id, '처치자');
    await tp(C, near(S.map, p1, 120));
    C.send({ t: 'report', id: B.id });
    const m2 = await D.wait('meeting', m => m.body);
    ok(m2.body === B.id && m2.dead.includes(B.id), '시체 신고 회의');
    // 유령 채팅은 유령끼리만
    B.send({ t: 'chat', q: { c: 0, i: 1 } });
    await B.wait('chat', m => m.id === B.id && m.ghost);
    await C.none('chat', m => m.id === B.id, 400, '(유령 채팅이 산 사람에게 보임)');
    const r2 = await vote(S, { 0: 'skip', 2: A.id, 3: A.id });
    eq(r2.ejected, A.id, '방출 대상');
    const e2 = await C.wait('eject', m => m.id === A.id, 8000);
    ok(e2.imp === true && /임포스터였습니다/.test(e2.text) && e2.impLeft === 0 && /0명 남았습니다/.test(e2.sub), '방출 확인 문구: ' + e2.text + ' / ' + e2.sub);
    const over = await D.wait('over', () => true, 9000);
    eq(over.winner, 'crew', '임포스터 방출 → 크루원 승리');
  } finally { end(S); }
};

// 판사 기각: 틀리면 판사가 방출, 다른 판사가 먼저면 돌려받음, 맞으면 임포스터 방출
T['판사 기각'] = async () => {
  const S = await squad(4, { settings: { discussionTime: 0, votingTime: 30, emergencyCooldown: 0, roleSet: { judge: { max: 0, chance: 0, taskPercent: 0 } } },
    forced: { 0: 'judge', 1: 'impostor', 2: 'judge', 3: 'crewmate' } });
  const [A, B, C, D] = S.cls;
  try {
    await begin(S);
    eq(A.role, 'judge', '판사');
    await A.wait('abilityCd', m => m.a === 'overrule' && !m.locked);
    await tp(A, spot(S.map, S.map.button.x, S.map.button.y, 150));
    A.send({ t: 'emergency' });
    await D.wait('meeting');
    await D.wait('voting', () => true, 9000);
    A.send({ t: 'ability', a: 'overrule', id: C.id }); // 크루원 지목 → 판사가 방출
    await A.wait('overrule', m => m.ok);
    C.send({ t: 'ability', a: 'overrule', id: B.id }); // 늦은 판사
    await C.wait('overrule', m => m.beaten);
    await D.wait('voted', m => m.id === A.id); // 다른 사람에게는 평범한 투표로 보임
    B.send({ t: 'vote', id: 'skip' }); D.send({ t: 'vote', id: 'skip' });
    const r = await D.wait('result', () => true, 6000);
    ok(r.judge && r.judge.judge === A.id && r.judge.correct === false && r.ejected === A.id, '틀린 판결 → 판사 방출');
    const e = await D.wait('eject', () => true, 8000);
    ok(e.verdict && e.id === A.id && /판결이 내려졌습니다/.test(e.text), '판결 방출 문구');
    await D.wait('resume', () => true, 9000);
    await tp(C, spot(S.map, S.map.button.x, S.map.button.y, 150));
    C.send({ t: 'emergency' });
    await D.wait('meeting');
    await D.wait('voting', () => true, 9000);
    C.send({ t: 'ability', a: 'overrule', id: B.id });
    await C.wait('overrule', m => m.ok);
    B.send({ t: 'vote', id: C.id }); D.send({ t: 'vote', id: C.id });
    const r2 = await D.wait('result', () => true, 6000);
    ok(r2.judge?.correct && r2.ejected === B.id, '맞는 판결 → 임포스터 방출 (다른 투표 무시)');
    const over = await D.wait('over', () => true, 16000);
    eq(over.winner, 'crew', '판결 후 크루원 승리');
  } finally { end(S); }
};

// 문 닫기 (방별 쿨다운, 자동 열림, 닫힌 문 통과 불가) — 스켈드
T['문 (스켈드 자동 문)'] = async () => {
  const S = await squad(3, { settings: { map: 'skeld' }, forced: { 0: 'impostor', 1: 'crewmate', 2: 'crewmate' } });
  const [A, B, C] = S.cls;
  try {
    await begin(S);
    const map = S.map, room = map.doorRooms[0], ds = map.doors.filter(d => d.room === room);
    // B 는 문 바로 안쪽에 (벽뚫 끄고)
    const d0 = ds[0], horiz = d0.w > d0.h, cx = d0.x + d0.w / 2, cy = d0.y + d0.h / 2;
    const sideA = horiz ? spot(map, cx, cy - d0.h / 2 - 50, 0, 40) : spot(map, cx - d0.w / 2 - 50, cy, 0, 40);
    const sideB = horiz ? spot(map, cx, cy + d0.h / 2 + 50, 0, 40) : spot(map, cx + d0.w / 2 + 50, cy, 0, 40);
    await tp(B, sideA);
    await mod(B, 'noclip', { on: false });
    A.send({ t: 'door', room });
    const dm = await C.wait('doors', m => m.closed.length);
    ok(ds.every(d => dm.closed.includes(d.id)), '그 방의 문이 모두 닫혀야 함');
    ok(dm.cd[room] > 29000, '방별 쿨다운 30초');
    A.send({ t: 'door', room });
    await C.none('doors', () => true, 400, '(쿨다운 중 다시 닫힘)');
    B.send({ t: 'openDoor', id: d0.id });
    await C.none('doors', () => true, 300, '(자동 문은 수동으로 못 엶)');
    await sleep(1100);
    B.send({ t: 'move', x: sideB.x, y: sideB.y, d: 1, m: 1 }); // 닫힌 문 너머로 이동 시도
    await sleep(300);
    const pb = posOf(C, B.id);
    ok(Math.hypot(pb.x - sideA.x, pb.y - sideA.y) < 5, `닫힌 문을 통과하면 안 됨 (${pb.x},${pb.y})`);
    const open = await C.wait('doors', m => !m.closed.length, (map.doorTime + 2) * 1000);
    ok(open, '자동으로 열림');
    B.send({ t: 'move', x: sideB.x, y: sideB.y, d: 1, m: 1 });
    await sleep(300);
    const pb2 = posOf(C, B.id);
    ok(Math.hypot(pb2.x - sideB.x, pb2.y - sideB.y) < 5, '열린 문은 통과 가능');
  } finally { end(S); }
};

// 수동 문(패널로 열기) — 수동 문이 있는 맵이 있으면
T['문 (수동 문 맵)'] = async () => {
  const map = MAP_LIST.find(m => m.doorMode === 'manual' && m.doors.length);
  if (!map) return 'skip: 수동 문 맵이 아직 없음';
  const S = await squad(2, { settings: { map: map.id }, forced: { 0: 'impostor', 1: 'crewmate' } });
  const [A, B] = S.cls;
  try {
    await begin(S);
    const room = map.doorRooms[0], d0 = map.doors.find(d => d.room === room);
    A.send({ t: 'door', room });
    const dm = await B.wait('doors', m => m.closed.includes(d0.id));
    ok(dm.mode === 'manual', '수동 문 모드');
    await tp(B, spot(map, d0.x + d0.w / 2, d0.y + d0.h / 2, 30));
    B.send({ t: 'openDoor', id: d0.id });
    const o = await B.wait('doors', m => !m.closed.includes(d0.id), 2000);
    ok(o, '패널 완료 → 그 문만 열림');
  } finally { end(S); }
};

// 스켈드 사보타주 전부 + 수리, 긴급회의 차단, 쿨다운
T['스켈드 사보타주'] = async () => {
  const S = await squad(3, { settings: { map: 'skeld', emergencyCooldown: 0 }, forced: { 0: 'impostor', 1: 'crewmate', 2: 'crewmate' } });
  const [A, B, C] = S.cls;
  try {
    await begin(S);
    A.send({ t: 'sab', k: 'lights' });
    await A.wait('err', m => /쿨다운/.test(m.msg)); // 시작 쿨다운
    await mod(A, 'nocd', { on: true });
    for (const [k, def] of Object.entries(S.map.sabotages)) {
      A.send({ t: 'sab', k });
      const s = await B.wait('sab', m => m.sab?.k === k);
      eq(s.sab.type, def.type, `${k} 종류`);
      if (def.type === 'critical') ok(s.sab.left > (def.time - 1) * 1000, `${k} 제한 시간`);
      if (k === 'reactor') { // 위기 상황에서는 긴급회의 불가
        await tp(C, spot(S.map, S.map.button.x, S.map.button.y, 150));
        await mod(C, 'noclip', { on: false });
        C.send({ t: 'emergency' });
        await C.wait('err', m => /위기 상황/.test(m.msg));
        await mod(C, 'noclip', { on: true });
      }
      const fx = Object.entries(def.fix);
      if (def.together) {
        const [[s1, p1], [s2, p2]] = fx;
        await tp(B, near(S.map, S.map.stations[s1], 20)); await tp(C, near(S.map, S.map.stations[s2], 20));
        B.send({ t: 'fix', k, p: p1, on: true });
        await B.wait('sab', m => m.sab?.k === k);
        B.send({ t: 'fix', k, p: p1, on: false }); // 손을 떼면 안 됨
        await sleep(150);
        C.send({ t: 'fix', k, p: p2, on: true });
        await B.none('sab', m => m.sab === null, 400, '(혼자 눌러도 고쳐짐)');
        B.send({ t: 'fix', k, p: p1, on: true });
      } else for (const [sid, p] of fx) { await tp(B, near(S.map, S.map.stations[sid], 20)); B.send({ t: 'fix', k, p, on: true }); }
      const f = await C.wait('sab', m => m.sab === null && m.fixed === k);
      ok(f, `${k} 수리`);
    }
    await mod(A, 'nocd', { on: false });
    A.send({ t: 'sab', k: 'lights' });
    await A.wait('err', m => /쿨다운/.test(m.msg)); // 고친 뒤 30초 공통 쿨다운
  } finally { end(S); }
};

// 치명적 사보타주 시간 초과 → 임포스터 승리
T['치명적 사보타주 시간 초과'] = async () => {
  const S = await squad(2, { settings: { map: 'skeld' }, forced: { 0: 'impostor', 1: 'crewmate' } });
  const [A, B] = S.cls;
  try {
    await begin(S);
    await mod(A, 'nocd', { on: true });
    const k = Object.keys(S.map.sabotages).find(x => S.map.sabotages[x].type === 'critical');
    A.send({ t: 'sab', k });
    await B.wait('sab', m => m.sab?.k === k);
    const over = await B.wait('over', () => true, (S.map.sabotages[k].time + 3) * 1000);
    ok(over.winner === 'impostor' && /막지 못했습니다/.test(over.reason), '시간 초과 승리: ' + over.reason);
  } finally { end(S); }
};

// 기술자 / 과학자 / 추적자 / 형상 변환자 / 노이즈 메이커
T['능력: 기술자·과학자·추적자·형상 변환자·노이즈 메이커'] = async () => {
  const S = await squad(5, { settings: { map: 'skeld', roleSet: {
    engineer: { ventMaxTime: 5, ventCooldown: 5 }, scientist: { batteryDuration: 5, vitalsCooldown: 5 }, tracker: { trackCooldown: 10, trackDuration: 10, trackDelay: 0 },
    shapeshifter: { shiftDuration: 10, shiftCooldown: 5 }, noisemaker: { alertDuration: 5 } } },
  forced: { 0: 'shapeshifter', 1: 'engineer', 2: 'scientist', 3: 'tracker', 4: 'noisemaker' } });
  const [A, B, C, D, E] = S.cls;
  try {
    await begin(S);
    const map = S.map;
    // 기술자: 환풍구 들어가기 → 이동 → 나오기 → 쿨다운
    const v = Object.values(map.vents).find(x => x.links.length);
    await tp(B, near(map, v, 40));
    B.send({ t: 'ability', a: 'vent' });
    const vin = await C.wait('vent', m => m.id === B.id && m.a === 'in');
    ok(vin.ms > 4000 && vin.ms <= 5000, '환풍구 최대 시간');
    await sleep(150);
    ok(posOf(C, B.id).f & 1, 'pos 플래그 1 (환풍구 안)');
    B.send({ t: 'vent', a: 'move', v: map.vents[vin.v].links[0] });
    await C.wait('vent', m => m.id === B.id && m.a === 'move');
    B.send({ t: 'ability', a: 'vent' });
    await C.wait('vent', m => m.id === B.id && m.a === 'out');
    await B.wait('abilityCd', m => m.a === 'vent' && m.ms >= 4900);
    B.send({ t: 'ability', a: 'vent' });
    await C.none('vent', m => m.id === B.id && m.a === 'in', 400, '(쿨다운 중 환풍구)');
    await sleep(5000);
    B.send({ t: 'ability', a: 'vent' });
    await C.wait('vent', m => m.id === B.id && m.a === 'in');
    // 통신 방해 → 기술자 강제 퇴출, 과학자 바이탈 불가
    await mod(A, 'nocd', { on: true });
    A.send({ t: 'sab', k: 'comms' });
    await C.wait('vent', m => m.id === B.id && m.a === 'out' && m.forced);
    C.send({ t: 'ability', a: 'vitals', on: true, src: 'ability' });
    await C.wait('vitalsData', m => m.comms);
    C.send({ t: 'fix', k: 'comms', p: 'c', on: true });
    await C.wait('sab', m => m.sab === null);
    // 과학자: 배터리 → 다 쓰면 닫힘 → 임무 완료로 충전
    C.send({ t: 'ability', a: 'vitals', on: true, src: 'ability' });
    const vd = await C.wait('vitalsData', m => Array.isArray(m.list));
    eq(vd.list.length, 5, '바이탈 목록');
    await C.wait('vitalsData', m => m.closed && m.why === 'battery', 7000);
    C.send({ t: 'ability', a: 'vitals', on: true, src: 'ability' });
    await C.wait('abilityCd', m => m.a === 'vitals' && m.empty);
    const t0 = C.st.tasks[0];
    for (let s = 0; s < t0.st.length; s++) { C.send({ t: 'task', i: 0, step: s }); await C.wait('tasks'); }
    await C.wait('abilityCd', m => m.a === 'vitals' && m.charged);
    // 추적자
    const p0 = spot(map, map.button.x - 500, map.button.y, 0);
    await tp(E, p0); await tp(D, near(map, p0, 60));
    D.send({ t: 'ability', a: 'track', id: E.id });
    const tr = await D.wait('track', m => m.id === E.id);
    ok(tr.ms > 9000 && Math.hypot(tr.x - p0.x, tr.y - p0.y) < 5, '추적 위치');
    D.send({ t: 'ability', a: 'track', id: null, off: true });
    await D.wait('track', m => m.id === null);
    await D.wait('abilityCd', m => m.a === 'track' && m.ms >= 9900);
    // 형상 변환자
    A.send({ t: 'ability', a: 'shift', id: C.id });
    const sh = await B.wait('shift', m => m.id === A.id && m.as === C.id);
    ok(sh.evidence, '증거 남기기 (기본 켬)');
    await sleep(150);
    ok(posOf(B, A.id).f & 4, 'pos 플래그 4 (변신 중)');
    await tp(A, near(map, p0, 50));
    A.send({ t: 'kill', id: E.id }); // 변신한 채로 처치 → 노이즈 메이커 경보
    const k = await B.wait('kill', m => m.id === E.id);
    eq(k.as, C.id, '변신한 모습으로 처치');
    const nz = await B.wait('noise', m => m.id === E.id);
    ok(nz.ms === 5000 && Math.hypot(nz.x - k.x, nz.y - k.y) < 2, '경보 위치/시간');
    await A.wait('noise', m => m.id === E.id); // 임포스터 알림 받기 (기본 켬)
    A.send({ t: 'ability', a: 'shift', id: null });
    await B.wait('shift', m => m.id === A.id && m.as === null);
    await A.wait('abilityCd', m => m.a === 'shift' && m.ms >= 4900);
  } finally { end(S); }
};

// 팬텀 / 탐정 / 인플루언서
T['능력: 팬텀·탐정·인플루언서'] = async () => {
  const S = await squad(5, { settings: { map: 'skeld', discussionTime: 0, votingTime: 30 }, forced: { 0: 'phantom', 1: 'detective', 2: 'crewmate', 3: 'crewmate', 4: 'influencer' } });
  const [A, B, C, D, E] = S.cls;
  try {
    await begin(S);
    const map = S.map;
    eq(E.role, 'crewmate', '유령 역할은 크루원으로 시작');
    await mod(A, 'nocd', { on: true });
    const pc = spot(map, map.button.x + 600, map.button.y, 0);
    await tp(C, pc); await tp(A, near(map, pc, 50));
    A.send({ t: 'ability', a: 'vanish', on: true });
    await C.wait('vanish', m => m.id === A.id && m.on);
    await sleep(150);
    ok(posOf(C, A.id).f & 2, 'pos 플래그 2 (투명)');
    A.send({ t: 'kill', id: C.id });
    await C.none('kill', () => true, 400, '(사라진 상태로 처치)');
    A.send({ t: 'ability', a: 'vanish', on: false });
    await C.wait('vanish', m => m.id === A.id && !m.on);
    await A.wait('abilityCd', m => m.a === 'vanish' && m.ms >= 14000);
    // 탐정: D 를 다른 방에 두고 C 처치
    const roomD = map.rooms.find(r => r.id !== map.roomAt(pc.x, pc.y)?.id && r.id !== map.roomAt(map.button.x, map.button.y)?.id);
    const pd = spot(map, roomD.label.x, roomD.label.y, 0);
    ok(map.roomAt(pd.x, pd.y)?.id === roomD.id, '탐정 테스트 위치');
    await tp(D, pd);
    A.send({ t: 'kill', id: C.id });
    await B.wait('kill', m => m.id === C.id);
    await tp(D, near(map, pc, 150));
    D.send({ t: 'report', id: C.id });
    await B.wait('meeting');
    const cs = await B.wait('cases', m => m.list.some(c => c.id === C.id));
    eq(cs.active, C.id, '활성 사건');
    await vote(S, { 0: 'skip', 1: 'skip', 3: 'skip', 4: 'skip' });
    await B.wait('resume', () => true, 16000);
    await tp(D, spot(map, map.button.x, map.button.y, 250)); await tp(B, near(map, D.at, 50));
    B.send({ t: 'ability', a: 'interrogate', id: D.id });
    const no = await B.wait('interrogate', m => m.ok === false);
    ok(/쿨다운/.test(no.msg), '회의 뒤 심문 쿨다운 10초: ' + no.msg);
    await sleep(10200);
    B.send({ t: 'ability', a: 'interrogate', id: D.id, case: C.id });
    const it = await B.wait('interrogate', m => m.ok);
    eq(it.room, roomD.name, '사망 당시 실제 위치');
    // 인플루언서: 죽으면 배정 → 산 사람에게 그림 메시지
    await tp(E, spot(map, map.button.x - 500, map.button.y, 0)); await tp(A, near(map, E.at, 50));
    A.send({ t: 'kill', id: E.id });
    await E.wait('roleSet', m => m.role === 'influencer');
    await tp(E, near(map, D.at, 60));
    E.send({ t: 'ability', a: 'message', id: D.id, imgs: ['c_red', 'up', 'knife', 'vent'] }); // 유령이 된 직후 10초 쿨다운
    await D.none('message', () => true, 300, '(유령이 된 직후 쿨다운)');
    await mod(E, 'nocd', { on: true });
    E.send({ t: 'ability', a: 'message', id: D.id, imgs: ['c_red', 'up', 'knife', 'vent'] });
    const msg = await D.wait('message');
    eq(msg.imgs.join(), 'c_red,up,knife', '그림은 최대 3개');
    await E.wait('abilityCd', m => m.a === 'message' && m.ms >= 19000);
  } finally { end(S); }
};

// 바이퍼: 산 → 3단계 용해 → 사라짐 (신고 불가)
T['능력: 바이퍼'] = async () => {
  const S = await squad(5, { settings: { map: 'skeld', roleSet: { viper: { dissolveTime: 5 } } }, forced: { 0: 'viper', 1: 'crewmate', 2: 'crewmate', 3: 'crewmate', 4: 'crewmate' } });
  const [A, B, C, D] = S.cls;
  try {
    await begin(S);
    const map = S.map;
    await mod(A, 'nocd', { on: true });
    const p = spot(map, map.button.x + 500, map.button.y, 0);
    await tp(B, p); await tp(A, near(map, p, 50));
    A.send({ t: 'kill', id: B.id });
    const k = await C.wait('kill', m => m.id === B.id);
    eq(k.acid, 5000, '용해 시간');
    await C.wait('bodyStage', m => m.id === B.id && m.stage === 2, 3000);
    await C.wait('bodyStage', m => m.id === B.id && m.stage === 3, 3000);
    await C.wait('bodyGone', m => m.id === B.id, 3000);
    await tp(C, near(map, p, 100));
    C.send({ t: 'report', id: B.id });
    await D.none('meeting', () => true, 500, '(다 녹은 시체 신고)');
    // 녹는 중에는 신고 가능
    const p2 = spot(map, map.button.x - 500, map.button.y, 0);
    await tp(C, p2); await tp(A, near(map, p2, 50));
    A.send({ t: 'kill', id: C.id });
    await D.wait('kill', m => m.id === C.id);
    await tp(D, near(map, p2, 120));
    D.send({ t: 'report', id: C.id });
    const mt = await D.wait('meeting');
    eq(mt.body, C.id, '녹는 중인 시체 신고');
  } finally { end(S); }
};

// 임무: 진행 막대 + 시각 임무 + 임무 승리
T['임무 진행·시각 임무·임무 승리'] = async () => {
  const S = await squad(3, { settings: { map: 'skeld', commonTasks: 0, longTasks: 0, shortTasks: 1 }, forced: { 0: 'impostor', 1: 'crewmate', 2: 'crewmate' } });
  const [A, B, C] = S.cls;
  try {
    await begin(S);
    eq(B.st.bar.total, 2, '임무 수 (크루원만)');
    B.send({ t: 'visual', k: 'scan', on: true });
    await A.wait('visual', m => m.id === B.id && m.on);
    A.send({ t: 'task', i: 0, step: 0 }); // 임포스터는 가짜 임무
    await A.none('tasks', () => true, 300);
    const tk = B.st.tasks[0];
    for (let s = 0; s < tk.st.length; s++) { B.send({ t: 'task', i: 0, step: s }); await B.wait('tasks'); }
    const bar = await A.wait('bar', m => m.bar.done === 1);
    ok(bar, '진행 막대');
    await A.none('over', () => true, 200, '(임무가 남았는데 끝남)');
    const tc = C.st.tasks[0];
    for (let s = 0; s < tc.st.length; s++) { C.send({ t: 'task', i: 0, step: s }); await C.wait('tasks'); }
    const over = await A.wait('over', () => true, 3000);
    ok(over.winner === 'crew' && over.code === 'tasks', '임무 승리');
  } finally { end(S); }
};

// 이동 장치 (사다리/짚라인/승강장/소독실) — 있는 맵에서
T['이동 장치'] = async () => {
  const map = MAP_LIST.find(m => m.transports?.length);
  if (!map) return 'skip: 이동 장치가 있는 맵이 아직 없음';
  const S = await squad(2, { settings: { map: map.id }, forced: { 0: 'impostor', 1: 'crewmate' } });
  const [A, B] = S.cls;
  try {
    await begin(S);
    const T0 = map.transports[0];
    await tp(B, spot(map, T0.a.x, T0.a.y, 0, 200));
    B.send({ t: 'transport', id: T0.id });
    let m = await A.wait('transport', x => x.id === T0.id);
    if (m.call) { await sleep(m.ms + 200); B.send({ t: 'transport', id: T0.id }); m = await A.wait('transport', x => x.id === T0.id && x.pid === B.id); }
    ok(m.pid === B.id && Math.hypot(m.to.x - T0.b.x, m.to.y - T0.b.y) < 2, '도착 위치');
    await sleep(100);
    ok(posOf(A, B.id).f & 8, 'pos 플래그 8 (이동 중)');
    await A.wait('transportDone', x => x.pid === B.id, m.ms + 1500);
  } finally { end(S); }
};

// 숨바꼭질 전체 한 판
T['숨바꼭질 (크루원 생존 승리)'] = async () => {
  const A0 = await client('HS0'); await modAuth(A0);
  const S = await (async () => {
    A0.send({ t: 'create', mode: 'online', region: 'as', settings: { gameType: 'hns', map: 'skeld', hideTime: 22, finalTime: 8, pingInterval: 2, seeker: A0.id, hnsCommon: 0, hnsLong: 0, hnsShort: 1, ventUses: 1, ventTime: 2 } });
    const j = await A0.wait('joined');
    ok(j.room.settings.hideTime === 22, '숨는 시간 (mod 무제한 설정)');
    const B0 = await client('HS1'), C0 = await client('HS2');
    await modAuth(B0); await modAuth(C0);
    for (const c of [B0, C0]) { c.send({ t: 'join', code: j.room.code }); await c.wait('joined'); }
    return { cls: [A0, B0, C0], A: A0 };
  })();
  const [A, B, C] = S.cls;
  try {
    await begin(S, { noclip: false });
    eq(A.role, 'impostor', '술래 지정');
    ok(B.st.hns && B.st.hns.seeker === A.id && B.st.mates.includes(A.id), '술래 공개');
    ok(B.st.hns.crewLight === 0.35 && B.st.hns.flashlight, '손전등 크기');
    const h = await B.wait('hns', m => m.phase === 'hide');
    ok(h.lead > 8000, '먼저 숨는 시간 10초');
    const a0 = posOf(B, A.id);
    A.send({ t: 'move', x: a0.x + 20, y: a0.y, d: 1, m: 1 });
    await sleep(300);
    eq(posOf(B, A.id).x, a0.x, '숨는 시간에는 술래가 못 움직임');
    // 크루원 환풍구: 1번만, 최대 2초
    await mod(B, 'noclip', { on: true }); await mod(C, 'noclip', { on: true });
    const [vid, v] = Object.entries(S.map.vents)[0];
    await tp(B, near(S.map, v, 40));
    B.send({ t: 'vent', a: 'in', v: vid });
    const vi = await B.wait('vent', m => m.id === B.id && m.a === 'in');
    eq(vi.uses, 0, '남은 환풍구 사용');
    await B.wait('vent', m => m.id === B.id && m.a === 'out' && m.forced, 3500);
    await sleep(1100);
    B.send({ t: 'vent', a: 'in', v: vid });
    await B.wait('err', m => /환풍구/.test(m.msg));
    // 임무 완료 → 타이머 감소
    const tk = B.st.tasks[0];
    for (let s = 0; s < tk.st.length; s++) { B.send({ t: 'task', i: 0, step: s }); await B.wait('tasks'); }
    const cut = await C.wait('hns', m => m.cut);
    eq(cut.cut, (tk.kind === 'long' ? 20 - 3 : 10 - 1.5) * 1000, '임무 완료 시 줄어드는 시간');
    await B.wait('hns', m => m.phase === 'seek', 8000);
    await mod(A, 'noclip', { on: true });
    const pc = spot(S.map, S.map.button.x + 500, S.map.button.y, 0);
    await tp(C, pc); await tp(A, near(S.map, pc, 40));
    A.send({ t: 'kill', id: C.id });
    await B.wait('kill', m => m.id === C.id);
    const fin = await B.wait('hns', m => m.phase === 'final', 20000);
    ok(fin.left <= 8000, '마지막 숨기 시간');
    const ping = await A.wait('hns', m => Array.isArray(m.pings) && m.pings.length, 4000);
    eq(ping.pings[0][0], B.id, '핑은 살아있는 크루원 위치');
    const over = await B.wait('over', () => true, 12000);
    ok(over.winner === 'crew' && over.code === 'hnsTime', '시간 종료 → 크루원 승리');
  } finally { end(S); }
};
T['숨바꼭질 (술래 승리)'] = async () => {
  const S = await squad(2, { settings: { gameType: 'hns', map: 'skeld' }, tag: 'HK' });
  try {
    await begin(S, { noclip: false });
    const seek = role(S, 'impostor'), crew = S.cls.find(c => c !== seek);
    await crew.wait('hns', m => m.phase === 'seek', 13000);
    await mod(seek, 'noclip', { on: true }); await mod(crew, 'noclip', { on: true });
    const p = spot(S.map, S.map.button.x + 400, S.map.button.y, 0);
    await tp(crew, p); await tp(seek, near(S.map, p, 40));
    seek.send({ t: 'kill', id: crew.id });
    const over = await crew.wait('over', () => true, 3000);
    eq(over.winner, 'impostor', '크루원 전멸 → 술래 승리');
  } finally { end(S); }
};

// 연습 모드 (더미)
T['연습 모드'] = async () => {
  for (const [r, mapId] of [['impostor', 'polus'], ['guardian', 'skeld'], ['crew', 'mira']]) {
    const c = await client('PR');
    c.send({ t: 'create', mode: 'practice', role: r, map: mapId, settings: { map: mapId } });
    const s = await c.wait('start', () => true, 4000);
    ok(s.practice && s.map === mapId && s.players.length === 7, `연습 모드 시작 (${r}, ${mapId})`);
    eq(s.role, r === 'crew' ? 'crewmate' : r, '연습 역할');
    if (r === 'guardian') eq(s.alive, false, '유령 역할은 유령으로 시작');
    if (r === 'impostor') {
      await modAuth(c); await sleep(s.intro + 200);
      if (getMap(mapId).spawnPoints?.length) { await c.wait('spawnPick', () => true, 5000); c.send({ t: 'spawn', i: 0 }); await sleep(200); }
      await mod(c, 'nocd', { on: true }); await mod(c, 'noclip', { on: true });
      const bot = s.players.find(p => p.bot), bp = posOf(c, bot.id) || bot;
      await tp(c, near(getMap(mapId), bp, 40));
      c.send({ t: 'kill', id: bot.id });
      await c.wait('kill', m => m.id === bot.id);
      await c.none('over', () => true, 300, '(연습 모드는 승리 판정 없음)');
    }
    c.close();
  }
};

// 채팅 권한: 초록불 계정 + 자유 채팅 로비만 자유 채팅
T['채팅 권한'] = async () => {
  const G = await new Cli('GREEN').connect();
  G.send({ t: 'hello', birth: '1990-01-01' });
  await G.wait('welcome');
  G.send({ t: 'register', email: `t${Date.now()}@test.local`, pass: 'secret12', name: '테스터', birth: '1990-01-01' });
  await G.wait('authOk');
  const w = await G.wait('welcome', m => m.status === 'green');
  G.id = w.id;
  const H = await client('GUEST');
  G.send({ t: 'create', mode: 'online', region: 'as', settings: {} });
  const j = await G.wait('joined');
  H.send({ t: 'join', code: j.room.code }); await H.wait('joined');
  G.send({ t: 'chat', text: '안녕하세요' });
  await H.wait('chat', m => m.id === G.id && m.text === '안녕하세요');
  H.send({ t: 'chat', text: 'hi' });
  await H.wait('err', m => /게스트/.test(m.msg));
  await sleep(550);
  H.send({ t: 'chat', q: { c: 2, i: 0, r: 0 } });
  await G.wait('chat', m => m.id === H.id && m.quick);
  G.send({ t: 'settings', s: { chatType: 'quick' } });
  await G.wait('room', m => m.room.settings.chatType === 'quick');
  await sleep(550);
  G.send({ t: 'chat', text: '자유' });
  await G.wait('err', m => /빠른 채팅 전용/.test(m.msg));
  // 방장 설정 변경 → 기록 + 프리셋 '맞춤 설정'
  G.send({ t: 'settings', s: { killCooldown: 45 } });
  const lg = await H.wait('log', m => m.lines.some(l => /처치 쿨다운 항목을 45.0초로 설정함/.test(l)));
  ok(lg, '설정 변경 기록');
  const rm = await H.wait('room', m => m.room.settings.killCooldown === 45);
  eq(rm.room.settings.preset, '맞춤 설정', '값을 바꾸면 맞춤 설정');
  G.send({ t: 'settings', s: { preset: '다양한 역할' } });
  const rg = await H.wait('room', m => m.room.settings.preset === '다양한 역할');
  ok(rg.room.settings.roleSet.engineer.max === 1 && rg.room.settings.roleSet.engineer.chance === 100 && rg.room.settings.roles, '다양한 역할 프리셋');
  G.send({ t: 'settings', s: { killCooldown: 1, impostors: 9 } }); // 일반 방장은 범위 제한
  const rc = await H.wait('room', m => m.room.settings.killCooldown === 10);
  eq(rc.room.settings.impostors, 3, '임포스터 수 최대 3');
  G.close(); H.close();
};

// mod: 인증 실패/성공, 자동 인증, 모든 동작
T['mod 메뉴'] = async () => {
  const M = await client('MOD');
  M.send({ t: 'mod', a: 'noclip', on: true }); // 인증 전에는 무시
  await M.none('mod', () => true, 300, '(인증 전 mod 동작)');
  M.send({ t: 'mod', a: 'auth', pw: 'wrong' });
  const bad = await M.wait('mod', m => m.a === 'auth');
  ok(!bad.ok && !bad.key, '틀린 비밀번호');
  const key = await modAuth(M);
  const M2 = await client('MOD2', { modKey: key });
  ok((await M2.wait('mod', m => m.a === 'hello')).ok, 'hello{modKey} 자동 인증');
  const M3 = await client('MOD3');
  M3.send({ t: 'mod', a: 'hello', key: 'x'.repeat(64) });
  ok(!(await M3.wait('mod', m => m.a === 'hello')).ok, '틀린 key');
  M3.send({ t: 'mod', a: 'hello', key });
  ok((await M3.wait('mod', m => m.a === 'hello')).ok, 'mod{a:hello} 자동 인증');
  M2.close(); M3.close();
  // 방 만들 때 제한 없는 설정
  M.send({ t: 'create', mode: 'online', region: 'as', settings: { killCooldown: 1, maxPlayers: 30, playerSpeed: 9 } });
  const j = await M.wait('joined');
  ok(j.room.settings.killCooldown === 1 && j.room.settings.maxPlayers === 30 && j.room.settings.playerSpeed === 9, 'mod 방 만들기 무제한 설정');
  const P1 = await client('MP1'), P2 = await client('MP2');
  for (const c of [P1, P2]) { c.send({ t: 'join', code: j.room.code }); await c.wait('joined'); }
  const S = { cls: [M, P1, P2], A: M };
  try {
    await mod(M, 'level', { v: 5000 });
    await P1.wait('room', m => m.room.players.find(p => p.id === M.id)?.lvl === 5000);
    await mod(M, 'settings', { s: { killCooldown: 0.5, emergencyMeetings: 99, discussionTime: 0 } });
    await P1.wait('room', m => m.room.settings.killCooldown === 0.5 && m.room.settings.emergencyMeetings === 99);
    await mod(M, 'map', { id: 'polus' });
    await P1.wait('mapChange', m => m.map === 'polus');
    await mod(M, 'map', { id: 'skeld' });
    await P2.wait('room', m => m.room.settings.map === 'skeld');
    await mod(M, 'rainbow', { on: true, target: 'all' });
    await P1.wait('look', m => m.id === P2.id);
    await P1.wait('look', m => m.id === M.id);
    await mod(M, 'rainbow', { on: false });
    await sleep(300);
    // 로비에서 조종
    await mod(M, 'possess', { id: P1.id });
    await P1.wait('possess', m => m.by === M.id && m.target === P1.id);
    const lp = posOf(M, P1.id);
    M.send({ t: 'move', x: lp.x + 40, y: lp.y, d: 1, m: 1, as: P1.id });
    P1.send({ t: 'move', x: lp.x - 100, y: lp.y, d: 1, m: 1 }); // 조종당하는 사람의 이동은 무시
    await sleep(250);
    eq(posOf(P2, P1.id).x, Math.round(lp.x + 40), '조종 이동');
    await mod(M, 'possess', { id: null });
    await P1.wait('possess', m => m.target === null);
    // 로비 역할 고정
    await mod(M, 'role', { id: P1.id, role: 'detective' });
    await mod(M, 'role', { id: M.id, role: 'impostor' });
    await mod(M, 'settings', { s: { impostors: 1 } });
    await begin(S, { noclip: false });
    eq(M.role, 'impostor', 'mod 역할 고정 (나)'); eq(P1.role, 'detective', 'mod 역할 고정 (다른 사람)');
    // 게임 중 즉시 역할 변경
    await mod(M, 'role', { id: P2.id, role: 'engineer' });
    await P2.wait('roleSet', m => m.role === 'engineer');
    await mod(M, 'settings', { s: { killCooldown: 3 } });
    await P2.wait('settings', m => m.settings.killCooldown === 3);
    await mod(M, 'nocd', { on: true });
    await M.wait('abilityCd', m => m.a === 'kill' && m.ms === 0);
    await mod(M, 'speed', { v: 4 });
    // 벽뚫: 벽 너머로 이동 허용
    const mp = posOf(P1, M.id), wall = { x: 100, y: 100 };
    ok(!walkable(getMap('skeld'), wall.x, wall.y), '벽 안 지점');
    M.send({ t: 'move', x: wall.x, y: wall.y, d: 1, m: 1 });
    await sleep(250);
    ok(posOf(P1, M.id).y === mp.y, '벽뚫 없이 벽 안으로 이동은 거부');
    await mod(M, 'noclip', { on: true });
    M.send({ t: 'move', x: wall.x, y: wall.y, d: 1, m: 1 });
    await sleep(250);
    eq(posOf(P1, M.id).y, wall.y, '벽뚫 이동');
    await mod(M, 'doors');
    const dm = await P1.wait('doors', m => m.closed.length === getMap('skeld').doors.length);
    ok(dm, '모든 문 닫기');
    for (const k of Object.keys(getMap('skeld').sabotages)) { await mod(M, 'sab', { k }); await P1.wait('sab', m => m.sab?.k === k); }
    await mod(M, 'meeting');
    await P1.wait('meeting', m => m.caller === M.id);
    for (const c of S.cls) c.send({ t: 'vote', id: 'skip' });
    await P1.wait('voting', () => true, 9000);
    for (const c of S.cls) c.send({ t: 'vote', id: 'skip' });
    await P1.wait('resume', () => true, 16000);
    await mod(M, 'map', { id: 'mira' });
    const mc = await P1.wait('mapChange', m => m.map === 'mira');
    ok(mc.tasks && mc.pos.length === 3, '게임 중 맵 변경');
    // 게임 중 조종
    await mod(M, 'possess', { id: P2.id });
    await P2.wait('possess', m => m.target === P2.id);
    const q0 = mc.pos.find(a => a[0] === P2.id), q2 = spot(getMap('mira'), q0[1] + 30, q0[2], 0, 60);
    M.send({ t: 'move', x: q2.x, y: q2.y, d: 1, m: 1, as: P2.id });
    await sleep(250);
    eq(posOf(P1, P2.id).x, q2.x, '게임 중 조종 이동');
    await mod(M, 'possess', { id: null });
    await mod(M, 'killAll');
    await P1.wait('kill', m => m.id === P1.id);
    const over = await P2.wait('over', () => true, 3000);
    eq(over.winner, 'impostor', 'killAll → 승리');
    await sleep(300);
    await mod(M, 'map', { id: 'skeld' });
    await begin(S, { noclip: false });
    await mod(M, 'win');
    const ov2 = await P1.wait('over', () => true, 3000);
    eq(ov2.winner, M.st.team, 'win → 내 팀 승리');
    await mod(M, 'kickAll');
    await P1.wait('kicked'); await P2.wait('kicked');
  } finally { end(S); }
};

// MOD_PASSWORD 환경 변수로 비밀번호 변경
T['mod 비밀번호 환경 변수'] = async () => {
  if (process.env.TEST_URL) return 'skip: 외부 서버';
  const url = await boot(+(process.env.TEST_PORT || 8101) + 50, { MOD_PASSWORD: 'other-pass' });
  const c = await new Cli('ENV', url).connect();
  c.send({ t: 'hello', birth: '1990-01-01' }); await c.wait('welcome');
  c.send({ t: 'mod', a: 'auth', pw: PW });
  ok(!(await c.wait('mod', m => m.a === 'auth')).ok, '기본 비밀번호는 거부');
  c.send({ t: 'mod', a: 'auth', pw: 'other-pass' });
  ok((await c.wait('mod', m => m.a === 'auth')).ok, '환경 변수 비밀번호');
  c.close();
};

// 엔진 단위 테스트 (서버 없이): 가짜 맵으로 수동 문·이동 장치·스폰 선택·2곳 수리 시간 창·버섯 혼란·바이탈/문 기록
T['엔진 단위: 수동 문·이동 장치·스폰 선택·사보타주 창·버섯 혼란'] = async () => {
  const GM = await import('../server/game.js');
  const { buildMap } = await import('../public/js/shared/maps/index.js');
  const { sanitizeSettings } = await import('../public/js/shared/data.js');
  const Rc = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const map = buildMap({
    id: 'testmap', name: 'TEST', ko: '테스트', w: 3000, h: 2000, theme: { outside: 'space' },
    rooms: [{ id: 'a', name: 'A방', poly: Rc(100, 100, 1000, 900) }, { id: 'b', name: 'B방', poly: Rc(1300, 100, 2200, 900) }, { id: 'c', name: 'C방', poly: Rc(100, 1100, 1000, 1900) }],
    halls: [{ poly: Rc(950, 400, 1350, 650) }],
    doors: [{ id: 'd_b', room: 'b', x: 1290, y: 400, w: 30, h: 250 }], doorMode: 'manual', doorTime: 10,
    transports: [{ id: 'lad', kind: 'ladder', a: { x: 500, y: 850 }, b: { x: 500, y: 1150 }, time: 1 }, { id: 'plat', kind: 'platform', a: { x: 800, y: 850 }, b: { x: 800, y: 1150 }, time: 1 }],
    stations: { s1: { x: 300, y: 300 }, s2: { x: 1500, y: 300 }, s3: { x: 300, y: 1300 }, vit: { x: 600, y: 300 }, log: { x: 700, y: 300 } },
    sabotages: { comms: { name: '통신 방해', type: 'comms', game: 'comms_code', fix: { s1: 'c1', s2: 'c2' }, room: 'a' },
      crash: { name: '충돌 항로', type: 'critical', time: 90, game: 'crash', fix: { s1: 'k1', s3: 'k2' }, room: 'c' },
      mixup: { name: '버섯 혼란', type: 'mixup', time: 10, game: 'mixup', fix: {}, room: 'b' } },
    tasks: [{ id: 't1', name: '테스트', kind: 'short', game: 'tap', seq: ['s1'] }], vents: {},
    button: { x: 500, y: 500 }, spawn: { x: 500, y: 500, rx: 200, ry: 150 }, spawnPoints: [{ name: 'A', x: 400, y: 400 }, { name: 'B', x: 1700, y: 400 }],
    vitals: 'vit', doorlog: 'log', sensors: [{ id: 'n', name: '복도', x: 1000, y: 400, w: 250, h: 250 }],
  });
  const r = { code: 'UNIT', mode: 'online', settings: sanitizeSettings({ map: 'skeld' }), players: new Map(), forced: new Map(), hooks: {}, unlimited: false };
  const mk = (id, role) => {
    const c = { id, name: id, look: { color: r.players.size }, x: 0, y: 0, room: r, mod: true, nocd: true, msgs: [] };
    c.ws = { send: s => c.msgs.push(JSON.parse(s)) };
    r.players.set(id, c); r.forced.set(id, role);
    return c;
  };
  const A = mk('ua', 'shapeshifter'), B = mk('ub', 'crewmate'), C = mk('uc', 'crewmate');
  const got = (c, t, f = () => true) => c.msgs.find(m => m.t === t && f(m));
  const take = (c, t, f = () => true) => { const m = got(c, t, f); ok(m, `${c.id}: '${t}' 없음`); c.msgs = c.msgs.filter(x => x !== m); return m; };
  const tick = () => GM.tick(g, 66);
  const g = GM.startGame(r);
  g.map = map;
  g.phaseEnd = 0; tick(); // 소개 끝 → 스폰 고르기
  eq(g.phase, 'spawn', '스폰 고르기 단계');
  take(B, 'spawnPick');
  GM.onMsg(A, { t: 'spawn', i: 0 }); GM.onMsg(B, { t: 'spawn', i: 1 });
  ok(Math.hypot(B.x - 1700, B.y - 400) < 120, '고른 위치에 배치');
  g.phaseEnd = 0; tick(); // C 는 시간 초과 → 무작위
  eq(g.phase, 'play', '스폰 후 플레이');
  ok(got(A, 'spawnDone'), 'spawnDone');
  // 수동 문: 닫히면 오래 유지, 패널 완료(openDoor)로 열림
  GM.onMsg(A, { t: 'door', room: 'b' });
  const d = take(B, 'doors', m => m.closed.includes('d_b'));
  ok(d.mode === 'manual' && g.doors.get('d_b').until - Date.now() > 25000, '수동 문은 패널로 열 때까지 유지 (오래 뒤 자동)');
  B.x = 1250; B.y = 520; GM.onMsg(B, { t: 'openDoor', id: 'd_b' });
  ok(!g.doors.has('d_b'), '패널로 문 열기');
  // 사다리
  B.x = 500; B.y = 860; GM.onMsg(B, { t: 'transport', id: 'lad' });
  const tr = take(A, 'transport', m => m.pid === B.id);
  ok(tr.to.y === 1150 && GM.flags(g, B.id) & 8, '사다리 이동 중');
  g.st.get(B.id).trans.until = 0; tick();
  ok(B.y === 1150 && got(A, 'transportDone'), '사다리 도착');
  // 승강장: 반대편이면 먼저 불러옴
  C.x = 800; C.y = 860; GM.onMsg(C, { t: 'transport', id: 'plat' });
  ok(take(A, 'transport', m => m.pid === C.id), '승강장 탑승');
  g.st.get(C.id).trans.until = 0; tick();
  g.platforms.plat.busy = 0;
  B.x = 800; B.y = 860; GM.onMsg(B, { t: 'transport', id: 'plat' });
  ok(take(A, 'transport', m => m.id === 'plat' && m.call), '반대편 승강장 부르기');
  // 2곳 통신: 한 곳 고치면 10초 안에 다른 곳
  GM.onMsg(A, { t: 'sab', k: 'comms' });
  ok(g.sab?.k === 'comms', '통신 방해 시작');
  B.x = 300; B.y = 300; GM.onMsg(B, { t: 'vitals', on: true });
  ok(got(B, 'vitalsData', m => m.comms), '통신 방해 중 바이탈 불가');
  GM.onMsg(B, { t: 'fix', k: 'comms', p: 'c1', on: true });
  ok(g.sab.winEnd > Date.now(), '10초 시간 창');
  g.sab.winEnd = 1; tick();
  ok(!Object.keys(g.sab.parts).length && got(A, 'sab', m => m.reset), '시간 창이 지나면 초기화');
  GM.onMsg(B, { t: 'fix', k: 'comms', p: 'c1' }); GM.onMsg(C, { t: 'fix', k: 'comms', p: 'c2' });
  ok(!g.sab, '두 곳 모두 고치면 해결');
  // 추락 항로 (2곳, 10초 창)
  GM.onMsg(A, { t: 'sab', k: 'crash' });
  GM.onMsg(B, { t: 'fix', k: 'crash', p: 'k1' });
  ok(g.sab.winEnd > 0, '추락 항로 시간 창');
  GM.onMsg(C, { t: 'fix', k: 'crash', p: 'k2' });
  ok(!g.sab, '추락 항로 해결');
  // 버섯 혼란: 모습이 섞였다가 시간이 지나면 저절로 해제, 형상 변환 강제 해제
  GM.onMsg(A, { t: 'ability', a: 'shift', id: B.id });
  ok(g.st.get(A.id).shift === B.id, '변신');
  GM.onMsg(A, { t: 'sab', k: 'mixup' });
  ok(Object.keys(GM.sabPub(g).mix || {}).length === 3, '혼란 색 배정');
  g.sab.until = 1; tick();
  ok(!g.sab && !g.st.get(A.id).shift, '버섯 혼란 해제 + 변신 강제 해제');
  // 바이탈 장치 / 문 기록 센서
  B.msgs = [];
  B.x = 600; B.y = 300; GM.onMsg(B, { t: 'ability', a: 'vitals', on: true, src: 'station' });
  ok(got(B, 'vitalsData', m => Array.isArray(m.list) && m.list.length === 3), '바이탈 장치');
  C.x = 1100; C.y = 500; tick();
  B.x = 700; GM.onMsg(B, { t: 'doorlog', on: true });
  const dl = got(B, 'doorlogData', m => Array.isArray(m.list));
  ok(dl?.list.some(e => e.id === C.id && e.sensor === '복도'), '문 기록 센서');
  g.over = true;
};

// ---------- 실행 ----------
const only = process.argv.slice(2);
(async () => {
  if (!URL_) URL_ = await boot(+(process.env.TEST_PORT || 8101));
  const names = Object.keys(T).filter(n => !only.length || only.some(o => n.includes(o)));
  const t0 = Date.now();
  console.log(`서버 테스트 ${names.length}개 (${URL_})\n`);
  const res = await Promise.all(names.map(async n => {
    const s = Date.now();
    try {
      const r = await Promise.race([T[n](), sleep(150000).then(() => { throw new Error('시간 초과 (150초)'); })]);
      return [n, typeof r === 'string' ? 'skip' : 'ok', r || '', Date.now() - s];
    } catch (e) { return [n, 'fail', e.message, Date.now() - s]; }
  }));
  for (const [n, st, msg, ms] of res) console.log(`${st === 'ok' ? '✓' : st === 'skip' ? '-' : '✗'} ${n} (${(ms / 1000).toFixed(1)}초)${msg ? ' — ' + msg : ''}`);
  const fail = res.filter(r => r[1] === 'fail').length, skip = res.filter(r => r[1] === 'skip').length;
  console.log(`\n통과 ${res.length - fail - skip} / 실패 ${fail} / 건너뜀 ${skip} — ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
