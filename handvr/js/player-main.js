// 베이컨 각성 — 하얀 바닥 위 로블록스 베이컨 헤어 플레이어 (걷기·달리기·점프·비행·각성 4단계)
import * as THREE from 'three';
import { createWorld } from './world.js';
import { Bacon, U } from './bacon.js';
import { AwakenFX, LEVELS } from './awaken.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = s => document.querySelector(s);
const V3 = THREE.Vector3;
const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapAng = a => Math.atan2(Math.sin(a), Math.cos(a));
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

// ───────── 렌더러 / 장면 ─────────
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
const world = createWorld(scene, renderer, { sunDist: 40, near: 1, far: 90 });
world.setShadowQuality(2048, 7);

const bacon = new Bacon();
scene.add(bacon.root);
const fx = new AwakenFX(scene, bacon);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: IS_TOUCH ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.15));
composer.addPass(new OutputPass());

let pixelRatio = Math.min(devicePixelRatio, IS_TOUCH ? 1.25 : 1.75);
function resize() {
  renderer.setPixelRatio(pixelRatio); renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
// 느리면 해상도를 한 단계씩 낮춤
const perf = { t: 0, n: 0 };
function autoQuality(now) {
  perf.n++; perf.t ||= now;
  if (now - perf.t < 2000) return;
  const fps = perf.n * 1000 / (now - perf.t);
  perf.t = now; perf.n = 0;
  if (fps < 38 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); if (pixelRatio <= 1) world.setShadowQuality(1024, 7); }
}

// ───────── 소리 (전부 실시간 합성) ─────────
const audio = {
  ctx: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.out = c.createGain(); this.out.gain.value = 0.5; this.out.connect(c.destination);
    const len = c.sampleRate * 2, buf = this.buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type, f, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.out); s.start();
      return { fl, g };
    };
    this.aura = loop('bandpass', 220, 0.9);   // 기운이 타오르는 소리
    this.rumble = loop('lowpass', 90, 0.8);   // 땅울림
    this.wind = loop('bandpass', 700, 0.7);   // 바람
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 50;
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 240;
    const g = c.createGain(); g.gain.value = 0;
    o.connect(fl); fl.connect(g); g.connect(this.out); o.start();
    this.drone = { o, g };
  },
  to(p, v, tc = 0.12) { p.setTargetAtTime(v, this.ctx.currentTime, tc); },
  update(auraK, charging, chargeK, level, speed, flying) {
    if (!this.ctx) return;
    this.to(this.aura.g.gain, auraK * 0.2 + (charging ? 0.15 * chargeK : 0));
    this.to(this.aura.fl.frequency, 180 + level * 90 + (charging ? chargeK * 260 : 0));
    this.to(this.rumble.g.gain, charging ? 0.3 + 0.45 * chargeK : auraK * 0.1);
    this.to(this.drone.g.gain, auraK * 0.045 + (charging ? 0.05 * chargeK : 0));
    this.to(this.drone.o.frequency, 45 + level * 12 + (charging ? chargeK * 30 : 0));
    const w = flying ? sstep(4, 140, speed) : 0;
    this.to(this.wind.g.gain, w * 0.5);
    this.to(this.wind.fl.frequency, 400 + w * 1700);
  },
  boom(k) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2000, t); f.frequency.exponentialRampToValueAtTime(110, t + 1.3);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.85 * k, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + 1.8);
    const o = c.createOscillator(); o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    const og = c.createGain(); og.gain.setValueAtTime(0.7 * k, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(og); og.connect(this.out); o.start(t); o.stop(t + 1.05);
  },
  blip(f0, f1, dur = 0.12, vol = 0.1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  },
};

// ───────── 상태 ─────────
const WALK = 16 * U, SPRINT = 27 * U, JUMP = 50 * U, GRAV = 196.2 * U; // 로블록스 기본값(스터드) → m
const FLY = 16, BOOST = [62, 80, 105, 135, 175];                       // 날기 / 빠르게 날기 최고 속도 (각성 단계별, m/s)
const LEVEL_TIME = [1.7, 1.9, 2.1, 2.4];                                // 다음 단계까지 기 모으는 시간(초)
const P = { pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, roll: 0, yawRate: 0, grounded: true, flying: false };
const A = { level: 0, charging: false, progress: 0 };
const cam = { yaw: Math.PI, pitch: 0.3, dist: 7.5, shake: 0 };
const hair = { k: 0, color: new THREE.Color(1, 1, 1) };
let time = 0, jumpPressed = false, boomArmed = true;

