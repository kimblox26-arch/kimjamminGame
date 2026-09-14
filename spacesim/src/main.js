// SpaceSim — 애플리케이션 진입점
// 시뮬레이션 상태, 렌더 루프, UI 바인딩.

import { NBody } from './physics/nbody.js';
import { elementsFromState, sampleOrbit, hillRadius, stateFromElements } from './physics/kepler.js';
import { SCENARIOS, loadScenario, getScenario } from './sim/scenarios.js';
import { View } from './render/view.js';
import { Overlay, drawConservation, drawDistribution } from './render/overlay.js';
import { StarPanel, CosmoPanel, renderUnitTable } from './ui/tools.js';
import {
  fmt, fmtDuration, julianToDate, auday2kms, clamp,
  KM_PER_AU, MSUN_PER_MEARTH, MSUN_PER_MJUP,
} from './core/constants.js';
import { blackbodyHex } from './astro/stars.js';
import { daysSinceJ2000, KIRKWOOD } from './data/bodies.js';

const $ = (id) => document.getElementById(id);

const sim = new NBody({ capacity: 2048 });
const view = new View($('gl'));
const overlay = new Overlay($('overlay'));

const state = {
  running: false,
  // rate = 실제 1초당 진행할 시뮬레이션 시간.
  // 천문 시나리오는 '시뮬레이션 초', 코드단위 시나리오는 '코드 시간단위'.
  // 따라서 rate = 1 이면 정확히 실시간이다.
  rate: 1,
  dt: 0.5,
  maxSteps: 400,
  maxDt: 1,        // 안정성 한계 (가장 짧은 공전주기에서 유도)
  lag: 1,          // 실제로 따라간 비율
  debt: 0,         // 아직 진행하지 못한 시뮬레이션 시간 (누적)
  autoDt: true,
  launchMode: false,
  launch: null,
  selected: -1,
  epoch: 0,               // J2000 이후 경과일 — 실측 궤도요소 초기화 시점
  frameMode: 'none',      // none | com | body
  frameBody: -1,
  scenario: SCENARIOS[0],
  cons: [],
  fps: 0,
  lastUI: 0,
  filter: '',
  panels: { left: window.innerWidth > 860, right: window.innerWidth > 860 },
};

// ───────────────────────── 시간 배율 ─────────────────────────

const RATE_UNITS = [
  [3155760000, '100년'], [315576000, '10년'], [31557600, '년'], [2629800, '달'],
  [604800, '주'], [86400, '일'], [3600, '시간'], [60, '분'], [1, '초'],
];

/** 배율을 사람이 읽는 문구로 — 1× 는 실시간 */
function rateLabel(r) {
  if (!isAstro()) return `${fmt(r, 3)} u/초`;
  if (Math.abs(r - 1) < 1e-9) return '실시간 (1초/초)';
  for (const [sec, name] of RATE_UNITS) {
    if (r >= sec * 0.9995) {
      const v = r / sec;
      return `${v >= 100 ? v.toFixed(0) : fmt(v, 3)} ${name}/초`;
    }
  }
  return `${fmt(r, 3)} 초/초`;
}

/**
 * 안정적으로 쓸 수 있는 최대 Δt — 계에서 가장 짧은 공전주기의 1/150.
 * 이 값을 넘기면 근접 천체의 궤도가 수치적으로 무너진다.
 */
function computeMaxDt() {
  const prim = sim.primaryIndex();
  let minP = Infinity;
  if (prim >= 0) {
    for (let i = 0; i < sim.count; i++) {
      if (!sim.active[i] || i === prim) continue;
      const ref = referenceFor(i);
      if (ref < 0 || ref === i) continue;
      const rel = sim.relative(i, ref);
      const el = elementsFromState(rel.mu, rel.r, rel.v);
      if (isFinite(el.period) && el.period > 0 && el.period < minP) minP = el.period;
    }
  }
  if (!isFinite(minP)) minP = (state.scenario.dt ?? 0.5) * 400;
  return Math.max(1e-7, minP / 150);
}

// ───────────────────────── 부팅 ─────────────────────────

const BOOT = [
  '중력 커널 초기화', '적분기 컴파일', '천체 카탈로그 로드',
  '셰이더 링크', 'J2000 궤도요소 계산', '준비 완료',
];
let bootStep = 0;
function boot() {
  $('boot-msg').textContent = BOOT[bootStep];
  $('boot-fill').style.width = `${((bootStep + 1) / BOOT.length) * 100}%`;
  bootStep++;
  if (bootStep < BOOT.length) return setTimeout(boot, 130);
  setTimeout(() => {
    $('boot').classList.add('gone');
    state.running = true;
    syncPlayButton();
  }, 320);
}

// ───────────────────────── 시나리오 ─────────────────────────

function buildScenarioList() {
  const el = $('scenario-list');
  el.innerHTML = '';
  let group = null;
  for (const sc of SCENARIOS) {
    if (sc.group !== group) {
      group = sc.group;
      const g = document.createElement('div');
      g.className = 'sc-group';
      g.textContent = group;
      el.appendChild(g);
    }
    const b = document.createElement('button');
    b.className = 'sc-item';
    b.textContent = sc.name;
    b.dataset.id = sc.id;
    b.addEventListener('click', () => selectScenario(sc.id));
    el.appendChild(b);
  }
}

function selectScenario(id) {
  const sc = getScenario(id);
  state.scenario = sc;
  loadScenario(sim, sc, { epoch: sc.epochAware ? state.epoch : 0 });
  $('epoch-row').classList.toggle('off', !sc.epochAware);
  $('v-epoch').textContent = sc.epochAware ? julianToDate(state.epoch) : '';

  for (const b of document.querySelectorAll('.sc-item')) {
    b.classList.toggle('active', b.dataset.id === id);
  }
  $('scenario-desc').textContent = sc.desc;

  // 렌더 설정
  state.lengthUnit = sc.units?.length === 'AU' ? 'AU' : 'u';
  view.scaleMode = sc.scale ?? 'linear';
  view.unit = 1;
  view.logRef = sc.camera > 20 ? 0.05 : Math.max(1e-6, sc.camera * 0.004);
  // 로그 스케일에서는 압축된 반경 전체가 화면에 들어오도록 여유를 둔다
  view.spherical.radius = view.mapDistance(sc.camera ?? 30) * (view.scaleMode === 'log' ? 2.2 : 1);
  view.bodyScale = sc.bodyScale ?? autoBodyScale();
  $('in-bodyscale').value = Math.log10(view.bodyScale);
  view.target.set(0, 0, 0);
  view.focusIndex = -1;
  view.follow = false;
  view.origin = [0, 0, 0];
  view.assignTrails(sim);
  view.clearTrails();

  // 적분 설정 UI 동기화
  state.dt = sc.dt ?? 0.5;
  state.maxDt = computeMaxDt();
  // 시간 배율 슬라이더 범위는 단위계에 따라 다르다
  const astro = sc.units?.length === 'AU';
  $('in-speed').min = astro ? 0 : -2;
  $('in-speed').max = astro ? 9.7 : 2.5;
  $('rate-chips').style.display = astro ? '' : 'none';
  state.rate = sc.rate ?? (astro ? 86400 : 1);
  $('in-speed').value = Math.log10(state.rate);
  state.selected = sim.count > 1 ? 1 : 0;
  state.frameMode = 'none';
  state.frameBody = sim.primaryIndex();
  state.cons.length = 0;
  state.debt = 0;
  state.filter = '';
  $('body-filter').value = '';

  $('in-integrator').value = sim.integrator;
  $('in-dt').value = Math.log10(state.dt);
  $('in-soft').value = Math.log10(Math.max(1e-7, sim.softening));
  $('in-bh').checked = sim.useBarnesHut;
  $('in-pn').checked = sim.relativistic;
  $('in-col').checked = sim.collisions;
  $('in-theta').value = sim.theta;
  $('in-scale').value = view.scaleMode;
  $('in-com').checked = false;
  $('in-frag').checked = sim.fragmentation;
  $('in-roche').checked = sim.rocheBreakup;
  $('in-auto').checked = state.autoDt;
  $('in-sub').value = Math.log10(state.maxSteps);
  view.clearPreview();
  state.launch = null;
  refreshSliderLabels();
  renderBodyList();
  renderUnitTable(sim);
  toast(`${sc.name} — 천체 ${sim.activeCount()}개`);
}

