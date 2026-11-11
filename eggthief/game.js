// 알 도둑 대작전 — 다른 기지의 알을 훔쳐 내 둥지에 모으는 블록 캐릭터 게임
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const ROUND = 240, ARENA = 45, BASE_R = 8.6, SLOT_MAX = 10;
const RAR = [
  { name: '보통', color: 0xf4efe2, css: '#f4efe2', cps: 1, w: 60 },
  { name: '희귀', color: 0x4aa3ff, css: '#4aa3ff', cps: 3, w: 26 },
  { name: '에픽', color: 0xa45cff, css: '#a45cff', cps: 8, w: 10 },
  { name: '전설', color: 0xffc531, css: '#ffc531', cps: 20, w: 3.5 },
  { name: '신화', color: 0xff5fa8, css: '#ff5fa8', cps: 50, w: 0.6 },
];
const TEAMS = [
  { name: '나', color: 0x3b82f6, css: '#3b82f6' },
  { name: '빨강이', color: 0xef4444, css: '#ef4444' },
  { name: '초록이', color: 0x22c55e, css: '#22c55e' },
  { name: '노랑이', color: 0xeab308, css: '#eab308' },
];
const DIFF = [
  { speed: 6.8, alert: 0.2, think: 0.6 },
  { speed: 7.6, alert: 0.45, think: 0.4 },
  { speed: 8.4, alert: 0.8, think: 0.25 },
];
const UPG = {
  speed: { icon: '👟', name: '이동 속도', desc: '+1 속도', cost: [40, 100, 220, 450, 900] },
  slot: { icon: '🪺', name: '둥지 칸 추가', desc: '알을 더 많이 보관', cost: [60, 120, 230, 430, 800] },
  lock: { icon: '🛡️', name: '잠금 시간', desc: '+5초 방어막', cost: [80, 200, 450] },
  punch: { icon: '👊', name: '펀치 힘', desc: '기절 시간·사거리 증가', cost: [70, 180, 400] },
};

function rollRarity(bonus = 0) {
  const ws = RAR.map((r, i) => r.w * (1 + bonus * i));
  let t = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ws.length; i++) { t -= ws[i]; if (t <= 0) return i; }
  return 0;
}

// ───────── 렌더러 / 장면 ─────────
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 70, 150);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
scene.add(new THREE.HemisphereLight(0xffffff, 0x4f7a35, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(30, 55, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 140 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
function mesh(geo, m, x = 0, y = 0, z = 0, shadow = true) {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  me.castShadow = shadow; me.receiveShadow = true;
  scene.add(me);
  return me;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 바닥 (스터드 느낌 격자)
const groundTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#6cc04a'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.arc(64, 64, 26, 0, 7); g.fill();
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(50, 50);
const ground = mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }), 0, 0, 0, false);
ground.rotation.x = -Math.PI / 2;
// 울타리
const wallM = mat(0xa8784a);
for (const [x, z, w, d] of [[0, 46, 93, 1], [0, -46, 93, 1], [46, 0, 1, 93], [-46, 0, 1, 93]])
  mesh(new THREE.BoxGeometry(w, 1.4, d), wallM, x, 0.7, z);

// 장애물 목록 (원)
const obstacles = [];
// 중앙 분수 — 야생 알이 튀어나옴
mesh(new THREE.CylinderGeometry(4.5, 4.8, 0.3, 32), mat(0xd8d2c4), 0, 0.15, 0);
mesh(new THREE.CylinderGeometry(1.6, 2.0, 1.6, 20), mat(0xbfb8a8), 0, 1.0, 0);
obstacles.push({ x: 0, z: 0, r: 2.1 });

// 알 모양 (회전체)
const eggGeo = (() => {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const y = -1 + (2 * i) / 16;
    pts.push(new THREE.Vector2(Math.sqrt(Math.max(0, 1 - y * y)) * (1 - 0.16 * y) * 0.38, (y + 1) * 0.52));
  }
  return new THREE.LatheGeometry(pts, 20);
})();
const eggMats = RAR.map((r, i) => mat(r.color, {
  roughness: i >= 3 ? 0.3 : 0.55, metalness: i === 3 ? 0.6 : 0.05,
  emissive: i >= 2 ? r.color : 0x000000, emissiveIntensity: i >= 2 ? 0.25 : 0,
}));
const statue = mesh(eggGeo, mat(0xfff7e0, { roughness: 0.4, emissive: 0xffe9a8, emissiveIntensity: 0.15 }), 0, 1.8, 0);
statue.scale.setScalar(3.2);

// 나무·바위 (고정 시드)
let seed = 7;
const srand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const trunkM = mat(0x7a5232), leafM = mat(0x2f9e44), rockM = mat(0x8a8f99);
const BASE_POS = [[-28, 28], [28, 28], [28, -28], [-28, -28]];
const freeSpot = (x, z, pad) => Math.hypot(x, z) > 12 + pad && BASE_POS.every(([bx, bz]) => Math.hypot(x - bx, z - bz) > 12 + pad)
  && obstacles.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 3);
