// SpaceSim — 메인 루프 · 카메라 · 입력 · UI
import * as THREE from 'three';
import { Sim, METHODS } from './physics.js';
import { SCENARIOS, spawnBody, makeGroup } from './scenarios.js';
import { View, U, toR } from './view.js';
import { Ship, ENGINES, SAS } from './ship.js';
import { G, C, AU, DAY, YEAR, KPC, MSUN, MEARTH, MJUP, LSUN, D2R, sub, add, mul, len, norm, cross, tiltVec, stateToElements, rng, gauss } from './orbit.js';

const $ = id => document.getElementById(id);
const WARPS = []; for (let e = 0; e <= 15; e++) WARPS.push(10 ** e, 3 * 10 ** e); WARPS.push(1e16);
const BARY = { id: -1, name: '질량 중심', en: 'Barycenter', type: 'bary', pos: [0, 0, 0], vel: [0, 0, 0], radius: 0, mass: 0, color: [1, 1, 1] };
const SHIPL = { id: 'ship', name: '우주선', type: 'ship', color: [0.45, 1, 0.7] };
const TYPE = { star: '항성', planet: '행성', moon: '위성', blackhole: '블랙홀', core: '은하핵', bary: '', ship: '우주선' };

const view = new View($('gl'));
let sim, cfg, ship = null, shipInit = null, scenKey = 'solar';
let focus = null, sel = null, warpI = 0, paused = false, camW = [0, 0, 0];
const cam = { yaw: 0.8, pitch: 0.3, dist: 10, tdist: 10, trans: null };
const opt = { orbitMode: 'kepler', labels: true, parts: true, lens: true, bloom: 0.7 };
let E0 = null, L0 = null, lastTrail = 0, effWarp = 1, fps = 60, diag = {}, listSig = '';
const keys = new Set(), timers = { hier: 0, orb: 0, pred: 0, ui: 0, diag: 0 };

// ───────── 포맷 ─────────
const num = (x, d = 2) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '∞';
const sci = x => Number.isFinite(x) ? x.toExponential(2) : '—';
function fDist(m) {
  const a = Math.abs(m); if (!Number.isFinite(a)) return '∞';
  if (a < 1e4) return num(m, 0) + ' m'; if (a < 1.5e9) return num(m / 1e3, a < 1e6 ? 1 : 0) + ' km';
  if (a < 0.05 * KPC) return num(m / AU, a < 10 * AU ? 4 : 2) + ' AU'; return num(m / KPC, 2) + ' kpc';
}
function fTime(s) {
  const a = Math.abs(s); if (!Number.isFinite(a)) return '∞';
  if (a < 120) return num(s, 1) + ' 초'; if (a < 7200) return num(s / 60, 1) + ' 분'; if (a < 2 * DAY) return num(s / 3600, 2) + ' 시간';
  if (a < 2 * YEAR) return num(s / DAY, 2) + ' 일'; if (a < 1e6 * YEAR) return num(s / YEAR, 2) + ' 년'; return num(s / YEAR / 1e6, 1) + ' 백만 년';
}
function fMass(kg) {
  if (kg >= 1e29) return num(kg / MSUN, 4) + ' M☉'; if (kg >= 3e26) return num(kg / MJUP, 3) + ' M♃';
  if (kg >= 1e21) return num(kg / MEARTH, 4) + ' M⊕'; return sci(kg) + ' kg';
}
const fSpeed = v => (Math.abs(v) < 1e4 ? num(v, 1) + ' m/s' : num(v / 1e3, 2) + ' km/s') + (v > 0.01 * C ? ` (${num(v / C * 100, 1)}% c)` : '');
const css = c => `rgb(${c.map(x => Math.round(Math.min(1, x) * 255)).join(',')})`;
const labelCol = b => b.type === 'ship' ? '#6dffb0' : b.type === 'blackhole' ? '#ffb35c' : css(b.color.map(x => 0.45 + 0.55 * Math.min(1, x)));

function toast(msg, cls = '') {
  const d = document.createElement('div'); d.className = 'toast ' + cls; d.textContent = msg; $('toasts').append(d);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 3800);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

// ───────── 천체 계층 (영향권 SOI = a·(m/M)^0.4) ─────────
const dist = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
function hierarchy() {
  const s = sim.bodies.slice().sort((a, b) => b.mass - a.mass); if (!s.length) return;
  s[0].parent = null; s[0].soi = Infinity;
  for (let i = 1; i < s.length; i++) {
    const b = s[i]; let best = s[0];
    for (let j = 1; j < i; j++) { const c = s[j]; if (c.soi < best.soi && dist(b, c) < c.soi) best = c; }
    b.parent = best; b.soi = dist(b, best) * Math.pow(b.mass / best.mass, 0.4);
  }
  if (ship) ship.ref = ship.landed ? ship.landed.body : refFor(ship.pos);
}
function refFor(p) {
  let best = null;
  for (const b of sim.bodies) if (dist({ pos: p }, b) < b.soi && (!best || b.soi < best.soi)) best = b;
  return best || sim.bodies[0];
}
const root = () => sim.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), sim.bodies[0]);

