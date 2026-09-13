// SpaceSim — N체 중력 적분기
//
// 단위: AU / day / M_sun.  상태는 Float64Array 로 평탄 저장한다.
// 지원 적분기: 심플렉틱 오일러, 속도 베를레(leapfrog), Forest-Ruth(4차),
//              PEFRL(4차), 고전 RK4.
// 옵션: 소프트닝, Barnes-Hut 근사, 1PN 상대론 보정, 충돌 병합, 탈출체 제거.

import { G_SIM, C_SIM } from '../core/constants.js';
import { BarnesHut } from './barneshut.js';

const W1 = 1 / (2 - Math.cbrt(2));
const W0 = -Math.cbrt(2) * W1;
// PEFRL 계수 (Omelyan, Mryglod & Folk 2002)
const PE_XI = 0.1786178958448091;
const PE_LAM = -0.2123418310626054;
const PE_CHI = -0.06626458266981849;

export class NBody {
  constructor(opts = {}) {
    this.G = opts.G ?? G_SIM;
    this.softening = opts.softening ?? 1e-4;  // AU
    this.integrator = opts.integrator ?? 'verlet';
    this.useBarnesHut = opts.useBarnesHut ?? false;
    this.theta = opts.theta ?? 0.6;
    this.relativistic = opts.relativistic ?? false;
    this.collisions = opts.collisions ?? true;
    this.time = 0;
    this.steps = 0;
    this.events = [];

    this.capacity = 0;
    this.count = 0;
    this._grow(opts.capacity ?? 64);
    this.meta = [];
    this.tree = new BarnesHut();
    this.mergeEvents = 0;
  }

  _grow(cap) {
    const old = this.capacity;
    this.capacity = cap;
    const p = new Float64Array(cap * 3), v = new Float64Array(cap * 3);
    const m = new Float64Array(cap), r = new Float64Array(cap);
    const act = new Uint8Array(cap);
    if (old) {
      p.set(this.pos); v.set(this.vel); m.set(this.mass);
      r.set(this.radius); act.set(this.active);
    }
    this.pos = p; this.vel = v; this.mass = m; this.radius = r; this.active = act;
    this.acc = new Float64Array(cap * 3);
    this._a2 = new Float64Array(cap * 3);
    this._k = [0, 1, 2, 3].map(() => ({
      p: new Float64Array(cap * 3), v: new Float64Array(cap * 3),
    }));
    this._tp = new Float64Array(cap * 3);
    this._tv = new Float64Array(cap * 3);
  }

  /**
   * 천체 추가
   * @param {object} b { name, mass, pos:[x,y,z], vel:[x,y,z], radius, color, type, trail }
   */
  add(b) {
    if (this.count >= this.capacity) this._grow(this.capacity * 2);
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = b.pos[0]; this.pos[i3 + 1] = b.pos[1]; this.pos[i3 + 2] = b.pos[2];
    this.vel[i3] = b.vel[0]; this.vel[i3 + 1] = b.vel[1]; this.vel[i3 + 2] = b.vel[2];
    this.mass[i] = b.mass;
    this.radius[i] = b.radius ?? 1e-5;
    this.active[i] = 1;
    this.meta[i] = {
      name: b.name ?? `Body ${i}`,
      color: b.color ?? 0xffffff,
      type: b.type ?? 'body',        // star | planet | moon | dust | bh | probe
      glow: b.glow ?? 0,
      trail: b.trail ?? true,
      drawScale: b.drawScale ?? 1,
      parent: b.parent ?? null,
      temperature: b.temperature ?? null,
      data: b.data ?? null,       // 실측 물리 제원 (있으면 구체로 렌더링)
      key: b.key ?? null,
      rotPhase: b.rotPhase ?? 0,
      index: i,
    };
    return i;
  }

  /** 전체 초기화 */
  clear() {
    this.count = 0;
    this.meta.length = 0;
    this.time = 0;
    this.steps = 0;
    this.mergeEvents = 0;
    this.events.length = 0;
    this.active.fill(0);
    this.e0 = null;
  }

  // ───────────────────────── 힘 계산 ─────────────────────────

