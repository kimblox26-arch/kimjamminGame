// SpaceSim — 샌드박스: 천체 발사(드래그로 속도 지정, 탭=원궤도), 충돌 병합, 원시행성 원반 강착
import * as THREE from 'three';
import { NBodyScenario } from './nbody-base.js';
import { G_AU, TAU, rng, gauss, fmtDuration, fmtMass, AU_KM } from '../util.js';

const KM = 1 / AU_KM;
const TYPES = {
  rocky: { label: '암석 행성', m: 3e-6, visR: 0.028, realKm: 6371 },
  gas: { label: '가스 행성', m: 9.5e-4, visR: 0.07, realKm: 69911 },
  star: { label: '적색왜성', m: 0.3, visR: 0.07, realKm: 300000 },
  hole: { label: '블랙홀', m: 6, visR: 0.05, realKm: 18 },
};
const ROCK_LOOKS = [
  { style: 'earth', look: { clouds: true, atmo: 0x5aa6ff, atmoDensity: 1.5 }, color: 0x6fb2ff },
  { style: 'mars', look: { colA: 0xb8582c, colB: 0x5c2c18, colC: 0xd99466, atmo: 0xff9e70, atmoDensity: 0.5 }, color: 0xe07850 },
  { style: 'rocky', look: { colA: 0x9c9a95, colB: 0x6e6c68, colC: 0x3a3938, spot: 0.6 }, color: 0xc8c0b8 },
  { style: 'europa', look: { colA: 0xe0eaf2, colB: 0xb8c8d8, colC: 0x6a7f99 }, color: 0xcfe0ff },
  { style: 'cloudy', look: { colA: 0xe9d4a6, colB: 0xc49c5e, colC: 0xfff3d6, atmo: 0xffd9a0 }, color: 0xf0d9a8 },
];
const GAS_LOOKS = [
  { style: 'gas', look: { colA: 0xdcc6a6, colB: 0xa36a45, colC: 0xf2e9da, spot: 1, bands: 14 }, color: 0xe0b98c },
  { style: 'gas', look: { colA: 0xead9b2, colB: 0xc4a46c, colC: 0xf5ecd4, bands: 18, rings: true }, color: 0xf0d9a0 },
  { style: 'ice', look: { colA: 0x4170e0, colB: 0x2c50b8, colC: 0x14204e, bands: 8, spot: 1, atmo: 0x6a9cff }, color: 0x5d8bff },
  { style: 'ice', look: { colA: 0xa6e6ec, colB: 0x83cbd8, colC: 0x5aa0b8, bands: 6, atmo: 0xaaf0ff }, color: 0x9fe6f0 },
];

