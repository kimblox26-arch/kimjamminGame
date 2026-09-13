// ORBITER — 공용 수학 모듈
// 2D 벡터, 각도, 보간, 난수, 수치해석 유틸리티.
// 모든 단위는 SI(m, kg, s, N, rad)를 기본으로 한다.

export const TAU = Math.PI * 2;
export const PI = Math.PI;
export const HALF_PI = Math.PI / 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const EPS = 1e-12;

/* ──────────────────────────────────────────────────────────────
 * 스칼라 유틸리티
 * ────────────────────────────────────────────────────────────── */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const mapRange = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const mapRangeUnclamped = (v, a, b, c, d) => lerp(c, d, invLerp(a, b, v));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const sqr = (v) => v * v;
export const cube = (v) => v * v * v;

/** 부호를 유지한 거듭제곱 */
export const signedPow = (v, p) => sign(v) * Math.pow(Math.abs(v), p);

/** 데드존을 적용한 아날로그 입력 정규화 */
export function deadzone(v, dz = 0.08) {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return sign(v) * ((a - dz) / (1 - dz));
}

export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

export const smootherstep = (t) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => t * (2 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** 프레임레이트 독립 지수 감쇠. smoothing 은 "1초 뒤 남는 비율" */
export const damp = (current, target, smoothing, dt) =>
  lerp(current, target, 1 - Math.pow(smoothing, dt));

/** 목표를 향해 초당 rate 만큼 접근 */
export function approach(current, target, rate, dt) {
  const d = target - current;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return current + sign(d) * step;
}

/** 각도 정규화: [-PI, PI) */
export function wrapPi(a) {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}

/** 각도 정규화: [0, TAU) */
export function wrapTau(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

/** 두 각도의 최단 차이 (b - a) */
export const angleDelta = (a, b) => wrapPi(b - a);

/** 각도 보간 (최단 경로) */
export const lerpAngle = (a, b, t) => a + angleDelta(a, b) * t;

/** 각도 감쇠 (최단 경로) */
export const dampAngle = (a, b, smoothing, dt) =>
  a + angleDelta(a, b) * (1 - Math.pow(smoothing, dt));

/** 각도를 목표를 향해 초당 rate rad 만큼 접근 */
export function approachAngle(a, b, rate, dt) {
  const d = angleDelta(a, b);
  const step = rate * dt;
  if (Math.abs(d) <= step) return b;
  return a + sign(d) * step;
}

/** 값이 [a,b] 범위 안에 있는가 */
export const inRange = (v, a, b) => v >= a && v <= b;

/** 모듈러 (항상 양수) */
export const mod = (a, b) => ((a % b) + b) % b;

/* ──────────────────────────────────────────────────────────────
 * 난수
 * ────────────────────────────────────────────────────────────── */

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

/** 가우시안 난수 (Box-Muller) */
export function randGauss(mean = 0, sd = 1) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

/** 결정론적 난수 생성기 (mulberry32) */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const fn = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (lo, hi) => lo + fn() * (hi - lo);
  fn.int = (lo, hi) => Math.floor(lo + fn() * (hi - lo + 1));
  fn.pick = (arr) => arr[(fn() * arr.length) | 0];
  fn.chance = (p) => fn() < p;
  fn.sign = () => (fn() < 0.5 ? -1 : 1);
  fn.gauss = (mean = 0, sd = 1) => {
    let u = 0;
    let v = 0;
    while (u === 0) u = fn();
    while (v === 0) v = fn();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  return fn;
}

/** 문자열 → 32bit 해시 (시드 생성용) */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 정수 해시 → [0,1) */
export function hash01(n) {
  n = (n << 13) ^ n;
  return (
    1.0 -
    ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0
  ) * 0.5 + 0.5;
}

/* ──────────────────────────────────────────────────────────────
 * 노이즈 (절차적 지형/텍스처용)
 * ────────────────────────────────────────────────────────────── */

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 1D 값 노이즈 */
export function valueNoise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i + seed * 374761393);
  const b = hash01(i + 1 + seed * 374761393);
  return lerp(a, b, fade(f));
}

