// 절차적 PBR 텍스처 생성기 — 알베도/노멀/러프니스·메탈니스 맵을 코드로 생성 (외부 이미지 없음)
import * as THREE from 'three';
import { mulberry, clamp } from '../core/util.js';

// 반복(타일) 가능한 값 노이즈
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function vnoise(x, y, px, py, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
  const x0 = ((ix % px) + px) % px, y0 = ((iy % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// u,v ∈ [0,1) 에서 타일되는 fBm
export function fbm(u, v, fx, fy, oct = 5, s = 1, gain = 0.5) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * fx, v * fy, fx, fy, s + o * 17); norm += amp; amp *= gain; fx *= 2; fy *= 2;
  }
  return sum / norm;
}
// 셀룰러(보로노이) 노이즈: [가장 가까운 거리, 셀 id]
export function cell(u, v, n, s) {
  const x = u * n, y = v * n, ix = Math.floor(x), iy = Math.floor(y);
  let best = 9, id = 0, second = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j, wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const px = cx + hash(wx, wy, s), py = cy + hash(wx, wy, s + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < best) { second = best; best = d; id = hash(wx, wy, s + 13); } else if (d < second) second = d;
  }
  return [best, id, second - best];
}

function makeTex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// 생성 함수 f(u,v,out) → out = [r,g,b, rough, metal, height]
function build(size, f, normalStrength = 2) {
  const n = size * size, alb = new Uint8Array(n * 4), rm = new Uint8Array(n * 4), nor = new Uint8Array(n * 4), h = new Float32Array(n);
  const o = [0, 0, 0, 0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    f(x / size, y / size, o);
    const i = y * size + x, k = i * 4;
    alb[k] = clamp(o[0], 0, 1) * 255; alb[k + 1] = clamp(o[1], 0, 1) * 255; alb[k + 2] = clamp(o[2], 0, 1) * 255; alb[k + 3] = 255;
    rm[k] = 255; rm[k + 1] = clamp(o[3], 0.02, 1) * 255; rm[k + 2] = clamp(o[4], 0, 1) * 255; rm[k + 3] = 255;
    h[i] = o[5];
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
    const dx = (h[y * size + xr] - h[y * size + xl]) * normalStrength * size / 256;
    const dy = (h[yd * size + x] - h[yu * size + x]) * normalStrength * size / 256;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    nor[k] = (-dx / l * 0.5 + 0.5) * 255; nor[k + 1] = (dy / l * 0.5 + 0.5) * 255; nor[k + 2] = (1 / l * 0.5 + 0.5) * 255; nor[k + 3] = 255;
  }
  return { map: makeTex(alb, size, true), normalMap: makeTex(nor, size, false), rmMap: makeTex(rm, size, false) };
}