/**
 * 가장 큰 천체가 화면에서 적절한 크기를 차지하도록 표시 배율을 자동 산출.
 * 시나리오마다 실제 반지름 규모가 10⁶ 배 넘게 차이나므로 고정값은 쓸 수 없다.
 */
function autoBodyScale() {
  let maxR = 0;
  for (let i = 0; i < sim.count; i++) {
    if (!sim.active[i]) continue;
    const i3 = i * 3;
    const d = Math.hypot(sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2]);
    const r = sim.radius[i] * view.localScale(d) * (sim.meta[i].drawScale || 1);
    if (r > maxR) maxR = r;
  }
  if (!(maxR > 0)) return 1;
  return clamp(0.010 * view.spherical.radius / maxR, 0.05, 400);
}

// ───────────────────────── 루프 ─────────────────────────

let lastT = performance.now();
let fpsAcc = 0, fpsN = 0;
let costMs = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const wall = (now - lastT) / 1000;          // 실제 경과 (캡 없음)
  const dtReal = Math.min(0.5, wall);         // 탭 복귀 시 폭주 방지
  lastT = now;
  fpsAcc += dtReal; fpsN++;
  if (fpsAcc > 0.4) { state.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  let stepsDone = 0;
  if (state.running) {
    // 실제 경과시간 × 배율 = 이번 프레임에 진행해야 할 시뮬레이션 시간.
    // 한 프레임에 정수 스텝만 돌 수 있으므로 남는 시간은 debt 에 쌓아 다음 프레임에 갚는다.
    const need = isAstro() ? (state.rate * dtReal) / 86400 : state.rate * dtReal;
    state.debt += need;
    if (state.autoDt) {
      // 프레임당 40 스텝 정도를 목표로 하되 안정성 한계를 넘지 않는다
      state.dt = clamp(need / 40, state.maxDt * 1e-6, state.maxDt);
      $('in-dt').value = Math.log10(state.dt);
    }
    const want = state.debt / state.dt;
    const target = Math.min(Math.floor(want), state.maxSteps);
    // 물리 예산은 프레임 시간에 비례 — 느린 기기에서도 같은 비율을 쓴다
    const budget = performance.now() + clamp(dtReal * 1000 * 0.55, 6, 22);
    const t0 = performance.now();
    // 궤적은 프레임당 여러 번 표본화해야 짧은 주기 궤도가 다각형으로 보이지 않는다
    const recEvery = Math.max(1, Math.ceil(target / 12));
    for (let k = 0; k < target; k++) {
      sim.step(state.dt);
      stepsDone++;
      if (k % recEvery === 0) view.recordTrails(sim);
      if (performance.now() > budget) break; // 프레임률 보호
    }
    costMs = costMs * 0.85 + (performance.now() - t0) * 0.15;
    const advanced = stepsDone * state.dt;
    state.debt -= advanced;
    // 실시간 대비 = 실제로 진행한 시뮬레이션 시간 ÷ 배율이 요구한 시간.
    // 프레임률 한계와 예산 중단이 모두 여기에 반영된다.
    const ideal = isAstro() ? (state.rate * wall) / 86400 : state.rate * wall;
    if (ideal > 0) state.lag = state.lag * 0.8 + clamp(advanced / ideal, 0, 1) * 0.2;
    // 따라잡을 수 없는 빚은 버린다 (무한 누적 방지)
    const carry = need * 1.5 + state.dt;
    if (state.debt > carry) state.debt = carry;
    if (state.debt < 0) state.debt = 0;
  }
  state.stepsPerFrame = stepsDone;

  updateOrigin();
  view.updateCamera(sim);   // 구체 LOD 계산에 카메라 위치가 필요하다
  view.updateBodies(sim);
  view.sync(sim);
  updateOrbitPreview();
  if (now - orbitTimer > 180) { orbitTimer = now; updateAllOrbits(); }
  updateTails();
  view.render();
  overlay.draw(sim, view, state);

  if (now - state.lastUI > 120) {
    state.lastUI = now;
    updateReadouts();
    updateInspector();
    updateDiagnostics();
  }
}

function updateOrigin() {
  if (state.frameMode === 'com') {
    view.origin = sim.centerOfMass();
  } else if (state.frameMode === 'body' && state.frameBody >= 0 && sim.active[state.frameBody]) {
    const i3 = state.frameBody * 3;
    view.origin = [sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2]];
  } else {
    view.origin = [0, 0, 0];
  }
}

function updateOrbitPreview() {
  if (!view.showOrbits || state.selected < 0 || !sim.active[state.selected]) {
    view.setOrbit(null);
    return;
  }
  const ref = referenceFor(state.selected);
  if (ref < 0 || ref === state.selected) { view.setOrbit(null); return; }
  const rel = sim.relative(state.selected, ref);
  const pts = sampleOrbit(rel.mu, rel.r, rel.v, 192);
  const r3 = ref * 3;
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] += sim.pos[r3];
    pts[i + 1] += sim.pos[r3 + 1];
    pts[i + 2] += sim.pos[r3 + 2];
  }
  view.setOrbit(pts);
}

let orbitTimer = 0;

/** 모든 주요 천체의 궤도선 — 현재 상태벡터에서 케플러 궤도를 풀어 그린다 */
function updateAllOrbits() {
  if (!view.showAllOrbits) { view.setAllOrbits([]); return; }
  const list = [];
  const prim = sim.primaryIndex();
  for (let i = 0; i < sim.count && list.length < 56; i++) {
    if (!sim.active[i] || i === prim) continue;
    const t = sim.meta[i].type;
    if (t === 'dust' || t === 'debris') continue;
    const ref = referenceFor(i);
    if (ref < 0 || ref === i) continue;
    const rel = sim.relative(i, ref);
    const el = elementsFromState(rel.mu, rel.r, rel.v);
    if (!isFinite(el.a) || el.a === 0) continue;
    const pts = sampleOrbit(rel.mu, rel.r, rel.v, 128);
    if (pts.length < 6) continue;
    const r3 = ref * 3;
    for (let k = 0; k < pts.length; k += 3) {
      pts[k] += sim.pos[r3];
      pts[k + 1] += sim.pos[r3 + 1];
      pts[k + 2] += sim.pos[r3 + 2];
    }
    list.push({
      pts, color: sim.meta[i].color,
      opacity: i === state.selected ? 0.6 : el.e < 1 ? 0.2 : 0.34,
    });
  }
  view.setAllOrbits(list);
}