/** 2D 값 노이즈 */
export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const s = seed * 374761393;
  const h = (a, b) => hash01(a * 374761393 + b * 668265263 + s);
  const v00 = h(xi, yi);
  const v10 = h(xi + 1, yi);
  const v01 = h(xi, yi + 1);
  const v11 = h(xi + 1, yi + 1);
  const u = fade(xf);
  const v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

/** 1D fBm */
export function fbm1(x, octaves = 4, lacunarity = 2, gain = 0.5, seed = 0) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise1(x * freq, seed + o * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/** 2D fBm */
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5, seed = 0) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + o * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/** 능선형 노이즈 (산맥) */
export function ridged1(x, octaves = 4, seed = 0) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(valueNoise1(x * freq, seed + o * 31) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

/* ──────────────────────────────────────────────────────────────
 * 2D 벡터 — 불변 스타일(새 객체 반환) + 인플레이스(_ 접미사)
 * ────────────────────────────────────────────────────────────── */

export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  clone() {
    return new Vec2(this.x, this.y);
  }

  zero() {
    this.x = 0;
    this.y = 0;
    return this;
  }

  /* 인플레이스 연산 */
  add_(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  addScaled_(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  sub_(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  scale_(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  negate_() {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  rotate_(a) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = this.x * c - this.y * s;
    this.y = this.x * s + this.y * c;
    this.x = x;
    return this;
  }

  normalize_() {
    const l = this.length();
    if (l > EPS) {
      this.x /= l;
      this.y /= l;
    }
    return this;
  }

  clampLength_(max) {
    const l = this.length();
    if (l > max && l > EPS) this.scale_(max / l);
    return this;
  }

  /* 질의 */
  length() {
    return Math.hypot(this.x, this.y);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }

  angle() {
    return Math.atan2(this.y, this.x);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  /** 2D 외적(스칼라) */
  cross(v) {
    return this.x * v.y - this.y * v.x;
  }

  distanceTo(v) {
    return Math.hypot(v.x - this.x, v.y - this.y);
  }

  distanceToSq(v) {
    const dx = v.x - this.x;
    const dy = v.y - this.y;
    return dx * dx + dy * dy;
  }

  isFinite() {
    return Number.isFinite(this.x) && Number.isFinite(this.y);
  }

  toString(p = 2) {
    return `(${this.x.toFixed(p)}, ${this.y.toFixed(p)})`;
  }

  toArray() {
    return [this.x, this.y];
  }

  /* 정적 생성자 */
  static from(v) {
    return new Vec2(v.x, v.y);
  }

  static fromAngle(a, len = 1) {
    return new Vec2(Math.cos(a) * len, Math.sin(a) * len);
  }

  static zeroVec() {
    return new Vec2(0, 0);
  }
}

export const v2 = (x = 0, y = 0) => new Vec2(x, y);

/* 순수 함수 버전 — 새 Vec2 반환 */
export const vAdd = (a, b) => new Vec2(a.x + b.x, a.y + b.y);
export const vSub = (a, b) => new Vec2(a.x - b.x, a.y - b.y);
export const vMul = (a, s) => new Vec2(a.x * s, a.y * s);
export const vNeg = (a) => new Vec2(-a.x, -a.y);
export const vDot = (a, b) => a.x * b.x + a.y * b.y;
export const vCross = (a, b) => a.x * b.y - a.y * b.x;
export const vLen = (a) => Math.hypot(a.x, a.y);
export const vLenSq = (a) => a.x * a.x + a.y * a.y;
export const vDist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const vAngle = (a) => Math.atan2(a.y, a.x);

export function vNorm(a) {
  const l = Math.hypot(a.x, a.y);
  return l > EPS ? new Vec2(a.x / l, a.y / l) : new Vec2(0, 0);
}

export function vRot(a, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return new Vec2(a.x * c - a.y * s, a.x * s + a.y * c);
}

/** 90도 좌회전 (수직 벡터) */
export const vPerp = (a) => new Vec2(-a.y, a.x);

export const vLerp = (a, b, t) =>
  new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/** a 를 b 위에 투영 */
export function vProject(a, b) {
  const d = vLenSq(b);
  if (d < EPS) return new Vec2(0, 0);
  const s = vDot(a, b) / d;
  return new Vec2(b.x * s, b.y * s);
}

/** b 에 수직인 성분 */
export function vReject(a, b) {
  const p = vProject(a, b);
  return new Vec2(a.x - p.x, a.y - p.y);
}

/** 법선 n 에 대한 반사 (n 은 단위벡터여야 함) */
export function vReflect(a, n) {
  const d = 2 * vDot(a, n);
  return new Vec2(a.x - n.x * d, a.y - n.y * d);
}

/** 두 벡터 사이 각도 (부호 있음) */
export function vAngleBetween(a, b) {
  return Math.atan2(vCross(a, b), vDot(a, b));
}

/* ──────────────────────────────────────────────────────────────
 * 기하 헬퍼
 * ────────────────────────────────────────────────────────────── */

/** 점 p 와 선분 ab 사이 최단 거리 제곱 */
export function pointSegmentDistSq(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len = abx * abx + aby * aby;
  let t = len > EPS ? (apx * abx + apy * aby) / len : 0;
  t = clamp01(t);
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  return dx * dx + dy * dy;
}

/** 선분 교차 판정 — 교차점 반환 or null */
export function segmentIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < EPS) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return new Vec2(p1.x + d1x * t, p1.y + d1y * t);
}

/** 축 정렬 사각형 겹침 */
export function rectOverlap(a, b) {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

/** 점이 사각형 안에 있는가 */
export const pointInRect = (px, py, r) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/** 원-원 충돌 */
export function circleOverlap(ax, ay, ar, bx, by, br) {
  const dx = bx - ax;
  const dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/** 회전 사각형(OBB) 의 꼭짓점 4개 */
export function obbCorners(cx, cy, w, h, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  const pts = [];
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sy] of signs) {
    const lx = hw * sx;
    const ly = hh * sy;
    pts.push(new Vec2(cx + lx * c - ly * s, cy + lx * s + ly * c));
  }
  return pts;
}

/** SAT 기반 OBB-OBB 겹침 판정 */
export function obbOverlap(a, b) {
  const axes = [
    new Vec2(Math.cos(a.angle), Math.sin(a.angle)),
    new Vec2(-Math.sin(a.angle), Math.cos(a.angle)),
    new Vec2(Math.cos(b.angle), Math.sin(b.angle)),
    new Vec2(-Math.sin(b.angle), Math.cos(b.angle)),
  ];
  const ca = obbCorners(a.x, a.y, a.w, a.h, a.angle);
  const cb = obbCorners(b.x, b.y, b.w, b.h, b.angle);
  for (const ax of axes) {
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const p of ca) {
      const d = vDot(p, ax);
      if (d < amin) amin = d;
      if (d > amax) amax = d;
    }
    for (const p of cb) {
      const d = vDot(p, ax);
      if (d < bmin) bmin = d;
      if (d > bmax) bmax = d;
    }
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

/* ──────────────────────────────────────────────────────────────
 * 수치해석
 * ────────────────────────────────────────────────────────────── */

/**
 * 뉴턴-랩슨 근 찾기.
 * @param {(x:number)=>number} f
 * @param {(x:number)=>number} df
 */
export function newton(f, df, x0, tol = 1e-10, maxIter = 60) {
  let x = x0;
  for (let i = 0; i < maxIter; i++) {
    const fx = f(x);
    if (Math.abs(fx) < tol) return x;
    const d = df(x);
    if (Math.abs(d) < EPS) break;
    const nx = x - fx / d;
    if (Math.abs(nx - x) < tol) return nx;
    x = nx;
  }
  return x;
}

/** 이분법 — 구간 [a,b] 에서 부호가 바뀌어야 한다 */
export function bisect(f, a, b, tol = 1e-9, maxIter = 200) {
  let fa = f(a);
  let fb = f(b);
  if (fa * fb > 0) return null;
  for (let i = 0; i < maxIter; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (Math.abs(fm) < tol || (b - a) / 2 < tol) return m;
    if (fa * fm < 0) {
      b = m;
      fb = fm;
    } else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

/** 황금분할 최소값 탐색 */
export function goldenMin(f, a, b, tol = 1e-7, maxIter = 200) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < maxIter && Math.abs(b - a) > tol; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/** 1차 저역통과 필터 */
export class LowPass {
  constructor(value = 0, tau = 0.1) {
    this.value = value;
    this.tau = tau;
  }

  update(target, dt) {
    const a = this.tau > EPS ? 1 - Math.exp(-dt / this.tau) : 1;
    this.value += (target - this.value) * a;
    return this.value;
  }

  reset(v = 0) {
    this.value = v;
    return this;
  }
}

/** PID 제어기 — 자세제어/오토파일럿용 */
export class PID {
  constructor(kp = 1, ki = 0, kd = 0, opts = {}) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.integral = 0;
    this.prevError = 0;
    this.prevMeasure = 0;
    this.output = 0;
    this.min = opts.min ?? -1;
    this.max = opts.max ?? 1;
    this.integralLimit = opts.integralLimit ?? 1;
    this.derivativeOnMeasure = opts.derivativeOnMeasure ?? true;
    this.firstRun = true;
  }

  reset() {
    this.integral = 0;
    this.prevError = 0;
    this.prevMeasure = 0;
    this.output = 0;
    this.firstRun = true;
    return this;
  }

  update(error, dt, measure = null) {
    if (dt <= 0) return this.output;
    if (this.firstRun) {
      this.prevError = error;
      this.prevMeasure = measure ?? 0;
      this.firstRun = false;
    }
    this.integral = clamp(
      this.integral + error * dt,
      -this.integralLimit,
      this.integralLimit
    );
    let deriv;
    if (this.derivativeOnMeasure && measure !== null) {
      deriv = -(measure - this.prevMeasure) / dt;
      this.prevMeasure = measure;
    } else {
      deriv = (error - this.prevError) / dt;
    }
    this.prevError = error;
    let out = this.kp * error + this.ki * this.integral + this.kd * deriv;
    // 안티 와인드업 — 포화 시 적분항 되감기
    if (out > this.max) {
      if (this.ki > EPS) this.integral -= (out - this.max) / this.ki;
      out = this.max;
    } else if (out < this.min) {
      if (this.ki > EPS) this.integral -= (out - this.min) / this.ki;
      out = this.min;
    }
    this.output = out;
    return out;
  }
}

/** 이동 평균 링버퍼 */
export class RollingAverage {
  constructor(size = 30) {
    this.size = size;
    this.buf = new Float64Array(size);
    this.idx = 0;
    this.count = 0;
    this.sum = 0;
  }

  push(v) {
    if (this.count === this.size) this.sum -= this.buf[this.idx];
    else this.count++;
    this.buf[this.idx] = v;
    this.sum += v;
    this.idx = (this.idx + 1) % this.size;
    return this.average;
  }

  get average() {
    return this.count ? this.sum / this.count : 0;
  }

  reset() {
    this.buf.fill(0);
    this.idx = 0;
    this.count = 0;
    this.sum = 0;
  }
}

/* ──────────────────────────────────────────────────────────────
 * 포맷팅 — HUD 표시용
 * ────────────────────────────────────────────────────────────── */

/** 거리: m / km / Mm / Gm */
export function formatDistance(m, digits = 1) {
  const a = Math.abs(m);
  if (a < 1000) return `${m.toFixed(a < 10 ? 1 : 0)} m`;
  if (a < 1e6) return `${(m / 1e3).toFixed(digits)} km`;
  if (a < 1e9) return `${(m / 1e6).toFixed(digits)} Mm`;
  return `${(m / 1e9).toFixed(digits)} Gm`;
}

/** 속도 */
export function formatSpeed(ms, digits = 1) {
  const a = Math.abs(ms);
  if (a < 1000) return `${ms.toFixed(digits)} m/s`;
  return `${(ms / 1000).toFixed(2)} km/s`;
}

/** 질량 */
export function formatMass(kg) {
  const a = Math.abs(kg);
  if (a < 1000) return `${kg.toFixed(0)} kg`;
  if (a < 1e6) return `${(kg / 1e3).toFixed(2)} t`;
  return `${(kg / 1e6).toFixed(2)} kt`;
}

/** 힘 */
export function formatForce(n) {
  const a = Math.abs(n);
  if (a < 1000) return `${n.toFixed(0)} N`;
  if (a < 1e6) return `${(n / 1e3).toFixed(1)} kN`;
  return `${(n / 1e6).toFixed(2)} MN`;
}

/** 시간: 1y 20d 03:14:15 */
export function formatTime(sec, compact = false) {
  const neg = sec < 0;
  sec = Math.abs(Math.floor(sec));
  const y = Math.floor(sec / 31536000);
  sec -= y * 31536000;
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const pad = (v) => String(v).padStart(2, '0');
  let out = '';
  if (y > 0) out += `${y}년 `;
  if (d > 0 || y > 0) out += `${d}일 `;
  if (compact && y === 0 && d === 0) out += `${pad(m)}:${pad(s)}`;
  else out += `${pad(h)}:${pad(m)}:${pad(s)}`;
  return (neg ? '-' : '') + out;
}

/** 짧은 시간 표기 (T- 카운트다운용) */
export function formatClock(sec) {
  const neg = sec < 0;
  sec = Math.abs(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (v) => String(v).padStart(2, '0');
  return `${neg ? '-' : '+'}${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** 숫자 천 단위 구분 */
export function formatNumber(v, digits = 0) {
  return v.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 퍼센트 */
export const formatPercent = (v, digits = 0) =>
  `${(v * 100).toFixed(digits)}%`;

/* ──────────────────────────────────────────────────────────────
 * 색상
 * ────────────────────────────────────────────────────────────── */

/** HSL → CSS 문자열 */
export const hsl = (h, s, l, a = 1) =>
  a >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${a})`;

/** #rrggbb → {r,g,b} (0-255) */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n =
    h.length === 3
      ? parseInt(
          h
            .split('')
            .map((c) => c + c)
            .join(''),
          16
        )
      : parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgbToHex = (r, g, b) =>
  `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

/** 두 hex 색을 선형 보간 */
export function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    Math.round(lerp(ca.r, cb.r, t)),
    Math.round(lerp(ca.g, cb.g, t)),
    Math.round(lerp(ca.b, cb.b, t))
  );
}

/** hex + alpha → rgba() */
export function withAlpha(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/** 밝기 조절 */
export function shade(hex, amount) {
  const c = hexToRgb(hex);
  const f = (v) =>
    Math.round(clamp(amount >= 0 ? lerp(v, 255, amount) : v * (1 + amount), 0, 255));
  return rgbToHex(f(c.r), f(c.g), f(c.b));
}

/* ──────────────────────────────────────────────────────────────
 * 배열 유틸
 * ────────────────────────────────────────────────────────────── */

export function removeFrom(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  return arr;
}

/** 순서를 유지하지 않는 빠른 제거 */
export function swapRemove(arr, index) {
  const last = arr.length - 1;
  if (index !== last) arr[index] = arr[last];
  arr.pop();
  return arr;
}

export function sum(arr, fn = (v) => v) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += fn(arr[i], i);
  return s;
}

export function minBy(arr, fn) {
  let best = null;
  let bestV = Infinity;
  for (const item of arr) {
    const v = fn(item);
    if (v < bestV) {
      bestV = v;
      best = item;
    }
  }
  return best;
}

export function maxBy(arr, fn) {
  let best = null;
  let bestV = -Infinity;
  for (const item of arr) {
    const v = fn(item);
    if (v > bestV) {
      bestV = v;
      best = item;
    }
  }
  return best;
}

export function groupBy(arr, fn) {
  const out = new Map();
  for (const item of arr) {
    const k = fn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

export function uniq(arr) {
  return [...new Set(arr)];
}

export const range = (n) => Array.from({ length: n }, (_, i) => i);

/** 안전한 깊은 복제 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = deepClone(obj[k]);
  }
  return out;
}

/** 얕은 깊이 병합 (target 을 수정) */
export function deepMerge(target, source) {
  for (const k in source) {
    if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
    const sv = source[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}