// ───────── UI ─────────
let toastTimer = 0, bannerTimer = 0;
function toast(text, ms = 2200) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function banner(text, css = '#fff', ms = 1600) {
  const el = $('#banner'); el.textContent = text; el.style.setProperty('--lv', css); el.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function flashScreen(css, k) {
  const el = $('#flash');
  el.style.setProperty('--flash', css);
  el.animate([{ opacity: k }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
}
const shake = k => { cam.shake = Math.max(cam.shake, k); };
const helpEl = $('#help');
const toggleHelp = (v = helpEl.classList.contains('hidden')) => helpEl.classList.toggle('hidden', !v);
$('#help-btn').addEventListener('click', () => toggleHelp());
$('#help-close').addEventListener('click', () => { toggleHelp(false); audio.init(); });

// 아이템 칸
function useSlot(n) {
  audio.init();
  const el = document.querySelector(`.slot[data-slot="${n}"]`);
  el.classList.add('tap'); setTimeout(() => el.classList.remove('tap'), 120);
  if (n === 1) {
    if (A.charging) stopCharge(true);
    else if (A.level < 4) startCharge();
    else powerDown();
  } else if (n === 2) toggleFly();
  else if (n === 3) powerDown();
}
for (const el of document.querySelectorAll('.slot')) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); useSlot(+el.dataset.slot); });
}

// ───────── 각성 ─────────
function startCharge() {
  A.charging = true; A.progress = 0;
  toast(A.level ? '기를 더 모으고 있어요' : '기를 모으고 있어요 — 조금만 기다려 주세요', 1800);
  audio.blip(180, 420, 0.4, 0.08);
}
function stopCharge(byUser) {
  if (!A.charging) return;
  A.charging = false; A.progress = 0;
  fx.rocks.drop();
  if (byUser) toast(A.level ? `${LEVELS[A.level].name}에서 멈췄어요` : '기 모으기를 멈췄어요');
}
function powerDown() {
  if (!A.level && !A.charging) return;
  A.charging = false; A.level = 0; A.progress = 0;
  fx.rocks.drop();
  banner('각성 풀림', '#cfe3ff', 1200);
  audio.blip(500, 120, 0.5, 0.1);
}
function updateAwaken(dt) {
  if (!A.charging) return;
  A.progress += dt / LEVEL_TIME[A.level];
  shake(0.04 + 0.1 * A.progress * A.progress);
  if (A.progress < 1) return;
  A.level++; A.progress = 0;
  const L = LEVELS[A.level];
  fx.levelUp(A.level, P.pos, P.pos.y < 1.2);
  shake(0.3 + A.level * 0.15);
  flashScreen(A.level === 4 ? '#ffffff' : L.css, A.level === 4 ? 0.95 : 0.22 + A.level * 0.08); // 4단계는 화면이 하얗게
  audio.boom(0.45 + A.level * 0.15);
  banner(L.name, L.css);
  if (A.level >= 4) { A.charging = false; fx.rocks.drop(); }
}

// ───────── 날기 / 착지 ─────────
function toggleFly() {
  audio.init();
  P.flying = !P.flying;
  if (P.flying) {
    if (P.grounded) { P.vel.y = 7; P.pos.y = Math.max(P.pos.y, 0.05); }
    P.grounded = false;
    audio.blip(260, 640, 0.25, 0.08);
  } else audio.blip(500, 200, 0.2, 0.06);
}
function land(vDown) {
  P.flying = false; P.grounded = true;
  bacon.landed(clamp((vDown - 8) / 40, 0.12, 1));
  if (vDown > 20) {
    const k = clamp((vDown - 20) / 70, 0, 1);
    fx.impact(P.pos, k, A.level ? LEVELS[A.level].color : new THREE.Color(0.85, 0.9, 1));
    shake(0.2 + k * 0.6);
    audio.boom(0.3 + k * 0.7);
  }
}