// ───────── 시나리오 ─────────
function load(k) {
  scenKey = k; const sc = SCENARIOS[k].make(); cfg = sc.cfg;
  sim = new Sim(); Object.assign(sim, { bodies: sc.bodies, groups: sc.groups, method: cfg.method, eta: cfg.eta, soft: cfg.soft, gr: cfg.gr, collide: cfg.collide, tides: cfg.tides });
  sim.t = sim.t0 = cfg.timeMode === 'date' ? (cfg.epochMs / 86400000 + 2440587.5 - 2451545) * 86400 : 0;
  sim.onShipContact = shipContact; sim.onStep = dt => ship && ship.consume(dt);
  view.clear(); view.setUnit(cfg.unit || 1e6); view.setGroups(sim.groups);
  ship = null; shipInit = sc.ship ? { pos: sc.ship.pos.slice(), vel: sc.ship.vel.slice() } : null;
  hierarchy();
  if (shipInit) spawnShip();
  opt.orbitMode = cfg.orbitMode; opt.lens = true;
  warpI = WARPS.reduce((bi, w, i) => (Math.abs(Math.log(w / cfg.warp)) < Math.abs(Math.log(WARPS[bi] / cfg.warp)) ? i : bi), 0); paused = false;
  focus = cfg.focus === 'ship' ? ship : cfg.focus === '#bary' ? BARY : sim.bodies.find(b => b.name === cfg.focus) || root();
  sel = focus && focus.type !== 'bary' && focus !== ship ? focus : null;
  cam.dist = cam.tdist = (cfg.camDist || (focus.radius || AU) * 5) / U; cam.trans = null; cam.pitch = cfg.pitch ?? 0.3; cam.yaw = 0.8;
  if (focus === ship) {
    const up = norm(sub(ship.pos, ship.ref.pos)), pg = norm(sub(ship.vel, ship.ref.vel)), o = norm(add(mul(up, 0.3), mul(pg, -0.95)));
    const r = new THREE.Vector3(o[0], o[2], -o[1]); cam.yaw = Math.atan2(r.x, r.z); cam.pitch = Math.asin(r.y);
  }
  resetE(); lastTrail = -Infinity; listSig = '';
  buildLabels(); syncControls();
  $('shiphud').classList.toggle('hidden', !ship); $('scenario').value = k;
  toast(SCENARIOS[k].name);
}
function spawnShip() {
  ship = new Ship(shipInit); sim.ship = ship; sim.shipHook = ship.hook(sim);
  ship.ref = refFor(ship.pos); ship.pointAt(norm(sub(ship.vel, ship.ref.vel)));
}
function resetE() { const d = sim.diagnostics(); E0 = d.E; L0 = d.L; }

function shipContact(b) {
  const vr = len(sub(ship.vel, b.vel)), solid = (b.type === 'planet' || b.type === 'moon') && !(b.style && b.style.k === 'gas');
  if (solid && vr < 15) {
    ship.landed = { body: b, rel: mul(norm(sub(ship.pos, b.pos)), b.radius) };
    ship.pos = add(b.pos, ship.landed.rel); ship.vel = b.vel.slice(); ship.throttle = 0; ship.sas = 'radout'; ship.ref = b;
    toast(`🛬 ${b.name} 표면에 착륙 — 접지 속도 ${num(vr, 1)} m/s`);
  } else {
    ship.alive = false; view.flash(ship.pos, 5e4, [1, 0.6, 0.3]);
    toast(`💥 ${b.name}에 충돌 (상대속도 ${fSpeed(vr)}) — R 키로 재배치`, 'bad');
  }
}

function handleEvents() {
  for (const e of sim.events) {
    if (e.type === 'merge') {
      view.flash(e.pos, Math.max(e.big.radius * 6, 2e7), [1, 0.72, 0.45]);
      toast(`☄ 충돌 병합: ${e.small.name} → ${e.big.name} (${fMass(e.big.mass)})`, 'warn');
      if (focus === e.small) setFocus(e.big); if (sel === e.small) sel = e.big;
      resetE();
    } else if (e.type === 'tde') {
      const n = 2500, g = makeGroup('조석 잔해 흐름', n, { size: 1.8, alpha: 0.95 }), r = rng(Math.floor(sim.t) % 100000 + 1), R = e.star.radius;
      for (let i = 0; i < n; i++) {
        let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1);
        g.P.set([e.pos[0] + x * R, e.pos[1] + y * R, e.pos[2] + z * R], 3 * i);
        g.V.set([e.vel[0] + gauss(r) * 5e3, e.vel[1] + gauss(r) * 5e3, e.vel[2] + gauss(r) * 5e3], 3 * i);
        const t = r(); g.col.set([1.6, 0.8 + 0.5 * t, 0.4 + 0.4 * t], 3 * i);
      }
      sim.groups.push(g); view.setGroups(sim.groups); view.flash(e.pos, 3e11, [1, 0.8, 0.6]);
      toast(`🌀 조석 붕괴 사건(TDE): ${e.star.name}이(가) ${e.bh.name}의 조석력에 찢겨졌습니다`, 'warn');
      if (focus === e.star) setFocus(e.bh); if (sel === e.star) sel = e.bh;
      resetE();
    }
  }
  sim.events.length = 0;
}

