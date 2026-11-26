// 대한민국 지리: 실제 위경도 기반 해안선/도시/산맥/강/고속도로 → 1:1 스케일(미터) 지형 함수
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { smooth, clamp } from './util.js';

const P = new ImprovedNoise();
export const LAT0 = 37.5665, LON0 = 126.9780; // 서울시청 = 원점
const MX = 111320 * Math.cos(LAT0 * Math.PI / 180), MZ = 110940;
export const ll = (lat, lon) => [(lon - LON0) * MX, -(lat - LAT0) * MZ];
export const toLatLon = (x, z) => [LAT0 - z / MZ, LON0 + x / MX];

// 해안선 (북쪽은 휴전선 너머까지 육지로 이어지게)
const COAST_LL = [
  [37.75, 126.15], [37.60, 126.35], [37.48, 126.55], [37.40, 126.62], [37.28, 126.58], [37.15, 126.68], [36.98, 126.80], [36.95, 126.60],
  [36.98, 126.38], [36.85, 126.15], [36.60, 126.15], [36.35, 126.50], [36.10, 126.60], [35.98, 126.70], [35.78, 126.60], [35.62, 126.47],
  [35.40, 126.40], [35.10, 126.30], [34.80, 126.38], [34.55, 126.25], [34.30, 126.55], [34.45, 126.90], [34.50, 127.25], [34.45, 127.50],
  [34.70, 127.75], [34.85, 127.90], [34.75, 128.05], [34.90, 128.35], [34.75, 128.65], [35.05, 128.80], [35.08, 129.05], [35.20, 129.25],
  [35.45, 129.40], [35.80, 129.50], [36.08, 129.57], [36.40, 129.40], [36.75, 129.47], [37.10, 129.38], [37.45, 129.18], [37.80, 128.92],
  [38.20, 128.60], [38.60, 128.35], [39.05, 127.95], [39.10, 125.40], [38.10, 124.90], [37.95, 125.65], [37.80, 126.00]];
export const COAST = COAST_LL.map(p => ll(p[0], p[1]));
const JEJU = ll(33.38, 126.55), JRX = 36000, JRZ = 16500;
export const DMZ = [[37.77, 126.68], [37.95, 126.95], [38.10, 127.10], [38.28, 127.35], [38.30, 127.70], [38.25, 128.00], [38.32, 128.20], [38.60, 128.35]].map(p => ll(p[0], p[1]));

export const CITIES = [
  ['서울', 37.5665, 126.978, 16000, 1], ['인천', 37.456, 126.705, 9000, .85], ['수원', 37.263, 127.028, 6000, .85], ['성남', 37.42, 127.126, 5000, .85],
  ['고양', 37.658, 126.832, 6000, .8], ['부천', 37.503, 126.766, 4000, .85], ['안양', 37.394, 126.957, 4000, .8], ['용인', 37.241, 127.177, 5000, .7],
  ['의정부', 37.738, 127.034, 3500, .75], ['남양주', 37.636, 127.216, 3500, .6], ['김포', 37.615, 126.716, 3500, .65], ['파주', 37.76, 126.78, 3500, .55],
  ['화성', 37.2, 126.83, 4000, .5], ['평택', 36.992, 127.113, 4500, .6], ['천안', 36.815, 127.114, 5000, .7], ['청주', 36.642, 127.489, 6000, .75],
  ['세종', 36.48, 127.289, 4000, .65], ['대전', 36.351, 127.385, 8000, .85], ['전주', 35.824, 127.148, 5500, .75], ['군산', 35.968, 126.737, 4000, .6],
  ['광주', 35.16, 126.852, 8000, .85], ['목포', 34.812, 126.392, 3500, .65], ['여수', 34.76, 127.662, 3500, .6], ['순천', 34.951, 127.487, 3500, .6],
  ['대구', 35.871, 128.601, 9000, .85], ['구미', 36.119, 128.344, 4500, .65], ['포항', 36.019, 129.343, 5000, .65], ['경주', 35.856, 129.225, 3500, .5],
  ['울산', 35.538, 129.311, 7000, .75], ['부산', 35.18, 129.075, 11000, .9], ['창원', 35.228, 128.681, 6000, .75], ['김해', 35.234, 128.889, 4000, .65],
  ['진주', 35.18, 128.108, 4000, .6], ['안동', 36.568, 128.729, 3000, .5], ['춘천', 37.881, 127.73, 4000, .6], ['원주', 37.342, 127.92, 4000, .6],
  ['강릉', 37.752, 128.876, 3500, .6], ['속초', 38.207, 128.592, 2000, .5], ['충주', 36.991, 127.926, 3000, .5], ['제주', 33.499, 126.531, 4500, .65],
  ['서귀포', 33.254, 126.56, 2500, .5]
].map(([name, la, lo, r, d]) => { const [x, z] = ll(la, lo); return { name, x, z, r, d, lat: la, lon: lo }; });
export const city = n => CITIES.find(c => c.name === n);