for (let n = 0, tries = 0; n < 30 && tries < 600; tries++) {
  const x = (srand() * 2 - 1) * 42, z = (srand() * 2 - 1) * 42;
  if (!freeSpot(x, z, 0)) continue;
  n++;
  if (n % 3 === 0) {
    const r = 0.7 + srand() * 0.7;
    const rock = mesh(new THREE.DodecahedronGeometry(r), rockM, x, r * 0.6, z);
    rock.rotation.set(srand() * 3, srand() * 3, 0);
    obstacles.push({ x, z, r: r * 0.95 });
  } else {
    const s = 0.8 + srand() * 0.6;
    mesh(new THREE.CylinderGeometry(0.3 * s, 0.4 * s, 2.2 * s, 8), trunkM, x, 1.1 * s, z);
    mesh(new THREE.IcosahedronGeometry(1.7 * s, 0), leafM, x, 3.0 * s, z);
    obstacles.push({ x, z, r: 0.6 * s });
  }
}

// ───────── 아바타 ─────────
const faceTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#ffd27a'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#222'; g.fillRect(18, 20, 7, 11); g.fillRect(39, 20, 7, 11);
  g.lineWidth = 4; g.strokeStyle = '#222'; g.beginPath(); g.arc(32, 36, 13, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
});
const skinM = mat(0xffd27a), pantsM = mat(0x2d3748), faceM = mat(0xffffff, { map: faceTex });
const headMats = [skinM, skinM, skinM, skinM, faceM, skinM];
const boxGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function makeAvatar(team) {
  const g = new THREE.Group();
  const shirtM = mat(team.color);
  const part = (geo, m, x, y, z, parent = g) => {
    const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me;
  };
  const joint = (x, y) => { const j = new THREE.Group(); j.position.set(x, y, 0); g.add(j); return j; };
  const hipL = joint(-0.22, 0.8), hipR = joint(0.22, 0.8), shL = joint(-0.66, 1.6), shR = joint(0.66, 1.6);
  part(boxGeo(0.4, 0.8, 0.42), pantsM, 0, -0.4, 0, hipL);
  part(boxGeo(0.4, 0.8, 0.42), pantsM, 0, -0.4, 0, hipR);
  part(boxGeo(0.34, 0.82, 0.36), shirtM, 0, -0.36, 0, shL);
  part(boxGeo(0.34, 0.82, 0.36), shirtM, 0, -0.36, 0, shR);
  const torso = part(boxGeo(0.96, 0.85, 0.5), shirtM, 0, 1.225, 0);
  const head = part(boxGeo(0.62, 0.62, 0.62), headMats, 0, 1.97, 0);
  // 이름표
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTex(256, 64, (c) => {
      c.font = '900 38px sans-serif'; c.textAlign = 'center'; c.lineWidth = 8; c.strokeStyle = 'rgba(0,0,0,.65)';
      c.strokeText(team.name, 128, 46); c.fillStyle = team.css; c.fillText(team.name, 128, 46);
    }), depthTest: false,
  }));
  tag.scale.set(2.4, 0.6, 1); tag.position.y = 2.75; g.add(tag);
  // 기절 별
  const stars = new THREE.Group(); stars.position.y = 2.45; stars.visible = false; g.add(stars);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), mat(0xffe14a, { emissive: 0xffd000, emissiveIntensity: 0.6 }));
    s.position.set(Math.cos(i * 2.1) * 0.45, 0, Math.sin(i * 2.1) * 0.45); stars.add(s);
  }
  scene.add(g);
  return { g, hipL, hipR, shL, shR, torso, head, stars };
}

// ───────── 상태 ─────────
let agents = [], bases = [], eggs = [], particles = [];
let gameTime = 0, running = false, diff = DIFF[1], player = null, spawnT = 0, incomeT = 0;

// 기지
function makeBase(i) {
  const [x, z] = BASE_POS[i], team = TEAMS[i];
  const c = new THREE.Vector3(x, 0, z);
  const f = new THREE.Vector3(-x, 0, -z).normalize(); // 중앙 방향
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const b = { idx: i, team, c, f, r, slots: Array(SLOT_MAX).fill(null), unlocked: 5, lockUntil: 0, lockReadyAt: 0, owner: null };
  const plat = mesh(new THREE.CylinderGeometry(BASE_R, BASE_R, 0.16, 40), mat(new THREE.Color(team.color).lerp(new THREE.Color(0xffffff), 0.55)), x, 0.08, z, false);
  plat.receiveShadow = true;
  b.slotPos = []; b.peds = [];
  for (let k = 0; k < SLOT_MAX; k++) {
    const row = Math.floor(k / 5), col = k % 5;
    const p = c.clone().addScaledVector(f, -2.6 - row * 2).addScaledVector(r, (col - 2) * 1.7);
    b.slotPos.push(p);
    b.peds.push(mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.4, 16), mat(0x777777), p.x, 0.2, p.z));
  }
  // 깃발 + 간판
  const back = c.clone().addScaledVector(f, -7.2);
  mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 8), mat(0xdddddd), back.x, 2.5, back.z);
  const flag = mesh(new THREE.BoxGeometry(1.6, 1, 0.05), mat(team.color), back.x, 4.4, back.z);
  flag.position.addScaledVector(r, 0.8); flag.rotation.y = Math.atan2(r.x, r.z) - Math.PI / 2;
  // 잠금 발판
  b.padPos = c.clone().addScaledVector(f, 4.6).addScaledVector(r, 3.6);
  b.pad = mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 24), mat(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.4 }), b.padPos.x, 0.18, b.padPos.z, false);
  // 방어막
  b.dome = mesh(new THREE.SphereGeometry(BASE_R, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: team.color, transparent: true, opacity: 0.2, emissive: team.color, emissiveIntensity: 0.4, side: THREE.DoubleSide, depthWrite: false }), x, 0, z, false);
  b.dome.visible = false;
  return b;
}
const isLocked = (b) => gameTime < b.lockUntil;
const lockReady = (b) => gameTime >= b.lockReadyAt;
const lockDur = (b) => 10 + b.owner.lv.lock * 5;
const baseCps = (b) => b.slots.reduce((s, e) => s + (e ? RAR[e.r].cps : 0), 0);
function refreshPeds(b) {
  b.peds.forEach((p, k) => p.material.color.set(k < b.unlocked ? new THREE.Color(b.team.color).lerp(new THREE.Color(0xffffff), 0.3) : 0x555555));
}

