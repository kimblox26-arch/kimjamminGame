// 수능 감독관 — 게임 로직 (선생님 모드 / 학생 모드 / 상점 / 채팅 / 해킹)
import * as THREE from 'three';
import { icon, WEAPONS, SHOP_ORDER, NAMES, REACT, classify, makeQuestion, aiAnswer } from './data.js';
import { SFX } from './audio.js';
import { R, rand, pick, clamp, CHAIR, buildWorld, buildStudent, buildWeapon, drawBoard, setClock, drawPage, inkStroke, addDecal, lam, basic, M, updDecor, renderFrame, resizeGfx, setQuality, Q, paintMat, updAmbient, setRim, drawTag } from './world.js';

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const wrapA = (a) => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };
const lerpA = (a, b, k) => a + wrapA(b - a) * k;
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const L = (o, p, v, k) => { o[p] += (v - o[p]) * k; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const _v = V(), _v2 = V(), _v3 = V(), _sv = V();

const HACK_PW = '2027';
const COLS = [-5.2, -3.1, -1.05, 1.05, 3.1, 5.2], ROWS = [-3.4, -1.2, 1.0, 3.2];
const PIDX = 2 * 6 + 3;
const PAINT = ['#ff2d7a', '#2ad0ff', '#ffd400', '#7bff3a', '#b44dff', '#ff7a1a'];
const SEATED = new Set(['exam', 'endsit', 'stunned', 'caught']);
const SCHED = [
  { k: 'p', n: '제1교시', s: '국어', d: 70, a: '08:40', b: '10:00' },
  { k: 'p', n: '제2교시', s: '수학', d: 70, a: '10:30', b: '12:10' },
  { k: 'l', n: '점심시간', s: '', d: 0, a: '12:10', b: '13:10' },
  { k: 'p', n: '제3교시', s: '영어', d: 60, a: '13:10', b: '14:20' },
  { k: 'p', n: '제4교시', s: '탐구', d: 60, a: '14:50', b: '16:37' },
];
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

// ───────── 상태 ─────────
const G = {
  mode: 'menu', phase: 'menu', T: 0, paused: false, hearts: 3, coins: 0, owned: [], slots: [], sel: 0, cd: {}, cdMax: {},
  hack: { money: false, nocd: false, find: false }, unlocked: false, settings: { sound: true, voice: true, quality: '', view: 'fp' },
  sched: 0, pT: 0, subj: '국어', examOn: false, found: 0, earned: 0, proj: [], tw: [], bubs: [], shake: 0, camBlend: 1,
  shop: false, shopSel: 'bat', chatOpen: false,
  // 학생 모드
  q: null, qNo: 0, qStart: 0, qLock: false, correct: 0, answered: 0, susp: 0, aiOpen: false, solvingT: 0, writeT: 0, catching: false, sv: { yaw: 0, pitch: -.42 },
};
const P = { pos: V(0, 0, -5.3), vy: 0, yaw: PI, ground: true, cy: PI, cp: .55, cdist: 5.2, anim: null, dash: false, armed: true, pitch: -.1, kick: 0, bobT: 0, bobA: 0 };
const VM = { swX: 0, swY: 0, rec: 0, eq: 0, lastCy: 0, lastP: 0, held: null, reach: null };
const IN = { jx: 0, jy: 0, keys: {}, atk: false, jump: false, drag: null, jid: null };
const N = { xi: 3, zi: 0, tx: 3, tz: 0, wait: 2, look: null };
const GX = [-6.2, -4.15, -2.08, 0, 2.08, 4.15, 6.2], GZ = [-4.6, -2.44, -.24, 1.96, 4.6];
const camPos = V(-2.5, 3, 4), camLook = V(0, 1, -2);

function load() {
  try { const s = JSON.parse(localStorage.getItem('suneung_save') || '{}'); G.coins = s.coins || 0; G.owned = Array.isArray(s.owned) ? s.owned : []; Object.assign(G.settings, s.settings || {}); } catch (e) { /* 저장 없음 */ }
}
function save() { try { localStorage.setItem('suneung_save', JSON.stringify({ coins: G.coins, owned: G.owned, settings: G.settings })); } catch (e) { /* 저장 불가 */ } }

// ───────── 시작 ─────────
buildWorld($('cv'));
document.querySelectorAll('[data-ic]').forEach((e) => (e.innerHTML = icon(e.dataset.ic)));
load(); applySettings(); rebuildSlots(); resize(); addEventListener('resize', resize);
newWorld('menu'); toMenu();
drawBoard({ p: '제1교시', s: '국어', time: '08:40 ~ 10:00' });
document.fonts && document.fonts.ready.then(() => drawBoard(boardInfo()));
requestAnimationFrame(loop);

function boardInfo() { const s = SCHED[Math.min(G.sched, SCHED.length - 1)]; return G.phase === 'end' || G.phase === 'results' ? { p: '시험', s: '', time: '수고하셨습니다!' } : { p: s.n, s: s.s, time: `${s.a} ~ ${s.b}` }; }
function resize() { resizeGfx(); }
function applySettings() {
  SFX.setOn(G.settings.sound); SFX.voiceOn = G.settings.voice;
  if (G.settings.quality && G.settings.quality !== Q.level) setQuality(G.settings.quality);
  $('optSound').checked = G.settings.sound; $('optVoice').checked = G.settings.voice;
  document.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === Q.level));
}

// ───────── 월드 (학생 배치) ─────────
function newWorld(mode) {
  for (const st of R.students) { R.scene.remove(st.seat, st.fig, st.marker); if (st.stars) R.scene.remove(st.stars); }
  R.debris.forEach((d) => R.scene.remove(d.m)); R.debris.length = 0;
  R.decals.forEach((d) => R.scene.remove(d)); R.decals.length = 0;
  G.proj.forEach((p) => R.scene.remove(p.m)); G.proj.length = 0;
  G.tw.length = 0; clearBubbles(); R.pfxA.clear(); R.pfxN.clear(); R.pfxS.clear();
  R.students = []; R.obstacles = [{ x0: -.95, x1: .95, z0: -6.44, z1: -5.56, h: .83, on: true }];
  const names = shuffle(NAMES.slice()), n = COLS.length * ROWS.length;
  const pool = shuffle([...Array(n).keys()].filter((k) => !(mode === 'student' && k === PIDX)));
  const nCheat = mode === 'student' ? 5 : 7, cheat = new Set(pool.slice(0, nCheat)), decoy = new Set(pool.slice(nCheat, nCheat + 7));
  let i = 0;
  for (let r = 0; r < ROWS.length; r++) for (let c = 0; c < COLS.length; c++, i++) {
    const isP = mode === 'student' && i === PIDX, ai = cheat.has(i) || isP;
    const st = buildStudent(i, COLS[c], ROWS[r], { glasses: ai ? 'ai' : decoy.has(i) ? 'normal' : 'none', thick: Math.random() < .5, name: names[i] });
    Object.assign(st, { cheater: ai, found: false, isPlayer: isP, state: 'exam', destroyed: false });
    st.obs = { x0: COLS[c] - .48, x1: COLS[c] + .48, z0: ROWS[r] - .7, z1: ROWS[r] + .42, h: .78, on: true, dx0: COLS[c] - .46, dx1: COLS[c] + .46, dz0: ROWS[r] - .67, dz1: ROWS[r] - .05 };
    R.obstacles.push(st.obs); drawPage(st, '국어', 0); R.students.push(st);
    if (isP) { st.head.visible = false; G.me = st; }
  }
  R.door.rotation.y = 0;
}
const remaining = () => R.students.filter((s) => s.cheater && !s.found && !s.isPlayer).length;

// ───────── 화면 전환 ─────────
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function toMenu() {
  closeModal(); show('settings', false); show('hud', false); show('shopExit', false); document.body.classList.remove('shop'); G.shop = false; show('cine', false); show('menu', true);
  G.mode = 'menu'; G.phase = 'menu'; G.paused = false; G.shop = false; G.examOn = true; G.sched = 0;
  if (R.students.length === 0 || G.dirtyWorld) newWorld('menu'); G.dirtyWorld = false;
  R.teacher.root.visible = true; P.pos.set(0, 0, -5.3); P.yaw = PI; P.anim = null; setHeld(null); R.teacher.stack.visible = false;
  $('mCoins').textContent = G.coins; drawBoard({ p: '제1교시', s: '국어', time: '08:40 ~ 10:00' });
}
function startGame(mode) {
  SFX.init(); show('menu', false);
  G.mode = mode; G.hearts = 3; G.found = 0; G.earned = 0; G.sched = 0; G.pT = 0; G.shake = 0; G.dirtyWorld = true;
  G.correct = 0; G.answered = 0; G.susp = 0; G.aiOpen = false; G.catching = false; G.sv.yaw = 0; G.sv.pitch = -.42; G.cd = {}; G.cdMax = {};
  newWorld(mode); rebuildSlots(); G.sel = 0;
  P.cy = PI; P.cp = .55; P.pitch = -.1; P.kick = 0; P.anim = null; if (VM.held) { VM.held.removeFromParent(); VM.held = null; } P.dash = false; P.vy = 0; P.ground = true; P.armed = true;
  Object.assign(N, { xi: 3, zi: 0, tx: 3, tz: 0, wait: 2, look: null });
  $('chatLog').innerHTML = ''; $('aiLog').innerHTML = ''; show('aiPanel', false); document.body.classList.remove('aion');
  show('tctl', mode === 'teacher'); show('sctl', mode === 'student'); show('btnResult', false);
  aiMsg('ai', '연결 완료. 무엇이든 물어보세요! (감독관 시선 주의)');
  startIntro();
}

// ───────── 입실 애니메이션 ─────────
function startIntro() {
  G.phase = 'intro'; G.introT = 0; G.flags = {}; show('cine', true); show('hud', false); $('cineTxt').innerHTML = '';
  P.pos.set(8.7, 0, -4.5); P.yaw = PI / 2; R.teacher.stack.visible = true; R.door.rotation.y = 0; setHeld(null);
  camPos.set(-2.5, 1.8, 2.8); camLook.set(0, 1.6, -8); G.camBlend = 1;
  for (const st of R.students) st.lookT = 0;
}
function cine(a, b) { $('cineTxt').innerHTML = `<b>${a}</b><span>${b}</span>`; $('cineTxt').classList.remove('pop'); void $('cineTxt').offsetWidth; $('cineTxt').classList.add('pop'); }
function updIntro(dt) {
  const t = (G.introT += dt), f = G.flags;
  R.door.rotation.y = t < 1.6 ? 0 : t < 2.4 ? ease((t - 1.6) / .8) * 1.45 : t < 5.6 ? 1.45 : t < 6.3 ? 1.45 * (1 - ease((t - 5.6) / .7)) : 0;
  if (t > 1.6 && !f.door) { f.door = 1; SFX.door(R.door.position); }
  if (t > 5.6 && !f.door2) { f.door2 = 1; SFX.door(R.door.position); }
  let spd = 0;
  if (t > 2 && t < 3.6) { const k = (t - 2) / 1.6; P.pos.set(lerp(8.7, 5.6, k), 0, -4.5); P.yaw = PI / 2; spd = 1.9; }
  else if (t >= 3.6 && t < 5.6) { const k = (t - 3.6) / 2; P.pos.set(lerp(5.6, .9, k), 0, lerp(-4.5, -5.05, k)); P.yaw = lerpA(P.yaw, Math.atan2(4.7, .55), Math.min(1, dt * 8)); spd = 2.3; }
  else if (t >= 5.6) { P.pos.set(.9, 0, -5.05); P.yaw = lerpA(P.yaw, PI, Math.min(1, dt * 5)); }
  R.teacher.root.position.copy(P.pos); R.teacher.root.rotation.y = P.yaw; poseTeacher(dt, spd);
  if (t < 5.6) { R.teacher.armL.sh.rotation.x = 1.1; R.teacher.armL.el.rotation.x = 1.0; } else R.teacher.stack.visible = false;
  if (t > 1.6 && t < 6.5) for (const st of R.students) st.lookT = Math.max(st.lookT, .2);
  const head = _v.set(P.pos.x, 1.6, P.pos.z);
  if (G.mode === 'teacher') {
    if (isFP()) { P.cy = P.yaw; P.pitch = lerp(P.pitch, t < 5.6 ? -.04 : -.12, Math.min(1, dt * 3)); P.bobA = spd > .2 ? 1 : 0; P.bobT += dt * spd * 2.4; R.teacher.root.visible = false; G.camBlend = 1; fpCam(dt); }
    else if (t < 1.7) setCam(_v2.set(-2.5, 1.8, 2.8), _v3.set(0, 1.6, -8), dt, 2);
    else if (t < 5.6) setCam(_v2.set(2.4, 1.75, -1.4), head, dt, 2.5);
    else { const fp = followCam(); setCam(fp[0], fp[1], dt, 3); }
  } else {
    const me = G.me, eye = _v2.set(me.x, 1.24, me.z + .1);
    if (t < 1.7) setCam(eye, _v3.set(0, 1.6, -8), dt, 6); else if (t < 6.2) setCam(eye, head, dt, 4); else setCam(eye, _v3.set(me.x, .9, me.z - 2.2), dt, 3);
  }
  if (t > .3 && !f.t1) { f.t1 = 1; cine('2027학년도 대학수학능력시험', '제 12 시험실 · 수험생 입실 완료'); }
  if (t > 5.3 && !f.t2) { f.t2 = 1; cine(G.mode === 'teacher' ? '감독관 입실' : 'AI 안경 연결됨', '곧 제1교시 국어 영역이 시작됩니다'); }
  if (t > 7.2) endIntro();
}
function endIntro() {
  show('cine', false); show('hud', true); R.teacher.stack.visible = false; R.door.rotation.y = 0;
  P.pos.set(.9, 0, -5.05); P.yaw = PI; P.cy = PI; P.pitch = -.12; G.camBlend = 0; setHeld(curWeapon());
  for (const st of R.students) st.lookT = 0;
  if (G.mode === 'teacher') { renderHotbar(); toast('의자(노란 원)에 가면 무기 상점이 열려요', 'info'); } else setHeld(null);
  beginPeriod(); updHUD();
}

