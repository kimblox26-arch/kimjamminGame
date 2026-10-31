// 앱 시작점: 불러오기, 화면 전환, 메인 화면 연출, 운행 준비, 열차 만들기, 운행 루프
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Terrain, clamp, lerp, smooth } from './geo.js';
import { Network, ST } from './network.js';
import { World, QUALITY } from './world.js';
import { landmarks } from './builders.js';
import { TrainModel } from './trainmodel.js';
import { TRAINS, NOSES } from './data/trains.js';
window.__TRAINS = TRAINS;
import { GROUPS } from './data/stations.js';
import { Sim } from './sim.js';
import { Sound } from './audio.js';
import { HUD } from './hud.js';
import { MapView } from './map.js';
import { ICON, TRAIN_ART } from './icons.js';

const $ = id => document.getElementById(id);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('krd.' + k)) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem('krd.' + k, JSON.stringify(v)); } catch (e) { } } };
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = ICON[el.dataset.icon] || '');
$('logo-mark').innerHTML = $('logo-mark2').innerHTML = ICON.train;
$('wipe-train').innerHTML = TRAIN_ART;

const settings = Object.assign({ q: 'high', fps: false, vol: { master: 0.8, train: 0.9, voice: 0.9, ui: 0.6 } }, store.get('settings', {}));
const sound = new Sound(); Object.assign(sound.vol, settings.vol);
const hud = new HUD();

// ───── 렌더러 ─────
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: !location.search.includes('nolog'), powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 120000); camera.layers.enable(1);
let composer = null, bloom = null;
function setupRender() {
  const q = QUALITY[settings.q], w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * q.pr > 2.5 ? 2.5 : Math.min(devicePixelRatio, 2) * q.pr);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.far = q.far; camera.updateProjectionMatrix();
  composer?.dispose?.(); composer = null;
  if (q.bloom && world) {
    const rt = new THREE.WebGLRenderTarget(w * renderer.getPixelRatio(), h * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: q.msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(world.scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.5, 0.92); composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
}
addEventListener('resize', setupRender);

// ───── 화면 전환 (열차가 지나가며 화면을 바꾼다) ─────
let screen = 's-loading', busy = false;
document.body.dataset.screen = screen;
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  document.body.dataset.screen = screen = id;
  onScreen(id);
}
function go(id, fx = true) {
  if (busy || id === screen) return;
  if (!fx) return show(id);
  busy = true; sound.ui('whoosh');
  const w = $('wipe'); w.classList.remove('run'); void w.offsetWidth; w.classList.add('run');
  setTimeout(() => show(id), 520);
  setTimeout(() => { w.classList.remove('run'); busy = false; }, 1180);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  sound.init(); sound.ui(); b.classList.add('clicked'); setTimeout(() => b.classList.remove('clicked'), 450);
  go(b.dataset.go);
});
document.addEventListener('pointerover', e => { if (e.target.closest?.('.mbtn,.item')) sound.ui('hover'); });

