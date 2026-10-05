// SpaceSim — N-체 중력 적분기 (Kick-Drift-Kick 립프로그, 심플렉틱)
// 구조체 배열(Float64Array) 레이아웃 · 선택적 소프트닝 · 적응 시간 간격 · 충돌 병합

const KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'ax', 'ay', 'az', 'm', 'r'];

export class NBody {
  constructor({ G = 1, softening = 0, merge = false, adaptive = false, eta = 0.02 } = {}) {
    this.G = G;
    this.eps2 = softening * softening;
    this.merge = merge;
    this.adaptive = adaptive;
    this.eta = eta;
    this.n = 0;
    this.cap = 0;
    this.bodies = [];
    this.pairs = [];
    this.time = 0;
    this.minTau = Infinity;
    this.accValid = false;
    this.onStep = null;
    this.onMerge = null;
    this._alloc(16);
  }

  _alloc(cap) {
    for (const k of KEYS) {
      const a = new Float64Array(cap);
      if (this[k]) a.set(this[k].subarray(0, this.n));
      this[k] = a;
    }
    this.cap = cap;
  }

  add(body, m, p, v, radius = 0) {
    if (this.n >= this.cap) this._alloc(this.cap * 2);
    const i = this.n++;
    this.x[i] = p[0]; this.y[i] = p[1]; this.z[i] = p[2];
    this.vx[i] = v[0]; this.vy[i] = v[1]; this.vz[i] = v[2];
    this.m[i] = m; this.r[i] = radius;
    body.idx = i;
    body.dead = false;
    this.bodies[i] = body;
    this.accValid = false;
    return i;
  }

  removeAt(i) {
    const n = this.n;
    for (const k of KEYS) this[k].copyWithin(i, i + 1, n);
    const [b] = this.bodies.splice(i, 1);
    b.dead = true;
    this.n--;
    for (let j = i; j < this.n; j++) this.bodies[j].idx = j;
    this.accValid = false;
    return b;
  }

  clear() {
    for (const b of this.bodies) b.dead = true;
    this.bodies.length = 0;
    this.n = 0;
    this.time = 0;
  }

  computeAcc() {
    const { n, x, y, z, ax, ay, az, m, r, G, eps2 } = this;
    ax.fill(0, 0, n); ay.fill(0, 0, n); az.fill(0, 0, n);
    const adaptive = this.adaptive, merge = this.merge;
    this.pairs.length = 0;
    let minTau2 = Infinity;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], zi = z[i], mi = m[i], ri = r[i];
      let axi = 0, ayi = 0, azi = 0;
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - xi, dy = y[j] - yi, dz = z[j] - zi;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r2 = d2 + eps2;
        const r3 = r2 * Math.sqrt(r2);
        const inv = G / r3;
        const fj = m[j] * inv, fi = mi * inv;
        axi += dx * fj; ayi += dy * fj; azi += dz * fj;
        ax[j] -= dx * fi; ay[j] -= dy * fi; az[j] -= dz * fi;
        if (adaptive) {
          const mm = mi + m[j];
          if (mm > 0) { const t2 = r3 / (G * mm); if (t2 < minTau2) minTau2 = t2; }
        }
        if (merge) {
          const rr = ri + r[j];
          if (d2 < rr * rr) this.pairs.push(i, j);
        }
      }
      ax[i] += axi; ay[i] += ayi; az[i] += azi;
    }
    this.minTau = Math.sqrt(minTau2);
    this.accValid = true;
  }

  step(dt) {
    if (!this.accValid) this.computeAcc();
    const { n, x, y, z, vx, vy, vz, ax, ay, az } = this;
    const h = dt * 0.5;
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
    }
    this.computeAcc();
    for (let i = 0; i < n; i++) {
      vx[i] += ax[i] * h; vy[i] += ay[i] * h; vz[i] += az[i] * h;
    }
    this.time += dt;
    if (this.pairs.length) this.resolveMerges();
  }

  // 실제 경과 시간 예산 안에서 simDt 만큼 적분. 실제로 진행한 시간 반환.
  advance(simDt, dtMax, budgetMs = 10) {
    const t0 = performance.now();
    let done = 0, steps = 0;
    while (done < simDt) {
      let h = Math.min(dtMax, simDt - done);
      if (this.adaptive && isFinite(this.minTau)) h = Math.min(h, Math.max(this.eta * this.minTau, dtMax * 1e-4));
      this.step(h);
      done += h;
      steps++;
      if (this.onStep) this.onStep();
      if ((steps & 7) === 0 && performance.now() - t0 > budgetMs) break;
    }
    this.lastSteps = steps;
    return done;
  }

  resolveMerges() {
    const bs = this.pairs.map((i) => this.bodies[i]);
    this.pairs.length = 0;
    for (let k = 0; k < bs.length; k += 2) {
      const a = bs[k], b = bs[k + 1];
      if (a.dead || b.dead || a === b) continue;
      if (this.onCollision && this.onCollision(a, b)) continue;
      this.mergeBodies(a, b);
    }
    this.pairs.length = 0;
    this.computeAcc();
  }

  // 완전 비탄성 병합 (운동량·질량중심 보존). 무거운 쪽이 남음.
  mergeBodies(a, b) {
    if (this.m[b.idx] > this.m[a.idx]) [a, b] = [b, a];
    const ia = a.idx, ib = b.idx;
    const ma = this.m[ia], mb = this.m[ib], M = ma + mb;
    const w = M > 0 ? mb / M : 0.5;
    const info = { survivor: a, absorbed: b, massA: ma, massB: mb, pos: [this.x[ib], this.y[ib], this.z[ib]], posA: [this.x[ia], this.y[ia], this.z[ia]] };
    for (const [p, v] of [['x', 'vx'], ['y', 'vy'], ['z', 'vz']]) {
      this[p][ia] += (this[p][ib] - this[p][ia]) * w;
      this[v][ia] += (this[v][ib] - this[v][ia]) * w;
    }
    this.m[ia] = M;
    this.r[ia] = Math.cbrt(this.r[ia] ** 3 + this.r[ib] ** 3);
    this.removeAt(ib);
    if (this.onMerge) this.onMerge(info);
    this.accValid = false;
    return info;
  }

  energy() {
    const { n, x, y, z, vx, vy, vz, m, G, eps2 } = this;
    let K = 0, U = 0;
    for (let i = 0; i < n; i++) {
      K += 0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
        U -= (G * m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      }
    }
    return { K, U, E: K + U };
  }

  // 질량 중심 정지 좌표계로 이동
  toCOM() {
    const { n, m } = this;
    let M = 0;
    const c = [0, 0, 0, 0, 0, 0], keys = ['x', 'y', 'z', 'vx', 'vy', 'vz'];
    for (let i = 0; i < n; i++) { M += m[i]; keys.forEach((k, q) => (c[q] += this[k][i] * m[i])); }
    if (M <= 0) return;
    keys.forEach((k, q) => { const s = c[q] / M; for (let i = 0; i < n; i++) this[k][i] -= s; });
    this.accValid = false;
  }
}
