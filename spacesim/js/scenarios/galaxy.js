// SpaceSim — 은하 충돌: 제한 N-체(Toomre & Toomre 1972) + 동역학적 마찰로 병합
// 두 은하핵(플러머 연화 질점)이 서로 끌어당기고, 수만 개 별·가스 입자가 그 중력장을 따라 움직입니다.
import * as THREE from 'three';
import { GlowPoints } from '../trails.js';
import { rng, gauss, blackbody, TAU, DEG, fmtDuration, fmtNum } from '../util.js';

const T_MYR = 16.7;     // 시간 단위 → 백만 년
const V_KMS = 293;      // 속도 단위 → km/s
const L_KPC = 5;        // 길이 단위 → kpc

const PRESETS = {
  antennae: { label: '안테나 (정면 충돌)', m2: 1, rp: 0.7, inc: [[15, 0], [-60, 40]], retro: [false, false], desc: '질량이 비슷한 두 나선은하의 순행 근접 조우. NGC 4038/4039처럼 길게 뻗은 조석 꼬리 두 개가 생깁니다.' },
  whirlpool: { label: '소용돌이 (M51)', m2: 0.3, rp: 1.3, inc: [[0, 0], [55, 30]], retro: [false, false], desc: '큰 나선은하 곁을 작은 동반은하가 스쳐 지나가며 뚜렷한 나선팔과 다리(bridge)를 만듭니다.' },
  milkomeda: { label: '우리은하 × 안드로메다', m2: 1.4, rp: 0.9, inc: [[-25, 0], [70, 120]], retro: [false, false], desc: '약 45억 년 후 예상되는 두 은하의 충돌. 여러 번 근접한 뒤 하나의 거대 타원은하로 합쳐집니다.' },
  retro: { label: '역행 통과 비교', m2: 1, rp: 0.8, inc: [[10, 0], [10, 0]], retro: [false, true], desc: '한쪽(B)은 순행, 다른 쪽(A)… 아니 B가 역행으로 회전합니다. 역행 원반은 조석 꼬리를 거의 만들지 못합니다.' },
};
PRESETS.retro.desc = '은하 A는 궤도와 같은 방향(순행), B는 반대 방향(역행)으로 회전합니다. 순행 원반만 긴 조석 꼬리를 만드는 것을 비교해 보세요.';

