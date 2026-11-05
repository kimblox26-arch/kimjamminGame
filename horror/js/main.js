// 초록모자 CHAPTER 1 — 1인칭 진행 · 컷신 · HUD
import * as THREE from 'three';
import { World, CEIL, roomAt, cv, toTex } from './world.js';
import { createArms } from './noob.js';
import { Monster } from './monster.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { DIARY, CLUE, ORDER, KEYS, ICONS, paintIcons } from './story.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const angLerp = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);       // 이 방향을 보는 카메라 yaw
const SKIP = Symbol('skip');
const EYE = 1.5;                                        // 눈높이 (뉴비 키 1.66m)

/* ── 설정 저장 ── */
const SKEY = 'greenhat-ch1';
const SET = Object.assign({ mic: null, sens: 1, vol: 0.9, look: 1, bright: 1, q: isTouch ? 'mid' : 'high', voice: true, seenIntro: false, best: 0 }, (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })());
const saveSet = () => { try { localStorage.setItem(SKEY, JSON.stringify(SET)); } catch (e) { } };

/* ── 렌더러 · 장면 ── */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: !isTouch, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const EXP = () => 1.3 * SET.bright; renderer.toneMappingExposure = EXP();
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = new THREE.Color(0x050304);
scene.background = FOG.clone(); scene.fog = new THREE.FogExp2(0x050304, 0.075);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 90);
const hemi = new THREE.HemisphereLight(0x5a6488, 0x1c0e0a, 0.5); scene.add(hemi);
const fill = new THREE.PointLight(0xffd8b0, 0.8, 5, 2); scene.add(fill);
const torch = new THREE.SpotLight(0xfff0d6, 110, 24, 0.5, 0.5, 1.15);
torch.shadow.camera.near = 0.15; torch.shadow.bias = -0.0006; torch.shadow.normalBias = 0.02;
scene.add(torch, torch.target);
const exitLight = new THREE.PointLight(0xfff6e8, 0, 30, 1.2); exitLight.position.set(14, 2, 24.6); scene.add(exitLight);
let curScene = scene;
// 1인칭 팔 (따로 그려서 벽에 파묻히지 않게)
const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(55, 1, 0.01, 5);
vmScene.add(new THREE.HemisphereLight(0xa0a0b0, 0x2a1810, 1.1));
const vmKey = new THREE.DirectionalLight(0xffe0c0, 0.9); vmKey.position.set(-1, 2, 1); vmScene.add(vmKey);
const vmGlow = new THREE.PointLight(0xfff0d0, 0, 1.5, 2); vmGlow.position.set(0.3, -0.1, -0.7); vmScene.add(vmGlow);
const arms = createArms(); vmScene.add(arms.root);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  G.baseFov = w / h < 1 ? 88 : 75;
  camera.aspect = w / h; camera.fov = G.baseFov; camera.updateProjectionMatrix();
  vmCam.aspect = w / h; vmCam.fov = w / h < 1 ? 70 : 55; vmCam.updateProjectionMatrix();
}
function applyQuality() {
  const pr = { low: 1, mid: Math.min(devicePixelRatio, 1.5), high: Math.min(devicePixelRatio, 2) }[SET.q] || 1;
  renderer.setPixelRatio(pr);
  torch.castShadow = SET.q !== 'low';
  const ms = SET.q === 'high' ? 1024 : 512;
  if (torch.shadow.mapSize.x !== ms) { torch.shadow.mapSize.set(ms, ms); if (torch.shadow.map) { torch.shadow.map.dispose(); torch.shadow.map = null; } }
  resize();
}
addEventListener('resize', resize);

/* ── 게임 상태 ── */
const audio = new Audio(); audio.setVolume(SET.vol); audio.sens = SET.sens; audio.noVoice = !SET.voice;
const input = new Input(document.body); input.sens = SET.look;
let world, monster, street, atlasTex;
const G = {
  mode: 'loading', prevMode: 'play', time: 0, chaseTime: 0, busy: false, safe: true,
  hp: 100, st: 100, tired: false, torchOn: true, lastHurt: -99, caught: 0,
  inv: {}, used: {}, diaries: new Set(), clues: {}, code: [0, 0, 0, 0],
  player: { pos: new THREE.Vector3(), hidden: false, spot: null, running: false },
  camYaw: 0, camPitch: 0, eyeH: EYE, roll: 0, hideYaw: 0, hidePitch: 0, walkPh: 0, speed: 0, baseFov: 75,
  micLevel: 0, micThreshold: 0.38, micHideThreshold: 0.2, micCool: 0,
  shake: 0, lightT: 20, flash: 0, focus: null, camera, lookDX: 0, lookDY: 0,
};

/* ── 트윈 · 컷신 도구 ── */
const tweens = new Set(); let skipFlag = false;
const tween = (d, fn) => new Promise(res => { const tw = { t: 0, d, fn, res }; fn(0); tweens.add(tw); });
const wait = d => tween(d, () => { });
const S = async p => { await p; if (skipFlag) throw SKIP; };
function runTweens(dt) {
  for (const tw of [...tweens]) { tw.t += dt; const k = skipFlag ? 1 : Math.min(1, tw.t / tw.d); tw.fn(k); if (k >= 1) { tweens.delete(tw); tw.res(); } }
}
function black(v, d = 0) { const el = $('fx-black'); if (!d) { el.style.opacity = v; return Promise.resolve(); } const a = +el.style.opacity || 0; return tween(d, k => el.style.opacity = a + (v - a) * k); }
function white(v, d = 0) { const el = $('fx-white'); if (!d) { el.style.opacity = v; return Promise.resolve(); } const a = +el.style.opacity || 0; return tween(d, k => el.style.opacity = a + (v - a) * k); }
// 시점 이동: 위치 · 눈높이 · 방향을 함께 부드럽게
function view(pos, eyeH, yaw, pitch, d, e = ease) {
  const p0 = G.player.pos.clone(), h0 = G.eyeH, y0 = G.camYaw, q0 = G.camPitch;
  return tween(d, k => {
    const t = e(k);
    if (pos) G.player.pos.lerpVectors(p0, pos, t);
    if (eyeH != null) G.eyeH = h0 + (eyeH - h0) * t;
    if (yaw != null) G.camYaw = angLerp(y0, yaw, t);
    if (pitch != null) G.camPitch = q0 + (pitch - q0) * t;
  });
}
let sub = { full: '', shown: 0, t: 0 };
function say(name, text, dur = 2.6, gh = false) {
  $('sub-name').textContent = name || ''; sub = { full: text, shown: 0, t: dur };
  $('sub-text').textContent = ''; $('sub').className = 'show' + (gh ? ' gh' : '');
}
async function cineText(t, d) { const el = $('cine-text'); el.textContent = t; el.classList.add('show'); await S(wait(d)); el.classList.remove('show'); await S(wait(0.6)); }
let toastT = 0;
function toast(html, d = 2.8) { const t = $('toast'); t.innerHTML = html; t.classList.add('show'); toastT = d; }
let heardT = 0;
function showHeard(text = '초록모자가 소리를 들었다!') { $('heard').querySelector('span').textContent = text; $('heard').classList.add('show'); $('mic').classList.add('alert'); heardT = 1.8; }

