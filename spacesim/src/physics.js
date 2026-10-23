// 간단한 N체 중력 엔진: 뉴턴 만유인력 + Leapfrog 적분 + 충돌 병합
export const G = 1;
const EPS2 = 0.01; // 연화 길이²

export const radiusFor = (m, star) => (star ? 0.6 : 1.3) * Math.cbrt(m);

export class World {
  constructor() { this.bodies = []; this.t = 0; this.events = []; this.tdyn = Infinity; }

  // 가속도 계산 + 충돌 검출
  acc() {
    const b = this.bodies, n = b.length, hits = [];
    let tmin = Infinity;
    for (const x of b) x.a = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const p = b[i], q = b[j], dx = q.pos[0] - p.pos[0], dy = q.pos[1] - p.pos[1], dz = q.pos[2] - p.pos[2];
      const r2 = dx * dx + dy * dy + dz * dz + EPS2, r = Math.sqrt(r2), f = G / (r2 * r);
      p.a[0] += q.mass * f * dx; p.a[1] += q.mass * f * dy; p.a[2] += q.mass * f * dz;
      q.a[0] -= p.mass * f * dx; q.a[1] -= p.mass * f * dy; q.a[2] -= p.mass * f * dz;
      tmin = Math.min(tmin, r2 * r / (G * (p.mass + q.mass)));
      if (r < p.radius + q.radius) hits.push([p, q]);
    }
    this.tdyn = Math.sqrt(tmin);
    return hits;
  }

  // 완전 비탄성 충돌: 질량·운동량 보존
  merge(a, b) {
    if (a.dead || b.dead) return;
    const [big, small] = a.mass >= b.mass ? [a, b] : [b, a], m = a.mass + b.mass;
    for (let k = 0; k < 3; k++) {
      big.pos[k] = (a.pos[k] * a.mass + b.pos[k] * b.mass) / m;
      big.vel[k] = (a.vel[k] * a.mass + b.vel[k] * b.mass) / m;
    }
    big.mass = m; big.star = a.star || b.star; big.radius = radiusFor(m, big.star);
    small.dead = true;
    this.events.push({ big, small });
  }

  step(dt) {
    const b = this.bodies;
    for (const x of b) for (let k = 0; k < 3; k++) { x.vel[k] += 0.5 * dt * x.a[k]; x.pos[k] += dt * x.vel[k]; }
    const hits = this.acc();
    for (const x of b) for (let k = 0; k < 3; k++) x.vel[k] += 0.5 * dt * x.a[k];
    if (hits.length) {
      for (const [p, q] of hits) this.merge(p, q);
      this.bodies = b.filter(x => !x.dead);
      this.acc();
    }
  }

  // 시간 T 만큼 진행 (근접 시 시간 간격 자동 축소)
  advance(T) {
    if (!this.bodies.length) return;
    this.acc();
    let done = 0;
    const t0 = performance.now();
    while (done < T && performance.now() - t0 < 12) {
      const dt = Math.min(T - done, 0.01 * this.tdyn);
      this.step(dt); done += dt;
    }
    this.t += done;
  }
}