export class GalaxyScenario {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group();
    app.scene.add(this.root);
    this.presetKey = 'antennae';
    this.friction = true;
    this.eps2 = 0.12 * 0.12;
    this.time = 0;
    this.selected = null;
    this.build();
  }

  build() {
    if (this.gp) { this.root.remove(this.gp.points); this.gp.dispose(); }
    const P = PRESETS[this.presetKey], q = this.app.quality;
    const N = q.galaxy, r = rng(1234);
    this.time = 0;
    const M1 = 1, M2 = P.m2, M = M1 + M2;
    // 포물선 궤도 초기 조건
    const R0 = 6.5, p = 2 * P.rp, mu = M;
    const nu = -Math.acos(p / R0 - 1);
    const k = Math.sqrt(mu / p);
    const rel = new THREE.Vector3(R0 * Math.cos(nu), 0, -R0 * Math.sin(nu));
    const vrel = new THREE.Vector3(-k * Math.sin(nu), 0, -k * (1 + Math.cos(nu)));
    this.cores = [
      { m: M1, p: rel.clone().multiplyScalar(-M2 / M), v: vrel.clone().multiplyScalar(-M2 / M), a: new THREE.Vector3(), name: '은하 A' },
      { m: M2, p: rel.clone().multiplyScalar(M1 / M), v: vrel.clone().multiplyScalar(M1 / M), a: new THREE.Vector3(), name: '은하 B' },
    ];
    const Lhat = new THREE.Vector3().crossVectors(rel, vrel).normalize();

    // 입자 배치
    const nGas = Math.round(N * 0.08);
    const total = N + nGas + 2;
    this.n = N + nGas;
    const gp = new GlowPoints(total, { maxSize: 72 });
    this.gp = gp;
    this.vel = new Float32Array(this.n * 3);
    this.acc = new Float32Array(this.n * 3);
    const pos = gp.pos, col = gp.col, size = gp.size;
    const c = new THREE.Color(), loc = new THREE.Vector3(), vloc = new THREE.Vector3();
    const n1 = Math.round(this.n * (M1 / M) ** 0.6 / ((M1 / M) ** 0.6 + (M2 / M) ** 0.6));
    const quats = this.cores.map((core, g) => {
      const [incl, az] = P.inc[g];
      const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Lhat);
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(incl * DEG, az * DEG, 0, 'YXZ'));
      return qq.multiply(tilt);
    });
    const vc = (m, rr) => Math.sqrt((m * rr * rr) / Math.pow(rr * rr + this.eps2, 1.5));

    for (let i = 0; i < this.n; i++) {
      const isGas = i >= N;
      const g = (isGas ? (i - N) < nGas * (n1 / this.n) : i < N * (n1 / this.n)) ? 0 : 1;
      const core = this.cores[g], scale = Math.sqrt(core.m);
      const retro = P.retro[g] ? -1 : 1;
      let rr, th, yy = 0;
      const kind = r();
      let bulge = !isGas && kind < 0.16;
      if (bulge) {
        rr = Math.abs(gauss(r)) * 0.18 * scale + 0.03;
        const nrm = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize();
        const t1 = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
        const t2 = new THREE.Vector3().crossVectors(nrm, t1);
        const a = r() * TAU, v = vc(core.m, rr);
        loc.copy(t1).multiplyScalar(Math.cos(a) * rr).addScaledVector(t2, Math.sin(a) * rr);
        vloc.copy(t1).multiplyScalar(-Math.sin(a) * v).addScaledVector(t2, Math.cos(a) * v);
      } else {
        rr = Math.min((0.12 - Math.log(1 - r() * 0.985) * 0.38) * scale, 2.2 * scale);
        const armed = r() < 0.62;
        th = r() * TAU;
        if (armed) {
          const arm = r() < 0.5 ? 0 : Math.PI;
          th = arm + Math.log(rr / (0.15 * scale)) / Math.tan(16 * DEG) + gauss(r) * 0.32;
        }
        yy = gauss(r) * 0.018 * scale * (isGas ? 0.5 : 1);
        const v = vc(core.m, rr) * retro;
        loc.set(Math.cos(th) * rr, yy, Math.sin(th) * rr);
        vloc.set(-Math.sin(th) * v, 0, Math.cos(th) * v).multiplyScalar(-1);
        loc.applyQuaternion(quats[g]); vloc.applyQuaternion(quats[g]);
        // 색
        if (isGas) {
          const pink = r() < 0.5;
          c.setRGB(pink ? 0.9 : 0.35, pink ? 0.28 : 0.45, pink ? 0.5 : 0.95).multiplyScalar(0.06 + r() * 0.05);
          size[i] = 0.09 + r() * 0.12;
        } else if (armed && r() < 0.05) {
          c.setRGB(1, 0.35, 0.62).multiplyScalar(1.6);
          size[i] = 0.035;
        } else {
          const young = armed ? 0.7 : 0.25;
          blackbody(r() < young ? 9000 + r() * 16000 : 4200 + r() * 2600, c).multiplyScalar(0.55 + r() * 0.5);
          size[i] = 0.014 + r() * 0.012;
        }
      }
      if (bulge) {
        blackbody(3600 + r() * 1800, c).multiplyScalar(0.7 + r() * 0.5);
        size[i] = 0.016 + r() * 0.01;
      }
      pos[i * 3] = core.p.x + loc.x; pos[i * 3 + 1] = core.p.y + loc.y; pos[i * 3 + 2] = core.p.z + loc.z;
      this.vel[i * 3] = core.v.x + vloc.x; this.vel[i * 3 + 1] = core.v.y + vloc.y; this.vel[i * 3 + 2] = core.v.z + vloc.z;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    // 은하핵 발광
    for (let g = 0; g < 2; g++) {
      const i = this.n + g;
      blackbody(4200, c).multiplyScalar(0.9);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 0.2 * Math.sqrt(this.cores[g].m);
    }
    gp.colAttr.needsUpdate = gp.sizeAttr.needsUpdate = true;
    gp.mat.uniforms.uBright.value = 0.8 * Math.sqrt(40000 / N);
    this.root.add(gp.points);
    this._coreAcc();
    this._partAcc();
    this._syncCores();
    this.desc = P.desc;
  }

  _coreAcc() {
    const [A, B] = this.cores;
    const d = new THREE.Vector3().subVectors(B.p, A.p);
    const r2 = d.lengthSq() + this.eps2, inv = 1 / (r2 * Math.sqrt(r2));
    A.a.copy(d).multiplyScalar(B.m * inv);
    B.a.copy(d).multiplyScalar(-A.m * inv);
    if (this.friction) {
      const r = Math.sqrt(r2), f = 0.38 / (1 + (r / 1.1) ** 3);
      const dv = new THREE.Vector3().subVectors(A.v, B.v), M = A.m + B.m;
      A.a.addScaledVector(dv, (-f * B.m) / M);
      B.a.addScaledVector(dv, (f * A.m) / M);
    }
  }

  _partAcc() {
    const n = this.n, p = this.gp.pos, a = this.acc, e2 = this.eps2;
    const [A, B] = this.cores;
    const ax = A.p.x, ay = A.p.y, az = A.p.z, am = A.m, bx = B.p.x, by = B.p.y, bz = B.p.z, bm = B.m;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const x = p[j], y = p[j + 1], z = p[j + 2];
      let dx = ax - x, dy = ay - y, dz = az - z;
      let r2 = dx * dx + dy * dy + dz * dz + e2;
      let f = am / (r2 * Math.sqrt(r2));
      let sx = dx * f, sy = dy * f, sz = dz * f;
      dx = bx - x; dy = by - y; dz = bz - z;
      r2 = dx * dx + dy * dy + dz * dz + e2;
      f = bm / (r2 * Math.sqrt(r2));
      a[j] = sx + dx * f; a[j + 1] = sy + dy * f; a[j + 2] = sz + dz * f;
    }
  }

  step(h) {
    const n3 = this.n * 3, p = this.gp.pos, v = this.vel, a = this.acc, hh = h * 0.5;
    for (const c of this.cores) { c.v.addScaledVector(c.a, hh); c.p.addScaledVector(c.v, h); }
    for (let j = 0; j < n3; j++) { v[j] += a[j] * hh; p[j] += v[j] * h; }
    this._coreAcc();
    this._partAcc();
    for (const c of this.cores) c.v.addScaledVector(c.a, hh);
    for (let j = 0; j < n3; j++) v[j] += a[j] * hh;
    this.time += h;
  }

  simulate(dt, warp) {
    const want = warp * dt, t0 = performance.now(), hMax = 0.012;
    let done = 0, steps = 0;
    while (done < want) {
      const h = Math.min(hMax, want - done);
      this.step(h);
      done += h; steps++;
      if (performance.now() - t0 > this.app.budgetMs) break;
    }
    this.lastSteps = steps;
    this.lagging = done < want * 0.97;
  }

  _syncCores() {
    for (let g = 0; g < 2; g++) {
      const i = (this.n + g) * 3, c = this.cores[g].p;
      this.gp.pos[i] = c.x; this.gp.pos[i + 1] = c.y; this.gp.pos[i + 2] = c.z;
    }
    this.gp.posAttr.needsUpdate = true;
  }

  update() {
    this._syncCores();
    this.gp.setScale(this.app.camera, this.app.height);
    if (this.selected != null && this.app.ui && this.frameCount++ % 10 === 0) this.app.ui.showInfo(this.info(this.selected));
  }

  get warp() { return { min: 0.02, max: 3, def: 0.45, fmt: (w) => `${fmtDuration(w * T_MYR * 1e6)}/초` }; }

  start() {
    const c = this.app.controls;
    c.minR = 0.3; c.maxR = 120; c.minNear = 1e-3; c.minFar = 0;
    c.follow = null; c.target.set(0, 0, 0);
    c.set({ theta: -0.6, phi: 0.25, radius: 40, jump: true });
    c.set({ theta: 0.3, phi: 0.75, radius: 13 });
    this.app.sky.setLook(0.0, 0.35);
    this.frameCount = 0;
  }

  pick(x, y) {
    const cam = this.app.camera, v = new THREE.Vector3();
    for (let g = 0; g < 2; g++) {
      v.copy(this.cores[g].p).project(cam);
      const sx = (v.x * 0.5 + 0.5) * this.app.width, sy = (-v.y * 0.5 + 0.5) * this.app.height;
      if (v.z < 1 && Math.hypot(sx - x, sy - y) < 50) {
        this.selected = g;
        this.app.ui.showInfo(this.info(g));
        this.app.controls.focus(() => this.cores[g].p, 5);
        return true;
      }
    }
    return false;
  }

  select(b) { this.selected = b; if (b === null) this.app.ui.showInfo(null); }

  info(g) {
    const c = this.cores[g], o = this.cores[1 - g];
    const d = c.p.distanceTo(o.p), dv = c.v.distanceTo(o.v);
    return {
      name: c.name, type: g === 0 ? '나선은하 (주은하)' : '나선은하 (동반은하)', color: g ? '#9fc4ff' : '#ffd9a0',
      rows: [
        ['질량', `${fmtNum(c.m * 1e11, 2)} M☉`],
        ['상대 거리', `${fmtNum(d * L_KPC, 1)} kpc`],
        ['상대 속도', `${fmtNum(dv * V_KMS, 0)} km/s`],
        ['입자 수', `${Math.round(this.n / 2).toLocaleString()}`],
      ],
      desc: this.desc,
    };
  }

  clock() {
    const [A, B] = this.cores;
    return { main: `${fmtDuration(this.time * T_MYR * 1e6)}`, sub: `핵 간 거리 ${fmtNum(A.p.distanceTo(B.p) * L_KPC, 1)} kpc` };
  }

  panel() {
    return [
      { type: 'chips', label: '충돌 시나리오', radio: true, value: this.presetKey, items: Object.entries(PRESETS).map(([k, p]) => ({ key: k, label: p.label, on: () => { this.presetKey = k; this.build(); this.app.toast(p.label); } })) },
      { type: 'toggle', label: '동역학적 마찰 (암흑물질 헤일로 → 병합)', value: this.friction, on: (v) => (this.friction = v) },
      { type: 'slider', label: '입자 밝기', min: 0.2, max: 3, step: 0.01, value: 1, fmt: (v) => `${v.toFixed(2)}×`, on: (v) => (this.gp.mat.uniforms.uBright.value = 0.8 * Math.sqrt(40000 / this.app.quality.galaxy) * v) },
      { type: 'readouts', items: ['입자 수', '적분 스텝/프레임', '시간 단위'] },
      { type: 'hint', text: '은하핵을 탭하면 추적합니다. 별(노랑=늙은 별, 파랑=젊은 별), 분홍=HII 성운, 흐린 안개=성간 가스.' },
    ];
  }

  readouts() {
    return { '입자 수': this.n.toLocaleString(), '적분 스텝/프레임': `${this.lastSteps || 0}${this.lagging ? ' ⚠' : ''}`, '시간 단위': `${T_MYR} Myr · ${L_KPC} kpc` };
  }

  stats() { return { bodies: this.n, steps: this.lastSteps || 0 }; }

  dispose() {
    this.root.remove(this.gp.points);
    this.gp.dispose();
    this.app.scene.remove(this.root);
    this.app.sky.setLook();
  }
}
