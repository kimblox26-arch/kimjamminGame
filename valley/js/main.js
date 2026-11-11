// 계곡 물막이 — 메인 루프
import * as THREE from 'three';
import RAPIER from 'rapier';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as T from './terrain.js';
import * as W from './water.js';
import * as S from './stones.js';
import * as PL from './player.js';
import * as FX from './fx.js';
import * as N from './nature.js';
import * as A from './audio.js';
import { makeSky } from './sky.js';

const QUAL = {
  ultra: { pr: 2, shadow: 4096, refr: 1, grass: 16000, flowers: 700, pine: 1300, broad: 450, bloom: true, stones: 170 },
  high: { pr: 1.5, shadow: 2048, refr: 0.6, grass: 9000, flowers: 450, pine: 800, broad: 280, bloom: true, stones: 150 },
  low: { pr: 1, shadow: 1024, refr: 0.5, grass: 3000, flowers: 200, pine: 350, broad: 120, bloom: false, stones: 120 },
};
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const qSel = $('quality');
try { qSel.value = params.get('q') || localStorage.getItem('valley.q') || 'ultra'; } catch { qSel.value = 'ultra'; }
const isTouch = matchMedia('(pointer: coarse)').matches;
if (params.has('debug')) window.__dbg = { T, W, S, PL, get G() { return G; }, get cam() { return camera; }, get paused() { return paused; }, run() { paused = false; document.getElementById('pause').classList.add('hidden'); } };

let gradePass, renderer, scene, camera, composer, refrRT, water, sky, sun, hemi, world, events, Q, started = false, paused = false;
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const msg = t => { $('loadmsg').textContent = t; };

$('go').onclick = async () => {
  $('go').disabled = true; qSel.disabled = true;
  try { localStorage.setItem('valley.q', qSel.value); } catch {}
  A.init();
  try { await boot(QUAL[qSel.value] || QUAL.ultra); }
  catch (e) { console.error(e); msg('오류: ' + e.message); $('go').disabled = false; return; }
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  started = true;
  if (isTouch) resume(); else { paused = true; $('pauseT').textContent = '준비 완료!'; $('pauseP').textContent = '화면을 클릭하면 시작합니다.'; $('resume').textContent = '시작하기'; $('pause').classList.remove('hidden'); }
  requestAnimationFrame(loop);
};

async function boot(q) {
  Q = q;
  msg('지형을 만드는 중…'); await frame();
  T.generate();

  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr));
  renderer.setSize(innerWidth, innerHeight);
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
  // 환경맵 (하늘)
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(makeSky());
  scene.environment = pm.fromScene(es, 0, 0.1, 1000).texture;

  const tm = T.terrainMaterial();
  scene.add(T.buildMesh(tm)); scene.add(T.buildOuter(tm));

  msg('물리 엔진을 준비하는 중…'); await frame();
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  if ('numSolverIterations' in world.integrationParameters) world.integrationParameters.numSolverIterations = 8;
  events = new RAPIER.EventQueue(true);
  T.buildPhysics(RAPIER, world);
  S.initPhysics(RAPIER, world);

  msg('돌을 흩어 놓는 중…'); await frame();
  const sg = new THREE.Group(); scene.add(sg); scene.add(S.outlineMesh());
  S.spawnAll(sg, q.stones);

  msg('숲과 풀을 심는 중…'); await frame();
  N.buildTrees(scene, q.pine, q.broad);
  N.buildGrass(scene, q.grass);
  N.buildFlowers(scene, q.flowers);
  N.buildStreams(scene);
  FX.init(scene, camera);

  // 물
  const pr = renderer.getPixelRatio();
  refrRT = new THREE.WebGLRenderTarget(innerWidth * pr * q.refr, innerHeight * pr * q.refr, { type: THREE.HalfFloatType });
  refrRT.depthTexture = new THREE.DepthTexture(refrRT.width, refrRT.height);
  W.init(); T.setSolidRef(W.solid); S.rasterize(); W.prefill();
  water = W.makeWaterMesh(refrRT); scene.add(water);
  const WARM = 30 * 60;
  for (let s = 0; s < WARM; s++) {
    if (s % 2 === 0) { world.step(); S.sync(); S.rasterize(); }
    W.step(1 / 60); if (s % 4 === 0) W.post(4 / 60);
    if (s % 150 === 0) { msg(`계곡물이 흘러오는 중… ${Math.round(s / WARM * 100)}%`); await frame(); }
  }
  W.upload();

  PL.init(RAPIER, world, camera, scene, hooks, { x: T.centerX(12) - 2.6, y: T.groundAt(T.centerX(12) - 2.6, 12) + 1.1, z: 12 });

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: q.pr > 1 ? 4 : 2 }));
  composer.addPass(new RenderPass(scene, camera));
  if (q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.55, 0.95));
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GRADE); composer.addPass(gradePass);
  resize();
  scene.traverse(o => { const m = o.material; if (m && m.isMeshStandardMaterial) m.envMapIntensity = 0.75; });

  msg('셰이더를 준비하는 중…'); await frame();
  PL.update(1 / 60, 0);
  renderer.compile(scene, camera);
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uRain: T.U.uRain },
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
  composer.setSize(w, h);
  refrRT.setSize(Math.round(w * pr * Q.refr), Math.round(h * pr * Q.refr));
  water.material.uniforms.uRes.value.set(w * pr, h * pr);
  water.material.uniforms.uNear.value = camera.near; water.material.uniforms.uFar.value = camera.far;
  FX.setScale(h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
}