// ───────── 시험 진행 ─────────
function beginPeriod() {
  const s = SCHED[G.sched]; G.phase = 'exam'; G.examOn = true; G.pT = 0; G.subj = s.s;
  drawBoard(boardInfo());
  for (const st of R.students) { if (st.state === 'ko' || st.destroyed) continue; st.page = 0; drawPage(st, s.s, 0); st.act = 'write'; st.actT = rand(.3, 3); }
  SFX.bell(); banner(`${s.n} ${s.s} 영역`, '시험 시작!');
  setTimeout(() => { if (G.phase === 'exam') SFX.speak(`지금부터 ${s.n} ${s.s} 영역 시험을 시작하겠습니다. 부정행위는 즉시 퇴실입니다.`, { rate: 1.02, pitch: .9, prio: true }); }, 4800);
  if (G.mode === 'student') { G.qNo = 0; nextQuestion(); }
  updHUD();
}
function nextSched() {
  G.sched++;
  if (G.sched >= SCHED.length) { endExam(); return; }
  if (SCHED[G.sched].k === 'l') lunch(); else beginPeriod();
}
function lunch() {
  G.phase = 'lunch'; G.examOn = false; SFX.bell(); SFX.speak('점심시간입니다. 오후 시험은 1시 10분에 시작합니다.', { prio: true }); IN.atk = false; if (G.shop) closeShop(); closeAI();
  const rem = remaining();
  const body = G.mode === 'teacher'
    ? `<p>남은 AI 안경 학생</p><div class="big red">${rem}명</div><p class="dim">지금까지 적발: ${G.found}명 · 남은 하트 ${G.hearts}개</p>`
    : `<p>오전 시험 결과</p><div class="big">${G.correct} / ${G.answered}</div><p class="dim">점심을 먹으면 감독관 의심도가 초기화됩니다</p>`;
  let n = 10;
  modal(`<div class="mic">${icon('lunch')}</div><h3>점심시간</h3>${body}<button class="pill go" id="lunchGo">다시 수능 시작 (<span id="lcd">${n}</span>)</button>`);
  const go = () => { clearInterval(G.lunchTimer); closeModal(); G.susp = 0; nextSched(); };
  $('lunchGo').onclick = go;
  G.lunchTimer = setInterval(() => { n--; const e = $('lcd'); if (e) e.textContent = n; if (n <= 0) go(); }, 1000);
}
function endExam() {
  G.examOn = false; SFX.bell(); SFX.speak('시험이 종료되었습니다. 모두 필기구를 내려놓으세요.', { prio: true, pitch: .9 }); IN.atk = false; closeAI();
  if (G.mode === 'student') { G.phase = 'results'; setTimeout(results, 600); return; }
  G.phase = 'end'; drawBoard(boardInfo());
  banner('수능 종료!', '빨간색 = 남은 AI 안경 학생 · 초록색 = 일반 학생');
  for (const st of R.students) {
    if (st.state === 'exam' || st.state === 'stunned') { st.state = 'endsit'; removeStars(st); }
    if (st.cheater && !st.found && SEATED.has(st.state)) setTimeout(() => say(st, pick(['헉...!', '들켰다!', '(덜덜)'])), rand(300, 1500));
  }
  show('btnResult', true); updHUD();
}
function tint(st, mat) { st.fig.traverse((o) => { if (o.isMesh && !o.userData.noTint && !o.userData.paint) o.material = mat; }); }
function results() {
  G.phase = 'results'; G.examOn = false; IN.atk = false; if (G.shop) closeShop();
  let html;
  if (G.mode === 'teacher') {
    const tot = R.students.filter((s) => s.cheater).length, rate = G.found / tot;
    const rank = rate >= 1 ? 'S' : rate >= .7 ? 'A' : rate >= .45 ? 'B' : 'C';
    html = `<div class="mic">${icon('star')}</div><h3>감독 결과 <em class="rank">${rank}</em></h3>
      <div class="stats"><div><b>${G.found}/${tot}</b><span>AI 안경 적발</span></div><div><b>${tot - G.found}</b><span>놓친 학생</span></div><div><b>${3 - G.hearts}</b><span>무고한 피해</span></div><div><b>+${G.earned}</b><span>획득 코인</span></div></div>`;
  } else {
    const r = G.answered ? G.correct / G.answered : 0, grade = G.answered < 4 ? 9 : clamp(Math.round(9 - r * 8), 1, 9);
    html = `<div class="mic">${icon('star')}</div><h3>수능 성적표 <em class="rank">${grade}등급</em></h3>
      <div class="stats"><div><b>${G.correct}/${G.answered}</b><span>맞힌 문제</span></div><div><b>${G.hearts}</b><span>남은 하트</span></div><div><b>${Math.round(G.susp)}%</b><span>최종 의심도</span></div></div>`;
  }
  modal(html + `<div class="row2"><button class="pill go" id="again">다시 하기</button><button class="pill" id="home">메인으로</button></div>`);
  $('again').onclick = () => { closeModal(); startGame(G.mode); }; $('home').onclick = toMenu;
}
function gameOver(msg) {
  if (G.phase === 'over') return; G.phase = 'over'; G.examOn = false; IN.atk = false; if (G.shop) closeShop(); closeAI();
  setTimeout(() => {
    modal(`<div class="mic">${icon('heart0')}</div><h3>게임 오버</h3><p>${msg}</p><div class="row2"><button class="pill go" id="again">다시 하기</button><button class="pill" id="home">메인으로</button></div>`);
    $('again').onclick = () => { closeModal(); startGame(G.mode); }; $('home').onclick = toMenu;
  }, 1200);
}

// ───────── 감독관 (플레이어) ─────────
const curWeapon = () => G.slots[G.sel] || 'snatch';
function rebuildSlots() { G.slots = ['snatch', 'punch', ...SHOP_ORDER.filter((k) => G.owned.includes(k))]; if (G.sel >= G.slots.length) G.sel = 0; }
const heldCache = {};
function setHeld(id) {
  const m = R.teacher.mount; while (m.children.length) m.remove(m.children[0]);
  VM.eq = 1; if (!id || !WEAPONS[id] || !WEAPONS[id].price) return;
  m.add(heldCache[id] || (heldCache[id] = buildWeapon(id)));
}
function collide(p, r) {
  p.x = clamp(p.x, -6.7, 6.7); p.z = clamp(p.z, -7.65, 7.25);
  for (const o of R.obstacles) {
    if (!o.on || p.y >= o.h - .06) continue;
    const cx = clamp(p.x, o.x0, o.x1), cz = clamp(p.z, o.z0, o.z1), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
    else { const a = p.x - o.x0, b = o.x1 - p.x, c = p.z - o.z0, e = o.z1 - p.z, mn = Math.min(a, b, c, e); if (mn === a) p.x = o.x0 - r; else if (mn === b) p.x = o.x1 + r; else if (mn === c) p.z = o.z0 - r; else p.z = o.z1 + r; }
  }
}
function groundY(x, z) {
  let g = 0;
  for (const o of R.obstacles) { if (!o.on) continue; if (o.dx0 !== undefined ? (x > o.dx0 && x < o.dx1 && z > o.dz0 && z < o.dz1) : (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1)) g = Math.max(g, o.dx0 !== undefined ? .76 : o.h); }
  return g;
}
function updTeacher(dt) {
  let ix = IN.jx, iy = IN.jy; const k = IN.keys;
  if (k.KeyA || k.ArrowLeft) ix -= 1; if (k.KeyD || k.ArrowRight) ix += 1; if (k.KeyW || k.ArrowUp) iy += 1; if (k.KeyS || k.ArrowDown) iy -= 1;
  const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
  if (G.shop && il > .6) closeShop();
  let vx = 0, vz = 0;
  const canMove = !G.shop && !(P.anim && P.anim.lock) && !P.dash && (G.phase === 'exam' || G.phase === 'end');
  if (canMove) { const fx = -Math.sin(P.cy), fz = -Math.cos(P.cy), rx = Math.cos(P.cy), rz = -Math.sin(P.cy); vx = (fx * iy + rx * ix) * 3.4; vz = (fz * iy + rz * ix) * 3.4; }
  P.pos.x += vx * dt; P.pos.z += vz * dt; collide(P.pos, .3);
  const sp = Math.hypot(vx, vz); if (sp > .1) P.yaw = lerpA(P.yaw, Math.atan2(-vx, -vz), Math.min(1, dt * 12));
  if (isFP()) P.yaw = P.cy; P.bobA = lerp(P.bobA, sp > .3 && P.ground ? 1 : 0, Math.min(1, dt * 6)); P.bobT += dt * sp * 2.4; P.kick *= Math.max(0, 1 - dt * 9);
  if (IN.jump && P.ground && canMove) { P.vy = 5.4; P.ground = false; SFX.jump(P.pos); } IN.jump = false;
  P.vy -= 15 * dt; P.pos.y += P.vy * dt; const gy = groundY(P.pos.x, P.pos.z);
  if (P.pos.y <= gy && P.vy <= 0) { if (!P.ground && P.vy < -4) SFX.step(P.pos); P.pos.y = gy; P.vy = 0; P.ground = true; } else if (P.pos.y > gy + .02) P.ground = false;
  if (P.anim) { P.anim.t += dt; if (P.anim.fn && !P.anim.hitDone && P.anim.t >= P.anim.hit) { P.anim.hitDone = true; P.anim.fn(); } if (P.anim.t >= P.anim.d) P.anim = null; }
  for (const id in G.cd) G.cd[id] -= dt;
  if (IN.atk && WEAPONS[curWeapon()].auto) tryAttack();
  R.teacher.root.position.set(P.pos.x, P.pos.y, P.pos.z); R.teacher.root.rotation.y = P.yaw; poseTeacher(dt, P.ground ? sp : 0);
  // 상점 (의자)
  const dc = Math.hypot(P.pos.x - CHAIR.x, P.pos.z - CHAIR.z);
  if (dc < .5 && P.armed && !G.shop && P.ground) openShop();
  if (dc > .9) P.armed = true;
  // 근접 대상 표시
  const w = WEAPONS[curWeapon()], fp = isFP(), tg = G.shop ? null : fp ? (w.range ? viewHit(w.range + .4, .12, true) : viewHit(40, 0)) : (w.range ? meleeTarget(w.range) : null);
  $('xhair').classList.toggle('tgt', fp && !!tg); R.teacher.root.visible = !fp && !G.shop;
  R.tring.visible = !fp && !!tg; if (tg && !fp) { R.tring.position.set(tg.x, .02, tg.z + .14); R.tring.scale.setScalar(1 + Math.sin(G.T * 8) * .06); }
}
function followCam() {
  const t = _v3.set(P.pos.x, P.pos.y + 1.35, P.pos.z), c = Math.cos(P.cp) * P.cdist;
  return [_v2.set(t.x + Math.sin(P.cy) * c, t.y + Math.sin(P.cp) * P.cdist, t.z + Math.cos(P.cy) * c), t];
}
function setCam(pos, look, dt, k) {
  G.camBlend = Math.min(1, G.camBlend + dt * 1.2);
  const kk = k ?? lerp(3, 40, G.camBlend * G.camBlend), a = 1 - Math.exp(-kk * dt);
  camPos.lerp(pos, a); camLook.lerp(look, a); R.cam.position.copy(camPos);
  if (G.shake > 0) { const s = G.shake * .14; R.cam.position.x += rand(-s, s); R.cam.position.y += rand(-s, s); R.cam.position.z += rand(-s, s); }
  R.cam.lookAt(camLook);
}
function poseTeacher(dt, spd) {
  const T = R.teacher, k = Math.min(1, dt * 12);
  T.walk += dt * spd * 3.3;
  const wph = Math.floor(T.walk / PI); if (wph !== T.lph) { T.lph = wph; if (spd > .3 && G.phase !== 'menu') SFX.step(T.root.position); }
  const amt = Math.min(1, spd / 2.2), sw = Math.sin(T.walk) * .75 * amt;
  let lgL = sw, lgR = -sw, lsx = -sw * .7, lsz = .08, lex = .25, rsx = sw * .7, rsz = -.08, rex = .25, bx = 0;
  const w = G.mode === 'teacher' ? curWeapon() : null;
  if (w === 'pistol' || w === 'ak') { rsx = 1.35; rex = .2; rsz = 0; if (w === 'ak') { lsx = 1.3; lsz = -.45; lex = .5; } }
  else if (w === 'rpg') { rsx = 1.45; rex = .1; lsx = 1.35; lsz = -.5; lex = .35; }
  else if (w === 'bat') { rsx = .5; rex = 1.6; rsz = -.15; }
  if (!P.ground && G.mode === 'teacher') { lgL = .7; lgR = -.3; lsz = .7; if (!w || !WEAPONS[w].price) rsz = -.7; }
  const a = P.anim;
  if (a) {
    const p = a.t / a.d;
    if (a.k === 'bat') { if (p < .45) { const q = p / .45; rsx = lerp(.5, 2.9, ease(q)); rex = lerp(1.6, .2, q); rsz = -.3; } else { const q = Math.min(1, (p - .45) / .22); rsx = lerp(2.9, .35, ease(q)); rex = .1; rsz = lerp(-.3, .2, q); bx = -.18 * q; } }
    else if (a.k === 'punch') { const q = Math.sin(Math.min(1, p) * PI); rsx = lerp(.3, 1.6, q); rex = lerp(1.4, 0, q); bx = -.1 * q; }
    else if (a.k === 'snatch') { if (p < .3) { rsx = lerp(.2, 1.45, p / .3); rex = .1; } else { rsx = 1.15; rex = 1.2; lsx = 1.15; lex = 1.2; lsz = -.3; rsz = .3; } }
    else if (a.k === 'shoot') rsx += .2 * (1 - p);
    else if (a.k === 'tackle') { rsx = lsx = 1.55; rex = lex = .1; bx = -.4; }
  }
  L(T.legL.rotation, 'x', lgL, k); L(T.legR.rotation, 'x', lgR, k);
  L(T.armL.sh.rotation, 'x', lsx, k); L(T.armL.sh.rotation, 'z', lsz, k); L(T.armL.el.rotation, 'x', lex, k);
  L(T.armR.sh.rotation, 'x', rsx, a && a.k === 'bat' ? Math.min(1, dt * 30) : k); L(T.armR.sh.rotation, 'z', rsz, k); L(T.armR.el.rotation, 'x', rex, k);
  L(T.body.rotation, 'x', bx, k);
  if (spd > .2 && P.ground) T.root.position.y += Math.abs(Math.sin(T.walk)) * .04;
}

