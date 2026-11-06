// BODY LAB — 시작, 반복, 입력, 카메라, 화면 효과, 엑스레이, HUD
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createWorld } from './world.js';
import { createDevices } from './devices.js';
import { Physics, rayBox, Particle } from './physics.js';
import { loadArmAsset } from './arm.js';
import { skinDetailFrom, ORGAN_NAMES, ORGANS } from './anatomy.js';
import { Human, PART } from './human.js';
import { FX } from './fx.js';
import { Weapons, WEAPONS } from './weapons.js';
import { Audio } from './audio.js';
import { Car } from './vehicle.js';

const V = THREE.Vector3;
const $ = id => document.getElementById(id);
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let LQ = location.search.includes('lq') || location.hash.includes('lq');
try { if (localStorage.getItem('bodylab-low') === '1') LQ = true; } catch (e) { }
renderer.setPixelRatio(LQ ? 0.5 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 1000);
const xcam = new THREE.PerspectiveCamera(36, 0.6, 0.05, 30); xcam.layers.set(1);
const G = window.G = { scene, camera, renderer, time: 0, ts: 1, xraySwap: [], queue: [], humans: [], aimTarget: null, weaponRanged: true };
G.world = createWorld(renderer, scene);
G.physics = new Physics(G.world);
G.audio = new Audio();
G.fx = new FX(G);
createDevices(G);
const grid = new THREE.GridHelper(30, 30, 0x1d4a6a, 0x0f2a3c); grid.layers.set(1); grid.position.y = 0.002; scene.add(grid);

// ───────── 후처리 ─────────
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: LQ ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
// 반짝임(물·눈의 하이라이트)이 반정밀도 한계를 넘어 화면 전체가 하얘지지 않게 자르기
composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); if(any(isnan(c.rgb))) c.rgb=vec3(0.0); gl_FragColor=vec4(min(c.rgb,vec3(6.0)),1.0); }' }));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 0.9); composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSlow: { value: 0 }, uHurt: { value: 0 }, uTime: { value: 0 }, uAber: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSlow, uHurt, uTime, uAber; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  void main(){ vec2 c=vUv-0.5; float ab=(uAber+uSlow*2.5)*0.004*length(c)*2.0;
    vec3 col=vec3(texture2D(tDiffuse,vUv+c*ab).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-c*ab).b);
    float l=dot(col,vec3(0.299,0.587,0.114)); col=mix(col, vec3(l)*vec3(0.92,1.0,1.12), uSlow*0.6);
    float vig=smoothstep(0.85,0.2,length(c*vec2(1.25,1.0))); col*=mix(1.0,vig,0.45+uSlow*0.35);
    col=mix(col, col*vec3(1.3,0.25,0.25)+vec3(0.06,0.0,0.0), uHurt*(1.0-vig)*0.85);
    col+= (h(vUv*1000.0+uTime)-0.5)*0.012; gl_FragColor=vec4(col,1.0); }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());
G.composer = composer; G.bloom = bloom; G.grade = grade;

// ───────── 로딩 ─────────
const armAsset = await loadArmAsset();
G.skinDetail = skinDetailFrom(armAsset.map.image);
const SPAWN_P = new V(0, 0, 7), SPAWN_N = new V(0, 0, 1.5);
const player = G.player = new Human(G, armAsset, { name: '나', isPlayer: true, shorts: 0x23406b, voice: 0.9 });
const npc = G.npc = new Human(G, armAsset, { name: '실험체', shorts: 0x4a4d52 });
G.humans.push(player, npc);
G.physics.pairs.push([player, npc]);
player.reset(SPAWN_P, Math.PI); npc.reset(SPAWN_N, 0);
const weapons = G.weapons = new Weapons(G);
const car = G.car = new Car(G, new V(-8, 0, 17), Math.PI / 2);
$('loading').classList.add('hide');