const HWY_CHAINS = [
  ['경부고속도로', '서울', '수원', '천안', '대전', '구미', '대구', '경주', '부산'], ['서해안고속도로', '인천', '화성', '평택', '군산', '목포'],
  ['호남고속도로', '대전', '전주', '광주', '목포'], ['남해고속도로', '광주', '순천', '진주', '창원', '김해', '부산'],
  ['영동고속도로', '인천', '안양', '용인', '원주', '강릉'], ['중앙고속도로', '춘천', '원주', '충주', '안동', '대구'],
  ['동해고속도로', '속초', '강릉', '포항', '울산', '부산'], ['서울양양고속도로', '서울', '남양주', '춘천'], ['중부고속도로', '성남', '청주', '세종']];
export const HIGHWAYS = [];
for (const [name, ...cs] of HWY_CHAINS) for (let i = 0; i < cs.length - 1; i++) { const a = city(cs[i]), b = city(cs[i + 1]); HIGHWAYS.push({ name, ax: a.x, az: a.z, bx: b.x, bz: b.z }); }

const RIVERS = [
  { name: '한강', w: 420, pts: [[37.52, 127.33], [37.545, 127.2], [37.555, 127.12], [37.528, 127.08], [37.522, 127.03], [37.515, 127.0], [37.517, 126.975], [37.525, 126.945], [37.535, 126.915], [37.55, 126.89], [37.57, 126.86], [37.6, 126.81], [37.64, 126.76], [37.68, 126.7], [37.75, 126.62]] },
  { name: '낙동강', w: 160, pts: [[35.1, 128.95], [35.33, 128.78], [35.5, 128.48], [35.7, 128.4], [35.85, 128.48], [36.1, 128.38], [36.4, 128.3], [36.55, 128.55]] },
  { name: '금강', w: 140, pts: [[36.02, 126.72], [36.2, 126.9], [36.3, 127.1], [36.46, 127.12], [36.5, 127.3], [36.4, 127.45], [36.2, 127.55]] },
  { name: '영산강', w: 90, pts: [[34.8, 126.45], [34.95, 126.6], [35.1, 126.75], [35.2, 126.85]] }
].map(r => ({ ...r, xz: r.pts.map(p => ll(p[0], p[1])) }));
RIVERS.forEach(r => { const xs = r.xz.map(p => p[0]), zs = r.xz.map(p => p[1]); r.bb = [Math.min(...xs) - 3000, Math.max(...xs) + 3000, Math.min(...zs) - 3000, Math.max(...zs) + 3000]; });
export { RIVERS };

const RIDGES = [
  { w: 1, s: 32000, xz: [[38.6, 128.3], [38.1, 128.45], [37.7, 128.7], [37.3, 129.0], [36.9, 129.1], [36.4, 129.15], [35.9, 129.1]].map(p => ll(p[0], p[1])) },
  { w: .8, s: 26000, xz: [[37.1, 128.4], [36.9, 128.2], [36.6, 127.9], [36.2, 127.85], [35.8, 127.7], [35.35, 127.7]].map(p => ll(p[0], p[1])) },
  { w: .45, s: 30000, xz: [[38.2, 127.5], [37.9, 127.6], [37.6, 127.6]].map(p => ll(p[0], p[1])) }];