/** 혜성 꼬리 — 태양에 가까울수록 길어진다 */
function updateTails() {
  if (!view.showTails || !isAstro()) { view.setTails([]); return; }
  const star = sim.primaryIndex();
  if (star < 0 || sim.mass[star] < 0.02) { view.setTails([]); return; }
  const s3 = star * 3;
  const sun = [sim.pos[s3], sim.pos[s3 + 1], sim.pos[s3 + 2]];
  const out = [];
  for (let i = 0; i < sim.count && out.length < 8; i++) {
    if (!sim.active[i]) continue;
    const d = sim.meta[i].data;
    if (!d || d.type !== 'comet') continue;
    const i3 = i * 3;
    const r = Math.hypot(sim.pos[i3] - sun[0], sim.pos[i3 + 1] - sun[1], sim.pos[i3 + 2] - sun[2]);
    if (r > 3.2) continue;                       // 이 밖에서는 승화가 거의 없다
    const len = 0.14 * Math.pow(3.2 / Math.max(r, 0.1), 1.7);
    out.push({
      pos: [sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2]],
      vel: [sim.vel[i3], sim.vel[i3 + 1], sim.vel[i3 + 2]],
      sun, len: Math.min(len, 0.9),
    });
  }
  view.setTails(out);
}

/** 선택 천체의 궤도 기준 천체 — 부모가 있으면 부모, 없으면 최대 질량 */
function referenceFor(i) {
  const m = sim.meta[i];
  if (m.parent) {
    const p = sim.meta.findIndex((x) => x && x.name === m.parent);
    if (p >= 0 && sim.active[p]) return p;
  }
  if (state.frameMode === 'body' && state.frameBody !== i && sim.active[state.frameBody]) {
    return state.frameBody;
  }
  const p = sim.primaryIndex();
  return p === i ? -1 : p;
}

// ───────────────────────── 샌드박스 도구 ─────────────────────────

/** 던질 수 있는 천체 — 질량[M☉], 반지름[km] 모두 실제값 */
const LAUNCH_KINDS = [
  { id: 'asteroid', name: '소행성 (지름 20 km)', mass: 5.0e-18, R: 10, color: 0x9a8b78, type: 'planet' },
  { id: 'ceres', name: '세레스급 (940 km)', mass: 4.723e-10, R: 470, color: 0x8c8377, type: 'planet' },
  { id: 'moon', name: '달 (1737 km)', mass: 3.694e-8, R: 1737, color: 0xc8c8c8, type: 'moon' },
  { id: 'mars', name: '화성형 행성', mass: 3.227e-7, R: 3390, color: 0xd1603d, type: 'planet' },
  { id: 'earth', name: '지구형 행성', mass: 3.003e-6, R: 6371, color: 0x4f9dea, type: 'planet' },
  { id: 'superearth', name: '슈퍼지구 (5 M⊕)', mass: 1.502e-5, R: 10200, color: 0x6aa9c9, type: 'planet' },
  { id: 'neptune', name: '해왕성형 행성', mass: 5.151e-5, R: 24622, color: 0x4062d6, type: 'planet' },
  { id: 'jupiter', name: '목성형 행성', mass: 9.548e-4, R: 69911, color: 0xd9b48f, type: 'planet' },
  { id: 'browndwarf', name: '갈색왜성 (40 M♃)', mass: 0.0382, R: 68000, color: 0x9c4a30, type: 'star', glow: 0.35, T: 1200 },
  { id: 'redwarf', name: '적색왜성 (0.3 M☉)', mass: 0.3, R: 208800, color: 0, type: 'star', glow: 0.9, T: 3400 },
  { id: 'sunlike', name: '태양형 항성 (1 M☉)', mass: 1, R: 695700, color: 0, type: 'star', glow: 1, T: 5772 },
  { id: 'bluegiant', name: '청색거성 (15 M☉)', mass: 15, R: 4.2e6, color: 0, type: 'star', glow: 1.2, T: 25000 },
  { id: 'whitedwarf', name: '백색왜성 (0.6 M☉)', mass: 0.6, R: 8600, color: 0, type: 'star', glow: 0.7, T: 15000 },
  { id: 'neutron', name: '중성자별 (1.4 M☉)', mass: 1.4, R: 11, color: 0xdff0ff, type: 'star', glow: 1.3 },
  { id: 'bh', name: '블랙홀 (10 M☉)', mass: 10, R: 29.5, color: 0x1a0524, type: 'bh', glow: 1.5 },
];

function launchKind() {
  const k = LAUNCH_KINDS.find((x) => x.id === $('in-launch-kind').value) ?? LAUNCH_KINDS[4];
  return { ...k, color: k.color || blackbodyHex(k.T ?? 5772) };
}

/** 드래그 시작/현재 위치로부터 초기 상태를 계산 */
function launchState(from, to) {
  const prim = sim.primaryIndex();
  if (prim < 0) return null;
  const p3 = prim * 3;
  const rx = from[0] - sim.pos[p3], ry = from[1] - sim.pos[p3 + 1], rz = from[2] - sim.pos[p3 + 2];
  const r = Math.hypot(rx, ry, rz);
  if (!(r > 0)) return null;
  // 평균운동 n 을 배율로 쓰면 '중심까지 거리만큼 드래그 = 원궤도 속도' 가 된다
  const n = Math.sqrt(sim.G * sim.mass[prim] / (r * r * r));
  const v = [(to[0] - from[0]) * n, (to[1] - from[1]) * n, (to[2] - from[2]) * n];
  return {
    prim, r,
    rel: [rx, ry, rz],
    vel: v,
    absVel: [v[0] + sim.vel[p3], v[1] + sim.vel[p3 + 1], v[2] + sim.vel[p3 + 2]],
    mu: sim.G * sim.mass[prim],
    vCirc: Math.sqrt(sim.G * sim.mass[prim] / r),
  };
}

function updateLaunchPreview() {
  const L = state.launch;
  if (!L || !L.to) { view.clearPreview(); $('launch-hint').classList.remove('on'); return; }
  const st = launchState(L.from, L.to);
  if (!st) { view.clearPreview(); return; }
  const pts = sampleOrbit(st.mu, st.rel, st.vel, 192);
  const p3 = st.prim * 3;
  for (let k = 0; k < pts.length; k += 3) {
    pts[k] += sim.pos[p3]; pts[k + 1] += sim.pos[p3 + 1]; pts[k + 2] += sim.pos[p3 + 2];
  }
  view.setPreview(pts, L.from, L.to);

  const el = elementsFromState(st.mu, st.rel, st.vel);
  const sp = Math.hypot(...st.vel);
  const hint = $('launch-hint');
  hint.classList.add('on');
  hint.style.left = `${L.sx}px`;
  hint.style.top = `${L.sy}px`;
  hint.textContent =
    `${launchKind().name}\n` +
    `속도 ${fmt(auday2kms(sp), 4)} km/s  (원궤도의 ${fmt(sp / st.vCirc, 3)}배)\n` +
    (el.e < 1
      ? `a ${fmt(el.a, 4)} AU · e ${el.e.toFixed(4)} · P ${fmtDuration(el.period)}`
      : `쌍곡선 궤도 (e ${el.e.toFixed(4)}) — 탈출`);
}