/* ── 모달 ── */
const modalStack = [];
function openModal(id) { $(id).classList.remove('hidden'); modalStack.push(id); if (G.mode === 'play') { G.prevMode = 'play'; G.mode = 'modal'; } }
function closeModal(id) {
  $(id).classList.add('hidden'); const i = modalStack.lastIndexOf(id); if (i >= 0) modalStack.splice(i, 1);
  if (!modalStack.length && G.mode === 'modal') G.mode = G.prevMode || 'play';
  if (id === 'settings') saveSet();
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));

/* ── 로딩 ── */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
function setLoad(p, t) { $('ld-fill').style.width = p + '%'; $('ld-text').textContent = t; }

async function boot() {
  paintIcons();
  { const [c, g] = cv(160); const d = g.createImageData(160, 160); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); $('fx-grain').style.backgroundImage = `url(${c.toDataURL()})`; }
  setLoad(12, '초록모자를 부르는 중...');
  const [atlasImg, fullImg] = await Promise.all([loadImg('assets/greenhat_atlas.png'), loadImg('assets/greenhat_full.png')]);
  setLoad(30, '글꼴을 불러오는 중...');
  try { await Promise.race([Promise.all(['60px "East Sea Dokdo"', '30px "Nanum Pen Script"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]); } catch (e) { }
  setLoad(50, '저택을 짓는 중...'); await nextFrame();
  world = new World(scene, { full: fullImg }, SET.q);
  setLoad(78, '불을 켜는 중...'); await nextFrame();
  atlasTex = new THREE.Texture(atlasImg); atlasTex.needsUpdate = true;
  monster = new Monster(scene, atlasTex, world, audio);
  street = buildStreet();
  applyQuality();
  audio.onSubtitle = t => { if (G.mode === 'play' || G.mode === 'modal') say('초록모자', t, 2.2, true); };
  G.glints = world.inter.filter(i => i.glint).map(i => i.glint).concat(world.items.filter(i => i.glint).map(i => i.glint));
  setLoad(95, '준비 완료'); await nextFrame();
  renderer.compile(scene, camera);
  $('loading').classList.add('hidden');
  toTitle();
  requestAnimationFrame(loop);
}

/* ── 타이틀 ── */
function toTitle() {
  G.mode = 'title'; curScene = scene; tweens.clear(); skipFlag = false;
  for (const id of [...modalStack]) closeModal(id);
  ['hud', 'cine', 'over', 'ending', 'phone', 'card'].forEach(id => $(id).classList.add('hidden'));
  $('over').classList.remove('scare', 'showbox'); $('fx-hide').className = 'fx';
  $('title').classList.remove('hidden');
  world.reset(); newRunState();
  monster.reset(new THREE.Vector3(11, 0, 16.4)); monster.enabled = false;
  black(0); white(0); camera.rotation.z = 0;
  renderer.toneMappingExposure = EXP(); scene.fog.color.copy(FOG); scene.background.copy(FOG); exitLight.intensity = 0;
  audio.chase(0, 0); G.titleT = 0;
}
function titleUpdate(dt) {
  G.titleT += dt; const t = G.titleT;
  camera.position.set(14 + Math.sin(t * 0.15) * 0.6, 1.55 + Math.sin(t * 0.5) * 0.04, 23.1);
  camera.lookAt(13.4 + Math.sin(t * 0.11) * 0.4, 1.35, 16.2);
  monster.dir.set(camera.position.x - monster.pos.x, 0, camera.position.z - monster.pos.z).normalize();
  monster.speed = 0; monster.animate(dt, G); monster.mat.emissiveIntensity = 0.22 + Math.sin(t * 2.3) * 0.05;
  monster.root.visible = !(t % 11 > 10.6);
  world.update(dt, camera.position, monster.pos);
  torch.intensity = 0; fill.intensity = 0;
}
$('m-start').onclick = () => { audio.init(); goFull(); if (SET.mic === null) openModal('micask'); else beginGame(false); };
$('m-intro').onclick = () => { audio.init(); goFull(); beginGame(true); };
$('m-settings').onclick = () => { audio.init(); openSettings(); };
$('m-help').onclick = () => openModal('help');
$('mic-yes').onclick = async () => { closeModal('micask'); await enableMic(true); beginGame(false); };
$('mic-no').onclick = () => { closeModal('micask'); SET.mic = false; saveSet(); beginGame(false); };
function goFull() { if (!isTouch) return; try { const d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => { }); screen.orientation?.lock?.('landscape').catch(() => { }); } catch (e) { } }
async function enableMic(on) {
  if (!on) { audio.stopMic(); SET.mic = false; saveSet(); updateMicUI(); return; }
  try { await audio.startMic(); SET.mic = true; }
  catch (e) { SET.mic = false; toast('마이크를 켤 수 없어요. 마이크 없이 진행합니다.<br><small>(https 주소에서 권한을 허용해야 해요)</small>', 4); }
  saveSet(); updateMicUI();
}
function updateMicUI() { const on = !!audio.mic; $('mic').classList.toggle('off', !on); $('mic').querySelector('i').innerHTML = on ? ICONS.mic : ICONS.micOff; $('s-mic').checked = on; }
async function beginGame(forceIntro) {
  $('title').classList.add('hidden');
  if (SET.mic && !audio.mic) await enableMic(true);
  updateMicUI();
  if (forceIntro || !SET.seenIntro) playIntro(); else startRun(true);
}

/* ── 새 판 ── */
function newRunState() {
  Object.assign(G, { hp: 100, st: 100, tired: false, torchOn: true, lastHurt: -99, caught: 0, time: 0, chaseTime: 0, busy: false, inv: {}, used: {}, diaries: new Set(), clues: {}, focus: null, shake: 0, roll: 0, eyeH: EYE, speed: 0 });
  G.player.hidden = false; G.player.spot = null; G.player.running = false;
  do { G.code = [0, 0, 0, 0].map(() => Math.random() * 10 | 0); } while (new Set(G.code).size < 3);
  world && world.setCode(G.code);
  input.runToggle = false;
}
function newRun() {
  world.reset(); newRunState(); renderInv();
  monster.reset(new THREE.Vector3(25.2, 0, 21.2)); monster.timer = 12; monster.enabled = true;
  for (const h of world.hides) h.doors.forEach(d => d.piv.visible = true);
  renderer.toneMappingExposure = EXP(); scene.fog.color.copy(FOG); scene.background.copy(FOG); exitLight.intensity = 0;
  $('fx-hide').className = 'fx'; $('hidden-tag').classList.remove('show', 'danger');
}

/* ── 프롤로그: 납치 (1인칭) ── */
function buildStreet() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x04060b); s.fog = new THREE.FogExp2(0x04060b, 0.055);
  s.add(new THREE.HemisphereLight(0x50608a, 0x101018, 1.1));
  const moon = new THREE.DirectionalLight(0x8090c0, 1.1); moon.position.set(-6, 10, 8); s.add(moon);
  const asphalt = (() => { const [c, g] = cv(256); g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, 256, 256); const d = g.getImageData(0, 0, 256, 256); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } g.putImageData(d, 0, 0); const t = toTex(c); t.repeat.set(30, 8); return t; })();
  const brick = (() => { const [c, g] = cv(256); g.fillStyle = '#2a1a16'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 32) for (let x = -(y / 32 % 2) * 32; x < 256; x += 64) { g.fillStyle = `rgb(${70 + Math.random() * 30},${34 + Math.random() * 14},${26 + Math.random() * 10})`; g.fillRect(x + 2, y + 2, 60, 28); } const t = toTex(c); t.repeat.set(24, 1); return t; })();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 24), new THREE.MeshLambertMaterial({ map: asphalt })); ground.rotation.x = -Math.PI / 2; ground.position.z = 6; s.add(ground);
  const walk = new THREE.Mesh(new THREE.BoxGeometry(90, 0.14, 3), new THREE.MeshLambertMaterial({ color: 0x3a3a3c })); walk.position.set(0, 0.07, -1.5); s.add(walk);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(90, 2.2, 0.3), new THREE.MeshLambertMaterial({ map: brick })); wall.position.set(0, 1.1, -3.2); s.add(wall);
  for (let i = 0; i < 9; i++) {
    const h = 5 + Math.random() * 5, house = new THREE.Mesh(new THREE.BoxGeometry(7, h, 6), new THREE.MeshLambertMaterial({ color: 0x0c0c12 })); house.position.set(-36 + i * 9, h / 2, -9); s.add(house);
    if (Math.random() < 0.5) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshBasicMaterial({ color: 0x6a5020 })); w.position.set(house.position.x + (Math.random() - 0.5) * 3, h * 0.6, -5.95); s.add(w); }
    const h2 = 4 + Math.random() * 4, house2 = new THREE.Mesh(new THREE.BoxGeometry(7, h2, 6), house.material); house2.position.set(-36 + i * 9, h2 / 2, 17); s.add(house2);
  }
  const lamps = [];
  for (const x of [-14, 0, 14]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), new THREE.MeshLambertMaterial({ color: 0x222 })); pole.position.set(x, 2.2, -2.7); s.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), pole.material); arm.position.set(x, 4.35, -2.2); s.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.25), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })); bulb.position.set(x, 4.3, -1.7); s.add(bulb);
    const sp = new THREE.SpotLight(0xffc888, 60, 14, 0.75, 0.6, 1.3); sp.position.set(x, 4.25, -1.7); sp.target.position.set(x, 0, -1.2); s.add(sp, sp.target);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.2, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.025, fog: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.position.set(x, 2.15, -1.4); s.add(cone);
    lamps.push({ x, sp, bulb, cone });
  }
  const tex = atlasTex.clone(); tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace; tex.repeat.set(1 / 8, 1 / 3);
  const PH = 2.75, PW = PH * 300 / 420, geo = new THREE.PlaneGeometry(PW, PH); geo.translate(0, PH / 2 - 0.04, 0);
  const gh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }));
  gh.visible = false; s.add(gh);
  const frame = (c, r) => tex.offset.set(c / 8, 1 - (r + 1) / 3);
  return { scene: s, lamps, gh, frame };
}
function lampSet(l, v) { l.sp.intensity = 60 * v; l.bulb.material.color.setRGB(1 * v + 0.05, 0.85 * v + 0.04, 0.62 * v + 0.03); l.cone.material.opacity = 0.025 * v; }