  /** pos 배열에 대한 가속도를 out 에 기록 */
  accelerations(pos, out) {
    const n = this.count, G = this.G, eps2 = this.softening * this.softening;
    out.fill(0, 0, n * 3);

    if (this.useBarnesHut && n > 64) {
      this.tree.theta = this.theta;
      this.tree.build(pos, this.mass, n, this.active);
      for (let i = 0; i < n; i++) {
        if (!this.active[i]) continue;
        this.tree.accel(i, pos, G, eps2, out);
      }
    } else {
      for (let i = 0; i < n; i++) {
        if (!this.active[i]) continue;
        const i3 = i * 3;
        const xi = pos[i3], yi = pos[i3 + 1], zi = pos[i3 + 2];
        let ax = 0, ay = 0, az = 0;
        for (let j = 0; j < n; j++) {
          // 무질량 시험입자는 힘을 만들지 않으므로 건너뛴다
          if (j === i || !this.active[j] || this.mass[j] === 0) continue;
          const j3 = j * 3;
          const dx = pos[j3] - xi, dy = pos[j3 + 1] - yi, dz = pos[j3 + 2] - zi;
          const r2 = dx * dx + dy * dy + dz * dz + eps2;
          const inv = G * this.mass[j] / (r2 * Math.sqrt(r2));
          ax += dx * inv; ay += dy * inv; az += dz * inv;
        }
        out[i3] = ax; out[i3 + 1] = ay; out[i3 + 2] = az;
      }
    }

    if (this.relativistic) this._addRelativistic(pos, out);
    return out;
  }