function commitLaunch() {
  const L = state.launch;
  state.launch = null;
  view.clearPreview();
  $('launch-hint').classList.remove('on');
  if (!L || !L.to) return;
  const st = launchState(L.from, L.to);
  if (!st) return;
  const k = launchKind();
  const i = sim.add({
    name: `${k.name.split(' (')[0]} ${sim.count}`,
    mass: k.mass, radius: k.R / KM_PER_AU,
    pos: L.from, vel: st.absVel,
    color: k.color, type: k.type, glow: k.glow ?? 0, temperature: k.T ?? null,
  });
  sim._primed = false;
  sim.markBaseline();
  state.cons.length = 0;
  state.maxDt = computeMaxDt();
  view.assignTrails(sim);
  select(i);
  const el = elementsFromState(st.mu, st.rel, st.vel);
  toast(el.e < 1
    ? `${k.name} 투입 — a ${fmt(el.a, 3)} AU, e ${el.e.toFixed(4)}`
    : `${k.name} 투입 — 탈출 궤도 (e ${el.e.toFixed(4)})`);
}

/** 선택 천체 실시간 편집 */
function applyEdit() {
  const i = state.selected;
  if (i < 0 || !sim.active[i]) return;
  const fm = Math.pow(10, parseFloat($('in-emass').value));
  const fr = Math.pow(10, parseFloat($('in-eradius').value));
  const fv = parseFloat($('in-evel').value);
  const ref = referenceFor(i);
  sim.mass[i] *= fm;
  sim.radius[i] *= fr;
  if (ref >= 0 && Math.abs(fv - 1) > 1e-6) {
    // 기준 천체에 대한 상대속도만 배율을 적용한다
    const i3 = i * 3, r3 = ref * 3;
    for (let k = 0; k < 3; k++) {
      sim.vel[i3 + k] = sim.vel[r3 + k] + (sim.vel[i3 + k] - sim.vel[r3 + k]) * fv;
    }
  }
  if (fm !== 1) sim.meta[i].data = null;   // 더 이상 실측 천체가 아니다
  sim._primed = false;
  sim.markBaseline();
  state.cons.length = 0;
  state.maxDt = computeMaxDt();
  resetEditSliders();
  toast(`${sim.meta[i].name} — 질량 ×${fmt(fm, 3)}, 반지름 ×${fmt(fr, 3)}, 속도 ×${fmt(fv, 3)}`);
}

/** 기준 천체에 대한 원궤도로 만든다 */
function circularize() {
  const i = state.selected;
  if (i < 0 || !sim.active[i]) return;
  const ref = referenceFor(i);
  if (ref < 0 || ref === i) return;
  const rel = sim.relative(i, ref);
  const r = Math.hypot(...rel.r);
  const h = [
    rel.r[1] * rel.v[2] - rel.r[2] * rel.v[1],
    rel.r[2] * rel.v[0] - rel.r[0] * rel.v[2],
    rel.r[0] * rel.v[1] - rel.r[1] * rel.v[0],
  ];
  const hm = Math.hypot(...h);
  if (!(r > 0) || !(hm > 0)) return;
  // 궤도면을 유지한 채 접선 방향 원궤도 속도로 교체
  const t = [
    (h[1] * rel.r[2] - h[2] * rel.r[1]) / (hm * r),
    (h[2] * rel.r[0] - h[0] * rel.r[2]) / (hm * r),
    (h[0] * rel.r[1] - h[1] * rel.r[0]) / (hm * r),
  ];
  const vc = Math.sqrt(rel.mu / r);
  const i3 = i * 3, r3 = ref * 3;
  for (let k = 0; k < 3; k++) sim.vel[i3 + k] = sim.vel[r3 + k] + t[k] * vc;
  sim._primed = false;
  sim.markBaseline();
  state.cons.length = 0;
  toast(`${sim.meta[i].name} 을(를) ${sim.meta[ref].name} 기준 원궤도로 (${fmt(auday2kms(vc), 4)} km/s)`);
}

function resetEditSliders() {
  $('in-emass').value = 0; $('v-emass').textContent = '1.00';
  $('in-eradius').value = 0; $('v-eradius').textContent = '1.00';
  $('in-evel').value = 1; $('v-evel').textContent = '1.00';
}

// ───────────────────────── 리드아웃 ─────────────────────────

function isAstro() {
  return state.scenario.units?.length === 'AU';
}

function updateReadouts() {
  $('ro-time').textContent = isAstro() ? julianToDate(sim.time) : fmt(sim.time, 5);
  $('ro-elapsed').textContent = isAstro() ? fmtDuration(sim.time) : `${fmt(sim.time, 4)} u`;
  $('ro-count').textContent = `${sim.activeCount()}${sim.mergeEvents ? ` (−${sim.mergeEvents})` : ''}`;
  const err = sim.conservationError();
  $('ro-err').textContent = err.energy.toExponential(2);
  $('ro-err').style.color = err.energy > 1e-3 ? '#ff6b5e' : err.energy > 1e-6 ? '#ffd76b' : '#7dffb0';
  $('ro-sps').textContent = state.stepsPerFrame ?? 0;
  $('ro-fps').textContent = state.fps.toFixed(0);
  $('ro-integrator').textContent = $('in-integrator').selectedOptions[0]?.textContent.split(' (')[0] ?? '—';
  $('ro-dt').textContent = fmtStep(state.dt);
  $('ro-cost').textContent = `${costMs.toFixed(1)} ms`;
  const lagPct = state.running ? state.lag * 100 : 100;
  $('ro-lag').textContent = `${lagPct >= 99.5 ? 100 : lagPct.toFixed(0)}%`;
  $('ro-lag').style.color = lagPct > 95 ? '#7dffb0' : lagPct > 50 ? '#ffd76b' : '#ff6b5e';
  $('v-dt').textContent = fmtStep(state.dt);
}

function fmtStep(dt) {
  return isAstro() ? (dt < 1 / 24 ? `${(dt * 1440).toFixed(1)} 분` : dt < 1 ? `${(dt * 24).toFixed(2)} 시간` : `${fmt(dt, 3)} 일`) : fmt(dt, 3);
}