async function playIntro() {
  G.mode = 'cine'; G.safe = true; G.cineFn = null; skipFlag = false;
  $('hud').classList.add('hidden'); $('cine').classList.remove('hidden'); $('b-skip').classList.remove('hidden');
  black(1); audio.ambience(false, 0);
  const pl = G.player;
  try {
    await cineText('어느 날 밤, 휴대폰이 울렸다.', 2.4);
    await phoneSeq();
    // 골목길 — 내 눈으로 걷는다
    curScene = street.scene; street.lamps.forEach(l => lampSet(l, 1)); street.gh.visible = false;
    pl.pos.set(-11, 0, -1.2); G.eyeH = EYE + 0.14; G.camYaw = -Math.PI / 2; G.camPitch = -0.06; G.roll = 0; G.speed = 0;
    let lastStep = 0;
    G.cineFn = dt => {
      G.walkPh += dt * G.speed * 2.6;
      const st = Math.floor(G.walkPh / Math.PI); if (G.speed > 0.1 && st !== lastStep) { lastStep = st; audio.step('wood', false); }
      firstPersonCam(dt);
      if (street.gh.visible) street.gh.rotation.y = Math.atan2(camera.position.x - street.gh.position.x, camera.position.z - street.gh.position.z);
    };
    black(0, 1.4);
    G.speed = 2.0;
    say('나', '(초록모자? 모르는 사람이잖아... 그냥 무시하자.)', 3.2);
    const walkTo = (x, d) => { const a = pl.pos.x; return tween(d, k => pl.pos.x = a + (x - a) * k); };
    setTimeout(() => !skipFlag && G.mode === 'cine' && audio.monsterStep({ x: pl.pos.x - 8, z: -1 }, false), 2600);
    setTimeout(() => !skipFlag && G.mode === 'cine' && audio.monsterStep({ x: pl.pos.x - 7, z: -1 }, false), 3200);
    await S(walkTo(-3, 4.4));
    G.speed = 0; say('나', '...누구 있어요?', 2.2);
    await S(view(null, null, Math.PI / 2, -0.02, 1.0));      // 뒤돌아본다
    await S(wait(1.6));
    await S(view(null, null, -Math.PI / 2, -0.06, 0.8));
    say('나', '기분 탓인가...', 1.8);
    G.speed = 2.0; await S(walkTo(0.4, 2.2)); G.speed = 0;
    // 가로등 깜빡 → 꺼짐 → 눈앞에
    const L = street.lamps[1];
    for (let i = 0; i < 6; i++) { lampSet(L, i % 2 ? 1 : 0.1); audio.light(); await S(wait(0.08 + Math.random() * 0.15)); }
    street.lamps.forEach(l => lampSet(l, 0)); audio.light();
    await S(wait(1.1));
    street.gh.visible = true; street.gh.position.set(2.4, 0.14, -1.25); street.frame(2, 2);
    street.lamps.forEach(l => lampSet(l, 1)); audio.stinger(); G.shake = 0.3;
    await S(view(null, null, null, 0.12, 0.4));            // 올려다본다
    say('초록모자', '팔로우... 안 했지?', 2.6, true); audio.monsterVoice('팔로우... 안 했지?', street.gh.position);
    await S(wait(2.4));
    audio.scream(street.gh.position); G.shake = 0.8;
    await S(tween(0.4, k => { street.gh.position.x = 2.4 - 1.7 * ease(k); street.frame(k < 0.5 ? 0 : 1, 2); G.camPitch = 0.12 + k * 0.15; }));
    black(1); G.cineFn = null;
    await S(wait(0.8));
    say('', '[무언가에 질질 끌려가는 소리]', 3); audio.drag();
    await S(wait(3.4));
    say('초록모자', '팔로우 안 한 사람... 한 명 더.', 2.8, true);
    await S(wait(2.8)); audio.slam(); await S(wait(1.3));
  } catch (e) { if (e !== SKIP) console.error(e); }
  skipFlag = false; tweens.clear(); G.cineFn = null; G.speed = 0; G.shake = 0;
  $('phone').classList.add('hidden'); $('cine-text').classList.remove('show'); $('sub').className = '';
  SET.seenIntro = true; saveSet();
  startRun(true);
}
async function phoneSeq() {
  const ph = $('phone'), P = ph.querySelector('.ph'), fin = $('ph-finger');
  ph.classList.remove('hidden'); P.className = 'ph'; black(0);
  $('ph-noti').classList.remove('show'); $('ph-chat').classList.remove('show'); $('ph-chat').innerHTML = '';
  $('ph-profile').style.opacity = 0; $('ph-later').classList.remove('tap');
  fin.innerHTML = ICONS.finger; const pr0 = P.getBoundingClientRect();
  fin.style.left = pr0.width * 0.7 + 'px'; fin.style.top = pr0.height * 1.1 + 'px';
  await S(wait(0.7)); audio.ding(); $('ph-noti').classList.add('show');
  await S(wait(2.2)); $('ph-noti').classList.remove('show'); $('ph-profile').style.opacity = 1;
  await S(wait(1.0));
  const pr = P.getBoundingClientRect(), br = $('ph-later').getBoundingClientRect();
  fin.style.left = (br.left + br.width / 2 - pr.left - 21) + 'px'; fin.style.top = (br.top + br.height / 2 - pr.top - 4) + 'px';
  await S(wait(1.1)); fin.classList.add('tap'); $('ph-later').classList.add('tap'); audio.beep(true);
  await S(wait(0.25)); fin.classList.remove('tap'); await S(wait(0.4));
  fin.style.top = pr.height * 1.1 + 'px'; await S(wait(0.9));
  const chat = $('ph-chat'); chat.classList.add('show');
  chat.innerHTML = `<div class="who"><img src="assets/greenhat_face.png" alt="">초록모자</div>`;
  for (const [t, red, d] of [['왜 맞팔 안 해?', 0, 1.3], ['나 계속 기다렸는데', 0, 1.3], ['팔로우 안 하면...', 0, 1.6], ['내가 직접 데리러 갈게 :)', 1, 2.4]]) {
    const m = document.createElement('div'); m.className = 'msg' + (red ? ' red' : ''); m.textContent = t; chat.appendChild(m);
    red ? audio.glitch() : audio.ding(); await S(wait(d));
  }
  P.classList.add('glitch'); audio.glitch(); await S(wait(0.9));
  P.classList.remove('glitch'); P.classList.add('off'); await S(wait(0.9));
  ph.classList.add('hidden'); black(1);
}