// ───────── 카메라 ─────────
function minDist(f) { return f === ship ? 9 / U : f && f.radius ? f.radius * 1.06 / U : 1e-6; }
function niceDist(f) {
  if (f === ship) return 45 / U; if (f === BARY) return cam.tdist;
  if (f.type === 'core') return 60 * KPC / U; if (f.type === 'blackhole') return f.radius * 60 / U; return f.radius * 4.5 / U;
}
function setFocus(f) {
  if (!f || f === focus) return;
  cam.trans = { from: focus, t: 0 }; focus = f; cam.tdist = Math.max(niceDist(f), minDist(f));
  if (f !== ship && f !== BARY) sel = f;
}
const posOf = f => (f && f.pos) || [0, 0, 0];
function updateCamera(dt) {
  cam.tdist = Math.min(1e11, Math.max(cam.tdist, minDist(focus)));
  cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(cam.tdist) - Math.log(cam.dist)) * (1 - Math.exp(-dt * 8)));
  let fp = posOf(focus);
  if (cam.trans) {
    cam.trans.t = Math.min(1, cam.trans.t + dt / 1.4);
    const a = posOf(cam.trans.from), e = cam.trans.t * cam.trans.t * (3 - 2 * cam.trans.t);
    fp = [a[0] + (fp[0] - a[0]) * e, a[1] + (fp[1] - a[1]) * e, a[2] + (fp[2] - a[2]) * e];
    if (cam.trans.t >= 1) cam.trans = null;
  }
  const cp = Math.cos(cam.pitch), off = new THREE.Vector3(cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw));
  const k = cam.dist * U;
  camW = [fp[0] + off.x * k, fp[1] - off.z * k, fp[2] + off.y * k];
  return off.multiplyScalar(-cam.dist);
}

// ───────── 이름표 ─────────
const labels = new Map();
function buildLabels() {
  $('labels').innerHTML = ''; labels.clear();
  const list = [...sim.bodies]; if (ship) list.push(SHIPL);
  for (const b of list) addLabel(b);
}
function addLabel(b) {
  const d = document.createElement('div'); d.className = 'lbl' + (b === SHIPL ? ' ship' : '');
  d.innerHTML = '<i></i><span></span>'; d.lastChild.textContent = b.name; d.style.color = labelCol(b);
  const obj = () => (b === SHIPL ? ship : b);
  d.addEventListener('click', e => { e.stopPropagation(); const o = obj(); if (o === ship) setFocus(ship); else { sel = o; setFocus(o); } });
  $('labels').append(d); labels.set(b.id, { d, b });
}
function updateLabels() {
  const tmp = new THREE.Vector3(), placed = [], W = view.W, H = view.H;
  const items = [...labels.values()];
  for (const it of items) if (it.b !== SHIPL && !it.b.alive) { it.d.remove(); labels.delete(it.b.id); }
  for (const b of sim.bodies) if (!labels.has(b.id)) addLabel(b);
  const pri = it => (it.b === focus || it.b === sel || (it.b === SHIPL && focus === ship) ? 1e60 : it.b === SHIPL ? 1e55 : it.b.mass);
  const sorted = [...labels.values()].sort((a, b) => pri(b) - pri(a));
  for (const it of sorted) {
    const isShip = it.b === SHIPL, v = isShip ? null : view.vis.get(it.b.id);
    const pos = isShip ? (ship && ship.alive ? view.ship.position : null) : v && v.g.position;
    if (!opt.labels || !pos) { it.d.style.display = 'none'; continue; }
    const p = view.project(pos, tmp);
    if (!p.ok || p.x < -50 || p.y < -20 || p.x > W + 50 || p.y > H + 20) { it.d.style.display = 'none'; continue; }
    const imp = pri(it) >= 1e55, big = v && v.pr > 40;
    const dotOnly = !isShip && sim.bodies.length > 30 && it.b.mass < 1e-5 * root().mass;
    if (!imp && !dotOnly && placed.some(q => Math.abs(q.x - p.x) < 46 && Math.abs(q.y - p.y) < 15)) { it.d.style.display = 'none'; continue; }
    placed.push(p);
    it.d.style.display = ''; it.d.style.transform = `translate(${p.x}px,${p.y - 8}px)`;
    it.d.classList.toggle('focus', it.b === focus || (isShip && focus === ship)); it.d.classList.toggle('sel', it.b === sel);
    const minor = !isShip && sim.bodies.length > 30 && it.b.mass < 1e-5 * root().mass && it.b !== sel;
    it.d.classList.toggle('noname', (!!big || minor) && it.b !== focus);
  }
}