function updateInspector() {
  const i = state.selected;
  const el = $('inspector');
  if (i < 0 || i >= sim.count || !sim.active[i]) {
    el.innerHTML = '<div class="k">—</div><div class="v">천체를 선택하세요</div>';
    return;
  }
  const m = sim.meta[i], i3 = i * 3;
  const rows = [];
  const massUnit = isAstro()
    ? sim.mass[i] > 1e-4
      ? `${fmt(sim.mass[i] / MSUN_PER_MJUP, 4)} M♃`
      : `${fmt(sim.mass[i] / MSUN_PER_MEARTH, 4)} M⊕`
    : fmt(sim.mass[i], 4);

  rows.push({ sep: m.name });
  rows.push({ k: '분류', v: TYPE_KO[m.type] ?? m.type });
  rows.push({ k: '질량', v: `${fmt(sim.mass[i], 4)} ${isAstro() ? 'M☉' : 'u'}` });
  if (isAstro() && sim.mass[i] > 0) rows.push({ k: '', v: massUnit });
  rows.push({ k: '반지름', v: isAstro() ? `${fmt(sim.radius[i] * KM_PER_AU, 4)} km` : fmt(sim.radius[i], 4) });
  const speed = Math.hypot(sim.vel[i3], sim.vel[i3 + 1], sim.vel[i3 + 2]);
  rows.push({ k: '속력', v: isAstro() ? `${fmt(auday2kms(speed), 4)} km/s` : `${fmt(speed, 4)} u/t` });
  rows.push({ k: '위치 (x,y,z)', v: `${fmt(sim.pos[i3], 4)}, ${fmt(sim.pos[i3 + 1], 4)}, ${fmt(sim.pos[i3 + 2], 4)}` });

  const ref = referenceFor(i);
  if (ref >= 0) {
    const rel = sim.relative(i, ref);
    const el2 = elementsFromState(rel.mu, rel.r, rel.v);
    const bound = el2.e < 1;
    rows.push({ sep: `궤도 (기준: ${sim.meta[ref].name})` });
    rows.push({ k: '거리 r', v: `${fmt(el2.r, 5)} ${isAstro() ? 'AU' : 'u'}` });
    rows.push({ k: '장반경 a', v: bound ? fmt(el2.a, 5) : `${fmt(el2.a, 5)} (쌍곡)`, cls: bound ? '' : 'warn' });
    rows.push({ k: '이심률 e', v: fmt(el2.e, 5), cls: el2.e > 0.9 ? 'warn' : '' });
    rows.push({ k: '경사각 i', v: `${fmt(el2.i, 4)}°` });
    rows.push({ k: '승교점 Ω', v: `${fmt(el2.Omega, 4)}°` });
    rows.push({ k: '근점편각 ω', v: `${fmt(el2.omega, 5)}°` });
    rows.push({ k: '진근점이각 ν', v: `${fmt(el2.nu, 4)}°` });
    rows.push({ k: '근점거리 q', v: fmt(el2.periapsis, 5) });
    rows.push({ k: '원점거리 Q', v: bound ? fmt(el2.apoapsis, 5) : '∞' });
    rows.push({
      k: '공전주기 P',
      v: bound ? (isAstro() ? fmtDuration(el2.period) : `${fmt(el2.period, 5)} u`) : '—',
    });
    rows.push({ k: '비에너지 ε', v: fmt(el2.energy, 4), cls: bound ? 'good' : 'bad' });
    rows.push({ k: '탈출속도', v: isAstro() ? `${fmt(auday2kms(el2.vEscape), 4)} km/s` : fmt(el2.vEscape, 4) });
    if (sim.mass[i] > 0 && bound) {
      rows.push({
        k: '힐 반경',
        v: `${fmt(hillRadius(el2.a, el2.e, sim.mass[i], sim.mass[ref]), 4)} ${isAstro() ? 'AU' : 'u'}`,
      });
    }
  }
  // 실측 물리 제원
  const d = m.data;
  if (d) {
    rows.push({ sep: '물리 제원 (실측)' });
    if (d.rot) {
      const retro = d.rot < 0;
      const h = Math.abs(d.rot) * 24;
      rows.push({
        k: '자전주기',
        v: `${h < 48 ? h.toFixed(3) + ' 시간' : Math.abs(d.rot).toFixed(3) + ' 일'}${retro ? ' (역행)' : ''}`,
        cls: retro ? 'warn' : '',
      });
    }
    if (d.tilt != null) rows.push({ k: '자전축 기울기', v: `${d.tilt}°` });
    if (d.rho) rows.push({ k: '평균밀도', v: `${d.rho} g/cm³` });
    if (d.g) rows.push({ k: '표면중력', v: `${d.g} m/s² (${(d.g / 9.807).toFixed(3)} g)` });
    if (d.vesc) rows.push({ k: '탈출속도', v: `${d.vesc} km/s` });
    if (d.albedo != null) rows.push({ k: '기하 알베도', v: String(d.albedo) });
    if (d.T) rows.push({ k: d.type === 'star' ? '유효온도' : '평균 표면온도', v: `${d.T} K (${(d.T - 273.15).toFixed(0)} ℃)` });
    if (d.moons != null) rows.push({ k: '알려진 위성', v: `${d.moons}개` });
    if (d.atmosphere) rows.push({ k: '대기', v: d.atmosphere });
    // 항성으로부터 받는 복사 (태양 상수 대비)
    const star = sim.primaryIndex();
    if (star >= 0 && star !== i && sim.mass[star] > 0.02) {
      const rel0 = sim.relative(i, star);
      const dist = Math.hypot(...rel0.r);
      if (dist > 0) {
        const S = sim.mass[star] / (dist * dist);
        const Teq = 278.6 * Math.pow(sim.mass[star] * (1 - (d.albedo ?? 0.3)) / (dist * dist), 0.25);
        rows.push({ k: '일사량 (지구=1)', v: fmt(S, 4) });
        rows.push({ k: '평형온도', v: `${Teq.toFixed(1)} K (${(Teq - 273.15).toFixed(0)} ℃)` });
      }
    }
    if (d.note) rows.push({ note: d.note });
  } else if (m.temperature) {
    rows.push({ sep: '항성' });
    rows.push({ k: '유효온도', v: `${m.temperature} K` });
  }
  kvRender(el, rows);
}

const TYPE_KO = {
  star: '항성', planet: '행성', moon: '위성', dust: '소천체 · 입자',
  bh: '블랙홀 / 은하핵', probe: '탐사체', body: '천체',
};

function kvRender(el, rows) {
  el.innerHTML = rows.map((r) => {
    if (r.sep) return `<div class="sep">${r.sep}</div>`;
    if (r.note) return `<div class="note">${r.note}</div>`;
    return `<div class="k">${r.k}</div><div class="v${r.cls ? ' ' + r.cls : ''}">${r.v}</div>`;
  }).join('');
}

function updateDiagnostics() {
  if (document.querySelector('.tabpage.active')?.dataset.page !== 'diag') return;
  const err = sim.conservationError();
  const L = sim.angularMomentum();
  const p = sim.momentum();
  const com = sim.centerOfMass();

  kvRender($('diag-kv'), [
    { k: '운동에너지 T', v: fmt(err.T, 6) },
    { k: '퍼텐셜 U', v: fmt(err.U, 6) },
    { k: '총에너지 E', v: fmt(err.E, 6) },
    { k: '초기 E₀', v: fmt(sim.e0 ?? 0, 6) },
    { k: '상대오차 |ΔE/E|', v: err.energy.toExponential(3), cls: err.energy > 1e-3 ? 'bad' : err.energy > 1e-6 ? 'warn' : 'good' },
    { k: '각운동량 오차', v: err.angular.toExponential(3), cls: err.angular > 1e-6 ? 'warn' : 'good' },
    { k: '비리얼비 2T/|U|', v: fmt(err.virial, 5), cls: Math.abs(err.virial - 1) < 0.1 ? 'good' : 'warn' },
  ]);

  kvRender($('diag-sys'), [
    { k: '총질량', v: `${fmt(sim.totalMass(), 6)} ${isAstro() ? 'M☉' : 'u'}` },
    { k: '활성 천체', v: String(sim.activeCount()) },
    { k: '충돌 병합', v: String(sim.mergeEvents) },
    { k: '파괴적 충돌', v: String(sim.fragmentEvents || 0) },
    { k: '조석 파괴', v: String(sim.rocheEvents || 0) },
    { k: '적분 스텝', v: sim.steps.toLocaleString() },
    { k: '각운동량 |L|', v: fmt(Math.hypot(...L), 6) },
    { k: 'L 방향', v: `(${L.map((x) => fmt(x, 3)).join(', ')})` },
    { k: '총운동량 |p|', v: Math.hypot(...p).toExponential(3) },
    { k: '질량중심', v: com.map((x) => fmt(x, 3)).join(', ') },
    { k: '힘 계산 방식', v: sim.useBarnesHut && sim.count > 64 ? `Barnes-Hut θ=${sim.theta}` : '직접합 O(N²)' },
    { k: '중력 모형', v: sim.relativistic ? '뉴턴 + 1PN' : '뉴턴' },
  ]);

  state.cons.push({ energy: err.energy, angular: err.angular });
  if (state.cons.length > 260) state.cons.shift();
  drawConservation($('chart-cons'), state.cons);

  updateDistribution();

  $('event-log').innerHTML = sim.events.map((e) =>
    `<div><span class="t">${isAstro() ? fmtDuration(e.t) : fmt(e.t, 4)}</span> · ${e.text}</div>`).join('');
}

