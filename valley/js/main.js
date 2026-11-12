// 계곡 물막이 — 메인 루프
import * as THREE from 'three';
import RAPIER from 'rapier';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import * as T from './terrain.js';
import * as W from './water.js';
import * as S from './stones.js';
import * as PL from './player.js';
import * as FX from './fx.js';
import * as N from './nature.js';
import * as A from './audio.js';
import { makeSky } from './sky.js';

const QUAL = {
  ultra: { pr: 2, shadow: 4096, refr: 0.75, grass: 16000, flowers: 700, pine: 1300, broad: 450, bloom: true, stones: 170, msaa: 4 },
  high: { pr: 1.5, shadow: 2048, refr: 0.6, grass: 9000, flowers: 450, pine: 800, broad: 280, bloom: true, stones: 150, msaa: 4 },
  perf: { pr: 1, shadow: 2048, refr: 0.5, grass: 7000, flowers: 350, pine: 600, broad: 200, bloom: true, stones: 140, msaa: 2, perf: true },
};
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (/ValleyDamApp/.test(navigator.userAgent)) $('apk').remove(); // 앱 안에서는 다운로드 링크 숨김
let qKey = params.get('q');
try { qKey = qKey || localStorage.getItem('valley.q'); } catch {}
if (!QUAL[qKey]) qKey = isTouch ? 'perf' : 'ultra';
const segBtns = [...document.querySelectorAll('#quality button')];
const pickQ = k => { qKey = k; segBtns.forEach(b => { b.classList.toggle('on', b.dataset.q === k); b.setAttribute('aria-checked', b.dataset.q === k); }); };
segBtns.forEach(b => b.onclick = () => pickQ(b.dataset.q)); pickQ(qKey);

let fxaa, renderer, scene, camera, composer, refrRT, water, sky, sun, hemi, world, events, Q, bloom, gradePass, basePR;
let started = false, paused = false, perf = false, rainOn = false;
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const prog = v => { $('progbar').style.width = Math.round(v * 100) + '%'; };
if (params.has('debug')) window.__dbg = { T, W, S, PL, get cam() { return camera; }, get paused() { return paused; }, run() { paused = false; $('pause').classList.add('hidden'); }, setPerf: v => setPerf(v), setRain: v => setRain(v) };

$('go').onclick = async () => {
  $('go').disabled = true; segBtns.forEach(b => b.disabled = true); $('go').textContent = '불러오는 중';
  document.querySelector('.prog').classList.add('on');
  try { localStorage.setItem('valley.q', qKey); } catch {}
  A.init();
  try { await boot(QUAL[qKey]); }
  catch (e) { console.error(e); $('go').textContent = '오류: ' + e.message; return; }
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  started = true;
  if (isTouch) resume(); else showPause('준비 완료', '시작');
  requestAnimationFrame(loop);
};