// ───────── 게임 이벤트 ─────────
let slowT = 0, manualSlow = false, autoSlow = true, shakeA = 0, hurtFx = 0, recoilP = 0;
G.slowmo = (sec = 1.4) => { if (autoSlow) slowT = Math.max(slowT, sec); };
G.shake = (a, p) => { const d = p ? camera.position.distanceTo(p) : 0; shakeA = Math.max(shakeA, a / (1 + d * 0.15)); };
G.recoil = k => { recoilP += k; shakeA = Math.max(shakeA, k * 2); };
G.noise = (p, r) => { for (const h of G.humans) if (h !== player && h.particles[0].p.distanceTo(p) < r) h.fear = Math.min(1, h.fear + 0.35); };
G.onHit = (h, info, organs) => {
  if (h === npc && (['bullet', 'pellet', 'stab', 'cut', 'blunt'].includes(info.type) || info.car)) G.slowmo(info.type === 'pellet' ? 1.2 : 1.5);
  if (h === player && (info.dmg || 0) > 0) hurtFx = Math.min(1, hurtFx + 0.3 + info.dmg / 60);
  if (h === npc && info.dmg > 0) { const hm = $('hitmark'); hm.classList.remove('on'); void hm.offsetWidth; hm.classList.add('on'); }
  if (organs?.length) log(`${h.name}: ${organs.map(o => ORGAN_NAMES[o.def.id]).join(', ')} 손상`);
};
G.onDeath = h => { log(`${h.name} 사망 — ${h.cause}`); if (h === player) { $('dead').hidden = false; unlock(); } };
const logEl = $('log');
function log(t) { const d = document.createElement('div'); d.textContent = t; logEl.prepend(d); while (logEl.children.length > 4) logEl.lastChild.remove(); setTimeout(() => d.classList.add('fade'), 4000); setTimeout(() => d.remove(), 5000); }
const bubble = $('bubble'); let bubbleT = 0;
G.ui = { say(h, text, dur) { if (!text) { bubble.classList.remove('on'); return; } bubble.textContent = text; bubble.classList.add('on'); bubbleT = dur; } };

function reviveNPC() { npc.reset(SPAWN_N.clone(), Math.atan2(player.root.x - SPAWN_N.x, player.root.z - SPAWN_N.z)); log('실험체가 살아났습니다'); }
function revivePlayer() { player.reset(SPAWN_P.clone(), Math.PI); camYaw = Math.PI; camPitch = -0.05; $('dead').hidden = true; log('살아났습니다'); }

// ───────── 마우스 고정 ─────────
let freeLook = false, uiOpen = false;
function lock() {
  G.audio.init();
  try { const r = canvas.requestPointerLock?.(); if (r?.catch) r.catch(() => { freeLook = true; }); } catch (e) { freeLook = true; }
  setTimeout(() => { if (document.pointerLockElement !== canvas && !uiOpen) freeLook = true; }, 500);
}
function unlock() { freeLook = false; document.exitPointerLock?.(); }
const active = () => !uiOpen && (document.pointerLockElement === canvas || freeLook);

