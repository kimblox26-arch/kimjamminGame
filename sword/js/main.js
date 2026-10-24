// 메인: 렌더러, 고정 120Hz 시뮬레이션 + 렌더 보간, 60fps 프레임 제한(발열), 최적화 모드, 적응형 해상도, HUD
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
import { Wreck } from './wreck.js';
import * as geoMod from './geo.js';
import { loadGeo } from './geo.js';
import { loadSeoul, loadBuildings, loadLines, loadPoints } from './seoul.js';
import { Roads } from './roads.js';
import { PeakLabels } from './labels.js';
import { Town } from './town.js';
import { Blade } from './blade.js';
import { Underground, layerName } from './underground.js';
import { Cape } from './cape.js';
import { Nukes } from './nuke.js';
import { Life } from './life.js';
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
let maxPR = Math.min(devicePixelRatio || 1, quality === 'low' ? 1.5 : 2);
const MAX_PR_FULL = maxPR;
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
// 실제 지구 데이터 (먼 곳 지형·해안선). 없으면 절차적 지형만
const geo = await loadGeo('./assets/');
// 실제 서울: 고도·물·토지 격자 → 지형, 건물 → 도시, 도로·철도·시설 → 도로
let loadStep = 0;
const loadMsg = (m) => { const e = $('m-msg'); if (e) e.textContent = m; const b = $('m-bar'); if (b) b.style.width = Math.min(95, (++loadStep) * 22) + '%'; };
const bootT = { t0: performance.now() };
window.__boot = bootT;
loadMsg('실제 서울 지형 불러오는 중…');
const seoul = await loadSeoul('./assets/seoul/');
bootT.grid = performance.now() - bootT.t0;
const terrain = new Terrain(renderer, scene, { quality, sunDir, geo, real: seoul && seoul.terrain });
let roads = null, buildings = null;
if (seoul) {
  try {
    loadMsg('건물·도로 불러오는 중…');
    const [b, r, rl, pts] = await Promise.all([loadBuildings(seoul.base), loadLines(seoul.base, 'roads'), loadLines(seoul.base, 'rails'), loadPoints(seoul.base)]);
    buildings = b;
    bootT.fetch = performance.now() - bootT.t0;
    roads = new Roads(scene, { roads: r, rails: rl, points: pts }, { heightAt: (x, z) => terrainMod.heightAt(x, z), waterLevelAt: (x, z) => terrainMod.waterLevelAt(x, z) }, { quality });
  } catch (e) { console.warn('[seoul] 건물/도로 실패', e); }
}
bootT.roads = performance.now() - bootT.t0;
loadMsg('도시 짓는 중…');
const city = new City(renderer, scene, { quality, sunDir, buildings, extraBoxes: roads ? roads.bridgeBoxes : null });
bootT.city = performance.now() - bootT.t0;
const water = new Water(renderer, scene, { quality, envMap: city.envMap });
const trees = new Trees(renderer, scene, { quality, envMap: city.envMap, footprint: (x, z) => city.roofAt(x, z) });
if (roads) trees.extra = (x, z, s) => roads.streetTrees(x, z, s);
const peaks = seoul ? new PeakLabels(scene, seoul.peaks, (x, z) => terrainMod.heightAt(x, z)) : null;
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
  if (rig.underground) return -Infinity;   // 땅속을 파고드는 중엔 카메라도 땅속으로
  const ax = x + origin.x, az = z + origin.z;
  // 수영 중엔 카메라도 물속으로 들어갈 수 있음
  const wl = rig.inWater ? -Infinity : terrainMod.waterLevelAt(ax, az);
  return Math.max(terrainMod.heightAt(ax, az), wl, city.roofAt(ax, az)) - origin.y;
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
// 건물 물리 (잘린 조각/넘어지는 건물)
const wreck = new Wreck(city, scene, { fx, audio, hooks, terrainH: (x, z) => terrainMod.heightAt(x, z) });
const under = new Underground(scene);
const _qP = new THREE.Quaternion(), _dP = new THREE.Vector3(), _pAbs = new THREE.Vector3();
let earthGone = false, cineMode = false;
const game = {
  fx, audio, hooks, cosmic, city, wreck, toast: (m) => toast(m),
  terrain: terrainMod, envMap: city.envMap, water,
  // 절대 좌표 (x,y,z) 반경 r 안의 건물 → 잔해
  smashAt(x, y, z, r) {
    const boxes = city.destroy(x, y, z, r);
    if (boxes && boxes.length) fx.debrisBoxes(boxes);
  },
  hitStop(dur, scale) { hitStopT = Math.max(hitStopT, dur); hitStopScale = scale; },
  // 천체 충돌: 지구/달 폭발, 해 초신성
  planetImpact(name, pl, dirLocal) {
    const ax = pl.pos.x + origin.x, az = pl.pos.z + origin.z;
    localToPlanetQuat(ax, az, _qP);
    _dP.copy(dirLocal).normalize().applyQuaternion(_qP);
    hooks.flash(1);
    hooks.shake(1);
    audio.play('sonicBoom', 1);
    const star = name === 'sun' || (BODY[name] && BODY[name].kind === 'star');
    if (star) cosmic.supernova(name); else cosmic.explode(name, _dP);
    // 연출 없이 그 자리에서 바로 부서짐. 플레이어는 계속 조종 (지구가 사라지면 땅·바다·하늘도 사라지고 우주에 남음)
    if (name === 'earth') { earthGone = true; pl.mode = 'fly'; }
    $('reset').hidden = false;
    toast(name === 'earth' ? '지구 파괴!' : star ? `${BODY[name].name} 초신성 폭발!` : `${BODY[name].name} 파괴!`);
  },
};
const player = new Player(scene, game);
player.avatar.setEnv(city.envMap);
const blade = new Blade(scene, game, player);
const cape = new Cape(scene, player.avatar);
game.player = player; game.trees = trees;
const nukes = new Nukes(scene, game);
// 사람·자동차·여객기·배·새
const life = new Life(scene, game, { eco: isMobile });
game.life = life;
const town = roads ? new Town(scene, { roads, heightAt: (x, z) => terrainMod.heightAt(x, z), city, audio }, { eco: isMobile }) : null;
if (town) life.setTown(town);
wreck.life = life;
// 구름을 뚫으면 찢긴 수증기가 진행 방향으로 끌려가며 흩어짐
world.onCloudPunch = (x, y, z, r) => {
  const v = player.vel;
  for (let i = 0; i < 4; i++) fx.puff({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r * 0.6, z: z + (Math.random() - 0.5) * r,
    vx: v.x * 0.08 + (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 8, vz: v.z * 0.08 + (Math.random() - 0.5) * 20,
    life: 6 + Math.random() * 5, s0: r * 0.5, s1: r * 1.1, a: 0.6, r0: 1, g0: 1, b0: 1.02, r1: 1, g1: 1, b1: 1.02, fin: 0.05, drag: 0.6, rotv: (Math.random() - 0.5) * 0.3 }, 'smoke');
};
// 핵 발사: 칼(가슴) 위에서 조준점 (카메라 시선이 처음 닿는 건물/땅, 없으면 3 km 앞) 으로
function fireNuke() {
  if (player.hidden || earthGone || player.mode === 'dig') return;
  blade._aim(rig);
  const from = new THREE.Vector3(player.pos.x + origin.x, player.pos.y + origin.y + 2.5, player.pos.z + origin.z);
  nukes.launch(from, blade.aimAbs, player.vel);
}
$('btn-nuke')?.addEventListener('click', fireNuke);
player.blade = blade;
// 스폰: 한강 북쪽 둔치 공원
function spawn() {
  if (origin.lengthSq() > 0) rebase(-origin.x, -origin.y, -origin.z);
  // 서울광장 근처, 건물·물이 아닌 곳
  let sx = 0, sz = 95;
  search: for (let r = 0; r < 400; r += 6) for (let a = 0; a < 16; a++) {
    const x = Math.cos(a * Math.PI / 8) * r, z = 95 + Math.sin(a * Math.PI / 8) * r, g = terrainMod.heightAt(x, z);
    if (city.roofAt(x, z) < g + 0.5 && terrainMod.waterLevelAt(x, z) < g) { sx = x; sz = z; break search; }
  }
  player.pos.set(sx, terrainMod.heightAt(sx, sz) + 1.0, sz);
  rig.yaw = 0;
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
  wreck.reset();
  blade.reset(); nukes.reset(); life.reset();
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
input.onFirstGesture = () => { audio.unlock(); };
input.enabled = false;   // 메인 화면에서 시작을 누를 때까지
if (input.isTouch) document.body.classList.add('touch');

// ── 설정 토글 ──
// 프레임 제한 (발열 방지): 60 → 30 → 제한 없음 (P)
const CAPS = [60, 30, 0];
let capIdx = 0;
const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 무시 */ } } };
// 최적화 모드: 해상도↓, 그림자·블룸·MSAA 끔, 나무 반경↓ (모바일은 기본 켬)
let eco = store.get('skyblade.eco') !== null ? store.get('skyblade.eco') === '1' : isMobile;
function applyEco(show) {
  maxPR = eco ? Math.min(devicePixelRatio || 1, 1) : MAX_PR_FULL;
  pixelRatio = Math.min(pixelRatio, maxPR);
  if (!eco) pixelRatio = maxPR;
  world.sun.castShadow = !eco;
  post.renderPass.shadows = !eco;
  post.bloom.enabled = !eco;
  post._samplesCap = eco ? 0 : undefined;
  post._samples = -1;
  trees.setRadius(eco ? 380 : (quality === 'low' ? 520 : 900));
  life.setEco(eco);
  city.nearR = eco ? 1500 : 3000;
  if (roads) { roads.R = eco ? 1100 : 2000; terrain.uniforms.tRoadR.value = roads.R; }
  water.setDetail && water.setDetail(eco);
  resize();
  store.set('skyblade.eco', eco ? '1' : '0');
  const b = $('btn-eco'); if (b) b.classList.toggle('on', eco);
  if (show) toast(eco ? '최적화 모드 켬 (발열↓)' : '최적화 모드 끔 (고화질)');
}
input.onKey = (code, blocked) => {
  if (code === 'Escape') { if (!$('settings').hidden) closeSettings(); else if ($('menu').classList.contains('hide')) openSettings(); return; }
  if (blocked) return;
  if (code === 'KeyM') { audio.muted = !audio.muted; toast(audio.muted ? '소리 끔' : '소리 켬'); }
  if (code === 'KeyH') $('help').classList.toggle('hide');
  if (code === 'KeyP') { capIdx = (capIdx + 1) % CAPS.length; toast(CAPS[capIdx] ? `FPS 제한: ${CAPS[capIdx]}` : 'FPS 제한: 없음 (모니터 주사율)'); }
  if (code === 'KeyO') { eco = !eco; applyEco(true); }
  if (code === 'Enter' && player.gone.size > 0) resetWorld();
};
// ── 메인 화면 · 설정 ──
const S = JSON.parse(store.get('skyblade.settings') || '{}');
const saveS = () => store.set('skyblade.settings', JSON.stringify(S));
function syncSettings() {
  $('s-eco').checked = eco;
  $('s-fps').value = String(capIdx);
  $('s-sound').checked = !audio.muted;
  $('s-fp').checked = rig.firstPerson;
  $('s-sens').value = String(S.sens || 1);
  $('s-bubbles').checked = S.bubbles !== false;
  $('s-peaks').checked = S.peaks !== false;
  $('s-help').checked = !$('help').classList.contains('hide');
}
function applySettings() {
  rig.sens = 0.0022 * (S.sens || 1);
  if (town) town.showBubbles = S.bubbles !== false;
  if (peaks) peaks.enabled = S.peaks !== false;
}
function openSettings() { syncSettings(); $('settings').hidden = false; input.enabled = false; if (document.exitPointerLock) document.exitPointerLock(); }
function closeSettings() { $('settings').hidden = true; input.enabled = $('menu').classList.contains('hide'); }
function startGame() {
  $('menu').classList.add('hide'); input.enabled = true; audio.unlock();
  setTimeout(() => { if ($('menu').classList.contains('hide')) $('menu').style.display = 'none'; }, 500);   // 흐림 효과 합성 비용 제거
  if (!input.isTouch && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* 무시 */ } }
  toast('서울에 오신 걸 환영합니다 — Esc 설정, H 조작법');
}
$('m-start').addEventListener('click', startGame);
$('m-set').addEventListener('click', openSettings);
$('btn-set').addEventListener('click', openSettings);
$('s-close').addEventListener('click', closeSettings);
$('s-menu').addEventListener('click', () => { $('settings').hidden = true; $('menu').style.display = ''; $('menu').classList.remove('hide'); input.enabled = false; });
$('s-eco').addEventListener('change', (e) => { eco = e.target.checked; applyEco(true); });
$('s-fps').addEventListener('change', (e) => { capIdx = +e.target.value; S.fps = capIdx; saveS(); });
$('s-sound').addEventListener('change', (e) => { audio.muted = !e.target.checked; S.muted = audio.muted; saveS(); });
$('s-fp').addEventListener('change', (e) => { if (e.target.checked !== rig.firstPerson) toggleView(); });
$('s-sens').addEventListener('input', (e) => { S.sens = +e.target.value; saveS(); applySettings(); });
$('s-bubbles').addEventListener('change', (e) => { S.bubbles = e.target.checked; saveS(); applySettings(); });
$('s-peaks').addEventListener('change', (e) => { S.peaks = e.target.checked; saveS(); applySettings(); });
$('s-help').addEventListener('change', (e) => $('help').classList.toggle('hide', !e.target.checked));
if (S.fps !== undefined) capIdx = S.fps;
if (S.muted) audio.muted = true;
// 스킬 버튼 (클릭 = 키)
for (const b of document.querySelectorAll('#skills [data-k]')) {
  const k = b.dataset.k;
  if (k === 'KeyK') {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.keys.add('beam'); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => input.keys.delete('beam'));
  } else b.addEventListener('click', () => { const m = { KeyJ: 'slash', KeyL: 'wave', KeyN: 'nuke', KeyV: 'view' }[k]; if (m) input.edges.add(m); });
}
function toggleView() {
  rig.firstPerson = !rig.firstPerson;
  $('btn-view')?.classList.toggle('on', rig.firstPerson);
  toast(rig.firstPerson ? '1인칭 시점' : '3인칭 시점');
}
$('btn-view')?.addEventListener('click', toggleView);
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
applyEco(false);

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
  const show = (player.inSpace || camAbs.y > 20000) && b && b.group.visible;
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
  if (player.mode === 'dig') {
    const d = Math.max(0, player.depth || 0);
    hud.alt.textContent = '-' + (d < 10000 ? d.toFixed(0) + ' m' : Math.round(d / 1000).toLocaleString() + ' km');
    hud.layer.textContent = layerName(d);
  }
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
  if (player.mode === 'dig') st = player.boostAmt > 0.5 ? '땅속 돌진' : '땅속';
  if (player.mode === 'swim') st = player.submerged ? '잠수' : '수영';
  hud.state.textContent = st;
  hud.bar.style.transform = `scaleX(${Math.min(1, Math.log10(1 + v) / 11).toFixed(3)})`;
  hud.fps.textContent = fps.toFixed(0) + ' FPS';
  hud.fps.classList.toggle('good', fps >= 115);
  hud.res.textContent = '×' + pixelRatio.toFixed(2);
}

