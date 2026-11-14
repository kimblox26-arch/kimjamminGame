// 계곡 — 메인 루프
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
import * as D from './dam.js';
import * as H from './hydro.js';
import * as V from './village.js';
import { makeSky } from './sky.js';

const QUAL = {
  ultra: { pr: 2, shadow: 4096, refr: 1, grass: 13000, flowers: 600, pine: 520, broad: 180, bloom: true, stones: 160, boulders: 20, msaa: 4, view: 40 },
  high: { pr: 1.6, shadow: 2048, refr: 0.85, grass: 9500, flowers: 450, pine: 400, broad: 140, bloom: true, stones: 140, boulders: 18, msaa: 4, view: 34 },
  perf: { pr: 1, shadow: 1536, refr: 0.75, grass: 6500, flowers: 300, pine: 280, broad: 100, bloom: true, stones: 120, boulders: 15, msaa: 2, view: 26, perf: true, lowPoly: true },
};
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (/ValleyDamApp/.test(navigator.userAgent)) $('apk').remove(); // 앱 안에서는 다운로드 링크 숨김
let qKey = params.get('q');
try { qKey = qKey || localStorage.getItem('valley.q'); } catch {}
if (isTouch) Object.assign(QUAL.perf, { grass: 5000, flowers: 220, pine: 220, broad: 80, stones: 100, boulders: 12, view: 22 });
if (!QUAL[qKey]) qKey = isTouch ? 'perf' : 'ultra';
const segBtns = [...document.querySelectorAll('#quality button')];
const pickQ = k => { qKey = k; segBtns.forEach(b => { b.classList.toggle('on', b.dataset.q === k); b.setAttribute('aria-checked', b.dataset.q === k); }); };
segBtns.forEach(b => b.onclick = () => pickQ(b.dataset.q)); pickQ(qKey);
// 시작 화면 시차(패럴랙스): 마우스/손가락 위치에 따라 산·댐·강이 서로 다른 깊이로 움직인다
const lays = [...document.querySelectorAll('#start .lay')];
const parallax = (px, py) => { for (const l of lays) { const d = +l.dataset.d; l.style.transform = `translate(${(-px * d).toFixed(1)}px, ${(-py * d * 0.5).toFixed(1)}px)`; } };
addEventListener('pointermove', e => { if (!started) parallax(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5); });

let stoneGroup, innerMesh, tmat, fxaa, renderer, scene, camera, composer, refrRT, water, sky, sun, hemi, world, events, Q, bloom, gradePass, basePR;
let started = false, paused = false, perf = false, rainOn = false;
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const prog = (v, t) => { $('progbar').style.width = Math.round(v * 100) + '%'; if (t) $('progtxt').textContent = t; };
if (params.has('debug')) window.__dbg = { T, W, S, PL, D, V, H, N, get scene() { return scene; }, get sky() { return sky_; }, get elec() { return elec; }, get cam() { return camera; }, get paused() { return paused; }, run() { paused = false; $('pause').classList.add('hidden'); },
  capFrame(fps = 30) { if (!capNow) capNow = last; capNow += 1000 / fps; loop(capNow); }, setCam(f) { camRig = f; }, setTimeScale: n => setTimeScale(n), get dayFrozen() { return dayFrozen; }, get hooks() { return hooks; }, setPerf: v => setPerf(v), setRain: v => setRain(v) };

