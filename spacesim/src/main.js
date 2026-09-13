// SpaceSim — 애플리케이션 진입점
// 시뮬레이션 상태, 렌더 루프, UI 바인딩.

import { NBody } from './physics/nbody.js';
import { elementsFromState, sampleOrbit, hillRadius, stateFromElements } from './physics/kepler.js';
import { SCENARIOS, loadScenario, getScenario } from './sim/scenarios.js';
import { View } from './render/view.js';
import { Overlay, drawConservation } from './render/overlay.js';
import { StarPanel, CosmoPanel, renderUnitTable } from './ui/tools.js';
import {
  fmt, fmtDuration, julianToDate, auday2kms, clamp,
  KM_PER_AU, MSUN_PER_MEARTH, MSUN_PER_MJUP,
} from './core/constants.js';
import { blackbodyHex } from './astro/stars.js';

const $ = (id) => document.getElementById(id);

const sim = new NBody({ capacity: 2048 });
const view = new View($('gl'));
const overlay = new Overlay($('overlay'));

const state = {
  running: false,
  speed: 1,
  dt: 0.5,
  substeps: 20,
  autoDt: false,
  selected: -1,
  frameMode: 'none',      // none | com | body
  frameBody: -1,
  scenario: SCENARIOS[0],
  cons: [],
  fps: 0,
  lastUI: 0,
  filter: '',
  panels: { left: window.innerWidth > 860, right: window.innerWidth > 860 },
};

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
  loadScenario(sim, sc);

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
  state.substeps = sc.substeps ?? 20;
  state.selected = sim.count > 1 ? 1 : 0;
  state.frameMode = 'none';
  state.frameBody = sim.primaryIndex();
  state.cons.length = 0;

  $('in-integrator').value = sim.integrator;
  $('in-dt').value = Math.log10(state.dt);
  $('in-sub').value = state.substeps;
  $('in-soft').value = Math.log10(Math.max(1e-7, sim.softening));
  $('in-bh').checked = sim.useBarnesHut;
  $('in-pn').checked = sim.relativistic;
  $('in-col').checked = sim.collisions;
  $('in-theta').value = sim.theta;
  $('in-scale').value = view.scaleMode;
  $('in-com').checked = false;
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
  const dtReal = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsAcc += dtReal; fpsN++;
  if (fpsAcc > 0.4) { state.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  let stepsDone = 0;
  if (state.running) {
    const target = Math.max(1, Math.round(state.substeps * state.speed));
    const budget = performance.now() + 12; // 프레임당 물리 예산 [ms]
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
    if (state.autoDt && sim.steps % 200 < stepsDone) {
      const s = sim.suggestedStep();
      if (isFinite(s) && s > 0) {
        state.dt = clamp(s, 1e-5, 50);
        $('in-dt').value = Math.log10(state.dt);
        $('v-dt').textContent = fmtStep(state.dt);
      }
    }
  }
  state.stepsPerFrame = stepsDone;

  updateOrigin();
  view.sync(sim);
  updateOrbitPreview();
  view.updateCamera(sim);
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
  if (m.temperature) {
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
  el.innerHTML = rows.map((r) => r.sep
    ? `<div class="sep">${r.sep}</div>`
    : `<div class="k">${r.k}</div><div class="v${r.cls ? ' ' + r.cls : ''}">${r.v}</div>`).join('');
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

  $('event-log').innerHTML = sim.events.map((e) =>
    `<div><span class="t">${isAstro() ? fmtDuration(e.t) : fmt(e.t, 4)}</span> · ${e.text}</div>`).join('');
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
  const want = Math.max(drawR * 90, view.spherical.radius * 0.15);
  view.spherical.radius = Math.min(view.spherical.radius, Math.max(want, 1e-5));
  $('btn-focus').classList.add('on');
  renderBodyList();
  toast(`${sim.meta[i].name} 추적`);
}

// ───────────────────────── 컨트롤 바인딩 ─────────────────────────

function refreshSliderLabels() {
  $('v-dt').textContent = fmtStep(state.dt);
  $('v-sub').textContent = `${state.substeps}`;
  $('v-soft').textContent = sim.softening.toExponential(1);
  $('v-theta').textContent = sim.theta.toFixed(2);
  $('v-speed').textContent = `${state.speed < 1 ? state.speed.toFixed(2) : state.speed.toFixed(1)}×`;
  $('v-bodyscale').textContent = `${view.bodyScale.toFixed(0)}×`;
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
    state.substeps = parseInt(e.target.value, 10);
    $('v-sub').textContent = String(state.substeps);
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
  $('in-com').addEventListener('change', (e) => {
    state.frameMode = e.target.checked ? 'com' : 'none';
    view.clearTrails();
  });

  // 트랜스포트
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-step').addEventListener('click', () => {
    state.running = false;
    syncPlayButton();
    for (let k = 0; k < state.substeps; k++) {
      sim.step(state.dt);
      if (k % Math.max(1, Math.ceil(state.substeps / 12)) === 0) view.recordTrails(sim);
    }
    view.sync(sim);
  });
  $('btn-reset').addEventListener('click', () => selectScenario(state.scenario.id));
  $('in-speed').addEventListener('input', (e) => {
    state.speed = Math.pow(10, parseFloat(e.target.value));
    $('v-speed').textContent = `${state.speed < 1 ? state.speed.toFixed(2) : state.speed.toFixed(1)}×`;
  });

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

  // 캔버스 선택
  let downXY = null;
  $('gl').addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY, performance.now()]; });
  $('gl').addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    if (moved < 5 && performance.now() - downXY[2] < 400) {
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
  else if (k === '[' || k === ']') {
    const s = $('in-speed');
    s.value = clamp(parseFloat(s.value) + (k === ']' ? 0.12 : -0.12), -2, 2.4);
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
  refreshSliderLabels();
  requestAnimationFrame(frame);
  boot();
}

init();
