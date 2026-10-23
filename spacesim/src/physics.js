// N체 중력 엔진: 직접합 O(N²) + 심플렉틱 적분기 + 적응 시간 간격
// 지원: 연화(softening), 1PN 일반상대론 보정, 파친스키–비타 의사뉴턴 블랙홀 퍼텐셜,
//       완전 비탄성 충돌 병합, 조석 붕괴, 제한 N체(질량 없는 시험 입자 군)
import { G, C } from './orbit.js';

const W1 = 1 / (2 - Math.cbrt(2)), W0 = -Math.cbrt(2) * W1;
const YC = [W1 / 2, (W0 + W1) / 2, (W0 + W1) / 2, W1 / 2], YD = [W1, W0, W1];
export const METHODS = {
  yoshida: 'Yoshida 4차 (심플렉틱)',
  leapfrog: 'Leapfrog KDK 2차 (심플렉틱)',
  rk4: 'Runge–Kutta 4차 (비심플렉틱)',
  euler: '오일러 1차 (비교용·불안정)',
};

export class Sim {
  constructor() {
    this.bodies = []; this.groups = []; this.ship = null;
    this.t = 0; this.method = 'yoshida'; this.eta = 0.02; this.soft = 0;
    this.gr = false; this.collide = true; this.tides = false;
    this.events = []; this.hits = []; this.cap = 0; this.n = 0;
    this.tdyn2 = Infinity; this.dtLimit = Infinity; this.shipIdx = -1; this.cIdx = -1;
    this.shipHook = null; this.onStep = null; this.steps = 0; this.lastDt = 0;
  }

  ensure(n) {
    if (n <= this.cap) return;
    this.cap = Math.max(16, n * 2);
    const f = () => new Float64Array(this.cap * 3);
    this.P = f(); this.V = f(); this.A = f();
    this.P0 = f(); this.V0 = f(); this.TP = f(); this.TV = f(); this.K = f(); this.SP = f(); this.SV = f();
    this.M = new Float64Array(this.cap); this.R = new Float64Array(this.cap); this.RS = new Float64Array(this.cap);
  }

  pack() {
    const bs = this.bodies, s = this.ship, useShip = s && s.alive && !s.landed;
    let n = bs.length; this.ensure(n + 1);
    const { P, V, M, R, RS } = this;
    let cm = -1;
    for (let i = 0; i < n; i++) {
      const b = bs[i]; b._i = i;
      P[3 * i] = b.pos[0]; P[3 * i + 1] = b.pos[1]; P[3 * i + 2] = b.pos[2];
      V[3 * i] = b.vel[0]; V[3 * i + 1] = b.vel[1]; V[3 * i + 2] = b.vel[2];
      M[i] = b.mass; R[i] = b.radius; RS[i] = b.type === 'blackhole' ? 2 * G * b.mass / (C * C) : 0;
      if (cm < 0 || b.mass > M[cm]) cm = i;
    }
    this.cIdx = cm; this.shipIdx = -1;
    if (useShip) {
      P[3 * n] = s.pos[0]; P[3 * n + 1] = s.pos[1]; P[3 * n + 2] = s.pos[2];
      V[3 * n] = s.vel[0]; V[3 * n + 1] = s.vel[1]; V[3 * n + 2] = s.vel[2];
      M[n] = 0; R[n] = 0; RS[n] = 0; this.shipIdx = n; n++;
    }
    this.n = n;
  }

  unpack() {
    const { P, V } = this;
    for (const b of this.bodies) {
      const i = b._i;
      b.pos[0] = P[3 * i]; b.pos[1] = P[3 * i + 1]; b.pos[2] = P[3 * i + 2];
      b.vel[0] = V[3 * i]; b.vel[1] = V[3 * i + 1]; b.vel[2] = V[3 * i + 2];
    }
    if (this.shipIdx >= 0) {
      const s = this.ship, i = this.shipIdx;
      s.pos[0] = P[3 * i]; s.pos[1] = P[3 * i + 1]; s.pos[2] = P[3 * i + 2];
      s.vel[0] = V[3 * i]; s.vel[1] = V[3 * i + 1]; s.vel[2] = V[3 * i + 2];
    }
  }