// ───────── 공격 ─────────
function meleeTarget(range) {
  let best = null, bs = 1e9; const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  for (const st of R.students) {
    if (!SEATED.has(st.state) || st.isPlayer) continue;
    const dx = st.x - P.pos.x, dz = st.z + .14 - P.pos.z, d = Math.hypot(dx, dz); if (d > range) continue;
    const dot = (dx * fx + dz * fz) / (d || 1); if (dot < -.2 && d > 1.1) continue;
    const s = d - dot * .8; if (s < bs) { bs = s; best = st; }
  }
  return best;
}
function aimTarget() {
  let best = null, bs = 1e9;
  for (const st of R.students) {
    if (st.state === 'ko' || st.isPlayer) continue;
    const dx = st.cpos.x - P.pos.x, dz = st.cpos.z - P.pos.z, d = Math.hypot(dx, dz); if (d > 16 || d < .3) continue;
    const ang = Math.abs(wrapA(Math.atan2(-dx, -dz) - P.yaw)); if (ang > .42) continue;
    const s = ang * 3 + d * .05; if (s < bs) { bs = s; best = st; }
  }
  return best;
}
const faceTo = (st) => { P.yaw = Math.atan2(-(st.x - P.pos.x), -(st.z + .14 - P.pos.z)); };
function tryAttack() {
  if (G.mode !== 'teacher' || G.paused || G.shop || !(G.phase === 'exam' || G.phase === 'end')) return;
  const id = curWeapon(), w = WEAPONS[id];
  if ((G.cd[id] || 0) > 0 || (P.anim && P.anim.lock) || P.dash) return;
  const cd = G.hack.nocd ? (w.kind === 'gun' ? .06 : .15) : w.cd;
  let ok = true;
  if (isFP()) {
    if (w.kind === 'gun' || w.kind === 'rocket') fireFP(w, id);
    else { const t = viewHit(w.range + .4, .14, true); if (w.kind === 'snatch') ok = actSnatchFP(t); else if (w.kind === 'punch') actPunchFP(t); else if (w.kind === 'bat') actBatFP(); else ok = actTackle(t); }
  } else if (w.kind === 'gun') fireGun(w);
  else if (w.kind === 'rocket') fireRocket(w);
  else {
    const t = meleeTarget(w.range);
    if (w.kind === 'snatch') ok = actSnatch(t); else if (w.kind === 'punch') actPunch(t); else if (w.kind === 'bat') actBat(t); else ok = actTackle(t);
  }
  G.cd[id] = ok ? cd : .35; G.cdMax[id] = G.cd[id];
}
function actSnatch(st) {
  if (!st) { toast('가까이에 학생이 없어요', 'info'); return false; }
  faceTo(st);
  if (!st.glasses) { P.anim = { k: 'punch', t: 0, d: .3 }; say(st, '저 안경 안 썼는데요?'); return false; }
  P.anim = { k: 'snatch', t: 0, d: 1.0, lock: true }; snatchGlasses(st); return true;
}
function snatchGlasses(st) {
  const g = st.glasses; st.glasses = null; R.scene.attach(g); SFX.whoosh(st.hpos);
  const from = g.position.clone(), hand = () => R.teacher.armR.el.localToWorld(_v.set(0, -.32, -.05));
  tween(.28, (k) => g.position.lerpVectors(from, hand(), ease(k)), () => tween(.3, () => g.position.copy(hand()), () => breakGlasses(g, st)));
}
function breakGlasses(g, st, p0) {
  const p = p0 || g.position.clone(), type = g.userData.type; g.removeFromParent(); hitMark();
  SFX.snap(p); ftext(p, '콰직!', 'snap'); G.shake = Math.max(G.shake, .1);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(R.halfGlass[type === 'ai' ? 1 : 0], R.mV); h.position.copy(p); h.position.x += s * .04; h.castShadow = true;
    addDebris(h, V(s * rand(.8, 2) + rand(-.5, .5), rand(1.5, 3), rand(-1, 1)), V(rand(-15, 15), rand(-15, 15), rand(-15, 15)), .02);
  }
  for (let i = 0; i < 18; i++) R.pfxA.spawn(p.x, p.y, p.z, rand(-2, 2), rand(-1, 2.5), rand(-2, 2), type === 'ai' ? '#55e6ff' : '#fff6c0', rand(.03, .06), rand(.3, .6), 6, 1);
  if (type === 'ai') {
    if (st.cheater && !st.found) { st.found = true; if (G.mode === 'teacher') { G.found++; addCoins(1, st); toast('AI 안경 적발! +1 코인', 'good'); } }
    if (SEATED.has(st.state)) { st.state = 'caught'; removeStars(st); }
    say(st, pick(['아... 들켰다', '죄송합니다ㅠㅠ', '안 돼!!', '제발 한 번만요...']), 3);
    for (let i = 0; i < 26; i++) R.pfxA.spawn(p.x, p.y, p.z, rand(-1.5, 1.5), rand(0, 2), rand(-1.5, 1.5), '#37e0ff', rand(.04, .08), rand(.4, .9), 2, 2);
  } else {
    say(st, pick(['제 안경!! 안 보여요ㅠㅠ', '선생님 그거 그냥 안경인데요?!', '앞이 하나도 안 보여요...']), 3);
    if (G.mode === 'teacher') toast('일반 안경이었습니다...', 'warn');
  }
}
function actPunch(st) {
  SFX.whoosh(P.pos);
  if (!st) { P.anim = { k: 'punch', t: 0, d: .3 }; return; }
  faceTo(st); P.anim = { k: 'punch', t: 0, d: .32, hit: .13, fn: () => stun(st) };
}
function stun(st) {
  if (!SEATED.has(st.state)) return;
  SFX.punch(st.hpos); SFX.gasp(st.hpos); ftext(st.hpos, '퍽!'); G.shake = Math.max(G.shake, .12); starBurst(st.hpos);
  if (st.state !== 'stunned') st.prev = st.state; st.state = 'stunned'; st.stunT = 6; addStars(st);
  say(st, pick(['으윽...', '아야!', '@_@']), 1.6);
  if (st.glasses && st.glasses.userData.type === 'ai') { for (let i = 0; i < 20; i++) R.pfxA.spawn(st.hpos.x, st.hpos.y, st.hpos.z, rand(-1.5, 1.5), rand(0, 2), rand(-1.5, 1.5), '#37e0ff', rand(.03, .06), rand(.3, .6), 4, 1); toast('안경에서 파란 불꽃이 튀었다...?', 'warn'); }
}
function actBat(st) {
  SFX.whoosh(P.pos); if (st) faceTo(st);
  P.anim = { k: 'bat', t: 0, d: .52, hit: .3, lock: true, fn: () => { if (st && SEATED.has(st.state) && Math.hypot(st.x - P.pos.x, st.z - P.pos.z) < WEAPONS.bat.range + .5) batHit(st); } };
}
function batHit(st) {
  SFX.bonk(st.hpos); ftext(st.hpos, '딱!', 'big'); starBurst(st.hpos); R.pfxA.spawn(st.hpos.x, st.hpos.y, st.hpos.z, 0, 0, 0, '#ffffff', .5, .09, 0, 0, 1, 1); G.shake = Math.max(G.shake, .3);
  const dir = V(st.x - P.pos.x, 0, st.z + .14 - P.pos.z).normalize();
  knockOut(st, dir, 2.4, { up: 1.6, tipChair: true });
}
function fireGun(w) {
  const t = aimTarget(); if (t) P.yaw = Math.atan2(-(t.cpos.x - P.pos.x), -(t.cpos.z - P.pos.z));
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const o = V(P.pos.x + fx * .62 + rx * .2, P.pos.y + 1.36, P.pos.z + fz * .62 + rz * .2);
  const dir = t ? V().copy(t.cpos).sub(o).normalize() : V(fx, -.06, fz).normalize();
  dir.x += rand(-w.spread, w.spread); dir.y += rand(-w.spread, w.spread) * .5; dir.z += rand(-w.spread, w.spread); dir.normalize();
  const col = pick(PAINT), m = new THREE.Mesh(R.ballGeo, paintMat(col)); m.position.copy(o); R.scene.add(m);
  G.proj.push({ k: 'paint', m, p: m.position, v: dir.multiplyScalar(w.speed), col, life: 1.6 });
  SFX.shot(o, w.auto); P.anim = { k: 'shoot', t: 0, d: .12 };
  for (let i = 0; i < 3; i++) R.pfxS.spawn(o.x, o.y, o.z, fx * rand(1, 2.5) + rand(-.4, .4), rand(0, .5), fz * rand(1, 2.5) + rand(-.4, .4), '#e8eef4', rand(.08, .14), rand(.25, .45), -.2, 4, 2.5, .45);
  for (let i = 0; i < 4; i++) R.pfxN.spawn(o.x, o.y, o.z, fx * rand(1, 3) + rand(-.5, .5), rand(-.2, .6), fz * rand(1, 3) + rand(-.5, .5), col, rand(.03, .05), rand(.15, .3), 4, 3);
}
function fireRocket(w) {
  const t = aimTarget(); if (t) P.yaw = Math.atan2(-(t.cpos.x - P.pos.x), -(t.cpos.z - P.pos.z));
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const o = V(P.pos.x + fx * .9 + rx * .2, P.pos.y + 1.38, P.pos.z + fz * .9 + rz * .2);
  const dir = t ? V().copy(t.cpos).sub(o).normalize() : V(fx, -.04, fz).normalize();
  const m = M(R.rocketGeo); m.position.copy(o); R.scene.add(m); m.lookAt(_v.copy(o).add(dir));
  const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: R.glowTex, color: new THREE.Color().setRGB(5, 2.6, .9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); fl.scale.setScalar(.45); fl.position.z = -.2; m.add(fl);
  G.proj.push({ k: 'rocket', m, p: m.position, v: dir.multiplyScalar(w.speed), life: 3, hit: t, snd: SFX.rocketLoop(o) });
  SFX.rocket(o); P.anim = { k: 'shoot', t: 0, d: .35 }; G.shake = Math.max(G.shake, .15);
  for (let i = 0; i < 22; i++) R.pfxS.spawn(P.pos.x - fx * .6, P.pos.y + 1.4, P.pos.z - fz * .6, -fx * rand(1, 5) + rand(-1, 1), rand(0, 1), -fz * rand(1, 5) + rand(-1, 1), '#b4aea6', rand(.3, .55), rand(.9, 1.8), -.3, 2, 2.5, .6);
  for (let i = 0; i < 10; i++) R.pfxA.spawn(o.x, o.y, o.z, fx * rand(1, 3), rand(-.3, .3), fz * rand(1, 3), '#fff', rand(.15, .3), rand(.12, .22), 0, 4, 1, 1, 1);
}
function actTackle(st) {
  if (!st) { toast('가까이에 학생이 없어요', 'info'); return false; }
  faceTo(st); SFX.whoosh(P.pos); P.dash = true; P.anim = { k: 'tackle', t: 0, d: .95, lock: true };
  const from = P.pos.clone(), side = P.pos.x < st.x ? -1 : 1, to = V(st.x + side * .62, P.pos.y, st.z + .2);
  tween(.25, (k) => { P.pos.x = lerp(from.x, to.x, k); P.pos.z = lerp(from.z, to.z, k); }, () => {
    if (!SEATED.has(st.state)) { P.dash = false; return; }
    const dir = V(-side, 0, .25).normalize();
    SFX.thud(st.hpos); SFX.punch(st.hpos); SFX.gasp(st.hpos); ftext(st.hpos, '제압!', 'big'); G.shake = Math.max(G.shake, .35);
    knockOut(st, dir, 1.8, { up: 1.3, tipChair: true, cuffs: true });
    tween(.45, null, () => { P.dash = false; });
  });
  return true;
}