// ───────── 입력 ─────────
const keys = new Set();
const touch = { x: 0, y: 0, jump: false, down: false, boost: false };
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  audio.init();
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'Space': jumpPressed = true; break;
    case 'Digit1': case 'Numpad1': useSlot(1); break;
    case 'Digit2': case 'Numpad2': useSlot(2); break;
    case 'Digit3': case 'Numpad3': useSlot(3); break;
    case 'KeyF': toggleFly(); break;
    case 'KeyH': toggleHelp(); break;
    case 'Escape': toggleHelp(false); break;
  }
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// 카메라: 화면 끌기 / 휠
const canvas = $('#gl');
const drags = new Map();
canvas.addEventListener('pointerdown', e => {
  audio.init();
  drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') $('#touch').classList.remove('hidden');
});
canvas.addEventListener('pointermove', e => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  if (drags.size === 2) { // 두 손가락: 확대·축소
    const [a, b] = [...drags.values()];
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    d.x = e.clientX; d.y = e.clientY;
    const after = Math.hypot(a.x - b.x, a.y - b.y);
    if (before > 0) cam.dist = clamp(cam.dist * before / after, 3, 40);
    return;
  }
  cam.yaw -= (e.clientX - d.x) * 0.0055;
  cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * 0.0045, -1.1, 1.35);
  d.x = e.clientX; d.y = e.clientY;
});
const endDrag = e => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0012), 3, 40); }, { passive: false });

// 휴대폰: 왼쪽 아래 조이스틱 + 버튼
if (IS_TOUCH) $('#touch').classList.remove('hidden');
const zone = $('#stick-zone'), stick = $('#stick'), knob = $('#knob');
let stickId = null, stickC = { x: 0, y: 0 };
zone.addEventListener('pointerdown', e => {
  audio.init();
  e.preventDefault(); e.stopPropagation();
  stickId = e.pointerId; zone.setPointerCapture(e.pointerId);
  const r = stick.getBoundingClientRect(); // 조이스틱은 제자리 — 가운데를 기준으로
  stickC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  moveStick(e);
});
zone.addEventListener('pointermove', e => moveStick(e));
function moveStick(e) {
  if (e.pointerId !== stickId) return;
  let dx = e.clientX - stickC.x, dy = e.clientY - stickC.y;
  const l = Math.hypot(dx, dy), R = 50;
  if (l > R) { dx *= R / l; dy *= R / l; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  touch.x = dx / R; touch.y = -dy / R;
}
const stickEnd = e => {
  if (e.pointerId !== stickId) return;
  stickId = null; touch.x = touch.y = 0; knob.style.transform = '';
};
zone.addEventListener('pointerup', stickEnd);
zone.addEventListener('pointercancel', stickEnd);
const holdBtn = (id, key, onPress) => {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); audio.init(); touch[key] = true; el.classList.add('down'); el.setPointerCapture(e.pointerId); onPress?.(); });
  const up = () => { touch[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
};
holdBtn('#t-jump', 'jump', () => { jumpPressed = true; });
holdBtn('#t-down', 'down');
holdBtn('#t-boost', 'boost');

function readMove() {
  let x = touch.x, y = touch.y;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y, l: Math.min(1, l) };
}