// 알
function makeEgg(r) {
  const e = { r, mesh: mesh(eggGeo, eggMats[r]), state: 'ground', base: null, slot: -1, carrier: null, home: null, pos: new THREE.Vector3(), groundT: 0, fly: null };
  e.mesh.scale.setScalar(1.3);
  eggs.push(e);
  return e;
}
function removeEgg(e) {
  scene.remove(e.mesh);
  e.state = 'gone';
  eggs = eggs.filter((x) => x !== e);
  if (e.base) { e.base.slots[e.slot] = null; e.base = null; }
}
function flyEgg(e, to, dur, done) {
  e.state = 'fly'; e.fly = { from: e.pos.clone(), to: to.clone(), t: 0, dur, done };
}
function putInSlot(e, b, k) {
  e.base = b; e.slot = k; e.home = b; b.slots[k] = e; e.carrier = null;
  const p = b.slotPos[k].clone(); p.y = 0.4;
  flyEgg(e, p, 0.35, () => { e.state = 'slot'; });
}

// 캐릭터
function makeAgent(i, isPlayer) {
  const b = bases[i];
  const a = {
    id: i, team: TEAMS[i], name: TEAMS[i].name, isPlayer, base: b, av: makeAvatar(TEAMS[i]),
    pos: b.c.clone().addScaledVector(b.f, 1.5), vel: new THREE.Vector3(), vy: 0, yaw: Math.atan2(b.f.x, b.f.z),
    carry: null, stun: 0, punchCD: 0, punchAnim: 0, money: 0, earned: 0, lv: { speed: 0, slot: 0, lock: 0, punch: 0 },
    walk: 0, move: { x: 0, z: 0 }, ai: { t: rand(0, 0.5), goal: null, target: null, type: 'idle', stuckT: 0, last: null, jitter: 0, jx: 0, jz: 0 },
  };
  b.owner = a;
  return a;
}
const speedOf = (a) => ((a.isPlayer ? 8.5 : diff.speed) + a.lv.speed) * (a.carry ? 0.8 - 0.04 * a.carry.r : 1);

// ───────── 효과음 (WebAudio 합성) ─────────
let ac = null;
function tone(f, dur, type = 'square', vol = 0.06, delay = 0, slide = 0) {
  if (!ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  grab: () => { tone(660, 0.08); tone(990, 0.12, 'square', 0.06, 0.07); },
  deposit: () => { tone(523, 0.1, 'triangle', 0.1); tone(659, 0.1, 'triangle', 0.1, 0.08); tone(784, 0.18, 'triangle', 0.1, 0.16); },
  punch: () => tone(180, 0.12, 'sawtooth', 0.08, 0, -120),
  hit: () => { tone(120, 0.2, 'square', 0.08, 0, -60); tone(900, 0.15, 'sine', 0.05, 0.05, -500); },
  lock: () => { tone(300, 0.25, 'sine', 0.1, 0, 300); tone(600, 0.3, 'sine', 0.06, 0.1, 200); },
  alarm: () => { for (let i = 0; i < 3; i++) tone(880, 0.1, 'square', 0.05, i * 0.16); },
  buy: () => { tone(880, 0.08, 'triangle', 0.1); tone(1320, 0.15, 'triangle', 0.1, 0.07); },
  jump: () => tone(400, 0.12, 'sine', 0.05, 0, 300),
  bad: () => tone(200, 0.2, 'square', 0.05),
};

// ───────── 알림 ─────────
function toast(msg, cls = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + cls; d.textContent = msg;
  $('toasts').prepend(d);
  while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
  setTimeout(() => d.remove(), 3200);
}

// 파티클
const partGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
function burst(p, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color }));
    m.position.copy(p);
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3(rand(-3, 3), rand(3, 7), rand(-3, 3)), life: rand(0.5, 0.9) });
  }
}

