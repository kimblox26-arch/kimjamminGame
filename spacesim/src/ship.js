// 우주선: 치올코프스키 로켓 방정식 · 자세 제어(SAS) · 대기 항력/공력가열 · 수치 궤적 예측
import * as THREE from 'three';
import { G, G0, YEAR, TAU, sub, len, norm, cross, mul, stateToElements } from './orbit.js';

export const ENGINES = {
  chem: { name: '화학 로켓 (LOX/LH₂)', thrust: 1.2e5, isp: 450, col: [1.0, 0.6, 0.28] },
  ntr: { name: '핵열 로켓 (NERVA)', thrust: 6e4, isp: 900, col: [0.5, 0.72, 1.0] },
  fusion: { name: '핵융합 토치 (가상)', thrust: 4e5, isp: 1e5, col: [0.86, 0.5, 1.0] },
};
export const SAS = { off: '끔', stab: '자세 유지', pro: '순행', retro: '역행', normal: '법선', anti: '반법선', radout: '방사 외향', radin: '방사 내향' };

const toR = (p, o = new THREE.Vector3()) => o.set(p[0], p[2], -p[1]);
const toP = v => [v.x, -v.z, v.y];

export class Ship {
  constructor(st) {
    this.pos = st.pos.slice(); this.vel = st.vel.slice();
    this.dry = 4000; this.fuelMax = 18000; this.fuel = this.fuelMax; this.engine = 'chem';
    this.throttle = 0; this.sas = 'pro'; this.alive = true; this.landed = null; this.ref = null;
    this.cda = 5; this.heat = 0; this.heatAcc = 0; this.dir = [0, 0, 1];
    this.q = new THREE.Quaternion(); this.w = new THREE.Vector3(); this.pred = null; this.maxG = 0;
  }
  get eng() { return ENGINES[this.engine]; }
  mass() { return this.dry + this.fuel; }
  dv() { return this.eng.isp * G0 * Math.log(this.mass() / this.dry); }
  burning() { return this.alive && this.throttle > 0 && this.fuel > 0; }

  sasDir(r, v) {
    switch (this.sas) {
      case 'pro': return norm(v); case 'retro': return mul(norm(v), -1);
      case 'normal': return norm(cross(r, v)); case 'anti': return mul(norm(cross(r, v)), -1);
      case 'radout': return norm(r); case 'radin': return mul(norm(r), -1);
    }
    return null;
  }

  // 시뮬레이터 힘 훅: 추력 + 대기 항력 + 시간 간격 제한
  hook(sim) {
    return (P, V, A, i) => {
      const ref = this.ref; if (!ref || ref._i === undefined) return;
      const j = 3 * ref._i, ix = 3 * i;
      const r = [P[ix] - P[j], P[ix + 1] - P[j + 1], P[ix + 2] - P[j + 2]], v = [V[ix] - V[j], V[ix + 1] - V[j + 1], V[ix + 2] - V[j + 2]];
      const m = this.mass(), rm = len(r), vm = len(v), alt = rm - ref.radius;
      if (this.burning()) {
        const d = this.sasDir(r, v) || this.dir, a = this.eng.thrust * this.throttle / m;
        A[ix] += a * d[0]; A[ix + 1] += a * d[1]; A[ix + 2] += a * d[2];
      }
      const at = ref.atmo;
      if (at && alt < at.top) {
        const rho = at.rho0 * Math.exp(-Math.max(alt, 0) / at.H), k = 0.5 * rho * vm * this.cda / m;
        A[ix] -= k * v[0]; A[ix + 1] -= k * v[1]; A[ix + 2] -= k * v[2];
        if (k > 0) sim.dtLimit = Math.min(sim.dtLimit, 0.25 / k);
        this.heatAcc = Math.max(this.heatAcc, 1.83e-4 * Math.sqrt(rho) * vm * vm * vm); // Sutton–Graves (W/m²)
      }
      if (alt < 3e5) sim.dtLimit = Math.min(sim.dtLimit, Math.max(0.02, 0.08 * alt / (vm + 1)));
    };
  }
  consume(dt) {
    if (!this.burning()) return;
    this.fuel = Math.max(0, this.fuel - this.eng.thrust * this.throttle / (this.eng.isp * G0) * dt);
  }