  /**
   * 1PN(슈바르츠실트) 보정 — 중심 천체 기준.
   *   a_GR = GM/(c²r³) · [ (4GM/r − v²)·r⃗ + 4(r⃗·v⃗)·v⃗ ]
   * 수성 근일점 이동 43″/century 를 재현한다.
   */
  _addRelativistic(pos, out) {
    const c2 = C_SIM * C_SIM;
    const p = this.primaryIndex();
    if (p < 0) return;
    const mu = this.G * this.mass[p];
    const p3 = p * 3;
    for (let i = 0; i < this.count; i++) {
      if (i === p || !this.active[i]) continue;
      const i3 = i * 3;
      const dx = pos[i3] - pos[p3], dy = pos[i3 + 1] - pos[p3 + 1], dz = pos[i3 + 2] - pos[p3 + 2];
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-8) continue;
      const vx = this.vel[i3] - this.vel[p3];
      const vy = this.vel[i3 + 1] - this.vel[p3 + 1];
      const vz = this.vel[i3 + 2] - this.vel[p3 + 2];
      const v2 = vx * vx + vy * vy + vz * vz;
      const rv = dx * vx + dy * vy + dz * vz;
      const k = mu / (c2 * r * r * r);
      const A = 4 * mu / r - v2;
      out[i3] += k * (A * dx + 4 * rv * vx);
      out[i3 + 1] += k * (A * dy + 4 * rv * vy);
      out[i3 + 2] += k * (A * dz + 4 * rv * vz);
    }
  }

  /** 가장 무거운 활성 천체 */
  primaryIndex() {
    let best = -1, bm = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.active[i] && this.mass[i] > bm) { bm = this.mass[i]; best = i; }
    }
    return best;
  }

  // ───────────────────────── 적분 ─────────────────────────

  step(dt) {
    switch (this.integrator) {
      case 'euler': this._symplecticEuler(dt); break;
      case 'rk4': this._rk4(dt); break;
      case 'forestruth': this._forestRuth(dt); break;
      case 'pefrl': this._pefrl(dt); break;
      default: this._verlet(dt); break;
    }
    this.time += dt;
    this.steps++;
    if (this.collisions) this._resolveCollisions();
  }

  _drift(dt) {
    const n3 = this.count * 3;
    for (let i = 0; i < n3; i++) this.pos[i] += this.vel[i] * dt;
  }

  _kick(dt, acc) {
    const n3 = this.count * 3;
    for (let i = 0; i < n3; i++) this.vel[i] += acc[i] * dt;
  }

  _symplecticEuler(dt) {
    this.accelerations(this.pos, this.acc);
    this._kick(dt, this.acc);
    this._drift(dt);
  }

  /** 속도 베를레 (KDK) — 2차, 심플렉틱 */
  _verlet(dt) {
    if (!this._primed) { this.accelerations(this.pos, this.acc); this._primed = true; }
    this._kick(dt / 2, this.acc);
    this._drift(dt);
    this.accelerations(this.pos, this.acc);
    this._kick(dt / 2, this.acc);
  }

  /** Forest-Ruth — 4차 심플렉틱 */
  _forestRuth(dt) {
    const w = [W1, W0, W1];
    for (const wi of w) {
      const h = dt * wi;
      this._drift(h / 2);
      this.accelerations(this.pos, this.acc);
      this._kick(h, this.acc);
      this._drift(h / 2);
    }
  }

  /** PEFRL — 4차, Forest-Ruth 보다 오차 상수가 작다 */
  _pefrl(dt) {
    const A = this.acc;
    this._drift(PE_XI * dt);
    this.accelerations(this.pos, A); this._kick((1 - 2 * PE_LAM) * dt / 2, A);
    this._drift(PE_CHI * dt);
    this.accelerations(this.pos, A); this._kick(PE_LAM * dt, A);
    this._drift((1 - 2 * (PE_CHI + PE_XI)) * dt);
    this.accelerations(this.pos, A); this._kick(PE_LAM * dt, A);
    this._drift(PE_CHI * dt);
    this.accelerations(this.pos, A); this._kick((1 - 2 * PE_LAM) * dt / 2, A);
    this._drift(PE_XI * dt);
  }

  /** 고전 RK4 — 비심플렉틱(에너지 드리프트 비교용) */
  _rk4(dt) {
    const n3 = this.count * 3;
    const p0 = this._tp, v0 = this._tv, K = this._k;
    p0.set(this.pos.subarray(0, n3)); v0.set(this.vel.subarray(0, n3));

    const stage = (s, frac, src) => {
      if (s > 0) {
        for (let i = 0; i < n3; i++) {
          this.pos[i] = p0[i] + K[src].p[i] * dt * frac;
          this.vel[i] = v0[i] + K[src].v[i] * dt * frac;
        }
      }
      this.accelerations(this.pos, this.acc);
      for (let i = 0; i < n3; i++) {
        K[s].p[i] = this.vel[i];
        K[s].v[i] = this.acc[i];
      }
    };
    stage(0, 0, 0);
    stage(1, 0.5, 0);
    stage(2, 0.5, 1);
    stage(3, 1.0, 2);

    for (let i = 0; i < n3; i++) {
      this.pos[i] = p0[i] + dt / 6 * (K[0].p[i] + 2 * K[1].p[i] + 2 * K[2].p[i] + K[3].p[i]);
      this.vel[i] = v0[i] + dt / 6 * (K[0].v[i] + 2 * K[1].v[i] + 2 * K[2].v[i] + K[3].v[i]);
    }
    this._primed = false;
  }

  /** 가속도 기반 권장 시간간격 (eta ≈ 0.02 가 무난) */
  suggestedStep(eta = 0.02) {
    this.accelerations(this.pos, this._a2);
    let best = Infinity;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      const a = Math.hypot(this._a2[i3], this._a2[i3 + 1], this._a2[i3 + 2]);
      if (a > 1e-16) best = Math.min(best, Math.sqrt(this.softening / a));
    }
    this._primed = false;
    return isFinite(best) ? eta * best * 10 : 1;
  }

  // ───────────────────────── 충돌 / 탈출 ─────────────────────────

  _resolveCollisions() {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      if (!this.active[i]) continue;
      for (let j = i + 1; j < n; j++) {
        // 시험입자끼리는 충돌시키지 않는다 (추적자일 뿐 실제 물체가 아니다)
        if (!this.active[j] || (this.mass[i] === 0 && this.mass[j] === 0)) continue;
        const i3 = i * 3, j3 = j * 3;
        const dx = this.pos[j3] - this.pos[i3];
        const dy = this.pos[j3 + 1] - this.pos[i3 + 1];
        const dz = this.pos[j3 + 2] - this.pos[i3 + 2];
        const d = Math.hypot(dx, dy, dz);
        const touch = this.radius[i] + this.radius[j];
        if (d < touch) {
          this._merge(i, j);
          if (!this.active[i]) break; // i 가 흡수된 경우 다음 천체로
        }
      }
    }
  }

  /** 완전 비탄성 충돌: 운동량 보존, 부피 합으로 반경 결정 */
  _merge(i, j) {
    const heavy = this.mass[i] >= this.mass[j] ? i : j;
    const light = heavy === i ? j : i;
    const mh = this.mass[heavy], ml = this.mass[light], M = mh + ml;
    const h3 = heavy * 3, l3 = light * 3;
    // 둘 다 무질량 시험입자면 가중평균이 0/0 이 되므로 흡수만 한다
    if (M > 0) {
      for (let k = 0; k < 3; k++) {
        this.pos[h3 + k] = (this.pos[h3 + k] * mh + this.pos[l3 + k] * ml) / M;
        this.vel[h3 + k] = (this.vel[h3 + k] * mh + this.vel[l3 + k] * ml) / M;
      }
    }
    this.mass[heavy] = M;
    this.radius[heavy] = Math.cbrt(this.radius[heavy] ** 3 + this.radius[light] ** 3);
    this.active[light] = 0;
    this.mergeEvents++;
    this.events.push({
      t: this.time, kind: 'merge',
      text: `${this.meta[light].name} → ${this.meta[heavy].name} 충돌·병합`,
    });
    if (this.events.length > 60) this.events.shift();
    this._primed = false;
  }

  /** 중심에서 rMax 이상 멀어진 천체 제거 */
  pruneEscapers(rMax) {
    const c = this.centerOfMass();
    let removed = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      const d = Math.hypot(this.pos[i3] - c[0], this.pos[i3 + 1] - c[1], this.pos[i3 + 2] - c[2]);
      if (d > rMax) { this.active[i] = 0; removed++; }
    }
    return removed;
  }

  // ───────────────────────── 진단량 ─────────────────────────

  kinetic() {
    let T = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      T += 0.5 * this.mass[i] * (this.vel[i3] ** 2 + this.vel[i3 + 1] ** 2 + this.vel[i3 + 2] ** 2);
    }
    return T;
  }

  potential() {
    let U = 0;
    const eps2 = this.softening * this.softening;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      for (let j = i + 1; j < this.count; j++) {
        if (!this.active[j]) continue;
        const i3 = i * 3, j3 = j * 3;
        const dx = this.pos[j3] - this.pos[i3];
        const dy = this.pos[j3 + 1] - this.pos[i3 + 1];
        const dz = this.pos[j3 + 2] - this.pos[i3 + 2];
        U -= this.G * this.mass[i] * this.mass[j] / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      }
    }
    return U;
  }

  energy() {
    const T = this.kinetic(), U = this.potential();
    return { T, U, E: T + U, virial: U !== 0 ? 2 * T / Math.abs(U) : 0 };
  }

  momentum() {
    const p = [0, 0, 0];
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      for (let k = 0; k < 3; k++) p[k] += this.mass[i] * this.vel[i * 3 + k];
    }
    return p;
  }

  angularMomentum() {
    const L = [0, 0, 0];
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3, m = this.mass[i];
      const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
      const vx = this.vel[i3], vy = this.vel[i3 + 1], vz = this.vel[i3 + 2];
      L[0] += m * (y * vz - z * vy);
      L[1] += m * (z * vx - x * vz);
      L[2] += m * (x * vy - y * vx);
    }
    return L;
  }

  centerOfMass() {
    const c = [0, 0, 0];
    let M = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      M += this.mass[i];
      for (let k = 0; k < 3; k++) c[k] += this.mass[i] * this.pos[i * 3 + k];
    }
    if (M > 0) for (let k = 0; k < 3; k++) c[k] /= M;
    return c;
  }

  centerOfMassVelocity() {
    const c = [0, 0, 0];
    let M = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      M += this.mass[i];
      for (let k = 0; k < 3; k++) c[k] += this.mass[i] * this.vel[i * 3 + k];
    }
    if (M > 0) for (let k = 0; k < 3; k++) c[k] /= M;
    return c;
  }

  totalMass() {
    let M = 0;
    for (let i = 0; i < this.count; i++) if (this.active[i]) M += this.mass[i];
    return M;
  }

  activeCount() {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.active[i]) n++;
    return n;
  }

  /** 질량중심 좌표계로 이동 (운동량 0) */
  recenter() {
    const c = this.centerOfMass(), v = this.centerOfMassVelocity();
    for (let i = 0; i < this.count; i++) {
      for (let k = 0; k < 3; k++) {
        this.pos[i * 3 + k] -= c[k];
        this.vel[i * 3 + k] -= v[k];
      }
    }
    this._primed = false;
  }

  /** 에너지 기준값 저장 → 보존 오차 추적용 */
  markBaseline() {
    const e = this.energy();
    this.e0 = e.E;
    this.l0 = Math.hypot(...this.angularMomentum());
    return e;
  }

  conservationError() {
    if (this.e0 == null) return { energy: 0, angular: 0 };
    const e = this.energy();
    const L = Math.hypot(...this.angularMomentum());
    return {
      energy: this.e0 !== 0 ? Math.abs((e.E - this.e0) / this.e0) : 0,
      angular: this.l0 !== 0 ? Math.abs((L - this.l0) / this.l0) : 0,
      E: e.E, T: e.T, U: e.U, virial: e.virial,
    };
  }

  /** 천체 i 의 상태를 j 기준 상대좌표로 */
  relative(i, j) {
    const i3 = i * 3, j3 = j * 3;
    return {
      r: [this.pos[i3] - this.pos[j3], this.pos[i3 + 1] - this.pos[j3 + 1], this.pos[i3 + 2] - this.pos[j3 + 2]],
      v: [this.vel[i3] - this.vel[j3], this.vel[i3 + 1] - this.vel[j3 + 1], this.vel[i3 + 2] - this.vel[j3 + 2]],
      mu: this.G * (this.mass[i] + this.mass[j]),
    };
  }
}