/* ── 깨어남 → 플레이 ── */
async function startRun(card) {
  newRun();
  G.mode = 'cine'; G.safe = true; curScene = scene; skipFlag = false;
  $('hud').classList.add('hidden'); $('cine').classList.remove('hidden'); $('b-skip').classList.remove('hidden');
  const pl = G.player;
  // 침대에 누워 천장을 보는 상태
  pl.pos.set(2.6, 0, 0.75); G.eyeH = 0.95; G.camYaw = Math.PI; G.camPitch = 1.35; G.roll = 0.15;
  G.cineFn = dt => { firstPersonCam(dt); world.update(dt, pl.pos, monster.pos); fill.position.set(pl.pos.x, 2, pl.pos.z); fill.intensity = 0.8; };
  black(1);
  try {
    // 눈을 깜빡이며 뜬다
    await S(black(0.35, 1.0)); await S(black(0.9, 0.5)); await S(black(0, 1.2));
    say('나', '으... 머리야...', 2); await S(wait(1.6));
    await S(Promise.all([view(new THREE.Vector3(2.6, 0, 1.3), 1.2, Math.PI, -0.15, 1.1), tween(1.1, k => G.roll = 0.15 * (1 - k))]));
    await S(view(new THREE.Vector3(4.05, 0, 1.75), EYE, -Math.PI / 2 + 0.5, -0.05, 1.0));
    say('나', '여긴... 어디지?', 2);
    await S(view(null, null, -Math.PI / 2 - 0.6, 0, 1.2));
    await S(view(null, null, -Math.PI / 2, -0.08, 0.8));
  } catch (e) { if (e !== SKIP) console.error(e); }
  skipFlag = false; tweens.clear(); black(0); $('sub').className = '';
  pl.pos.set(4.05, 0, 1.75); G.eyeH = EYE; G.camYaw = -Math.PI / 2; G.camPitch = -0.08; G.roll = 0;
  G.torchOn = true;
  $('cine').classList.add('hidden'); $('hud').classList.remove('hidden'); updateButtons();
  G.mode = 'play'; G.safe = false; G.cineFn = null;
  if (card) { const c = $('card'); c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; setTimeout(() => c.classList.add('hidden'), 4200); }
  setTimeout(() => G.mode === 'play' && toast(isTouch ? '왼쪽 <b>조이스틱</b>으로 이동 · 화면을 <b>끌어서</b> 둘러보기' : '<b>WASD</b> 이동 · <b>마우스 드래그</b> 둘러보기 · <b>E</b> 조사 · <b>Shift</b> 달리기', 4.5), 4300);
  setTimeout(() => G.mode === 'play' && toast(audio.mic ? '초록모자는 <b>소리</b>를 듣는다. 크게 말하지 마...' : '초록모자는 <b>발소리</b>를 듣는다. 함부로 뛰지 마...', 4), 9500);
}
$('b-skip').onclick = () => { if (G.mode === 'cine') skipFlag = true; };

/* ── 탈출 ── */
async function startExit() {
  G.mode = 'cine'; G.safe = true; monster.enabled = false; G.busy = true;
  $('hud').classList.add('hidden'); $('cine').classList.remove('hidden'); $('b-skip').classList.add('hidden');
  audio.chase(0, 0);
  const f = world.front, pl = G.player;
  f.col.on = false; f.outside.visible = true; f.crack.forEach(c => c.visible = false);
  if (monster.pos.distanceTo(pl.pos) < 6) monster.root.visible = false;
  G.speed = 0;
  G.cineFn = dt => { G.walkPh += dt * G.speed * 2.6; firstPersonCam(dt); world.update(dt, pl.pos, null); };
  // 문 앞으로 시선을 옮긴다
  G.speed = 1.2;
  await view(new THREE.Vector3(14, 0, 22.7), EYE, Math.PI, 0.02, 1.4);
  G.speed = 0;
  audio.door({ x: 14, y: 1.5, z: 24 }, true); audio.wind(true);
  const W = new THREE.Color(0xfff8ec);
  await tween(2.6, k => {
    const e = ease(k);
    f.doors.forEach((d, i) => d.rotation.y = (i ? 1 : -1) * 1.65 * e);
    exitLight.intensity = 40 * e; renderer.toneMappingExposure = EXP() + e * 1.6;
    scene.fog.color.copy(FOG).lerp(W, e * 0.8); scene.background.copy(scene.fog.color); white(e * 0.2);
  });
  G.speed = 2.0;
  const a = pl.pos.clone(), b = new THREE.Vector3(14, 0, 25.6);
  await tween(3.0, k => { pl.pos.lerpVectors(a, b, k); G.camPitch = 0.02 + k * 0.12; white(0.2 + 0.8 * clamp((k - 0.3) / 0.7, 0, 1)); renderer.toneMappingExposure = EXP() + 1.6 + k * 2; });
  G.speed = 0; G.cineFn = null;
  $('cine').classList.add('hidden');
  const tsec = Math.round(G.time), mm = (tsec / 60 | 0), ss = String(tsec % 60).padStart(2, '0');
  if (!SET.best || tsec < SET.best) SET.best = tsec; saveSet();
  $('end-stats').innerHTML = `탈출 시간 <b>${mm}:${ss}</b> · 공격당한 횟수 <b>${G.caught}</b> · 최고 기록 <b>${SET.best / 60 | 0}:${String(SET.best % 60).padStart(2, '0')}</b><br>소리 감지 센서: ${audio.mic ? '켜짐' : '꺼짐'}`;
  $('ending').classList.remove('hidden'); G.mode = 'end';
}
$('e-title').onclick = () => toTitle();