// ───────── UI 패널 ─────────
function bodyTree() {
  const kids = new Map(), out = [], r = root(); if (!r) return out;
  for (const b of sim.bodies) if (b.parent) { if (!kids.has(b.parent)) kids.set(b.parent, []); kids.get(b.parent).push(b); }
  const walk = (b, d) => { out.push([b, d]); (kids.get(b) || []).sort((x, y) => dist(x, b) - dist(y, b)).forEach(k => walk(k, d + 1)); };
  walk(r, 0); return out;
}
function buildBodyList() {
  const t = bodyTree(), sig = t.map(([b, d]) => b.id + ':' + d).join(',') + (ship ? 's' : '');
  if (sig === listSig) { for (const el of $('bodies').children) el.classList.toggle('sel', +el.dataset.id === (sel && sel.id) || (el.dataset.id === 'ship' && focus === ship)); return; }
  listSig = sig;
  const rows = (ship ? [`<div data-id="ship"><i style="background:#6dffb0"></i>🚀 우주선<small>우주선</small></div>`] : [])
    .concat(t.slice(0, 160).map(([b, d]) => `<div data-id="${b.id}" style="padding-left:${6 + d * 13}px"><i style="background:${labelCol(b)}"></i>${b.name}<small>${TYPE[b.type] || ''}</small></div>`));
  $('bodies').innerHTML = rows.join('');
}
$('bodies').addEventListener('click', e => {
  const el = e.target.closest('[data-id]'); if (!el) return;
  if (el.dataset.id === 'ship') { if (ship) setFocus(ship); return; }
  const b = sim.bodies.find(x => x.id === +el.dataset.id); if (b) { sel = b; setFocus(b); }
});

function infoHTML(b) {
  if (!b && focus === ship && ship) return `<h2 style="color:#6dffb0">우주선</h2><div class="en">Spacecraft · 기준 천체 ${ship.ref ? ship.ref.name : '—'}</div>
    <p class="hint">궤도·연료·Δv 정보는 하단 HUD에 표시됩니다. 하늘색 선은 N체 수치 적분으로 예측한 관성 비행 궤적입니다.</p>`;
  if (!b) return `<h2>질량 중심</h2><div class="en">${focus === ship ? 'Spacecraft' : 'System barycenter'}</div>
    <table><tr><td>천체 수</td><td>${sim.bodies.length}</td></tr><tr><td>총 질량</td><td>${fMass(sim.bodies.reduce((s, x) => s + x.mass, 0))}</td></tr></table>`;
  const rows = [], R = b.radius, M = b.mass, tr = (k, v) => rows.push(`<tr><td>${k}</td><td>${v}</td></tr>`), sec = t => rows.push(`<tr class="sec"><td colspan="2">${t}</td></tr>`);
  tr('질량', fMass(M));
  if (b.type === 'blackhole') {
    const rs = 2 * G * M / (C * C); tr('슈바르츠실트 반지름', fDist(rs)); tr('광자구 (1.5 r<sub>s</sub>)', fDist(1.5 * rs)); tr('ISCO (3 r<sub>s</sub>)', fDist(3 * rs));
    tr('호킹 온도', sci(6.17e-8 * MSUN / M) + ' K');
  } else if (R > 0) {
    tr('반지름', fDist(R)); tr('평균 밀도', num(M / (4 / 3 * Math.PI * R ** 3), 0) + ' kg/m³');
    tr('표면 중력', num(G * M / R / R, 2) + ' m/s²'); tr('탈출 속도', fSpeed(Math.sqrt(2 * G * M / R)));
    if (b.rotP) tr('자전 주기', fTime(b.rotP)); if (b.tilt) tr('자전축 기울기', num(b.tilt, 2) + '°');
  }
  if (b.type === 'star') { tr('유효 온도', num(b.temp, 0) + ' K'); tr('광도', num(b.lum / LSUN, 4) + ' L☉'); }
  if (b.atmo) tr('대기 (지표 밀도)', num(b.atmo.rho0, 3) + ' kg/m³');
  const p = b.parent;
  if (p) {
    const el = stateToElements(G * (p.mass + M), sub(b.pos, p.pos), sub(b.vel, p.vel));
    sec(`궤도 — 기준: ${p.name}`);
    tr('거리', fDist(dist(b, p))); tr('상대 속도', fSpeed(len(sub(b.vel, p.vel))));
    tr('긴반지름 a', el.e < 1 ? fDist(el.a) : '쌍곡선'); tr('이심률 e', num(el.e, 5)); tr('경사 i (황도)', num(el.i / D2R, 3) + '°');
    tr('공전 주기', fTime(el.period)); tr('근점 / 원점', fDist(el.pe) + ' / ' + fDist(el.ap)); tr('영향권 SOI', fDist(b.soi));
  }
  return `<h2 style="color:${labelCol(b)}">${b.name}</h2><div class="en">${b.en || ''} · ${TYPE[b.type] || ''}</div><table>${rows.join('')}</table>`;
}