/** 장반경 분포 — 소행성대 공명 간극 확인용 */
function updateDistribution() {
  const ref = sim.primaryIndex();
  const show = isAstro() && ref >= 0 && sim.activeCount() > 30 && sim.activeCount() <= 3000;
  $('dist-block').style.display = show ? '' : 'none';
  if (!show) return;
  const vals = [];
  for (let i = 0; i < sim.count; i++) {
    if (!sim.active[i] || i === ref) continue;
    const rel = sim.relative(i, ref);
    const a = elementsFromState(rel.mu, rel.r, rel.v).a;
    if (isFinite(a) && a > 0 && a < 60) vals.push(a);
  }
  if (vals.length < 20) { $('dist-block').style.display = 'none'; return; }
  vals.sort((x, y) => x - y);
  // 이상치를 제외한 5~95 백분위 구간
  const lo = vals[Math.floor(vals.length * 0.02)];
  const hi = vals[Math.floor(vals.length * 0.98)];
  drawDistribution($('chart-adist'), vals, KIRKWOOD, [lo, hi]);
}

// ───────────────────────── 천체 목록 ─────────────────────────

function renderBodyList() {
  const el = $('body-list');
  const f = state.filter.toLowerCase();
  const items = [];
  let shown = 0;
  for (let i = 0; i < sim.count; i++) {
    if (!sim.active[i]) continue;
    const m = sim.meta[i];
    if (f && !m.name.toLowerCase().includes(f)) continue;
    if (shown >= 200) break;
    shown++;
    const hex = '#' + m.color.toString(16).padStart(6, '0');
    items.push(`<div class="bl-item${i === state.selected ? ' sel' : ''}" data-i="${i}">
      <span class="dot" style="background:${hex};color:${hex}"></span>
      <span class="nm">${m.name}</span>
      <span class="mv">${fmt(sim.mass[i], 2)}</span>
    </div>`);
  }
  el.innerHTML = items.join('') || '<div class="bl-item">일치하는 천체 없음</div>';
  $('body-count').textContent = `${sim.activeCount()}개`;
  for (const node of el.querySelectorAll('.bl-item[data-i]')) {
    node.addEventListener('click', () => select(parseInt(node.dataset.i, 10)));
    node.addEventListener('dblclick', () => focusOn(parseInt(node.dataset.i, 10)));
  }
}

function select(i) {
  state.selected = i;
  resetEditSliders();
  $('edit-block').classList.toggle('off', i < 0 || !sim.active[i]);
  renderBodyList();
  updateInspector();
}

function focusOn(i) {
  state.selected = i;
  view.focusIndex = i;
  view.follow = true;
  // 선택 천체가 화면에서 적당한 크기를 갖도록 카메라 거리를 잡는다
  const i3 = i * 3;
  const dist = Math.hypot(sim.pos[i3] - view.origin[0], sim.pos[i3 + 1] - view.origin[1], sim.pos[i3 + 2] - view.origin[2]);
  const drawR = sim.radius[i] * view.localScale(dist) * (sim.meta[i].drawScale || 1) * view.bodyScale;
  // 천체가 화면을 적당히 채우는 거리로 '설정' 한다 (이전 추적 거리를 물려받지 않도록)
  const want = drawR > 0 ? drawR * 7 : view.spherical.radius * 0.15;
  view.spherical.radius = Math.max(want, 1e-6);
  $('btn-focus').classList.add('on');
  renderBodyList();
  toast(`${sim.meta[i].name} 추적`);
}

// ───────────────────────── 컨트롤 바인딩 ─────────────────────────

function refreshSliderLabels() {
  $('v-dt').textContent = fmtStep(state.dt);
  $('v-sub').textContent = `${state.maxSteps}`;
  $('v-soft').textContent = sim.softening.toExponential(1);
  $('v-theta').textContent = sim.theta.toFixed(2);
  $('v-bodyscale').textContent = `${view.bodyScale.toFixed(0)}×`;
  refreshRateLabel();
}

function refreshRateLabel() {
  $('v-speed').textContent = rateLabel(state.rate);
  for (const b of document.querySelectorAll('#rate-chips button')) {
    b.classList.toggle('on', Math.abs(parseFloat(b.dataset.rate) - state.rate) < state.rate * 1e-6);
  }
}

