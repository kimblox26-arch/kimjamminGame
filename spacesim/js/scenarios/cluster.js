// SpaceSim — 구상성단: 플러머 구(Aarseth–Hénon–Wielen 1974) 직접 N-체, 살피터 질량 함수
import * as THREE from 'three';
import { NBody } from '../physics.js';
import { GlowPoints } from '../trails.js';
import { rng, gauss, blackbody, massToTemp, fmtNum } from '../util.js';

const T_MYR = 0.245;   // M = 10⁵ M☉, R_vir = 3 pc 기준
const R_PC = 3;

export class ClusterScenario {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group();
    app.scene.add(this.root);
    this.withHole = false;
    this.selected = null;
    this.frame = 0;
    this.build();
  }

  build() {
    if (this.gp) { this.root.remove(this.gp.points); this.gp.dispose(); }
    const N = this.app.quality.cluster, r = rng(77);
    const sim = new NBody({ G: 1, softening: 4 / N + 0.004 });
    this.sim = sim;
    // 살피터 IMF (0.3–15 M☉)
    const a = -1.35, lo = 0.3 ** a, hi = 15 ** a;
    const masses = [];
    for (let i = 0; i < N; i++) masses.push(Math.pow(lo + r() * (hi - lo), 1 / a));
    const mTot = masses.reduce((s, m) => s + m, 0) * (this.withHole ? 1 / 0.97 : 1);
    this.physMass = masses;
    const sL = (3 * Math.PI) / 16, sV = 1 / Math.sqrt(sL);
    for (let i = 0; i < N; i++) {
      let rad;
      do { rad = 1 / Math.sqrt(Math.pow(r() * 0.999 + 1e-6, -2 / 3) - 1); } while (rad > 12);
      const dir = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize();
      let qq, g;
      do { qq = r(); g = r() * 0.1; } while (g > qq * qq * Math.pow(1 - qq * qq, 3.5));
      const ve = Math.SQRT2 * Math.pow(1 + rad * rad, -0.25) * qq;
      const vdir = new THREE.Vector3(gauss(r), gauss(r), gauss(r)).normalize();
      const p = dir.multiplyScalar(rad * sL), v = vdir.multiplyScalar(ve * sV);
      sim.add({ id: i }, masses[i] / mTot, [p.x, p.y, p.z], [v.x, v.y, v.z]);
    }
    if (this.withHole) sim.add({ id: 'bh', hole: true }, 0.03, [0, 0, 0], [0, 0, 0]);
    sim.toCOM();
    sim.computeAcc();
    this.N = sim.n;
    this.E0 = sim.energy().E;
    this.dE = 0;

    const gp = new GlowPoints(sim.n, { maxSize: 56 });
    const c = new THREE.Color();
    for (let i = 0; i < sim.n; i++) {
      if (sim.bodies[i].hole) {
        c.setRGB(1.6, 0.7, 0.25);
        gp.size[i] = 0.12;
      } else {
        const m = masses[i];
        blackbody(massToTemp(m), c).multiplyScalar(0.5 + Math.min(Math.pow(m, 0.9), 6) * 0.35);
        gp.size[i] = 0.018 + Math.pow(m, 0.45) * 0.014;
      }
      gp.col.set([c.r, c.g, c.b], i * 3);
    }
    gp.colAttr.needsUpdate = gp.sizeAttr.needsUpdate = true;
    gp.mat.uniforms.uBright.value = 1.1 * Math.sqrt(512 / N);
    this.gp = gp;
    this.root.add(gp.points);
    this._sync();
    this._measure();
  }

  _sync() {
    const s = this.sim, p = this.gp.pos;
    for (let i = 0; i < s.n; i++) { p[i * 3] = s.x[i]; p[i * 3 + 1] = s.y[i]; p[i * 3 + 2] = s.z[i]; }
    this.gp.posAttr.needsUpdate = true;
  }

  _measure() {
    const s = this.sim, n = s.n;
    const rs = [];
    let K = 0, escaped = 0;
    const { E, U } = s.energy();
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(s.x[i], s.y[i], s.z[i]);
      rs.push([r, s.m[i]]);
      const v2 = s.vx[i] ** 2 + s.vy[i] ** 2 + s.vz[i] ** 2;
      K += 0.5 * s.m[i] * v2;
      if (r > 6 && 0.5 * v2 - 1 / r > 0) escaped++;
    }
    rs.sort((a, b) => a[0] - b[0]);
    let acc = 0, rh = 0, r10 = 0;
    for (const [r, m] of rs) { acc += m; if (!r10 && acc >= 0.1) r10 = r; if (acc >= 0.5) { rh = r; break; } }
    this.rh = rh; this.r10 = r10; this.Q = K / Math.abs(U); this.escaped = escaped;
    this.dE = Math.abs((E - this.E0) / this.E0);
  }

  simulate(dt, warp) {
    const done = this.sim.advance(warp * dt, 0.004, this.app.budgetMs);
    this.lagging = done < warp * dt * 0.97;
  }

  update() {
    this._sync();
    this.gp.setScale(this.app.camera, this.app.height);
    if (++this.frame % 30 === 0) this._measure();
  }

  get warp() { return { min: 0.01, max: 2, def: 0.25, fmt: (w) => `${fmtNum(w * T_MYR * 1000, 1)}천 년/초` }; }

  start() {
    const c = this.app.controls;
    c.minR = 0.2; c.maxR = 80; c.minNear = 1e-3; c.minFar = 0;
    c.follow = null; c.target.set(0, 0, 0);
    c.set({ theta: 0, phi: 1.3, radius: 30, jump: true });
    c.set({ theta: 0.6, phi: 1.15, radius: 5.5 });
    this.app.sky.setLook(0.18, 0.6);
  }

  pick() { return false; }
  select() {}

  clock() { return { main: `${fmtNum(this.sim.time * T_MYR, 2)} 백만 년`, sub: `반질량 반경 ${fmtNum(this.rh * R_PC, 2)} pc` }; }

  panel() {
    return [
      { type: 'toggle', label: '중심 중간질량 블랙홀 (3%)', value: this.withHole, on: (v) => { this.withHole = v; this.build(); } },
      { type: 'chips', label: '실험', items: [{ label: '성단 재생성', act: true, on: () => this.build() }] },
      { type: 'readouts', items: ['별 개수', '반질량 반경', '10% 질량 반경', '비리얼 비 2K/|U|', '탈출한 별', '에너지 보존 오차'] },
      { type: 'hint', text: '모든 별 쌍의 중력을 직접 계산합니다(O(N²)). 무거운 별(파랑)은 중심으로 가라앉고(질량 분리), 가벼운 별은 증발하듯 탈출합니다. 단위: 10⁵ M☉, 3 pc.' },
    ];
  }

  readouts() {
    return {
      '별 개수': String(this.sim.n),
      '반질량 반경': `${fmtNum(this.rh * R_PC, 3)} pc`,
      '10% 질량 반경': `${fmtNum(this.r10 * R_PC, 3)} pc`,
      '비리얼 비 2K/|U|': fmtNum(2 * this.Q, 3),
      '탈출한 별': String(this.escaped),
      '에너지 보존 오차': this.dE ? this.dE.toExponential(2) : '—',
    };
  }

  stats() { return { bodies: this.sim.n, steps: this.sim.lastSteps || 0, dE: this.dE }; }

  dispose() {
    this.root.remove(this.gp.points);
    this.gp.dispose();
    this.app.scene.remove(this.root);
    this.app.sky.setLook();
  }
}