function shipHUD() {
  const s = ship, st = [];
  const it = (k, v) => st.push(`<div><span>${k}</span><b>${v}</b></div>`);
  $('b-thr').style.width = s.throttle * 100 + '%'; $('v-thr').textContent = Math.round(s.throttle * 100) + '%';
  $('b-fuel').style.width = s.fuel / s.fuelMax * 100 + '%'; $('v-fuel').textContent = num(s.fuel / 1000, 2) + ' t';
  for (const el of $('sas').children) el.classList.toggle('on', el.dataset.m === s.sas);
  if (!s.alive) { $('ship-stats').innerHTML = '<div class="bad">우주선 파괴됨 — R 키 또는 ↺ 로 저궤도에 재배치</div>'; return; }
  const r = s.ref, rr = sub(s.pos, r.pos), vv = sub(s.vel, r.vel), el = stateToElements(G * r.mass, rr, vv), m = s.mass();
  const eq = stateToElements(G * r.mass, tiltVec(rr, -r.tilt * D2R), tiltVec(vv, -r.tilt * D2R));
  const gl = G * r.mass / (len(rr) ** 2);
  it('기준', r.name); it('고도', fDist(len(rr) - r.radius)); it('속도', fSpeed(len(vv)));
  it('근점 고도', fDist(el.pe - r.radius)); it('원점 고도', el.e < 1 ? fDist(el.ap - r.radius) : '탈출'); it('경사(적도)', num(eq.i / D2R, 1) + '°');
  it('주기', fTime(el.period)); it('Δv 잔량', fSpeed(s.dv())); it('TWR', num(s.eng.thrust / (m * gl), 2));
  it('질량', num(m / 1000, 2) + ' t'); it('Isp', num(s.eng.isp, 0) + ' s'); it('열유속', s.heat > 1e3 ? sci(s.heat) + ' W/m²' : '—');
  const pr = s.pred;
  if (s.landed) st.push(`<div class="warn">${s.landed.body.name} 표면에 착륙 중 — 스로틀을 올려 이륙 (TWR > 1 필요)</div>`);
  if (pr && pr.enc) st.push(`<div class="warn">➜ ${pr.enc.body.name} 영향권 진입 T+${fTime(pr.enc.t)} · 최근접 고도 ${fDist(pr.enc.peri - pr.enc.body.radius)}</div>`);
  if (pr && pr.impact) st.push(`<div class="bad">⚠ 충돌 예상: ${pr.impact.body.name} T+${fTime(pr.impact.t)}</div>`);
  if (s.burning() && WARPS[warpI] > warpCap()) st.push(`<div class="warn">추진 중 — 시간 가속 ${num(warpCap(), 0)}× 로 제한</div>`);
  $('ship-stats').innerHTML = st.join('');
}

function topbar() {
  let t;
  if (cfg.timeMode === 'date') { const d = new Date((sim.t / 86400 + 2451545 - 2440587.5) * 86400000); t = isNaN(d) ? fTime(sim.t) : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; }
  else t = 'T + ' + fTime(sim.t - sim.t0);
  $('date').textContent = t;
  const w = WARPS[warpI];
  $('warp').textContent = paused ? '정지' : `${w < 1e4 ? num(w, 0) : w.toExponential(0)}× · ${fTime(w)}/s`;
  $('w-pause').textContent = paused ? '▶' : '⏸';
}

function diagPanel() {
  const d = sim.diagnostics(), parts = sim.groups.reduce((s, g) => s + g.alive.reduce((a, x) => a + x, 0), 0);
  $('diag').innerHTML = `<b>FPS</b> ${fps.toFixed(0)}   <b>N</b> ${sim.bodies.length} 천체 + ${parts.toLocaleString()} 입자
<b>적분기</b> ${METHODS[sim.method].split(' (')[0]}  η=${sim.eta.toFixed(3)}
<b>dt</b> ${fTime(sim.lastDt)} × ${sim.steps} 스텝/프레임
<b>실효 가속</b> ${effWarp < 1e4 ? num(effWarp, 1) : effWarp.toExponential(2)}×
<b>ΔE/E₀</b> ${sci((d.E - E0) / Math.abs(E0))}   <b>ΔL/L₀</b> ${sci(L0 ? (d.L - L0) / L0 : 0)}
<b>E</b> ${sci(d.E)} J   <b>|P|</b> ${sci(d.P)} kg·m/s`;
}

function syncControls() {
  $('method').value = sim.method; $('eta').value = Math.log10(sim.eta); $('eta-v').textContent = sim.eta.toFixed(3);
  $('gr').checked = sim.gr; $('collide').checked = sim.collide; $('orbit-mode').value = opt.orbitMode;
  $('lens-on').checked = opt.lens; $('labels-on').checked = opt.labels; $('parts-on').checked = opt.parts;
}