// ───── 포인터 잠금 / 일시정지 ─────
function resume() {
  paused = false; $('pause').classList.add('hidden');
  if (!isTouch) PL.lock($('gl'));
}
document.addEventListener('pointerlockchange', () => {
  if (!started || isTouch) return;
  if (!document.pointerLockElement) { paused = true; $('pauseT').textContent = '일시정지'; $('pauseP').textContent = '화면을 클릭하면 계속합니다.'; $('resume').textContent = '계속하기'; $('pause').classList.remove('hidden'); }
});
$('resume').onclick = resume;
$('pause').onclick = e => { if (e.target === $('pause')) resume(); };
$('restart').onclick = () => location.reload();
$('gl').addEventListener('click', () => { if (started && !isTouch && !document.pointerLockElement) resume(); });

// ───── 게임 훅 ─────
let toastT = 0, lastToast = '';
const hooks = {
  toast(t) { if (t === lastToast && toastT > 0.5) return; lastToast = t; const el = $('toast'); el.textContent = t; el.classList.add('show'); toastT = 2.2; },
  ui: {
    tool(t) { document.querySelectorAll('.tool').forEach(e => e.classList.toggle('on', e.dataset.t === t)); $('tTool').textContent = t === 'hand' ? '삽' : '손'; $('tPrim').textContent = t === 'hand' ? '줍기' : '파기'; $('tSec').textContent = t === 'hand' ? '던지기' : '붓기'; },
    prompt(t, on) { const el = $('prompt'); if (el.textContent !== t) el.textContent = isTouch ? '' : t; $('cross').classList.toggle('on', on); },
  },
  audio: A, fx: FX,
  edit(x, z, r) { N.onEdit(x, z, r); edits.push([x, z]); lastEdit = clock; },
};
let edits = [], lastEdit = -10, clock = 0;

// ───── 목표 ─────
const STAGES = [
  { name: '1단계', text: '돌을 주워 물길의 절반을 막아보세요', need: 0.5, hold: 8 },
  { name: '2단계', text: '물길을 80% 이상 막아보세요', need: 0.8, hold: 12 },
  { name: '3단계', text: '돌 틈을 흙으로 메워 95% 이상 막기', need: 0.95, hold: 15 },
  { name: '장마', text: '폭우! 불어난 계곡물을 90% 이상 막아내세요', need: 0.9, hold: 25, rain: true },
  { name: '자유 놀이', text: '완벽해요! 이제 마음껏 계곡을 꾸며보세요', need: 2 },
];
const G = { stage: 0, hold: 0, ready: false, rainT: 0, inflowT: 0.2 };