// ───────── 창 (무기 고르기 · 조작법) ─────────
const TYPE = { gun: '총', melee: '근접', throw: '투척' };
const DESC = { pistol: '한 발씩 정확하게. 관통력은 약함', rifle: '누르고 있으면 연사. 몸을 뚫고 지나감', shotgun: '탄 10개가 퍼짐. 가까이서 쏘면 장기가 튀어나옴', sniper: '우클릭 확대. 무엇이든 관통', knife: '찌르기와 베기를 번갈아', bat: '뼈를 부러뜨리고 멀리 날려 보냄', grenade: '던지고 2.6초 뒤 폭발' };
const wGrid = $('wGrid');
WEAPONS.forEach((w, i) => {
  const b = document.createElement('button'); b.className = 'wcard'; b.id = 'w-' + w.id;
  b.innerHTML = `<div class="top"><span class="type">${TYPE[w.type]}</span><span class="k">${i + 1}</span></div><b>${w.name}</b><p>${DESC[w.id]}</p>`;
  b.onclick = () => { weapons.select(i); closeModals(); lock(); };
  wGrid.appendChild(b);
});
function openModal(id) { closeModals(); uiOpen = true; unlock(); $(id).hidden = false; }
function closeModals() { for (const id of ['weaponMenu', 'helpMenu']) $(id).hidden = true; uiOpen = false; }
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { closeModals(); lock(); });
document.querySelectorAll('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeModals(); }));
$('wBtn').onclick = () => openModal('weaponMenu');
$('helpBtn').onclick = () => openModal('helpMenu');
$('reviveNpc').onclick = reviveNPC; $('revivePlayer').onclick = revivePlayer; $('revive2').onclick = () => { revivePlayer(); lock(); };
$('slowBtn').onclick = () => { manualSlow = !manualSlow; };
$('autoSlow').onchange = e => { autoSlow = e.target.checked; };
$('xMode').onclick = cycleX; $('xTarget').onclick = swapTarget; $('perfBtn').onclick = () => setLow(!LQ);
$('startBtn').onclick = () => { $('start').classList.add('hide'); lock(); };

// ───────── 입력 ─────────
const keys = {}; let mouseL = false, mouseR = false, pressed = false, camYaw = Math.PI, camPitch = -0.05, carLook = 0;
let xMode = 0, xTarget = npc, grab = null;
const XMODES = ['전체', '뼈', '근육', '장기'];
canvas.addEventListener('mousedown', e => { if (!active()) { if (!uiOpen) lock(); return; } if (e.button === 0) { mouseL = true; pressed = true; } if (e.button === 2) mouseR = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (!active() || (freeLook && e.target !== canvas)) return;
  const s = mouseR && weapons.w.zoom ? 0.0006 : 0.0022;
  if (player.car) carLook = Math.max(-2.2, Math.min(2.2, carLook - e.movementX * s)); else camYaw -= e.movementX * s;
  camPitch = Math.max(-1.35, Math.min(1.3, camPitch - e.movementY * s));
});
addEventListener('wheel', e => { if (!uiOpen) weapons.select((weapons.cur + (e.deltaY > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length); });
addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); $('weaponMenu').hidden ? openModal('weaponMenu') : (closeModals(), lock()); return; }
  if (e.code === 'Escape') { if (uiOpen) closeModals(); freeLook = false; return; }
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  const n = +e.key; if (n >= 1 && n <= WEAPONS.length) { weapons.select(n - 1); if (uiOpen) { closeModals(); lock(); } }
  if (e.code === 'KeyH') $('helpMenu').hidden ? openModal('helpMenu') : (closeModals(), lock());
  if (uiOpen) return;
  if (e.code === 'KeyQ') manualSlow = !manualSlow;
  if (e.code === 'KeyR') reviveNPC();
  if (e.code === 'KeyG') revivePlayer();
  if (e.code === 'KeyX') cycleX();
  if (e.code === 'KeyC') swapTarget();
  if (e.code === 'KeyO') setLow(!LQ);
  if (e.code === 'KeyF') startGrab();
  if (e.code === 'KeyE') toggleCar();
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyF') grab = null; });
function cycleX() { xMode = (xMode + 1) % 4; $('xModeB').textContent = $('xModeLbl').textContent = XMODES[xMode]; }
function swapTarget() { xTarget = xTarget === npc ? player : npc; $('xTargetB').textContent = xTarget === npc ? '실험체' : '나'; }
function toggleCar() {
  if (player.car) { player.exitCar(); camYaw = car.yaw + Math.PI / 2 + carLook; carLook = 0; log('차에서 내렸습니다'); return; }
  if (player.dead || player.state !== 'stand' || !car.nearDoor(player.root)) return;
  player.enterCar(car); grab = null; carLook = 0; log('운전: W/S 가속·브레이크, A/D 조향, Space 핸드브레이크, E 내리기');
}
// 잡기: 가까운 몸 부위를 끌고 다님 (장치에 넣을 때)
function startGrab() {
  if (player.dead || player.car || player.state !== 'stand') return;
  let best = null, bd = 2.3;
  for (const q of npc.particles) { const d = q.p.distanceTo(player.particles[2].p); if (d < bd) { bd = d; best = q; } }
  if (best) { grab = best; npc.knock(1.5); }
}
G.physics.add({ particles: [], constraints: [], preSolve() {
  if (!grab) return;
  if (player.dead || player.car || player.state !== 'stand') { grab = null; return; }
  const f = camera.getWorldDirection(new V()); f.y = 0; f.normalize();
  const t = player.particles[2].p.clone().addScaledVector(f, 0.95); t.y = player.particles[2].p.y + 0.05 + camPitch * 0.5;
  grab.p.lerp(t, 0.08); npc.downT = Math.max(npc.downT, 1);
} });

// ───────── 최적화 모드 ─────────
function setLow(on) {
  LQ = on;
  try { localStorage.setItem('bodylab-low', on ? '1' : '0'); } catch (e) { }
  const pr = on ? 0.6 : Math.min(devicePixelRatio, 1.5);
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = on ? 0 : 4; t.dispose(); }
  bloom.enabled = !on; grade.uniforms.uAber.value = on ? 0 : 0.3;
  G.world.setQuality(on);
  G.physics.iters = on ? 4 : 6; G.physics.h = on ? 1 / 160 : 1 / 240;
  camera.far = on ? 420 : 1000; camera.updateProjectionMatrix();
  $('perfState').textContent = on ? '켬' : '끔'; $('perfBtn').classList.toggle('on', on);
}
setLow(LQ);