const PEAKS = [['북한산', 37.6585, 126.978, 780, 1500], ['남산', 37.5512, 126.9882, 230, 450], ['관악산', 37.444, 126.964, 560, 1400], ['인왕산', 37.584, 126.958, 300, 450],
  ['지리산', 35.337, 127.731, 1300, 6000], ['설악산', 38.119, 128.465, 1000, 5000], ['한라산', 33.362, 126.533, 1850, 9000], ['계룡산', 36.34, 127.21, 550, 2500],
  ['무등산', 35.13, 126.99, 850, 2500], ['팔공산', 36.02, 128.69, 900, 3500], ['소백산', 36.957, 128.485, 900, 4000], ['덕유산', 35.86, 127.75, 1000, 5000]]
  .map(([n, la, lo, h, s]) => { const [x, z] = ll(la, lo); return { n, x, z, h, s }; });

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1); t = clamp(t, 0, 1);
  const ex = ax + dx * t - px, ez = az + dz * t - pz; return ex * ex + ez * ez;
}
export function polyDist(x, z, poly) {
  let inside = false, md = 1e30;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    const d = segDist2(x, z, xi, zi, xj, zj); if (d < md) md = d;
  }
  return inside ? Math.sqrt(md) : -Math.sqrt(md);
}
function lineDist(x, z, pts) { let m = 1e30; for (let i = 0; i < pts.length - 1; i++) { const d = segDist2(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); if (d < m) m = d; } return Math.sqrt(m); }
export function landDist(x, z) {
  const d = polyDist(x, z, COAST);
  const ex = (x - JEJU[0]) / JRX, ez = (z - JEJU[1]) / JRZ, jd = (1 - Math.hypot(ex, ez)) * JRZ;
  return Math.max(d, jd);
}
export function urban(x, z) {
  let u = 0;
  for (const c of CITIES) {
    const dx = x - c.x, dz = z - c.z; if (Math.abs(dx) > c.r || Math.abs(dz) > c.r) continue;
    const d = Math.hypot(dx, dz); if (d > c.r) continue;
    u = Math.max(u, c.d * smooth(c.r, c.r * 0.3, d));
  }
  return u;
}
export function nearestCity(x, z) { let b = null, bd = 1e30; for (const c of CITIES) { const d = Math.hypot(x - c.x, z - c.z); if (d < bd) { bd = d; b = c; } } return { c: b, d: bd }; }
export function riverDist(x, z) {
  let best = 1e30, w = 0;
  for (const r of RIVERS) { if (x < r.bb[0] || x > r.bb[1] || z < r.bb[2] || z > r.bb[3]) continue; const d = lineDist(x, z, r.xz); if (d - r.w < best - w) { best = d; w = r.w; } }
  return { d: best, w };
}
function mountainW(x, z) {
  let w = 0.22 + 0.12 * (P.noise(x / 60000, z / 60000, 3.3) + 0.5);
  for (const r of RIDGES) { const d = lineDist(x, z, r.xz); w += r.w * Math.exp(-(d * d) / (r.s * r.s)); }
  return Math.min(w, 1.3);
}
// 집(시작 지점) 부지 평탄화
export const SITE = { x0: -30, x1: 270, z0: -30, z1: 270 };
let siteH = null;
function rawNoSite(x, z) {
  const d = landDist(x, z);
  if (d < 0) return Math.max(-40, d * 0.012) - 1.5;
  const c = Math.min(1, d / 2500);
  const n1 = P.noise(x / 21000, z / 21000, 1.3) * 0.5 + 0.5;
  const rg = 1 - Math.abs(P.noise(x / 6500, z / 6500, 4.7));
  const n3 = P.noise(x / 1700, z / 1700, 9.1), n4 = P.noise(x / 380, z / 380, 2.2);
  const mw = mountainW(x, z);
  let h = 3 + c * (rg * rg * rg * mw * 950 + n1 * 140 * mw + n3 * 70 * mw + n4 * 9 + 25 * n1);
  const u = urban(x, z);
  if (u > 0) { const base = 14 + n1 * 22 + n4 * 1.5; const k = Math.min(1, u * 1.6) * 0.96; h = h * (1 - k) + base * k; }
  for (const p of PEAKS) { const dx = x - p.x, dz = z - p.z, s3 = p.s * 3; if (Math.abs(dx) > s3 || Math.abs(dz) > s3) continue; h += p.h * Math.exp(-(dx * dx + dz * dz) / (2 * p.s * p.s)) * c; }
  const rv = riverDist(x, z);
  if (rv.d < rv.w * 2) { const k = smooth(rv.w * 0.75, rv.w * 2, rv.d); h = -4 + (h + 4) * k; }
  if (d < 300) h = Math.min(h, -1.5 + d * 0.02 + (h + 1.5) * smooth(60, 300, d));
  return h;
}
export function heightRaw(x, z) {
  const h = rawNoSite(x, z);
  if (x > SITE.x0 - 120 && x < SITE.x1 + 120 && z > SITE.z0 - 120 && z < SITE.z1 + 120) {
    if (siteH === null) siteH = rawNoSite(120, 120);
    const dx = Math.max(SITE.x0 - x, 0, x - SITE.x1), dz = Math.max(SITE.z0 - z, 0, z - SITE.z1), k = smooth(0, 120, Math.hypot(dx, dz));
    return siteH + (h - siteH) * k;
  }
  return h;
}
export function siteHeight() { if (siteH === null) siteH = rawNoSite(120, 120); return siteH; }

// 지형 메시와 동일한 보간(8m 격자, 삼각형)으로 지면 높이
export const TG = 8;
const hc = new Map();
function hv(ix, iz) {
  const k = ix * 1000003 + iz; let v = hc.get(k);
  if (v === undefined) { v = heightRaw(ix * TG, iz * TG); if (hc.size > 60000) hc.clear(); hc.set(k, v); }
  return v;
}
export function terrainH(x, z) {
  const fx = x / TG, fz = z / TG, ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
  const a = hv(ix, iz), b = hv(ix + 1, iz), c = hv(ix, iz + 1), d = hv(ix + 1, iz + 1);
  // PlaneGeometry 대각선과 동일하게 (a-c-b / c-d-b)
  if (u + v < 1) return a + (b - a) * u + (c - a) * v;
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
export const gridH = hv;