function bindControls() {
  $('in-integrator').addEventListener('change', (e) => {
    sim.integrator = e.target.value;
    sim._primed = false;
    state.cons.length = 0;
    sim.markBaseline();
  });
  $('in-dt').addEventListener('input', (e) => {
    state.dt = Math.pow(10, parseFloat(e.target.value));
    $('v-dt').textContent = fmtStep(state.dt);
  });
  $('in-sub').addEventListener('input', (e) => {
    state.maxSteps = Math.round(Math.pow(10, parseFloat(e.target.value)));
    $('v-sub').textContent = String(state.maxSteps);
  });
  $('in-soft').addEventListener('input', (e) => {
    sim.softening = Math.pow(10, parseFloat(e.target.value));
    sim._primed = false;
    $('v-soft').textContent = sim.softening.toExponential(1);
  });
  $('in-theta').addEventListener('input', (e) => {
    sim.theta = parseFloat(e.target.value);
    $('v-theta').textContent = sim.theta.toFixed(2);
  });
  $('in-bh').addEventListener('change', (e) => { sim.useBarnesHut = e.target.checked; sim._primed = false; });
  $('in-pn').addEventListener('change', (e) => {
    sim.relativistic = e.target.checked;
    sim._primed = false;
    toast(e.target.checked ? '1PN 상대론 보정 켜짐' : '뉴턴 중력');
  });
  $('in-col').addEventListener('change', (e) => { sim.collisions = e.target.checked; });
  $('in-auto').addEventListener('change', (e) => { state.autoDt = e.target.checked; });
  $('in-frag').addEventListener('change', (e) => {
    sim.fragmentation = e.target.checked;
    if (e.target.checked && !sim.collisions) { sim.collisions = true; $('in-col').checked = true; }
    toast(e.target.checked ? '고속 충돌 시 파편이 생깁니다' : '충돌은 병합만');
  });
  $('in-roche').addEventListener('change', (e) => {
    sim.rocheBreakup = e.target.checked;
    toast(e.target.checked ? '로슈 한계 안쪽 천체가 조석 파괴됩니다' : '조석 파괴 끔');
  });
  $('in-allorbits').addEventListener('change', (e) => { view.showAllOrbits = e.target.checked; });
  $('in-tails').addEventListener('change', (e) => { view.showTails = e.target.checked; });

  $('in-scale').addEventListener('change', (e) => {
    view.scaleMode = e.target.value;
    view.clearTrails();
  });
  $('in-bodyscale').addEventListener('input', (e) => {
    view.bodyScale = Math.pow(10, parseFloat(e.target.value));
    $('v-bodyscale').textContent = `${view.bodyScale.toFixed(0)}×`;
  });
  $('in-trails').addEventListener('change', (e) => { view.showTrails = e.target.checked; });
  $('in-orbit').addEventListener('change', (e) => { view.showOrbits = e.target.checked; view.orbitLine.visible = e.target.checked; });
  $('in-grid').addEventListener('change', (e) => { view.showGrid = e.target.checked; });
  $('in-labels').addEventListener('change', (e) => { overlay.showLabels = e.target.checked; });
  $('in-bloom').addEventListener('change', (e) => { view.bloomEnabled = e.target.checked; });
  $('in-spheres').addEventListener('change', (e) => { view.showSpheres = e.target.checked; });
  $('in-milkyway').addEventListener('change', (e) => { view.sky.showMilkyWay = e.target.checked; });
  $('in-const').addEventListener('change', (e) => { view.sky.showConstellations = e.target.checked; });
  $('in-starnames').addEventListener('change', (e) => { overlay.showStarNames = e.target.checked; });
  $('in-epoch').addEventListener('change', (e) => {
    state.epoch = daysSinceJ2000(e.target.value);
    selectScenario(state.scenario.id);
  });
  $('btn-today').addEventListener('click', () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('in-epoch').value = iso;
    state.epoch = daysSinceJ2000(iso);
    selectScenario(state.scenario.id);
    toast(`${iso} 의 실제 행성 배치로 초기화`);
  });
  $('in-com').addEventListener('change', (e) => {
    state.frameMode = e.target.checked ? 'com' : 'none';
    view.clearTrails();
  });

  // 트랜스포트
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-step').addEventListener('click', () => {
    state.running = false;
    syncPlayButton();
    const n = 40;
    for (let k = 0; k < n; k++) {
      sim.step(state.dt);
      if (k % 4 === 0) view.recordTrails(sim);
    }
    view.sync(sim);
  });
  $('btn-reset').addEventListener('click', () => selectScenario(state.scenario.id));
  $('in-speed').addEventListener('input', (e) => {
    state.rate = Math.pow(10, parseFloat(e.target.value));
    refreshRateLabel();
  });
  for (const b of document.querySelectorAll('#rate-chips button')) {
    b.addEventListener('click', () => {
      state.rate = parseFloat(b.dataset.rate);
      $('in-speed').value = Math.log10(state.rate);
      refreshRateLabel();
      toast(rateLabel(state.rate));
    });
  }

  // 패널
  $('btn-left').addEventListener('click', () => togglePanel('left'));
  $('btn-right').addEventListener('click', () => togglePanel('right'));
  $('btn-help').addEventListener('click', () => $('help').classList.add('open'));
  $('help-close').addEventListener('click', () => $('help').classList.remove('open'));
  $('help').addEventListener('click', (e) => { if (e.target.id === 'help') $('help').classList.remove('open'); });

  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  }

  $('body-filter').addEventListener('input', (e) => { state.filter = e.target.value; renderBodyList(); });
  $('btn-focus').addEventListener('click', () => {
    if (view.focusIndex === state.selected && view.follow) {
      view.follow = false;
      view.focusIndex = -1;
      $('btn-focus').classList.remove('on');
    } else if (state.selected >= 0) focusOn(state.selected);
  });
  $('btn-frame').addEventListener('click', () => {
    if (state.selected < 0) return;
    state.frameMode = state.frameMode === 'body' && state.frameBody === state.selected ? 'none' : 'body';
    state.frameBody = state.selected;
    $('in-com').checked = false;
    view.clearTrails();
    $('btn-frame').classList.toggle('on', state.frameMode === 'body');
    toast(state.frameMode === 'body' ? `${sim.meta[state.selected].name} 중심 좌표계` : '관성 좌표계');
  });

  for (const [id, lab] of [['in-emass', 'v-emass'], ['in-eradius', 'v-eradius']]) {
    $(id).addEventListener('input', (e) => {
      $(lab).textContent = fmt(Math.pow(10, parseFloat(e.target.value)), 3);
    });
  }
  $('in-evel').addEventListener('input', (e) => {
    $('v-evel').textContent = parseFloat(e.target.value).toFixed(3);
  });
  $('btn-apply-edit').addEventListener('click', applyEdit);
  $('btn-circularize').addEventListener('click', circularize);
  $('btn-remove2').addEventListener('click', () => $('btn-remove').click());

  $('in-launch-kind').innerHTML = LAUNCH_KINDS
    .map((k) => `<option value="${k.id}">${k.name}</option>`).join('');
  $('in-launch-kind').value = 'earth';
  $('in-launch-mode').addEventListener('change', (e) => {
    state.launchMode = e.target.checked;
    view.inputLocked = e.target.checked;
    $('gl').style.cursor = e.target.checked ? 'crosshair' : '';
    toast(e.target.checked ? '발사 모드 — 빈 공간을 드래그하세요' : '발사 모드 해제');
  });

  $('btn-add').addEventListener('click', addBody);
  $('btn-remove').addEventListener('click', () => {
    if (state.selected < 0) return;
    sim.active[state.selected] = 0;
    sim._primed = false;
    view.assignTrails(sim);
    renderBodyList();
    toast('천체 제거됨');
  });
  $('btn-csv').addEventListener('click', exportStateCSV);
  $('btn-elements').addEventListener('click', exportElementsCSV);
  $('btn-json').addEventListener('click', exportJSON);
  $('btn-shot').addEventListener('click', screenshot);

  // 캔버스 선택 / 발사 드래그
  let downXY = null;
  $('gl').addEventListener('pointerdown', (e) => {
    downXY = [e.clientX, e.clientY, performance.now()];
    if (state.launchMode && e.button === 0 && !e.shiftKey) {
      const p = view.screenToSim(e.clientX, e.clientY, [0, 0, 0]);
      if (p) {
        state.launch = { from: [p[0], p[1], p[2]], to: null, sx: e.clientX, sy: e.clientY };
        e.preventDefault();
      }
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!state.launch) return;
    const p = view.screenToSim(e.clientX, e.clientY, [0, 0, 0]);
    if (!p) return;
    state.launch.to = [p[0], p[1], p[2]];
    state.launch.sx = e.clientX;
    state.launch.sy = e.clientY;
    updateLaunchPreview();
  });
  window.addEventListener('pointerup', () => { if (state.launch) commitLaunch(); });
  $('gl').addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    if (moved < 5 && performance.now() - downXY[2] < 400 && !state.launchMode) {
      const i = view.pick(sim, e.clientX, e.clientY);
      if (i >= 0) select(i);
    }
    downXY = null;
  });
  $('gl').addEventListener('dblclick', (e) => {
    const i = view.pick(sim, e.clientX, e.clientY);
    if (i >= 0) focusOn(i);
  });

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
}

function togglePlay() {
  state.running = !state.running;
  syncPlayButton();
}

function syncPlayButton() {
  $('btn-play').textContent = state.running ? '❚❚ 일시정지' : '▶︎ 실행';
  $('btn-play').classList.toggle('primary', !state.running);
}

function togglePanel(side) {
  state.panels[side] = !state.panels[side];
  applyPanels();
}