  // 자세 갱신 (실시간 기준)
  updateAttitude(dt, input) {
    const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    const manual = input.x || input.y || input.z;
    if (manual && this.sas !== 'stab' && this.sas !== 'off') this.sas = 'stab';
    const ref = this.ref;
    let tgt = null;
    if (ref && !manual) tgt = this.sasDir(sub(this.pos, ref.pos), sub(this.vel, ref.vel));
    if (tgt) {
      const t = toR(tgt).normalize(), rot = new THREE.Quaternion().setFromUnitVectors(fwd, t);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(rot.w))), step = 1.6 * dt;
      if (ang > step) rot.slerp(new THREE.Quaternion(), 1 - step / ang);
      this.q.premultiply(rot).normalize(); this.w.set(0, 0, 0);
    } else {
      this.w.x += input.x * 1.4 * dt; this.w.z += input.y * 1.4 * dt; this.w.y += input.z * 1.4 * dt;
      if (!manual && this.sas === 'stab') this.w.multiplyScalar(Math.exp(-4 * dt));
      const wl = this.w.length();
      if (wl > 1e-9) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.w.clone().divideScalar(wl), wl * dt)).normalize();
    }
    this.dir = toP(new THREE.Vector3(0, 1, 0).applyQuaternion(this.q));
  }

  pointAt(dirP) { this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toR(dirP).normalize()); this.dir = dirP.slice(); }

  // 관성 비행 궤적 예측 (전체 N체, 기준 천체 좌표계)
  predict(sim, maxSteps = 2400) {
    const ref = this.ref;
    if (!ref || !this.alive || this.landed) { this.pred = null; return; }
    // 관련 천체만 포함: 루트·기준 천체 계통·형제 천체 (다른 행성의 위성 제외 → 시간 간격 확보)
    const keep = new Set([ref, ref.parent, ref.parent && ref.parent.parent]);
    const bs = sim.bodies.filter(b => !b.parent || keep.has(b.parent) || keep.has(b)), n = bs.length;
    const ri = bs.indexOf(ref); if (ri < 0) return;
    const P = new Float64Array(n * 3), V = new Float64Array(n * 3), M = new Float64Array(n), A = new Float64Array(n * 3);
    bs.forEach((b, i) => { P.set(b.pos, 3 * i); V.set(b.vel, 3 * i); M[i] = b.mass; });
    let sp = this.pos.slice(), sv = this.vel.slice();
    const mu = G * ref.mass, el = stateToElements(mu, sub(sp, ref.pos), sub(sv, ref.vel));
    let horizon = el.e < 1 && el.ap < (ref.soi || Infinity) ? Math.min(el.period * 1.02, 3 * YEAR) : YEAR;
    // 질량 천체끼리의 최소 동역학 시간
    let tm = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]);
      tm = Math.min(tm, Math.sqrt(d * d * d / (G * (M[i] + M[j]))));
    }
    const pts = [], sa = [0, 0, 0];
    const accel = () => {
      A.fill(0); sa[0] = sa[1] = sa[2] = 0; let ts = Infinity, hit = null;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = P[3 * j] - P[3 * i], dy = P[3 * j + 1] - P[3 * i + 1], dz = P[3 * j + 2] - P[3 * i + 2], r2 = dx * dx + dy * dy + dz * dz, f = G / (r2 * Math.sqrt(r2));
          A[3 * i] += f * M[j] * dx; A[3 * i + 1] += f * M[j] * dy; A[3 * i + 2] += f * M[j] * dz;
          A[3 * j] -= f * M[i] * dx; A[3 * j + 1] -= f * M[i] * dy; A[3 * j + 2] -= f * M[i] * dz;
        }
        const dx = P[3 * i] - sp[0], dy = P[3 * i + 1] - sp[1], dz = P[3 * i + 2] - sp[2], r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2);
        const f = G * M[i] / (r2 * r); sa[0] += f * dx; sa[1] += f * dy; sa[2] += f * dz;
        ts = Math.min(ts, r2 * r / (G * M[i]));
        if (r < bs[i].radius) hit = bs[i];
      }
      return { ts: Math.sqrt(ts), hit };
    };
    let { ts } = accel(), t = 0, enc = null, impact = null;
    const rec = () => pts.push(sp[0] - P[3 * ri], sp[1] - P[3 * ri + 1], sp[2] - P[3 * ri + 2]);
    rec();
    for (let s = 0; s < maxSteps && t < horizon; s++) {
      const h = Math.min(0.012 * TAU * ts, 0.02 * tm, horizon - t);
      for (let k = 0; k < 3 * n; k++) V[k] += 0.5 * h * A[k];
      for (let k = 0; k < 3; k++) sv[k] += 0.5 * h * sa[k];
      for (let k = 0; k < 3 * n; k++) P[k] += h * V[k];
      for (let k = 0; k < 3; k++) sp[k] += h * sv[k];
      const res = accel(); ts = res.ts;
      for (let k = 0; k < 3 * n; k++) V[k] += 0.5 * h * A[k];
      for (let k = 0; k < 3; k++) sv[k] += 0.5 * h * sa[k];
      t += h; rec();
      if (res.hit) { impact = { body: res.hit, t }; break; }
      // 다른 천체의 영향권(SOI) 진입 탐지
      for (let i = 0; i < n; i++) {
        const b = bs[i]; if (i === ri || !b.soi || !isFinite(b.soi) || b.type === 'star') continue;
        const d = Math.hypot(P[3 * i] - sp[0], P[3 * i + 1] - sp[1], P[3 * i + 2] - sp[2]);
        if (!enc && d < b.soi && b !== ref.parent) { enc = { body: b, t, idx: pts.length / 3 - 1, peri: d }; horizon = Math.min(horizon, t + 30 * 86400); }
        if (enc && enc.body === b) enc.peri = Math.min(enc.peri, d);
      }
    }
    this.pred = { pts: new Float64Array(pts), enc, impact, ref, el };
  }
}
