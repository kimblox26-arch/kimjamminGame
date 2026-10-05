// SpaceSim — 우주 실험실: 빈 우주에 실제 천체를 배치·발사하고 충돌시키는 실험 공간
// 탭 = 원궤도(또는 정지) 배치, 드래그 = 속도 지정(1.5초 뒤 도달 지점) + 예상 궤적
// 충돌: 저속 = 병합 + 파편, 고속 = 파괴(원시 위성 파편 생성), 항성/블랙홀 = 흡수
import * as THREE from 'three';
import { NBodyScenario } from './nbody-base.js';
import { BODIES, visRadius } from '../catalog.js';
import { G_AU, TAU, AU_KM, rng, gauss, fmtDuration, fmtMass, DEG, iauFrame } from '../util.js';

const KM = 1 / AU_KM;
const SEC_YR = 1 / 31557600;
const SPAWN = ['sun', 'sirius', 'proxima', 'whitedwarf', 'neutron', 'blackhole', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'theia', 'asteroid'];

export class LabScenario extends NBodyScenario {
  constructor(app) {
    super(app, {
      G: G_AU, dtMax: 0.0008, merge: true, fragments: true, adaptive: true, eta: 0.03, trailLen: 420, trailFrame: true,
      softening: 0, minFrag: 1e-13, maxBodies: app.quality.maxBodies,
    });
    this.tool = 'launch';
    this.type = 'earth';
    this.massMul = 1;
    this.real = !!app.labReal;
    this.count = {};
    this.r = rng(Date.now() & 0xffff);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ray = new THREE.Raycaster();
    this.drag = null;
    const mk = (color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 700), 3).setUsage(THREE.DynamicDrawUsage));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      l.frustumCulled = false; l.visible = false;
      this.root.add(l);
      return l;
    };
    this.arrow = mk(0x8fd0ff, 0.95);
    this.predict = mk(0xffc080, 0.65);
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x8fd0ff, wireframe: true, transparent: true, opacity: 0.45 }));
    this.ghost.visible = false;
    this.root.add(this.ghost);
    this.grid = new THREE.PolarGridHelper(1, 12, 10, 96, 0x4a6aa0, 0x2a3a60);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.13; this.grid.material.depthWrite = false;
    this.root.add(this.grid);
    app.controls.interceptor = (t, e) => this._pointer(t, e);
    this.preset = app.labPreset || 'empty';
    this.loadPreset(this.preset, true);
  }

  // 단위 길이: 강조 모드 = 지구 시각 반지름(0.04 AU), 실제 모드 = 지구 실제 반지름
  get L() { return this.real ? 6371 * KM : 0.04; }

  radiusFor(def) { return this.real ? def.R * KM : visRadius(def); }

  // ── 천체 생성 ──
  spawn(key, p, v, extra = {}) {
    const def = BODIES[key];
    const m = def.m * (extra.mul ?? this.massMul);
    const R = this.radiusFor(def) * Math.cbrt(extra.mul ?? this.massMul);
    this.count[key] = (this.count[key] || 0) + 1;
    const name = this.count[key] > 1 ? `${def.name} ${this.count[key]}` : def.name;
    const temp = def.temp ?? 5800;
    const d = {
      ...def, name, m, p, v, visR: R, realR: def.R * KM, collideR: R, rotRate: def.iau ? def.iau[5] * DEG * 365.25 : 300,
      kind: def.kind ?? 'planet', temp, glow: def.kind === 'star' ? 2.1 : undefined, coronaI: 1.1,
      orbit: def.kind !== 'star' && def.kind !== 'blackhole', iau: undefined, ...extra,
    };
    if (def.kind === 'star' && def.R < 50000) { d.visR = d.collideR = Math.max(R, this.real ? R : 0.02); d.glow = 3; }
    const b = this.addBody(d);
    b.key = key;
    if (def.iau) b.visual.setOrientation(iauFrame(def.iau, 0).quat);
    return b;
  }

  heaviest() {
    let best = null;
    for (const b of this.bodies) if (!best || this.sim.m[b.idx] > this.sim.m[best.idx]) best = b;
    return best;
  }

  circularVel(p) {
    const H = this.heaviest();
    if (!H) return [0, 0, 0];
    const s = this.sim, i = H.idx;
    const dx = p[0] - s.x[i], dz = p[2] - s.z[i], r = Math.hypot(dx, dz) || 1;
    const vc = Math.sqrt((G_AU * s.m[i]) / r);
    return [s.vx[i] - (dz / r) * vc, 0, s.vz[i] + (dx / r) * vc];
  }

  // ── 포인터 ──
  _hit(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.app.camera);
    this.plane.constant = -this.app.controls.target.y;
    return this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  _bodyAt(x, y) {
    const cam = this.app.camera, v = new THREE.Vector3();
    let best = null, bd = Infinity;
    for (const b of this.bodies) {
      v.copy(b.vis).project(cam);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * this.app.width, sy = (-v.y * 0.5 + 0.5) * this.app.height;
      const d = Math.hypot(sx - x, sy - y);
      if (d < Math.max(18, b.px + 6) && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _pointer(type, e) {
    if (type === 'down') {
      if (this.tool === 'camera' || e.button === 2) return false;
      const target = this._bodyAt(e.clientX, e.clientY);
      if (this.tool === 'delete') {
        if (target) { this._vaporize(target); return true; }
        return false;
      }
      if (target) return false;
      const p = this._hit(e);
      if (!p) return false;
      this.drag = { p0: p, p1: p.clone(), sx: e.clientX, sy: e.clientY };
      this.ghost.visible = true;
      this.ghost.position.copy(p);
      this.ghost.scale.setScalar(this.radiusFor(BODIES[this.type]) * Math.cbrt(this.massMul));
      return true;
    }
    if (!this.drag) return type !== 'cancel' && this.tool === 'delete';
    if (type === 'move') {
      const p = this._hit(e);
      if (p) this.drag.p1.copy(p);
      this._preview();
    } else if (type === 'up') {
      const d = this.drag;
      this.drag = null;
      this.arrow.visible = this.predict.visible = this.ghost.visible = false;
      const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
      const p = [d.p0.x, d.p0.y, d.p0.z];
      const v = moved < 10 ? this.circularVel(p) : this._dragVel(d);
      const b = this.spawn(this.type, p, v);
      this.app.audio?.blip(420);
      this.app.toast(`${b.name} 배치 — ${moved < 10 ? (this.sim.n > 1 ? '원궤도' : '정지') : '사용자 속도'}`);
    } else {
      this.drag = null;
      this.arrow.visible = this.predict.visible = this.ghost.visible = false;
    }
    return true;
  }

  _vaporize(b) {
    this.flashes.spawn(b.vis.clone(), b.visR * 3, 0x9fd0ff);
    this.removeBody(b);
    this.app.toast(`${b.name || '천체'} 제거`);
  }

  // 드래그 길이 = 1.5초(실시간) 동안 이동할 거리
  _dragVel(d) {
    const k = 1 / (1.5 * Math.max(this.app.warp, 1e-12));
    const H = this.heaviest(), s = this.sim;
    const base = H ? [s.vx[H.idx], s.vy[H.idx], s.vz[H.idx]] : [0, 0, 0];
    return [base[0] + (d.p1.x - d.p0.x) * k, base[1], base[2] + (d.p1.z - d.p0.z) * k];
  }

  _preview() {
    const d = this.drag;
    const ap = this.arrow.geometry.attributes.position;
    ap.setXYZ(0, d.p0.x, d.p0.y, d.p0.z); ap.setXYZ(1, d.p1.x, d.p1.y, d.p1.z);
    ap.needsUpdate = true;
    this.arrow.geometry.setDrawRange(0, 2);
    this.arrow.visible = true;
    const s = this.sim, n = s.n;
    let x = d.p0.x, y = d.p0.y, z = d.p0.z;
    let [vx, vy, vz] = d.p0.distanceTo(d.p1) < 1e-12 ? this.circularVel([x, y, z]) : this._dragVel(d);
    const T = 8 * this.app.warp;
    const pp = this.predict.geometry.attributes.position;
    let count = 0, t = 0;
    for (let k = 0; k < 1400 && t < T; k++) {
      let ax = 0, ay = 0, az = 0, minR = Infinity, hit = false;
      for (let i = 0; i < n; i++) {
        const dx = s.x[i] - x, dy = s.y[i] - y, dz = s.z[i] - z, r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2);
        if (r < s.r[i]) hit = true;
        const f = (G_AU * s.m[i]) / (r2 * r + 1e-30);
        ax += dx * f; ay += dy * f; az += dz * f;
        if (r < minR) minR = r;
      }
      const h = Math.min(T / 300, (0.02 * minR) / (Math.hypot(vx, vy, vz) + 1e-9));
      vx += ax * h; vy += ay * h; vz += az * h; x += vx * h; y += vy * h; z += vz * h; t += h;
      if (k % 2 === 0 && count < 700) pp.setXYZ(count++, x, y, z);
      if (hit) break;
    }
    pp.needsUpdate = true;
    this.predict.geometry.setDrawRange(0, count);
    this.predict.visible = true;
  }

  // ── 프리셋 ──
  clearAll() {
    for (const b of [...this.bodies]) this.removeBody(b);
    this.debris?.clear();
    this.sim.time = 0;
    this._trailDue = 0;
    this.count = {};
  }

  loadPreset(key, initial = false) {
    this.preset = key;
    this.app.labPreset = key;
    this.clearAll();
    const L = this.L, R = this.r, c = this.app.controls;
    const vesc = (m, r) => Math.sqrt((2 * G_AU * m) / r);
    let view = 30 * L, warp = this.real ? 1 / (365.25 * 48) : 0.2, msg = '';
    if (key === 'empty') {
      msg = '빈 우주입니다. 카탈로그에서 천체를 고르고 화면을 탭(정지/원궤도)하거나 드래그(속도)하세요';
      view = 40 * L;
    } else if (key === 'theia') {
      const E = BODIES.earth, Th = BODIES.theia;
      const rE = this.radiusFor(E), rT = this.radiusFor(Th);
      const v = vesc(E.m + Th.m, rE + rT) * 1.55;
      this.spawn('earth', [0, 0, 0], [0, 0, 0], { mul: 1, name: '원시 지구', look: { ...E.look, clouds: false }, tex: { map: 'earth_day', normal: 'earth_normal' } });
      this.spawn('theia', [-14 * L, 0, (rE + rT) * 0.7], [v, 0, 0], { mul: 1 });
      this.sim.toCOM();
      view = 12 * L; warp = (14 * L) / v / 6;
      msg = '거대 충돌 가설: 화성 크기의 테이아가 원시 지구에 비스듬히 충돌 → 파편이 궤도를 돌며 달이 됩니다';
    } else if (key === 'headon') {
      const E = BODIES.earth, Ma = BODIES.mars;
      const v = vesc(E.m + Ma.m, this.radiusFor(E) + this.radiusFor(Ma)) * 2.6;
      this.spawn('earth', [0, 0, 0], [0, 0, 0], { mul: 1 });
      this.spawn('mars', [-16 * L, 0, 0.15 * L], [v, 0, 0], { mul: 1 });
      this.sim.toCOM();
      view = 12 * L; warp = (16 * L) / v / 5;
      msg = '지구와 화성이 탈출 속도의 2.6배로 정면 충돌 → 파괴적 충돌과 파편 비';
    } else if (key === 'impacts') {
      const E = BODIES.earth, rE = this.radiusFor(E);
      this.spawn('earth', [0, 0, 0], [0, 0, 0], { mul: 1 });
      const md = 18 * rE, vm = Math.sqrt((G_AU * (E.m + BODIES.moon.m)) / md);
      this.spawn('moon', [md, 0, 0], [0, 0, vm], { mul: 1 });
      const vE = vesc(E.m, rE);
      for (let k = 0; k < 14; k++) {
        const a = -0.5 + (R() - 0.5) * 0.5, dist = (30 + R() * 25) * rE;
        const p = [-Math.cos(a) * dist, (R() - 0.5) * 2 * rE, Math.sin(a) * dist];
        const aim = [(R() - 0.5) * 2.4 * rE, (R() - 0.5) * rE, (R() - 0.5) * 2.4 * rE];
        const dir = new THREE.Vector3(aim[0] - p[0], aim[1] - p[1], aim[2] - p[2]).normalize().multiplyScalar(vE * (0.6 + R() * 0.8));
        this.spawn('asteroid', p, [dir.x, dir.y, dir.z], { mul: 40 + R() * 300 });
      }
      this.sim.toCOM();
      view = 26 * rE; warp = (40 * rE) / vE / 10;
      msg = '소행성 폭격: 지구와 달로 쏟아지는 소행성들 — 충돌 지점마다 파편과 용암이 튑니다';
    } else if (key === 'blackhole') {
      this.spawn('sun', [0, 0, 0], [0, 0, 0]);
      const as = [0.4, 0.72, 1.0, 1.52, 3.0, 5.2];
      ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'].forEach((k, i) => {
        const a = as[i], ang = R() * TAU, p = [Math.cos(ang) * a, 0, Math.sin(ang) * a];
        this.spawn(k, p, this.circularVel(p));
      });
      this.spawn('blackhole', [24, 1.5, 4], [-7, -0.3, 0]);
      view = 18; warp = 0.35;
      msg = '10 M☉ 블랙홀이 행성계를 관통합니다 — 궤도가 찢기고 행성이 흡수·방출됩니다';
    } else if (key === 'binary') {
      const m1 = 1, m2 = 0.6, a = 1.2, M = m1 + m2, v = Math.sqrt((G_AU * M) / a);
      this.spawn('sun', [-a * m2 / M, 0, 0], [0, 0, -v * m2 / M]);
      this.spawn('proxima', [a * m1 / M, 0, 0], [0, 0, v * m1 / M], { mul: m2 / BODIES.proxima.m });
      for (const [k, r] of [['earth', 3.6], ['mars', 5.5], ['neptune', 8.5]]) { const ang = R() * TAU, p = [Math.cos(ang) * r, 0, Math.sin(ang) * r]; this.spawn(k, p, this.circularVel(p)); }
      view = 16; warp = 0.6;
      msg = '쌍성과 주쌍성 행성들: 안쪽 행성일수록 궤도가 불안정해집니다';
    } else if (key === 'system') {
      this.spawn('sun', [0, 0, 0], [0, 0, 0]);
      [['mercury', 0.4], ['venus', 0.72], ['earth', 1], ['mars', 1.52], ['jupiter', 3.2], ['saturn', 5.2], ['uranus', 8], ['neptune', 11]].forEach(([k, a]) => {
        const ang = R() * TAU, p = [Math.cos(ang) * a, 0, Math.sin(ang) * a];
        this.spawn(k, p, this.circularVel(p));
      });
      view = 14; warp = 0.4;
      msg = '실제 질량의 행성계 (거리는 압축). 천체를 던져 넣어 보세요';
    } else if (key === 'disk') {
      this.spawn('sun', [0, 0, 0], [0, 0, 0]);
      const N = this.app.quality.proto;
      for (let k = 0; k < N; k++) {
        const a = 0.45 + Math.pow(R(), 0.8) * 2.4, ang = R() * TAU;
        const p = [Math.cos(ang) * a, gauss(R) * 0.01, Math.sin(ang) * a];
        const v = this.circularVel(p), ecc = 1 + gauss(R) * 0.02, m = 6e-7 * (0.5 + R());
        this.addBody({
          name: '', label: false, small: true, style: 'lava', look: { colA: 0x2c2420, colB: 0x6a5446, spot: 0 }, color: 0xd8a080,
          m, visR: 0.011 * Math.cbrt(m / 6e-7), realR: 2000 * KM, collideR: 0.011 * Math.cbrt(m / 6e-7), p, v: [v[0] * ecc, gauss(R) * 0.02, v[2] * ecc],
          orbit: false, trailLen: 90, trailOpacity: 0.35, rotRate: 300, markerA: 0.5, type: '미행성',
          desc: '원시행성 원반의 미행성. 충돌·병합을 거듭하며 원시행성으로 성장합니다.',
        });
      }
      view = 7; warp = 0.5;
      msg = `미행성 ${N}개 — 충돌·병합으로 원시행성이 자라는 과정을 지켜보세요`;
    }
    this.sim.computeAcc();
    this.E0 = null;
    this.grid.scale.setScalar(['blackhole', 'binary', 'system', 'disk'].includes(key) ? 12 : 40 * L);
    c.follow = null; c.trans = null;
    c.target.set(0, 0, 0);
    c.minR = this.real ? 2e-6 : 0.004; c.maxR = 400; c.minNear = 1e-9; c.minFar = 0;
    c.set({ theta: 0.5, phi: 0.95, radius: view * 2.2, jump: true });
    c.set({ radius: view });
    this.pendingWarp = warp;
    if (!initial) this.app.setWarp(warp);
    if (!initial || key !== 'empty') this.app.toast(msg);
  }

  setReal(on) {
    this.real = on;
    this.app.labReal = on;
    this.loadPreset(this.preset);
    this.app.toast(on ? '실제 크기 모드: 천체 반지름 = 실제 반지름 (충돌도 실제 크기 기준)' : '강조 크기 모드: 천체를 크게 표시하고 충돌도 그 크기로 판정');
  }

  onMerged(info) {
    const a = info.survivor;
    if (!a.name && this.sim.m[a.idx] > 4e-6) {
      a.name = `원시행성 ${(this.count.proto = (this.count.proto || 0) + 1)}`;
      a.label = true;
      a.labelEl = this.app.labels.add(a.name, () => this.select(a, true));
      a.markerA = 1;
    }
  }

  get warp() { return { min: SEC_YR, max: 50, def: this.pendingWarp ?? 0.2, fmt: (w) => `${fmtDuration(w)}/초` }; }

  start() {
    if (this.preset === 'empty') this.app.setPanel?.(true);
    if (this.preset === 'empty') this.app.toast('빈 우주 — 아래 패널에서 천체를 고르고 화면을 탭하세요');
  }

  focusRadius(b) { return Math.max(b.visR * 8, this.real ? 1e-5 : 0.15); }

  clock() { return { main: `${fmtDuration(this.sim.time)}`, sub: `천체 ${this.sim.n}개 · 파편 ${this.debris?.count || 0}` }; }

  panel() {
    return [
      { type: 'chips', label: '도구', radio: true, value: this.tool, items: [
        { key: 'launch', label: '배치·발사', on: () => (this.tool = 'launch') },
        { key: 'camera', label: '카메라', on: () => (this.tool = 'camera') },
        { key: 'delete', label: '제거', on: () => (this.tool = 'delete') },
      ] },
      { type: 'chips', label: '천체 카탈로그 (실측 질량·반지름)', radio: true, value: this.type, small: true, items: SPAWN.map((k) => ({ key: k, label: BODIES[k].name, on: () => { this.type = k; this.app.toast(`${BODIES[k].name} · ${fmtMass(BODIES[k].m * this.massMul)} · 반지름 ${Math.round(BODIES[k].R).toLocaleString()} km`); } })) },
      { type: 'slider', label: '질량 배율', min: -2, max: 2, step: 0.01, value: Math.log10(this.massMul), fmt: (v) => `${(10 ** v).toFixed(v < 0 ? 2 : 1)}×`, on: (v) => (this.massMul = 10 ** v) },
      { type: 'chips', label: '실험 프리셋', radio: true, value: this.preset, items: [
        { key: 'empty', label: '빈 우주', on: () => this.loadPreset('empty') },
        { key: 'theia', label: '거대 충돌 (달 탄생)', on: () => this.loadPreset('theia') },
        { key: 'headon', label: '행성 정면 충돌', on: () => this.loadPreset('headon') },
        { key: 'impacts', label: '소행성 폭격', on: () => this.loadPreset('impacts') },
        { key: 'blackhole', label: '블랙홀 침입', on: () => this.loadPreset('blackhole') },
        { key: 'binary', label: '쌍성계', on: () => this.loadPreset('binary') },
        { key: 'system', label: '행성계', on: () => this.loadPreset('system') },
        { key: 'disk', label: '원시행성 원반', on: () => this.loadPreset('disk') },
      ] },
      { type: 'toggle', label: '실제 크기 (반지름·충돌 판정)', value: this.real, on: (v) => this.setReal(v) },
      { type: 'toggle', label: '기준 격자', value: true, on: (v) => (this.grid.visible = v) },
      { type: 'readouts', items: ['천체 수', '파편 수', '총 질량', '적분 스텝/프레임'] },
      { type: 'hint', text: '탭: 정지(빈 우주) 또는 가장 무거운 천체 주위 원궤도 · 드래그: 화살표 끝 = 1.5초 뒤 위치(주황 선은 예상 궤적) · 천체를 탭하면 선택 · 두 손가락: 카메라. 충돌 속도가 탈출 속도의 1.3배를 넘으면 천체가 부서져 파편과 원시 위성이 생깁니다.' },
    ];
  }

  readouts() {
    let M = 0;
    for (let i = 0; i < this.sim.n; i++) M += this.sim.m[i];
    return { '천체 수': String(this.sim.n), '파편 수': String(this.debris?.count || 0), '총 질량': this.sim.n ? fmtMass(M) : '0', '적분 스텝/프레임': `${this.sim.lastSteps || 0}${this.lagging ? ' ⚠' : ''}` };
  }

  dispose() {
    this.app.controls.interceptor = null;
    super.dispose();
  }
}
