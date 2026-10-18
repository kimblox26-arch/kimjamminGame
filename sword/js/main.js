// 메인: 렌더러, 고정 120Hz 시뮬레이션 + 렌더 보간, 120fps 프레임 제한, 적응형 해상도, HUD
import * as THREE from 'three';
import { World } from './world.js';
import { FX } from './fx.js';
import { Post } from './post.js';
import { GameAudio } from './audio.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';

const SIM_HZ = 120;
const STEP = 1 / SIM_HZ;
const $ = (id) => document.getElementById(id);

const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const quality = new URLSearchParams(location.search).get('q') || (isMobile ? 'low' : 'high');

// ── 렌더러 ──
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const maxPR = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.5 : 2);
let pixelRatio = maxPR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 30000);
camera.position.set(0, 2.5, -8);

// ── 모듈 ──
// 해: 스폰 카메라의 오른쪽 뒤, 고도 30° → 캐릭터 면마다 명암이 갈려 하얀 바닥 위에서도 형태가 또렷함
const sunDir = new THREE.Vector3(-0.66, 0.5, -0.56).normalize();
const world = new World(renderer, scene, { quality, sunDir });
world.params.sunIntensity = 2.75;
world.params.hemiIntensity = 1.05;
world.applyParams();
const post = new Post(renderer, scene, camera, { quality });
const audio = new GameAudio();
const rig = new CameraRig(camera);

let timeScale = 1, hitStopT = 0, hitStopScale = 1;
let flash = 0;
const _uv = new THREE.Vector3();
const hooks = {
  shake: (a) => rig.addTrauma(a),
  flash: (a) => { flash = Math.max(flash, a); },
  fovKick: (d) => rig.kickFov(d),
  shockwave: (pos, s) => {
    _uv.copy(pos).project(camera);
    if (_uv.z < 1) post.addShockwave(new THREE.Vector2(_uv.x * 0.5 + 0.5, _uv.y * 0.5 + 0.5), s);
  },
};
const fx = new FX(scene, camera, hooks, { quality, sunDir });
const game = {
  fx, audio, hooks,
  hitStop(dur, scale) { hitStopT = Math.max(hitStopT, dur); hitStopScale = scale; },
};
const player = new Player(scene, game);

const ui = {
  joy: $('joy'), knob: $('knob'),
  buttons: document.querySelectorAll('#touch [data-edge], #touch [data-hold]'),
};
const input = new Input(canvas, ui);
input.onFirstGesture = () => { audio.unlock(); $('start').classList.add('hide'); };
if (input.isTouch) document.body.classList.add('touch');

// ── 설정 토글 ──
let fpsCap = true;
input.onKey = (code) => {
  if (code === 'KeyM') { audio.muted = !audio.muted; toast(audio.muted ? '소리 끔' : '소리 켬'); }
  if (code === 'KeyH') $('help').classList.toggle('hide');
  if (code === 'KeyP') { fpsCap = !fpsCap; toast(fpsCap ? 'FPS 제한: 120' : 'FPS 제한: 없음 (모니터 주사율)'); }
};
$('btn-mute')?.addEventListener('click', () => { audio.muted = !audio.muted; $('btn-mute').textContent = audio.muted ? '🔇' : '🔊'; });
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); toastT = 1.6; }

// 셰이더 미리 컴파일 (첫 부스트/폭발 시 끊김 방지)
post.bloom.threshold = 1.25;   // 하얀 캐릭터/바닥은 번지지 않고 해·불꽃만 빛나게
try { post.prewarm(); } catch (e) { console.warn(e); }

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  post.setSize(w, h);
}
addEventListener('resize', resize);
resize();

// ── HUD ──
const hud = {
  speed: $('h-speed'), unit: $('h-unit'), mach: $('h-mach'), alt: $('h-alt'), state: $('h-state'),
  fps: $('h-fps'), bar: $('h-bar'), res: $('h-res'),
};
const stamUi = { el: $('stam'), fill: $('stam-fill'), v: -1, ex: null, full: null };
function updateStamina() {
  const v = Math.round(player.stamina * 4) / 400;
  if (v !== stamUi.v) { stamUi.v = v; stamUi.fill.style.transform = `scaleX(${v})`; }
  const full = v >= 1 && !player.sprinting;
  if (full !== stamUi.full) { stamUi.full = full; stamUi.el.classList.toggle('full', full); }
  if (player.exhausted !== stamUi.ex) { stamUi.ex = player.exhausted; stamUi.el.classList.toggle('ex', player.exhausted); }
}
const STATE_NAME = { ground: '지상', air: '공중', fly: '비행', hero: '착지!', launch: '이륙' };
let hudT = 0;
function updateHud(dt, fps) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.08;
  const kmh = player.speed * 3.6;
  hud.speed.textContent = kmh < 100 ? kmh.toFixed(0) : Math.round(kmh).toLocaleString();
  hud.mach.textContent = 'MACH ' + player.mach.toFixed(2);
  hud.mach.classList.toggle('super', player.mach >= 1);
  hud.alt.textContent = Math.max(0, player.pos.y - 1).toFixed(0) + ' m';
  let st = STATE_NAME[player.mode];
  if (player.mode === 'fly') {
    if (player.mach >= 1.6) st = '극초음속 · 보우쇼크';
    else if (player.mach >= 1) st = '초음속';
    else if (player.boostAmt > 0.5) st = '부스트';
    else if (player.slow) st = '느리게 비행';
    else if (player.speed < 3) st = '호버링';
  }
  if (player.mode === 'ground' && player.exhausted) st = '탈진';
  else if (player.mode === 'ground' && player.sprinting) st = '질주';
  if (player.trick) st = { roll: '배럴 롤', flip: '공중제비', cart: '옆돌기' }[player.trick.type];
  hud.state.textContent = st;
  hud.bar.style.transform = `scaleX(${Math.min(1, player.mach / 4.4).toFixed(3)})`;
  hud.fps.textContent = fps.toFixed(0) + ' FPS';
  hud.fps.classList.toggle('good', fps >= 115);
  hud.res.textContent = '×' + pixelRatio.toFixed(2);
}