  acc(P, V, A) {
    const n = this.n, M = this.M, R = this.R, RS = this.RS, e2 = this.soft * this.soft, col = this.collide;
    A.fill(0, 0, n * 3);
    let tmin = Infinity;
    for (let i = 0; i < n; i++) {
      const ix = 3 * i, xi = P[ix], yi = P[ix + 1], zi = P[ix + 2], mi = M[i], ri = R[i], si = RS[i];
      let ax = 0, ay = 0, az = 0;
      for (let j = i + 1; j < n; j++) {
        const jx = 3 * j, dx = P[jx] - xi, dy = P[jx + 1] - yi, dz = P[jx + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2 + e2);
        const s = si > RS[j] ? si : RS[j];
        let f;
        if (s > 0) { const q = Math.max(r - s, s * 0.05); f = 1 / (q * q * r); } else f = 1 / ((r2 + e2) * r);
        const mj = M[j], gi = G * mj * f, gj = G * mi * f;
        ax += gi * dx; ay += gi * dy; az += gi * dz;
        A[jx] -= gj * dx; A[jx + 1] -= gj * dy; A[jx + 2] -= gj * dz;
        const mt = mi + mj;
        if (mt > 0) { const t2 = 1 / (G * mt * f); if (t2 < tmin) tmin = t2; }
        if (col) { const rr = ri + R[j]; if (r2 < rr * rr) this.hits.push(i, j); }
      }
      A[ix] += ax; A[ix + 1] += ay; A[ix + 2] += az;
    }
    if (this.gr && this.cIdx >= 0) {
      const c = this.cIdx, mu = G * M[c], k0 = mu / (C * C), cx = 3 * c;
      for (let i = 0; i < n; i++) {
        if (i === c) continue;
        const ix = 3 * i, rx = P[ix] - P[cx], ry = P[ix + 1] - P[cx + 1], rz = P[ix + 2] - P[cx + 2];
        const vx = V[ix] - V[cx], vy = V[ix + 1] - V[cx + 1], vz = V[ix + 2] - V[cx + 2];
        const r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2), v2 = vx * vx + vy * vy + vz * vz, rv = rx * vx + ry * vy + rz * vz;
        const k = k0 / (r2 * r), t1 = 4 * mu / r - v2;
        const gx = k * (t1 * rx + 4 * rv * vx), gy = k * (t1 * ry + 4 * rv * vy), gz = k * (t1 * rz + 4 * rv * vz);
        const w = M[i] / M[c];
        A[ix] += gx; A[ix + 1] += gy; A[ix + 2] += gz;
        A[cx] -= gx * w; A[cx + 1] -= gy * w; A[cx + 2] -= gz * w;
      }
    }
    this.tdyn2 = tmin;
    this.dtLimit = Infinity;
    if (this.shipIdx >= 0 && this.shipHook) this.shipHook(P, V, A, this.shipIdx);
  }

  stepOnce(h) {
    const n3 = this.n * 3, { P, V, A } = this;
    switch (this.method) {
      case 'euler':
        for (let k = 0; k < n3; k++) { P[k] += V[k] * h; V[k] += A[k] * h; }
        this.acc(P, V, A); break;
      case 'leapfrog':
        for (let k = 0; k < n3; k++) { V[k] += 0.5 * h * A[k]; P[k] += h * V[k]; }
        this.acc(P, V, A);
        for (let k = 0; k < n3; k++) V[k] += 0.5 * h * A[k];
        break;
      case 'rk4': {
        const { P0, V0, TP, TV, K, SP, SV } = this;
        for (let k = 0; k < n3; k++) {
          P0[k] = P[k]; V0[k] = V[k]; SP[k] = V[k]; SV[k] = A[k];
          TP[k] = P[k] + 0.5 * h * V[k]; TV[k] = V[k] + 0.5 * h * A[k];
        }
        this.acc(TP, TV, K);
        for (let k = 0; k < n3; k++) {
          SP[k] += 2 * TV[k]; SV[k] += 2 * K[k];
          const v2 = TV[k]; TP[k] = P0[k] + 0.5 * h * v2; TV[k] = V0[k] + 0.5 * h * K[k];
        }
        this.acc(TP, TV, K);
        for (let k = 0; k < n3; k++) {
          SP[k] += 2 * TV[k]; SV[k] += 2 * K[k];
          const v3 = TV[k]; TP[k] = P0[k] + h * v3; TV[k] = V0[k] + h * K[k];
        }
        this.acc(TP, TV, K);
        for (let k = 0; k < n3; k++) {
          SP[k] += TV[k]; SV[k] += K[k];
          P[k] = P0[k] + h / 6 * SP[k]; V[k] = V0[k] + h / 6 * SV[k];
        }
        this.acc(P, V, A); break;
      }
      default: // yoshida
        for (let s = 0; s < 3; s++) {
          const c = YC[s] * h, d = YD[s] * h;
          for (let k = 0; k < n3; k++) P[k] += c * V[k];
          this.acc(P, V, A);
          for (let k = 0; k < n3; k++) V[k] += d * A[k];
        }
        for (let k = 0; k < n3; k++) P[k] += YC[3] * h * V[k];
    }
  }

  // 시뮬레이션 시간 simDt 만큼 진행 (실시간 예산 초과 시 중단, 실제 진행량 반환)
  advance(simDt, budgetMs = 12) {
    if (!this.bodies.length) { this.t += simDt; return simDt; }
    this.pack(); this.hits.length = 0; this.acc(this.P, this.V, this.A);
    let done = 0; this.steps = 0;
    const t0 = performance.now();
    while (done < simDt * (1 - 1e-12)) {
      let dt = this.eta * Math.sqrt(this.tdyn2);
      if (!(dt > 0) || !isFinite(dt)) dt = simDt;
      dt = Math.min(dt, this.dtLimit, simDt - done);
      this.hits.length = 0;
      this.stepOnce(dt);
      done += dt; this.t += dt; this.steps++;
      if (this.onStep) this.onStep(dt);
      if (this.hits.length) this.resolveHits();
      if (this.tides) this.checkTides();
      if ((this.steps & 7) === 0 && performance.now() - t0 > budgetMs) break;
    }
    this.unpack();
    this.lastDt = done / Math.max(1, this.steps);
    return done;
  }

  rebuild() { this.bodies = this.bodies.filter(b => b.alive); this.pack(); this.hits.length = 0; this.acc(this.P, this.V, this.A); }

  resolveHits() {
    const h = this.hits.slice(); this.unpack();
    let shipBody = null;
    for (let k = 0; k < h.length; k += 2) {
      const i = h[k], j = h[k + 1];
      if (i === this.shipIdx || j === this.shipIdx) { shipBody = this.bodies[i === this.shipIdx ? j : i]; continue; }
      const a = this.bodies[i], b = this.bodies[j];
      if (a.alive && b.alive) this.merge(a, b);
    }
    if (shipBody && this.onShipContact) this.onShipContact(shipBody);
    this.rebuild();
  }

  merge(a, b) {
    const [big, small] = a.mass >= b.mass ? [a, b] : [b, a];
    const m = a.mass + b.mass, wa = a.mass / m, wb = b.mass / m;
    const pos = [0, 1, 2].map(k => a.pos[k] * wa + b.pos[k] * wb), vel = [0, 1, 2].map(k => a.vel[k] * wa + b.vel[k] * wb);
    const m0 = big.mass;
    if (big.type === 'blackhole') big.radius = 2 * G * m / (C * C);
    else if (big.type === 'star') { big.radius *= Math.pow(m / m0, 0.8); big.lum = (big.lum || 0) * Math.pow(m / m0, 3.5); }
    else if (small.type !== 'star' && small.type !== 'blackhole') big.radius = Math.cbrt(big.radius ** 3 + small.radius ** 3);
    big.mass = m; big.pos = pos; big.vel = vel; small.alive = false;
    this.events.push({ type: 'merge', big, small, pos: pos.slice() });
  }

  checkTides() {
    const { P, bodies } = this; let hit = false;
    for (const bh of bodies) {
      if (bh.type !== 'blackhole' || !bh.alive) continue;
      for (const s of bodies) {
        if (s.type !== 'star' || !s.alive) continue;
        const i = 3 * bh._i, j = 3 * s._i;
        const r = Math.hypot(P[i] - P[j], P[i + 1] - P[j + 1], P[i + 2] - P[j + 2]);
        if (r < s.radius * Math.cbrt(bh.mass / s.mass)) { s.alive = false; hit = true; this._tde = { star: s, bh }; }
      }
    }
    if (hit) {
      this.unpack();
      this.events.push({ type: 'tde', star: this._tde.star, bh: this._tde.bh, pos: this._tde.star.pos.slice(), vel: this._tde.star.vel.slice() });
      this.rebuild();
    }
  }

  // 질량이 큰 섭동체만 사용한 제한 N체 적분 (시작/끝 위치 선형 보간)
  advanceGroups(total, perts) {
    if (!this.groups.length || total <= 0) return;
    const np = perts.length, e2 = this.soft * this.soft;
    const pm = perts.map(p => p.m), prs = perts.map(p => p.rs), pcap = perts.map(p => Math.max(p.R, p.rs * 2));
    const ps = perts.flatMap(p => p.s), pd = perts.flatMap((p, k) => [p.e[0] - p.s[0], p.e[1] - p.s[1], p.e[2] - p.s[2]]);
    for (const g of this.groups) {
      const { P, V, alive } = g, visc = g.visc || 0;
      for (let i = 0; i < g.n; i++) {
        if (!alive[i]) continue;
        const ix = 3 * i;
        let x = P[ix], y = P[ix + 1], z = P[ix + 2], vx = V[ix], vy = V[ix + 1], vz = V[ix + 2];
        let td2 = Infinity;
        for (let p = 0; p < np; p++) {
          const dx = x - ps[3 * p], dy = y - ps[3 * p + 1], dz = z - ps[3 * p + 2], r2 = dx * dx + dy * dy + dz * dz + e2;
          const t2 = r2 * Math.sqrt(r2) / (G * pm[p]); if (t2 < td2) td2 = t2;
        }
        const td = Math.sqrt(td2);
        const ns = Math.min(64, Math.max(1, Math.ceil(total / (0.03 * td)))), h = total / ns;
        let ax = 0, ay = 0, az = 0, dead = false;
        for (let s = 0; s <= ns; s++) {
          const f = s / ns;
          ax = 0; ay = 0; az = 0;
          for (let p = 0; p < np; p++) {
            const dx = ps[3 * p] + pd[3 * p] * f - x, dy = ps[3 * p + 1] + pd[3 * p + 1] * f - y, dz = ps[3 * p + 2] + pd[3 * p + 2] * f - z;
            const r2 = dx * dx + dy * dy + dz * dz;
            if (r2 < pcap[p] * pcap[p]) { dead = true; break; }
            const r = Math.sqrt(r2 + e2), q = r - prs[p], k = G * pm[p] / (q * q * r);
            ax += k * dx; ay += k * dy; az += k * dz;
          }
          if (dead) break;
          if (s > 0) {
            vx += 0.5 * h * ax; vy += 0.5 * h * ay; vz += 0.5 * h * az;
            if (visc) { const d = 1 - visc * h / td; vx *= d; vy *= d; vz *= d; }
          }
          if (s === ns) break;
          vx += 0.5 * h * ax; vy += 0.5 * h * ay; vz += 0.5 * h * az;
          x += h * vx; y += h * vy; z += h * vz;
        }
        if (dead) { alive[i] = 0; if (g.respawn) g.respawn(i); continue; }
        P[ix] = x; P[ix + 1] = y; P[ix + 2] = z; V[ix] = vx; V[ix + 1] = vy; V[ix + 2] = vz;
      }
    }
  }

  diagnostics() {
    const bs = this.bodies, e2 = this.soft * this.soft;
    let K = 0, U = 0; const p = [0, 0, 0], L = [0, 0, 0];
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i], m = a.mass, v = a.vel, r = a.pos;
      K += 0.5 * m * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      p[0] += m * v[0]; p[1] += m * v[1]; p[2] += m * v[2];
      L[0] += m * (r[1] * v[2] - r[2] * v[1]); L[1] += m * (r[2] * v[0] - r[0] * v[2]); L[2] += m * (r[0] * v[1] - r[1] * v[0]);
      const sa = a.type === 'blackhole' ? 2 * G * m / (C * C) : 0;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j], sb = b.type === 'blackhole' ? 2 * G * b.mass / (C * C) : 0;
        const r1 = Math.sqrt((a.pos[0] - b.pos[0]) ** 2 + (a.pos[1] - b.pos[1]) ** 2 + (a.pos[2] - b.pos[2]) ** 2 + e2);
        U -= G * m * b.mass / Math.max(r1 - Math.max(sa, sb), 1);
      }
    }
    return { E: K + U, K, U, P: Math.hypot(...p), L: Math.hypot(...L) };
  }
}