// ───────── 입력 ─────────
const canvas = $('gl'), ptrs = new Map();
let drag = null, pinch = 0, placing = false, place = null, lastClick = 0;
function screenRay(x, y) {
  const v = new THREE.Vector3(x / view.W * 2 - 1, -(y / view.H) * 2 + 1, 0.5).unproject(view.camera);
  return v.normalize();
}
function planeHit(x, y) {
  const d = screenRay(x, y), fp = posOf(focus), f = new THREE.Vector3(); toR(fp[0] - camW[0], fp[1] - camW[1], fp[2] - camW[2], f);
  if (Math.abs(d.y) < 1e-9) return null; const t = f.y / d.y; if (t <= 0) return null;
  const h = d.multiplyScalar(t * U); return [camW[0] + h.x, camW[1] - h.z, camW[2] + h.y];
}
function pick(x, y) {
  const tmp = new THREE.Vector3(); let best = null, bd = 1e9;
  for (const v of view.vis.values()) {
    const p = view.project(v.g.position, tmp); if (!p.ok) continue;
    const d = Math.hypot(p.x - x, p.y - y); if (d < Math.max(16, v.pr || 0) && d - (v.pr || 0) < bd) { bd = d - (v.pr || 0); best = v.b; }
  }
  return best;
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = null; return; }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  if (placing) { const h = planeHit(e.clientX, e.clientY); place = h ? { a: h, b: h } : null; }
});
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) cam.tdist *= pinch / d; pinch = d; return; }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
  if (placing && place) { const h = planeHit(e.clientX, e.clientY); if (h) place.b = h; return; }
  cam.yaw -= dx * 0.005; cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.005));
});
canvas.addEventListener('pointerup', e => {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = 0;
  if (!drag) return;
  const moved = drag.moved; drag = null;
  if (placing) { if (place) doPlace(place, moved > 6); place = null; setPlacing(false); return; }
  if (moved < 5) {
    const b = pick(e.clientX, e.clientY), now = performance.now();
    if (b) { sel = b; if (now - lastClick < 350) setFocus(b); }
    lastClick = now;
  }
});
canvas.addEventListener('dblclick', e => { const b = pick(e.clientX, e.clientY); if (b) { sel = b; setFocus(b); } });
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.tdist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function doPlace(pl, dragged) {
  const c = focus && focus !== BARY && focus !== ship ? focus : (ship && focus === ship ? ship.ref : root());
  const r = sub(pl.a, c.pos), rm = len(r); if (rm < (c.radius || 0) * 2) { toast('중심 천체에 너무 가깝습니다', 'warn'); return; }
  const mult = 10 ** +$('spawn-mass').value, b = spawnBody($('spawn-kind').value, mult, pl.a, [0, 0, 0]);
  const vc = Math.sqrt(G * (c.mass + b.mass) / rm);
  const dv = dragged ? mul(sub(pl.b, pl.a), vc / rm) : mul(norm(cross([0, 0, 1], r)), vc);
  b.vel = add(c.vel, dv);
  sim.bodies.push(b); hierarchy(); resetE(); listSig = '';
  toast(`✨ ${b.name} 생성 (${fMass(b.mass)}, ${c.name} 기준 ${fDist(rm)})`);
}
const prevLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: 0x6dffb0 }));
prevLine.frustumCulled = false; view.scene.add(prevLine);
function updatePreview() {
  prevLine.visible = !!(placing && place);
  if (!prevLine.visible) return;
  const a = prevLine.geometry.attributes.position.array, t = new THREE.Vector3();
  toR(place.a[0] - camW[0], place.a[1] - camW[1], place.a[2] - camW[2], t).toArray(a, 0);
  toR(place.b[0] - camW[0], place.b[1] - camW[1], place.b[2] - camW[2], t).toArray(a, 3);
  prevLine.geometry.attributes.position.needsUpdate = true;
}