// ───────── KO (쓰러짐) ─────────
function knockOut(st, dir, pow, o = {}) {
  if (st.state === 'ko' || st.isPlayer) return;
  st.state = 'ko'; st.landed = false; st.bounce = 0; st.kT = 0; st.flip.visible = false;
  st.fig.rotation.order = 'YXZ'; R.scene.attach(st.fig);
  st.kv = V(dir.x * pow, o.up ?? 2.5, dir.z * pow);
  st.kav = V(dir.z * 3.4 + rand(-.5, .5), rand(-.6, .6), -dir.x * 3.4 + rand(-.5, .5)); hitMark();
  if (st.glasses) {
    const g = st.glasses; st.glasses = null; R.scene.attach(g);
    addDebris(g, V(dir.x * 2 + rand(-1, 1), rand(2, 4), dir.z * 2 + rand(-1, 1)), V(rand(-10, 10), rand(-10, 10), rand(-10, 10)), .03);
  }
  if (o.tipChair && !st.destroyed && st.chair.parent === st.seat) { R.scene.attach(st.chair); addDebris(st.chair, V(dir.x * 2.2, 1.6, dir.z * 2.2), V(rand(-4, 4), rand(-2, 2), rand(-4, 4)), .22, { chair: true }); const cp = st.chair.position; setTimeout(() => SFX.clang(cp), 380); }
  if (o.cuffs) { const c = buildWeapon('tackle'); c.scale.setScalar(.75); c.position.set(0, -.25, 0); st.armR.el.add(c); }
  addStars(st);
  if (st.cheater && !st.found) { st.found = true; if (G.mode === 'teacher') { G.found++; addCoins(1, st); toast('AI 안경 학생 적발! +1 코인', 'good'); } }
  else if (!st.cheater && G.mode === 'teacher') loseHeart(`무고한 학생(${st.name})을 공격했어요!`);
}
function updKO(st, dt) {
  const f = st.fig, k = Math.min(1, dt * 7); st.kT += dt;
  if (!st.landed) {
    st.kv.y -= 16 * dt; f.position.addScaledVector(st.kv, dt);
    f.rotation.x += st.kav.x * dt; f.rotation.y += st.kav.y * dt; f.rotation.z += st.kav.z * dt;
    if (Math.abs(f.position.x) > 6.6) { f.position.x = Math.sign(f.position.x) * 6.6; st.kv.x *= -.3; }
    if (f.position.z < -7.6 || f.position.z > 7.2) { f.position.z = clamp(f.position.z, -7.6, 7.2); st.kv.z *= -.3; }
    if (f.position.y < .2 && st.kv.y < 0) {
      for (let i = 0; i < 12; i++) R.pfxS.spawn(f.position.x + rand(-.3, .3), .06, f.position.z + rand(-.3, .3), rand(-1.4, 1.4), rand(.1, .6), rand(-1.4, 1.4), '#c2b49c', rand(.2, .35), rand(.8, 1.4), -.1, 2.5, 2, .5);
      if (st.kv.y < -4 && st.bounce < 1) { st.kv.y *= -.3; st.kv.x *= .5; st.kv.z *= .5; st.bounce++; f.position.y = .2; SFX.thud(f.position); }
      else { st.landed = true; SFX.thud(f.position); f.rotation.x = wrapA(f.rotation.x); f.rotation.z = wrapA(f.rotation.z); st.lyX = f.rotation.x >= 0 ? PI / 2 : -PI / 2; st.slide = V(st.kv.x * .4, 0, st.kv.z * .4); }
    }
  } else {
    f.rotation.x += (st.lyX - f.rotation.x) * k; f.rotation.z += (0 - f.rotation.z) * k; f.position.y += (.13 - f.position.y) * k;
    st.slide.multiplyScalar(Math.max(0, 1 - dt * 5)); f.position.addScaledVector(st.slide, dt);
  }
  L(st.thigh.rotation, 'x', .12, k); L(st.shin.rotation, 'x', -.1, k); L(st.spine.rotation, 'x', 0, k); L(st.head.rotation, 'x', .1, k); L(st.head.rotation, 'y', .5, k);
  L(st.armL.sh.rotation, 'x', .3, k); L(st.armL.sh.rotation, 'z', 1.2, k); L(st.armL.el.rotation, 'x', .4, k);
  L(st.armR.sh.rotation, 'x', .3, k); L(st.armR.sh.rotation, 'z', -1.2, k); L(st.armR.el.rotation, 'x', .4, k);
}
function addStars(st) {
  return; const g = new THREE.Group();
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(R.starGeo, R.starMat); const a = i / 3 * 2 * PI; s.position.set(Math.cos(a) * .16, 0, Math.sin(a) * .16); g.add(s); }
  st.stars = g; R.scene.add(g);
}
function removeStars(st) { if (st.stars) { R.scene.remove(st.stars); st.stars = null; } }
function starBurst(p) { for (let i = 0; i < 8; i++) R.pfxS.spawn(p.x, p.y, p.z, rand(-.8, .8), rand(-.2, .6), rand(-.8, .8), '#e8e2da', rand(.08, .14), rand(.3, .6), 0, 3, 2, .35); }

// ───────── 투사체 ─────────
function deskHit(x, z) { for (const o of R.obstacles) if (o.on && o.dx0 !== undefined && x > o.dx0 && x < o.dx1 && z > o.dz0 && z < o.dz1) return true; return false; }
function updProj(dt) {
  for (let i = G.proj.length - 1; i >= 0; i--) {
    const pr = G.proj[i]; pr.life -= dt;
    const steps = Math.max(1, Math.ceil(pr.v.length() * dt / .1)), h = dt / steps; let hit = null, end = false, surf = 'y';
    for (let s = 0; s < steps && !end; s++) {
      if (pr.k === 'paint') pr.v.y -= 2.5 * h;
      pr.p.addScaledVector(pr.v, h);
      for (const st of R.students) { if (st.state === 'ko' || st.isPlayer) continue; if (pr.p.distanceToSquared(st.cpos) < .075 || pr.p.distanceToSquared(st.hpos) < .03) { hit = st; end = true; break; } }
      if (end) break;
      if (pr.p.y <= .02) { end = true; pr.p.y = 0; }
      else if (pr.p.x < -6.95) { end = true; surf = '+x'; pr.p.x = -7; } else if (pr.p.x > 6.95) { end = true; surf = '-x'; pr.p.x = 7; }
      else if (pr.p.z < -7.95) { end = true; surf = '+z'; pr.p.z = -8; } else if (pr.p.z > 7.9) { end = true; surf = '-z'; pr.p.z = 8; }
      else if (pr.p.y < .78 && pr.p.y > .6 && deskHit(pr.p.x, pr.p.z)) { end = true; pr.p.y = .76; }
      else if (pr.p.y < .84 && Math.abs(pr.p.x) < .92 && pr.p.z > -6.42 && pr.p.z < -5.58) { end = true; pr.p.y = .826; }
    }
    if (pr.k === 'rocket') {
      pr.m.lookAt(_v.copy(pr.p).add(pr.v));
      const b = _v2.copy(pr.v).normalize().multiplyScalar(-.2).add(pr.p);
      for (let q = 0; q < 2; q++) R.pfxS.spawn(b.x, b.y, b.z, rand(-.3, .3), rand(-.1, .4), rand(-.3, .3), '#d2ccc4', rand(.16, .26), rand(1.2, 2), -.25, 1.2, 3, .5);
      R.pfxA.spawn(b.x, b.y, b.z, rand(-.6, .6), rand(-.6, .6), rand(-.6, .6), '#fff', rand(.18, .28), rand(.08, .16), 0, 2, 1, 1, 1);
      if (pr.snd) pr.snd.set(pr.p);
    }
    if (end || pr.life <= 0) { R.scene.remove(pr.m); G.proj.splice(i, 1); if (pr.snd) pr.snd.stop(); if (pr.k === 'paint') paintImpact(pr, hit, surf); else explode(pr.p.clone(), hit); }
  }
}
function paintImpact(pr, hit, surf) {
  const p = pr.p, col = pr.col; SFX.splat(p);
  for (let i = 0; i < 26; i++) R.pfxN.spawn(p.x, p.y, p.z, rand(-2, 2) - pr.v.x * .04, rand(.5, 3), rand(-2, 2) - pr.v.z * .04, col, rand(.03, .07), rand(.5, .9), 9, .5);
  if (hit) {
    ftext(hit.hpos, '철퍽!');
    const s = new THREE.Mesh(R.spotGeo, paintMat(col)); s.position.set(rand(-.1, .1), rand(.15, .4), -.11); s.scale.set(rand(.8, 1.4), rand(.8, 1.4), .35); s.userData.paint = true; hit.spine.add(s);
    addDecal(V(hit.x + rand(-.6, .6), 0, hit.z + rand(-.1, .9)), rand(.15, .3), col);
    if (!hit.destroyed) addDecal(V(hit.x + rand(-.3, .3), .76, hit.z - .36 + rand(-.2, .2)), rand(.06, .12), col);
    knockOut(hit, V(pr.v.x, 0, pr.v.z).normalize(), 1.8, { up: 1.2, tipChair: Math.random() < .6 });
  } else addDecal(V(p.x, p.y, p.z), rand(.1, .2), col, surf);
}
function explode(p, hit) {
  SFX.boom(p); G.shake = Math.max(G.shake, .9); R.flashL.position.set(p.x, p.y + .4, p.z); R.flashL.intensity = 90;
  const fb = new THREE.Mesh(R.sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); fb.position.copy(p); R.scene.add(fb);
  tween(.5, (k) => { fb.scale.setScalar(.3 + k * 2.2); fb.material.opacity = .95 * (1 - k); fb.material.color.setHSL(.1 - .08 * k, 1, .6 - .25 * k); }, () => { R.scene.remove(fb); fb.material.dispose(); });
  const rg = new THREE.Mesh(R.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); rg.rotation.x = -PI / 2; rg.position.set(p.x, .05, p.z); R.scene.add(rg);
  tween(.6, (k) => { rg.scale.setScalar(.3 + k * 4.5); rg.material.opacity = 1 - k; }, () => { R.scene.remove(rg); rg.material.dispose(); });
  const rv = () => { const a = rand(0, 2 * PI), u = rand(-.3, 1); const c = Math.sqrt(1 - u * u); return [Math.cos(a) * c, u, Math.sin(a) * c]; };
  R.pfxA.spawn(p.x, p.y + .3, p.z, 0, 0, 0, '#ffffff', 4, .2, 0, 0, .6, 1, 1);
  for (let i = 0; i < 80; i++) { const [x, y, z] = rv(), s = rand(1.5, 6); R.pfxA.spawn(p.x + x * .2, p.y + .3 + y * .2, p.z + z * .2, x * s, y * s + 1.2, z * s, '#fff', rand(.5, 1.15), rand(.45, 1.05), -1.4, 3, 1.3, 1, 1, rand(-2, 2)); }
  for (let i = 0; i < 70; i++) { const [x, y, z] = rv(), s = rand(6, 15); R.pfxA.spawn(p.x, p.y + .2, p.z, x * s, Math.abs(y) * s, z * s, '#ffd27a', rand(.04, .08), rand(.6, 1.6), 9, .4); }
  for (let i = 0; i < 70; i++) { const [x, y, z] = rv(), s = rand(3, 8); R.pfxN.spawn(p.x, p.y + .3, p.z, x * s, Math.abs(y) * s + 2, z * s, pick(PAINT), rand(.05, .08), rand(2, 3.2), 4, 1.8); }
  for (let i = 0; i < 50; i++) { const [x, y, z] = rv(), s = rand(.5, 2.5); R.pfxS.spawn(p.x + x * .4, p.y + .4 + Math.abs(y) * .5, p.z + z * .4, x * s, Math.abs(y) * s + 1, z * s, pick(['#2e2a26', '#3d3833', '#4a4540', '#5a544e']), rand(.9, 1.7), rand(2.5, 4.5), -.35, 1.3, 2.2, .8); }
  for (let i = 0; i < 36; i++) { const a = rand(0, 6.28), s = rand(4, 8); R.pfxS.spawn(p.x, .12, p.z, Math.cos(a) * s, rand(0, .5), Math.sin(a) * s, '#8d8170', rand(.4, .7), rand(1.2, 2), 0, 3, 2.5, .6); }
  addDecal(V(p.x, 0, p.z), rand(.9, 1.2), '#1a1410', 'y', .75);
  let tgt = hit;
  if (!tgt) for (const st of R.students) if (!st.destroyed && Math.abs(p.x - st.x) < .7 && p.z > st.z - 1 && p.z < st.z + .7) { tgt = st; break; }
  if (tgt && !tgt.isPlayer) {
    if (!tgt.destroyed) destroySeat(tgt, p);
    if (SEATED.has(tgt.state)) knockOut(tgt, V(tgt.x - P.pos.x, 0, tgt.z - P.pos.z).normalize(), 3.5, { up: 7.5, soot: true });
  }
  for (const st of R.students) {
    if (st === tgt || !SEATED.has(st.state)) continue;
    if (Math.hypot(st.x - p.x, st.z - p.z) < 4.5) { st.flinchT = .9; if (Math.random() < .5) { say(st, pick(['으악!!', '꺄악!', '뭐야?!', '헐...', '깜짝이야!']), 1.6); setTimeout(() => SFX.gasp(st.hpos), rand(100, 500)); } }
  }
  flash('#fff', .35);
}
function destroySeat(st, p) {
  st.destroyed = true; st.obs.on = false;
  st.desk.visible = false; st.paper.visible = false; st.omr.visible = false; st.flip.visible = false;
  const chairHere = st.chair.parent === st.seat; if (chairHere) st.chair.visible = false;
  const parts = [[.45, .035, .3, -.22, .74, -.51, '#d8b98a'], [.45, .035, .3, .22, .74, -.51, '#d8b98a'], [.45, .035, .3, -.22, .74, -.21, '#d8b98a'], [.45, .035, .3, .22, .74, -.21, '#c9a97a'],
    [.03, .72, .03, -.42, .36, -.63, '#8a8f98'], [.03, .72, .03, .42, .36, -.63, '#8a8f98'], [.03, .72, .03, -.42, .36, -.09, '#8a8f98'], [.03, .72, .03, .42, .36, -.09, '#8a8f98'], [.84, .02, .5, 0, .6, -.34, '#9aa0a8']];
  if (chairHere) parts.push([.42, .03, .4, 0, .45, .16, '#c9a274'], [.42, .28, .025, 0, .74, .36, '#c9a274'], [.025, .45, .025, -.19, .22, .16, '#8a8f98'], [.025, .45, .025, .19, .22, .16, '#8a8f98']);
  for (const [w, h, d, x, y, z, c] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), c === '#c9a274' ? R.mChairW : (c === '#8a8f98' || c === '#9aa0a8') ? R.mMetal : R.mDesk); m.castShadow = true; m.position.set(st.x + x, y, st.z + z);
    const v = V(m.position.x - p.x, 0, m.position.z - p.z); if (v.lengthSq() < .01) v.set(rand(-1, 1), 0, rand(-1, 1)); v.normalize().multiplyScalar(rand(3, 8)); v.y = rand(3, 7.5);
    addDebris(m, v, V(rand(-14, 14), rand(-14, 14), rand(-14, 14)), (w + h + d) / 6);
  }
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(R.paperGeo, R.pageUsedMat); m.scale.setScalar(rand(.6, .9)); m.position.set(st.x + rand(-.2, .2), .8, st.z - .36 + rand(-.2, .2)); m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    const a = rand(0, 2 * PI), s = rand(1, 4); addDebris(m, V(Math.cos(a) * s, rand(3, 6.5), Math.sin(a) * s), V(rand(-6, 6), rand(-6, 6), rand(-6, 6)), 0, { paper: true });
  }
}
function addDebris(m, v, av, r, o = {}) {
  if (!m.parent) R.scene.add(m);
  R.debris.push({ m, v, av, r, paper: !!o.paper, chair: !!o.chair, rest: false, t: 0, ph: rand(0, 6) });
  if (R.debris.length > 240) R.scene.remove(R.debris.shift().m);
}
function updDebris(dt) {
  for (const d of R.debris) {
    if (d.rest) continue; d.t += dt; const m = d.m;
    if (d.paper) {
      d.v.y = Math.max(d.v.y - 9 * dt, -.55); d.v.x *= 1 - dt * 1.2; d.v.z *= 1 - dt * 1.2;
      m.position.addScaledVector(d.v, dt); m.position.x += Math.sin(d.t * 3 + d.ph) * dt * .5; m.rotation.x += d.av.x * dt * .3; m.rotation.z += Math.sin(d.t * 2 + d.ph) * dt * 2;
      const gy = groundY(m.position.x, m.position.z) + .004; if (m.position.y <= gy) { m.position.y = gy; m.rotation.set(-PI / 2, 0, rand(0, 6)); d.rest = true; }
      continue;
    }
    d.v.y -= 16 * dt; m.position.addScaledVector(d.v, dt);
    m.rotation.x += d.av.x * dt; m.rotation.y += d.av.y * dt; m.rotation.z += d.av.z * dt;
    if (Math.abs(m.position.x) > 6.9) { m.position.x = Math.sign(m.position.x) * 6.9; d.v.x *= -.4; }
    if (m.position.z < -7.9 || m.position.z > 7.4) { m.position.z = clamp(m.position.z, -7.9, 7.4); d.v.z *= -.4; }
    if (m.position.y > 3.1) { m.position.y = 3.1; d.v.y *= -.3; }
    const gy = (d.chair ? 0 : groundY(m.position.x, m.position.z)) + d.r;
    if (m.position.y < gy) {
      m.position.y = gy; if (d.v.y < 0) d.v.y *= -.35; d.v.x *= .65; d.v.z *= .65; d.av.multiplyScalar(.6);
      if (Math.abs(d.v.y) < .7 && d.v.x * d.v.x + d.v.z * d.v.z < .25) {
        d.rest = true; const q = PI / 2; m.rotation.x = Math.round(m.rotation.x / q) * q; m.rotation.z = Math.round(m.rotation.z / q) * q;
        if (d.chair) { m.position.y = 0; if (Math.abs(wrapA(m.rotation.x)) > .1 || Math.abs(wrapA(m.rotation.z)) > .1) m.position.y = .22; }
      }
    }
  }
}