// ───── 저장 / 불러오기 (브라우저 저장소) ─────
// 장소별 저장 칸
let mapKey = params.get('map');
try { mapKey = mapKey || localStorage.getItem('valley.map'); } catch {}
if (mapKey !== 'sea') mapKey = 'valley';
const saveKey = () => mapKey === 'sea' ? 'valley.save.sea.v1' : 'valley.save.v2'; // v2: 넓어진 계곡
const SEA = () => T.MODE === 'sea';
const encWater = a => { const n = T.SW * T.NZV, u = new Uint16Array(n); for (let j = 0; j < T.NZV; j++) for (let c = 0; c < T.SW; c++) u[j * T.SW + c] = Math.min(65535, Math.round(a[j * T.NXV + T.SX0 + c] * 10000)); let b = ''; const by = new Uint8Array(u.buffer); for (let i = 0; i < by.length; i += 8192) b += String.fromCharCode(...by.subarray(i, i + 8192)); return btoa(b); };
function decWater(str, a) { if (!str) return; const bin = atob(str), by = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i); const u = new Uint16Array(by.buffer); for (let j = 0; j < T.NZV; j++) for (let c = 0; c < T.SW; c++) a[j * T.NXV + T.SX0 + c] = u[j * T.SW + c] / 10000; }
let lastSave = 0;
function saveGame(quiet) {
  if (!started || D.building() || H.building()) return false;
  const c = camera.position;
  const data = { v: 1, sw: T.SW, at: Date.now(), t: T.snapshot(), st: S.serialize(), dm: D.serialize(), w: encWater(W.h), w0: encWater(W.h0),
    hp: H.serialize(), tod: sky_.tod, batt: elec.batt, rain: rainOn, inflow: W.state.inflow, out: W.state.outSm, p: [c.x, c.z, PL.P.yaw, PL.P.pitch] };
  try { localStorage.setItem(saveKey(), JSON.stringify(data)); lastSave = clock; if (!quiet) hooks.toast('저장했어요'); updateSaveInfo(); return true; }
  catch (e) { if (!quiet) hooks.toast('저장 공간이 부족해요'); return false; }
}
function loadSave() { try { const s = localStorage.getItem(saveKey()); return s ? JSON.parse(s) : null; } catch { return null; } }
// 제어실 화면 갱신
const f1 = (v, n = 1) => (+v).toFixed(n);
function ctrlUpdate() {
  const p = H.plant, bed = T.groundAt(p.cx, p.zc), Sp = H.SPEC;
  $('cStats').innerHTML = [
    ['저수위', f1(p.level - bed, 2) + ' m'], ['하류 수위', f1(p.tail - bed, 2) + ' m'], ['유효 낙차', f1(p.head, 2) + ' m'],
    ['계곡 유입', f1(W.state.inflow, 2) + ' m³/s'], ['총 발전', f1(p.P / 1000, 2) + ' kW'], ['모터 소비', f1(elec.motor || 0, 1) + ' kW'],
    ['배터리', Math.round(elec.batt / elec.cap * 100) + '%' + (elec.diesel && (elec.motor || 0) > 0 ? ' · 비상 디젤' : '')], ['여수로 방류', f1(p.spillQ, 2) + ' m³/s'],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  p.units.forEach((u, i) => {
    const box = $('cU' + i);
    box.querySelector('.st').textContent = u.state; box.querySelector('.st').dataset.s = u.sync ? 'on' : u.rpm > 20 ? 'mid' : 'off';
    box.querySelector('.vals').innerHTML = `<span>가이드베인 ${Math.round(u.gate * 100)}%</span><span>${Math.round(u.rpm)} / ${Sp.sync} rpm</span><span>유량 ${f1(u.Q, 3)} m³/s</span><span>낙차 ${f1(Math.max(0, u.H ?? 0), 2)} m</span><span>효율 ${Math.round(u.eta * 100)}%</span><span>출력 ${f1(u.P / 1000, 2)} kW</span>`;
    const sl = $('u' + i); if (document.activeElement !== sl) sl.value = Math.round(u.target * 100);
  });
  p.gates.forEach((g, i) => {
    const box = $('cG' + i);
    box.querySelector('.st').textContent = g.moving ? (g.target > g.open ? '모터 올리는 중' : '모터 내리는 중') : g.stalled ? '전기 부족 — 정지' : g.open > 0.01 ? '열림' : '닫힘';
    box.querySelector('.st').dataset.s = g.moving ? 'mid' : g.stalled ? 'off' : g.open > 0.01 ? 'on' : 'off';
    box.querySelector('.vals').innerHTML = `<span>실제 개도 ${Math.round(g.open * 100)}% (${f1(g.open * (Sp.sillDrop), 2)} m)</span><span>방류 ${f1(g.Q, 3)} m³/s</span><span>권양기 ${Sp.hoistKW} kW · ${Sp.gateRate * 100}%/s</span>`;
    const sl = $('g' + i); if (document.activeElement !== sl) sl.value = Math.round(g.target * 100);
  });
}
function updateSaveInfo() {
  const sv = loadSave(), el = $('saveInfo'); if (!el) return;
  el.textContent = sv ? `마지막 저장 ${new Date(sv.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '저장된 기록 없음';
}
// 메인화면 영상: 재생되면 그림 배경 대신 보여 주고, 게임을 시작하면 멈춰 메모리를 비운다
const sVid = $('startVid');
if (sVid) { const vOn = () => $('start').classList.add('vid'); sVid.addEventListener('playing', vOn); sVid.addEventListener('timeupdate', vOn, { once: true }); if (!sVid.paused && sVid.currentTime > 0) vOn(); sVid.play?.().catch(() => {}); }
function refreshCont() { const sv = loadSave(); $('cont').classList.toggle('hidden', !sv); if (sv) $('cont').title = new Date(sv.at).toLocaleString('ko-KR'); }
const mapBtns = [...document.querySelectorAll('#mapSel button')];
const pickMap = k => { mapKey = k; mapBtns.forEach(b => { b.classList.toggle('on', b.dataset.m === k); b.setAttribute('aria-checked', b.dataset.m === k); }); $('start').dataset.map = k; refreshCont(); };
mapBtns.forEach(b => b.onclick = () => pickMap(b.dataset.m)); pickMap(mapKey);
addEventListener('visibilitychange', () => { if (document.hidden) saveGame(true); });
$('cont').onclick = () => start(loadSave());
$('go').onclick = () => start(null);
async function start(save) {
  $('go').disabled = true; $('cont').disabled = true; segBtns.forEach(b => b.disabled = true); mapBtns.forEach(b => b.disabled = true);
  T.setMode(mapKey); try { localStorage.setItem('valley.map', mapKey); } catch {}
  if (SEA()) { document.body.classList.add('sea'); document.querySelector('#meter .mtop span').textContent = '물때'; } (save ? $('cont') : $('go')).textContent = '불러오는 중';
  document.querySelector('.load').classList.add('on');
  try { localStorage.setItem('valley.q', qKey); } catch {}
  A.init();
  try { await boot(QUAL[qKey], save); }
  catch (e) { console.error(e); $('go').textContent = '오류: ' + e.message; return; }
  $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (sVid) { sVid.pause(); sVid.removeAttribute('autoplay'); sVid.querySelector('source')?.remove(); sVid.load(); }
  if (isTouch) $('touch').classList.remove('hidden');
  started = true;
  if (CAPTURE) document.body.classList.add('capture');
  if (isTouch) resume(); else showPause('준비 완료', '시작');
  requestAnimationFrame(loop);
};

async function boot(q, save) {
  Q = q;
  prog(0.03, '지형 만드는 중'); await frame();
  T.generate();
  const keepOut = V.prepare(); // 집터 다지기 (돌이 박히지 않게 자리 비움)
  T.noTree.push(...keepOut, ...(SEA() ? [[-4.5, 36.5, 2.5]] : [[T.centerX(7.5) - 1.8, 7.5, 2]])); // 시작 자리 · 물길 파기 좋은 사주 목
  T.remember();
  if (save) T.restore(save.t);
  // 기본 화면 MSAA: 폰(타일 GPU)에서는 거의 공짜라 최적화 모드도 매끈하게
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
  basePR = Math.min(devicePixelRatio, q.pr);
  renderer.setPixelRatio(basePR);
  renderer.setSize(innerWidth, innerHeight);
  if (!renderer.extensions.has('OES_texture_float_linear')) W.useHalfFloat();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.68, 0.80, 0.94), 0.011);
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1500);
  scene.add(camera);
  sky = makeSky(); scene.add(sky);
  sun = new THREE.DirectionalLight(0xfff0dc, 3.3); sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadow, q.shadow);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 120 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.035; sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4d4030, 0.35); scene.add(hemi);
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(makeSky());
  scene.environment = pm.fromScene(es, 0, 0.1, 1000).texture;
  const tm = T.terrainMaterial(); tmat = tm;
  const inner = T.buildMesh(tm); inner.layers.enable(1); scene.add(inner); innerMesh = inner;
  const outer = T.buildOuter(tm); outer.castShadow = false; scene.add(outer);
  sun.layers.enable(1); hemi.layers.enable(1);

  prog(0.12, '물리 엔진 준비'); await frame();
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  if ('numSolverIterations' in world.integrationParameters) world.integrationParameters.numSolverIterations = 8;
  events = new RAPIER.EventQueue(true);
  T.buildPhysics(RAPIER, world);
  S.initPhysics(RAPIER, world, q.lowPoly);

  prog(0.2, '돌 놓는 중'); await frame();
  const sg = new THREE.Group(); scene.add(sg); stoneGroup = sg; scene.add(S.outlineMesh());
  if (save) S.restore(save.st, sg); else S.spawnAll(sg, q.stones, q.boulders, keepOut);
  D.init(RAPIER, world, sg);
  H.init(sg, D.MAT, N.flowMat(1.0, 2.6, 1), RAPIER, world);
  if (save) { D.restore(save.dm); H.restore(save.hp); }
  V.build(scene, RAPIER, world);
  S.stones.forEach(st => st.mesh.layers.enable(1)); // 굴절 패스에는 지형·돌만 그린다
  prog(0.32, '숲 가꾸는 중'); await frame();
  N.buildTrees(scene, q.pine, q.broad);
  // 계곡 바닥 나무 몸통: 부딪히면 막힘
  for (const it of N.floorTrees) { it.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(it.x, it.y + 1.5, it.z)); world.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.16 * it.s / 0.8), it.body); }
  if (H.plant) clearTreesForPlant(H.plant);
  N.buildGrass(scene, q.grass);
  N.buildFlowers(scene, q.flowers);
  if (SEA()) N.buildOcean(scene, W.WAVES_A, W.WAVES_B, W.C_SEA, W.SEA_ZA, W.SEA_ZB, T.ISTH_Z, [T.X0 + T.SX0 * T.CELL, T.X0 + (T.SX1 - 1) * T.CELL, W.SEA_ZA, W.SEA_ZB]); else { N.buildStreams(scene); N.buildSmallFall(scene); } // 바다: 먼바다 판은 방파제 사이(계산하는 물)만 비운다
  FX.init(scene, camera); FX.opt.fall = !SEA();

  const pr = renderer.getPixelRatio();
  refrRT = new THREE.WebGLRenderTarget(innerWidth * pr * q.refr, innerHeight * pr * q.refr, { type: THREE.HalfFloatType });
  refrRT.depthTexture = new THREE.DepthTexture(refrRT.width, refrRT.height);
  W.init(); T.setSolidRef(W.solid); S.rasterize(true); W.prefill();
  if (save && (save.sw ?? 90) === T.SW) { decWater(save.w, W.h); decWater(save.w0, W.h0); W.computeActive(); W.state.time = 999; W.state.inflow = save.inflow ?? 0.2; }
  water = W.makeWaterMesh(refrRT); scene.add(water);
  water.material.uniforms.uProj.value = camera.projectionMatrix;
  const WARM = save ? 3 * 60 : 30 * 60;
  for (let s = 0; s < WARM; s++) {
    if (s % 2 === 0) { world.step(); S.sync(); S.rasterize(); }
    W.step(1 / 60); if (s % 4 === 0) W.post(4 / 60);
    if (s % 150 === 0) { prog(0.4 + 0.5 * s / WARM, SEA() ? '바닷물 채우는 중' : '계곡물 흘려보내는 중'); await frame(); }
  }
  W.upload();
  const sp = SEA() ? [-4.5, 36.5] : [T.centerX(7.5) - 1.8, 7.5];
  PL.init(RAPIER, world, camera, scene, hooks, { x: sp[0], y: T.groundAt(sp[0], sp[1]) + 1.1, z: sp[1] });
  if (SEA() && !save) PL.P.yaw = -Math.PI / 2; // 사주를 따라 바라보며 시작 (양쪽이 바다)
  if (save) {
    const p = save.p; PL.teleport(p[0], p[1]); PL.P.yaw = p[2]; PL.P.pitch = p[3];
    sky_.tod = save.tod ?? 9; elec.batt = save.batt ?? 0; ready = true; W.state.outSm = save.out ?? 0.2;
    if (save.rain) setRain(true);
    if (H.plant?.ready) $('bCtrl').classList.remove('hidden');
  }

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: q.msaa }));
  composer.addPass(new RenderPass(scene, camera));
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.55, 0.95); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  fxaa = new ShaderPass(FXAAShader); fxaa.enabled = false; composer.addPass(fxaa);
  gradePass = new ShaderPass(GRADE); composer.addPass(gradePass);
  scene.traverse(o => { const m = o.material; if (m && m.isMeshStandardMaterial) m.envMapIntensity = 0.75; });
  let saved = null; try { saved = localStorage.getItem('valley.perf'); } catch {}
  setPerf(saved === null ? !!q.perf : saved === '1');
  prog(0.95, '마무리'); await frame();
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
  // 굴절 텍스처는 화면(CSS) 해상도의 절반 아래로는 내리지 않음 → 물이 깨져 보이지 않게
  const rs = Math.max(perf ? 0.75 : Q.refr, 0.6 / pr);
  refrRT.setSize(Math.max(1, Math.round(w * pr * rs)), Math.max(1, Math.round(h * pr * rs)));
  fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  water.material.uniforms.uRes.value.set(w * pr, h * pr);
  water.material.uniforms.uNear.value = camera.near; water.material.uniforms.uFar.value = camera.far;
  FX.setScale(h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
}

// ───── 자동 해상도: 30fps를 지키도록 렌더 해상도를 조절 ─────
const dyn = { scale: 1, avg: 33, cpu: 8, t: 0, cool: 0, ceil: 1, lastUp: -99 };
function dynRes(interval, dt, cpu) {
  dyn.avg += (interval - dyn.avg) * 0.08; dyn.cpu += (cpu - dyn.cpu) * 0.08; dyn.t += dt; dyn.cool -= dt;
  if (dyn.t < 1.2 || dyn.cool > 0) return;
  dyn.t = 0;
  // 계산(CPU)이 느려서 늦어진 경우엔 해상도를 내려도 소용없으니 화질은 그대로 둔다
  const gpuBound = dyn.avg - dyn.cpu > 24;
  let s = dyn.scale;
  if (gpuBound && dyn.avg > 50) s *= 0.8;
  else if (gpuBound && dyn.avg > 37.5) s *= 0.9;
  else if (dyn.avg < 34.5 && s < dyn.ceil) { s = Math.min(dyn.ceil, s * 1.08); dyn.lastUp = clock; }
  else if (!gpuBound && s < 1 && dyn.avg < 40) s = Math.min(dyn.ceil, s * 1.04);
  else return;
  if (s < dyn.scale && clock - dyn.lastUp < 3) dyn.ceil = Math.max(0.75, dyn.scale * 0.97); // 올렸다가 느려지면 그 위로는 안 올림
  s = Math.max(0.75, Math.min(1, s)); // 너무 낮추면 픽셀처럼 깨지므로 75% 아래로는 내리지 않음
  if (Math.abs(s - dyn.scale) < 0.01) return;
  dyn.scale = s; dyn.cool = 1.5;
  renderer.setPixelRatio((perf ? perfPR() : basePR) * s);
  resize();
}

// ───── 최적화 모드 / 비 ─────
// 최적화 모드(고화질 유지): 내부 해상도↓ + FXAA, 굴절 저해상도, 풀 60%, 그림자 2048·격프레임 갱신
const perfPR = () => Math.min(devicePixelRatio, 1.3);
function setPerf(on) {
  perf = on; $('bPerf').classList.toggle('on', on); $('fps').classList.toggle('hidden', !on);
  renderer.setPixelRatio((on ? perfPR() : basePR) * dyn.scale);
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = on ? 0 : Q.msaa; rt.dispose(); }
  fxaa.enabled = on;
  if (bloom) bloom.enabled = !on;
  innerMesh.castShadow = !on; // 폰: 지형 그림자 생략
  N.setDensity(on ? 0.75 : 1, on ? Math.min(26, Q.view) : Q.view);
  // 가벼운 셰이더 (자갈 무늬·물속 빛무늬·돌 결 단순화)
  for (const m of [tmat, ...S.mats, ...S.paintMats, water.material]) { m.defines = m.defines || {}; if (on) m.defines.LITE = ''; else delete m.defines.LITE; m.needsUpdate = true; }
  const ms = on ? 1536 : Q.shadow;
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
  if (!document.pointerLockElement && !paused && !ctrlOpen) showPause('일시정지', '계속');
});
$('resume').onclick = resume;
$('pause').onclick = e => { if (e.target === $('pause')) resume(); };
updateSaveInfo();
$('restart').onclick = () => location.reload();
$('gl').addEventListener('click', () => { if (started && !isTouch && !document.pointerLockElement) resume(); });
$('bPause').onclick = () => { if (isTouch) showPause('일시정지', '계속'); else document.exitPointerLock(); };
$('bPerf').onclick = () => setPerf(!perf);
$('bRain').onclick = () => setRain(!rainOn);
$('bSpeed').onclick = () => PL.cycleSpeed();
const SCALES = [1, 2, 4, 10, 20, 30, 50, 100];
// 붓기 재료 · 페인트 색 고르기
document.querySelectorAll('#pourMenu [data-p]').forEach(b => b.onclick = () => { PL.P.pour = +b.dataset.p; document.querySelectorAll('#pourMenu [data-p]').forEach(x => x.classList.toggle('on', x === b)); });
document.querySelectorAll('#paintMenu [data-c]').forEach(b => { b.style.setProperty('--c', b.dataset.c); b.onclick = () => { PL.P.paint = parseInt(b.dataset.c.slice(1), 16); document.querySelectorAll('#paintMenu [data-c]').forEach(x => x.classList.toggle('on', x === b)); }; });
$('bTime').onclick = () => { $('timeMenu').classList.toggle('hidden'); $('dayMenu').classList.add('hidden'); };
document.querySelectorAll('#timeMenu [data-ts]').forEach(b => b.onclick = () => { setTimeScale(+b.dataset.ts); $('timeMenu').classList.add('hidden'); });
// 낮밤 정하기
let dayFrozen = false;
function toggleDayMenu() { $('dayMenu').classList.toggle('hidden'); $('timeMenu').classList.add('hidden'); }
$('bDay').onclick = toggleDayMenu;
document.querySelectorAll('#dayMenu [data-tod]').forEach(b => b.onclick = () => { sky_.tod = +b.dataset.tod; $('dayMenu').classList.add('hidden'); });
$('dayFlow').onclick = () => { dayFrozen = !dayFrozen; $('dayFlow').textContent = dayFrozen ? '시간 흐름: 멈춤' : '시간 흐름: 켜짐'; $('dayFlow').classList.toggle('on', !dayFrozen); };
$('bSave').onclick = () => saveGame();
$('saveBtn').onclick = () => saveGame();
// 배경음악 켜기·끄기 (M)
const musicLabel = () => { $('musicBtn').textContent = A.musicOn() ? '배경음악: 켜짐' : '배경음악: 꺼짐'; };
$('musicBtn').onclick = () => { A.setMusic(!A.musicOn()); musicLabel(); }; musicLabel();
// 큰 댐 자동 건설
$('bBig').onclick = () => {
  if (H.plant) { hooks.toast(H.plant.ready ? '발전소는 하나만 지을 수 있어요 — 제어실을 열어 보세요' : '건설 중이에요'); return; }
  camera.getWorldDirection(camDir);
  // 지금 서 있는 곳에서 바라보는 쪽으로 6 m 앞 (집과 겹치면 조금 더 앞으로)
  const dirz = camDir.z >= 0 ? 1 : -1;
  let z = camera.position.z + dirz * 6;
  for (let n = 0; n < 10 && V.cabins.some(c => Math.abs(c.position.z - z) < 4.5); n++) z += dirz * 1.5;
  z = Math.max(13, Math.min(64, z)); // 물이 고일 저수지가 생기도록 수원(z≈5)에서 8 m 이상 떨어뜨린다
  const p = H.build(z); A.rumble?.(p.dur); clearTreesForPlant(p);
  hooks.toast('계곡 수력발전소 건설 시작!');
};
// 댐·발전소 자리에 있던 나무는 치운다
function clearTreesForPlant(p) { for (const it of N.clearTreesIn(-30, 30, p.zU - 1.5, p.zU + 8.5)) if (it.body) { world.removeRigidBody(it.body); it.body = null; } }
// 제어실 패널
let ctrlOpen = false;
function setCtrl(on) {
  ctrlOpen = on; $('ctrl').classList.toggle('hidden', !on);
  if (on && document.pointerLockElement) document.exitPointerLock();
}
$('bCtrl').onclick = () => setCtrl(!ctrlOpen);
// 댐 철거: 두 번 눌러 확인 (지우개로 댐을 겨눠도 됨)
let demoArm = 0;
function demolishPlant() {
  if (!H.plant || H.plant.demo) return;
  if (H.building()) { hooks.toast('건설이 끝난 뒤에 철거할 수 있어요'); return; }
  if (clock - demoArm > 3) { demoArm = clock; $('ctrlDemo').classList.add('arm'); $('ctrlDemo').textContent = '정말 철거?'; hooks.toast('한 번 더 누르면 댐을 철거해요 — 고인 물이 한꺼번에 흘러내려가요'); return; }
  demoArm = 0; $('ctrlDemo').classList.remove('arm'); $('ctrlDemo').textContent = '댐 철거';
  H.demolish(); A.rumble?.(2.5); shake = 0.06; setCtrl(false); $('bCtrl').classList.add('hidden');
  hooks.toast('댐 철거 중…');
}
$('ctrlDemo').onclick = demolishPlant;
$('ctrlX').onclick = () => { setCtrl(false); if (!isTouch) resume(); };
['u0', 'u1', 'g0', 'g1'].forEach(id => $(id).oninput = e => {
  const v = +e.target.value / 100, p = H.plant; if (!p) return;
  if (id[0] === 'u') p.units[+id[1]].target = v; else p.gates[+id[1]].target = v;
});
document.querySelectorAll('#bar [data-t]').forEach(b => b.onclick = () => PL.setTool(b.dataset.t));
addEventListener('keydown', e => {
  if (!started || e.repeat) return;
  if (e.code === 'KeyB') setRain(!rainOn);
  if (e.code === 'KeyO') setPerf(!perf);
  if (e.code === 'KeyN') toggleDayMenu();
  if (e.code === 'KeyK') saveGame();
  if (e.code === 'KeyM') { A.setMusic(!A.musicOn()); musicLabel(); hooks.toast(A.musicOn() ? '배경음악 켜짐' : '배경음악 꺼짐'); }
  if (e.code === 'KeyC' && H.plant?.ready) setCtrl(!ctrlOpen);
  if (e.code === 'KeyT') { setTimeScale(SCALES[(SCALES.indexOf(timeScale) + 1) % SCALES.length]); hooks.toast('시간 ×' + timeScale); }
});

// ───── 게임 훅 ─────
let toastT = 0, lastToast = '';
const hooks = {
  grass(x, z) { N.onEdit(x, z, 0.5); },
  ownsPlant: h => H.owns(h),
  demolishPlant: () => demolishPlant(),
  toast(t) { if (t === lastToast && toastT > 0.6) return; lastToast = t; const el = $('toast'); el.textContent = t; el.classList.add('show'); toastT = 1.8; },
  ui: {
    tool(t) {
      document.querySelectorAll('#bar [data-t]').forEach(e => e.classList.toggle('on', e.dataset.t === t));
      $('tPrim').innerHTML = `<svg><use href="#i-${t}"/></svg>`;
      $('tSec').innerHTML = `<svg><use href="#i-${t === 'shovel' ? 'pour' : t === 'dam' ? 'turbine' : 'throw'}"/></svg>`;
      $('tSec').classList.toggle('hidden', !(t === 'hand' || t === 'shovel' || t === 'dam')); $('tRot').classList.toggle('hidden', t !== 'hand');
      $('bSpeed').classList.toggle('hidden', !['shovel', 'mud', 'flatten', 'carve'].includes(t));
      $('bBig').classList.toggle('hidden', t !== 'dam');
      $('pourMenu').classList.toggle('hidden', t !== 'mud'); $('paintMenu').classList.toggle('hidden', t !== 'paint');
    },
    speed(n) { const b = $('bSpeed'); $('spd').textContent = ['×1', '×3', '×8'][n]; b.classList.toggle('s1', n === 1); b.classList.toggle('s2', n === 2); },
    pour(n) { document.querySelectorAll('#pourMenu [data-p]').forEach(x => x.classList.toggle('on', +x.dataset.p === n)); },
    paint(hex) { document.querySelectorAll('#paintMenu [data-c]').forEach(x => x.classList.toggle('on', parseInt(x.dataset.c.slice(1), 16) === hex)); },
    prompt(t, on) { const el = $('tag'); if (el.textContent !== t) el.textContent = t; $('cross').classList.toggle('on', on); },
  },
  audio: A, fx: FX,
  edit(x, z, r) { N.onEdit(x, z, r); edits.push([x, z]); lastEdit = clock; },
  damChanged() { S.touch(); },
  // 하늘에서 바위 떨어뜨리기
  dropRock(x, z) {
    const big = Math.random() < 0.12, r = big ? 0.55 + Math.random() * 0.35 : 0.14 + Math.pow(Math.random(), 1.4) * 0.32;
    const st = S.addStone(x + (Math.random() - 0.5) * 0.4, T.groundAt(x, z) + 9 + Math.random() * 3, z + (Math.random() - 0.5) * 0.4, r);
    stoneGroup.add(st.mesh); st.moved = true;
    st.body.setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 }, true);
    S.trim(Q.perf || isTouch ? 150 : 240, camera.position);
    A.whoosh();
  },
};
let edits = [], lastEdit = -10, clock = 0, ready = false;

let uiT = 0;
function ui(dt) {
  toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show');
  uiT -= dt; if (uiT > 0) return; uiT = 0.2;
  const st = W.state;
  if (!ready && st.time > 62) { ready = true; W.saveBaseline(); }
  if (SEA()) {
    const sg = v => (v >= 0 ? '+' : '') + v.toFixed(2), dh = st.tideA - st.tideB;
    $('mPct').textContent = `수위 차 ${Math.abs(dh).toFixed(2)} m ${dh > 0.02 ? '↑' : dh < -0.02 ? '↓' : ''}`;
    $('mFill').style.width = Math.min(100, Math.abs(dh) / 0.5 * 100).toFixed(1) + '%';
    $('mSub').textContent = `남쪽 바다 ${sg(st.tideA)} m · 북쪽 바다 ${sg(st.tideB)} m · 물살에 옮겨진 모래 ${st.eroded.toFixed(1)} m³`;
  } else {
  const blocked = Math.max(0, Math.min(1, 1 - st.outSm / st.inflow));
  $('mPct').textContent = ready ? Math.round(blocked * 100) + '%' : '—';
  $('mFill').style.width = (ready ? blocked * 100 : 0).toFixed(1) + '%';
  $('mSub').textContent = ready ? `저수 ${st.stored.toFixed(1)} m³ · 하류 ${Math.max(0, st.outSm * 1000).toFixed(0)} L/s` : '물길이 흐르는 중';
  }
  const hh = Math.floor(sky_.tod), mm = Math.floor((sky_.tod - hh) * 60);
  if (H.building()) { const sg = H.plant.segs; $('pw').textContent = `수력발전소 건설 중… ${Math.round(sg.filter(x => x.ready).length / sg.length * 100)}%`; }
  else $('pw').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · 발전 ${elec.gen.toFixed(1)} kW · 배터리 ${Math.round(elec.batt / elec.cap * 100)}% · ${elec.lit > 0.5 ? '불 켜짐' : elec.want ? '전기 부족' : '불 꺼짐'}`;
  $('mud').style.width = Math.min(100, PL.P.bucket / 0.5 * 100) + '%';
  if (perf) $('fps').textContent = fpsV.toFixed(0) + ' fps';
  if (ctrlOpen && H.plant?.ready) ctrlUpdate();
}

// ───── 루프 ─────
let erodeT = 0, erodeLast = 0, cemT = 0, lastImpact = 0, grassT = 0, underwater = false;
let shake = 0, timeScale = 1, gclock = 0, cpuMs = 8, flushT = 0, last = performance.now(), physAcc = 0, waterAcc = 0, fpsV = 60, fpsN = 0, fpsT = 0, frameN = 0;
const camDir = new THREE.Vector3();
const FRAME_MS = 1000 / 30;
// 촬영 모드(?capture): 화면을 한 장씩 정확한 시간 간격으로 진행 (메인화면 영상 만들기용)
const CAPTURE = params.has('capture');
let capNow = 0, camRig = null;
function loop(now) {
  if (!CAPTURE) requestAnimationFrame(loop);
  if (now - last < FRAME_MS - 4) return; // 30fps 고정
  const raw = (now - last) / 1000; const dt = Math.min(0.07, raw); last = now;
  if (!paused && !CAPTURE) dynRes(raw * 1000, dt, cpuMs);
  const t0 = performance.now();
  fpsN++; fpsT += raw; if (fpsT > 0.5) { fpsV = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  if (paused) { render(); return; }
  const dg = dt * timeScale; // 게임 시간 (배속 적용)
  const dv = Math.min(dg, dt * 2), da = Math.min(dg, dt * 4); // 화면 효과·애니메이션은 너무 빨라지지 않게
  clock += dt; gclock += dv; T.U.uTime.value = gclock;
  PL.update(dt, clock);
  if (camRig) { const r = camRig(clock); camera.position.set(r.p[0], r.p[1], r.p[2]); camera.lookAt(r.l[0], r.l[1], r.l[2]); camera.updateMatrixWorld(); }
  physAcc += dg; let n = 0; const maxPhys = Math.min(perf ? 4 : 8, 4 * timeScale);
  while (physAcc >= 1 / 60 && n < maxPhys) {
    PL.prePhysics(1 / 60);
    S.waterForces(onSplash);
    for (const st of S.stones) if (!st.fixed && !st.body.isSleeping()) st.vyPrev = st.body.linvel().y; // 충돌 직전 낙하 속도
    world.step(events);
    events.drainContactForceEvents(onContact);
    physAcc -= 1 / 60; n++;
  }
  if (n === maxPhys) physAcc = 0;
  S.sync(); S.rasterize();
  waterAcc += Math.min(dg, timeScale / 15); let m = 0;
  const maxSteps = Math.min(perf ? 6 : 10, (perf ? 2 : 3) * timeScale);
  while (waterAcc >= 1 / 60 && m < maxSteps) { W.step(1 / 60); waterAcc -= 1 / 60; m++; }
  if (m === maxSteps) waterAcc = Math.min(waterAcc, 1 / 60);
  W.fastFill(timeScale > 1 ? Math.max(0, dg - m / 60) : 0, m / 60); // 배속: 계산이 못 따라간 시간만큼 고인 물이 차오름
  W.post(da);
  D.update(da, FX.splash, FX.dirt);
  if (D.building()) { S.touch(); shake = 0.05; }
  // 모터 전원: 배터리·발전 전기가 없으면 실제 발전소처럼 비상 디젤 발전기가 대신 돌린다(블랙 스타트)
  elec.diesel = !(elec.batt > 0.05 || elec.gen > 0.5);
  const hadPlant = !!H.plant;
  const hy = H.update(da, true, FX.splash, FX.dirt, (pos, body) => { A.snap(body); FX.dirt(pos.x, pos.y, pos.z, body ? 5 : 2); if (body) shake = Math.max(shake, 0.025); },
    (x, y, z, cx, cz) => { A.crack(0.7); FX.chips(x, y, z, 22); FX.dirt(x, y, z, 12); hooks.edit(cx, cz, 6); shake = Math.max(shake, 0.045); }); // 발전소 자리 바위 깨기
  elec.motor = hy.load;
  if (hadPlant && !H.plant) { S.touch(); hooks.toast('댐을 철거했어요'); saveGame(true); }
  if (H.plant) {
    if (H.plant.changed) { S.touch(); H.plant.changed = false; }
    if (H.plant.justDone) { H.plant.justDone = false; A.chime(); setTimeScale(10); hooks.toast('수력발전소 완공! 담수 시작 — 시간 ×10으로 물을 채우는 중 · 제어실(C)'); $('bCtrl').classList.remove('hidden'); saveGame(true); }
    const d = camera.position.distanceTo(new THREE.Vector3(H.plant.cx + 3, H.plant.crest, H.plant.zU + 4));
    A.machine(H.plant.P / 8000 / (1 + d * d * 0.004), H.plant.gates.some(g => g.moving) ? 1 / (1 + d * d * 0.01) : 0);
  }
  if (clock - lastSave > 90 && !D.building() && !H.building()) saveGame(true); // 자동 저장
  dayNight(dg); electricity(dt, dg);
  // 시멘트가 굳고 페인트가 마른다 · 굳은 시멘트에 박힌 돌은 붙잡힌다
  T.cureStep(dg, dt); S.paintStep(dg); D.paintStep(dg);
  cemT += dt; if (cemT > 1) { cemT = 0; if (S.cementCheck()) hooks.toast('시멘트가 굳어 돌이 단단히 붙었어요'); }
  flushT += dt;
  if (clock - lastEdit < 0.3 || flushT > 0.25) { T.flushMesh(); flushT = 0; }
  if (T.physState.dirty) {
    T.physState.t += dt;
    if ((T.physState.t > 0.3 && clock - lastEdit > 0.25) || T.physState.t > 3) rebuildHF(); // 계속 파는 중엔 3초마다만 다시 만듦
  }
  if (!perf || frameN % 2 === 0) W.upload(); // 폰: 물 텍스처는 격프레임 갱신
  // 비: 계곡물이 불어남
  const st = W.state, rt = rainOn ? 1 : 0;
  st.inflow += ((SEA() ? 0 : rainOn ? 0.42 : 0.2) - st.inflow) * Math.min(1, dg * 0.08);
  if (SEA()) { // 밀물·썰물(반나절 주기 ±0.35 m) — 북쪽 바다는 3시간 늦게 차서, 두 바다 사이에 수위 차(최대 약 0.48 m)가 생긴다
    st.tideA = 0.35 * Math.sin(2 * Math.PI * (sky_.tod - 4) / 12.42); st.tideB = 0.35 * Math.sin(2 * Math.PI * (sky_.tod - 7) / 12.42);
    N.oceanU.uT.value = st.time; N.oceanU.uSeaA.value = T.SEA_Y + st.tideA; N.oceanU.uSeaB.value = T.SEA_Y + st.tideB;
  }
  // 물살에 깎이고 쌓인 땅: 가끔 물리 높이장도 다시 만든다
  // 물살에 뜯기거나 물에 잠겨 시든 풀 포기 치우기 (0.5초마다 조금씩)
  grassT += dt; if (grassT > 0.5 && st.grassGone.length) { grassT = 0; for (const k of st.grassGone.splice(0, 40)) { const x = T.X0 + (k % T.NXV) * T.CELL, z = T.Z0 + ((k / T.NXV) | 0) * T.CELL, s = W.sample(x, z); N.onEdit(x, z, 0.25); if (s && s.h > 0.02 && Math.hypot(s.vx, s.vz) > 0.35 && (x - camera.position.x) ** 2 + (z - camera.position.z) ** 2 < 600) FX.uproot(x, s.surf, z, s.vx, s.vz); } }
  erodeT += dt; if (erodeT > 4) { erodeT = 0; if (Math.abs(st.eroded - erodeLast) > 0.02) { erodeLast = st.eroded; T.physState.dirty = true; } }
  T.U.uRain.value += (rt - T.U.uRain.value) * Math.min(1, dg * 0.15);
  if (!SEA()) { const sf = N.smallFall, s = W.sample(sf.x, sf.z - 1.2), f = s ? Math.min(1, s.h * Math.hypot(s.vx, s.vz) / 0.1) : 0;
    N.setSmallFall(f); FX.fall2.x = sf.x; FX.fall2.y = sf.yb; FX.fall2.z = sf.z; FX.fall2.f = f; }
  // 물보라: 카메라 근처의 거품 많고 빠른 물살에서 물방울이 튄다
  { const c = camera.position; let shots = 0;
    for (let n = 0; n < (perf ? 14 : 28) && shots < 4; n++) {
      const a = Math.random() * 6.283, r = 1.5 + Math.random() * 11, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, s = W.sample(x, z);
      if (!s || s.open < 0.02) continue;
      const sp = Math.hypot(s.vx, s.vz), fo = W.foam[s.k];
      if (fo < 0.5 || sp < 0.9) continue;
      FX.spray(x, s.surf, z, s.vx, s.vz, Math.min(1, (sp - 0.9) * 0.6 + (fo - 0.5))); shots++;
    } }
  FX.update(dv, T.U.uRain.value);
  N.setDownstream(Math.max(0, st.outSm / 0.2));
  N.cull(camera.position);
  audioUpdate();
  ui(dt);
  cpuMs = performance.now() - t0; // 화면 그리기 전까지의 계산 시간
  render();
}
// ───── 낮과 밤: 하루 10분(×1). 해가 지면 달빛, 별, 어두운 안개 ─────
const sky_ = { tod: 9, len: 600, sunI: 3.3 };
const stdMats = [];
const cSun = new THREE.Color(), cWarm = new THREE.Color(1, 0.62, 0.36), cDay = new THREE.Color(1, 0.94, 0.86), cMoon = new THREE.Color(0.55, 0.66, 0.95);
const fogDay = new THREE.Color().setRGB(0.68, 0.80, 0.94), fogDusk = new THREE.Color().setRGB(0.62, 0.48, 0.42), fogNight = new THREE.Color().setRGB(0.025, 0.035, 0.06);
function dayNight(dg) {
  if (!dayFrozen) sky_.tod = (sky_.tod + dg * 24 / sky_.len) % 24;
  const a = (sky_.tod - 6) / 12 * Math.PI, el = Math.sin(a);
  const day = THREE.MathUtils.smoothstep(el, -0.08, 0.16);
  T.U.uDay.value = day;
  const dir = T.U.uSunDir.value;
  if (el > -0.04) dir.set(Math.cos(a) * 0.6, Math.max(el, 0.02) * 0.85, 0.42).normalize();
  else dir.set(-Math.cos(a) * 0.5, Math.max(-el, 0.25) * 0.8, 0.45).normalize(); // 달
  const low = 1 - THREE.MathUtils.smoothstep(el, 0.02, 0.35);
  if (day > 0.02) { cSun.copy(cDay).lerp(cWarm, low); sky_.sunI = 3.3 * day; }
  else { cSun.copy(cMoon); sky_.sunI = 0.35; }
  sun.color.copy(cSun); T.U.uSunCol.value.copy(cSun).multiplyScalar(day > 0.02 ? 1 : 0.35);
  scene.fog.color.copy(fogNight).lerp(fogDay, day).lerp(fogDusk, low * day * 0.6);
  if (!stdMats.length) scene.traverse(o => { const m = o.material; if (m && m.isMeshStandardMaterial && !stdMats.includes(m)) stdMats.push(m); });
  for (const m of stdMats) m.envMapIntensity = 0.75 * (0.12 + 0.88 * day);
}
// ───── 전기: 터빈 발전 → 배터리 → 밤에 가로등·오두막 불 ─────
const elec = { batt: 0, cap: 20, gen: 0, lit: 0, want: false };
function electricity(dt, dg) {
  elec.gen = (D.power() + H.power()) / 1000;
  elec.want = T.U.uDay.value < 0.45;
  const demand = (elec.want ? V.demandKW() : 0) + (elec.diesel ? 0 : elec.motor || 0), hours = dg * 24 / sky_.len;
  elec.batt = Math.max(0, Math.min(elec.cap, elec.batt + (elec.gen - demand) * hours));
  const on = elec.want && (elec.batt > 0.02 || elec.gen >= demand) ? 1 : 0;
  elec.lit += (on - elec.lit) * Math.min(1, dt * 2.5);
  V.setLit(elec.lit);
}
function setTimeScale(n) { timeScale = n; $('tsx').textContent = '×' + n; $('bTime').classList.toggle('on', n > 1); document.querySelectorAll('#timeMenu [data-ts]').forEach(b => b.classList.toggle('on', +b.dataset.ts === n)); }
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
  if (!st || st.fixed || clock - st.lastHit < 0.3) return;
  // 물살에 살짝 흔들리며 닿는 정도는 소리 없음 (실제로 부딪혀 움직일 때만)
  const lv = st.body.linvel(), spd = Math.hypot(lv.x, lv.y, lv.z);
  if (spd < 0.45 && (st.vyPrev || 0) > -0.9 && !st.held) return;
  st.lastHit = clock;
  const other = st.collider.handle === c1 ? c2 : c1, hf = T.getHF();
  if (st.quiet > performance.now()) return; // 막 깨진 조각
  if (hf && other === hf.handle && (st.vyPrev || 0) < -1.8 && !st.held) dent(st, -st.vyPrev);
  const f = e.totalForceMagnitude() / (st.mass * 9.81);
  let s = Math.min(1, Math.max(0.08, (f - 6) / 40)) * Math.min(1, Math.max(0.3, st.mass / 40));
  const d = camera.position.distanceTo(st.mesh.position);
  s /= 1 + d * d * 0.03;
  if (s > 0.05 && clock - lastImpact > 0.07) { lastImpact = clock; A.impact(s, st.surf > st.cy); }
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
  const sf = N.smallFall, fd = SEA() ? Math.max(2.5, Math.min(Math.abs(c.z - 21), Math.abs(c.z - 51))) * (1.6 - 0.9 * Math.max(0, Math.sin(2 * Math.PI * W.state.time / 6.5))) : Math.min(Math.hypot(c.x - T.centerX(4.4), c.z - 4.4, c.y - T.groundAt(T.centerX(4.4), 4.4)),
    Math.hypot(c.x - sf.x, c.z - sf.z, c.y - sf.yb) * 1.8 / Math.sqrt(Math.max(0.02, FX.fall2.f)));
  const night = Math.min(1, Math.max(0, (Math.abs(sky_.tod - 12) - 6.3) / 1.2));
  const surf = SEA() ? Math.min(1, Math.max(0, 1.15 - Math.min(Math.abs(c.z - 21), Math.abs(c.z - 51)) / 14)) : 0;
  A.update({ flow: flow * 1.6, turb: turb * 0.5, fallDist: fd, rain: T.U.uRain.value, night, surf, sea: SEA(), mood: night > 0.5 ? 'night' : SEA() ? 'sea' : 'day', dt: 1 / 30 });
}
function render() {
  frameN++;
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= 0.85; if (shake < 0.002) shake = 0; } // 건설 진동
  camera.getWorldDirection(camDir);
  const tx = camera.position.x + camDir.x * 10, tz = camera.position.z + camDir.z * 10;
  const snap = 32 / sun.shadow.mapSize.x, sx = Math.round(tx / snap) * snap, sz = Math.round(tz / snap) * snap;
  sun.target.position.set(sx, T.groundAt(sx, sz), sz);
  sun.position.copy(sun.target.position).addScaledVector(T.U.uSunDir.value, 90);
  sun.target.updateMatrixWorld();
  const rain = T.U.uRain.value;
  const day = T.U.uDay.value;
  sun.intensity = sky_.sunI * (1 - rain * 0.75); hemi.intensity = (0.35 + rain * 0.25) * day + 0.05;
  scene.fog.density = 0.011 + rain * 0.012; gradePass.uniforms.uRain.value = rain;
  // 물속: 푸른 안개 · 화면 색 · 먹먹한 소리
  { const cs = W.sample(camera.position.x, camera.position.z), u = !!(cs && cs.h > 0.05 && camera.position.y < cs.surf - 0.02);
    if (u) { scene.fog.density = 0.24; scene.fog.color.setRGB(0.05, 0.19, 0.22).multiplyScalar(0.3 + 0.7 * day); }
    if (u !== underwater) { underwater = u; document.body.classList.toggle('under', u); A.underwater(u); } }
  renderer.toneMappingExposure = 0.92 + (1 - day) * 0.55;
  sky.position.copy(camera.position);
  renderer.shadowMap.needsUpdate = !perf || frameN % 3 === 0;
  // 굴절용 패스: 지형·돌만 (레이어 1)
  camera.layers.set(1);
  renderer.setRenderTarget(refrRT); renderer.render(scene, camera);
  camera.layers.set(0);
  renderer.setRenderTarget(null);
  // 최적화 모드: 후처리 없이 화면에 바로 그림 (톤매핑은 렌더러가 처리) → 폰 발열·대역폭 감소
  if (perf) renderer.render(scene, camera); else composer.render();
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
