// FREE FREELY 우주 탐사 - 절차적 텍스처 (타일링 노이즈, 3D 구름 노이즈, 선체 패널 노멀맵, 고리 단면)
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** 주기적 2D 그래디언트 노이즈 (period 칸마다 반복) */
function periodicNoise2(period, seed) {
  const r = rng(seed);
  const g = new Float32Array(period * period * 2);
  for (let i = 0; i < period * period; i++) { const a = r() * Math.PI * 2; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const idx = (ix, iy) => (((iy % period) + period) % period) * period + (((ix % period) + period) % period);
    const dot = (ix, iy, dx, dy) => { const k = idx(ix, iy) * 2; return g[k] * dx + g[k + 1] * dy; };
    const a = dot(xi, yi, fx, fy), b = dot(xi + 1, yi, fx - 1, fy), c = dot(xi, yi + 1, fx, fy - 1), d = dot(xi + 1, yi + 1, fx - 1, fy - 1);
    return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 1.414;
  };
}

/**
 * 타일링 디테일 텍스처 (RGBA): R=fBm 높이, G/B=기울기(0.5 중심), A=세포형 무늬(바위·균열)
 */
export function makeDetailTexture(size = 256, seed = 7) {
  const data = new Uint8Array(size * size * 4);
  const H = new Float32Array(size * size);
  const n = [periodicNoise2(8, seed), periodicNoise2(16, seed + 1), periodicNoise2(32, seed + 2), periodicNoise2(64, seed + 3), periodicNoise2(128, seed + 4)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0, a = 1, norm = 0;
      for (let o = 0; o < n.length; o++) {
        const p = 8 << o;
        h += n[o]((x / size) * p, (y / size) * p) * a;
        norm += a; a *= 0.55;
      }
      H[y * size + x] = h / norm;
    }
  }
  // 세포 무늬 (주기적 보로노이)
  const cells = 24, r = rng(seed + 99);
  const pts = [];
  for (let i = 0; i < cells * cells; i++) pts.push([r(), r()]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const xm = (x - 1 + size) % size, xp = (x + 1) % size, ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const gx = (H[y * size + xp] - H[y * size + xm]) * 4;
      const gy = (H[yp * size + x] - H[ym * size + x]) * 4;
      const cx = (x / size) * cells, cy = (y / size) * cells;
      const ix = Math.floor(cx), iy = Math.floor(cy);
      let d1 = 9, d2 = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const px = ix + i, py = iy + j;
        const pp = pts[(((py % cells) + cells) % cells) * cells + (((px % cells) + cells) % cells)];
        const dx = px + pp[0] - cx, dy = py + pp[1] - cy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      data[k * 4] = Math.max(0, Math.min(255, (H[k] * 0.5 + 0.5) * 255));
      data[k * 4 + 1] = Math.max(0, Math.min(255, (gx * 0.5 + 0.5) * 255));
      data[k * 4 + 2] = Math.max(0, Math.min(255, (gy * 0.5 + 0.5) * 255));
      data[k * 4 + 3] = Math.max(0, Math.min(255, Math.min(1, edge * 2.2) * 255));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** 주기적 3D 노이즈 텍스처 (구름 볼륨): R=펄린-워리, G=워리 fBm, B=고주파 디테일 */
export function makeCloudNoise3D(size = 64, seed = 3) {
  const data = new Uint8Array(size * size * size * 4);
  const r = rng(seed);
  const worleyGrid = (cells) => {
    const pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = r();
    return (x, y, z) => {
      const cx = x * cells, cy = y * cells, cz = z * cells;
      const ix = Math.floor(cx), iy = Math.floor(cy), iz = Math.floor(cz);
      let d1 = 9;
      for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const px = ix + i, py = iy + j, pz = iz + k;
        const w = (v) => ((v % cells) + cells) % cells;
        const o = (w(pz) * cells * cells + w(py) * cells + w(px)) * 3;
        const dx = px + pts[o] - cx, dy = py + pts[o + 1] - cy, dz = pz + pts[o + 2] - cz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < d1) d1 = d;
      }
      return 1 - Math.min(1, Math.sqrt(d1));
    };
  };
  // 주기적 값 노이즈 (펄린 대용)
  const valueGrid = (cells) => {
    const v = new Float32Array(cells * cells * cells);
    for (let i = 0; i < v.length; i++) v[i] = r();
    const w = (a) => ((a % cells) + cells) % cells;
    const at = (x, y, z) => v[w(z) * cells * cells + w(y) * cells + w(x)];
    return (x, y, z) => {
      const cx = x * cells, cy = y * cells, cz = z * cells;
      const ix = Math.floor(cx), iy = Math.floor(cy), iz = Math.floor(cz);
      let fx = cx - ix, fy = cy - iy, fz = cz - iz;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(at(ix, iy, iz), at(ix + 1, iy, iz), fx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), fx), fy),
        l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), fx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), fx), fy), fz);
    };
  };
  const w4 = worleyGrid(4), w8 = worleyGrid(8), w16 = worleyGrid(16), w32 = worleyGrid(32);
  const v4 = valueGrid(4), v8 = valueGrid(8), v16 = valueGrid(16);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, s = z / size;
    const per = v4(u, v, s) * 0.55 + v8(u, v, s) * 0.3 + v16(u, v, s) * 0.15;
    const wor = w4(u, v, s) * 0.625 + w8(u, v, s) * 0.25 + w16(u, v, s) * 0.125;
    const pw = Math.max(0, Math.min(1, per + (wor - 1) * 0.35 + 0.18));
    const det = w16(u, v, s) * 0.6 + w32(u, v, s) * 0.4;
    const k = ((z * size + y) * size + x) * 4;
    data[k] = pw * 255; data[k + 1] = wor * 255; data[k + 2] = det * 255; data[k + 3] = per * 255;
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** 우주선 선체 패널 노멀맵 + 거칠기 맵 (캔버스 → 소벨) */
export function makeHullTextures(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  const r = rng(17);
  // 패널 분할 (재귀)
  const panels = [];
  const split = (x, y, w, h, d) => {
    if (d > 5 || (d > 2 && r() < 0.25) || w < 40 || h < 40) { panels.push([x, y, w, h]); return; }
    if (w > h) { const s = w * (0.3 + r() * 0.4); split(x, y, s, h, d + 1); split(x + s, y, w - s, h, d + 1); } else { const s = h * (0.3 + r() * 0.4); split(x, y, w, s, d + 1); split(x, y + s, w, h - s, d + 1); }
  };
  split(0, 0, size, size, 0);
  const rough = document.createElement('canvas');
  rough.width = rough.height = size;
  const rg = rough.getContext('2d');
  for (const [x, y, w, h] of panels) {
    const v = 120 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
    const rv = 90 + Math.floor(r() * 80);
    rg.fillStyle = `rgb(${rv},${rv},${rv})`;
    rg.fillRect(x, y, w, h);
    // 리벳
    g.fillStyle = '#9a9a9a';
    if (w > 60 && h > 60) {
      for (let i = 8; i < w - 4; i += 14) { g.fillRect(x + i, y + 5, 2, 2); g.fillRect(x + i, y + h - 7, 2, 2); }
    }
    // 해치 · 그릴
    if (r() < 0.12 && w > 80 && h > 80) {
      g.fillStyle = '#6a6a6a';
      for (let i = 0; i < 6; i++) g.fillRect(x + 12, y + 14 + i * 9, w - 24, 4);
    }
  }
  // 이음선
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = 2;
  for (const [x, y, w, h] of panels) g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  const src = g.getImageData(0, 0, size, size).data;
  const out = g.createImageData(size, size);
  const H = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.2;
    const dy = (H(x, y + 1) - H(x, y - 1)) * 2.2;
    const l = Math.hypot(dx, dy, 1);
    const k = (y * size + x) * 4;
    out.data[k] = (-dx / l * 0.5 + 0.5) * 255;
    out.data[k + 1] = (dy / l * 0.5 + 0.5) * 255;
    out.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
    out.data[k + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const normal = new THREE.CanvasTexture(c);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  const roughTex = new THREE.CanvasTexture(rough);
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  return { normal, rough: roughTex };
}

/** 고리 단면 밀도·색 (1D 텍스처, 256 → 2048) */
export function makeRingTexture(palette = 'saturn', seed = 3) {
  const w = 2048;
  const data = new Uint8Array(w * 4);
  const r = rng(seed);
  const base = palette === 'ice' ? [205, 225, 240] : [214, 196, 160];
  const alt = palette === 'ice' ? [150, 190, 220] : [170, 140, 105];
  // 저주파 밀도 변화 + 고주파 미세 링렛
  const bands = [];
  for (let i = 0; i < 40; i++) bands.push([r(), r() * 0.05 + 0.005, r() * 0.8 - 0.3]);
  for (let i = 0; i < w; i++) {
    const x = i / w;
    let d = 0.55 + 0.25 * Math.sin(x * 23 + seed) + 0.15 * Math.sin(x * 71 + seed * 2);
    for (const [c, wd, a] of bands) d += a * Math.exp(-Math.pow((x - c) / wd, 2));
    d += (r() - 0.5) * 0.25;
    // 토성형 구조: C 고리(옅음) · B 고리(진함) · 카시니 간극 · A 고리 · 엥케 간극
    if (palette === 'saturn') {
      if (x < 0.28) d *= 0.35;
      else if (x < 0.66) d *= 1.3;
      else if (x < 0.71) d *= 0.04;
      else if (x > 0.93 && x < 0.945) d *= 0.1;
    } else {
      if (x > 0.45 && x < 0.5) d *= 0.08;
    }
    d *= Math.min(1, x * 12) * Math.min(1, (1 - x) * 14);
    d = Math.max(0, Math.min(1, d));
    const m = 0.5 + 0.5 * Math.sin(x * 40 + seed);
    data[i * 4] = base[0] * (1 - m * 0.3) + alt[0] * m * 0.3;
    data[i * 4 + 1] = base[1] * (1 - m * 0.3) + alt[1] * m * 0.3;
    data[i * 4 + 2] = base[2] * (1 - m * 0.3) + alt[2] * m * 0.3;
    data[i * 4 + 3] = d * 255;
  }
  const t = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 기체 행성 위도 띠 팔레트 (1D) */
export function makeGasPalette(name) {
  const P = {
    jupiter: [[0.82, 0.74, 0.62], [0.62, 0.45, 0.32], [0.9, 0.85, 0.76], [0.72, 0.52, 0.36], [0.95, 0.9, 0.82], [0.55, 0.4, 0.3], [0.85, 0.78, 0.66]],
    saturn: [[0.86, 0.78, 0.6], [0.78, 0.68, 0.5], [0.9, 0.83, 0.66], [0.74, 0.64, 0.46], [0.88, 0.8, 0.62]],
    neptune: [[0.22, 0.4, 0.82], [0.3, 0.5, 0.9], [0.18, 0.34, 0.74], [0.42, 0.6, 0.95], [0.2, 0.38, 0.8]],
    teal: [[0.4, 0.72, 0.74], [0.55, 0.84, 0.82], [0.3, 0.58, 0.66], [0.7, 0.9, 0.86], [0.36, 0.64, 0.7], [0.62, 0.8, 0.78]],
  }[name] || [[0.8, 0.7, 0.6], [0.6, 0.5, 0.4]];
  const w = 256;
  const data = new Uint8Array(w * 4);
  const r = rng(name.length * 13);
  let seg = [];
  let x = 0;
  while (x < 1) { const len = 0.02 + r() * 0.07; seg.push([x, Math.min(1, x + len), P[Math.floor(r() * P.length)]]); x += len; }
  for (let i = 0; i < w; i++) {
    const u = i / (w - 1);
    let c = seg[0][2];
    for (let k = 0; k < seg.length; k++) if (u >= seg[k][0] && u <= seg[k][1]) {
      const nx = seg[Math.min(seg.length - 1, k + 1)][2];
      const t = Math.pow((u - seg[k][0]) / (seg[k][1] - seg[k][0]), 6);
      c = seg[k][2].map((v, j) => v + (nx[j] - v) * t);
    }
    // 극지방 어둡게·푸르게
    const pole = Math.pow(Math.abs(u * 2 - 1), 6);
    data[i * 4] = Math.min(255, c[0] * (1 - pole * 0.35) * 255);
    data[i * 4 + 1] = Math.min(255, c[1] * (1 - pole * 0.3) * 255);
    data[i * 4 + 2] = Math.min(255, (c[2] * (1 - pole * 0.2) + pole * 0.05) * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 부드러운 원형 스프라이트 */
export function makeGlowTexture(size = 128, power = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x / size * 2 - 1, y / size * 2 - 1);
    const a = Math.pow(Math.max(0, 1 - d), power);
    const k = (y * size + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
    img.data[k + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}