function applyPanels() {
  for (const side of ['left', 'right']) {
    const open = state.panels[side];
    $(side).classList.toggle('hidden', !open);
    $(side).classList.toggle('open', open);
    $(`btn-${side}`).classList.toggle('on', open);
  }
}

function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.tabpage')) p.classList.toggle('active', p.dataset.page === name);
  if (name === 'stars') starPanel.update();
  if (name === 'cosmo') cosmoPanel.redrawCharts();
  if (name === 'bodies') renderBodyList();
}

function onKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === '.') { $('btn-step').click(); }
  else if (k === 'r') { selectScenario(state.scenario.id); }
  else if (k === 't') { $('in-trails').checked = !$('in-trails').checked; view.showTrails = $('in-trails').checked; }
  else if (k === 'l') { $('in-labels').checked = !$('in-labels').checked; overlay.showLabels = $('in-labels').checked; }
  else if (k === 'g') { $('in-grid').checked = !$('in-grid').checked; view.showGrid = $('in-grid').checked; }
  else if (k === 'f') { if (state.selected >= 0) focusOn(state.selected); }
  else if (k === 'c') { $('in-com').checked = !$('in-com').checked; state.frameMode = $('in-com').checked ? 'com' : 'none'; view.clearTrails(); }
  else if (k === 'x') { const el = $('in-launch-mode'); el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
  else if (k === 'o') { const el = $('in-allorbits'); el.checked = !el.checked; view.showAllOrbits = el.checked; }
  else if (k === '[' || k === ']') {
    const s = $('in-speed');
    const lo = parseFloat(s.min), hi = parseFloat(s.max);
    s.value = clamp(parseFloat(s.value) + (k === ']' ? 0.25 : -0.25), lo, hi);
    s.dispatchEvent(new Event('input'));
  } else if (k >= '1' && k <= '5') {
    showTab(['bodies', 'diag', 'stars', 'cosmo', 'tools'][parseInt(k, 10) - 1]);
  }
}

function onResize() {
  view.resize();
  overlay.resize(window.innerWidth, window.innerHeight);
  if (document.querySelector('.tabpage.active')?.dataset.page === 'stars') starPanel.update();
  if (document.querySelector('.tabpage.active')?.dataset.page === 'cosmo') cosmoPanel.redrawCharts();
}

// ───────────────────────── 도구 ─────────────────────────

function addBody() {
  const ref = state.frameMode === 'body' && state.frameBody >= 0 ? state.frameBody : sim.primaryIndex();
  if (ref < 0) return;
  const num = (id, d) => {
    const v = parseFloat($(id).value);
    return isFinite(v) ? v : d;
  };
  const mass = Math.max(0, num('add-mass', 0));
  const el = {
    a: num('add-a', 2), e: clamp(num('add-e', 0), 0, 0.99),
    i: num('add-i', 0), Omega: num('add-O', 0),
    omega: num('add-w', 0), M0: num('add-M', 0),
  };
  if (el.a <= 0) { toast('장반경은 0보다 커야 합니다'); return; }

  const mu = sim.G * (sim.mass[ref] + mass);
  const { r, v } = stateFromElements(mu, el);
  const r3 = ref * 3;
  const i = sim.add({
    name: $('add-name').value || `천체 ${sim.count}`,
    mass,
    pos: [r[0] + sim.pos[r3], r[1] + sim.pos[r3 + 1], r[2] + sim.pos[r3 + 2]],
    vel: [v[0] + sim.vel[r3], v[1] + sim.vel[r3 + 1], v[2] + sim.vel[r3 + 2]],
    radius: mass > 1e-5 ? 0.0005 : 0.00003,
    color: blackbodyHex(4200 + Math.random() * 5000),
    type: mass > 1e-4 ? 'star' : 'planet',
    glow: mass > 1e-4 ? 0.8 : 0,
  });
  sim._primed = false;
  sim.markBaseline();
  state.cons.length = 0;
  view.assignTrails(sim);
  select(i);
  toast(`${sim.meta[i].name} 투입 (기준: ${sim.meta[ref].name})`);
}

function download(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${name} 저장됨`);
}

function exportStateCSV() {
  const rows = ['name,type,mass,radius,x,y,z,vx,vy,vz'];
  for (let i = 0; i < sim.count; i++) {
    if (!sim.active[i]) continue;
    const i3 = i * 3;
    rows.push([
      `"${sim.meta[i].name}"`, sim.meta[i].type, sim.mass[i], sim.radius[i],
      sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2],
      sim.vel[i3], sim.vel[i3 + 1], sim.vel[i3 + 2],
    ].join(','));
  }
  download(`spacesim_${state.scenario.id}_t${sim.time.toFixed(2)}.csv`, rows.join('\n'));
}

function exportElementsCSV() {
  const rows = ['name,reference,a,e,i_deg,Omega_deg,omega_deg,nu_deg,periapsis,apoapsis,period'];
  for (let i = 0; i < sim.count; i++) {
    if (!sim.active[i]) continue;
    const ref = referenceFor(i);
    if (ref < 0) continue;
    const rel = sim.relative(i, ref);
    const e = elementsFromState(rel.mu, rel.r, rel.v);
    rows.push([
      `"${sim.meta[i].name}"`, `"${sim.meta[ref].name}"`,
      e.a, e.e, e.i, e.Omega, e.omega, e.nu, e.periapsis,
      isFinite(e.apoapsis) ? e.apoapsis : '', isFinite(e.period) ? e.period : '',
    ].join(','));
  }
  download(`spacesim_elements_${state.scenario.id}.csv`, rows.join('\n'));
}

function exportJSON() {
  const bodies = [];
  for (let i = 0; i < sim.count; i++) {
    if (!sim.active[i]) continue;
    const i3 = i * 3;
    bodies.push({
      name: sim.meta[i].name, type: sim.meta[i].type,
      mass: sim.mass[i], radius: sim.radius[i],
      color: '#' + sim.meta[i].color.toString(16).padStart(6, '0'),
      pos: [sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2]],
      vel: [sim.vel[i3], sim.vel[i3 + 1], sim.vel[i3 + 2]],
    });
  }
  download(`spacesim_${state.scenario.id}.json`, JSON.stringify({
    software: 'SpaceSim 1.0',
    scenario: state.scenario.id,
    units: state.scenario.units,
    G: sim.G,
    time: sim.time,
    integrator: sim.integrator,
    softening: sim.softening,
    relativistic: sim.relativistic,
    bodies,
  }, null, 2), 'application/json');
}

function screenshot() {
  view.render();
  const gl = $('gl');
  const out = document.createElement('canvas');
  out.width = gl.width; out.height = gl.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(gl, 0, 0);
  ctx.drawImage($('overlay'), 0, 0, out.width, out.height);
  out.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `spacesim_${state.scenario.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('스크린샷 저장됨');
  });
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ───────────────────────── 시작 ─────────────────────────

let starPanel, cosmoPanel;

function init() {
  buildScenarioList();
  bindControls();
  applyPanels();
  overlay.resize(window.innerWidth, window.innerHeight);
  view.resize();

  starPanel = new StarPanel();
  cosmoPanel = new CosmoPanel();

  selectScenario('solar');
  resetEditSliders();
  refreshSliderLabels();
  requestAnimationFrame(frame);
  boot();
}

// 콘솔/자동화 검증용 핸들
window.__SS = { sim, view, state, overlay };

init();