// ───────── 행동 ─────────
function canGrab(a, e) {
  if (e.state === 'ground') return true;
  return e.state === 'slot' && e.base !== a.base && !isLocked(e.base);
}
function nearestGrab(a, range = 2.0) {
  let best = null, bd = range;
  for (const e of eggs) {
    if (!canGrab(a, e)) continue;
    const d = dist2(a.pos, e.pos);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function grab(a, e) {
  if (a.carry || a.stun > 0 || !e || !canGrab(a, e)) return false;
  const victim = e.base ? e.base.owner : null;
  if (e.base) { e.base.slots[e.slot] = null; e.base = null; }
  e.state = 'carry'; e.carrier = a; a.carry = e;
  if (a.isPlayer) {
    sfx.grab();
    toast(victim ? `${victim.name}의 ${RAR[e.r].name} 알을 훔쳤다! 내 기지로 달려!` : `${RAR[e.r].name} 알 획득! 내 기지로 가져가자`, 'good');
  } else if (victim && victim.isPlayer) {
    sfx.alarm(); toast(`⚠️ ${a.name}가 내 ${RAR[e.r].name} 알을 훔쳐 가요! 쫓아가서 때리세요!`, 'bad');
  }
  return true;
}
function dropCarry(a) {
  const e = a.carry;
  if (!e) return;
  a.carry = null; e.carrier = null; e.state = 'ground'; e.groundT = 0;
  const to = a.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
  to.x = clamp(to.x, -ARENA, ARENA); to.z = clamp(to.z, -ARENA, ARENA);
  flyEgg(e, to, 0.45, () => { e.state = 'ground'; e.groundT = 0; });
}
function sellEgg(a, e) {
  const v = RAR[e.r].cps * 15;
  a.money += v; a.earned += v;
  removeEgg(e);
  return v;
}
function deposit(a) {
  const e = a.carry, b = a.base;
  a.carry = null; e.carrier = null;
  let k = -1;
  for (let i = 0; i < b.unlocked; i++) if (!b.slots[i]) { k = i; break; }
  if (k < 0) {
    // 가장 싼 알과 비교해 교체 또는 판매
    let lo = 0;
    for (let i = 1; i < b.unlocked; i++) if (b.slots[i].r < b.slots[lo].r) lo = i;
    if (b.slots[lo].r < e.r) {
      const old = b.slots[lo], v = sellEgg(a, old);
      putInSlot(e, b, lo);
      if (a.isPlayer) toast(`둥지가 꽉 차서 ${RAR[old.r].name} 알을 💰${v}에 팔고 교체!`);
    } else {
      e.pos.copy(a.pos);
      const v = sellEgg(a, e);
      if (a.isPlayer) toast(`둥지가 꽉 찼어요 — 알을 💰${v}에 판매 (상점에서 칸 추가)`);
    }
  } else putInSlot(e, b, k);
  if (a.isPlayer) { sfx.deposit(); burst(b.c.clone().setY(1), RAR[e.r].color); }
}
function punch(a) {
  if (a.punchCD > 0 || a.stun > 0) return;
  a.punchCD = 0.7; a.punchAnim = 0.22;
  if (a.isPlayer) sfx.punch();
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), range = 2.5 + a.lv.punch * 0.3;
  let best = null, bd = range;
  for (const o of agents) {
    if (o === a) continue;
    const dx = o.pos.x - a.pos.x, dz = o.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d > bd || Math.abs(o.pos.y - a.pos.y) > 1.4) continue;
    if (d > 1.2 && (dx * fx + dz * fz) / d < 0.25) continue;
    best = o; bd = d;
  }
  if (!best) return;
  const t = best, dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
  t.stun = 1.2 + a.lv.punch * 0.35;
  t.vel.set((dx / d) * 9, 0, (dz / d) * 9); t.vy = 4;
  const had = t.carry;
  dropCarry(t);
  burst(t.pos.clone().setY(1.6), 0xffffff, 8);
  if (a.isPlayer || t.isPlayer) sfx.hit();
  if (a.isPlayer) toast(had ? `👊 ${t.name}를 때려서 알을 떨어뜨렸다!` : `👊 ${t.name} 기절!`, 'good');
  if (t.isPlayer) toast(had ? `💫 ${a.name}에게 맞아서 알을 떨어뜨렸어요!` : `💫 ${a.name}에게 맞았어요!`, 'bad');
}
function lockBase(b) {
  if (!lockReady(b)) return false;
  const d = lockDur(b);
  b.lockUntil = gameTime + d; b.lockReadyAt = gameTime + d + 30;
  if (b.owner.isPlayer) { sfx.lock(); toast(`🛡️ 기지 잠금! ${d}초 동안 아무도 못 들어와요`, 'good'); }
  else if (dist2(player.pos, b.c) < 20) toast(`${b.owner.name}가 기지를 잠갔어요!`);
  return true;
}
function upgCost(a, k) {
  const lv = k === 'slot' ? a.base.unlocked - 5 : a.lv[k];
  return UPG[k].cost[lv];
}
function buy(a, k) {
  const c = upgCost(a, k);
  if (c === undefined || a.money < c) return false;
  a.money -= c;
  if (k === 'slot') { a.base.unlocked++; refreshPeds(a.base); } else a.lv[k]++;
  return true;
}