export class SandboxScenario extends NBodyScenario {
  constructor(app) {
    super(app, { G: G_AU, dtMax: 0.0008, merge: true, adaptive: true, eta: 0.03, trailLen: 300, minFocus: 0.05, softening: 0.002 });
    this.tool = 'launch';
    this.type = 'rocky';
    this.count = 0;
    this.r = rng(Date.now() & 0xffff);
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ray = new THREE.Raycaster();
    this.drag = null;
    const mk = (color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 600), 3).setUsage(THREE.DynamicDrawUsage));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
      l.frustumCulled = false; l.visible = false;
      this.root.add(l);
      return l;
    };
    this.arrow = mk(0x8fd0ff, 0.95);
    this.predict = mk(0xffc080, 0.6);
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x8fd0ff, wireframe: true, transparent: true, opacity: 0.5 }));
    this.ghost.visible = false;
    this.root.add(this.ghost);
    this.reset();
    app.controls.interceptor = (t, e) => this._pointer(t, e);
  }

  reset() {
    for (const b of [...this.bodies]) this.removeBody(b);
    this.sim.time = 0;
    this.sun = this.addBody({
      name: '중심별', type: 'G형 주계열성', kind: 'star', temp: 5800, m: 1, visR: 0.12, realR: 695700 * KM, p: [0, 0, 0], v: [0, 0, 0],
      glow: 3.3, orbit: false, trailLen: 200, trailDt: 0.02, rotRate: 90, desc: '샌드박스의 중심 항성. 다른 천체를 던져 넣어 보세요.',
    });
  }

  _name(prefix) { return `${prefix}-${++this.count}`; }

  spawn(type, p, v, extra = {}) {
    const T = TYPES[type];
    const base = { m: T.m, visR: T.visR, realR: T.realKm * KM, p, v, trailDt: 0.004 };
    if (type === 'star') return this.addBody({ ...base, name: this._name('별'), type: 'M형 적색왜성', kind: 'star', temp: 3400, glow: 3, lightW: 0.6, orbit: false, rotRate: 40, ...extra });
    if (type === 'hole') return this.addBody({ ...base, name: this._name('블랙홀'), type: '항성질량 블랙홀', kind: 'blackhole', color: 0xffa050, orbit: false, collideR: 0.07, desc: '빛조차 빠져나올 수 없는 천체. 다가오는 모든 것을 삼킵니다.', ...extra });
    const looks = type === 'gas' ? GAS_LOOKS : ROCK_LOOKS;
    const L = looks[Math.floor(this.r() * looks.length)];
    return this.addBody({ ...base, ...L, name: this._name(type === 'gas' ? '가스행성' : '행성'), type: T.label, tilt: this.r() * 30, rotRate: 800 + this.r() * 1500, ...extra });
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

  // ── 포인터: 발사 도구 ──
  _hit(e) {
    const rect = this.app.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.app.camera);
    return this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  _pointer(type, e) {
    if (type === 'down') {
      if (this.tool !== 'launch' || e.button === 2) return false;
      const p = this._hit(e);
      if (!p) return false;
      this.drag = { p0: p, p1: p.clone(), sx: e.clientX, sy: e.clientY };
      this.ghost.visible = true;
      this.ghost.position.copy(p);
      this.ghost.scale.setScalar(TYPES[this.type].visR);
      return true;
    }
    if (!this.drag) return false;
    if (type === 'move') {
      const p = this._hit(e);
      if (p) this.drag.p1.copy(p);
      this._preview();
    } else if (type === 'up') {
      const d = this.drag;
      this.drag = null;
      this.arrow.visible = this.predict.visible = this.ghost.visible = false;
      const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
      const p = [d.p0.x, 0, d.p0.z];
      const v = moved < 10 ? this.circularVel(p) : this._dragVel(d);
      const b = this.spawn(this.type, p, v);
      this.app.audio?.blip(420);
      this.app.toast(`${b.name} 발사 — ${moved < 10 ? '원궤도' : '사용자 속도'}`);
    } else {
      this.drag = null;
      this.arrow.visible = this.predict.visible = this.ghost.visible = false;
    }
    return true;
  }

  _dragVel(d) {
    const k = 3.2;
    return [(d.p1.x - d.p0.x) * k, 0, (d.p1.z - d.p0.z) * k];
  }

  _preview() {
    const d = this.drag;
    const ap = this.arrow.geometry.attributes.position;
    ap.setXYZ(0, d.p0.x, 0, d.p0.z); ap.setXYZ(1, d.p1.x, 0, d.p1.z);
    ap.needsUpdate = true;
    this.arrow.geometry.setDrawRange(0, 2);
    this.arrow.visible = true;
    // 궤적 예측 (현재 천체 고정 가정)
    const s = this.sim, n = s.n;
    let [x, , z] = [d.p0.x, 0, d.p0.z];
    let [vx, , vz] = d.p0.distanceTo(d.p1) < 0.02 ? this.circularVel([x, 0, z]) : this._dragVel(d);
    const pp = this.predict.geometry.attributes.position;
    let count = 0;
    for (let k = 0; k < 600; k++) {
      let ax = 0, az = 0, minR = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = s.x[i] - x, dz = s.z[i] - z, r2 = dx * dx + dz * dz + 1e-6, r = Math.sqrt(r2);
        const f = (G_AU * s.m[i]) / (r2 * r);
        ax += dx * f; az += dz * f;
        if (r < minR) minR = r;
      }
      const h = Math.min(0.004, 0.02 * minR / (Math.hypot(vx, vz) + 1e-3));
      vx += ax * h; vz += az * h; x += vx * h; z += vz * h;
      if (k % 2 === 0) { pp.setXYZ(count++, x, 0, z); if (count >= 300) break; }
    }
    pp.needsUpdate = true;
    this.predict.geometry.setDrawRange(0, count);
    this.predict.visible = true;
  }

  // ── 프리셋 ──
  planetSystem() {
    this.reset();
    const R = this.r;
    const aList = [0.4, 0.72, 1.05, 1.6, 2.6, 4.2, 6.5];
    aList.forEach((a, k) => {
      const ang = R() * TAU, p = [Math.cos(ang) * a, 0, Math.sin(ang) * a];
      this.spawn(k < 4 ? 'rocky' : 'gas', p, this.circularVel(p));
    });
    this.app.controls.focus(() => this.sun.vis, 12);
  }

  protoDisk() {
    this.reset();
    const R = this.r, N = this.app.quality.proto;
    for (let k = 0; k < N; k++) {
      const a = 0.45 + Math.pow(R(), 0.8) * 2.4, ang = R() * TAU;
      const p = [Math.cos(ang) * a, gauss(R) * 0.01, Math.sin(ang) * a];
      const v = this.circularVel(p);
      const ecc = 1 + gauss(R) * 0.02;
      const m = 6e-7 * (0.5 + R());
      this.addBody({
        name: '', label: false, small: true, style: 'lava', look: { colA: 0x2c2420, colB: 0x6a5446, spot: 0 }, color: 0xd8a080,
        m, visR: 0.011 * Math.cbrt(m / 6e-7), realR: 2000 * KM, p, v: [v[0] * ecc, gauss(R) * 0.02, v[2] * ecc],
        orbit: false, trailLen: 60, trailOpacity: 0.35, trailDt: 0.01, rotRate: 300, markerA: 0.5, type: '미행성',
        desc: '원시행성 원반의 미행성. 충돌·병합을 거듭하며 원시행성으로 성장합니다.',
      });
    }
    this.app.controls.focus(() => this.sun.vis, 7);
    this.app.toast(`미행성 ${N}개 — 시간을 빠르게 하면 충돌 병합으로 행성이 자랍니다`);
  }

  onMerged(info) {
    const a = info.survivor;
    if (!a.name && this.sim.m[a.idx] > 4e-6) {
      a.name = this._name('원시행성');
      a.label = true;
      a.labelEl = this.app.labels.add(a.name, () => this.select(a, true));
      a.markerA = 1;
      a.orbit = true;
    }
  }

  get warp() { return { min: 1 / 365.25, max: 10, def: 0.25, fmt: (w) => `${fmtDuration(w)}/초` }; }

  start() {
    const c = this.app.controls;
    c.minR = 0.02; c.maxR = 120; c.minNear = 1e-5; c.minFar = 0;
    c.set({ theta: 0, phi: 0.5, radius: 25, jump: true });
    c.set({ theta: 0.3, phi: 0.75, radius: 6 });
    c.focus(() => this.sun.vis, null, 0.1);
    this.app.toast('화면을 탭하면 원궤도로, 드래그하면 원하는 속도로 천체를 발사합니다');
  }

  focusRadius(b) { return Math.max(b.visR * 8, 0.3); }

  clock() { return { main: `${fmtDuration(this.sim.time)}`, sub: `천체 ${this.sim.n}개` }; }

  panel() {
    return [
      { type: 'chips', label: '조작 도구', radio: true, value: this.tool, items: [
        { key: 'launch', label: '천체 발사', on: () => (this.tool = 'launch') },
        { key: 'camera', label: '카메라', on: () => (this.tool = 'camera') },
      ] },
      { type: 'chips', label: '발사할 천체', radio: true, value: this.type, items: Object.entries(TYPES).map(([k, t]) => ({ key: k, label: `${t.label}`, on: () => (this.type = k) })) },
      { type: 'chips', label: '프리셋', items: [
        { label: '원시행성 원반', act: true, on: () => this.protoDisk() },
        { label: '무작위 행성계', act: true, on: () => this.planetSystem() },
        { label: '모두 지우기', on: () => this.reset() },
      ] },
      { type: 'readouts', items: ['천체 수', '총 질량', '적분 스텝/프레임'] },
      { type: 'hint', text: '탭: 가장 무거운 천체 주위 원궤도 · 드래그: 화살표 방향·길이로 속도 지정(주황 점선은 예상 궤적) · 두 손가락: 카메라. 천체끼리 닿으면 운동량을 보존하며 합쳐집니다.' },
    ];
  }

  readouts() {
    let M = 0;
    for (let i = 0; i < this.sim.n; i++) M += this.sim.m[i];
    return { '천체 수': String(this.sim.n), '총 질량': fmtMass(M), '적분 스텝/프레임': `${this.sim.lastSteps || 0}${this.lagging ? ' ⚠' : ''}` };
  }

  dispose() {
    this.app.controls.interceptor = null;
    super.dispose();
  }
}