// ───────── 학생 애니메이션 ─────────
function nextAct(st, near) {
  if (st.wantFlip) { st.wantFlip = false; if (Math.random() < .6) SFX.page(st.cpos); st.act = 'flip'; st.actT = .85; st.flipT = 0; st.flip.visible = true; st.flip.rotation.z = 0; st.page++; drawPage(st, G.subj, st.page); return; }
  const r = Math.random();
  if (st.cheater && !st.found && !near && st.scared <= 0 && r < .32) { st.act = 'look'; st.actT = rand(1.2, 2.5); st.burstNext = true; return; }
  if (st.burstNext) { st.burstNext = false; st.act = 'write'; st.actT = rand(1.5, 3); st.burst = st.actT; return; }
  if (r < .68) { st.act = 'write'; st.actT = rand(2, 6); } else if (r < .94) { st.act = 'think'; st.actT = rand(1, 2.6); } else { st.act = 'stretch'; st.actT = 1.3; }
}
function animSeated(st, dt, tp) {
  const t = st.t + st.ph, k = Math.min(1, dt * 7);
  const dx = tp.x - st.x, dz = tp.z - (st.z + .14); st.near = dx * dx + dz * dz < 2.4 * 2.4;
  if (st.isPlayer) { st.act = G.writeT > 0 || G.solvingT > 0 ? 'write' : (G.aiOpen ? 'look' : 'think'); }
  else if (st.state === 'exam' && G.examOn) { st.actT -= dt; if (st.actT <= 0) nextAct(st, st.near); }
  else if (st.act !== 'flip') st.act = 'rest';
  if (st.scared > 0) st.scared -= dt;
  let lean = -.12, hx = -.45, hy = 0, hz = 0, rsx = .9, rsz = -.1, rex = .7, lsx = .85, lsz = .12, lex = .75;
  switch (st.act) {
    case 'write':
      if (!st.isPlayer && Math.random() < dt * (st.burst > 0 ? 6 : 2.5) && R.cam.position.distanceToSquared(st.cpos) < 30) SFX.scratch(st.cpos);
      rsz = -.1 + Math.sin(t * 6) * .05; rex = .7 + Math.sin(t * 18) * .07; hy = Math.sin(t * .8) * .06;
      if (!st.isPlayer || G.writeT > 0 || G.solvingT > 0) { st.inkAcc += dt * (st.burst > 0 ? 26 : 9); if (st.burst > 0) st.burst -= dt; while (st.inkAcc >= 1) { st.inkAcc--; inkStroke(st); } }
      break;
    case 'think': hx = -.15; hz = Math.sin(t * 1.1) * .12; rsx = 1.35; rex = 2.0; rsz = -.25; break;
    case 'look': hx = .08; hy = .4; hz = -.1; lean = -.05; break;
    case 'stretch': lean = .12; hx = .3; rsx = 2.8; lsx = 2.8; rex = .25; lex = .25; rsz = .2; lsz = -.2; break;
    case 'flip': { st.flipT += dt; const f = Math.min(1, st.flipT / .6); st.flip.rotation.z = ease(f) * PI; if (f >= 1) st.flip.visible = false; lsx = 1.05; lsz = .45 - f * .3; lex = .6; break; }
    case 'rest': hx = -.08; lean = -.02; rsx = .8; rex = .8; break;
  }
  if (st.state === 'caught') { lean = -.35; hx = -.7; rsx = 1.7; lsx = 1.7; rex = 2.1; lex = 2.1; rsz = -.35; lsz = .35; lean += Math.sin(st.t * 14) * .025; if (Math.random() < dt * 1.5) R.pfxN.spawn(st.hpos.x + rand(-.05, .05), st.hpos.y, st.hpos.z - .1, 0, -.3, 0, '#7fd0ff', .03, .6, 3); }
  if (st.flinchT > 0) { st.flinchT -= dt; rsx = lsx = 2.2; rex = lex = 1.6; lean = .12; hx = .2; }
  if (st.lookT > 0) { st.lookT -= dt; hy = clamp(wrapA(Math.atan2(-dx, -dz)), -1.1, 1.1); hx = 0; lean = -.02; }
  lean += Math.sin(t * 1.6) * .012;
  L(st.spine.rotation, 'x', lean, k); L(st.head.rotation, 'x', hx, k); L(st.head.rotation, 'y', hy, k); L(st.head.rotation, 'z', hz, k);
  L(st.armR.sh.rotation, 'x', rsx, k); L(st.armR.sh.rotation, 'z', rsz, k); L(st.armR.el.rotation, 'x', rex, k);
  L(st.armL.sh.rotation, 'x', lsx, k); L(st.armL.sh.rotation, 'z', lsz, k); L(st.armL.el.rotation, 'x', lex, k);
}
function updLED(st, dt) {
  const g = st.glasses; if (!g || !g.userData.led) return;
  let on = false;
  if (!st.found && (st.state === 'exam' || st.state === 'endsit')) {
    if (st.isPlayer) on = G.aiOpen || G.solvingT > 0;
    else if (st.act === 'look') on = Math.sin(st.t * 14) > -.2;
    else { st.blinkT -= dt; if (st.blinkT <= 0) { st.blinkT = rand(3, 7); st.blinkOn = st.near ? 0 : .3; } if (st.blinkOn > 0) { st.blinkOn -= dt; on = true; } }
    if (st.scared > 0 && !st.isPlayer) on = false;
  }
  if (G.hack.find && st.cheater && !st.found) on = true;
  if (on !== st.ledState) { st.ledState = on; g.userData.led.material = on ? R.ledOn : R.ledOff; g.userData.glow.visible = on; g.userData.lens.material = on ? R.lensAIOn : R.lensAI; }
}
const texQ = { i: 0 };
function updStudents(dt) {
  const tp = R.teacher.root.position;
  if (G.examOn && R.students.length && Math.random() < dt * .12) { const s = pick(R.students); if (SEATED.has(s.state) && !s.isPlayer) (Math.random() < .5 ? SFX.cough : SFX.creak).call(SFX, s.cpos); }
  for (const st of R.students) {
    st.t += dt;
    if (st.state === 'ko') updKO(st, dt);
    else if (st.state === 'stunned') {
      const k = Math.min(1, dt * 6); st.stunT -= dt;
      L(st.spine.rotation, 'x', -.55, k); L(st.head.rotation, 'x', -.75, k); L(st.head.rotation, 'y', .3, k);
      L(st.armR.sh.rotation, 'x', .95, k); L(st.armR.el.rotation, 'x', .5, k); L(st.armL.sh.rotation, 'x', .95, k); L(st.armL.el.rotation, 'x', .5, k);
      if (st.stunT <= 0) { st.state = G.phase === 'end' ? 'endsit' : (st.prev || 'exam'); removeStars(st); say(st, '어... 뭐지?', 1.5); }
    } else animSeated(st, dt, tp);
    st.spine.localToWorld(st.cpos.set(0, .27, 0)); st.head.localToWorld(st.hpos.set(0, .13, 0));
    updLED(st, dt);
    if (st.stars) { st.stars.position.copy(st.hpos); st.stars.position.y += .2; st.stars.rotation.y += dt * 4; }
    let rim = null;
    if (G.mode === 'teacher' && G.phase === 'end') rim = st.cheater ? (st.found ? '#ff8a20' : '#ff2236') : '#1fe06a';
    else if (G.hack.find && st.cheater && !st.found && !st.isPlayer && st.state !== 'ko') rim = '#ff2236';
    if (rim !== (st.rimC || null)) { st.rimC = rim; setRim(st, rim); }
  }
  // 시험지 텍스처 업로드 (프레임당 최대 5장)
  const n = R.students.length; let up = 0;
  for (let j = 0; j < n && up < 5; j++) { const st = R.students[(texQ.i + j) % n]; if (st.dirty) { st.ptex.needsUpdate = true; st.dirty = false; up++; } }
  texQ.i = (texQ.i + 5) % Math.max(1, n);
}