// ───── 불러오기 ─────
let terrain, net, world, geo, bigMap, routeMap, miniMap;
async function boot() {
  const setP = (p, t) => { $('load-bar').style.width = (p * 100).toFixed(1) + '%'; if (t) $('load-text').textContent = t; return new Promise(r => setTimeout(r, 0)); };
  await setP(0.02, '해안선과 섬 데이터를 불러오는 중');
  geo = await (await fetch('./data/geo.json?v=20261031a')).json();
  terrain = new Terrain();
  await terrain.build(geo, p => setP(0.03 + p * 0.17, '한반도 지형을 만드는 중'));
  net = new Network(terrain);
  await net.build(geo, p => setP(0.2 + p * 0.45, `노선과 역을 배치하는 중 (${Math.round(p * 100)}%)`));
  world = new World(renderer, terrain, net);
  world.setQuality(QUALITY[settings.q]);
  setupRender();
  await setP(0.66, '전국 원경 지형을 만드는 중');
  const far = world.buildFar(); let n = 0; while (!far.next().done) if (++n % 30 === 0) await setP(0.66 + Math.min(0.08, n * 0.0004));
  const lm = landmarks(world); lm.traverse(o => o.layers.set(1)); world.root.add(lm);
  world.setTime(nowHour());
  startDemo();
  await setP(0.75, '서울 시내를 짓는 중');
  const t0 = performance.now();
  while (world.loading && performance.now() - t0 < 25000) {
    world.update(0.016, demo.focus.x, demo.focus.y, demo.focus.z, camera, 40);
    const done = 1 - world.loading / Math.max(1, world._maxJobs = Math.max(world._maxJobs || 0, world.loading));
    await setP(0.75 + done * 0.25);
  }
  bigMap = new MapView($('big-map'), terrain, net, geo);
  routeMap = new MapView($('route-map'), terrain, net, geo);
  miniMap = new MapView($('minimap'), terrain, net, geo, { interactive: false }); miniMap.mpp = 22;
  $('menu-stat').textContent = `노선 ${net.lines.length}개 · 역 ${new Set(net.stationList.map(s => s.st.name)).size}곳 · 선로 ${Math.round(net.lines.reduce((a, L) => a + L.length, 0) / 1000).toLocaleString()} km`;
  buildRouteUI(); buildBuilder(); buildSettings(); buildLegend();
  window.__krd = { world, net, terrain, sel, renderer, camera, sound, get game() { return game; }, startRun, go };
  go('s-menu');
}
const urlHour = new URLSearchParams(location.search).get('hour');
const nowHour = () => { if (urlHour) return +urlHour; const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

// ───── 메인 화면 연출: 잠실 부근 2호선 ─────
const demo = { focus: new THREE.Vector3() };
function startDemo() {
  const L = net.byId.s2, st = L.stations.find(s => s.name === '잠실나루');
  const spec = TRAINS.find(t => t.id === 'metro');
  demo.line = L; demo.s0 = st.s - 1500; demo.s1 = st.s + 700; demo.s = demo.s0 + 700;
  demo.model = new TrainModel({ ...spec, cars: L.cars }, L.color); demo.model.setPanto(1);
  world.scene.add(demo.model.group);
  const T = L.at(st.s - 250), nx = -Math.sin(T.hd), nz = Math.cos(T.hd);
  demo.target = new THREE.Vector3(T.x, T.y + 6, T.z);
  const cx = T.x + nx * 170 - Math.cos(T.hd) * 120, cz = T.z + nz * 170 - Math.sin(T.hd) * 120;
  demo.cam = new THREE.Vector3(cx, Math.max(terrain.height(cx, cz), T.y) + 32, cz);
  updateDemo(0);
}
function updateDemo(dt) {
  const L = demo.line; demo.s += dt * 15; if (demo.s > demo.s1) demo.s = demo.s0;
  const lat = -L.cfg.gap / 2, o = world.origin;
  demo.model.place(L, demo.s, 1, lat, o, demo.s / 0.43);
  demo.focus.copy(demo.target);
  camera.position.set(demo.cam.x - o.x, demo.cam.y, demo.cam.z - o.y); camera.lookAt(demo.target.x - o.x, demo.target.y, demo.target.z - o.y);
  demo.model.setInterior(world.night * 0.9);
}

// ───── 운행 준비 화면 ─────
const sel = { line: null, a: 0, b: 0, loopDir: 1, train: null, tod: 'now' };
const customTrains = () => store.get('trains', []);
function buildRouteUI() {
  const list = $('line-list');
  const render = () => {
    const q = $('line-search').value.trim();
    list.innerHTML = '';
    for (const g of GROUPS) {
      const ls = net.lines.filter(L => L.group === g && (!q || L.name.includes(q) || L.stations.some(s => s.name.includes(q))));
      if (!ls.length) continue;
      list.insertAdjacentHTML('beforeend', `<div class="grp">${g}</div>`);
      for (const L of ls) {
        const b = document.createElement('button'); b.className = 'item' + (sel.line === L ? ' on' : '');
        b.innerHTML = `<i class="dot" style="background:${L.color}"></i><span class="t"><b>${L.name}</b><small>${L.stations[0].name} – ${L.stations[L.stations.length - 1].name} · ${L.stations.length}개 역 · ${(L.length / 1000).toFixed(1)} km</small></span>`;
        b.onclick = () => { sel.line = L; sound.ui(); pickLine(); render(); };
        list.appendChild(b);
      }
    }
  };
  $('line-search').oninput = render;
  sel.line = net.byId.s2; pickLine(); render();
  $('st-a').onchange = () => { sel.a = +$('st-a').value; refreshRoute(); };
  $('st-b').onchange = () => { sel.b = +$('st-b').value; refreshRoute(); };
  $('loop-dir').onclick = e => { const b = e.target.closest('button'); if (!b) return; sel.loopDir = +b.dataset.v; [...$('loop-dir').children].forEach(c => c.classList.toggle('on', c === b)); refreshRoute(); };
  $('tod').onclick = e => { const b = e.target.closest('button'); if (!b) return; sel.tod = b.dataset.v; [...$('tod').children].forEach(c => c.classList.toggle('on', c === b)); };
  $('go').onclick = () => { sound.init(); sound.ui(); startRun(); };
}
function pickLine() {
  const L = sel.line, opts = L.stations.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
  $('st-a').innerHTML = opts; $('st-b').innerHTML = opts;
  sel.a = 0; sel.b = L.loop ? Math.min(L.stations.length - 1, 15) : L.stations.length - 1;
  if (L.id === 's2') { sel.a = L.stations.findIndex(s => s.name === '강남'); sel.b = L.stations.findIndex(s => s.name === '잠실'); sel.loopDir = -1; }
  $('st-a').value = sel.a; $('st-b').value = sel.b;
  $('loop-dir').hidden = !L.loop;
  [...$('loop-dir').children].forEach(c => c.classList.toggle('on', +c.dataset.v === sel.loopDir));
  // 열차 목록
  const tl = $('train-list'); tl.innerHTML = '';
  const all = [...TRAINS, ...customTrains()];
  sel.train = all.find(t => t.id === L.trains[0]) || all[0];
  for (const t of all) {
    const rec = L.trains.includes(t.id), mine = t.id.startsWith('custom');
    const b = document.createElement('button'); b.className = 'item train' + (sel.train === t ? ' on' : '');
    const col = t.stripe === 'line' ? L.color : t.stripe;
    b.innerHTML = `<i class="dot" style="background:${col}"></i><span class="t"><b>${t.name}</b><small>${t.sub || '직접 만든 열차'} · 최고 ${t.maxKmh} km/h · ${t.cars || L.cars}량</small></span>${rec ? '<span class="tag rec">추천</span>' : mine ? '<span class="tag">내 열차</span>' : ''}`;
    b.title = t.desc || '';
    b.onclick = () => { sel.train = t; sound.ui(); [...tl.children].forEach(c => c.classList.toggle('on', c === b)); };
    tl.appendChild(b);
  }
  refreshRoute();
}
function refreshRoute() {
  const L = sel.line, A = L.stations[sel.a], B = L.stations[sel.b];
  if (sel.a === sel.b && !L.loop) { $('route-info').textContent = '출발역과 도착역을 다르게 고르세요'; }
  else {
    let d = L.loop ? ((B.s - A.s) * sel.loopDir + L.length) % L.length : Math.abs(B.s - A.s);
    if (L.loop && d < 1) d = L.length;
    const n = L.loop ? Math.round(((sel.b - sel.a) * sel.loopDir + L.stations.length) % L.stations.length || L.stations.length) + 1 : Math.abs(sel.b - sel.a) + 1;
    $('route-info').textContent = `${A.name} → ${B.name} · ${(d / 1000).toFixed(1)} km · 정차역 ${n}곳 · ${L.max} km/h 노선`;
  }
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const s of L.stations) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  routeMap.fit(x0, z0, x1, z1);
}

