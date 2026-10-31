// 좌표 변환과 지형 높이. 1 단위 = 1 m, x = 동쪽, z = 남쪽 (북쪽이 -z)
import { CITIES, PEAKS, RIDGES, EXTRA_RIVERS, ISLETS } from './data/places.js';

export const LAT0 = 36.0, LON0 = 127.8;
export const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574;
export const toXZ = (lat, lon) => [(lon - LON0) * KX, (LAT0 - lat) * KZ];
export const toLatLon = (x, z) => [LAT0 - z / KZ, LON0 + x / KX];

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// ── 2D 펄린 노이즈 ──
const P = new Uint8Array(512);
{ let s = 1234567; const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function noise(x, y) {
  const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const g = (h, dx, dy) => { const q = G[h & 7]; return q[0] * dx + q[1] * dy; };
  const a = P[xi] + yi, b = P[xi + 1] + yi;
  const n00 = g(P[a], xf, yf), n10 = g(P[b], xf - 1, yf), n01 = g(P[a + 1], xf, yf - 1), n11 = g(P[b + 1], xf - 1, yf - 1);
  return (n00 + u * (n10 - n00) + v * (n01 + u * (n11 - n01) - n00 - u * (n10 - n00))) * 0.9;
}
export function fbm(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
export const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

const RES = 300, CRES = 1000;

export class Terrain {
  async build(geo, progress) {
    const [lonA, latA, lonB, latB] = geo.bbox;
    const [x0, z1] = toXZ(latA, lonA), [x1, z0] = toXZ(latB, lonB);
    this.x0 = x0; this.z0 = z0; this.W = Math.ceil((x1 - x0) / RES); this.H = Math.ceil((z1 - z0) / RES);
    this.size = [x1 - x0, z1 - z0];
    const W = this.W, H = this.H;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const px = (lat, lon) => { const [x, z] = toXZ(lat, lon); return [(x - x0) / RES, (z - z0) / RES]; };
    const read = () => { const d = ctx.getImageData(0, 0, W, H).data, o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = d[i * 4]; return o; };
    // 육지
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff';
    for (const r of geo.coast) {
      ctx.beginPath();
      for (let i = 0; i < r.length; i += 2) { const [a, b] = px(r[i + 1], r[i]); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }
      ctx.closePath(); ctx.fill();
    }
    for (const [, la, lo, rad] of ISLETS) { const [a, b] = px(la, lo); ctx.beginPath(); ctx.arc(a, b, Math.max(0.8, rad / RES), 0, 7); ctx.fill(); }
    const land = read(); await progress?.(0.25);
    // 강
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = '#fff'; ctx.lineCap = ctx.lineJoin = 'round';
    const strokeRiver = (pts, w) => {
      ctx.lineWidth = Math.max(0.9, w / RES); ctx.beginPath();
      pts.forEach(([la, lo], i) => { const [a, b] = px(la, lo); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke();
    };
    this.rivers = [];
    for (const r of geo.rivers) {
      if (r.name === 'Han') continue; // 한강은 places.js 의 정밀한 선을 쓴다
      const pts = []; for (let i = 0; i < r.pts.length; i += 2) pts.push([r.pts[i + 1], r.pts[i]]);
      const w = r.name === 'Nakdong' ? 420 : 300;
      strokeRiver(pts, w);
      this.rivers.push({ name: r.name, w, pts });
    }
    for (const [name, w, pts] of EXTRA_RIVERS) { strokeRiver(pts, w); this.rivers.push({ name, w, pts }); }
    const river = read(); await progress?.(0.45);
    this.land = blur(land, W, H, 1); this.inland = blur(land, W, H, 6);
    this.river = blur(river, W, H, 1); this.valley = blur(river, W, H, 9);
    await progress?.(0.7);
    // 거친 필드: 산맥, 도시
    const CW = Math.ceil((x1 - x0) / CRES), CH = Math.ceil((z1 - z0) / CRES);
    this.CW = CW; this.CH = CH;
    this.ridge = new Float32Array(CW * CH); this.city = new Float32Array(CW * CH); this.cityH = new Float32Array(CW * CH);
    const ridges = RIDGES.map(([h, w, pts]) => ({ h, w: w * 1000, pts: pts.map(([la, lo]) => toXZ(la, lo)) }));
    this.cities = CITIES.map(([name, la, lo, r, d, hs]) => { const [x, z] = toXZ(la, lo); return { name, x, z, r: r * 1000, d, hs }; });
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
      const x = x0 + i * CRES, z = z0 + j * CRES; let rg = 0;
      for (const R of ridges) {
        let md = 1e12;
        for (let k = 1; k < R.pts.length; k++) md = Math.min(md, segDist2(x, z, R.pts[k - 1], R.pts[k]));
        rg += R.h * Math.exp(-md / (R.w * R.w));
      }
      let c = 0, hs = 0;
      for (const C of this.cities) {
        const d = Math.hypot(x - C.x, z - C.z); if (d > C.r * 1.6) continue;
        const v = C.d * (1 - smooth(C.r * 0.45, C.r * 1.6, d));
        if (v > c) { hs = C.hs; } c = Math.max(c, v);
      }
      const k = j * CW + i; this.ridge[k] = rg; this.city[k] = c; this.cityH[k] = hs;
    }
    // 산 격자
    this.peakGrid = new Map();
    for (const [name, la, lo, h, r] of PEAKS) {
      const [x, z] = toXZ(la, lo), pk = { name, x, z, h, r: r * 1000 };
      const n = Math.ceil(pk.r / 20000);
      const gx = Math.floor(x / 20000), gz = Math.floor(z / 20000);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
        const key = (gx + a + 1000) * 4096 + gz + b + 1000; if (!this.peakGrid.has(key)) this.peakGrid.set(key, []); this.peakGrid.get(key).push(pk);
      }
    }
    this.corridor = null;
    await progress?.(1);
  }
  sampleGrid(arr, x, z) {
    const fx = (x - this.x0) / RES, fz = (z - this.z0) / RES;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.W - 1 || j >= this.H - 1) return 0;
    const tx = fx - i, tz = fz - j, k = j * this.W + i, W = this.W;
    return ((arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + W] * (1 - tx) + arr[k + W + 1] * tx) * tz) / 255;
  }
  sampleC(arr, x, z) {
    const fx = (x - this.x0) / CRES, fz = (z - this.z0) / CRES;
    const i = clamp(Math.floor(fx), 0, this.CW - 2), j = clamp(Math.floor(fz), 0, this.CH - 2);
    const tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1), k = j * this.CW + i, W = this.CW;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + W] * (1 - tx) + arr[k + W + 1] * tx) * tz;
  }
  landAt(x, z) { return smooth(0.42, 0.6, this.sampleGrid(this.land, x, z)); }
  riverAt(x, z) { return smooth(0.3, 0.6, this.sampleGrid(this.river, x, z)); }
  cityAt(x, z) { return this.sampleC(this.city, x, z); }
  cityHeightAt(x, z) { return this.sampleC(this.cityH, x, z); }
  peaks(x, z) {
    const list = this.peakGrid.get((Math.floor(x / 20000) + 1000) * 4096 + Math.floor(z / 20000) + 1000); if (!list) return 0;
    let h = 0;
    for (const p of list) {
      const dx = x - p.x, dz = z - p.z, d2 = (dx * dx + dz * dz) / (p.r * p.r); if (d2 >= 1) continue;
      const t = 1 - d2; h = Math.max(h, p.h * t * t * (0.82 + 0.18 * noise(x / 900, z / 900)));
    }
    return h;
  }
  // 철도 공사 전 자연 지형 높이
  natural(x, z) {
    const L = this.sampleGrid(this.land, x, z);
    const inland = smooth(0.45, 1, this.sampleGrid(this.inland, x, z));
    const land = smooth(0.42, 0.6, L);
    const sea = -3 - (1 - inland) * 50 - (1 - L) * 10;
    if (land <= 0) return sea;
    const ridge = this.sampleC(this.ridge, x, z), city = this.sampleC(this.city, x, z);
    const n1 = fbm(x / 7000, z / 7000, 5);
    const rr = 1 - Math.abs(noise(x / 3800 + 50, z / 3800)); const rd = rr * rr;
    const relief = (40 + ridge * 0.6) * (0.35 + 0.65 * inland);
    const hills = (n1 * 0.75 + (rd - 0.4) * 0.9) * relief;
    // 산지: 지역별 산악 정도 × 능선 노이즈 (한국 지형의 약 70%는 산지)
    const r1 = 1 - Math.abs(noise(x / 2600 + 7, z / 2600 - 3)), r2 = 1 - Math.abs(noise(x / 1150 - 2, z / 1150 + 5));
    const ridgy = Math.max(0, r1 * r1 * 0.7 + r2 * r2 * 0.3 - 0.25) / 0.75;
    const mtn = smooth(-0.15, 0.35, fbm(x / 40000 + 3, z / 40000 - 7, 3) + ridge / 1200);
    let h = 3 + inland * (16 + ridge * 0.85) + hills * inland + inland * mtn * Math.pow(ridgy, 1.35) * (150 + ridge * 0.7) * (1 - city * 0.85);
    if (city > 0) h = lerp(h, 3 + inland * (16 + ridge * 0.4) + hills * 0.12, city * 0.9);
    h += this.peaks(x, z) * land;
    const val = this.sampleGrid(this.valley, x, z);
    h = lerp(h, Math.min(h, 4 + h * 0.25), smooth(0.05, 0.5, val));
    h = Math.max(h, 1.2 + fbm(x / 300, z / 300, 2) * 0.8);
    const rv = this.riverAt(x, z);
    if (rv > 0) h = lerp(h, -4, rv);
    return lerp(sea, h, land);
  }
  height(x, z) {
    const h = this.natural(x, z);
    return this.corridor ? this.corridor(x, z, h) : h;
  }
}

function segDist2(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const t = L ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L, 0, 1) : 0;
  const ex = a[0] + dx * t - x, ez = a[1] + dz * t - z; return ex * ex + ez * ez;
}

// 분리형 박스 블러 (r 반복 2회 ≈ 가우시안)
function blur(src, W, H, r) {
  let a = Float32Array.from(src), b = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      const o = y * W; let s = 0;
      for (let x = -r; x <= r; x++) s += a[o + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) { b[o + x] = s / (2 * r + 1); s += a[o + Math.min(x + r + 1, W - 1)] - a[o + Math.max(x - r, 0)]; }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += b[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) { a[y * W + x] = s / (2 * r + 1); s += b[Math.min(y + r + 1, H - 1) * W + x] - b[Math.max(y - r, 0) * W + x]; }
    }
  }
  const o = new Uint8Array(W * H); for (let i = 0; i < o.length; i++) o[i] = a[i]; return o;
}
