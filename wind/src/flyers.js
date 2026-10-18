// 비행체: 종이 글라이더(2익면 공기역학), 민들레 홀씨(항력 입자), 풍등(부력)
// env: { wind(x, y, out), hit(x, y) → 0 공기 · 1 지형 · 2 물, time }

export const PHYS = { G: 18 };
const RHO = 1.2;
const tmp = [0, 0];

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

// 익면 계수: 부착 유동(유한 날개) ↔ 박리 유동(평판) 혼합
function coeffs(alpha, AR, cd0, out) {
  const a = wrap(alpha), aa = Math.abs(a);
  const t = smooth(0.24, 0.38, aa);
  const slope = (2 * Math.PI * AR) / (AR + 2);
  const clA = slope * a;
  const clS = 1.05 * Math.sin(2 * a);
  const cl = clA * (1 - t) + clS * t;
  const cd = cd0 + (1 - t) * (clA * clA) / (Math.PI * AR * 0.8) + t * 1.9 * Math.sin(a) ** 2;
  out[0] = cl; out[1] = cd;
  return out;
}

export const GLIDER = {
  m: 1, I: 0.034, cdA: 0.03,
  surfaces: [
    { x: -0.03, S: 1.29, AR: 5, inc: 0, cd0: 0.03 },
    { x: -0.62, S: 0.34, AR: 3.5, inc: -0.14, cd0: 0.03 },
  ],
  radius: 0.9, nose: 1.1,
};

export class Glider {
  constructor(x, y, speed, angle) {
    this.kind = 'glider';
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed;
    this.a = angle; this.w = 0;
    this.state = 'fly';
    this.airspeed = speed; this.alpha = 0;
    this.trail = [];
    this.trailT = 0;
    this.age = 0;
  }

  step(dt, env) {
    if (this.state !== 'fly') return;
    this.age += dt;
    const P = GLIDER, c = Math.cos(this.a), s = Math.sin(this.a);
    let fx = 0, fy = -PHYS.G * P.m, tq = 0;
    const cf = [0, 0];
    for (const sf of P.surfaces) {
      const rx = c * sf.x, ry = s * sf.x;
      const pvx = this.vx - this.w * ry, pvy = this.vy + this.w * rx;
      env.wind(this.x + rx, this.y + ry, tmp);
      const ax = pvx - tmp[0], ay = pvy - tmp[1];
      const V2 = ax * ax + ay * ay;
      if (V2 < 1e-8) continue;
      const V = Math.sqrt(V2);
      const vf = ax * c + ay * s, vn = -ax * s + ay * c;
      const alpha = Math.atan2(-vn, vf) + sf.inc;
      coeffs(alpha, sf.AR, sf.cd0, cf);
      const q = 0.5 * RHO * V2 * sf.S;
      const Fx = (q * (cf[0] * -ay - cf[1] * ax)) / V;
      const Fy = (q * (cf[0] * ax - cf[1] * ay)) / V;
      fx += Fx; fy += Fy;
      tq += rx * Fy - ry * Fx;
      if (sf === P.surfaces[0]) { this.airspeed = V; this.alpha = wrap(alpha); }
    }
    env.wind(this.x, this.y, tmp);
    const bx = this.vx - tmp[0], by = this.vy - tmp[1], bV = Math.hypot(bx, by);
    fx -= 0.5 * RHO * P.cdA * bV * bx; fy -= 0.5 * RHO * P.cdA * bV * by;
    tq -= 0.003 * this.w;

    this.vx += (fx / P.m) * dt; this.vy += (fy / P.m) * dt;
    this.w += (tq / P.I) * dt;
    if (this.w > 40) this.w = 40; else if (this.w < -40) this.w = -40;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.a = wrap(this.a + this.w * dt);

    const nc = Math.cos(this.a), ns = Math.sin(this.a);
    const h = env.hit(this.x, this.y) || env.hit(this.x + nc * P.nose, this.y + ns * P.nose)
      || env.hit(this.x - nc * P.nose * 0.8, this.y - ns * P.nose * 0.8)
      || env.hit(this.x, this.y - P.radius * 0.6);
    if (h) this.state = h === 2 ? 'splash' : 'crash';

    this.trailT += dt;
    if (this.trailT > 0.03) {
      this.trailT = 0;
      this.trail.push(this.x, this.y);
      if (this.trail.length > 240) this.trail.splice(0, 2);
    }
  }
}

// 민들레 홀씨: 공기에 거의 묶여 움직이고 천천히 떨어짐
export class Seed {
  constructor(x, y, delay, rnd) {
    this.kind = 'seed';
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.delay = delay;
    this.state = 'wait';
    this.ph = rnd * 100;
    this.spin = rnd * 6.28;
    this.tau = 0.28; this.fall = 1.15;
    this.trail = [];
    this.trailT = 0;
  }

  step(dt, env) {
    if (this.state === 'wait') {
      this.delay -= dt;
      if (this.delay <= 0) this.state = 'fly';
      return;
    }
    if (this.state !== 'fly') return;
    env.wind(this.x, this.y, tmp);
    const t = env.time + this.ph;
    const flx = Math.sin(t * 2.3) * 0.5 + Math.sin(t * 5.1) * 0.25;
    const fly = Math.cos(t * 1.7) * 0.35;
    const k = dt / this.tau;
    this.vx += (tmp[0] + flx - this.vx) * k;
    this.vy += (tmp[1] - this.fall + fly - this.vy) * k;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.spin += (this.vx * 0.15 + 0.4) * dt;
    const h = env.hit(this.x, this.y - 0.3);
    if (h) this.state = h === 2 ? 'splash' : 'stuck';
    this.trailT += dt;
    if (this.trailT > 0.06) {
      this.trailT = 0;
      this.trail.push(this.x, this.y);
      if (this.trail.length > 60) this.trail.splice(0, 2);
    }
  }
}

// 풍등: 버너가 켜져 있는 동안 떠오르고, 연료가 다하면 서서히 내려앉음
export class Lantern {
  constructor(x, y, delay, fuel, rnd, lift = 2.2) {
    this.kind = 'lantern';
    this.lift = lift;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.delay = delay; this.fuel = fuel; this.fuel0 = fuel;
    this.state = 'wait';
    this.ph = rnd * 100;
    this.tau = 1.1;
    this.trail = [];
    this.trailT = 0;
  }

  step(dt, env) {
    if (this.state === 'wait') {
      this.delay -= dt;
      if (this.delay <= 0) this.state = 'fly';
      return;
    }
    if (this.state !== 'fly') return;
    this.fuel -= dt;
    const burn = this.fuel > 0 ? Math.min(1, this.fuel / 3 + 0.35) : 0;
    const rise = burn > 0 ? this.lift * burn : -1.6;
    env.wind(this.x, this.y + 0.6, tmp);
    const t = env.time + this.ph;
    const k = dt / this.tau;
    this.vx += (tmp[0] + Math.sin(t * 0.9) * 0.2 - this.vx) * k;
    this.vy += (tmp[1] + rise - this.vy) * k;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const h = env.hit(this.x, this.y + 1.1) || env.hit(this.x, this.y - 0.6) || env.hit(this.x - 0.7, this.y) || env.hit(this.x + 0.7, this.y);
    if (h) this.state = h === 2 ? 'splash' : 'burnt';
    this.trailT += dt;
    if (this.trailT > 0.08) {
      this.trailT = 0;
      this.trail.push(this.x, this.y);
      if (this.trail.length > 80) this.trail.splice(0, 2);
    }
  }
}