// ───────── 카메라 (1인칭) ─────────
const EYE = new V(0, 1.695, 0.095), camEye = new V(), _v = new V(), _w = new V();
let adsK = 0, wasFP = null;
function eyeWorld(out) { return out.copy(EYE).applyMatrix4(player.BM.head); }
function updateCamera(dt) {
  const fp = !player.dead && player.state !== 'down';
  if (fp !== wasFP) { player.setFirstPerson(fp); wasFP = fp; if (fp) eyeWorld(camEye); }
  if (player.car) camYaw = car.yaw + carLook;
  const fwd = _v.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  adsK += ((mouseR && fp && !player.car && weapons.w.type === 'gun' ? 1 : 0) - adsK) * Math.min(1, dt * 12);
  const zoom = weapons.w.zoom && adsK > 0.6;
  camera.fov += ((zoom ? 16 : 72 - adsK * 20) - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix();
  if (fp) {
    eyeWorld(_w); camEye.lerp(_w, 1 - Math.exp(-dt * (player.car ? 60 : 22)));
    camera.position.copy(camEye);
  } else { // 쓰러지면 몸을 바깥에서 봄
    const c = player.particles[4].p, d = new V().copy(fwd).negate(), L = 3.4;
    let t = L; for (const b of G.world.solids) { const q = rayBox(c, d, b, null); if (q >= 0 && q < t) t = q; }
    camera.position.copy(c).add(new V(0, 0.4, 0)).addScaledVector(d, Math.max(0.3, t - 0.2));
  }
  camera.lookAt(camera.position.clone().add(fwd));
  recoilP *= Math.exp(-dt * 10); camera.rotateX(recoilP);
  if (shakeA > 0.001) { camera.rotateX((Math.random() - 0.5) * shakeA * 0.05); camera.rotateY((Math.random() - 0.5) * shakeA * 0.05); shakeA *= Math.exp(-dt * 6); }
}
// 화면 가운데가 가리키는 곳
function aim() {
  const o = camera.position.clone(), d = camera.getWorldDirection(new V());
  let best = 300, who = null;
  for (const b of G.world.solids) { const t = rayBox(o, d, b, null); if (t >= 0 && t < best) best = t; }
  for (const h of G.humans) { if (h === player) continue; const hs = h.raycast(o, d, best); if (hs.length && hs[0].tIn < best) { best = hs[0].tIn; who = h; } }
  weapons.aimPoint.copy(o).addScaledVector(d, best);
  if (!who) { const c = npc.particles[2].p, t = c.clone().sub(o).dot(d); if (t > 0 && o.clone().addScaledVector(d, t).distanceTo(c) < 0.5 + t * 0.03) who = npc; }
  G.aimTarget = player.car ? null : who;
  G.weaponRanged = weapons.w.type === 'gun';
  return d;
}

// ───────── 엑스레이 ─────────
const xPanel = $('xview'), xBG = new THREE.Color(0x03070d);
function renderXray() {
  const r = xPanel.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  const h = xTarget, c = h.particles[2].p.clone().lerp(h.particles[4].p, 0.5);
  const lying = h.particles[0].p.y - h.particles[4].p.y < 0.5;
  const cf = camera.getWorldDirection(new V()); cf.y = 0; if (cf.lengthSq() < 1e-4) cf.set(0, 0, 1); cf.normalize();
  const side = new V(-cf.z, 0, cf.x);
  const center = lying ? c : new V(c.x, (h.particles[0].p.y + Math.min(h.particles[13].p.y, h.particles[16].p.y)) / 2 + 0.05, c.z);
  const dist = lying ? 3.1 : 3.3;
  xcam.position.copy(center).addScaledVector(side, -dist).addScaledVector(cf, -0.3).add(new V(0, lying ? 1.4 : 0.25, 0));
  xcam.lookAt(center);
  xcam.aspect = r.width / r.height; xcam.updateProjectionMatrix();
  grid.position.set(Math.round(center.x), 0.002, Math.round(center.z));
  for (const k of ['bones', 'muscles', 'organs']) { const on = xMode === 0 || XMODES[xMode] === { bones: '뼈', muscles: '근육', organs: '장기' }[k]; for (const hh of G.humans) for (const m of hh.xr[k]) m.visible = on && !(k === 'organs' && Object.values(hh.organs).find(o => o.mesh === m)?.out); }
  for (const s of G.xraySwap) { s.main = s.mesh.material; s.mesh.material = s.x; }
  const bg = scene.background, fog = scene.fog; scene.background = null; scene.fog = null;
  const hv = [player.headMesh.visible, player.faceGroup.visible]; player.headMesh.visible = true;
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(null); renderer.autoClear = false;
  const x = r.left, y = innerHeight - r.bottom;
  renderer.setScissorTest(true); renderer.setScissor(x, y, r.width, r.height); renderer.setViewport(x, y, r.width, r.height);
  renderer.setClearColor(xBG, 1); renderer.clear(true, true, false);
  renderer.render(scene, xcam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.autoClear = true; renderer.toneMapping = tm;
  scene.background = bg; scene.fog = fog; player.headMesh.visible = hv[0];
  for (const s of G.xraySwap) s.mesh.material = s.main;
}

// ───────── HUD ─────────
const organEl = $('organs');
let hudT = 0;
function bar(el, v) { el.style.width = Math.max(0, Math.min(100, v)) + '%'; }
function emoClass(h) { return 'emo ' + (h.dead ? 'dead' : /고통|공황|공포|질식|절망/.test(h.emotion) ? 'bad' : h.emotion === '불안' ? 'warn' : ''); }
function hud(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  $('wName').textContent = weapons.w.name;
  document.querySelectorAll('.wcard').forEach((b, i) => b.classList.toggle('on', i === weapons.cur));
  bar($('pHp'), player.hp); bar($('pBlood'), player.blood / 5 * 100); bar($('pOx'), player.oxygen * 100);
  $('pOxRow').hidden = player.oxygen >= 0.99; $('pOxN').textContent = Math.round(player.oxygen * 100) + '%';
  $('pEmo').textContent = player.dead ? '사망' : player.emotion; $('pEmo').className = emoClass(player);
  $('pHpN').textContent = Math.max(0, Math.round(player.hp)); $('pBloodN').textContent = player.blood.toFixed(1) + 'L';
  const h = xTarget;
  $('tName').textContent = h === npc ? '실험체' : '나';
  bar($('tHp'), h.hp); bar($('tBlood'), h.blood / 5 * 100); $('tHpN').textContent = Math.max(0, Math.round(h.hp)); $('tBloodN').textContent = h.blood.toFixed(2) + 'L';
  $('tEmo').textContent = h.dead ? '사망 · ' + h.cause : h.emotion; $('tEmo').className = emoClass(h);
  const st = [];
  if (h.bleedRate > 0.002) st.push(`출혈 ${(h.bleedRate * 1000).toFixed(0)}mL/s`);
  if (h.oxygen < 0.99) st.push(`산소 ${(h.oxygen * 100).toFixed(0)}%`);
  if (h.heartStop > 0 && !h.dead) st.push('심정지');
  const br = Object.keys(h.broken).filter(k => h.broken[k]).map(k => PART[k].boneName);
  if (br.length) st.push('골절: ' + br.join(', '));
  $('tState').textContent = st.join(' · ') || (h.dead ? '' : '이상 없음');
  let bad = 0;
  organEl.innerHTML = ORGANS.map(o => { const s = h.organs[o.id]; const c = s.out ? 'out' : s.hp <= 0 ? 'dead' : s.hp < 70 ? 'hurt' : ''; if (c) bad++; const t = s.out ? '튀어나옴' : s.hp <= 0 ? '파괴' : s.hp < 70 ? '손상' : '정상'; return `<div class="o ${c}"><span>${ORGAN_NAMES[o.id]}</span><i>${t}</i></div>`; }).join('');
  $('organSum').textContent = bad ? `${bad}곳 이상` : '모두 정상';
  const slowOn = manualSlow || slowT > 0; $('slowState').textContent = slowOn ? '켬' : '끔'; $('slowBtn').classList.toggle('on', slowOn);
  $('prompt').hidden = !!player.car || player.dead || player.state !== 'stand' || !car.nearDoor(player.root);
  $('carHud').hidden = !player.car; $('speed').textContent = Math.round(Math.abs(car.speed) * 3.6);
  $('cross').hidden = !!player.car;
}
const tag = $('tag'), tagHp = $('tagHp');
function worldUI(dt) {
  const p = npc.particles[0].p.clone().add(new V(0, 0.32, 0)).project(camera);
  const vis = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
  const sx = (p.x * 0.5 + 0.5) * innerWidth, sy = (-p.y * 0.5 + 0.5) * innerHeight;
  tag.style.display = vis ? '' : 'none'; tag.style.transform = `translate(${sx}px, ${sy}px)`;
  bar(tagHp, npc.hp); $('tagEmo').textContent = npc.dead ? '사망' : npc.emotion;
  bubbleT -= dt; if (bubbleT <= 0) bubble.classList.remove('on');
  bubble.style.transform = `translate(${sx}px, ${sy - 34}px)`; bubble.style.display = vis ? '' : 'none';
}

// ───────── 반복 ─────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  slowT = Math.max(0, slowT - dt);
  const tsT = slowT > 0 ? 0.1 : manualSlow ? 0.22 : 1;
  G.ts += (tsT - G.ts) * Math.min(1, dt * (tsT < G.ts ? 14 : 4));
  const simDt = dt * G.ts;
  G.time += simDt;
  G.audio.setSlow(G.ts);
  // 조작
  const f = new V(Math.sin(camYaw), 0, Math.cos(camYaw)), r = new V(-Math.cos(camYaw), 0, Math.sin(camYaw));
  const mv = player.ctrl.move.set(0, 0, 0);
  const play = active();
  if (play && !player.car) { if (keys.KeyW) mv.add(f); if (keys.KeyS) mv.sub(f); if (keys.KeyD) mv.add(r); if (keys.KeyA) mv.sub(r); }
  if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(keys.ShiftLeft || keys.ShiftRight ? 3.8 : 1.7);
  player.ctrl.yaw = camYaw;
  player.look.yaw = player.car ? Math.max(-1.3, Math.min(1.3, carLook)) : 0; player.look.pitch = camPitch * 0.6;
  car.update(simDt, play && player.car ? { w: keys.KeyW, s: keys.KeyS, a: keys.KeyA, d: keys.KeyD, space: keys.Space } : {});
  const aimDir = aim();
  if (play) weapons.trigger(mouseL, pressed, aimDir, camera.position);
  pressed = false;
  weapons.pose(simDt, aimDir, adsK, eyeWorld(new V()));
  for (const h of G.humans) h.update(simDt);
  G.physics.step(simDt);
  while (G.queue.length) G.queue.shift()();
  for (const h of G.humans) { h.updateVisual(simDt); h.emitBlood(simDt); }
  weapons.place();
  weapons.update(dt, simDt);
  G.world.update(simDt, G.time);
  G.fx.update(simDt);
  updateCamera(dt);
  G.world.follow(camera.position);
  G.audio.listener(camera);
  hurtFx = Math.max(0, hurtFx - dt * 0.8);
  grade.uniforms.uSlow.value += ((G.ts < 0.6 ? 1 : 0) - grade.uniforms.uSlow.value) * Math.min(1, dt * 6);
  grade.uniforms.uHurt.value = Math.max(hurtFx, player.dead ? 0.6 : Math.max(0, (60 - player.hp) / 80));
  grade.uniforms.uTime.value = now * 0.001;
  let saved = null;
  if (G.debugCam) { saved = [camera.position.clone(), camera.quaternion.clone()]; const d = G.debugCam(); camera.position.copy(d.p); camera.lookAt(d.t); camera.updateMatrixWorld(); }
  composer.render();
  if (saved) { camera.position.copy(saved[0]); camera.quaternion.copy(saved[1]); camera.updateMatrixWorld(); }
  renderXray();
  hud(dt); worldUI(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});
