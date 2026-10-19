// 메인: 렌더러, 고정 120Hz 시뮬레이션 + 렌더 보간, 120fps 프레임 제한, 적응형 해상도, HUD
import * as THREE from 'three';
import { World } from './world.js';
import { FX } from './fx.js';
import { Post } from './post.js';
import { GameAudio } from './audio.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import * as terrainMod from './terrain.js';
import * as frameMod from './frame.js';
import { Terrain } from './terrain.js';
import { City } from './city.js';
import { Space } from './space.js';
import { Cosmic } from './cosmic.js';
import { Water } from './water.js';
import { Trees } from './trees.js';
import { origin, rebase, onRebase, flatToPlanet, planetToFlat, localToPlanetQuat, airDensity, ATMO_TOP, SUN_DIR, C_LIGHT, BODY } from './frame.js';
import { TARGETS } from './player.js';

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
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2e6);
camera.position.set(0, 2.5, -8);

// ── 모듈 ──
// 해: 스폰 카메라의 오른쪽 뒤, 고도 30° → 캐릭터 면마다 명암이 갈려 하얀 바닥 위에서도 형태가 또렷함
const sunDir = SUN_DIR.clone();
const world = new World(renderer, scene, { quality, sunDir });
const terrain = new Terrain(renderer, scene, { quality, sunDir });
const city = new City(renderer, scene, { quality, sunDir });
const water = new Water(renderer, scene, { quality, envMap: city.envMap });
const trees = new Trees(renderer, scene, { quality, envMap: city.envMap, footprint: (x, z) => city.roofAt(x, z) });
const space = new Space(renderer, { quality });
world.params.sunIntensity = 2.75;
world.params.hemiIntensity = 1.05;
world.applyParams();
const post = new Post(renderer, scene, camera, { quality });
post.attachSpace(space.scene, space.camera);
post.nearCam.layers.enable(2);   // 구름 속 안개 오버레이는 근거리 패스에서 한 번만
const audio = new GameAudio();
const rig = new CameraRig(camera);
rig.groundAt = (x, z) => {
  const ax = x + origin.x, az = z + origin.z;
  return Math.max(terrainMod.heightAt(ax, az), terrainMod.waterLevelAt(ax, az), city.roofAt(ax, az)) - origin.y;
};

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
fx.setGround((x, z) => rig.groundAt(x, z));
const cosmic = new Cosmic(space, hooks, { quality });
const _qP = new THREE.Quaternion(), _dP = new THREE.Vector3();
let earthGone = false, cineMode = false;
const game = {
  fx, audio, hooks, cosmic, city, toast: (m) => toast(m),
  terrain: terrainMod,
  hitStop(dur, scale) { hitStopT = Math.max(hitStopT, dur); hitStopScale = scale; },
  // 천체 충돌: 지구/달 폭발, 해 초신성
  planetImpact(name, pl, dirLocal) {
    const ax = pl.pos.x + origin.x, az = pl.pos.z + origin.z;
    localToPlanetQuat(ax, az, _qP);
    _dP.copy(dirLocal).normalize().applyQuaternion(_qP);
    hooks.flash(1);
    hooks.shake(1);
    audio.play('sonicBoom', 1);
    if (name === 'sun') cosmic.supernova(); else cosmic.explode(name, _dP);
    if (name === 'earth' || name === 'sun') {
      earthGone = name === 'earth';
      cineMode = true;
      pl.hidden = true;
      pl.vel.set(0, 0, 0); pl.speed = 0; pl.mach = 0; pl.boostAmt = 0;
      pl.avatar.root.visible = false;
      post.setSpaceOnly(true);
      $('reset').hidden = false;
      toast(name === 'earth' ? '지구 파괴!' : '태양 초신성 폭발!');
    } else toast(`${BODY[name].name} 파괴!`);
  },
};
const player = new Player(scene, game);
player.avatar.setEnv(city.envMap);
// 스폰: 한강 북쪽 둔치 공원
function spawn() {
  if (origin.lengthSq() > 0) rebase(-origin.x, -origin.y, -origin.z);
  player.pos.set(0, terrainMod.heightAt(0, 0) + 1.0, 0);
  player.prevPos.copy(player.pos);
  player.vel.set(0, 0, 0);
  player.mode = 'ground';
  player.hidden = false;
  player.moonGone = false;
  player.gone.clear();
  player.speedLock = 0; player.autopilot = false;
  player.avatar.root.visible = true;
  player.snapshot(player.snapCur);
  player.copySnap(player.snapPrev, player.snapCur);
}
spawn();
function resetWorld() {
  cosmic.reset();
  city.restoreAll();
  earthGone = false;
  cineMode = false;
  post.setSpaceOnly(false);
  $('reset').hidden = true;
  spawn();
  rig.first = true;
  toast('지구 복원');
}
$('reset')?.addEventListener('click', resetWorld);

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
  if (code === 'Enter' && (cineMode || player.gone.size > 0)) resetWorld();
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
  fps: $('h-fps'), bar: $('h-bar'), res: $('h-res'), layer: $('h-layer'), target: $('h-target'), modes: $('h-modes'),
};
// 목표 천체 표시: 화면 위치 (화면 밖이면 가장자리에 붙임)
const tmark = { el: $('tmark'), label: null, v: new THREE.Vector3() };
tmark.label = tmark.el.querySelector('span');
function fmtDist(m) {
  if (m < 1e4) return Math.round(m) + ' m';
  if (m < 1e9) return Math.round(m / 1000).toLocaleString() + ' km';
  if (m < 1e14) return (m / 1.496e11).toFixed(m < 1.496e12 ? 2 : 1) + ' AU';
  return (m / 9.461e15).toFixed(2) + ' 광년';
}
function updateTargetMark() {
  const id = TARGETS[player.targetIdx], b = space.bodies[id];
  const show = (player.inSpace || cineMode === false && camAbs.y > 20000) && !cineMode && b && b.group.visible;
  tmark.el.hidden = !show;
  if (!show) return;
  const v = tmark.v.copy(b.group.position).applyMatrix4(space.camera.matrixWorldInverse);
  const behind = v.z > 0;
  v.applyMatrix4(space.camera.projectionMatrix);
  let x = v.x, y = v.y;
  if (behind) { x = -x; y = -y; }
  const m = Math.max(Math.abs(x), Math.abs(y));
  const off = behind || m > 0.95;
  if (off) { x = x / m * 0.92; y = y / m * 0.92; }
  tmark.el.classList.toggle('off', off);
  tmark.el.style.transform = `translate(${((x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-y * 0.5 + 0.5) * innerHeight).toFixed(1)}px)`;
  const d = player.targetDistNow || 0;
  const eta = player.speed > 1 ? d / player.speed : Infinity;
  tmark.label.textContent = `${BODY[id].name} ${fmtDist(d)}${eta < 1e5 ? ' · ' + (eta < 1 ? eta.toFixed(2) : eta < 120 ? eta.toFixed(0) : Math.round(eta / 60) + '분') + (eta < 120 ? '초' : '') : ''}`;
}
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
  const v = player.speed;
  if (v < 1000) { hud.speed.textContent = Math.round(v * 3.6).toLocaleString(); hud.unit.textContent = 'km/h'; }
  else if (v < 0.01 * C_LIGHT) { hud.speed.textContent = (v / 1000).toLocaleString(undefined, { maximumFractionDigits: v < 1e4 ? 2 : 0 }); hud.unit.textContent = 'km/s'; }
  else { hud.speed.textContent = (v / C_LIGHT).toLocaleString(undefined, { maximumFractionDigits: 2 }); hud.unit.textContent = '× 광속'; }
  hud.mach.textContent = player.inSpace ? '진공' : 'MACH ' + player.mach.toFixed(2);
  hud.mach.classList.toggle('super', player.mach >= 1);
  const altM = player.pos.y + origin.y - 1;
  hud.alt.textContent = altM < 10000 ? Math.max(0, altM).toFixed(0) + ' m' : Math.round(altM / 1000).toLocaleString() + ' km';
  hud.target.textContent = BODY[TARGETS[player.targetIdx]].name + ' ' + fmtDist(player.targetDistNow || 0);
  hud.modes.textContent = (player.speedLock > 0 ? '속도 고정 ' : '') + (player.autopilot ? '자동 항법 ' : '') + (player.coasting ? '관성 비행' : '');
  hud.layer.textContent = altM < 12000 ? '대류권' : altM < 50000 ? '성층권' : altM < 80000 ? '중간권' : altM < ATMO_TOP ? '열권' : altM < 3e7 ? '지구 궤도' : '우주';
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
  hud.bar.style.transform = `scaleX(${Math.min(1, Math.log10(1 + v) / 11).toFixed(3)})`;
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
const camAbs = new THREE.Vector3();
// 지구 폭발 연출: 우주 장면만, cosmic 이 제안하는 위치에서 바라봄
const cine = { active: false, planetPosMeters: new THREE.Vector3(), lookAtPlanetMeters: new THREE.Vector3() };
const _cineCam = new THREE.PerspectiveCamera(), _cf = new THREE.Vector3(), _cq = new THREE.Quaternion(), _cm = new THREE.Matrix4();
function cinematic(dt) {
  if (cosmic.cameraHint) cosmic.cameraHint(cine);
  if (!cine.active || cine.planetPosMeters.lengthSq() === 0) cine.planetPosMeters.set(0, 6.5e7, 2.5e7), cine.lookAtPlanetMeters.set(0, 0, 0);
  const P = cine.planetPosMeters;
  planetToFlat(P.x, P.y, P.z, _cf);
  // 행성 좌표에서 목표를 보는 방향 → 지역 좌표 카메라 방향으로 환산
  _cm.lookAt(P, cine.lookAtPlanetMeters, _cineCam.up.set(0, 1, 0));
  _cq.setFromRotationMatrix(_cm);
  localToPlanetQuat(_cf.x, _cf.z, _qP);
  _cineCam.quaternion.copy(_qP.invert()).multiply(_cq);
  _cineCam.fov = 55; _cineCam.aspect = camera.aspect; _cineCam.updateProjectionMatrix();
  space.update(dt, _cineCam, _cf, _cf.y);
}
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

  input.poll(dt);
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
  // 플로팅 원점: 플레이어가 렌더 원점에서 3 km 넘게 벗어나면 원점을 옮김
  const pp = player.pos;
  if (Math.abs(pp.x) > 3000 || Math.abs(pp.y) > 3000 || Math.abs(pp.z) > 3000) rebase(Math.round(pp.x), Math.round(pp.y), Math.round(pp.z));
  player.interpolate(acc / STEP);
  player.updateVisual(dt);

  elapsed.t += dt;
  rig.update(dt, player, input);
  camAbs.set(camera.position.x + origin.x, camera.position.y + origin.y, camera.position.z + origin.z);
  world.focusAGL = player.agl + 1;
  world.update(dt, elapsed.t, camera, player.renderPos, camAbs);
  terrain.update(dt, camera, camAbs);
  city.update(dt, camera, camAbs);
  if (!water.ready && (terrain.stats.draws > 30 || elapsed.t > 8)) water.ready = true;
  water.update(dt, camera, camAbs);
  trees.update(dt, camera, camAbs, camAbs.y - terrainMod.heightAt(camAbs.x, camAbs.z));
  if (cineMode) cinematic(dt); else space.update(dt, camera, camAbs, camAbs.y);
  cosmic.update(dt, camAbs);
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
  updateTargetMark();
  updateStamina();
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
}
requestAnimationFrame(frame);
window.__game = { player, rig, input, fx, world, post, audio, renderer, camera, scene, dbg, terrain, city, space, cosmic, water, trees, origin, resetWorld };
window.__origin = origin;
window.__frame = frameMod;
window.__targets = TARGETS;
window.__wl = terrainMod.waterLevelAt;
window.__ts = terrainMod.terrainSample;