// ───────── 봇 AI ─────────
function aiThink(b) {
  const ai = b.ai, B = b.base;
  ai.target = null; ai.type = 'idle'; ai.goal = null;
  // 업그레이드
  if (Math.random() < 0.3) {
    const full = B.slots.slice(0, B.unlocked).every(Boolean);
    for (const k of full ? ['slot', 'speed', 'punch', 'lock'] : ['speed', 'punch', 'slot', 'lock']) if (buy(b, k)) break;
  }
  if (b.carry) { ai.type = 'home'; ai.goal = B.c; return; }
  // 방어: 침입자가 있으면 잠금
  const intruders = agents.filter((o) => o !== b && dist2(o.pos, B.c) < BASE_R + 1);
  if (intruders.length && B.slots.some(Boolean) && lockReady(B) && Math.random() < diff.alert) lockBase(B);
  // 내 알을 든 도둑 추격
  const thief = agents.find((o) => o !== b && o.carry && o.carry.home === B && dist2(o.pos, b.pos) < 22);
  if (thief) { ai.type = 'chase'; ai.target = thief; return; }
  const near = intruders.find((o) => dist2(o.pos, b.pos) < 14);
  if (near && Math.random() < 0.7) { ai.type = 'chase'; ai.target = near; return; }
  // 가장 이득인 알 찾기
  let best = null, bs = 0;
  for (const e of eggs) {
    if (!canGrab(b, e)) continue;
    const d = dist2(b.pos, e.pos);
    const s = (RAR[e.r].cps * (e.state === 'ground' ? 1.4 : 1) * (e.base && e.base.owner.isPlayer ? 1.15 : 1)) / (d + 10) * rand(0.8, 1.2);
    if (s > bs) { bs = s; best = e; }
  }
  if (best) { ai.type = 'egg'; ai.target = best; return; }
  ai.goal = B.c.clone().add(new THREE.Vector3(rand(-6, 6), 0, rand(-6, 6)));
}
function steer(a, gx, gz) {
  let dx = gx - a.pos.x, dz = gz - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return { x: 0, z: 0 };
  dx /= d; dz /= d;
  const obs = obstacles.concat(bases.filter((b) => b !== a.base && isLocked(b)).map((b) => ({ x: b.c.x, z: b.c.z, r: BASE_R })));
  for (const o of obs) {
    const ox = a.pos.x - o.x, oz = a.pos.z - o.z, od = Math.hypot(ox, oz) || 1, reach = o.r + 2.2;
    if (od > reach + 1.5 || od > d + o.r) continue;
    const ahead = -(ox * dx + oz * dz) / od;
    if (ahead < 0) continue;
    let tx = -oz / od, tz = ox / od;
    if (tx * dx + tz * dz < 0) { tx = -tx; tz = -tz; }
    const w = ((reach + 1.5 - od) / (reach + 1.5)) * 2.5 * (ahead + 0.2);
    dx += tx * w; dz += tz * w;
  }
  if (a.ai.jitter > 0) { dx += a.ai.jx * 2; dz += a.ai.jz * 2; }
  const n = Math.hypot(dx, dz) || 1;
  return { x: dx / n, z: dz / n };
}
function aiUpdate(b, dt) {
  const ai = b.ai;
  b.move = { x: 0, z: 0 };
  if (b.stun > 0) return;
  ai.t -= dt;
  const t = ai.target;
  if (ai.t <= 0 || (ai.type === 'egg' && (!eggs.includes(t) || !canGrab(b, t))) || (ai.type === 'chase' && t.stun > 0 && !t.carry)) {
    aiThink(b); ai.t = diff.think * rand(0.8, 1.2);
  }
  // 근처 적 도둑은 바로 때리기
  for (const o of agents) {
    if (o === b || b.carry) continue;
    if ((o.carry || dist2(o.pos, b.base.c) < BASE_R) && dist2(o.pos, b.pos) < 2.0 && o.stun <= 0) {
      b.yaw = Math.atan2(o.pos.x - b.pos.x, o.pos.z - b.pos.z); punch(b);
    }
  }
  let goal = ai.goal;
  if (ai.type === 'egg') goal = ai.target.pos;
  if (ai.type === 'chase') goal = ai.target.pos;
  if (!goal) return;
  const d = dist2(b.pos, goal);
  if (ai.type === 'egg' && d < 1.6) { grab(b, ai.target); ai.t = 0; return; }
  if (ai.type === 'home' && d < 4) return; // 기지 도착 → 자동 보관
  if (ai.type === 'idle' && d < 1) return;
  // 끼임 감지
  ai.stuckT += dt;
  if (ai.stuckT > 1.2) {
    if (ai.last && dist2(ai.last, b.pos) < 0.8) { ai.jitter = 0.7; const r = rand(0, 6.28); ai.jx = Math.cos(r); ai.jz = Math.sin(r); }
    ai.last = b.pos.clone(); ai.stuckT = 0;
  }
  ai.jitter -= dt;
  b.move = steer(b, goal.x, goal.z);
}

// ───────── 입력 ─────────
const keys = new Set();
let camYaw = 0, camPitch = 0.55, camDist = 13, shopOpen = false;
const touchMove = { x: 0, y: 0 };
addEventListener('keydown', (e) => {
  if (!running) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (e.repeat) return;
  if (k === 'b') toggleShop();
  if (shopOpen) return;
  if (k === 'e') playerGrab();
  if (k === 'f') punch(player);
  if (k === 'q') playerLock();
  if (k === ' ') { jump(player); e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function playerGrab() {
  const e = nearestGrab(player);
  if (e) grab(player, e);
}
function playerLock() {
  const b = player.base;
  if (isLocked(b)) return;
  if (!lockReady(b)) { sfx.bad(); toast(`잠금 대기 중 (${Math.ceil(b.lockReadyAt - gameTime)}초)`); return; }
  lockBase(b);
}
function jump(a) {
  if (a.pos.y > 0.01 || a.stun > 0) return;
  a.vy = 8.5;
  if (a.isPlayer) sfx.jump();
}
// 마우스: 드래그 = 시점, 짧은 클릭 = 펀치
let drag = null;
canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() }; });
addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
  camYaw -= dx * 0.006; camPitch = clamp(camPitch + dy * 0.004, 0.12, 1.25);
});
addEventListener('mouseup', () => {
  if (drag && running && !shopOpen && drag.moved < 6 && performance.now() - drag.t < 300) punch(player);
  drag = null;
});
canvas.addEventListener('wheel', (e) => { camDist = clamp(camDist + e.deltaY * 0.01, 6, 24); e.preventDefault(); }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// 터치
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
const stick = $('stick'), knob = $('knob');
let stickId = null, lookId = null, lookLast = null;
stick.addEventListener('touchstart', (e) => { stickId = e.changedTouches[0].identifier; moveStick(e.changedTouches[0]); e.preventDefault(); });
function moveStick(t) {
  const r = stick.getBoundingClientRect();
  let x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2);
  const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
  touchMove.x = x; touchMove.y = y;
  knob.style.transform = `translate(${x * 40}px, ${y * 40}px)`;
}
canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lookLast = { x: t.clientX, y: t.clientY }; });
addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) moveStick(t);
    else if (t.identifier === lookId) {
      camYaw -= (t.clientX - lookLast.x) * 0.008; camPitch = clamp(camPitch + (t.clientY - lookLast.y) * 0.005, 0.12, 1.25);
      lookLast = { x: t.clientX, y: t.clientY };
    }
  }
}, { passive: false });
addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) { stickId = null; touchMove.x = touchMove.y = 0; knob.style.transform = ''; }
    if (t.identifier === lookId) lookId = null;
  }
});
document.querySelectorAll('#mbtns button').forEach((btn) => btn.addEventListener('touchstart', (e) => {
  e.preventDefault(); e.stopPropagation();
  const act = btn.dataset.act;
  if (act === 'shop') return toggleShop();
  if (shopOpen) return;
  ({ grab: playerGrab, punch: () => punch(player), jump: () => jump(player), lock: playerLock })[act]();
}));