const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 각 스킨 정의: 텍스처 1장이 덮는 실제 크기(scale, m)
export const SKIN_DEFS = {
  millscale: { scale: 1.2, size: 512, ns: 0.35, f(u, v, o) { // 열간압연 흑피 강판: 짙은 청회색 + 미세 얼룩 + 드문 녹
    const big = fbm(u, v, 3, 3, 5, 11), fl = fbm(u, v, 24, 24, 4, 12), sp = fbm(u, v, 96, 96, 2, 13), roll = fbm(u, v, 2, 48, 3, 15);
    const bare = sstep(0.68, 0.74, fl * 0.7 + big * 0.4) * 0.6, rust = sstep(0.76, 0.84, fbm(u, v, 10, 10, 4, 14)) * 0.5;
    const base = 0.235 + big * 0.05 + roll * 0.03 + sp * 0.03;
    o[0] = mix(mix(base, 0.33, bare), 0.34, rust); o[1] = mix(mix(base + 0.008, 0.335, bare), 0.19, rust); o[2] = mix(mix(base + 0.022, 0.345, bare), 0.11, rust);
    o[3] = mix(mix(0.52, 0.4, bare), 0.85, rust) + sp * 0.08 + roll * 0.06; o[4] = mix(mix(0.62, 0.9, bare), 0.2, rust); o[5] = bare * 0.2 + sp * 0.25 + rust * 0.3 + roll * 0.15;
  } },
  brushed: { scale: 0.8, size: 512, ns: 0.6, f(u, v, o) { // 연마(헤어라인) 강
    const l = fbm(u, v, 2, 256, 3, 21), b = fbm(u, v, 4, 4, 4, 22), c = 0.56 + l * 0.12 + b * 0.05;
    o[0] = c; o[1] = c + 0.005; o[2] = c + 0.015; o[3] = 0.26 + l * 0.12 + b * 0.08; o[4] = 1; o[5] = l;
  } },
  galv: { scale: 0.6, size: 512, ns: 0.5, f(u, v, o) { // 아연도금(스팽글)
    const [d, id] = cell(u, v, 22, 31), l = fbm(u, v, 3, 128, 2, 32), c = 0.42 + id * 0.12 + l * 0.04;
    o[0] = c; o[1] = c + 0.01; o[2] = c + 0.025; o[3] = 0.42 + id * 0.22; o[4] = 0.9; o[5] = id * 0.3 + d * 0.1;
  } },
  rust: { scale: 1, size: 512, ns: 3, f(u, v, o) {
    const a = fbm(u, v, 6, 6, 6, 41), b = fbm(u, v, 32, 32, 3, 42), pit = sstep(0.6, 0.75, fbm(u, v, 20, 20, 3, 43));
    const dark = sstep(0.45, 0.6, a);
    o[0] = mix(0.5, 0.25, dark) + b * 0.1; o[1] = mix(0.24, 0.12, dark) + b * 0.05; o[2] = mix(0.1, 0.07, dark);
    o[3] = 0.8 + b * 0.2; o[4] = 0.25 * (1 - dark); o[5] = a * 0.6 + b * 0.4 - pit * 0.4;
  } },
  alu: { scale: 0.7, size: 512, ns: 0.4, f(u, v, o) {
    const l = fbm(u, v, 2, 320, 3, 51), b = fbm(u, v, 3, 3, 4, 52), c = 0.76 + l * 0.08 + b * 0.04;
    o[0] = c; o[1] = c + 0.005; o[2] = c + 0.012; o[3] = 0.32 + l * 0.1; o[4] = 1; o[5] = l;
  } },
  checker: { scale: 0.3, size: 512, ns: 6, f(u, v, o) { // 체크(무늬) 강판
    const l = fbm(u, v, 2, 128, 3, 61), b = fbm(u, v, 4, 4, 3, 62);
    const gx = u * 6, gy = v * 6, cx = gx - Math.floor(gx) - 0.5, cy = gy - Math.floor(gy) - 0.5;
    const flip = (Math.floor(gx) + Math.floor(gy)) % 2 === 0;
    const ax = flip ? cx + cy : cx - cy, ay = flip ? cx - cy : cx + cy;
    const ridge = 1 - sstep(0.035, 0.07, Math.abs(ay) * 0.7) * 1; const len = 1 - sstep(0.22, 0.3, Math.abs(ax));
    const r = Math.max(0, ridge * len), c = 0.58 + l * 0.08 + b * 0.05 + r * 0.06;
    o[0] = c; o[1] = c + 0.005; o[2] = c + 0.015; o[3] = 0.35 - r * 0.12 + b * 0.1; o[4] = 1; o[5] = r;
  } },
  pine: { scale: 1.2, size: 512, ns: 0.8, f(u, v, o) { // 소나무 결 (u 방향이 길이)
    const w = fbm(u, v, 2, 4, 4, 71) * 6 + fbm(u, v, 1, 2, 2, 72) * 3;
    const ring = Math.sin((v * 22 + w) * Math.PI * 2) * 0.5 + 0.5, late = Math.pow(ring, 6);
    const kn = cell(u, v, 3, 73), knot = (1 - sstep(0.03, 0.09, kn[0] * (kn[1] > 0.7 ? 1 : 9)));
    const f = fbm(u, v, 32, 256, 2, 74);
    o[0] = mix(0.84, 0.66, late) * (1 - knot * 0.45) - f * 0.05; o[1] = mix(0.67, 0.46, late) * (1 - knot * 0.5) - f * 0.05; o[2] = mix(0.44, 0.27, late) * (1 - knot * 0.55) - f * 0.03;
    o[3] = 0.62 + late * 0.12 + f * 0.1; o[4] = 0; o[5] = late * 0.5 + f * 0.4 + knot * 0.3;
  } },
  plywood: { scale: 1.4, size: 512, ns: 0.6, f(u, v, o) {
    const w = fbm(u, v, 3, 2, 5, 81) * 9;
    const ring = Math.sin((v * 9 + w) * Math.PI * 2) * 0.5 + 0.5, late = Math.pow(ring, 3) * 0.7;
    const f = fbm(u, v, 48, 256, 2, 82), patch = fbm(u, v, 3, 3, 3, 83);
    o[0] = mix(0.86, 0.7, late) - patch * 0.08 - f * 0.04; o[1] = mix(0.72, 0.55, late) - patch * 0.08 - f * 0.04; o[2] = mix(0.52, 0.36, late) - patch * 0.05;
    o[3] = 0.66 + f * 0.12; o[4] = 0; o[5] = late * 0.4 + f * 0.4;
  } },
  brick: { scale: 0.3, size: 256, ns: 4, f(u, v, o) {
    const a = fbm(u, v, 6, 6, 5, 91), p = fbm(u, v, 48, 48, 2, 92), burn = fbm(u, v, 2, 2, 3, 93);
    const pore = sstep(0.68, 0.75, p);
    o[0] = 0.5 + a * 0.12 - burn * 0.12 - pore * 0.15; o[1] = 0.22 + a * 0.06 - burn * 0.06 - pore * 0.06; o[2] = 0.15 + a * 0.04 - burn * 0.03;
    o[3] = 0.9; o[4] = 0; o[5] = a * 0.5 - pore * 0.6 + p * 0.2;
  } },
  block: { scale: 0.5, size: 256, ns: 5, f(u, v, o) {
    const a = fbm(u, v, 8, 8, 5, 101), p = fbm(u, v, 64, 64, 2, 102), pore = sstep(0.66, 0.72, p);
    const c = 0.5 + a * 0.1 - pore * 0.2;
    o[0] = c; o[1] = c; o[2] = c * 0.97; o[3] = 0.95; o[4] = 0; o[5] = a * 0.4 + p * 0.3 - pore * 0.7;
  } },
  concrete: { scale: 4, size: 1024, ns: 1.5, f(u, v, o) { // 작업장 바닥 콘크리트
    const a = fbm(u, v, 3, 3, 6, 111), b = fbm(u, v, 24, 24, 4, 112), st = sstep(0.55, 0.75, fbm(u, v, 5, 5, 5, 113));
    const crack = 1 - sstep(0.0, 0.012, Math.abs(fbm(u, v, 4, 4, 5, 114) - 0.5)) * (fbm(u, v, 2, 2, 2, 115) > 0.55 ? 1 : 0);
    const c = 0.4 + a * 0.08 + b * 0.04 - st * 0.07;
    o[0] = c - crack * 0.12; o[1] = c * 0.99 - crack * 0.12; o[2] = c * 0.96 - crack * 0.12; o[3] = 0.78 + b * 0.14 - st * 0.14; o[4] = 0; o[5] = b * 0.5 - crack;
  } },
  asphalt: { scale: 2, size: 512, ns: 1.2, f(u, v, o) {
    const a = fbm(u, v, 4, 4, 4, 121), g = fbm(u, v, 160, 160, 2, 122), stone = sstep(0.66, 0.74, g), tar = fbm(u, v, 12, 12, 3, 123);
    const c = 0.12 + a * 0.03 + stone * 0.05 + tar * 0.02;
    o[0] = c; o[1] = c; o[2] = c * 1.03; o[3] = 0.82 - stone * 0.12 + a * 0.08; o[4] = 0; o[5] = g * 0.5 + stone * 0.3;
  } },
  grass: { scale: 2.5, size: 512, ns: 2, f(u, v, o) {
    const a = fbm(u, v, 8, 8, 4, 131), b = fbm(u, v, 96, 96, 3, 132), dry = sstep(0.55, 0.75, fbm(u, v, 6, 6, 4, 133)) * 0.5;
    o[0] = mix(0.2, 0.36, dry) * (0.78 + b * 0.4); o[1] = mix(0.33, 0.35, dry) * (0.78 + b * 0.4) + a * 0.03; o[2] = mix(0.11, 0.16, dry) * (0.8 + b * 0.3);
    o[3] = 0.95; o[4] = 0; o[5] = b;
  } },
  dirt: { scale: 3, size: 512, ns: 3, f(u, v, o) {
    const a = fbm(u, v, 5, 5, 5, 141), b = fbm(u, v, 48, 48, 3, 142), peb = sstep(0.7, 0.76, fbm(u, v, 40, 40, 2, 143));
    o[0] = 0.4 + a * 0.12 + peb * 0.1; o[1] = 0.3 + a * 0.09 + peb * 0.08; o[2] = 0.2 + a * 0.05 + peb * 0.08; o[3] = 0.95; o[4] = 0; o[5] = a * 0.4 + b * 0.3 + peb * 0.5;
  } },
  tire: { scale: 0.5, size: 256, ns: 8, f(u, v, o) { // 트레드 (u=원주, v=폭)
    const gu = (u * 24) % 1, block = (sstep(0.08, 0.14, gu) - sstep(0.62, 0.68, gu)) * (1 - sstep(0.46, 0.5, Math.abs(v - 0.5)) * 0)
      * (Math.abs(v - 0.5) < 0.04 ? 0 : 1);
    const zig = (Math.abs(v - 0.5) > 0.2 && Math.abs(v - 0.5) < 0.24) ? 0 : 1;
    const b = fbm(u, v, 32, 32, 2, 151), h = block * zig;
    o[0] = o[1] = o[2] = 0.06 + b * 0.03; o[3] = 0.85 + b * 0.1; o[4] = 0; o[5] = h;
  } },
  corrugated: { scale: 2, size: 512, ns: 9, f(u, v, o) { // 골강판 외벽 (u 방향 골)
    const s = Math.sin(u * Math.PI * 2 * 12) * 0.5 + 0.5, d = fbm(u, v, 4, 4, 4, 161), streak = fbm(u, v, 40, 3, 3, 162);
    o[0] = 0.36 + d * 0.05 - streak * 0.05; o[1] = 0.4 + d * 0.05 - streak * 0.05; o[2] = 0.44 + d * 0.04 - streak * 0.04; o[3] = 0.55 + streak * 0.2; o[4] = 0.3; o[5] = s;
  } },
  paint: { scale: 0.5, size: 256, ns: 0.25, f(u, v, o) { // 도장면 (오렌지필)
    const p = fbm(u, v, 24, 24, 3, 171), c = 0.92 + p * 0.06;
    o[0] = o[1] = o[2] = c; o[3] = 0.32 + p * 0.1; o[4] = 0.1; o[5] = p;
  } },
  fabric: { scale: 0.2, size: 256, ns: 2, f(u, v, o) {
    const w = (Math.sin(u * Math.PI * 2 * 64) * Math.sin(v * Math.PI * 2 * 64)) * 0.5 + 0.5, b = fbm(u, v, 16, 16, 2, 181);
    o[0] = 0.08 + b * 0.03; o[1] = 0.08 + b * 0.03; o[2] = 0.09 + b * 0.03; o[3] = 0.9; o[4] = 0; o[5] = w;
  } },
  cast: { scale: 0.3, size: 256, ns: 2.5, f(u, v, o) { // 주물(엔진 블록)
    const a = fbm(u, v, 32, 32, 3, 191), b = fbm(u, v, 4, 4, 3, 192), c = 0.42 + a * 0.08 + b * 0.05;
    o[0] = c; o[1] = c; o[2] = c * 1.02; o[3] = 0.6 + a * 0.2; o[4] = 0.8; o[5] = a;
  } },
};