// ───── 열차 만들기 ─────
const studio = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(40, 1, 0.5, 2000), yaw: -0.7, pitch: 0.18, dist: 70 };
{
  const S = studio.scene; S.background = new THREE.Color('#1a2129');
  S.add(new THREE.HemisphereLight(0xdfe8f2, 0x30353a, 1.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.6); d.position.set(30, 60, 40); d.castShadow = true; d.shadow.camera.left = d.shadow.camera.bottom = -80; d.shadow.camera.right = d.shadow.camera.top = 80; d.shadow.mapSize.set(2048, 2048); S.add(d);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(220, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.9 })); floor.receiveShadow = true; S.add(floor);
  const rails = new THREE.Mesh(new THREE.BoxGeometry(440, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.9, roughness: 0.3 }));
  for (const z of [-0.75, 0.75]) { const r = rails.clone(); r.position.set(0, 0.08, z); S.add(r); }
}
const straight = { at(s, o = {}) { o.x = s; o.z = 0; o.y = 0; o.hd = 0; o.grade = 0; return o; } };
function formSpec() {
  const f = $('build-form'), v = n => f.elements[n].value;
  const kind = v('kind'), cars = +v('cars'), control = v('control');
  const base = { hsr: { carLen: 19, leadLen: 22.5, m: 46, decel: 2.8, eb: 4.3 }, emu: { carLen: 22.5, leadLen: 23.5, m: 48, decel: 3, eb: 4.5 }, metro: { carLen: 19.5, leadLen: 19.5, m: 36, decel: 3.5, eb: 4.5 }, diesel: { carLen: 23.5, leadLen: 21, m: 50, decel: 2.4, eb: 3.8 } }[kind];
  return {
    id: 'custom-' + (f.dataset.id || Date.now()), name: v('name') || '나의 열차', sub: '직접 만든 열차', kind: kind === 'emu' ? 'emu' : kind, nose: kind === 'diesel' ? 'diesel' : v('nose'), cars,
    carLen: base.carLen, leadLen: base.leadLen, maxKmh: +v('maxKmh'), powerKw: +v('powerKw'), mass: kind === 'diesel' ? 132 + (cars - 1) * 50 : cars * base.m,
    accel: +v('accel'), decel: base.decel, eb: base.eb, control, notches: control === 'one' ? 4 : 8, brakes: 7,
    body: v('body'), stripe: v('stripe'), stripe2: v('stripe2'), loco: v('stripe2'), powerCars: kind === 'diesel' ? [0] : 'all',
    panto: kind === 'diesel' ? [] : [1, Math.max(1, cars - 2)], doors: kind === 'metro' ? 4 : 1, voltage: kind === 'diesel' ? '디젤' : '25kV 60Hz', custom: true,
  };
}
let previewModel = null, previewT = 0;
function buildBuilder() {
  const f = $('build-form');
  $('nose-sel').innerHTML = NOSES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('nose-sel').value = 'sancheon';
  const upd = () => {
    f.elements.carsOut.value = f.elements.cars.value; f.elements.maxOut.value = f.elements.maxKmh.value;
    f.elements.powOut.value = f.elements.powerKw.value; f.elements.accOut.value = (+f.elements.accel.value).toFixed(1);
    clearTimeout(previewT); previewT = setTimeout(rebuildPreview, 120);
  };
  f.oninput = upd; f.onchange = upd;
  $('b-save').onclick = () => {
    const sp = formSpec(); sp.id = 'custom-' + Date.now(); const all = customTrains(); all.push(sp); store.set('trains', all);
    sound.ui(); listMine(); pickLine(); const b = $('b-save').querySelector('b'); b.textContent = '저장됨'; setTimeout(() => b.textContent = '저장', 1500);
  };
  listMine(); rebuildPreview();
  // 회전
  let drag = null;
  canvas.addEventListener('pointerdown', e => { if (screen === 's-build') drag = [e.clientX, e.clientY]; else if (screen === 's-game') look.drag = [e.clientX, e.clientY]; });
  addEventListener('pointermove', e => {
    if (drag) { studio.yaw -= (e.clientX - drag[0]) * 0.006; studio.pitch = clamp(studio.pitch + (e.clientY - drag[1]) * 0.004, 0.02, 1.2); drag = [e.clientX, e.clientY]; }
    if (look.drag) { look.yaw -= (e.clientX - look.drag[0]) * 0.005; look.pitch = clamp(look.pitch - (e.clientY - look.drag[1]) * 0.004, -0.8, 0.6); look.drag = [e.clientX, e.clientY]; }
  });
  addEventListener('pointerup', () => { drag = null; look.drag = null; });
  canvas.addEventListener('wheel', e => { if (screen === 's-build') studio.dist = clamp(studio.dist * Math.exp(e.deltaY * 0.001), 20, 260); else if (screen === 's-game') look.zoom = clamp(look.zoom * Math.exp(e.deltaY * 0.001), 0.3, 4); }, { passive: true });
}
function rebuildPreview() {
  previewModel?.dispose();
  const sp = formSpec(); previewModel = new TrainModel(sp, sp.stripe); previewModel.setPanto(1);
  previewModel.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  studio.scene.add(previewModel.group); previewModel.place(straight, previewModel.length / 2, 1, 0, { x: 0, y: 0 }, 0);
  studio.dist = clamp(previewModel.length * 0.32 + 18, 28, 160);
}
function listMine() {
  const el = $('my-trains'), all = customTrains(); el.innerHTML = all.length ? '' : '<div class="muted small">저장한 열차가 없습니다. 운행 준비 화면의 열차 목록에 나타납니다.</div>';
  all.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<i class="dot" style="background:${t.stripe}"></i><span class="t"><b>${t.name}</b><small>${t.cars}량 · ${t.maxKmh} km/h · ${t.powerKw} kW</small></span><button title="삭제">${ICON.trash}</button>`;
    d.querySelector('button').onclick = () => { all.splice(i, 1); store.set('trains', all); listMine(); pickLine(); };
    el.appendChild(d);
  });
}

// ───── 설정 ─────
let backFromSettings = 's-menu', backFromMap = 's-menu';
function buildSettings() {
  const P = $('q-presets');
  P.innerHTML = Object.entries(QUALITY).map(([k, q]) => `<button data-q="${k}" class="${settings.q === k ? 'on' : ''}">${q.name}</button>`).join('');
  const desc = { low: '최적화 모드: 그림자·빛 번짐을 끄고 해상도와 시야 거리를 줄여 느린 컴퓨터·노트북·휴대폰에서도 부드럽게 달립니다.', mid: '그림자를 켜고 중간 거리까지 지형과 건물을 표시합니다.', high: '실시간 그림자, 빛 번짐(블룸), 계단 현상 제거, 넓은 시야 거리.', ultra: '최고 해상도 그림자와 가장 먼 시야 거리, 더 많은 나무. 고성능 그래픽카드 권장.' };
  const setQ = k => { settings.q = k; store.set('settings', settings); [...P.children].forEach(c => c.classList.toggle('on', c.dataset.q === k)); $('q-desc').textContent = desc[k]; world.setQuality(QUALITY[k]); setupRender(); };
  P.onclick = e => { const b = e.target.closest('button'); if (b) { sound.ui(); setQ(b.dataset.q); } };
  $('q-desc').textContent = desc[settings.q];
  $('opt-fps').checked = settings.fps; $('opt-fps').onchange = e => { settings.fps = e.target.checked; store.set('settings', settings); };
  for (const k of ['master', 'train', 'voice', 'ui']) { const el = $('v-' + k); el.value = settings.vol[k]; el.oninput = () => { settings.vol[k] = +el.value; sound.setVol(k, +el.value); store.set('settings', settings); }; }
  $('set-back').onclick = () => { sound.ui(); go(backFromSettings); if (backFromSettings === 's-game') pause(true); };
  $('help-back').onclick = () => { sound.ui(); go('s-menu'); };
  $('map-back').onclick = () => { sound.ui(); go(backFromMap); };
  $('map-me').onclick = () => { if (game) { bigMap.follow = true; bigMap.mpp = 25; } };
}
function buildLegend() {
  $('map-legend').innerHTML = net.lines.map(L => `<span><i style="background:${L.color}"></i>${L.name}</span>`).join('');
}
function onScreen(id) {
  if (id === 's-map') { if (game) { bigMap.follow = true; bigMap.mpp = 40; } else { bigMap.cx = 20000; bigMap.cz = 20000; bigMap.mpp = Math.max(500, 700000 / innerHeight); } }
  if (id === 's-menu' && game) endRun();
  camera.layers.enable(1);
  document.body.classList.toggle('build', id === 's-build');
}

// ───── 운행 ─────
let game = null;
const look = { yaw: 0, pitch: -0.04, zoom: 1, drag: null };
const VIEWS = ['cab', 'chase', 'orbit', 'side'], VIEW_NAMES = { cab: '운전석', chase: '추적', orbit: '자유', side: '선로변' };
function startRun() {
  const L = sel.line; if (sel.a === sel.b && !L.loop) return hud.msg('출발역과 도착역을 다르게 고르세요', true);
  let spec = { ...sel.train }; if (!spec.cars) spec.cars = L.cars;
  const sim = new Sim(L, spec, sel.a, sel.b, sel.loopDir);
  const model = new TrainModel(spec, L.color); sim.trainLen = model.length;
  world.scene.add(model.group);
  demo.model.group.visible = false;
  const hour = sel.tod === 'now' ? nowHour() : +sel.tod;
  game = { sim, model, line: L, spec, view: 'cab', ready: false, hour, paused: false, side: null, chase: new THREE.Vector3(), lastLim: 0, finT: 0 };
  hud.bind(sim, { lineName: L.name, color: L.color, trainName: spec.name });
  hud.onLever = () => sound.click();
  look.yaw = 0; look.pitch = -0.04;
  world.setTime(hour); sound.init(); sound.startTrain(spec);
  model.setPanto(sim.panto);
  go('s-game');
}
function endRun() {
  if (!game) return;
  game.model.dispose(); sound.stopTrain(); window.speechSynthesis?.cancel();
  game = null; demo.model.group.visible = true; world.setTime(nowHour());
  $('pause').classList.remove('on'); $('result').classList.remove('on');
}
function pause(on) { if (!game) return; game.paused = on; $('pause').classList.toggle('on', on); if (on) sound.ctx?.suspend(); else sound.ctx?.resume(); }
$('p-resume').onclick = () => pause(false);
$('p-quit').onclick = () => { $('pause').classList.remove('on'); go('s-menu'); };
$('p-map').onclick = () => { $('pause').classList.remove('on'); backFromMap = 's-game'; go('s-map'); };
$('p-settings').onclick = () => { $('pause').classList.remove('on'); backFromSettings = 's-game'; go('s-settings'); };
$('r-menu').onclick = () => go('s-menu');
document.querySelector('[data-go="s-settings"]').addEventListener('click', () => backFromSettings = 's-menu');
document.querySelector('[data-go="s-map"]').addEventListener('click', () => backFromMap = 's-menu');

// 버튼
const act = {
  open: () => game.sim.openDoors(), close: () => game.sim.closeDoors(), panto: () => game.sim.togglePanto(),
  light: () => { game.sim.headlight = !game.sim.headlight; sound.click(); },
  view: () => { game.view = VIEWS[(VIEWS.indexOf(game.view) + 1) % VIEWS.length]; game.side = null; look.yaw = 0; look.pitch = game.view === 'cab' ? -0.04 : 0; look.zoom = 1; hud.msg(VIEW_NAMES[game.view] + ' 시점'); },
  map: () => { backFromMap = 's-game'; go('s-map'); }, pause: () => pause(!game.paused),
};
document.querySelectorAll('[data-act]').forEach(b => {
  if (b.dataset.act === 'horn') {
    const on = v => { if (game) game.sim.horn = v; b.classList.toggle('hold', v); };
    b.addEventListener('pointerdown', () => on(true)); b.addEventListener('pointerup', () => on(false)); b.addEventListener('pointerleave', () => on(false));
  } else b.onclick = () => { b.blur(); if (game) act[b.dataset.act](); };
});
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (screen === 's-map' && (e.code === 'KeyM' || e.code === 'Escape')) { go(backFromMap); return; }
  if (screen !== 's-game' || !game) return;
  const s = game.sim, k = e.code;
  if (k === 'Escape') return pause(!game.paused);
  if (k === 'Space' || k === 'Enter') { e.preventDefault(); document.activeElement?.blur?.(); }
  if (game.paused) return;
  if (e.repeat && !['KeyW', 'KeyS', 'KeyE', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(k)) return;
  const m = {
    KeyW: () => s.powerUp(), ArrowUp: () => s.powerUp(), KeyS: () => s.powerDown(), ArrowDown: () => s.powerDown(),
    KeyE: () => s.brakeUp(), KeyD: () => s.brakeDown(), Backspace: () => s.emergency(), KeyN: () => s.neutral(),
    KeyF: () => s.revFwd(), KeyR: () => s.revBack(), KeyO: act.open, KeyC: act.close, KeyP: act.panto, KeyL: act.light,
    KeyH: () => s.horn = true, KeyV: act.view, KeyM: act.map, Tab: () => document.body.classList.toggle('desk-off'),
  }[k];
  if (m) { e.preventDefault(); m(); }
});
addEventListener('keyup', e => { if (e.code === 'KeyH' && game) game.sim.horn = false; });

function handleEvents(sim) {
  for (const ev of sim.events) {
    switch (ev.type) {
      case 'msg': hud.msg(ev.data, true); break;
      case 'click': sound.click(); break;
      case 'clunk': sound.clunk(); break;
      case 'airRelease': sound.air(); break;
      case 'doorOpen': sound.doorOpen(); break;
      case 'doorClose': sound.doorClose(); break;
      case 'atc': sound.atc(); hud.msg(`${sim.sys} 제한속도 초과 — 자동 제동`, true); break;
      case 'vcb': sound.clunk(); hud.msg('주차단기 투입'); break;
      case 'panto': sound.clunk(); hud.msg(ev.data ? '팬터그래프 상승' : '팬터그래프 하강'); break;
      case 'engineStart': sound.engineStart(); hud.msg('엔진 시동'); break;
      case 'engineStop': hud.msg('엔진 정지'); break;
      case 'announce': sound.announce(ev.data); hud.msg(ev.data); break;
      case 'arrive': hud.msg(`${ev.data.name} 정차 — 정지 위치 오차 ${ev.data.err.toFixed(1)} m (${ev.data.grade})`); break;
      case 'finish': game.finT = 4; break;
    }
  }
  sim.events.length = 0;
}
function showResult(sim) {
  const rows = sim.stops.map(s => `<tr><td>${s.name}</td><td>${s.err == null ? '-' : s.err.toFixed(1) + ' m'}</td><td>${s.grade}</td></tr>`).join('');
  const t = sim.t;
  $('result-body').innerHTML = `<p>${game.line.name} · ${game.spec.name}<br>${sim.route[0].name} → ${sim.route[sim.route.length - 1].name}</p>
    <p>운행 시간 <b>${Math.floor(t / 60)}분 ${Math.floor(t % 60)}초</b> · 주행 거리 <b>${(sim.odo / 1000).toFixed(1)} km</b> · ${sim.sys} 개입 <b>${sim.atcCount}회</b></p><table>${rows}</table>`;
  $('result').classList.add('on');
}

// 앞쪽 제한속도 찾기
function nextLimit(sim) {
  const L = sim.line, cur = sim.atc; let best = null;
  for (let d = 50; d < 3000; d += 50) { const v = L.limitAt(sim.s + sim.dir * d); if (v < cur - 4) { best = { d, v }; break; } }
  return best;
}

// 카메라
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
function updateCamera(dt) {
  const { sim, model } = game, o = world.origin, L = sim.line, F = L.at(sim.s);
  const fwd = new THREE.Vector3(Math.cos(F.hd) * sim.dir, 0, Math.sin(F.hd) * sim.dir);
  if (game.view === 'cab') {
    const car = model.cars[0].g; car.updateMatrixWorld();
    _v.set(model.cab.x, model.cab.y, model.cab.z).applyMatrix4(car.matrixWorld);
    camera.position.copy(_v);
    car.getWorldQuaternion(_q);
    _e.set(look.pitch, -Math.PI / 2 + look.yaw, 0); camera.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromEuler(_e));
    camera.fov = 62 / look.zoom;
  } else {
    camera.fov = 55;
    const mid = L.at(sim.s - sim.dir * model.length * 0.3);
    const tgt = new THREE.Vector3(mid.x - o.x, mid.y + 2.5, mid.z - o.y);
    if (game.view === 'chase') {
      const sd = sim.lat < 0 ? -1 : 1, r = 40 * look.zoom, a = Math.atan2(-fwd.z, -fwd.x) - 0.26 * sd - look.yaw, hgt = Math.max(2, (7 - look.pitch * 40) * look.zoom);
      const c = new THREE.Vector3(F.x - o.x, F.y + 2, F.z - o.y);
      camera.position.set(c.x + Math.cos(a) * r, c.y + hgt, c.z + Math.sin(a) * r);
      camera.lookAt(c.x - Math.cos(a) * 25, c.y, c.z - Math.sin(a) * 25);
    } else if (game.view === 'orbit') {
      const r = 60 * look.zoom, a = -look.yaw + Math.atan2(fwd.z, fwd.x) + Math.PI, p = clamp(0.35 - look.pitch, 0.03, 1.4);
      camera.position.set(tgt.x + Math.cos(a) * Math.cos(p) * r, tgt.y + Math.sin(p) * r, tgt.z + Math.sin(a) * Math.cos(p) * r);
      camera.lookAt(tgt);
    } else {
      if (!game.side || sim.dist(game.side.s) < -250) {
        const s = sim.s + sim.dir * (350 + Math.abs(sim.v) * 6), P = L.at(s), sd = Math.random() < 0.5 ? -1 : 1;
        const x = P.x - Math.sin(P.hd) * sd * 22, z = P.z + Math.cos(P.hd) * sd * 22;
        game.side = { s, x, z, y: Math.max(terrain.height(x, z) + 1.7, P.y + 1.5) };
      }
      camera.position.set(game.side.x - o.x, game.side.y, game.side.z - o.y);
      const front = L.at(sim.s - sim.dir * 15); camera.lookAt(front.x - o.x, front.y + 2, front.z - o.y);
      camera.rotateY(look.yaw); camera.rotateX(look.pitch);
    }
    const gh = terrain.height(camera.position.x + o.x, camera.position.z + o.y) + 1.5;
    if (camera.position.y < gh && !sim.inTunnel) camera.position.y = gh;
  }
  camera.updateProjectionMatrix();
}

// ───── 루프 ─────
let last = performance.now(), fpsAcc = 0, fpsN = 0, timeAcc = 0, under = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!world || !demo.line) return;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = settings.fps ? Math.round(fpsN / fpsAcc) + ' FPS' : ''; fpsAcc = 0; fpsN = 0; }
  if (screen === 's-build' && previewModel) {
    const c = studio.cam; c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix();
    const tx = innerWidth > 900 ? -previewModel.length * 0.12 : 0;
    c.position.set(Math.cos(studio.yaw) * Math.cos(studio.pitch) * studio.dist + tx, Math.sin(studio.pitch) * studio.dist + 2, Math.sin(studio.yaw) * Math.cos(studio.pitch) * studio.dist);
    c.lookAt(tx, 2, 0);
    renderer.render(studio.scene, c); return;
  }
  let focus = demo.focus;
  if (game && (screen === 's-game' || screen === 's-map' || screen === 's-settings')) {
    const { sim, model } = game;
    if (!game.ready) { const P0 = sim.line.at(sim.s); game.ready = !world.jobs.length && world.center === Math.floor(P0.x / 2000) + ',' + Math.floor(P0.z / 2000); if (!game.ready) hud.msg(`주변 지형을 만드는 중… 남은 구역 ${world.jobs.length}`); }
    if (game.ready && !game.paused) {
      const steps = Math.ceil(dt / 0.02); for (let i = 0; i < steps; i++) sim.update(dt / steps);
      handleEvents(sim);
      game.hour += dt / 3600; timeAcc += dt; if (timeAcc > 3) { timeAcc = 0; world.setTime(game.hour); }
      if (game.finT > 0) { game.finT -= dt; if (game.finT <= 0) showResult(sim); }
    }
    const P = sim.line.at(sim.s); focus = new THREE.Vector3(P.x, P.y, P.z);
    model.place(sim.line, sim.s, sim.dir, sim.lat, world.origin, sim.odo / 0.43);
    model.setPanto(sim.panto);
    model.setDirLights(sim.headlight);
    const dark = Math.max(world.night, under);
    model.setHeadlight(sim.headlight && dark > 0.3 ? 4000 * dark : 0); model.setInterior(Math.max(world.night, sim.inTunnel ? 0.7 : 0) * 0.9);
    updateCamera(dt);
    // 지하 들어가면 햇빛 줄이기
    under += ((game.view === 'cab' && sim.inTunnel ? 1 : 0) - under) * Math.min(1, dt * 1.5);
    if (game.view === 'cab' && sim.deepUnder) camera.layers.disable(1); else camera.layers.enable(1);
    sound.update(sim, dt, game.view === 'cab' ? 0 : 1);
    if (screen === 's-game') {
      const hh = Math.floor(game.hour) % 24, mm = Math.floor((game.hour % 1) * 60);
      hud.update(dt, sim, { clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, nextLim: nextLimit(sim) });
      $('clock-ic').innerHTML = world.night > 0.5 ? ICON.moon : ICON.sun;
      miniMap.cx = P.x; miniMap.cz = P.z; miniMap.draw({ train: { x: P.x, z: P.z, hd: P.hd + (sim.dir < 0 ? Math.PI : 0) }, hl: sim.line.id });
    }
    if (screen === 's-map') bigMap.draw({ train: { x: P.x, z: P.z, hd: P.hd + (sim.dir < 0 ? Math.PI : 0) } });
  } else {
    updateDemo(dt); under *= 0.9;
    if (screen === 's-map') bigMap.draw({});
    if (screen === 's-route') routeMap.draw({ hl: sel.line?.id, route: [sel.line?.stations[sel.a], sel.line?.stations[sel.b]] });
  }
  world.update(dt, focus.x, focus.y, focus.z, camera, game && !game.ready ? 30 : 6);
  // 지하 조명 보정
  world.sun.intensity *= 1 - under * 0.95; world.hemi.intensity *= 1 - under * 0.7;
  world.scene.environmentIntensity *= 1 - under * 0.8;
  if (screen === 's-map') return;
  composer ? composer.render() : renderer.render(world.scene, camera);
  world.sun.intensity /= 1 - under * 0.95; world.hemi.intensity /= 1 - under * 0.7; world.scene.environmentIntensity /= 1 - under * 0.8;
}
requestAnimationFrame(frame);
boot().catch(e => { console.error(e); $('load-text').textContent = '불러오기 실패: ' + e.message; });