// ───────── 상점 ─────────
function toggleShop() {
  shopOpen = !shopOpen;
  $('shop').classList.toggle('hidden', !shopOpen);
  if (shopOpen) renderShop();
}
function renderShop() {
  const list = $('shopList'); list.innerHTML = '';
  for (const k of Object.keys(UPG)) {
    const u = UPG[k], c = upgCost(player, k), lv = k === 'slot' ? player.base.unlocked - 5 : player.lv[k];
    const row = document.createElement('div'); row.className = 'item';
    row.innerHTML = `<div class="ic">${u.icon}</div><div class="tx"><b>${u.name}</b> Lv.${lv}<small>${u.desc}</small></div>`;
    const btn = document.createElement('button'); btn.className = 'btn';
    btn.textContent = c === undefined ? '최대' : `💰 ${c}`;
    btn.disabled = c === undefined || player.money < c;
    btn.onclick = () => { if (buy(player, k)) { sfx.buy(); renderShop(); } };
    row.append(btn); list.append(row);
  }
}
$('shopClose').onclick = toggleShop;

// ───────── 게임 시작 / 종료 ─────────
function clearWorld() {
  for (const a of agents) scene.remove(a.av.g);
  for (const e of eggs) scene.remove(e.mesh);
  for (const p of particles) scene.remove(p.m);
  agents = []; eggs = []; particles = [];
}
function startGame() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } }
  if (ac && ac.state === 'suspended') ac.resume();
  diff = DIFF[+document.querySelector('input[name=diff]:checked').value];
  clearWorld();
  if (!bases.length) for (let i = 0; i < 4; i++) bases.push(makeBase(i));
  gameTime = 0; spawnT = 2; incomeT = 1;
  for (const b of bases) { b.slots.fill(null); b.unlocked = 5; b.lockUntil = 0; b.lockReadyAt = 0; }
  agents = bases.map((b, i) => makeAgent(i, i === 0));
  player = agents[0];
  for (const b of bases) {
    refreshPeds(b);
    [0, 0, 1].forEach((r, k) => { const e = makeEgg(r); e.pos.copy(b.slotPos[k]).setY(0.4); putInSlot(e, b, k); });
  }
  camYaw = Math.atan2(-player.base.f.x, -player.base.f.z);
  $('start').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  running = true;
  toast('남의 기지에서 알을 훔쳐 오세요! 🥚');
}
function endGame() {
  running = false;
  if (shopOpen) toggleShop();
  const rank = [...agents].sort((a, b) => b.earned - a.earned);
  const won = rank[0] === player;
  $('endTitle').textContent = won ? '🏆 우승!' : `${rank.indexOf(player) + 1}등`;
  $('endList').innerHTML = rank.map((a) => `<li style="color:${a.team.css}"><b>${a.name}</b> — 💰 ${Math.floor(a.earned)} (알 ${a.base.slots.filter(Boolean).length}개)</li>`).join('');
  $('hud').classList.add('hidden'); $('end').classList.remove('hidden');
  if (won) for (let i = 0; i < 5; i++) tone(523 * 2 ** (i / 4), 0.2, 'triangle', 0.1, i * 0.12);
}
$('startBtn').onclick = startGame;
$('againBtn').onclick = () => { $('end').classList.add('hidden'); $('start').classList.remove('hidden'); };