function goals(dt) {
  const st = W.state;
  if (!G.ready && st.time > 55) { G.ready = true; W.saveBaseline(); hooks.toast('물길이 자리 잡았어요 — 이제 막아볼까요?'); }
  const blocked = Math.max(0, Math.min(1, 1 - st.outSm / st.inflow));
  const s = STAGES[G.stage];
  if (G.ready && s.need <= 1) {
    if (blocked >= s.need) G.hold += dt; else G.hold = Math.max(0, G.hold - dt * 1.5);
    if (G.hold >= s.hold) {
      G.hold = 0; G.stage++; A.chime();
      hooks.toast(G.stage === 3 ? '🎉 성공! …그런데 먹구름이 몰려와요' : G.stage === 4 ? '🌈 장마를 이겨냈어요! 최고의 둑입니다' : `🎉 ${s.name} 성공!`);
      if (STAGES[G.stage].rain) { G.rainT = 1; G.inflowT = 0.42; }
      else if (G.stage === 4) { G.rainT = 0; G.inflowT = 0.2; }
    }
  }
  st.inflow += (G.inflowT - st.inflow) * Math.min(1, dt * 0.08);
  const r = T.U.uRain.value; T.U.uRain.value = r + (G.rainT - r) * Math.min(1, dt * 0.12);
  return blocked;
}

let uiT = 0;
function ui(dt, blocked) {
  toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show');
  uiT -= dt; if (uiT > 0) return; uiT = 0.15;
  const s = STAGES[G.stage], st = W.state;
  $('gStage').textContent = G.ready ? s.name : '준비 중';
  $('gText').textContent = G.ready ? s.text : `계곡물이 자리 잡는 중… ${Math.max(0, Math.ceil(55 - st.time))}초 (먼저 돌을 모아두세요)`;
  $('gBlock').style.width = (blocked * 100).toFixed(1) + '%';
  $('gPct').textContent = G.ready ? `막은 비율 ${(blocked * 100).toFixed(0)}%` + (s.need <= 1 ? ` / 목표 ${(s.need * 100) | 0}%` : '') : '—';
  $('gHold').style.width = s.hold ? Math.min(100, G.hold / s.hold * 100) + '%' : '0';
  $('sIn').textContent = (st.inflow * 1000).toFixed(0);
  $('sOut').textContent = Math.max(0, st.outSm * 1000).toFixed(0);
  $('sVol').textContent = st.stored.toFixed(1);
  $('sDep').textContent = (st.maxDepth * 100).toFixed(0);
  $('sStones').textContent = S.stones.filter(x => x.moved).length;
  $('sEro').textContent = (st.eroded * 1000).toFixed(0);
  $('bucket').style.width = Math.min(100, PL.P.bucket / 0.3 * 100) + '%';
  $('fps').textContent = fpsV.toFixed(0) + ' fps';
}

