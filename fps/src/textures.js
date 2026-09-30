// 절차적 텍스처 생성기 — 색상/노멀/거칠기 맵을 픽셀 함수로 만든다
import * as THREE from 'three';

// ── 타일링 가능한 값 노이즈 ──
const P = new Uint8Array(512);
(function seed(s = 1337) {
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();
const hash = (x, y) => P[(P[x & 255] + y) & 511] / 255;
export function noise(x, y, per = 256, perY = per) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % per) + per) % per, y0 = ((yi % perY) + perY) % perY, x1 = (x0 + 1) % per, y1 = (y0 + 1) % perY;
  const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(u, v, freq, oct = 4, gain = 0.5) {
  let s = 0, a = 1, n = 0, f = freq;
  for (let i = 0; i < oct; i++) { s += noise(u * f, v * f, f) * a; n += a; a *= gain; f *= 2; }
  return s / n;
}
// 비등방 fbm (u, v 주파수 별도)
export function fbm2(u, v, fu, fv, oct = 4) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += noise(u * fu, v * fv, fu, fv) * a; n += a; a *= 0.5; fu *= 2; fv *= 2; }
  return s / n;
}
// 셀룰러(보로노이) 거리 — 자갈/얼룩
export function cell(u, v, freq) {
  const x = u * freq, y = v * freq, xi = Math.floor(x), yi = Math.floor(y);
  let d = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, wx = ((cx % freq) + freq) % freq, wy = ((cy % freq) + freq) % freq;
    const px = cx + hash(wx, wy), py = cy + hash(wy + 17, wx + 31);
    const dd = (px - x) ** 2 + (py - y) ** 2; if (dd < d) d = dd;
  }
  return Math.sqrt(d);
}

// ── 범용 생성기 ──
// fn(u, v, o) 에서 o.r,o.g,o.b (0..1), o.h (높이), o.ro (거칠기), o.a (알파), o.me (금속도) 설정
export function gen(size, fn, { normal = 2, rough = true, alpha = false, srgb = true, repeat = true } = {}) {
  const N = size * size;
  const col = new Uint8Array(N * 4), H = new Float32Array(N), R = rough ? new Uint8Array(N * 4) : null;
  const o = { r: 0, g: 0, b: 0, h: 0, ro: 0.8, a: 1, me: 0 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    o.h = 0; o.a = 1; o.ro = 0.8; o.me = 0;
    fn(x / size, y / size, o);
    const i = y * size + x;
    col[i * 4] = o.r * 255; col[i * 4 + 1] = o.g * 255; col[i * 4 + 2] = o.b * 255; col[i * 4 + 3] = o.a * 255;
    H[i] = o.h;
    if (R) { R[i * 4] = 255; R[i * 4 + 1] = o.ro * 255; R[i * 4 + 2] = o.me * 255; R[i * 4 + 3] = 255; }
  }
  const mk = (data, cs) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = cs; t.needsUpdate = true;
    return t;
  };
  const out = { map: mk(col, srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace) };
  if (normal) {
    const nm = new Uint8Array(N * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
      const dx = (H[y * size + xr] - H[y * size + xl]) * normal * size / 256;
      const dy = (H[yd * size + x] - H[yu * size + x]) * normal * size / 256;
      const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
      nm[i] = (-dx / l * 0.5 + 0.5) * 255; nm[i + 1] = (dy / l * 0.5 + 0.5) * 255; nm[i + 2] = (1 / l * 0.5 + 0.5) * 255; nm[i + 3] = 255;
    }
    out.normalMap = mk(nm, THREE.NoColorSpace);
  }
  if (R) out.roughnessMap = mk(R, THREE.NoColorSpace);
  return out;
}

const mix = (a, b, t) => a + (b - a) * t;
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function rgb(o, r, g, b, k = 1) { o.r = sat(r * k); o.g = sat(g * k); o.b = sat(b * k); }

// ── 개별 텍스처 ──
export const T = {};
const tick = () => new Promise((r) => setTimeout(r, 0));