// ── 루프 ──
let last = performance.now();
let vsyncN = 0;
let acc = 0;
let fpsFrames = 0, fpsTime = 0, fps = 0;
// 적응형 해상도: 목표 = min(120, 모니터 주사율)
let refreshEst = 60, lastRaf = 0, perfT = 0, perfFrames = 0, slowSecs = 0, fastSecs = 0;
let failPR = Infinity, failT = 0;
const rafSamples = new Float32Array(60);
let rafN = 0, measured = false;
const elapsed = { t: 0 };
const dbg = { paused: false, pending: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  // 모니터 주사율 추정: 렌더 없이 도는 rAF 간격의 중앙값 (시작 직후 60틱은 측정만 함)
  if (lastRaf) {
    rafSamples[rafN % 60] = now - lastRaf;
    rafN++;
    if (rafN % 60 === 0) {
      const sorted = Array.from(rafSamples).sort((a, b) => a - b);
      const est = 1000 / Math.max(1, sorted[30]);
      if (!measured) { refreshEst = est; measured = true; }
      else if (est > refreshEst * 1.15) refreshEst = Math.min(360, est);   // 더 빠른 주사율이 관측될 때만 올림
    }
  }
  lastRaf = now;
  if (!measured) { last = now; return; }

  // 120fps 제한: 주사율의 정수배로만 건너뜀 (240Hz → 120, 144Hz는 그대로) → 프레임 간격이 고르게 유지됨
  const div = Math.max(1, Math.round(refreshEst / 120));
  if (fpsCap && div > 1 && (++vsyncN % div) !== 0) return;
  // rAF 타임스탬프가 로드 시점보다 앞설 수 있으니 음수 dt 방지
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;

  // 히트스톱 (충격 순간 시간이 잠깐 멈칫)
  if (hitStopT > 0) { hitStopT -= dt; timeScale = hitStopScale; } else timeScale += (1 - timeScale) * (1 - Math.exp(-20 * dt));

  input.poll();
  let simDt = dt * timeScale;
  // 디버그(테스트 하네스): 일시정지 후 정확한 시간만큼 진행
  if (dbg.paused) { simDt = dbg.pending; dbg.pending = 0; dt = simDt; }
  acc += simDt;
  let steps = 0;
  const maxSteps = dbg.paused ? 1e6 : 12;
  while (acc >= STEP && steps < maxSteps) {
    player.step(STEP, input, rig);
    acc -= STEP;
    steps++;
  }
  if (steps === maxSteps) acc = 0;
  player.interpolate(acc / STEP);
  player.updateVisual(dt);

  elapsed.t += dt;
  rig.update(dt, player, input);
  world.update(dt, elapsed.t, camera, player.renderPos);
  fx.update(dt * Math.max(timeScale, 0.15), player.ctx);
  audio.update(dt, player.audioState);

  // 후처리 파라미터
  const P = post.params;
  const sp = player.speed;
  P.speed = Math.min(1, Math.max(0, (sp - 30) / 600)) * 0.85 + player.boostAmt * 0.12 * Math.min(1, sp / 80);
  P.heat = Math.min(1, Math.max(0, (player.mach - 1.5) / 1.5)) * (player.flying ? 1 : 0);
  P.chroma = Math.min(1, P.speed * 0.8 + flash * 0.5);
  P.vignette = 0.28 + P.speed * 0.35;
  flash = Math.max(0, flash - dt * 2.6);
  P.flash = flash;
  _uv.copy(player.renderPos).project(camera);
  P.focus.set(_uv.x * 0.5 + 0.5, _uv.y * 0.5 + 0.5);
  post.render(dt);

  // FPS / 적응형 해상도
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
  perfT += dt; perfFrames++;
  if (perfT >= 1) {
    const f = perfFrames / perfT;
    const target = Math.min(120, refreshEst) * 0.92;
    if (f < target) { slowSecs++; fastSecs = 0; } else { fastSecs++; slowSecs = 0; }
    // 실패한 해상도는 30초 동안 다시 시도하지 않음 (오르내림 반복 방지)
    if (slowSecs >= 2 && pixelRatio > 0.6) { failPR = pixelRatio; failT = 30; pixelRatio = Math.max(0.6, pixelRatio - 0.15); resize(); slowSecs = 0; }
    failT = Math.max(0, failT - 1);
    if (failT === 0) failPR = Infinity;
    if (fastSecs >= 5 && pixelRatio < maxPR && pixelRatio + 0.1 < failPR - 1e-3) { pixelRatio = Math.min(maxPR, pixelRatio + 0.1); resize(); fastSecs = 0; }
    perfT = 0; perfFrames = 0;
  }
  updateHud(dt, fps);
  updateStamina();
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
}
requestAnimationFrame(frame);
window.__game = { player, rig, input, fx, world, post, audio, renderer, camera, scene, dbg };