// ───────── 업데이트 ─────────
const tmpV = new THREE.Vector3();
function update(dt) {
  gameTime += dt;
  if (gameTime >= ROUND) { endGame(); return; }

  // 플레이어 입력
  let ix = 0, iz = 0;
  if (!shopOpen) {
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    ix += touchMove.x; iz -= touchMove.y;
  }
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  player.move = { x: mx, z: mz };

  for (const a of agents) if (!a.isPlayer) aiUpdate(a, dt);

  // 물리
  for (const a of agents) {
    a.punchCD -= dt; a.punchAnim -= dt;
    const sp = speedOf(a);
    if (a.stun > 0) {
      a.stun -= dt;
      a.vel.multiplyScalar(Math.pow(0.02, dt));
    } else {
      const k = 1 - Math.pow(0.0005, dt);
      a.vel.x += (a.move.x * sp - a.vel.x) * k;
      a.vel.z += (a.move.z * sp - a.vel.z) * k;
      if (Math.hypot(a.move.x, a.move.z) > 0.1) {
        const ty = Math.atan2(a.move.x, a.move.z);
        let dy = ty - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * 14);
      }
    }
    a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
    a.vy -= 24 * dt; a.pos.y += a.vy * dt;
    if (a.pos.y < 0) { a.pos.y = 0; a.vy = 0; }
    // 충돌
    a.pos.x = clamp(a.pos.x, -ARENA, ARENA); a.pos.z = clamp(a.pos.z, -ARENA, ARENA);
    for (const o of obstacles) {
      const dx = a.pos.x - o.x, dz = a.pos.z - o.z, d = Math.hypot(dx, dz), m = o.r + 0.45;
      if (d < m && d > 0) { a.pos.x = o.x + (dx / d) * m; a.pos.z = o.z + (dz / d) * m; }
    }
    for (const b of bases) {
      if (b === a.base || !isLocked(b)) continue;
      const dx = a.pos.x - b.c.x, dz = a.pos.z - b.c.z, d = Math.hypot(dx, dz) || 0.01, m = BASE_R + 0.5;
      if (d < m) { a.pos.x = b.c.x + (dx / d) * m; a.pos.z = b.c.z + (dz / d) * m; }
    }
    // 기지 도착 → 알 보관
    if (a.carry && dist2(a.pos, a.base.c) < BASE_R - 1.5) deposit(a);
    // 잠금 발판
    if (dist2(a.pos, a.base.padPos) < 1.0 && !isLocked(a.base) && lockReady(a.base) && a.pos.y < 0.3) lockBase(a.base);
  }
  // 캐릭터끼리 밀어내기
  for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
    const a = agents[i], b = agents[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < 1.0 && d > 0) {
      const p = (1.0 - d) / 2;
      a.pos.x -= (dx / d) * p; a.pos.z -= (dz / d) * p; b.pos.x += (dx / d) * p; b.pos.z += (dz / d) * p;
    }
  }

  // 알
  for (const e of [...eggs]) {
    if (e.state === 'fly') {
      const f = e.fly; f.t += dt;
      const t = Math.min(1, f.t / f.dur);
      e.pos.lerpVectors(f.from, f.to, t); e.pos.y += Math.sin(t * Math.PI) * 2.5;
      if (t >= 1) { e.fly = null; f.done(); }
    } else if (e.state === 'carry') {
      const c = e.carrier;
      e.pos.set(c.pos.x, c.pos.y + 2.4, c.pos.z);
    } else if (e.state === 'ground') {
      e.groundT += dt;
      // 오래 방치된 알은 원래 기지로 돌아감
      const h = e.home;
      if (h && e.groundT > 15) {
        const k = h.slots.findIndex((s, i) => !s && i < h.unlocked);
        if (k >= 0) putInSlot(e, h, k);
        else e.groundT = 0;
      }
    }
    e.mesh.position.copy(e.pos);
    if (e.state === 'ground') { e.mesh.position.y = 0.1 + Math.abs(Math.sin(gameTime * 3)) * 0.25; e.mesh.rotation.y += dt * 2; }
    else if (e.state === 'slot') e.mesh.rotation.y += dt * 0.6;
  }
  eggMats[4].color.setHSL((gameTime * 0.25) % 1, 0.85, 0.65);
  eggMats[4].emissive.copy(eggMats[4].color);

  // 야생 알 생성
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = 6;
    if (eggs.filter((e) => e.state === 'ground' && !e.home).length < 4) {
      const r = rollRarity(0.6), e = makeEgg(r);
      e.pos.set(0, 4, 0);
      const ang = rand(0, Math.PI * 2), rr = rand(5, 10);
      flyEgg(e, new THREE.Vector3(Math.cos(ang) * rr, 0, Math.sin(ang) * rr), 0.9, () => { e.state = 'ground'; e.groundT = 0; });
      if (r >= 3) { toast(`✨ 중앙에 ${RAR[r].name} 알이 나타났어요!`, 'good'); tone(1200, 0.3, 'sine', 0.06); }
    }
  }

  // 수입
  incomeT -= dt;
  if (incomeT <= 0) {
    incomeT += 1;
    for (const b of bases) { const s = baseCps(b); b.owner.money += s; b.owner.earned += s; }
    if (shopOpen) renderShop();
  }

  // 기지 표시
  for (const b of bases) {
    const lk = isLocked(b);
    b.dome.visible = lk;
    if (lk) b.dome.material.opacity = 0.16 + Math.sin(gameTime * 4) * 0.05;
    const col = lk ? 0xef4444 : lockReady(b) ? 0x22c55e : 0x888888;
    b.pad.material.color.set(col); b.pad.material.emissive.set(col);
  }

  // 파티클
  for (const p of particles) {
    p.life -= dt; p.v.y -= 15 * dt;
    p.m.position.addScaledVector(p.v, dt);
    p.m.scale.setScalar(Math.max(0.01, p.life * 1.4));
  }
  particles = particles.filter((p) => { if (p.life > 0) return true; scene.remove(p.m); return false; });

  for (const a of agents) animate(a, dt);
}