/* ── HUD ── */
function renderInv() {
  $('inv').innerHTML = ['rusty', 'silver', 'gold'].filter(k => G.inv[k]).map(k => `<div class="key ${k}${G.used[k] ? ' used' : ''}" title="${KEYS[k]}">${ICONS.key}</div>`).join('');
}
function objective() {
  const d = world.doors, f = world.front, n = Object.keys(G.clues).length;
  if (!G.diaries.has(1)) return '방을 살펴보자 — 책상 위에 무언가 있다';
  if (!G.inv.rusty) return '녹슨 열쇠를 찾자';
  if (d.study.locked) return '녹슨 열쇠로 서재 문을 열자';
  if (!G.diaries.has(2)) return '서재를 조사하자';
  if (!G.inv.silver) return '은색 열쇠를 찾자';
  if (d.kids.locked) return '은색 열쇠로 아이방 문을 열자';
  if (!G.inv.gold) return '아이방에서 금색 열쇠를 찾자';
  if (n < 4 && f.keypad) return `비밀번호 숫자를 찾자 (${n}/4)`;
  if (f.padlock || f.keypad) return '현관문을 열자';
  return '현관문으로 탈출하라!';
}
function updateButtons() {
  $('b-run').classList.toggle('on', input.runToggle);
  $('b-torch').classList.toggle('on', G.torchOn);
}
function interLabel(it) {
  switch (it.kind) {
    case 'door': { const d = it.door; if (d.locked) return G.inv[d.lock] ? `${KEYS[d.lock]}로 열기` : `${d.name} — 잠김`; return d.open ? '문 닫기' : '문 열기'; }
    case 'hide': return it.spot.label;
    case 'diary': return '일기 줍기';
    case 'front': { const f = world.front; if (f.padlock) return G.inv.gold ? '금색 열쇠로 자물쇠 풀기' : '현관문 살펴보기'; if (f.keypad) return '비밀번호 입력'; return '문 열고 나가기'; }
    default: return it.label || '살펴보기';
  }
}
// 화면 가운데(바라보는 방향)에 가까운 것을 고른다
function findInter() {
  const p = G.player.pos, fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw); let best = null, bs = 1e9;
  for (const it of world.inter) {
    if (it.kind === 'diary' && it.read) continue; if (it.kind === 'drawer' && it.opened) continue;
    const dx = it.pos.x - p.x, dz = it.pos.z - p.z, d = Math.hypot(dx, dz);
    if (d > (it.r || 1.3) + 0.2) continue;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < 0.45 && d > 0.6) continue;
    const s = d * (1.6 - dot);
    if (s < bs) { bs = s; best = it; }
  }
  return best;
}
let lastAct = '';
function updateHUD(dt) {
  $('hp-fill').style.width = G.hp + '%'; $('st-fill').style.width = G.st + '%'; $('st-fill').classList.toggle('tired', G.tired);
  $('objective').textContent = objective();
  const pl = G.player, btn = $('b-act'); let key;
  if (pl.hidden) key = 'out';
  else if (G.focus && !G.busy) key = 'f:' + interLabel(G.focus);
  else key = 'none';
  if (key !== lastAct) {
    lastAct = key;
    btn.querySelector('i').innerHTML = pl.hidden ? ICONS.door : ICONS.hand;
    btn.querySelector('span').textContent = pl.hidden ? '나가기' : '조사';
    btn.classList.toggle('ready', key.startsWith('f:')); btn.classList.toggle('dim', key === 'none');
    $('cross').className = key.startsWith('f:') ? 'on' : pl.hidden ? 'off' : '';
    const pr = $('prompt');
    if (key.startsWith('f:')) { pr.textContent = (isTouch ? '' : '[E] ') + key.slice(2); pr.classList.add('show'); }
    else if (pl.hidden) { pr.textContent = (isTouch ? '' : '[E] ') + '밖으로 나가기'; pr.classList.add('show'); }
    else pr.classList.remove('show');
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
  if (heardT > 0) { heardT -= dt; if (heardT <= 0) { $('heard').classList.remove('show'); $('mic').classList.remove('alert'); } }
}

/* ── 상호작용 ── */
input.on('interact', () => interact());
input.on('run', () => { if (G.mode !== 'play') return; input.runToggle = !input.runToggle; updateButtons(); });
input.on('torch', () => { if (G.mode !== 'play' || G.player.hidden) return; G.torchOn = !G.torchOn; audio.light(); updateButtons(); });
input.on('notes', () => { if (G.mode === 'play') openNotes(); else if (modalStack.at(-1) === 'notes') closeModal('notes'); });
input.on('pause', () => { if (G.mode === 'play') openModal('pause'); else if (modalStack.length) closeModal(modalStack.at(-1)); });
$('mic').addEventListener('click', () => { if (G.mode === 'play') openSettings(); });

function noise(r, kind = 'noise', pos = G.player.pos) {
  if (!monster.enabled || G.safe) return false;
  return monster.hear(pos, r, G, kind);
}
async function interact() {
  if (G.mode !== 'play' || G.busy) return;
  if (G.player.hidden) return exitHide();
  const it = G.focus; if (!it) return;
  if (it.kind !== 'hide') arms.reach();
  switch (it.kind) {
    case 'door': {
      const d = it.door;
      if (d.locked) {
        if (G.inv[d.lock]) { d.locked = false; G.used[d.lock] = true; if (d.lockMesh) d.lockMesh.visible = false; audio.unlock(); d.setOpen(true); audio.door(d.pos); toast(`<b>${KEYS[d.lock]}</b>로 ${d.name}을 열었다.`); noise(5); renderInv(); }
        else { audio.locked(); toast(`잠겨 있다. ${d.lock === 'rusty' ? '녹슨' : '은색'} 자물쇠가 달려 있다.`); noise(4); }
      } else { d.setOpen(!d.open); audio.door(d.pos); noise(4.5); }
      break;
    }
    case 'hide': enterHide(it.spot); break;
    case 'drawer': {
      it.opened = true; audio.drawer(); noise(3); G.busy = true;
      await tween(0.45, k => { if (it.lid) it.dr.rotation.x = -1.9 * ease(k); else it.dr.position.copy(it.slide).multiplyScalar(ease(k)); });
      if (it.item) {
        if (it.glint) it.glint.visible = true;
        await wait(0.35);
        const k = it.item.key; it.mesh.visible = false; if (it.glint) it.glint.visible = false;
        arms.reach(); G.inv[k] = true; audio.pickup(); toast(`<b>${KEYS[k]}</b>를 얻었다!`); renderInv();
      } else toast('비어 있다.');
      G.busy = false; break;
    }
    case 'diary': it.read = true; it.mesh.visible = false; it.glint.visible = false; G.diaries.add(it.id); audio.paper(); openNotes('d' + it.id); break;
    case 'clue': {
      const d = G.code[ORDER.indexOf(it.id)]; const first = G.clues[it.id] === undefined; G.clues[it.id] = d;
      if (it.id === 'piano') { audio.piano(); noise(9); } else if (it.id === 'clock') audio.tick(); else audio.paper();
      toast(CLUE[it.id].text(d) + (first ? '<br><small>단서가 일기장에 기록되었다</small>' : ''), 4);
      if (it.id === 'piano') setTimeout(() => toast('건반이 울려 버렸다...!', 2), 1800);
      break;
    }
    case 'flavor': toast(it.text, 4); break;
    case 'front': {
      const f = world.front;
      if (f.padlock) {
        if (G.inv.gold) { f.padlock = false; G.used.gold = true; f.chain.visible = false; audio.unlock(); noise(5); toast('<b>금색 열쇠</b>로 쇠사슬 자물쇠를 풀었다!'); renderInv(); }
        else { audio.locked(); noise(5); toast('굵은 쇠사슬과 <b>금색 자물쇠</b>, 그리고 <b>비밀번호 장치</b>로 잠겨 있다.\n문틈으로 눈부신 빛이 새어 들어온다.', 4); }
      } else if (f.keypad) openKeypad();
      else startExit();
      break;
    }
  }
}

/* ── 숨기 (1인칭) ── */
function eyeOf(spot) {
  const o = spot.out;
  if (spot.type === 'bed') return spot.front.clone().addScaledVector(o, -0.68).setY(0.2);
  if (spot.type === 'cabinet') return spot.inside.clone().addScaledVector(o, 0.18).setY(0.52);
  return spot.inside.clone().addScaledVector(o, 0.14).setY(1.5);
}
const flat = v => new THREE.Vector3(v.x, 0, v.z);
const setDoors = (spot, v) => spot.doors.forEach(d => d.piv.rotation.y = d.open * v);
async function enterHide(spot) {
  const pl = G.player; G.busy = true; input.runToggle = false; updateButtons();
  const outYaw = yawTo(spot.out.x, spot.out.z), inYaw = yawTo(-spot.out.x, -spot.out.z), eye = eyeOf(spot);
  await view(spot.front, EYE, inYaw, -0.1, 0.35);
  audio.hide(spot.type); noise(2.5);
  if (spot.type === 'bed') {
    await view(null, null, outYaw, 0, 0.4);              // 침대를 등지고
    await view(null, 0.3, null, 0.25, 0.5);              // 바닥에 눕고
    await view(flat(eye), eye.y, null, 0.05, 0.7);       // 침대 밑으로 밀고 들어간다
  } else {
    await tween(0.3, k => setDoors(spot, ease(k)));
    await view(flat(eye), spot.type === 'cabinet' ? eye.y : EYE, null, spot.type === 'cabinet' ? -0.2 : -0.05, 0.5);
    await view(null, null, outYaw, -0.05, 0.35);         // 안에서 돌아선다
    await tween(0.3, k => setDoors(spot, 1 - ease(k)));
  }
  if (G.mode !== 'play' && G.mode !== 'modal') return;
  pl.hidden = true; pl.spot = spot; spot.doors.forEach(d => d.piv.visible = false);
  G.eyeH = eye.y; pl.pos.copy(flat(eye));
  $('fx-hide').className = 'fx ' + spot.type; $('hidden-tag').classList.add('show');
  G.hideYaw = 0; G.hidePitch = G.camPitch;
  monster.sawHide = (monster.chasing && monster.seenT < 0.9 && monster.pos.distanceTo(pl.pos) < 12) ? spot : null;
  G.busy = false;
}
async function exitHide() {
  const pl = G.player, spot = pl.spot; G.busy = true; pl.hidden = false; pl.spot = null;
  spot.doors.forEach(d => d.piv.visible = true);
  $('fx-hide').className = 'fx'; $('hidden-tag').classList.remove('show', 'danger');
  audio.hide(spot.type); noise(2.5);
  const outYaw = yawTo(spot.out.x, spot.out.z);
  if (spot.type === 'bed') {
    await view(spot.front, 0.3, outYaw, 0.1, 0.6);
    await view(null, EYE, null, -0.05, 0.45);
  } else {
    await tween(0.25, k => setDoors(spot, ease(k)));
    await view(spot.front, EYE, outYaw, -0.05, 0.45);
    await tween(0.3, k => setDoors(spot, 1 - ease(k)));
  }
  G.busy = false;
}
G.onPulled = (spot, m) => {
  const pl = G.player; pl.hidden = false; pl.spot = null; G.busy = false; tweens.clear();
  spot.doors.forEach(d => { d.piv.visible = true; d.piv.rotation.y = d.open; });
  pl.pos.copy(spot.front).addScaledVector(spot.out, 0.35); G.eyeH = EYE;
  G.camYaw = yawTo(m.pos.x - pl.pos.x || -spot.out.x, m.pos.z - pl.pos.z || -spot.out.z); G.camPitch = 0.05; G.shake = 0.6;
  $('fx-hide').className = 'fx'; $('hidden-tag').classList.remove('show', 'danger');
  audio.stinger(); toast('들켰다!!', 1.5);
  setTimeout(() => tween(0.3, k => setDoors(spot, 1 - k)), 1200);
};
G.onSpotted = () => { audio.stinger(); showHeard('들켰다! 도망쳐!'); G.chaseTime = 0; };
G.onHit = m => {
  const pl = G.player;
  G.hp = Math.max(0, G.hp - 34); G.caught++; G.lastHurt = G.time; arms.hurt(); audio.hit(); G.shake = 0.8;
  $('fx-dmg').style.opacity = 1; tween(0.6, k => $('fx-dmg').style.opacity = 1 - k);
  let dx = pl.pos.x - m.pos.x, dz = pl.pos.z - m.pos.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { dx = Math.sin(G.camYaw); dz = Math.cos(G.camYaw); d = 1; }
  for (let i = 0; i < 8; i++) { pl.pos.x += dx / d * 0.16; pl.pos.z += dz / d * 0.16; world.collide(pl.pos, 0.3); }
  G.camYaw = yawTo(m.pos.x - pl.pos.x, m.pos.z - pl.pos.z);   // 맞으면 괴물 쪽으로 고개가 돌아간다
  if (G.hp <= 0) die(); else toast(G.hp < 40 ? '피가 많이 난다... 한 번 더 맞으면 끝이야!' : '초록모자에게 공격당했다! 도망쳐!', 2);
};
function die() {
  G.mode = 'dead'; monster.enabled = false; G.busy = false; tweens.clear(); audio.chase(0, 0);
  $('hud').classList.add('hidden');
  // 1인칭으로 쓰러진다
  tween(0.6, k => { G.eyeH = EYE - (EYE - 0.3) * ease(k); G.roll = 1.1 * ease(k); G.camPitch = 0.3 * k; });
  const lines = ['초록모자: "팔로우 했으면 됐잖아."', '초록모자: "이제 영원히 내 팔로워야."', '초록모자: "맞팔... 해줄 거지?"'];
  $('over-line').textContent = lines[Math.random() * lines.length | 0];
  setTimeout(() => {
    if (G.mode !== 'dead') return;
    audio.jumpscare();
    const o = $('over'); o.classList.remove('hidden', 'showbox', 'scare'); void o.offsetWidth; o.classList.add('scare');
    setTimeout(() => o.classList.add('showbox'), 1500);
  }, 700);
}
$('o-retry').onclick = () => { $('over').classList.add('hidden'); startRun(false); };
$('o-title').onclick = () => toTitle();

/* ── 일기 · 단서 ── */
function openNotes(tab) {
  const tabs = [...G.diaries].sort().map(i => ['d' + i, i === 3 ? '크레용 일기' : `일기 ${i}`]);
  tabs.push(['clue', '단서']);
  if (!tab) tab = tabs[0][0];
  $('note-tabs').innerHTML = tabs.map(([id, t]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${t}</button>`).join('');
  $('note-tabs').querySelectorAll('button').forEach(b => b.onclick = () => { audio.paper(); openNotes(b.dataset.tab); });
  const page = $('note-page');
  if (tab === 'clue') {
    const order = G.diaries.has(2);
    let h = `<h3>단서</h3><p class="who">찾은 것들</p>`;
    h += `<div class="code">${ORDER.map(id => `<span>${G.clues[id] ?? '?'}</span>`).join('')}</div>`;
    h += order ? `순서: 거울 → 괘종시계 → 초상화 → 피아노\n` : `숫자의 순서를 모르겠다... 다른 일기에 적혀 있을지도.\n`;
    h += '<ul>' + ORDER.map(id => `<li>${CLUE[id].name}: ${G.clues[id] !== undefined ? '<b>' + G.clues[id] + '</b>' : '아직 못 찾음'}</li>`).join('') + '</ul>';
    h += '<ul>' + Object.entries(KEYS).map(([k, n]) => `<li>${n}: ${G.inv[k] ? (G.used[k] ? '사용함' : '가지고 있음') : '없음'}</li>`).join('') + '</ul>';
    page.innerHTML = h;
  } else {
    const d = DIARY[tab.slice(1)];
    page.innerHTML = `<h3>${d.title}</h3><p class="who">— ${d.who}</p>${d.text}<div class="stain"></div>`;
  }
  page.scrollTop = 0;
  if (!modalStack.includes('notes')) openModal('notes');
}

/* ── 비밀번호 ── */
let kpEntry = '';
function openKeypad() { kpEntry = ''; drawKp(); openModal('keypad'); }
function drawKp(cls = '') { const s = $('kp-screen'); s.textContent = (kpEntry + '____').slice(0, 4).split('').join(' '); s.className = 'kp-screen ' + cls; }
$('kp-grid').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(k => `<button data-k="${k}" class="${k === 'C' ? 'c' : k === 'OK' ? 'e' : ''}">${k === 'C' ? '지움' : k === 'OK' ? '확인' : k}</button>`).join('');
addEventListener('keydown', e => {
  if (modalStack.at(-1) !== 'keypad') return;
  const k = /^\d$/.test(e.key) ? e.key : e.key === 'Enter' ? 'OK' : e.key === 'Backspace' ? 'C' : null;
  if (k) { e.preventDefault(); e.stopPropagation(); kpPress(k); }
}, true);
$('kp-grid').querySelectorAll('button').forEach(b => b.onclick = () => kpPress(b.dataset.k));
function kpPress(k) {
  if (k === 'C') { kpEntry = ''; audio.beep(true); drawKp(); return; }
  if (k === 'OK') {
    if (kpEntry === G.code.join('')) {
      audio.beep(true); audio.unlock(); drawKp('ok'); world.front.keypad = false; world.front.screen.material.color.setHex(0x0a4010);
      setTimeout(() => { closeModal('keypad'); toast(world.front.padlock ? '철컥! 비밀번호가 풀렸다. 이제 자물쇠만 남았다.' : '철컥! 잠금이 모두 풀렸다! 문을 열자!', 3); }, 700);
    } else {
      audio.beep(false); audio.alarm(); drawKp('bad'); kpEntry = '';
      setTimeout(() => { closeModal('keypad'); toast('틀렸다! 경보음이 울려 퍼진다...!', 2.5); showHeard('경보음! 초록모자가 온다!'); noise(30); }, 500);
    }
    return;
  }
  if (kpEntry.length < 4) { kpEntry += k; audio.beep(true); drawKp(); }
}

/* ── 설정 ── */
function openSettings() {
  $('s-mic').checked = !!audio.mic; $('s-sens').value = SET.sens; $('s-vol').value = SET.vol; $('s-look').value = SET.look; $('s-q').value = SET.q; $('s-voice').checked = SET.voice; $('s-bright').value = SET.bright;
  openModal('settings');
}
$('s-mic').onchange = e => enableMic(e.target.checked);
$('s-sens').oninput = e => { SET.sens = +e.target.value; audio.sens = SET.sens; };
$('s-vol').oninput = e => { SET.vol = +e.target.value; audio.setVolume(SET.vol); };
$('s-look').oninput = e => { SET.look = +e.target.value; input.sens = SET.look; };
$('s-bright').oninput = e => { SET.bright = +e.target.value; renderer.toneMappingExposure = EXP(); };
$('s-q').onchange = e => { SET.q = e.target.value; applyQuality(); };
$('s-voice').onchange = e => { SET.voice = e.target.checked; audio.noVoice = !SET.voice; };
$('p-resume').onclick = () => closeModal('pause');
$('p-settings').onclick = () => openSettings();
$('p-help').onclick = () => openModal('help');
$('p-restart').onclick = () => { closeModal('pause'); startRun(false); };
$('p-title').onclick = () => toTitle();
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play') openModal('pause'); });

/* ── 1인칭 카메라 ── */
const tmpV = new THREE.Vector3(), lookDir = new THREE.Vector3();
function firstPersonCam(dt) {
  const pl = G.player, sp = G.speed, run = pl.running;
  const k = Math.min(1, sp / 2.5);
  const bobY = (pl.hidden ? Math.sin(G.time * 1.6) * 0.008 : -Math.abs(Math.sin(G.walkPh)) * (run ? 0.07 : 0.04) * k);
  const bobX = Math.cos(G.walkPh) * (run ? 0.035 : 0.02) * k;
  const y = G.camYaw, p = G.camPitch;
  lookDir.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  camera.position.set(pl.pos.x + Math.cos(y) * bobX, clamp(G.eyeH + bobY, 0.12, CEIL - 0.12), pl.pos.z - Math.sin(y) * bobX);
  camera.lookAt(tmpV.copy(camera.position).add(lookDir));
  camera.rotateZ(G.roll + Math.sin(G.walkPh) * 0.006 * k);
  if (G.shake > 0) { G.shake -= dt; const s = G.shake * 0.1; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; }
  const fov = G.baseFov + (run && sp > 3 ? 7 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
}

/* ── 플레이 업데이트 ── */
function surfaceAt(p) {
  const r = roomAt(p.x, p.z); if (!r) return 'wood';
  if (r.id === 'hall' && Math.abs(p.z - 8.5) < 0.6) return 'rug';
  return r.fl === 'tileF' ? 'tile' : r.fl === 'marble' ? 'marble' : 'wood';
}
let lastStep = 0;
function updatePlayer(dt) {
  const pl = G.player;
  const [lx, ly] = input.takeLook(); G.lookDX = lx; G.lookDY = ly;
  if (pl.hidden && !G.busy) {
    G.hideYaw = clamp(G.hideYaw - lx, -0.85, 0.85); G.hidePitch = clamp(G.hidePitch - ly, -0.5, 0.4);
    G.camYaw = yawTo(pl.spot.out.x, pl.spot.out.z) + G.hideYaw; G.camPitch = G.hidePitch;
  } else if (!G.busy) { G.camYaw -= lx; G.camPitch = clamp(G.camPitch - ly, -1.35, 1.25); }
  let sp = 0, run = false;
  if (!G.busy && !pl.hidden) {
    const mv = input.move();
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const mx = fx * mv.y + rx * mv.x, mz = fz * mv.y + rz * mv.x;
    const want = input.running && mv.y > 0.3 && !G.tired;
    sp = (want ? 4.9 : 2.5) * mv.mag; run = want;
    if (mv.mag > 0.05) { pl.pos.x += mx * sp * dt; pl.pos.z += mz * sp * dt; world.collide(pl.pos, 0.3); }
    if (run) { G.st -= 19 * dt; if (G.st <= 0) { G.st = 0; G.tired = true; input.runToggle = false; updateButtons(); toast('숨이 차다...', 1.5); } }
    else { G.st = Math.min(100, G.st + (mv.mag > 0.05 ? 11 : 18) * dt); if (G.tired && G.st > 35) G.tired = false; }
    G.walkPh += sp * dt * Math.PI / (run ? 1.25 : 0.72);
    const st = Math.floor(G.walkPh / Math.PI);
    if (sp > 0.2 && st !== lastStep) { lastStep = st; const s = surfaceAt(pl.pos); audio.step(s, run); noise(run ? 9.5 : (s === 'rug' ? 1.2 : 2.2), 'step'); }
  } else if (G.busy) sp = 1.2;
  pl.running = run; G.speed = sp;
  if (G.time - G.lastHurt > 8 && G.hp < 100) G.hp = Math.min(100, G.hp + 2.5 * dt);
}
function updateTorch() {
  const on = G.torchOn && !G.player.hidden && (G.mode === 'play' || G.mode === 'modal');
  torch.intensity = on ? 110 : 0; vmGlow.intensity = on ? 0.6 : 0;
  if (on) {
    camera.getWorldDirection(tmpV);
    // 오른손 높이에서 비춘다
    torch.position.copy(camera.position).addScaledVector(tmpV, 0.3);
    torch.position.x += Math.cos(G.camYaw) * 0.22; torch.position.z -= Math.sin(G.camYaw) * 0.22; torch.position.y -= 0.2;
    torch.target.position.copy(camera.position).addScaledVector(tmpV, 12);
  }
  fill.position.set(G.player.pos.x, 2.0, G.player.pos.z); fill.intensity = G.player.hidden ? 0.15 : 0.8;
}
function playUpdate(dt) {
  G.time += dt;
  const pl = G.player;
  updatePlayer(dt);
  G.focus = (G.busy || pl.hidden) ? null : findInter();
  if (audio.mic) {
    const lv = audio.readMic(dt); G.micLevel = lv;
    const md = monster.pos.distanceTo(pl.pos);
    const th = pl.hidden ? (md < 5 ? G.micHideThreshold : 0.3) : G.micThreshold;
    G.micCool -= dt;
    if (lv > th && G.micCool <= 0) { G.micCool = 0.9; if (noise(4 + lv * 24, 'voice')) showHeard(); }
    $('mic-fill').style.width = (lv * 100) + '%'; $('mic-th').style.left = (th * 100) + '%';
  } else G.micLevel = 0;
  monster.update(dt, G);
  if (monster.chasing) G.chaseTime += dt;
  firstPersonCam(dt);
  updateTorch();
  arms.update(dt, { speed: G.speed, run: pl.running, torchOn: G.torchOn, lookDX: G.lookDX / Math.max(dt, 0.016) * 0.016, lookDY: G.lookDY / Math.max(dt, 0.016) * 0.016 });
  world.update(dt, pl.pos, monster.pos);
  const md = monster.pos.distanceTo(pl.pos), near = clamp(1 - md / 12, 0, 1);
  audio.chase(monster.chasing ? 1 : monster.state === 'search' || monster.state === 'goCheck' ? 0.25 : 0, dt);
  if (near > 0.15 || monster.chasing) audio.heartbeat(70 + near * 70 + (monster.chasing ? 25 : 0), 0.2 + near * 0.6);
  $('fx-vig').style.opacity = 0.75 + near * 0.25;
  $('fx-low').style.opacity = G.hp < 70 ? (1 - G.hp / 100) * (0.8 + Math.sin(G.time * 5) * 0.2) : 0;
  $('hidden-tag').classList.toggle('danger', pl.hidden && md < 4.5);
  audio.ambience(true, dt);
  G.lightT -= dt;
  if (G.lightT <= 0) { G.lightT = 24 + Math.random() * 30; world.lightning = 0.55; G.flash = 0.5; audio.thunder(0.4 + Math.random() * 0.8); }
  G.flash = Math.max(0, G.flash - dt); hemi.intensity = 0.5 + (G.flash > 0.25 ? 0.9 : G.flash > 0.12 && G.flash < 0.18 ? 0.6 : 0);
  for (const g of G.glints) g.material.opacity = 0.45 + Math.sin(G.time * 3.2) * 0.35;
  updateHUD(dt);
}

/* ── 메인 루프 ── */
let last = performance.now();
function micMeter(dt) { const lv = audio.readMic(dt); $('s-micfill').style.width = lv * 100 + '%'; $('s-miclabel').textContent = audio.mic ? (lv > G.micThreshold ? '초록모자가 들어요!' : '조용함') : '마이크 꺼짐'; }
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.mode !== 'modal') runTweens(dt);
  if (sub.t > 0) { sub.t -= dt; sub.shown = Math.min(sub.full.length, sub.shown + dt * 28); $('sub-text').textContent = sub.full.slice(0, Math.ceil(sub.shown)); if (sub.t <= 0) $('sub').className = ''; }
  switch (G.mode) {
    case 'title': titleUpdate(dt); break;
    case 'play': playUpdate(dt); break;
    case 'cine': if (G.cineFn) G.cineFn(dt); else if (curScene === scene) world.update(dt, camera.position, monster.pos); if (curScene === scene && monster.root.visible) monster.animate(dt, G); updateTorch(); break;
    case 'dead': G.time += dt; firstPersonCam(dt); world.update(dt, G.player.pos, monster.pos); monster.animate(dt, G); break;
  }
  if (modalStack.includes('settings')) micMeter(dt);
  if (audio.ctx) { camera.getWorldDirection(tmpV); audio.listener(camera.position, tmpV); audio.lastCam = camera.position; if (monster) audio.monsterAt(monster.pos); }
  renderer.autoClear = true;
  renderer.render(curScene, camera);
  if ((G.mode === 'play' || G.mode === 'modal') && !G.player.hidden && !G.busy) {
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, vmCam);
  }
}

if (location.search.includes('debug')) window.GH = { G, torch, renderer, arms, get world() { return world; }, get monster() { return monster; }, camera, startExit, die, interact, THREE };
boot().catch(e => { console.error(e); $('ld-text').textContent = '불러오기 실패: ' + e.message + ' — 웹서버(https 또는 localhost)에서 열어 주세요.'; });