// ───────── 학생 모드 ─────────
function nextQuestion() {
  G.qNo++; G.q = makeQuestion(G.subj, G.qNo); G.qStart = G.T; G.qLock = false;
  $('exSubj').textContent = `${G.subj} 영역`; $('exNo').textContent = `${G.qNo}번`; $('exQ').textContent = G.q.text; $('exAns').textContent = '';
  const box = $('exChoices'); box.innerHTML = '';
  G.q.choices.forEach((c, i) => { const b = document.createElement('button'); b.className = 'ch'; b.innerHTML = `<em>${'①②③④⑤'[i]}</em><span>${esc(c)}</span>`; b.onclick = () => answer(i); box.appendChild(b); });
  $('exScore').textContent = `맞힌 문제 ${G.correct}/${G.answered}`;
}
function answer(i) {
  if (G.qLock || G.phase !== 'exam') return;
  G.qLock = true; $('exChoices').children[i].classList.add('mark'); SFX.click(); G.answered++; if (i === G.q.ans) G.correct++; G.writeT = .8;
  setTimeout(() => { if (G.phase === 'exam' && G.mode === 'student') nextQuestion(); }, 700);
}
function solveAI() {
  if (G.qLock || G.phase !== 'exam') return;
  SFX.init(); const el = G.T - G.qStart, w = watching(); let add = w ? 14 : 4;
  if (el < 6) { add += w ? 30 : 20; toast('너무 빨리 풀었다! 감독관이 이상하게 쳐다본다', 'bad'); if (Math.hypot(P.pos.x - G.me.x, P.pos.z - G.me.z) < 7) npcSay(pick(['...?', '방금 뭐지?', '(유심히 본다)'])); }
  G.susp = Math.min(100, G.susp + add); G.qLock = true; G.solvingT = 1.8;
  aiMsg('ai', `${G.q.subj} ${G.q.no}번 분석 중...`);
  setTimeout(() => {
    if (G.mode !== 'student' || G.phase !== 'exam') return;
    const C = '①②③④⑤'[G.q.ans]; typeInto($('exAns'), `답: ${C} ${G.q.choices[G.q.ans]}`);
    $('exChoices').children[G.q.ans].classList.add('mark', 'ai'); G.answered++; G.correct++; G.writeT = 1.4;
    aiMsg('ai', `정답 ${C} 작성 완료. ${G.q.exp}`);
    setTimeout(() => { if (G.phase === 'exam' && G.mode === 'student') nextQuestion(); }, 1500);
  }, 550);
}
function typeInto(el, txt) { let i = 0; el.textContent = ''; const iv = setInterval(() => { el.textContent = txt.slice(0, ++i); SFX.type(); if (i >= txt.length) clearInterval(iv); }, 35); }
function aiMsg(who, txt) {
  const d = document.createElement('div'); d.className = 'am ' + who; $('aiLog').appendChild(d);
  if (who === 'ai') { let i = 0; const iv = setInterval(() => { d.textContent = txt.slice(0, i += 2); $('aiLog').scrollTop = 1e6; if (i >= txt.length) clearInterval(iv); }, 18); } else d.textContent = txt;
  $('aiLog').scrollTop = 1e6;
}
function aiSend() {
  const t = $('aiIn').value.trim(); if (!t) return; $('aiIn').value = ''; aiMsg('me', t);
  if (G.mode === 'student' && G.phase === 'exam') G.susp = Math.min(100, G.susp + (watching() ? 10 : 2));
  setTimeout(() => aiMsg('ai', aiAnswer(t, G.mode === 'student' && G.phase === 'exam' ? G.q : null)), 450);
}
function openAI() { G.aiOpen = true; show('aiPanel', true); document.body.classList.add('aion'); SFX.click(); }
function closeAI() { G.aiOpen = false; show('aiPanel', false); document.body.classList.remove('aion'); }
function watching() {
  const me = G.me; if (!me) return false; const dx = me.x - P.pos.x, dz = me.z + .14 - P.pos.z, d = Math.hypot(dx, dz);
  if (d > 7) return false; return d < 1.6 || (dx * -Math.sin(P.yaw) + dz * -Math.cos(P.yaw)) / d > .55;
}
function updStudentMode(dt) {
  const w = watching(); G.watch = w;
  if (G.phase === 'exam' && !G.catching) {
    if (G.aiOpen) G.susp += (w ? 16 : 2.5) * dt; else G.susp -= 3 * dt;
    G.susp = clamp(G.susp, 0, 100);
    if (G.susp >= 100) { G.catching = true; SFX.alarm(P.pos); npcSay('잠깐, 거기 학생!'); toast('감독관이 다가온다!', 'bad'); }
  }
  if (G.solvingT > 0) G.solvingT -= dt; if (G.writeT > 0) G.writeT -= dt;
  npcTeacher(dt);
  const me = G.me, eye = _v.set(me.x, 1.24, me.z + .1), y = G.sv.yaw, p = G.sv.pitch;
  setCam(eye, _v2.set(eye.x - Math.sin(y) * Math.cos(p), eye.y + Math.sin(p), eye.z - Math.cos(y) * Math.cos(p)), dt);
}
function npcTeacher(dt) {
  let spd = 0;
  if (G.phase === 'exam') {
    if (P.anim) { P.anim.t += dt; if (P.anim.t >= P.anim.d) P.anim = null; }
    if (N.wait > 0) { N.wait -= dt; if (N.look !== null) P.yaw = lerpA(P.yaw, N.look, Math.min(1, dt * 3)); }
    else {
      const tx = GX[N.tx], tz = GZ[N.tz], dx = tx - P.pos.x, dz = tz - P.pos.z, d = Math.hypot(dx, dz);
      const sp = G.catching ? 2.6 : G.susp > 60 ? 1.8 : 1.15;
      if (d < .05) { N.xi = N.tx; N.zi = N.tz; arrive(); }
      else { const m = Math.min(d, sp * dt); P.pos.x += dx / d * m; P.pos.z += dz / d * m; P.yaw = lerpA(P.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 8)); spd = sp; }
    }
  }
  R.teacher.root.position.set(P.pos.x, 0, P.pos.z); R.teacher.root.rotation.y = P.yaw; poseTeacher(dt, spd);
}
function arrive() {
  const me = G.me, gx = GX.reduce((b, x, i) => (Math.abs(x - me.x) < Math.abs(GX[b] - me.x) ? i : b), 0), gz = GZ.reduce((b, z, i) => (Math.abs(z - me.z) < Math.abs(GZ[b] - me.z) ? i : b), 0);
  const yawMe = Math.atan2(-(me.x - P.pos.x), -(me.z - P.pos.z));
  if (G.catching || G.susp > 55) {
    if (N.xi !== gx) { N.tx = N.xi + Math.sign(gx - N.xi); N.tz = N.zi; }
    else if (N.zi !== gz) { N.tz = N.zi + Math.sign(gz - N.zi); N.tx = N.xi; }
    else if (G.catching) { catchPlayer(); N.wait = 2.5; N.look = yawMe; }
    else { N.wait = 2; N.look = yawMe; }
    return;
  }
  if (Math.random() < .35) { N.wait = rand(1, 3); N.look = G.susp > 35 ? yawMe : rand(-PI, PI); }
  const nb = []; if (N.xi > 0) nb.push([N.xi - 1, N.zi]); if (N.xi < 6) nb.push([N.xi + 1, N.zi]); if (N.zi > 0) nb.push([N.xi, N.zi - 1]); if (N.zi < 4) nb.push([N.xi, N.zi + 1]);
  [N.tx, N.tz] = pick(nb);
  if (Math.random() < .3) {
    const c = R.students.find((s) => s.cheater && !s.found && !s.isPlayer && s.state === 'exam' && s.glasses && Math.hypot(s.x - P.pos.x, s.z + .14 - P.pos.z) < 1.9);
    if (c) { faceTo(c); P.anim = { k: 'snatch', t: 0, d: 1 }; npcSay('거기 학생! 안경 벗어요!'); snatchGlasses(c); N.wait = 2.2; N.look = P.yaw; }
  }
}
function catchPlayer() {
  G.catching = false; G.hearts--; G.susp = 25; closeAI(); SFX.hurt(); flash('#ff2030', .45); updHUD();
  if (G.hearts <= 0) { npcSay('부정행위 적발! 퇴실하세요.'); gameOver('AI 안경 부정행위가 적발되어 퇴실 조치되었습니다.'); return; }
  npcSay(pick(['지금 뭐 하는 거죠? 경고입니다!', '한 번만 더 걸리면 퇴실이에요!']), 3); toast('부정행위 경고! 하트 -1', 'bad');
}

// ───────── 상점 (감독관 책상) ─────────
function openShop() {
  if (G.mode !== 'teacher' || G.phase === 'lunch') return;
  G.shop = true; P.armed = false; IN.atk = false; resetJoy(); exitLock(); P.pos.set(CHAIR.x, 0, CHAIR.z); G.shopSel = null;
  R.teacher.root.visible = false; document.body.classList.add('shop'); show('shopExit', true); G.camBlend = 0; G.shopLook = { yaw: PI, pitch: -.42 }; renderShop(); SFX.creak(P.pos);
}
function closeShop() {
  G.shop = false; G.shopSel = null; P.pos.set(CHAIR.x + .75, 0, CHAIR.z); P.yaw = P.cy = PI; P.pitch = -.12;
  document.body.classList.remove('shop'); show('shopExit', false); G.camBlend = 0; renderHotbar(); renderShop();
}
function shopCam(dt) {
  const e = _v.set(0, 1.4, -7.25), y = G.shopLook.yaw, p = G.shopLook.pitch;
  setCam(e, _v2.set(e.x - Math.sin(y) * Math.cos(p), e.y + Math.sin(p), e.z - Math.cos(y) * Math.cos(p)), dt, 9);
}
function renderShop() { for (const id of SHOP_ORDER) drawTag(id, { price: WEAPONS[id].price, owned: G.owned.includes(id), eq: curWeapon() === id, sel: G.shop && G.shopSel === id }); }
function shopTap(id) {
  SFX.click();
  if (G.shopSel !== id) { G.shopSel = id; renderShop(); return; }
  const w = WEAPONS[id];
  if (G.owned.includes(id)) { G.sel = G.slots.indexOf(id); setHeld(id); SFX.buy(); }
  else if (!G.hack.money && G.coins < w.price) { toast(`코인이 ${w.price - G.coins}개 부족해요`, 'bad'); SFX.hurt(); }
  else { if (!G.hack.money) G.coins -= w.price; G.owned.push(id); save(); rebuildSlots(); G.sel = G.slots.indexOf(id); setHeld(id); SFX.buy(); updHUD(); }
  renderShop();
}
function shopPick(e) {
  const rc = new THREE.Raycaster(), m = new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); rc.setFromCamera(m, R.cam);
  const hit = rc.intersectObjects([...Object.values(R.shopItems), ...Object.values(R.tags).map((t) => t.tag)], true)[0];
  if (hit) { let o = hit.object; while (o && !o.userData.k) o = o.parent; if (o) shopTap(o.userData.k); }
}