export function generateSkins(onProgress) {
  const out = {}, keys = Object.keys(SKIN_DEFS);
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < keys.length && performance.now() - t0 < 40) {
        const k = keys[i++], d = SKIN_DEFS[k];
        const b = build(d.size, d.f, d.ns);
        for (const t of [b.map, b.normalMap, b.rmMap]) t.repeat.set(1 / d.scale, 1 / d.scale); // UV는 미터 단위
        out[k] = { ...b, scale: d.scale };
        onProgress?.(i / keys.length, k);
      }
      if (i < keys.length) setTimeout(step, 0); else resolve(out);
    };
    step();
  });
}

// 캔버스 기반 보조 텍스처 (글로우/파티클/데칼)
export function radialTex(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function smokeTex(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const r = mulberry(5);
  for (let i = 0; i < 40; i++) {
    const x = size / 2 + (r() - 0.5) * size * 0.4, y = size / 2 + (r() - 0.5) * size * 0.4, rad = size * (0.12 + r() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(c);
}
// 용접 열변색(템퍼 컬러) 데칼: 중심 짙은 산화 → 청색 → 보라 → 황색 → 투명
export function heatTintTex(size = 256) {
  return radialTex([[0, 'rgba(40,30,35,0.9)'], [0.18, 'rgba(60,50,90,0.85)'], [0.32, 'rgba(70,90,160,0.75)'], [0.48, 'rgba(120,80,140,0.6)'], [0.62, 'rgba(190,140,70,0.45)'], [0.8, 'rgba(200,170,110,0.18)'], [1, 'rgba(200,170,110,0)']], size);
}