export async function buildTextures(progress = () => {}) {
  const jobs = [
    ['concrete', () => gen(512, (u, v, o) => {
      const n = fbm(u, v, 6, 5), f = fbm(u, v, 48, 2), st = fbm(u + 3, v, 3, 3);
      const pit = sstep(0.72, 0.8, fbm(u, v, 40, 2));
      const k = 0.78 + n * 0.32 - pit * 0.25 - sstep(0.55, 0.8, st) * 0.18;
      rgb(o, 0.56, 0.55, 0.52, k); o.h = n * 0.6 + f * 0.25 - pit * 0.5; o.ro = 0.82 + f * 0.15;
    }, { normal: 3 })],
    ['slab', () => gen(1024, (u, v, o) => {
      const n = fbm(u, v, 8, 5), f = fbm(u, v, 96, 2), st = fbm(u, v, 3, 4), oil = sstep(0.62, 0.75, fbm(u + 7, v + 2, 5, 3));
      const jx = Math.min(u % 0.5, 0.5 - (u % 0.5)), jy = Math.min(v % 0.5, 0.5 - (v % 0.5));
      const joint = 1 - sstep(0.0, 0.004, Math.min(jx, jy));
      const crack = sstep(0.49, 0.5, fbm(u, v, 12, 4)) * (1 - sstep(0.5, 0.51, fbm(u, v, 12, 4)));
      const k = 0.72 + n * 0.3 - joint * 0.45 - oil * 0.3 - crack * 0.3 - sstep(0.5, 0.8, st) * 0.12;
      rgb(o, 0.52, 0.51, 0.49, k); o.h = n * 0.5 + f * 0.2 - joint * 1.2 - crack * 0.6; o.ro = 0.85 + f * 0.1 - oil * 0.45;
    }, { normal: 2.5 })],
    ['dirt', () => gen(1024, (u, v, o) => {
      const n = fbm(u, v, 6, 5), c = cell(u, v, 64), g = fbm(u + 5, v + 9, 4, 4), f = fbm(u, v, 128, 2);
      const peb = 1 - sstep(0.15, 0.35, c), grass = sstep(0.52, 0.66, g);
      const k = 0.65 + n * 0.35 + peb * 0.2 - f * 0.1;
      o.r = sat(mix(0.42, 0.3, grass) * k); o.g = sat(mix(0.35, 0.36, grass) * k); o.b = sat(mix(0.27, 0.18, grass) * k);
      o.h = n * 0.7 + peb * 0.5 + f * 0.3; o.ro = 0.95;
    }, { normal: 3 })],
    ['asphalt', () => gen(512, (u, v, o) => {
      const n = fbm(u, v, 8, 4), c = cell(u, v, 90), f = fbm(u, v, 160, 1);
      const agg = 1 - sstep(0.05, 0.25, c);
      const k = 0.2 + n * 0.1 + agg * 0.12 + f * 0.05;
      rgb(o, 1, 0.98, 0.95, k); o.h = n * 0.3 + agg * 0.5; o.ro = 0.88 - agg * 0.15;
    }, { normal: 2 })],
    ['corrugated', () => gen(512, (u, v, o) => {
      const rib = Math.abs(Math.sin(u * Math.PI * 16)), streak = fbm(u * 1, v * 0.08, 24, 3), n = fbm(u, v, 12, 4);
      const rust = sstep(0.62, 0.78, fbm(u + 4, v + 1, 6, 5)) + sstep(0.75, 0.95, v) * 0.35 * n;
      const k = 0.85 + n * 0.15 - streak * 0.25;
      o.r = sat(mix(k, 0.45, sat(rust))); o.g = sat(mix(k, 0.25, sat(rust))); o.b = sat(mix(k, 0.14, sat(rust)));
      o.h = rib * 1.2 + n * 0.05; o.ro = mix(0.55, 0.9, sat(rust)); o.me = mix(0.5, 0.1, sat(rust));
    }, { normal: 5 })],
    ['planks', () => gen(512, (u, v, o) => {
      const pl = Math.floor(v * 4), pv = (v * 4) % 1, gr = fbm(u * 0.2 + pl * 3.1, v * 8, 16, 4), knot = sstep(0.8, 0.9, fbm(u + pl, v, 10, 3));
      const seam = 1 - sstep(0.0, 0.03, Math.min(pv, 1 - pv));
      const k = 0.8 + gr * 0.35 - seam * 0.5 - knot * 0.3 + (hash(pl, 3) - 0.5) * 0.15;
      rgb(o, 0.66, 0.5, 0.32, k); o.h = gr * 0.3 - seam * 1.2; o.ro = 0.8;
    }, { normal: 3 })],
    ['steel', () => gen(512, (u, v, o) => {
      const n = fbm(u, v, 8, 4), s = fbm(u * 0.05, v * 3, 64, 2), sc = sstep(0.88, 0.95, fbm(u * 4, v * 0.2, 32, 3));
      const k = 0.55 + n * 0.2 + sc * 0.3;
      rgb(o, 1, 1, 1, k); o.h = n * 0.2 + s * 0.1; o.ro = 0.45 + n * 0.25 - sc * 0.2; o.me = 1;
    }, { normal: 1 })],
    ['diamond', () => gen(256, (u, v, o) => {
      const a = (u + v) * 8 % 1, b = (u - v + 2) * 8 % 1;
      const d1 = sstep(0.08, 0.02, Math.abs(a - 0.5) + Math.abs(((v * 16) % 2) - 1) * 0.0);
      const bump = Math.max(1 - sstep(0.0, 0.12, Math.abs(a - 0.5) * 0.6 + Math.abs((u * 16 % 1) - 0.5) * 0.3), 1 - sstep(0.0, 0.12, Math.abs(b - 0.5) * 0.6 + Math.abs((v * 16 % 1) - 0.5) * 0.3));
      const n = fbm(u, v, 8, 3);
      rgb(o, 0.62, 0.62, 0.6, 0.7 + n * 0.3 + bump * 0.15 - d1 * 0); o.h = bump; o.ro = 0.5 - bump * 0.15 + n * 0.2; o.me = 1;
    }, { normal: 4 })],
    ['sandbag', () => gen(512, (u, v, o) => {
      const row = Math.floor(v * 4), off = row % 2 ? 0.25 : 0, bu = ((u + off) * 2) % 1, bv = (v * 4) % 1;
      const bag = Math.sqrt(sat(1 - ((bu - 0.5) * 2.1) ** 2)) * Math.sqrt(sat(1 - ((bv - 0.5) * 2.2) ** 2));
      const weave = (Math.sin(u * 900) * Math.sin(v * 900)) * 0.5 + 0.5, n = fbm(u, v, 10, 4);
      const k = (0.55 + bag * 0.45) * (0.85 + n * 0.25) * (0.92 + weave * 0.08);
      rgb(o, 0.62, 0.55, 0.4, k); o.h = bag * 1.2 + weave * 0.03 + n * 0.1; o.ro = 0.95;
    }, { normal: 4 })],
    ['plaster', () => gen(512, (u, v, o) => {
      const n = fbm(u, v, 10, 5), d = sstep(0.7, 1.0, v) * fbm(u, v, 6, 3), f = fbm(u, v, 80, 2);
      const k = 0.88 + n * 0.12 - d * 0.35;
      rgb(o, 0.86, 0.83, 0.76, k); o.h = n * 0.3 + f * 0.2; o.ro = 0.9;
    }, { normal: 1.5 })],
    ['tiles', () => gen(512, (u, v, o) => {
      const tu = (u * 8) % 1, tv = (v * 8) % 1, gr = 1 - sstep(0.0, 0.04, Math.min(tu, 1 - tu, tv, 1 - tv));
      const n = fbm(u, v, 16, 3), sp = hash(Math.floor(u * 8), Math.floor(v * 8));
      const k = 0.75 + n * 0.1 + sp * 0.08 - gr * 0.45;
      rgb(o, 0.72, 0.7, 0.66, k); o.h = -gr; o.ro = 0.35 + gr * 0.5 + n * 0.1;
    }, { normal: 2 })],
    ['camo', () => gen(512, (u, v, o) => {
      const a = fbm(u, v, 5, 4), b = fbm(u + 3.3, v + 1.7, 7, 4), c = fbm(u + 8.1, v + 5.2, 9, 3);
      let r = 0.42, g = 0.4, bl = 0.3;
      if (a > 0.52) { r = 0.3; g = 0.32; bl = 0.22; }
      if (b > 0.56) { r = 0.52; g = 0.45; bl = 0.33; }
      if (c > 0.6) { r = 0.2; g = 0.19; bl = 0.15; }
      const weave = ((Math.sin(u * 1400) > 0) !== (Math.sin(v * 1400) > 0)) ? 1 : 0, n = fbm(u, v, 64, 2);
      rgb(o, r, g, bl, 0.92 + weave * 0.08 + n * 0.1); o.h = weave * 0.3 + n * 0.3; o.ro = 0.95;
    }, { normal: 1.5 })],
    ['fabric', () => gen(256, (u, v, o) => {
      const w = Math.sin(u * 600) * 0.5 + 0.5, w2 = Math.sin(v * 600) * 0.5 + 0.5, n = fbm(u, v, 16, 3);
      rgb(o, 1, 1, 1, 0.85 + n * 0.15); o.h = (w * 0.5 + w2 * 0.5) * 0.5 + n * 0.2; o.ro = 0.9;
    }, { normal: 2 })],
    ['stipple', () => gen(256, (u, v, o) => {
      const c = cell(u, v, 48), n = fbm(u, v, 32, 2);
      rgb(o, 1, 1, 1, 0.9 + n * 0.1); o.h = sstep(0.5, 0.1, c) * 0.8 + n * 0.2; o.ro = 0.72 + n * 0.12;
    }, { normal: 3 })],
    ['anodized', () => gen(256, (u, v, o) => {
      const n = fbm(u, v, 12, 4), sc = sstep(0.9, 0.97, fbm(u * 6, v * 0.3, 24, 3)), edge = sstep(0.8, 0.95, fbm(u, v, 4, 3));
      rgb(o, 1, 1, 1, 0.92 + n * 0.08 + sc * 0.28 + edge * 0.08); o.h = n * 0.12 - sc * 0.25; o.ro = 0.46 + n * 0.14 - sc * 0.12; o.me = 1;
    }, { normal: 1 })],
    ['gunwood', () => gen(512, (u, v, o) => {
      const w = fbm2(u, v, 2, 24, 4), ring = Math.sin((v * 6 + w * 4) * Math.PI * 4) * 0.5 + 0.5, pore = fbm2(u, v, 16, 256, 2), fig = fbm(u, v, 3, 3);
      const k = 0.62 + ring * 0.22 + pore * 0.14 + fig * 0.12;
      rgb(o, 0.45, 0.27, 0.15, k); o.h = ring * 0.15 + pore * 0.25; o.ro = 0.34 + pore * 0.25;
    }, { normal: 1 })],
    ['leather', () => gen(256, (u, v, o) => {
      const c = cell(u, v, 32), n = fbm(u, v, 24, 3);
      rgb(o, 1, 1, 1, 0.85 + n * 0.15); o.h = sstep(0.05, 0.3, c) * 0.5 + n * 0.3; o.ro = 0.65 + n * 0.2;
    }, { normal: 2 })],
    ['skin', () => gen(256, (u, v, o) => {
      const n = fbm(u, v, 12, 4), p = fbm(u, v, 64, 2);
      rgb(o, 0.78, 0.58, 0.46, 0.9 + n * 0.1); o.h = p * 0.3; o.ro = 0.6;
    }, { normal: 1 })],
    // 데칼
    ['holeConcrete', () => gen(128, (u, v, o) => {
      const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), a = Math.atan2(y, x), crack = sstep(0.75, 0.9, noise(a * 3 + 10, r * 6)) * (r < 0.45 ? 1 : 0);
      const n = fbm(u, v, 8, 3), crater = sstep(0.42, 0.2 + n * 0.1, r), hole = sstep(0.1, 0.06, r);
      rgb(o, 0.42, 0.4, 0.38, 1 - hole * 0.9 - crack * 0.3 + crater * 0.15);
      o.a = sat(crater * 0.9 + crack * 0.7 + hole); o.h = -hole * 1.5 - crater * 0.8 + n * 0.2; o.ro = 0.9;
    }, { alpha: true, normal: 3, repeat: false })],
    ['holeMetal', () => gen(128, (u, v, o) => {
      const r = Math.hypot(u - 0.5, v - 0.5), hole = sstep(0.07, 0.05, r), rim = sstep(0.16, 0.08, r) - hole, scorch = sstep(0.4, 0.1, r);
      rgb(o, 0.8, 0.78, 0.75, 1 - hole * 0.95 - scorch * 0.5 + rim * 0.6);
      o.a = sat(scorch * 0.8 + rim + hole); o.h = rim * 1.2 - hole * 1.5; o.ro = 0.3 + scorch * 0.4; o.me = 1;
    }, { alpha: true, normal: 3, repeat: false })],
    ['holeWood', () => gen(128, (u, v, o) => {
      const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y * 0.6), hole = sstep(0.07, 0.05, Math.hypot(x, y)), spl = sstep(0.3, 0.1, r) * (0.6 + noise(u * 20, v * 3) * 0.4);
      rgb(o, 0.35, 0.24, 0.14, 1 - hole * 0.9 + spl * 0.3); o.a = sat(spl * 0.9 + hole); o.h = -hole - spl * 0.3; o.ro = 0.85;
    }, { alpha: true, normal: 3, repeat: false })],
    ['blood', () => gen(256, (u, v, o) => {
      const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), n = fbm(u, v, 6, 4), drops = sstep(0.12, 0.05, cell(u, v, 10)) * sstep(0.48, 0.3, r);
      const m = sat(sstep(0.3 + n * 0.25, 0.15, r) + drops);
      rgb(o, 0.35, 0.02, 0.02, 0.6 + n * 0.4); o.a = m * 0.95; o.h = m * 0.3; o.ro = 0.25;
    }, { alpha: true, normal: 1, repeat: false })],
    ['scorch', () => gen(256, (u, v, o) => {
      const r = Math.hypot(u - 0.5, v - 0.5), n = fbm(u, v, 5, 4);
      rgb(o, 0.05, 0.045, 0.04); o.a = sat(sstep(0.5, 0.1, r + n * 0.2) * 0.95); o.ro = 1;
    }, { alpha: true, normal: 0, repeat: false })],
    // 파티클 스프라이트
    ['soft', () => gen(64, (u, v, o) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2; rgb(o, 1, 1, 1); o.a = sat(Math.pow(1 - sat(r), 2));
    }, { normal: 0, rough: false, repeat: false, srgb: false })],
    ['smoke', () => gen(128, (u, v, o) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2, n = fbm(u, v, 4, 5);
      rgb(o, 1, 1, 1, 0.8 + n * 0.2); o.a = sat((1 - sstep(0.3, 1, r)) * sstep(0.25, 0.7, n + (1 - r) * 0.35));
    }, { normal: 0, rough: false, repeat: false, srgb: false })],
    ['flash', () => gen(128, (u, v, o) => {
      const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y) * 2, a = Math.atan2(y, x);
      const spikes = Math.pow(Math.abs(Math.cos(a * 3.5)), 6) * 0.6 + noise(a * 5 + 20, 3) * 0.3;
      const core = sat(1 - r * 2.5), m = sat(core + sat(1 - r / (0.25 + spikes)) * 0.8);
      o.r = 1; o.g = sat(0.55 + core * 0.45); o.b = sat(0.2 + core * 0.7); o.a = m;
    }, { normal: 0, rough: false, repeat: false, srgb: false })],
    ['flashSide', () => gen(128, (u, v, o) => {
      const x = (u - 0.5) * 2, y = v, w = (1 - y) * 0.5 + 0.05, n = noise(y * 12, 3) * 0.4;
      const m = sat(1 - Math.abs(x) / (w + n * w)) * sat(1 - y) * sat(y * 8);
      o.r = 1; o.g = 0.6 + m * 0.3; o.b = 0.25 + m * 0.4; o.a = sat(m * 1.4);
    }, { normal: 0, rough: false, repeat: false, srgb: false })],
  ];
  for (let i = 0; i < jobs.length; i++) {
    T[jobs[i][0]] = jobs[i][1]();
    progress((i + 1) / jobs.length, jobs[i][0]);
    await tick();
  }
  return T;
}

// 반복 스케일을 복제 적용한 텍스처 세트
export function tiled(set, rx, ry = rx) {
  const o = {};
  for (const k in set) { o[k] = set[k].clone(); o[k].repeat.set(rx, ry); o[k].needsUpdate = true; }
  return o;
}