// ───────── 플레이어 움직임 ─────────
const _f = new V3(), _r = new V3(), _w = new V3(), _look = new V3();
function updatePlayer(dt) {
  const mv = readMove();
  const up = keys.has('Space') || touch.jump;
  const down = keys.has('KeyQ') || keys.has('KeyC') || keys.has('ControlLeft') || touch.down;
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.boost;
  const moving = mv.l > 0.12;
  _f.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  _r.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  if (A.charging && (moving || jumpPressed || (P.flying && (up || down)))) stopCharge(false); // 움직이면 그 단계에서 멈춤

  if (P.flying) {
    // 앞으로 날기: 카메라가 보는 방향 (기본 카메라 높이에서 수평이 되게 맞춤 → 카메라를 내려 올려다보면 위로)
    const el = clamp((0.3 - cam.pitch) * 1.3, -1.45, 1.45);
    _look.copy(_f).multiplyScalar(Math.cos(el)).setY(Math.sin(el));
    _w.copy(_look).multiplyScalar(mv.y).addScaledVector(_r, mv.x);
    if (up) _w.y += 1;
    if (down) _w.y -= 1;
    if (_w.lengthSq() > 1) _w.normalize();
    const top = boost && (moving || up || down) ? BOOST[A.level] : FLY + A.level * 3;
    P.vel.lerp(_w.multiplyScalar(top), 1 - Math.exp(-(boost ? 1.3 : 3.2) * dt));
    P.pos.addScaledVector(P.vel, dt);
    if (P.pos.y <= 0) {
      P.pos.y = 0;
      if (P.vel.y < -22 || (down && !moving)) { const v = -P.vel.y; P.vel.y = 0; land(v); } // 아래로 세게 박으면 착지 (스치듯 날 땐 그대로)
      else P.vel.y = Math.max(0, P.vel.y);
    }
  } else {
    const speed = (boost ? SPRINT : WALK) * (1 + 0.12 * A.level);
    _w.copy(_f).multiplyScalar(mv.y).addScaledVector(_r, mv.x).multiplyScalar(A.charging ? 0 : speed);
    const k = 1 - Math.exp(-(P.grounded ? 16 : 5) * dt);
    P.vel.x += (_w.x - P.vel.x) * k;
    P.vel.z += (_w.z - P.vel.z) * k;
    if (P.grounded) {
      if (up && !A.charging) { P.vel.y = JUMP * (1 + 0.15 * A.level); P.grounded = false; audio.blip(300, 520, 0.12, 0.05); }
    } else if (jumpPressed) toggleFly(); // 공중에서 한 번 더 → 날기
    if (!P.grounded && !P.flying) {
      P.vel.y -= GRAV * dt;
      P.pos.addScaledVector(P.vel, dt);
      if (P.pos.y <= 0) { P.pos.y = 0; const v = -P.vel.y; P.vel.y = 0; land(v); }
    } else if (P.grounded) P.pos.addScaledVector(P.vel, dt);
  }
  jumpPressed = false;

  // 바라보는 방향: 걷는 쪽 / 나는 쪽 (가만히 떠 있으면 카메라 앞쪽)
  const hs = Math.hypot(P.vel.x, P.vel.z), sp = P.vel.length();
  let ty = P.yaw;
  if (P.flying) ty = hs > 1.5 ? Math.atan2(P.vel.x, P.vel.z) : (moving ? ty : Math.atan2(_f.x, _f.z));
  else if (moving && !A.charging) ty = Math.atan2(_w.x, _w.z);
  const dy = wrapAng(ty - P.yaw) * (1 - Math.exp(-dt * (P.flying ? 6 : 14)));
  P.yaw += dy;
  P.yawRate += (dy / Math.max(dt, 1e-3) - P.yawRate) * (1 - Math.exp(-dt * 8));
  // 몸 기울이기: 빠르게 날면 진행 방향으로 눕고, 돌 때 옆으로 기움
  const fast = P.flying ? sstep(5, 24, sp) : 0;
  let pt = 0;
  if (P.flying && sp > 0.5) pt = fast * (Math.PI / 2 - Math.asin(clamp(P.vel.y / sp, -1, 1))) + (1 - fast) * 0.22 * clamp(hs / 8, 0, 1);
  P.pitch += (pt - P.pitch) * (1 - Math.exp(-dt * 5));
  P.roll += (clamp(-P.yawRate * 0.3 * fast, -0.8, 0.8) - P.roll) * (1 - Math.exp(-dt * 5));
  return { sp, hs, fast };
}