async function boot(q) {
  Q = q;
  prog(0.03); await frame();
  T.generate();
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' });
  basePR = Math.min(devicePixelRatio, q.pr);
  renderer.setPixelRatio(basePR);
  renderer.setSize(innerWidth, innerHeight);
  if (!renderer.extensions.has('OES_texture_float_linear')) W.useHalfFloat();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.68, 0.80, 0.94), 0.0058);
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1500);
  scene.add(camera);
  sky = makeSky(); scene.add(sky);
  sun = new THREE.DirectionalLight(0xfff0dc, 3.3); sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 180 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4d4030, 0.35); scene.add(hemi);
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(makeSky());
  scene.environment = pm.fromScene(es, 0, 0.1, 1000).texture;
  const tm = T.terrainMaterial();
  const inner = T.buildMesh(tm); inner.layers.enable(1); scene.add(inner);
  const outer = T.buildOuter(tm); outer.castShadow = false; scene.add(outer);
  sun.layers.enable(1); hemi.layers.enable(1);

  prog(0.12); await frame();
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  if ('numSolverIterations' in world.integrationParameters) world.integrationParameters.numSolverIterations = 8;
  events = new RAPIER.EventQueue(true);
  T.buildPhysics(RAPIER, world);
  S.initPhysics(RAPIER, world);

  prog(0.2); await frame();
  const sg = new THREE.Group(); scene.add(sg); scene.add(S.outlineMesh());
  S.spawnAll(sg, q.stones);
  S.stones.forEach(st => st.mesh.layers.enable(1)); // 굴절 패스에는 지형·돌만 그린다
  prog(0.32); await frame();
  N.buildTrees(scene, q.pine, q.broad);
  N.buildGrass(scene, q.grass);
  N.buildFlowers(scene, q.flowers);
  N.buildStreams(scene);
  FX.init(scene, camera);

  const pr = renderer.getPixelRatio();
  refrRT = new THREE.WebGLRenderTarget(innerWidth * pr * q.refr, innerHeight * pr * q.refr, { type: THREE.HalfFloatType });
  refrRT.depthTexture = new THREE.DepthTexture(refrRT.width, refrRT.height);
  W.init(); T.setSolidRef(W.solid); S.rasterize(); W.prefill();
  water = W.makeWaterMesh(refrRT); scene.add(water);
  const WARM = 30 * 60;
  for (let s = 0; s < WARM; s++) {
    if (s % 2 === 0) { world.step(); S.sync(); S.rasterize(); }
    W.step(1 / 60); if (s % 4 === 0) W.post(4 / 60);
    if (s % 150 === 0) { prog(0.4 + 0.5 * s / WARM); await frame(); }
  }
  W.upload();
  PL.init(RAPIER, world, camera, scene, hooks, { x: T.centerX(12) - 2.6, y: T.groundAt(T.centerX(12) - 2.6, 12) + 1.1, z: 12 });

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: q.msaa }));
  composer.addPass(new RenderPass(scene, camera));
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.55, 0.95); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  fxaa = new ShaderPass(FXAAShader); fxaa.enabled = false; composer.addPass(fxaa);
  gradePass = new ShaderPass(GRADE); composer.addPass(gradePass);
  scene.traverse(o => { const m = o.material; if (m && m.isMeshStandardMaterial) m.envMapIntensity = 0.75; });
  let saved = null; try { saved = localStorage.getItem('valley.perf'); } catch {}
  setPerf(saved === null ? !!q.perf : saved === '1');
  prog(0.95); await frame();
  PL.update(1 / 60, 0);
  renderer.compile(scene, camera);
  prog(1);
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uRain: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uRain; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(vec3(l), c, 1.08 - uRain*0.25);
      c = (c - 0.5) * 1.04 + 0.5;
      vec2 d = vUv - 0.5; c *= 1. - dot(d,d)*0.55;
      gl_FragColor = vec4(c, 1.); }`,
};

addEventListener('resize', () => renderer && resize());
function resize() {
  const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio();
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  composer.setPixelRatio(pr); composer.setSize(w, h);
  const rs = perf ? 0.45 : Q.refr;
  refrRT.setSize(Math.max(1, Math.round(w * pr * rs)), Math.max(1, Math.round(h * pr * rs)));
  fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  water.material.uniforms.uRes.value.set(w * pr, h * pr);
  water.material.uniforms.uNear.value = camera.near; water.material.uniforms.uFar.value = camera.far;
  FX.setScale(h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
}

// ───── 자동 해상도: 30fps를 지키도록 렌더 해상도를 조절 ─────
const dyn = { scale: 1, avg: 33, t: 0, cool: 0, ceil: 1, lastUp: -99 };
function dynRes(interval, dt) {
  dyn.avg += (interval - dyn.avg) * 0.08; dyn.t += dt; dyn.cool -= dt;
  if (dyn.t < 1.2 || dyn.cool > 0) return;
  dyn.t = 0;
  let s = dyn.scale;
  if (dyn.avg > 50) s *= 0.75;
  else if (dyn.avg > 37.5) s *= 0.88;
  else if (dyn.avg < 34.5 && s < dyn.ceil) { s = Math.min(dyn.ceil, s * 1.07); dyn.lastUp = clock; }
  else return;
  if (s < dyn.scale && clock - dyn.lastUp < 3) dyn.ceil = Math.max(0.5, dyn.scale * 0.97); // 올렸다가 느려지면 그 위로는 안 올림
  s = Math.max(0.5, Math.min(1, s));
  if (Math.abs(s - dyn.scale) < 0.01) return;
  dyn.scale = s; dyn.cool = 1.5;
  renderer.setPixelRatio((perf ? perfPR() : basePR) * s);
  resize();
}

// ───── 최적화 모드 / 비 ─────
// 최적화 모드(고화질 유지): 내부 해상도↓ + FXAA, 굴절 저해상도, 풀 60%, 그림자 2048·격프레임 갱신
const perfPR = () => Math.min(devicePixelRatio, 1.25);
function setPerf(on) {
  perf = on; $('bPerf').classList.toggle('on', on); $('fps').classList.toggle('hidden', !on);
  renderer.setPixelRatio((on ? perfPR() : basePR) * dyn.scale);
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = on ? 0 : Q.msaa; rt.dispose(); }
  fxaa.enabled = on;
  N.setDensity(on ? 0.6 : 1);
  const ms = on ? Math.min(2048, Q.shadow) : Q.shadow;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  resize();
  try { localStorage.setItem('valley.perf', on ? '1' : '0'); } catch {}
}
function setRain(on) { rainOn = on; $('bRain').classList.toggle('on', on); }

// ───── 포인터 잠금 / 일시정지 ─────
function showPause(title, btn) { paused = true; $('pauseT').textContent = title; $('resume').textContent = btn; $('pause').classList.remove('hidden'); }
function resume() { paused = false; $('pause').classList.add('hidden'); if (!isTouch) PL.lock($('gl')); }
document.addEventListener('pointerlockchange', () => {
  if (!started || isTouch) return;
  if (!document.pointerLockElement && !paused) showPause('일시정지', '계속');
});
$('resume').onclick = resume;
$('pause').onclick = e => { if (e.target === $('pause')) resume(); };
$('restart').onclick = () => location.reload();
$('gl').addEventListener('click', () => { if (started && !isTouch && !document.pointerLockElement) resume(); });
$('bPause').onclick = () => { if (isTouch) showPause('일시정지', '계속'); else document.exitPointerLock(); };
$('bPerf').onclick = () => setPerf(!perf);
$('bRain').onclick = () => setRain(!rainOn);
document.querySelectorAll('#bar [data-t]').forEach(b => b.onclick = () => PL.setTool(b.dataset.t));
addEventListener('keydown', e => {
  if (!started || e.repeat) return;
  if (e.code === 'Digit3') setRain(!rainOn);
  if (e.code === 'Digit4') setPerf(!perf);
});

// ───── 게임 훅 ─────
let toastT = 0, lastToast = '';
const hooks = {
  toast(t) { if (t === lastToast && toastT > 0.6) return; lastToast = t; const el = $('toast'); el.textContent = t; el.classList.add('show'); toastT = 1.8; },
  ui: {
    tool(t) {
      document.querySelectorAll('#bar [data-t]').forEach(e => e.classList.toggle('on', e.dataset.t === t));
      $('tPrim').innerHTML = `<svg><use href="#i-${t === 'hand' ? 'hand' : 'shovel'}"/></svg>`;
    },
    prompt(t, on) { const el = $('tag'); if (el.textContent !== t) el.textContent = t; $('cross').classList.toggle('on', on); },
  },
  audio: A, fx: FX,
  edit(x, z, r) { N.onEdit(x, z, r); edits.push([x, z]); lastEdit = clock; },
};
let edits = [], lastEdit = -10, clock = 0, ready = false;

let uiT = 0;
function ui(dt) {
  toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show');
  uiT -= dt; if (uiT > 0) return; uiT = 0.2;
  const st = W.state;
  if (!ready && st.time > 55) { ready = true; W.saveBaseline(); }
  const blocked = Math.max(0, Math.min(1, 1 - st.outSm / st.inflow));
  $('mPct').textContent = ready ? Math.round(blocked * 100) + '%' : '—';
  $('mFill').style.width = (ready ? blocked * 100 : 0).toFixed(1) + '%';
  $('mSub').textContent = ready ? `저수 ${st.stored.toFixed(1)} m³ · 하류 ${Math.max(0, st.outSm * 1000).toFixed(0)} L/s` : '물길이 흐르는 중';
  $('mud').style.width = Math.min(100, PL.P.bucket / 0.3 * 100) + '%';
  if (perf) $('fps').textContent = fpsV.toFixed(0) + ' fps';
}

// ───── 루프 ─────
let flushT = 0, last = performance.now(), physAcc = 0, waterAcc = 0, fpsV = 60, fpsN = 0, fpsT = 0, frameN = 0;
const camDir = new THREE.Vector3();
const FRAME_MS = 1000 / 30;
function loop(now) {
  requestAnimationFrame(loop);
  if (now - last < FRAME_MS - 4) return; // 30fps 고정
  const raw = (now - last) / 1000; const dt = Math.min(0.07, raw); last = now;
  if (!paused) dynRes(raw * 1000, dt);
  fpsN++; fpsT += raw; if (fpsT > 0.5) { fpsV = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (paused) { render(); return; }
  clock += dt; T.U.uTime.value = clock;
  PL.update(dt, clock);
  physAcc += dt; let n = 0;
  while (physAcc >= 1 / 60 && n < 4) {
    PL.prePhysics(1 / 60);
    S.waterForces(onSplash);
    for (const st of S.stones) if (!st.fixed && !st.body.isSleeping()) st.vyPrev = st.body.linvel().y; // 충돌 직전 낙하 속도
    world.step(events);
    events.drainContactForceEvents(onContact);
    physAcc -= 1 / 60; n++;
  }
  if (n === 4) physAcc = 0;
  S.sync(); S.rasterize();
  waterAcc += Math.min(dt, 1 / 15); let m = 0;
  const maxSteps = perf ? 2 : 3;
  while (waterAcc >= 1 / 60 && m < maxSteps) { W.step(1 / 60); waterAcc -= 1 / 60; m++; }
  if (m === maxSteps) waterAcc = Math.min(waterAcc, 1 / 60);
  W.post(dt);
  flushT += dt;
  if (clock - lastEdit < 0.3 || flushT > 0.25) { T.flushMesh(); flushT = 0; }
  if (T.physState.dirty) {
    T.physState.t += dt;
    if ((T.physState.t > 0.3 && clock - lastEdit > 0.2) || T.physState.t > 1.5) rebuildHF();
  }
  W.upload();
  // 비: 계곡물이 불어남
  const st = W.state, rt = rainOn ? 1 : 0;
  st.inflow += ((rainOn ? 0.42 : 0.2) - st.inflow) * Math.min(1, dt * 0.08);
  T.U.uRain.value += (rt - T.U.uRain.value) * Math.min(1, dt * 0.15);
  FX.update(dt, T.U.uRain.value);
  N.setDownstream(Math.max(0, st.outSm / 0.2));
  audioUpdate();
  ui(dt);
  render();
}
function rebuildHF() {
  T.buildPhysics(RAPIER, world);
  for (const st of S.stones) {
    if (st.fixed) continue;
    for (const [x, z] of edits) if ((st.cx - x) ** 2 + (st.cz - z) ** 2 < (st.rb + 0.9) ** 2) { st.body.wakeUp(); break; }
  }
  edits = [];
}
function onSplash(st, speed, surf) {
  const s = Math.min(1, speed / 5 * Math.sqrt(Math.min(st.mass, 120) / 30));
  FX.splash(st.cx, surf, st.cz, s);
  const d = camera.position.distanceTo(st.mesh.position);
  A.splash(s / (1 + d * d * 0.02));
}
function onContact(e) {
  const c1 = e.collider1(), c2 = e.collider2();
  const st = S.byHandle.get(c1) || S.byHandle.get(c2);
  if (!st || st.fixed || clock - st.lastHit < 0.12) return;
  st.lastHit = clock;
  const other = st.collider.handle === c1 ? c2 : c1, hf = T.getHF();
  if (hf && other === hf.handle && (st.vyPrev || 0) < -1.8 && !st.held) dent(st, -st.vyPrev);
  const f = e.totalForceMagnitude() / (st.mass * 9.81);
  let s = Math.min(1, Math.max(0.08, (f - 6) / 40)) * Math.min(1, Math.max(0.3, st.mass / 40));
  const d = camera.position.distanceTo(st.mesh.position);
  s /= 1 + d * d * 0.03;
  if (s > 0.02) A.impact(s, st.surf > st.cy);
}
// 돌이 땅에 떨어지면 흙이 패인 자국이 남는다
function dent(st, v) {
  const Rh = Math.max(st.ext[0], st.ext[2]) * 0.8;
  const depth = Math.min(0.16, 0.0015 * v * v * Math.cbrt(st.mass / 20));
  if (depth < 0.006) return;
  const moved = T.impact(st.cx, st.cz, Rh, depth, W);
  st.vyPrev = 0;
  if (moved < 1e-4) return;
  N.onEdit(st.cx, st.cz, Rh * 1.6); edits.push([st.cx, st.cz]); S.touch();
  const n = Math.min(24, 4 + Math.round(moved * 900));
  const ws = W.sample(st.cx, st.cz);
  if (ws && ws.h > 0.02) FX.splash(st.cx, ws.surf, st.cz, Math.min(1, v / 6)); else FX.dirt(st.cx, st.cy - st.hy, st.cz, n);
}
function audioUpdate() {
  const c = camera.position; let flow = 0, turb = 0;
  for (let dz = -4; dz <= 4; dz += 2) for (let dx = -4; dx <= 4; dx += 2) {
    const s = W.sample(c.x + dx, c.z + dz); if (!s || s.open < 0.01) continue;
    const sp = Math.hypot(s.vx, s.vz), w = 1 / (1 + (dx * dx + dz * dz) * 0.15);
    flow += s.open * sp * w; turb += W.foam[s.k] * w;
  }
  const fd = Math.hypot(c.x - T.centerX(4.4), c.z - 4.4, c.y - T.groundAt(T.centerX(4.4), 4.4));
  A.update({ flow: flow * 1.6, turb: turb * 0.5, fallDist: fd, rain: T.U.uRain.value });
}
function render() {
  frameN++;
  camera.getWorldDirection(camDir);
  const tx = camera.position.x + camDir.x * 10, tz = camera.position.z + camDir.z * 10;
  const snap = 60 / sun.shadow.mapSize.x, sx = Math.round(tx / snap) * snap, sz = Math.round(tz / snap) * snap;
  sun.target.position.set(sx, T.groundAt(sx, sz), sz);
  sun.position.copy(sun.target.position).addScaledVector(T.U.uSunDir.value, 90);
  sun.target.updateMatrixWorld();
  const rain = T.U.uRain.value;
  sun.intensity = 3.3 * (1 - rain * 0.75); hemi.intensity = 0.35 + rain * 0.25;
  scene.fog.density = 0.0058 + rain * 0.012; gradePass.uniforms.uRain.value = rain;
  sky.position.copy(camera.position);
  renderer.shadowMap.needsUpdate = !perf || frameN % 2 === 0;
  if (!perf) {
    camera.layers.set(1);
    renderer.setRenderTarget(refrRT); renderer.render(scene, camera);
    camera.layers.set(0);
    renderer.setRenderTarget(null);
  }
  composer.render();
}

// ───── 터치 ─────
if (isTouch) {
  const joy = $('joy'), knob = $('knob'); let jid = null, lid = null, lx = 0, ly = 0;
  joy.addEventListener('touchstart', e => { jid = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === jid) {
        const r = joy.getBoundingClientRect(), dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2), l = Math.min(1, Math.hypot(dx, dy) / 52), a = Math.atan2(dy, dx);
        PL.touch.move.x = Math.cos(a) * l; PL.touch.move.y = -Math.sin(a) * l;
        knob.style.transform = `translate(${Math.cos(a) * l * 42}px, ${Math.sin(a) * l * 42}px)`;
      } else if (t.identifier === lid) { PL.look((t.clientX - lx) * 0.005, (t.clientY - ly) * 0.005); lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: false });
  $('gl').addEventListener('touchstart', e => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; }, { passive: true });
  addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === jid) { jid = null; PL.touch.move.x = PL.touch.move.y = 0; knob.style.transform = ''; }
      if (t.identifier === lid) lid = null;
    }
  });
  const hold = (id, down, up) => { const b = $(id); b.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false }); b.addEventListener('touchend', e => { e.preventDefault(); up && up(); }); };
  hold('tPrim', () => { PL.touch.btn.l = true; PL.touch.primary(); }, () => { PL.touch.btn.l = false; });
  hold('tSec', () => { PL.touch.btn.r = true; PL.touch.secondary(); }, () => { PL.touch.btn.r = false; });
  hold('tRot', () => PL.touch.rotate());
  hold('tJump', () => PL.touch.jump());
}
