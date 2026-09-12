// FREE FREELY - 공용 수학/유틸리티 모듈
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
export const mapRange = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

/** 프레임레이트에 독립적인 지수 감쇠 보간 */
export const damp = (current, target, smoothing, dt) =>
  lerp(current, target, 1 - Math.pow(smoothing, dt));

/** 목표값을 향해 일정 속도로 접근 */
export function approach(current, target, rate, dt) {
  const d = target - current;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return current + sign(d) * step;
}

export function moveTowardsAngle(current, target, rate, dt) {
  let d = ((target - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return current + sign(d) * step;
}

/** 시드 기반 난수 (mulberry32) */
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 결정론적 해시 노이즈 (지형/구름 생성에 사용)                          */
/* ------------------------------------------------------------------ */
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export function valueNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

/** 그라디언트(펄린 유사) 노이즈 — 지형 능선 표현에 유리 */
export function gradNoise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const g = (ix, iy, dx, dy) => {
    const a = hash2(ix, iy) * TAU;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  return lerp(
    lerp(g(xi, yi, xf, yf), g(xi + 1, yi, xf - 1, yf), u),
    lerp(g(xi, yi + 1, xf, yf - 1), g(xi + 1, yi + 1, xf - 1, yf - 1), u),
    v
  );
}

export function fbm2(x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += gradNoise2(fx, fy) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity; fy *= lacunarity;
  }
  return sum / norm;
}

/** 능선형 노이즈 — 산맥 생성 */
export function ridgeNoise2(x, y, octaves = 5) {
  let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(gradNoise2(fx, fy));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    amp *= 0.5;
    fx *= 2.07; fy *= 2.07;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ */
/* 단위 변환 / 표시 포맷                                               */
/* ------------------------------------------------------------------ */
export const msToKnots = (v) => v * 1.94384;
export const msToKmh = (v) => v * 3.6;
export const mToFt = (v) => v * 3.28084;

export function fmt(v, digits = 0) {
  if (!isFinite(v)) return '---';
  return v.toFixed(digits);
}

export function pad(v, len = 3) {
  const s = Math.abs(Math.round(v)).toString();
  return (v < 0 ? '-' : '') + s.padStart(len, '0');
}

export function formatTime(sec) {
  if (!isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function headingName(degHeading) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((degHeading % 360) + 360) % 360 / 22.5) % 16];
}

/** 재사용 가능한 오브젝트 풀 */
export class Pool {
  constructor(factory, reset, size = 0) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    this.active = [];
    for (let i = 0; i < size; i++) this.free.push(factory());
  }
  obtain() {
    const o = this.free.pop() || this.factory();
    this.active.push(o);
    return o;
  }
  release(o) {
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
    if (this.reset) this.reset(o);
    this.free.push(o);
  }
  releaseAt(i) {
    const o = this.active[i];
    this.active.splice(i, 1);
    if (this.reset) this.reset(o);
    this.free.push(o);
    return o;
  }
}

/** 간단한 이벤트 버스 */
export class Emitter {
  constructor() { this.map = new Map(); }
  on(k, fn) { (this.map.get(k) || this.map.set(k, []).get(k)).push(fn); return () => this.off(k, fn); }
  off(k, fn) { const a = this.map.get(k); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(k, ...args) { const a = this.map.get(k); if (a) for (const fn of a.slice()) fn(...args); }
}

/** 이동 평균 필터 (HUD 값 안정화) */
export class Smoothed {
  constructor(value = 0, smoothing = 0.001) { this.value = value; this.smoothing = smoothing; }
  update(target, dt) { this.value = damp(this.value, target, this.smoothing, dt); return this.value; }
}