// ───────── 1인칭 (감독관 시점) ─────────
const isFP = () => G.mode === 'teacher' && G.settings.view !== 'tp';
const _f = V(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _a = V(), _b = V(), _c = V(), _d = V(), _t = V();
const camFwd = (o) => o.set(0, 0, -1).applyQuaternion(R.cam.quaternion);
function fpCam(dt) {
  G.camBlend = Math.min(1, G.camBlend + dt * 2);
  const by = Math.sin(P.bobT * 2) * .022 * P.bobA, tp = _t.set(P.pos.x + Math.cos(P.bobT) * .012 * P.bobA, P.pos.y + 1.62 + by - (P.dash ? .3 : 0), P.pos.z);
  _q.setFromEuler(_eu.set(P.pitch + P.kick, P.cy, 0, 'YXZ'));
  if (G.camBlend < 1) { const a = 1 - Math.exp(-9 * dt); camPos.lerp(tp, a); R.cam.quaternion.slerp(_q, a); } else { camPos.copy(tp); R.cam.quaternion.copy(_q); }
  R.cam.position.copy(camPos);
  if (G.shake > 0) { const s = G.shake * .05; R.cam.position.x += rand(-s, s); R.cam.position.y += rand(-s, s); }
  camLook.copy(camPos).add(camFwd(_f));
}
const VH = { t: 0 };
function viewHit(range, assist, seatedOnly) {
  const o = R.cam.position, f = camFwd(_f); let best = null, bt = 1e9;
  for (const st of R.students) {
    if (st.isPlayer || st.state === 'ko' || (seatedOnly && !SEATED.has(st.state))) continue;
    for (const [p, r] of [[st.hpos, .13], [st.cpos, .24]]) { _d.copy(p).sub(o); const t = _d.dot(f); if (t < .1 || t > range) continue; if (_d.addScaledVector(f, -t).length() < r + assist && t < bt) { bt = t; best = st; } }
  }
  VH.t = bt; return best;
}
function hitMark() { const x = $('xhair'); x.classList.remove('hit'); void x.offsetWidth; x.classList.add('hit'); }
function exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
function fireFP(w, id) {
  const mz = R.vm.wpn[id].userData.muzzle; mz.getWorldPosition(_a); const o = R.cam.localToWorld(_a.clone()), f = camFwd(V());
  const hit = viewHit(40, 0), far = f.y < -.01 ? Math.min(20, (R.cam.position.y - .02) / -f.y) : 20, dist = hit ? VH.t : far;
  const dir = R.cam.position.clone().addScaledVector(f, dist).sub(o).normalize(), sp = w.spread || 0;
  dir.x += rand(-sp, sp); dir.y += rand(-sp, sp) * .5; dir.z += rand(-sp, sp); dir.normalize();
  if (w.kind === 'gun') {
    const col = pick(PAINT), m = new THREE.Mesh(R.ballGeo, paintMat(col)); m.position.copy(o); R.scene.add(m);
    G.proj.push({ k: 'paint', m, p: m.position, v: dir.multiplyScalar(w.speed), col, life: 1.6 });
    SFX.shot(o, w.auto); VM.rec = w.auto ? .03 : .055; P.kick += w.auto ? .006 : .018;
    for (let i = 0; i < 3; i++) R.pfxS.spawn(o.x, o.y, o.z, f.x * rand(.6, 1.6) + rand(-.3, .3), rand(0, .4), f.z * rand(.6, 1.6) + rand(-.3, .3), '#eef2f6', rand(.06, .1), rand(.2, .4), -.2, 4, 2.5, .35);
  } else {
    const m = M(R.rocketGeo); m.position.copy(o); R.scene.add(m); m.lookAt(_b.copy(o).add(dir));
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: R.glowTex, color: new THREE.Color().setRGB(5, 2.6, .9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); fl.scale.setScalar(.45); fl.position.z = -.2; m.add(fl);
    G.proj.push({ k: 'rocket', m, p: m.position, v: dir.multiplyScalar(w.speed), life: 3, snd: SFX.rocketLoop(o) });
    SFX.rocket(o); VM.rec = .14; P.kick += .07; G.shake = Math.max(G.shake, .25);
    const b = R.cam.localToWorld(V(.15, -.1, .6));
    for (let i = 0; i < 20; i++) R.pfxS.spawn(b.x, b.y, b.z, -f.x * rand(1, 4) + rand(-1, 1), rand(0, 1), -f.z * rand(1, 4) + rand(-1, 1), '#b4aea6', rand(.3, .55), rand(.9, 1.8), -.3, 2, 2.5, .6);
  }
  P.anim = { k: 'shoot', t: 0, d: .12 };
}
function actPunchFP(st) {
  SFX.whoosh(P.pos); P.anim = { k: 'punch', t: 0, d: .34, hit: .13, fn: () => { if (st && SEATED.has(st.state)) { stun(st); hitMark(); } } };
}
function actBatFP() {
  SFX.whoosh(P.pos);
  P.anim = { k: 'bat', t: 0, d: .62, hit: .33, lock: true, fn: () => { const st = viewHit(WEAPONS.bat.range + .5, .25, true); if (st) batHit(st); } };
}
function actSnatchFP(st) {
  if (!st) { toast('가까이에 학생이 없어요', 'info'); return false; }
  if (!st.glasses) { say(st, '저 안경 안 썼는데요?'); return false; }
  VM.reach = R.cam.worldToLocal(st.hpos.clone()); if (VM.reach.length() > .8) VM.reach.setLength(.8);
  P.anim = { k: 'snatch', t: 0, d: 1.15, lock: true, hit: .28, fn: () => {
    const g = st.glasses; if (!g) return; st.glasses = null; g.removeFromParent(); g.position.set(0, -.08, .02); g.rotation.set(-1.25, PI, 0); R.vm.r.hand.add(g); VM.held = g; SFX.whoosh(P.pos);
    tween(.55, null, () => { if (VM.held === g) { VM.held = null; breakGlasses(g, st, R.cam.localToWorld(V(0, -.15, -.42))); } });
  } };
  return true;
}
// 1인칭 손/무기 배치 (카메라 기준 좌표)
const WL = {
  bat: { w: [.21, -.27, -.42], d: [.25, 1, .18], r: [0, 0, 0] },
  pistol: { w: [.12, -.15, -.36], d: [-.03, 0, -1], r: [0, -.045, .02], l: [-.03, -.06, .015] },
  ak: { w: [.15, -.18, -.36], d: [-.04, 0, -1], r: [0, -.06, .03], l: [-.016, -.025, -.4] },
  rpg: { w: [.13, -.14, -.24], d: [-.03, 0, -1], r: [0, -.02, 0], l: [-.01, -.03, -.24] },
  tackle: { w: [.2, -.33, -.47], d: [0, -.4, -1], r: [0, .07, .02] },
  none: { r: [.2, -.25, -.45], l: [-.22, -.27, -.47] },
};
function placeArm(arm, pos, rx, rz) { arm.a.rotation.set(rx, 0, rz); _t.set(0, -.37, 0).applyEuler(arm.a.rotation); arm.a.position.copy(pos).sub(_t); }
const lv = (o, a, b, k) => o.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
function updVM(dt) {
  const vm = R.vm, show = isFP() && !G.shop && ['exam', 'end', 'lunch', 'over', 'results'].includes(G.phase);
  vm.root.visible = show; $('xhair').classList.toggle('hidden', !show); if (!show) return;
  const id = curWeapon(), Lw = WL[id] || WL.none, hasW = !!WL[id];
  for (const k in vm.wpn) vm.wpn[k].visible = k === id;
  const dy = wrapA(P.cy - VM.lastCy), dp = P.pitch - VM.lastP; VM.lastCy = P.cy; VM.lastP = P.pitch;
  const k8 = Math.min(1, dt * 8); VM.swX = lerp(clamp(VM.swX + dy * .3, -.08, .08), 0, k8); VM.swY = lerp(clamp(VM.swY - dp * .25, -.06, .06), 0, k8);
  VM.rec = lerp(VM.rec, 0, Math.min(1, dt * 12)); VM.eq = Math.max(0, VM.eq - dt * 3.5);
  const bA = P.bobA, bx = Math.sin(P.bobT) * .012 * bA, by = -Math.abs(Math.cos(P.bobT)) * .014 * bA + Math.sin(G.T * 1.6) * .003;
  vm.pivot.position.set(VM.swX * .6 + bx, by - ease(VM.eq) * .35 + VM.swY * .4, VM.rec);
  vm.pivot.rotation.set(VM.rec * 1.6 + VM.swY, VM.swX, 0);
  const wp = _a.set(...(Lw.w || [0, 0, 0])), d = _b.set(...(Lw.d || [0, 0, -1])).normalize();
  const rp = hasW ? _c.copy(wp).add(_t.set(...Lw.r)) : _c.set(...Lw.r);
  let lp = Lw.l ? (hasW ? _d.copy(wp).add(_t.set(...Lw.l)) : _d.set(...Lw.l)) : null;
  const a = P.anim, p = a ? clamp(a.t / a.d, 0, 1) : 0;
  if (a && a.k === 'bat') {
    const W0 = Lw.w, D0 = Lw.d, W1 = [.25, -.22, -.37], D1 = [.45, .75, .5], W2 = [-.12, -.3, -.52], D2 = [-1, -.15, -.55];
    if (p < .4) { const q = ease(p / .4); lv(wp, W0, W1, q); lv(d, D0, D1, q); } else if (p < .62) { const q = ease((p - .4) / .22); lv(wp, W1, W2, q); lv(d, D1, D2, q); } else { const q = ease((p - .62) / .38); lv(wp, W2, W0, q); lv(d, D2, D0, q); }
    d.normalize(); rp.copy(wp);
  }
  if (id === 'bat') lp = _d.copy(wp).addScaledVector(d, -.085);
  if (a && a.k === 'punch') { const q = Math.sin(p * PI); rp.set(lerp(.2, .05, q), lerp(-.25, -.12, q), lerp(-.45, -.8, q)); }
  if (a && a.k === 'snatch' && VM.reach) {
    const R0 = Lw.r, T = [VM.reach.x, VM.reach.y, VM.reach.z], Hd = [.04, -.16, -.4];
    if (p < .28) lv(rp, R0, T, ease(p / .28)); else if (p < .5) lv(rp, T, Hd, ease((p - .28) / .22)); else rp.set(...Hd);
    if (p > .42) { lp = _d.set(lerp(-.22, -.05, ease((p - .42) / .15)), -.17, -.41); if (p > .7) { rp.x += .05; lp.x -= .05; } }
  }
  if (a && a.k === 'tackle') { rp.set(.15, -.2, -.62); lp = _d.set(-.15, -.2, -.62); }
  if (hasW) { const w = vm.wpn[id]; w.position.copy(wp); w.quaternion.setFromUnitVectors(_t.set(0, 0, -1), d); }
  placeArm(vm.r, rp, 1.72, -.35); vm.l.a.visible = !!lp; if (lp) placeArm(vm.l, lp, 1.72, .38);
}

// ───────── HUD / 핫바 / 말풍선 / 알림 ─────────
function renderHotbar() {
  const hb = $('hotbar'); hb.innerHTML = '';
  G.slots.forEach((id, i) => {
    const w = WEAPONS[id], b = document.createElement('button'); b.className = 'slot' + (i === G.sel ? ' on' : '');
    b.innerHTML = `<em>${i + 1}</em><i>${icon(w.icon)}</i><span>${w.name}</span><u></u>`;
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectSlot(i); }); hb.appendChild(b);
  });
  $('atkIc').innerHTML = icon(WEAPONS[curWeapon()].icon);
}
function selectSlot(i) { if (i < 0 || i >= G.slots.length) return; G.sel = i; setHeld(curWeapon()); renderHotbar(); SFX.click(); }
function updHUD() {
  $('hearts').innerHTML = [0, 1, 2].map((i) => icon(i < G.hearts ? 'heart' : 'heart0')).join('');
  $('coins').textContent = G.hack.money ? '∞' : G.coins;
  const s = SCHED[Math.min(G.sched, SCHED.length - 1)];
  $('periodName').textContent = G.phase === 'end' ? '수능 종료' : G.phase === 'lunch' ? '점심시간' : `${s.n} ${s.s}`;
  $('remain').classList.toggle('hidden', !(G.mode === 'teacher' && (G.phase === 'end' || G.hack.find)));
  $('remain').textContent = `남은 AI 안경 학생 ${remaining()}명`;
}
function updUI() {
  const s = SCHED[Math.min(G.sched, SCHED.length - 1)];
  if (G.phase === 'exam' && s.k === 'p') {
    const k = clamp(G.pT / s.d, 0, 1), mn = lerp(toMin(s.a), toMin(s.b), k);
    $('pbar').firstElementChild.style.width = (k * 100).toFixed(1) + '%';
    $('clockTxt').textContent = `${String(Math.floor(mn / 60)).padStart(2, '0')}:${String(Math.floor(mn % 60)).padStart(2, '0')}`; setClock(mn);
  }
  if (G.mode === 'teacher' && !G.shop) {
    const id = curWeapon(), c = Math.max(0, G.cd[id] || 0), mx = G.cdMax[id] || 1, f = c / mx;
    $('atkCd').style.background = f > 0 ? `conic-gradient(rgba(0,0,0,.6) ${f * 360}deg, transparent 0)` : 'none';
    $('atkCd').textContent = c > .25 ? c.toFixed(1) : '';
    [...$('hotbar').children].forEach((b, i) => { const cc = Math.max(0, G.cd[G.slots[i]] || 0) / (G.cdMax[G.slots[i]] || 1); b.lastElementChild.style.height = (cc * 100) + '%'; });
  }
  if (G.mode === 'student') {
    $('suspBar').firstElementChild.style.width = G.susp + '%';
    $('suspBar').className = G.susp > 70 ? 'hi' : G.susp > 40 ? 'mid' : '';
    $('suspBox').classList.toggle('watch', !!G.watch); $('watchTxt').textContent = G.watch ? '감독관이 보고 있다!' : '의심도';
  }
}
function bubble(obj, text, dur = 3, cls = '') {
  if (obj.userData.bub) removeBub(obj.userData.bub);
  const el = document.createElement('div'); el.className = 'bub ' + cls; el.textContent = text; $('labels').appendChild(el);
  const b = { el, obj, t: dur, d: dur }; G.bubs.push(b); obj.userData.bub = b;
}
function removeBub(b) { b.el.remove(); const i = G.bubs.indexOf(b); if (i >= 0) G.bubs.splice(i, 1); if (b.obj.userData.bub === b) b.obj.userData.bub = null; }
function clearBubbles() { G.bubs.slice().forEach(removeBub); }
const say = (st, t, d = 2.6) => { if (R.students.includes(st)) bubble(st.head, t, d); };
const npcSay = (t, d = 2.6) => { bubble(R.teacher.head, t, d, 'teacher'); SFX.speak(t, { pitch: .85, rate: 1.05, who: 0, prio: true }); };
function toScreen(p) { _sv.copy(p).project(R.cam); return { x: (_sv.x * .5 + .5) * innerWidth, y: (-_sv.y * .5 + .5) * innerHeight, ok: _sv.z < 1 }; }
function updBubbles(dt) {
  for (const b of G.bubs.slice()) {
    b.t -= dt; if (b.t <= 0) { removeBub(b); continue; }
    b.obj.getWorldPosition(_v3); _v3.y += .48; const s = toScreen(_v3);
    b.el.style.display = s.ok ? '' : 'none'; b.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`; b.el.style.opacity = Math.min(1, b.t / .3);
  }
}
function ftext() { }
function ftextOld(p, t, cls = '') {
  const s = toScreen(p); if (!s.ok) return; const el = document.createElement('div'); el.className = 'ftext ' + cls; el.textContent = t;
  el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; $('labels').appendChild(el); setTimeout(() => el.remove(), 950);
}
function toast(t, cls = '') {
  const el = document.createElement('div'); el.className = 'toast ' + cls; el.textContent = t; $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove(); setTimeout(() => el.remove(), 2600);
}
function banner(a, b) { const e = $('banner'); e.innerHTML = `<b>${a}</b><span>${b}</span>`; e.classList.remove('show'); void e.offsetWidth; e.classList.add('show'); }
function flash(c, o) { const f = $('flash'); f.style.transition = 'none'; f.style.background = c; f.style.opacity = o; void f.offsetWidth; f.style.transition = 'opacity .5s'; f.style.opacity = 0; }
function modal(html) { $('mbox').innerHTML = html; show('modal', true); }
function closeModal() { show('modal', false); clearInterval(G.lunchTimer); }
function addCoins(n, st) {
  G.coins += n; G.earned += n; save(); updHUD(); SFX.coin();
  if (!st) return; const s = toScreen(st.hpos); if (!s.ok) return;
  const el = document.createElement('div'); el.className = 'flycoin'; el.innerHTML = icon('coin'); el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; $('labels').appendChild(el);
  const r = $('coinBox').getBoundingClientRect(); el.getBoundingClientRect();
  el.style.transform = `translate(${r.left + 14 - s.x}px,${r.top + 14 - s.y}px) scale(.6)`; el.style.opacity = '.4'; setTimeout(() => el.remove(), 750);
}
function loseHeart(msg) {
  if (G.phase === 'over') return;
  G.hearts--; updHUD(); SFX.hurt(); flash('#ff2030', .45); toast(`${msg} 하트 -1`, 'bad');
  if (G.hearts <= 0) gameOver('AI 안경을 쓰지 않은 학생을 3번 공격했습니다.');
}
function addChat(name, text, cls) {
  const d = document.createElement('div'); d.className = 'cl ' + cls; d.innerHTML = `<b>${esc(name)}</b> ${esc(text)}`; $('chatLog').appendChild(d);
  while ($('chatLog').children.length > 40) $('chatLog').firstChild.remove(); $('chatLog').scrollTop = 1e6;
}
function teacherSay(text) {
  addChat('감독관(나)', text, 'me'); if (!isFP()) bubble(R.teacher.head, text, 4, 'teacher'); SFX.speak(text, { pitch: .85, rate: 1.05, who: 0, prio: true });
  const cat = classify(text), alive = R.students.filter((s) => SEATED.has(s.state) && !s.isPlayer);
  alive.forEach((s) => { s.lookT = 1.4 + Math.random(); if (cat === 'cheat' && s.cheater && !s.found) s.scared = 10; if (cat === 'quiet') s.scared = Math.max(s.scared, 3); });
  const d2 = (s) => (s.x - P.pos.x) ** 2 + (s.z - P.pos.z) ** 2;
  const resp = [...new Set([...alive.slice().sort((a, b) => d2(a) - d2(b)).slice(0, 2), pick(alive)])].filter(Boolean);
  resp.forEach((s, i) => setTimeout(() => {
    if (!R.students.includes(s) || s.state === 'ko') return;
    let lines = REACT[cat]; if (cat === 'cheat' && s.cheater && !s.found) lines = REACT.guilty; if (s.state === 'stunned') lines = ['으... (기절 중)']; if (s.state === 'caught') lines = ['ㅠㅠ...'];
    const line = pick(lines); say(s, line, 3); addChat(s.name, line, 'st'); SFX.speak(line, { pitch: rand(1.25, 1.65), rate: 1.15, who: 1 });
  }, 500 + i * 650 + Math.random() * 300));
}
function sendChat() { const t = $('chatIn').value.trim(); if (!t) return; $('chatIn').value = ''; SFX.init(); teacherSay(t.slice(0, 60)); }
function toggleChat(on = !G.chatOpen) { G.chatOpen = on; show('chatBar', on); if (on) $('chatIn').focus(); else $('chatIn').blur(); }

// ───────── 메인 루프 ─────────
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = clamp((now - last) / 1000, 0, .05); last = now;
  if (!G.paused) { G.T += dt; update(dt); }
  updDecor(R.cam.position); SFX.listen(R.cam); renderFrame(G.T);
}
function update(dt) {
  updTweens(dt);
  const ph = G.phase;
  if (ph === 'menu') {
    const a = G.T * .09; setCam(_v.set(Math.sin(a) * 6, 3.3, Math.cos(a) * 6.6), _v2.set(0, 1, -1.5), dt, 3);
    R.teacher.root.position.set(0, 0, -5.3); R.teacher.root.rotation.y = PI; poseTeacher(dt, 0);
  } else if (ph === 'intro') updIntro(dt);
  else if (G.mode === 'teacher') {
    if (ph === 'exam' || ph === 'end' || ph === 'lunch' || ph === 'over' || ph === 'results') updTeacher(dt);
    if (G.shop) shopCam(dt); else if (isFP()) fpCam(dt); else { const f = followCam(); setCam(f[0], f[1], dt); }
  } else updStudentMode(dt);
  updVM(dt);
  if (ph === 'exam') { const s = SCHED[G.sched]; G.pT += dt; if (G.pT >= s.d) nextSched(); }
  updStudents(dt); updProj(dt); updDebris(dt); R.pfxA.update(dt); R.pfxN.update(dt); R.pfxS.update(dt); updAmbient(G.T);
  if (R.flashL.intensity > 0) R.flashL.intensity = Math.max(0, R.flashL.intensity - dt * 220);
  G.shake = Math.max(0, G.shake - dt * 2.2);
  R.shopRing.material.opacity = .45 + Math.sin(G.T * 4) * .25; R.shopLabel.visible = G.mode === 'teacher' && !G.shop && ph !== 'intro';
  R.shopRing.visible = G.mode !== 'student' && !G.shop;
  for (const k in R.shopItems) { const it = R.shopItems[k], sel = G.shop && G.shopSel === k; it.position.y += ((sel ? it.userData.y + .12 : it.userData.y) - it.position.y) * Math.min(1, dt * 8); it.rotation.y = sel ? Math.sin(G.T * 2) * .5 : it.rotation.y * .9; }
  if (G.mode !== 'teacher' || G.shop) R.tring.visible = false;
  updBubbles(dt); updUI();
}
function tween(d, fn, done) { G.tw.push({ t: 0, d, fn, done }); }
function updTweens(dt) { for (const w of G.tw.slice()) { w.t += dt; const k = Math.min(1, w.t / w.d); if (w.fn) w.fn(k); if (k >= 1) { G.tw.splice(G.tw.indexOf(w), 1); if (w.done) w.done(); } } }

// ───────── 입력 ─────────
const cv = $('cv');
cv.addEventListener('pointerdown', (e) => { SFX.init(); IN.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ } });
cv.addEventListener('pointermove', (e) => {
  const d = IN.drag; if (!d || d.id !== e.pointerId) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
  if (document.pointerLockElement) return;
  if (G.shop) { G.shopLook.yaw = clamp(G.shopLook.yaw - dx * .004, PI - 1.2, PI + 1.2); G.shopLook.pitch = clamp(G.shopLook.pitch - dy * .004, -1.2, .3); }
  else if (isFP()) look(dx * 2.1, dy * 2.1);
  else if (G.mode === 'teacher') { P.cy -= dx * .006; P.cp = clamp(P.cp + dy * .004, .12, 1.25); }
  else if (G.mode === 'student') { G.sv.yaw = clamp(G.sv.yaw - dx * .004, -2.3, 2.3); G.sv.pitch = clamp(G.sv.pitch - dy * .004, -1.2, .5); }
});
cv.addEventListener('pointerup', (e) => { const d = IN.drag; if (d && G.shop && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) shopPick(e); IN.drag = null; });
function look(dx, dy) { P.cy -= dx * .0024; P.pitch = clamp(P.pitch - dy * .0022, -1.35, 1.25); }
cv.addEventListener('click', () => { if (isFP() && !G.shop && (G.phase === 'exam' || G.phase === 'end') && matchMedia('(pointer:fine)').matches && !document.pointerLockElement && cv.requestPointerLock) cv.requestPointerLock(); });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === cv) look(e.movementX, e.movementY); });
cv.addEventListener('mousedown', (e) => { if (document.pointerLockElement === cv && e.button === 0) { IN.atk = true; tryAttack(); } });
addEventListener('mouseup', () => { if (document.pointerLockElement === cv) IN.atk = false; });
$('btnView').onclick = () => { G.settings.view = isFP() ? 'tp' : 'fp'; save(); G.camBlend = 0; exitLock(); SFX.click(); toast(isFP() ? '1인칭 시점' : '3인칭 시점', 'info'); };
cv.addEventListener('wheel', (e) => { P.cdist = clamp(P.cdist + e.deltaY * .004, 2.5, 9); }, { passive: true });
const joy = $('joy'), knob = $('knob');
function joyMove(e) { const r = joy.getBoundingClientRect(), R0 = r.width * .38; let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const l = Math.hypot(dx, dy); if (l > R0) { dx *= R0 / l; dy *= R0 / l; } knob.style.transform = `translate(${dx}px,${dy}px)`; IN.jx = dx / R0; IN.jy = -dy / R0; }
function resetJoy() { IN.jid = null; IN.jx = IN.jy = 0; knob.style.transform = ''; }
joy.addEventListener('pointerdown', (e) => { e.preventDefault(); IN.jid = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ } joyMove(e); });
joy.addEventListener('pointermove', (e) => { if (e.pointerId === IN.jid) joyMove(e); });
['pointerup', 'pointercancel'].forEach((ev) => joy.addEventListener(ev, (e) => { if (e.pointerId === IN.jid) resetJoy(); }));
$('btnAtk').addEventListener('pointerdown', (e) => { e.preventDefault(); SFX.init(); IN.atk = true; tryAttack(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('btnAtk').addEventListener(ev, () => (IN.atk = false)));
$('btnJump').addEventListener('pointerdown', (e) => { e.preventDefault(); IN.jump = true; });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; IN.keys[e.code] = true;
  if (G.mode !== 'teacher' || G.shop) return;
  if (/^Digit[1-7]$/.test(e.code)) selectSlot(+e.code.slice(5) - 1);
  if (e.code === 'Space') { IN.jump = true; e.preventDefault(); }
  if (e.code === 'KeyF' || e.code === 'KeyJ') { if (!IN.atk) tryAttack(); IN.atk = true; }
  if (e.code === 'Enter' || e.code === 'KeyT') { toggleChat(true); e.preventDefault(); }
});
addEventListener('keyup', (e) => { IN.keys[e.code] = false; if (e.code === 'KeyF' || e.code === 'KeyJ') IN.atk = false; });
addEventListener('blur', () => { IN.keys = {}; IN.atk = false; resetJoy(); });

// ───────── 버튼 ─────────
$('mTeacher').onclick = () => startGame('teacher');
$('mStudent').onclick = () => startGame('student');
$('btnChat').onclick = () => toggleChat();
$('chatSend').onclick = sendChat;
$('chatIn').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') sendChat(); if (e.key === 'Escape') toggleChat(false); });
$('btnResult').onclick = results;
$('shopExit').onclick = closeShop;
$('btnSolve').onclick = solveAI;
$('btnAsk').onclick = () => (G.aiOpen ? closeAI() : openAI());
$('aiClose').onclick = closeAI;
$('aiSend').onclick = aiSend;
$('aiIn').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') aiSend(); });
const openSettings = () => { exitLock(); show('settings', true); show('hackPwBox', false); $('hackMsg').textContent = ''; G.paused = G.mode !== 'menu'; $('btnHome').classList.toggle('hidden', G.mode === 'menu'); };
const closeSettings = () => { show('settings', false); G.paused = false; last = performance.now(); };
$('btnSet').onclick = openSettings; $('mSettings').onclick = openSettings; $('setClose').onclick = closeSettings;
$('btnHome').onclick = () => { closeSettings(); toMenu(); };
$('optSound').onchange = (e) => { G.settings.sound = e.target.checked; applySettings(); save(); };
$('optVoice').onchange = (e) => { G.settings.voice = e.target.checked; applySettings(); save(); };
document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { G.settings.quality = b.dataset.q; applySettings(); save(); SFX.click(); }));
// 해킹
$('btnHack').onclick = () => { if (G.unlocked) { closeSettings(); openHack(); return; } show('hackPwBox', true); $('hackPw').focus(); };
const tryPw = () => {
  if ($('hackPw').value === HACK_PW) { G.unlocked = true; $('hackPw').value = ''; closeSettings(); openHack(); SFX.init(); SFX.buy(); }
  else { $('hackMsg').textContent = '비밀번호가 틀렸습니다'; $('hackPwBox').classList.remove('shake'); void $('hackPwBox').offsetWidth; $('hackPwBox').classList.add('shake'); SFX.hurt(); }
};
$('hackOk').onclick = tryPw; $('hackPw').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') tryPw(); });
function openHack() { show('hackWin', true); show('hackBall', false); }
$('hackMin').onclick = () => { show('hackWin', false); show('hackBall', true); };
document.querySelectorAll('[data-hk]').forEach((cb) => (cb.onchange = () => {
  G.hack[cb.dataset.hk] = cb.checked; updHUD(); if (G.shop) renderShop(); SFX.click();
  toast(`${cb.parentElement.querySelector('span').textContent} ${cb.checked ? 'ON' : 'OFF'}`, 'hack');
}));
const ball = $('hackBall'); let bd = null;
ball.addEventListener('pointerdown', (e) => { bd = { x: e.clientX, y: e.clientY, l: ball.offsetLeft, t: ball.offsetTop, mv: false }; ball.setPointerCapture(e.pointerId); });
ball.addEventListener('pointermove', (e) => { if (!bd) return; const dx = e.clientX - bd.x, dy = e.clientY - bd.y; if (Math.hypot(dx, dy) > 6) bd.mv = true; if (bd.mv) { ball.style.left = clamp(bd.l + dx, 4, innerWidth - 60) + 'px'; ball.style.top = clamp(bd.t + dy, 4, innerHeight - 60) + 'px'; ball.style.right = 'auto'; } });
ball.addEventListener('pointerup', () => { if (bd && !bd.mv) openHack(); bd = null; });
$('skip').onclick = () => { if (G.phase === 'intro') endIntro(); };

window.__sn = { G, P, R, N, selectSlot, tryAttack, startGame, openShop, closeShop, shopTap, solveAI, endExam, nextSched };