// ── 루프 ──
let last = performance.now();
let nextFrameT = 0;
let acc = 0;
let fpsFrames = 0, fpsTime = 0, fps = 0;
// 적응형 해상도: 목표 = min(프레임 제한, 모니터 주사율)
let refreshEst = 60, lastRaf = 0, perfT = 0, perfFrames = 0, slowSecs = 0, fastSecs = 0;
let failPR = Infinity, failT = 0;
const rafSamples = new Float32Array(60);
let rafN = 0, measured = false;
const elapsed = { t: 0 };
const camAbs = new THREE.Vector3(), _wAbs = new THREE.Vector3();
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
  PROF = window.__prof || null;
  if (PROF) PROF.frames = (PROF.frames || 0) + 1;
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

  // 프레임 제한 (기본 60): 다음 프레임 예정 시각 전이면 건너뜀. 주사율이 배수(120/240)면 고르게, 90/144Hz 도 평균 60
  const cap = CAPS[capIdx];
  if (cap && !dbg.paused && refreshEst > cap * 1.1) {
    const iv = 1000 / cap, slack = 500 / refreshEst;
    if (now < nextFrameT - slack) return;
    nextFrameT = Math.max(nextFrameT + iv, now - iv);
  }
  // rAF 타임스탬프가 로드 시점보다 앞설 수 있으니 음수 dt 방지
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;

  // 히트스톱 (충격 순간 시간이 잠깐 멈칫)
  if (hitStopT > 0) { hitStopT -= dt; timeScale = hitStopScale; } else timeScale += (1 - timeScale) * (1 - Math.exp(-20 * dt));

  input.poll(dt);
  if (input.consume('view')) toggleView();
  if (input.consume('nuke')) fireNuke();
  let simDt = dt * timeScale;
  // 디버그(테스트 하네스): 일시정지 후 정확한 시간만큼 진행
  if (dbg.paused) { simDt = dbg.pending; dbg.pending = 0; dt = simDt; }
  acc += simDt;
  let steps = 0;
  const maxSteps = dbg.paused ? 1e6 : 12;
  while (acc >= STEP && steps < maxSteps) {
    { const _t0 = PROF ? performance.now() : 0;
  player.step(STEP, input, rig);
  if (PROF) PROF['player'] = (PROF['player'] || 0) + performance.now() - _t0; }
    acc -= STEP;
    steps++;
  }
  if (steps === maxSteps) acc = 0;
  // 플로팅 원점: 플레이어가 렌더 원점에서 3 km 넘게 벗어나면 원점을 옮김
  const pp = player.pos;
  if (Math.abs(pp.x) > 3000 || Math.abs(pp.y) > 3000 || Math.abs(pp.z) > 3000) rebase(Math.round(pp.x), Math.round(pp.y), Math.round(pp.z));
  player.interpolate(acc / STEP);
  player.updateVisual(dt);
  { const _t0 = PROF ? performance.now() : 0;
  blade.render(dt, camera);
  if (PROF) PROF['blade'] = (PROF['blade'] || 0) + performance.now() - _t0; }
  cape.update(dt, player.vel, !rig.firstPerson && !player.hidden && player.mode !== 'dig');

  elapsed.t += dt;
  rig.inWater = player.mode === 'swim';
  rig.underground = player.mode === 'dig';
  rig.update(dt, player, input);
  camAbs.set(camera.position.x + origin.x, camera.position.y + origin.y, camera.position.z + origin.z);
  world.focusAGL = player.agl + 1;
  // 지구가 부서졌으면 땅·도시·바다·하늘을 모두 '아주 높은 곳'처럼 숨김
  const wAbs = earthGone ? _wAbs.set(camAbs.x, 5e8, camAbs.z) : camAbs;
  { const _t0 = PROF ? performance.now() : 0;
  world.update(dt, elapsed.t, camera, player.renderPos, wAbs);
  if (PROF) PROF['world'] = (PROF['world'] || 0) + performance.now() - _t0; }
  { const _t0 = PROF ? performance.now() : 0;
  terrain.update(dt, camera, wAbs);
  if (PROF) PROF['terrain'] = (PROF['terrain'] || 0) + performance.now() - _t0; }
  { const _t0 = PROF ? performance.now() : 0;
  city.update(dt, camera, wAbs);
  if (PROF) PROF['city'] = (PROF['city'] || 0) + performance.now() - _t0; }
  { const _t0 = PROF ? performance.now() : 0;
  if (roads) roads.update(dt, wAbs, elapsed.t);
  if (PROF) PROF['roads'] = (PROF['roads'] || 0) + performance.now() - _t0; }
  if (peaks) peaks.update(dt, wAbs, !earthGone && camAbs.y < 30000);
  wreck.update(dbg.paused ? dt : dt * timeScale, camAbs);
  if (!water.ready && (terrain.stats.draws > 30 || elapsed.t > 8)) water.ready = true;
  { const _t0 = PROF ? performance.now() : 0;
  water.update(dt, camera, wAbs);
  if (PROF) PROF['water'] = (PROF['water'] || 0) + performance.now() - _t0; }
  { const _t0 = PROF ? performance.now() : 0;
  trees.update(dt, camera, wAbs, earthGone ? 1e9 : camAbs.y - terrainMod.heightAt(camAbs.x, camAbs.z));
  if (PROF) PROF['trees'] = (PROF['trees'] || 0) + performance.now() - _t0; }
  space.update(dt, camera, camAbs, earthGone ? 5e8 : camAbs.y);
  // 땅속: 카메라를 감싼 암석/맨틀/핵 껍질, 햇빛은 거의 닿지 않음
  const camDepth = player.mode === 'dig' && !earthGone ? terrainMod.heightAt(camAbs.x, camAbs.z) - camAbs.y : 0;
  under.update(dt, camera, camAbs, camDepth, player.vel);
  if (camDepth > 0.3) { world.sun.intensity *= 0.06; world.hemi.intensity *= 0.25; }
  cosmic.update(dt, camAbs);
  nukes.update(dbg.paused ? dt : dt * timeScale, camAbs);
  _pAbs.set(player.renderPos.x + origin.x, player.renderPos.y + origin.y, player.renderPos.z + origin.z);
  life.update(dbg.paused ? dt : dt * timeScale, camAbs, _pAbs, player.vel, !earthGone && !player.hidden);
  { const _t0 = PROF ? performance.now() : 0;
  if (town) town.update(dbg.paused ? dt : dt * timeScale, camAbs, _pAbs, player.vel, { flying: player.mode === 'fly', sword: blade.drawn, camera }, !earthGone && !player.hidden);
  if (PROF) PROF['town'] = (PROF['town'] || 0) + performance.now() - _t0; }
  { const _t0 = PROF ? performance.now() : 0;
  fx.update(dt * Math.max(timeScale, 0.15), player.ctx);
  if (PROF) PROF['fx'] = (PROF['fx'] || 0) + performance.now() - _t0; }
  audio.update(dt, player.audioState);

  // 후처리 파라미터
  const P = post.params;
  const sp = player.speed;
  P.speed = Math.min(1, Math.max(0, (sp - 30) / 600)) * 0.85 + player.boostAmt * 0.12 * Math.min(1, sp / 80);
  P.heat = Math.min(1, Math.max(0, (player.mach - 1.5) / 1.5)) * (player.flying ? 1 : 0);
  P.chroma = Math.min(1, P.speed * 0.8 + flash * 0.5);
  P.vignette = 0.28 + P.speed * 0.35;
  // 물속 화면 (카메라가 수면 아래)
  const cwl = earthGone || player.mode === 'dig' ? -Infinity : terrainMod.waterLevelAt(camAbs.x, camAbs.z);
  P.under = Math.min(1, Math.max(0, (cwl - camAbs.y) * 3));
  flash = Math.max(0, flash - dt * 2.6);
  P.flash = flash;
  _uv.copy(player.renderPos).project(camera);
  P.focus.set(_uv.x * 0.5 + 0.5, _uv.y * 0.5 + 0.5);
  { const _t0 = PROF ? performance.now() : 0;
  post.render(dt);
  if (PROF) PROF['post'] = (PROF['post'] || 0) + performance.now() - _t0; }

  // FPS / 적응형 해상도
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = fpsFrames / fpsTime; fpsFrames = 0; fpsTime = 0; }
  perfT += dt; perfFrames++;
  if (perfT >= 1) {
    const f = perfFrames / perfT;
    const target = Math.min(CAPS[capIdx] || 120, refreshEst) * 0.92;
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
applySettings();
$('m-load').classList.add('done');
$('m-msg').textContent = '준비 완료';
$('m-start').disabled = false;
requestAnimationFrame(frame);
window.__THREE = THREE;
let PROF = null;
window.__game = { town, roads, seoul, life, nukes, cape, player, rig, input, fx, world, post, audio, renderer, camera, scene, dbg, terrain, city, space, cosmic, water, trees, wreck, blade, origin, resetWorld };
window.__origin = origin;
window.__frame = frameMod;
window.__targets = TARGETS;
window.__wl = terrainMod.waterLevelAt;
window.__ts = terrainMod.terrainSample;
window.__geo = geoMod;