const SAS_KEYS = { Digit1: 'stab', Digit2: 'pro', Digit3: 'retro', Digit4: 'normal', Digit5: 'anti', Digit6: 'radout', Digit7: 'radin' };
function focusList() { const l = bodyTree().map(x => x[0]); if (ship && ship.alive) l.unshift(ship); return l; }
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  const c = e.code;
  if (c === 'Comma') warpI = Math.max(0, warpI - 1);
  else if (c === 'Period') warpI = Math.min(WARPS.length - 1, warpI + 1);
  else if (c === 'Slash') warpI = 0;
  else if (c === 'Space') { paused = !paused; e.preventDefault(); }
  else if (c === 'BracketLeft' || c === 'BracketRight') { const l = focusList(), i = l.indexOf(focus); setFocus(l[(i + (c === 'BracketRight' ? 1 : l.length - 1)) % l.length]); }
  else if (c === 'KeyF' && ship && ship.alive) setFocus(ship);
  else if (c === 'KeyG') setFocus(BARY);
  else if (c === 'KeyO') { const m = ['kepler', 'trail', 'off']; opt.orbitMode = m[(m.indexOf(opt.orbitMode) + 1) % 3]; syncControls(); toast('궤도 표시: ' + $('orbit-mode').selectedOptions[0].text); }
  else if (c === 'KeyL') { opt.labels = !opt.labels; syncControls(); }
  else if (c === 'KeyH') $('help').classList.toggle('hidden');
  else if (c === 'Escape') { $('help').classList.add('hidden'); setPlacing(false); }
  else if (ship) {
    if (c === 'KeyZ') ship.throttle = 1; else if (c === 'KeyX') ship.throttle = 0;
    else if (c === 'KeyT') ship.sas = 'off'; else if (SAS_KEYS[c]) ship.sas = SAS_KEYS[c];
    else if (c === 'KeyR') respawn();
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(c) && ship) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
function respawn() {
  if (!shipInit) return;
  const E = sim.bodies.find(b => b.en === 'Earth'); if (!E) return;
  const a = E.radius + 400e3, v = Math.sqrt(G * E.mass / a), ph = Math.random() * Math.PI * 2;
  const r = tiltVec([a * Math.cos(ph), a * Math.sin(ph), 0], E.tilt * D2R), vv = tiltVec([-v * Math.sin(ph), v * Math.cos(ph), 0], E.tilt * D2R);
  const fuel = ship ? ship.fuel : null, eng = ship ? ship.engine : 'chem';
  shipInit = { pos: add(E.pos, r), vel: add(E.vel, vv) }; spawnShip(); ship.engine = eng; $('engine').value = eng;
  if (fuel !== null) ship.fuel = Math.max(fuel, ship.fuelMax * 0.5);
  if (!labels.has('ship')) addLabel(SHIPL);
  setFocus(ship); toast('🚀 지구 저궤도 400 km 에 우주선 재배치');
}
function warpCap() { return ship && ship.burning() ? (['off', 'stab'].includes(ship.sas) ? 1e3 : 1e5) : Infinity; }