function animate(a, dt) {
  const av = a.av, sp = Math.hypot(a.vel.x, a.vel.z);
  av.g.position.copy(a.pos);
  av.g.rotation.y = a.yaw;
  a.walk += dt * sp * 1.5;
  const sw = Math.sin(a.walk) * Math.min(1, sp / 4) * 0.9;
  av.hipL.rotation.x = sw; av.hipR.rotation.x = -sw;
  if (a.carry) { av.shL.rotation.x = av.shR.rotation.x = Math.PI * 0.95; }
  else { av.shL.rotation.x = -sw; av.shR.rotation.x = sw; }
  if (a.punchAnim > 0) av.shR.rotation.x = -Math.PI / 2;
  av.stars.visible = a.stun > 0;
  av.stars.rotation.y += dt * 6;
  av.g.rotation.z = a.stun > 0 ? Math.sin(gameTime * 10) * 0.15 : 0;
}

// ───────── 카메라 / HUD ─────────
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  if (!player) return;
  camTarget.lerp(tmpV.set(player.pos.x, player.pos.y + 1.6, player.pos.z), 1 - Math.pow(0.0001, dt));
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist,
  );
  camera.lookAt(camTarget);
}

const mm = $('minimap').getContext('2d');
let hudT = 0;
function updateHUD(dt) {
  hudT -= dt;
  const near = !player.carry && player.stun <= 0 ? nearestGrab(player) : null;
  const pr = $('prompt');
  if (near) {
    pr.classList.remove('hidden');
    pr.innerHTML = `<kbd>E</kbd>${near.base ? '훔치기' : '줍기'} — <span style="color:${RAR[near.r].css === '#f4efe2' ? '#8a7f66' : RAR[near.r].css}">${RAR[near.r].name}</span> (+${RAR[near.r].cps}/초)`;
  } else if (player.carry) {
    pr.classList.remove('hidden');
    pr.innerHTML = `🥚 ${RAR[player.carry.r].name} 알 운반 중 → 파란 기지로!`;
  } else pr.classList.add('hidden');
  if (hudT > 0) return;
  hudT = 0.1;
  $('money').textContent = Math.floor(player.money);
  $('cps').textContent = baseCps(player.base);
  $('earned').textContent = Math.floor(player.earned);
  const left = Math.max(0, ROUND - gameTime);
  $('timer').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('timer').classList.toggle('warn', left < 30);
  const b = player.base;
  $('lockInfo').textContent = isLocked(b) ? `🛡️ 잠금 중 ${Math.ceil(b.lockUntil - gameTime)}초`
    : lockReady(b) ? '🔒 잠금 준비됨 [Q]' : `⏳ 잠금 대기 ${Math.ceil(b.lockReadyAt - gameTime)}초`;
  $('board').innerHTML = [...agents].sort((x, y) => y.earned - x.earned).map((a) =>
    `<div class="row ${a.isPlayer ? 'me' : ''}"><span class="dot" style="background:${a.team.css}"></span><span class="nm">${a.name}${a.carry ? ' 🥚' : ''}</span>💰${Math.floor(a.earned)}</div>`).join('');
  // 미니맵
  const W = 160, s = W / 2 / 47, P = (x) => W / 2 + x * s;
  mm.clearRect(0, 0, W, W);
  for (const o of obstacles) { mm.fillStyle = 'rgba(30,90,40,.7)'; mm.beginPath(); mm.arc(P(o.x), P(o.z), Math.max(1.5, o.r * s), 0, 7); mm.fill(); }
  for (const bb of bases) {
    mm.globalAlpha = isLocked(bb) ? 0.75 : 0.4; mm.fillStyle = bb.team.css;
    mm.beginPath(); mm.arc(P(bb.c.x), P(bb.c.z), BASE_R * s, 0, 7); mm.fill();
  }
  mm.globalAlpha = 1;
  for (const e of eggs) { mm.fillStyle = RAR[e.r].css; mm.fillRect(P(e.pos.x) - 1.5, P(e.pos.z) - 1.5, 3, 3); }
  for (const a of agents) {
    mm.save(); mm.translate(P(a.pos.x), P(a.pos.z)); mm.rotate(-a.yaw);
    mm.fillStyle = a.team.css; mm.strokeStyle = '#fff'; mm.lineWidth = a.isPlayer ? 2 : 1;
    mm.beginPath(); mm.moveTo(0, 6); mm.lineTo(-4, -4); mm.lineTo(4, -4); mm.closePath(); mm.fill(); mm.stroke();
    mm.restore();
  }
}

// ───────── 루프 ─────────
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (running) { update(dt); if (running) updateHUD(dt); }
  else { camYaw += dt * 0.08; camTarget.set(0, 1, 0); }
  if (running) updateCamera(dt);
  else {
    camera.position.set(Math.sin(camYaw) * 50, 32, Math.cos(camYaw) * 50);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
// 시작 화면 배경용 기지
for (let i = 0; i < 4; i++) { bases.push(makeBase(i)); }
for (const b of bases) b.owner = { lv: { lock: 0 } };
for (const b of bases) refreshPeds(b);
requestAnimationFrame(loop);

// 디버그용
window.__egg = { get agents() { return agents; }, get eggs() { return eggs; }, get bases() { return bases; }, get time() { return gameTime; }, set time(v) { gameTime = v; }, step(n) { for (let i = 0; i < n && running; i++) update(0.05); } };