// ───────── 카메라 ─────────
const _t = new V3(), _o = new V3();
function updateCamera(dt, sp) {
  const speedK = P.flying ? sstep(20, 130, sp) : 0;
  _t.copy(P.pos); _t.y += 1.45;
  const d = cam.dist * (1 + 0.35 * speedK);
  _o.set(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch)).multiplyScalar(d);
  camera.position.copy(_t).add(_o);
  if (camera.position.y < 0.25) camera.position.y = 0.25;
  camera.lookAt(_t);
  cam.shake *= Math.exp(-dt * 4.5);
  const s = cam.shake;
  if (s > 0.002) {
    camera.position.x += (Math.sin(time * 71) + Math.sin(time * 43.7)) * s * 0.12;
    camera.position.y += (Math.sin(time * 67.3) + Math.sin(time * 39.1)) * s * 0.12;
    camera.rotateZ(Math.sin(time * 53) * s * 0.03);
  }
  const fov = 70 + 22 * speedK + (A.charging ? 4 * A.progress : 0);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix(); }
}

// ───────── 화면 정보 ─────────
const pips = [...document.querySelectorAll('.pips i b')];
const slots = [...document.querySelectorAll('.slot')];
let hudT = 0;
function updateHUD(dt, sp) {
  const L = LEVELS[A.level];
  pips.forEach((b, i) => { b.style.width = (i < A.level ? 100 : i === A.level && A.charging ? A.progress * 100 : 0) + '%'; });
  document.documentElement.style.setProperty('--lv', A.charging ? LEVELS[Math.min(4, A.level + 1)].css : L.css);
  slots[0].classList.toggle('on', A.charging || A.level > 0);
  slots[0].classList.toggle('charging', A.charging);
  slots[1].classList.toggle('on', P.flying);
  $('#t-down').classList.toggle('hidden', !P.flying);
  if ((hudT += dt) < 0.1) return;
  hudT = 0;
  $('#gauge-label').textContent = A.charging ? `${A.level ? L.name : '각성 전'} · 기 모으는 중` : L.name;
  $('#spd').textContent = Math.round(sp * 3.6);
  $('#alt').textContent = Math.round(P.pos.y);
}

// ───────── 메인 루프 ─────────
const clock = new THREE.Clock();
const _c = new V3(), _dir = new V3(), focus = new V3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  const { sp, hs, fast } = updatePlayer(dt);
  updateAwaken(dt);

  bacon.root.position.copy(P.pos);
  bacon.root.rotation.y = P.yaw;
  bacon.tilt.rotation.set(P.pitch, 0, P.roll);
  bacon.update(dt, { speed: hs, vy: P.vel.y, grounded: P.grounded, flying: P.flying, fast, charging: A.charging,
    strain: A.charging ? sstep(0.55, 1, A.progress) : 0, level: A.level });
  // 머리카락: 3단계 금발, 4단계 붉게
  const hk = [0, 0.1, 0.15, 0.2, 0.75][A.level]; // 4단계는 금빛 머리
  hair.k += (hk - hair.k) * (1 - Math.exp(-dt * 4));
  hair.color.lerp(LEVELS[A.level].color, 1 - Math.exp(-dt * 4));
  bacon.tintHair(hair.color, hair.k);

  bacon.body.visible = fx.beam.k < 0.55; // 빛줄기가 되면 몸은 빛 속으로
  updateCamera(dt, sp);
  scene.updateMatrixWorld();
  fx.update(dt, { level: A.level, chargeK: A.progress, charging: A.charging, flying: P.flying, speed: sp, fast, vel: P.vel,
    grounded: P.grounded, pos: P.pos, camPos: camera.position });

  // 음속 돌파
  if (P.flying && sp > 60 && boomArmed) { // 빛줄기가 되는 순간
    boomArmed = false;
    _c.copy(P.pos); _c.y += 0.95;
    fx.sonicBoom(_c, _dir.copy(P.vel).normalize());
    shake(0.4); flashScreen('#ffffff', 0.45); audio.boom(0.75);
  }
  if (sp < 50) boomArmed = true;

  focus.copy(P.pos); focus.y += 1;
  world.update(dt, P.pos, focus);
  audio.update(fx.aura.k, A.charging, A.progress, A.level, sp, P.flying);
  updateHUD(dt, sp);
  composer.render();
  autoQuality(now);
}
requestAnimationFrame(frame);

// 디버그·테스트용
window.bacon = { P, A, useSlot, toggleFly, cam };