// ───────── 컨트롤 바인딩 ─────────
for (const [k, s] of Object.entries(SCENARIOS)) {
  $('scenario').add(new Option(s.name, k));
  const b = document.createElement('button'); b.innerHTML = `<b>${s.name}</b><span>${s.desc}</span>`;
  b.onclick = () => { $('intro').classList.add('hidden'); load(k); }; $('scen-cards').append(b);
}
for (const [k, v] of Object.entries(METHODS)) $('method').add(new Option(v, k));
for (const [k, v] of Object.entries(ENGINES)) $('engine').add(new Option(`${v.name} · Isp ${v.isp} s`, k));
for (const [k, v] of Object.entries(SAS)) { const b = document.createElement('button'); b.textContent = v; b.dataset.m = k; b.onclick = () => ship && (ship.sas = k); $('sas').append(b); }
const blurAfter = el => el.addEventListener('change', () => el.blur());
['scenario', 'method', 'orbit-mode', 'engine', 'spawn-kind'].forEach(id => blurAfter($(id)));
$('scenario').onchange = e => load(e.target.value);
$('method').onchange = e => { sim.method = e.target.value; resetE(); };
$('eta').oninput = e => { sim.eta = 10 ** +e.target.value; $('eta-v').textContent = sim.eta.toFixed(3); };
$('gr').onchange = e => { sim.gr = e.target.checked; resetE(); };
$('collide').onchange = e => { sim.collide = e.target.checked; };
$('orbit-mode').onchange = e => { opt.orbitMode = e.target.value; };
$('labels-on').onchange = e => { opt.labels = e.target.checked; };
$('parts-on').onchange = e => { opt.parts = e.target.checked; };
$('lens-on').onchange = e => { opt.lens = e.target.checked; };
$('bloom').oninput = e => { opt.bloom = +e.target.value; };
$('spawn-mass').oninput = e => { $('spawn-mass-v').textContent = num(10 ** +e.target.value, 2) + '×'; };
function setPlacing(on) { placing = on; canvas.classList.toggle('placing', on); $('spawn-btn').classList.toggle('on', on); $('spawn-btn').textContent = on ? '배치 중… (Esc 취소)' : '🖱 클릭하여 배치'; }
$('spawn-btn').onclick = () => setPlacing(!placing);
$('w-down').onclick = () => (warpI = Math.max(0, warpI - 1)); $('w-up').onclick = () => (warpI = Math.min(WARPS.length - 1, warpI + 1));
$('w-1').onclick = () => (warpI = 0); $('w-pause').onclick = () => (paused = !paused);
$('btn-help').onclick = () => $('help').classList.remove('hidden');
$('btn-scen').onclick = () => $('intro').classList.remove('hidden');
$('btn-info').onclick = () => document.body.classList.toggle('info');
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('close')) m.classList.add('hidden'); }));
$('btn-focus').onclick = () => sel && setFocus(sel);
$('btn-del').onclick = () => {
  if (!sel || sim.bodies.length < 2) return;
  sel.alive = false; sim.bodies = sim.bodies.filter(b => b.alive); toast(`${sel.name} 삭제`);
  if (focus === sel) setFocus(root()); sel = null; hierarchy(); resetE(); listSig = '';
};
$('engine').onchange = e => ship && (ship.engine = e.target.value);
$('refuel').onclick = () => { if (ship) { ship.fuel = ship.fuelMax; toast('⛽ 연료 재보급 완료'); } };
$('respawn').onclick = respawn;
$('thr-bar').addEventListener('pointerdown', e => {
  const set = ev => { const r = $('thr-bar').getBoundingClientRect(); if (ship) ship.throttle = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
  set(e); const mv = ev => set(ev), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
$('left').querySelector('.fold').onclick = () => { $('left').classList.add('hidden'); $('open-left').classList.remove('hidden'); };
$('open-left').onclick = () => { $('left').classList.remove('hidden'); $('open-left').classList.add('hidden'); };
if (innerWidth < 860) { $('left').classList.add('hidden'); $('open-left').classList.remove('hidden'); }
function resize() { view.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();

// ───────── 메인 루프 ─────────
let last = performance.now(), frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(1e-4, (now - last) / 1000)); last = now; fps += (1 / dt - fps) * 0.05;
  // 우주선 조종
  if (ship && ship.alive) {
    const k = c => (keys.has(c) ? 1 : 0);
    if (k('ShiftLeft') || k('ShiftRight')) ship.throttle = Math.min(1, ship.throttle + dt * 0.7);
    if (k('KeyC')) ship.throttle = Math.max(0, ship.throttle - dt * 0.7);
    if (!paused) ship.updateAttitude(dt, { x: k('KeyS') - k('KeyW'), y: k('KeyA') - k('KeyD'), z: k('KeyE') - k('KeyQ') });
    if (ship.landed) {
      const L = ship.landed, b = L.body;
      if (!b.alive) { ship.alive = false; }
      else {
        ship.pos = add(b.pos, L.rel); ship.vel = b.vel.slice();
        const up = norm(L.rel), a = ship.burning() ? ship.eng.thrust * ship.throttle / ship.mass() : 0;
        if (a > G * b.mass / b.radius ** 2 && up[0] * ship.dir[0] + up[1] * ship.dir[1] + up[2] * ship.dir[2] > 0.3) {
          ship.landed = null; ship.pos = add(b.pos, mul(up, b.radius + 3)); ship.vel = add(b.vel, mul(up, 2)); toast(`🚀 ${b.name}에서 이륙`);
        }
      }
    }
  }
  // 물리 진행
  if (!paused && sim.bodies.length) {
    const want = Math.min(WARPS[warpI], warpCap()) * dt;
    const mx = root().mass, perts = sim.bodies.filter(b => b.mass >= 1e-4 * mx).sort((a, b) => b.mass - a.mass).slice(0, 8).map(b => ({ b, s: b.pos.slice() }));
    const done = sim.advance(want, 14);
    sim.advanceGroups(done, perts.map(({ b, s }) => ({ m: b.mass, rs: b.type === 'blackhole' ? 2 * G * b.mass / (C * C) : 0, R: b.radius, s, e: b.pos })));
    effWarp += (done / dt - effWarp) * 0.1;
    if (ship) { ship.heat = ship.heatAcc; ship.heatAcc = 0; }
  } else effWarp = 0;
  handleEvents();
  const tick = (key, every) => { timers[key] -= dt; if (timers[key] <= 0) { timers[key] = every; return true; } return false; };
  if (tick('hier', 0.25)) hierarchy();
  if (opt.orbitMode === 'trail' && sim.t - lastTrail >= cfg.trailDt) { view.addTrailSample(sim.bodies, cfg.trailFrame); lastTrail = sim.t; }
  if (opt.orbitMode === 'kepler' && tick('orb', 0.2)) view.updateOrbits(sim.bodies, focus && focus.id);
  if (ship && ship.alive && !ship.landed && tick('pred', 0.35)) ship.predict(sim);
  if (ship && ship.landed) ship.pred = null;
  if (focus === ship && ship && !ship.alive) setFocus(ship.ref || root());
  if (focus && focus !== BARY && focus !== ship && !focus.alive) setFocus(root());
  const look = updateCamera(dt);
  updatePreview();
  view.update(sim, camW, look, cam.dist, { dtReal: dt, orbitMode: opt.orbitMode, showParticles: opt.parts, ship, lens: opt.lens && cfg.lens, bloom: opt.bloom });
  updateLabels();
  if (tick('ui', 0.15)) {
    topbar(); buildBodyList();
    $('info').innerHTML = infoHTML(sel && sel.alive ? sel : (focus && focus.type !== 'bary' && focus !== ship ? focus : null));
    if (ship) shipHUD();
  }
  if (tick('diag', 0.5)) diagPanel();
  if (++frames === 3) { $('loading').classList.add('done'); }
}

load('solar');
$('intro').classList.remove('hidden');
requestAnimationFrame(frame);
// 디버그/자동화용
window.spacesim = { get sim() { return sim; }, cam, view, opt, setFocus, focusName: n => setFocus(sim.bodies.find(b => b.en === n || b.name === n)), setWarp: w => (warpI = WARPS.indexOf(w)), get ship() { return ship; } };