// ───── 루프 ─────
let last = performance.now(), physAcc = 0, waterAcc = 0, fpsV = 60, fpsN = 0, fpsT = 0;
const camDir = new THREE.Vector3();
function loop(now) {
  requestAnimationFrame(loop);
  const raw = (now - last) / 1000; let dt = Math.min(0.05, raw); last = now;
  fpsN++; fpsT += raw; if (fpsT > 0.5) { fpsV = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (paused) { render(); return; }
  clock += dt; T.U.uTime.value = clock;

  PL.update(dt, clock);
  physAcc += dt; let n = 0;
  while (physAcc >= 1 / 60 && n < 3) {
    PL.prePhysics(1 / 60);
    S.waterForces(onSplash);
    world.step(events);
    events.drainContactForceEvents(onContact);
    physAcc -= 1 / 60; n++;
  }
  if (n === 3) physAcc = 0;
  S.sync(); S.rasterize();
  waterAcc += Math.min(dt, 1 / 30); let m = 0;
  while (waterAcc >= 1 / 120 && m < 4) { W.step(1 / 120); waterAcc -= 1 / 120; m++; }
  W.post(dt);
  T.flushMesh();
  if (T.physState.dirty) {
    T.physState.t += dt;
    if ((T.physState.t > 0.3 && clock - lastEdit > 0.2) || T.physState.t > 1.5) rebuildHF();
  }
  W.upload();
  FX.update(dt, T.U.uRain.value);
  N.setDownstream(Math.max(0, W.state.outSm / 0.2));
  const blocked = goals(dt);
  audioUpdate();
  ui(dt, blocked);
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
  const st = S.byHandle.get(e.collider1()) || S.byHandle.get(e.collider2());
  if (!st || st.fixed || clock - st.lastHit < 0.12) return;
  st.lastHit = clock;
  const f = e.totalForceMagnitude() / (st.mass * 9.81);
  let s = Math.min(1, Math.max(0.08, (f - 6) / 40)) * Math.min(1, Math.max(0.3, st.mass / 40));
  const d = camera.position.distanceTo(st.mesh.position);
  s /= 1 + d * d * 0.03;
  if (s > 0.02) A.impact(s, st.surf > st.cy);
}
function audioUpdate() {
  const c = camera.position; let flow = 0, turb = 0;
  for (let dz = -4; dz <= 4; dz += 2) for (let dx = -4; dx <= 4; dx += 2) {
    const s = W.sample(c.x + dx, c.z + dz); if (!s || s.h < 0.01) continue;
    const sp = Math.hypot(s.vx, s.vz), w = 1 / (1 + (dx * dx + dz * dz) * 0.15);
    flow += s.h * sp * w; turb += W.foam[s.k] * w;
  }
  const fd = Math.hypot(c.x - T.centerX(4.4), c.z - 4.4, c.y - T.groundAt(T.centerX(4.4), 4.4));
  A.update({ flow: flow * 1.6, turb: turb * 0.5, fallDist: fd, rain: T.U.uRain.value });
}
function render() {
  // 그림자 카메라를 플레이어 주변에 맞추기
  camera.getWorldDirection(camDir);
  const tx = camera.position.x + camDir.x * 10, tz = camera.position.z + camDir.z * 10;
  const snap = 60 / Q.shadow, sx = Math.round(tx / snap) * snap, sz = Math.round(tz / snap) * snap;
  sun.target.position.set(sx, T.groundAt(sx, sz), sz);
  sun.position.copy(sun.target.position).addScaledVector(T.U.uSunDir.value, 90);
  sun.target.updateMatrixWorld();
  const rain = T.U.uRain.value;
  sun.intensity = 3.3 * (1 - rain * 0.75); hemi.intensity = 0.35 + rain * 0.25;
  scene.fog.density = 0.0058 + rain * 0.012; gradePass.uniforms.uRain.value = rain;
  sky.position.copy(camera.position);
  renderer.shadowMap.needsUpdate = true;
  water.visible = false;
  renderer.setRenderTarget(refrRT); renderer.render(scene, camera);
  water.visible = true;
  renderer.setRenderTarget(null);
  composer.render();
}

// ───── 터치 ─────
if (isTouch) {
  const joy = $('joy'), knob = $('knob'); let jid = null, lid = null, lx = 0, ly = 0;
  joy.addEventListener('touchstart', e => { jid = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === jid) {
        const r = joy.getBoundingClientRect(), dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2), l = Math.min(1, Math.hypot(dx, dy) / 55), a = Math.atan2(dy, dx);
        PL.touch.move.x = Math.cos(a) * l; PL.touch.move.y = -Math.sin(a) * l;
        knob.style.transform = `translate(${Math.cos(a) * l * 45}px, ${Math.sin(a) * l * 45}px)`;
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
  hold('tTool', () => PL.toggleTool());
  hold('tRot', () => PL.touch.rotate());
  hold('tJump', () => PL.touch.jump());
}
