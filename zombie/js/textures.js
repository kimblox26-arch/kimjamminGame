// 절차적 텍스처 (외부 이미지 없이 캔버스로 생성) — 알베도 + 노멀맵
import * as THREE from 'three';
import { hash2, rng, pick } from './util.js';

let ANISO = 8;
export function setAniso(a) { ANISO = a; }

function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const a = hash2(m(xi), m(yi), s), b = hash2(m(xi + 1), m(yi), s), c = hash2(m(xi), m(yi + 1), s), d = hash2(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, p, oct = 4, s = 0) {
  let a = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { a += amp * vnoise(x * f, y * f, p * f, s + i * 17); n += amp; amp *= 0.5; f *= 2; }
  return a / n;
}
function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; return t;
}
// fn(u,v) -> [r,g,b,h] (0..1)
function pixels(n, fn) {
  const c = cv(n), ctx = c.getContext('2d'), img = ctx.createImageData(n, n), d = img.data, H = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = fn(x / n, y / n, x, y), k = (y * n + x) * 4;
    d[k] = r[0] * 255; d[k + 1] = r[1] * 255; d[k + 2] = r[2] * 255; d[k + 3] = 255; H[y * n + x] = r[3] ?? 0.5;
  }
  ctx.putImageData(img, 0, 0); return { c, H, n };
}
function normalFrom(H, n, str = 2) {
  const c = cv(n), ctx = c.getContext('2d'), img = ctx.createImageData(n, n), d = img.data;
  const at = (x, y) => H[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * str, dy = (at(x, y + 1) - at(x, y - 1)) * str;
    const l = Math.hypot(dx, dy, 1), k = (y * n + x) * 4;
    d[k] = (-dx / l * 0.5 + 0.5) * 255; d[k + 1] = (dy / l * 0.5 + 0.5) * 255; d[k + 2] = (1 / l * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0); return tex(c, false);
}
function pair(n, str, fn) { const p = pixels(n, fn); return { map: tex(p.c), normalMap: normalFrom(p.H, p.n, str) }; }

export const T = {};
export function buildTextures(q = 1) {
  const S = q < 0.7 ? 256 : q > 1.5 ? 1024 : 512;
  // 아스팔트
  T.asphalt = pair(S, 3, (u, v) => {
    const n = fbm(u * 64, v * 64, 64, 3, 1), m = fbm(u * 6, v * 6, 6, 4, 2), sp = hash2(u * 4096, v * 4096, 3);
    const crack = Math.abs(fbm(u * 5, v * 5, 5, 4, 9) - 0.5) < 0.006 ? 0.55 : 1;
    const g = (0.17 + n * 0.07 + (m - 0.5) * 0.06 + (sp > 0.97 ? 0.08 : 0)) * crack;
    return [g, g, g * 1.02, n * 0.6 + (crack < 1 ? 0 : 0.4)];
  });
  // 보도블럭
  T.paver = pair(S, 4, (u, v, x, y) => {
    const bw = S / 8, bh = S / 16, row = Math.floor(y / bh), off = (row % 2) * bw / 2;
    const bx = Math.floor((x + off) / bw), gx = (x + off) % bw, gy = y % bh;
    const edge = gx < 2 || gy < 2 ? 1 : 0, r = hash2(bx, row, 5), n = fbm(u * 32, v * 32, 32, 3, 6);
    const base = r < 0.33 ? [0.55, 0.36, 0.3] : r < 0.66 ? [0.5, 0.5, 0.48] : [0.62, 0.58, 0.5];
    const k = edge ? 0.45 : 0.85 + n * 0.3;
    return [base[0] * k, base[1] * k, base[2] * k, edge ? 0 : 0.6 + n * 0.3];
  });
  // 콘크리트
  T.concrete = pair(S, 1.5, (u, v) => {
    const n = fbm(u * 16, v * 16, 16, 5, 11), st = fbm(u * 3, v * 3, 3, 3, 12), dot = hash2(u * 2048, v * 2048, 13) > 0.985 ? -0.1 : 0;
    const g = 0.52 + (n - 0.5) * 0.18 - Math.max(0, st - 0.55) * 0.5 + dot;
    return [g, g * 0.99, g * 0.96, n];
  });
  // 실내 벽지
  T.wallpaper = pair(S / 2, 0.8, (u, v) => {
    const n = fbm(u * 40, v * 40, 40, 3, 21), l = (Math.sin(u * Math.PI * 64) * 0.5 + 0.5) * 0.02;
    const g = 0.86 + (n - 0.5) * 0.06 + l; return [g, g * 0.97, g * 0.91, n];
  });
  // 장판(나무무늬)
  T.wood = pair(S, 1.2, (u, v, x, y) => {
    const pw = S / 4, plank = Math.floor(x / pw), len = S / 1.0, pv = (y + hash2(plank, 0, 31) * len) % len;
    const seam = (x % pw) < 2 || pv < 2 ? 0.6 : 1, r = hash2(plank, Math.floor((y + hash2(plank, 0, 31) * len) / len), 32);
    const grain = Math.sin((u * 30 + fbm(u * 4, v * 30, 4, 3, 33) * 6) * Math.PI * 2) * 0.5 + 0.5;
    const t = 0.55 + r * 0.15 + grain * 0.08;
    return [t * 0.78 * seam, t * 0.55 * seam, t * 0.34 * seam, seam < 1 ? 0 : 0.5 + grain * 0.2];
  });
  // 욕실 타일
  T.tile = pair(S / 2, 3, (u, v, x, y) => {
    const ts = S / 8, edge = (x % ts) < 2 || (y % ts) < 2, n = fbm(u * 20, v * 20, 20, 2, 41);
    const g = edge ? 0.55 : 0.9 + n * 0.05; return [g, g, g * 1.01, edge ? 0 : 0.7];
  });
  // 땅/잔디 디테일(정점색과 곱함)
  T.ground = pair(S, 2.5, (u, v) => {
    const n = fbm(u * 48, v * 48, 48, 4, 51), m = fbm(u * 8, v * 8, 8, 3, 52), g = hash2(u * 4096, v * 4096, 53);
    const k = 0.75 + (n - 0.5) * 0.5 + (m - 0.5) * 0.25 + (g - 0.5) * 0.12;
    return [k, k * 0.98, k * 0.92, n];
  });
  // 피부·천 디테일 노멀
  T.skinN = pixels(128, (u, v) => { const n = fbm(u * 24, v * 24, 24, 3, 61); return [n, n, n, n]; });
  T.skinNormal = normalFrom(T.skinN.H, 128, 1.5);
  const cl = pixels(128, (u, v, x, y) => { const w = ((x % 4 < 2) ^ (y % 4 < 2)) ? 0.6 : 0.4; return [w, w, w, w + fbm(u * 16, v * 16, 16, 2, 62) * 0.3]; });
  T.clothNormal = normalFrom(cl.H, 128, 1.2);
  // 물 노멀
  const wn = pixels(256, (u, v) => { const n = fbm(u * 8, v * 8, 8, 5, 71); return [n, n, n, n]; });
  T.waterNormal = normalFrom(wn.H, 256, 6);
  // 나무 잎/수피용 노이즈
  T.leaf = pair(128, 2, (u, v) => { const n = fbm(u * 16, v * 16, 16, 3, 81); const k = 0.7 + n * 0.5; return [k, k, k, n]; });
  T.facadeApt = facadeApt(); T.facadeVilla = facadeVilla(); T.facadeOffice = facadeOffice(); T.storefront = storefront();
  for (const k of ['facadeApt', 'facadeVilla', 'facadeOffice', 'storefront']) surfaceMaps(T[k]);
  T.weed = weedTex(); T.leaves = leavesTex();
  T.signs = signAtlas(); T.aptNum = aptNumbers(); T.roadMinor = roadTex(false); T.roadMain = roadTex(true); T.crosswalk = crosswalkTex();
  T.curtain = pair(128, 1.5, (u, v) => { const f = Math.sin(u * Math.PI * 24) * 0.5 + 0.5; const k = 0.75 + f * 0.25; return [k * 0.78, k * 0.72, k * 0.6, f]; });
  return T;
}

// 아파트 외벽: 16m(4베이) × 12m(4층) 한 타일
function facadeApt() {
  const W = 512, H = 384, c = cv(W, H), x = c.getContext('2d'), e = cv(W, H), ex = e.getContext('2d'), r = rng(7);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  x.fillStyle = '#e8e2d4'; x.fillRect(0, 0, W, H);
  const bw = W / 4, fh = H / 4;
  for (let f = 0; f < 4; f++) for (let b = 0; b < 4; b++) {
    const X = b * bw, Y = f * fh;
    x.fillStyle = '#d9d2c2'; x.fillRect(X, Y + fh - 10, bw, 10); // 슬래브 라인
    // 발코니 창
    x.fillStyle = '#2b3640'; x.fillRect(X + 8, Y + 14, bw - 16, fh - 30);
    const g = x.createLinearGradient(X, Y, X + bw, Y + fh); g.addColorStop(0, 'rgba(160,190,210,.35)'); g.addColorStop(1, 'rgba(20,30,40,.1)');
    x.fillStyle = g; x.fillRect(X + 8, Y + 14, bw - 16, fh - 30);
    if (r() < 0.7) { x.fillStyle = pick(r, ['#c9b99a', '#9fb0b8', '#d8d0c0', '#b59a85', '#eee']); x.globalAlpha = 0.75; x.fillRect(X + 10 + (r() < .5 ? 0 : bw * 0.45), Y + 16, bw * 0.4, fh - 34); x.globalAlpha = 1; }
    x.strokeStyle = '#ccc'; x.lineWidth = 2; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(X + 8 + k * (bw - 16) / 4, Y + 14); x.lineTo(X + 8 + k * (bw - 16) / 4, Y + fh - 16); x.stroke(); }
    x.fillStyle = '#efeae0'; x.fillRect(X + 4, Y + fh - 26, bw - 8, 12); // 난간
    if (r() < 0.45) { x.fillStyle = '#ddd'; x.fillRect(X + bw - 34, Y + fh - 46, 24, 18); x.fillStyle = '#999'; x.fillRect(X + bw - 30, Y + fh - 42, 16, 10); } // 실외기
    if (r() < 0.12) { ex.fillStyle = pick(r, ['#ffcc88', '#ffe2b0', '#cfe4ff']); ex.globalAlpha = 0.8; ex.fillRect(X + 8, Y + 14, bw - 16, fh - 30); ex.globalAlpha = 1; }
  }
  stains(x, W, H, r, 0.18);
  const t = tex(c); t.repeat.set(1, 1); const et = tex(e); return { map: t, emissiveMap: et };
}
function facadeVilla() {
  const W = 512, H = 256, c = cv(W, H), x = c.getContext('2d'), r = rng(9);
  // 붉은 벽돌
  x.fillStyle = '#7a4a3a'; x.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 6) for (let i = 0; i < W; i += 16) {
    const o = (y / 6) % 2 ? 8 : 0, k = 0.85 + r() * 0.3;
    x.fillStyle = `rgb(${120 * k | 0},${68 * k | 0},${52 * k | 0})`; x.fillRect(i + o, y, 15, 5);
  }
  const bw = W / 3, fh = H / 2;
  for (let f = 0; f < 2; f++) for (let b = 0; b < 3; b++) {
    const X = b * bw + bw * 0.2, Y = f * fh + fh * 0.22, w = bw * 0.6, h = fh * 0.5;
    x.fillStyle = '#ddd'; x.fillRect(X - 4, Y - 4, w + 8, h + 8);
    x.fillStyle = '#26313a'; x.fillRect(X, Y, w, h);
    x.fillStyle = 'rgba(150,180,200,.3)'; x.fillRect(X, Y, w / 2 - 1, h);
    x.fillStyle = '#ccc'; x.fillRect(X + w / 2 - 1, Y, 2, h);
    x.strokeStyle = '#444'; x.lineWidth = 1.5; for (let k = 0; k < w; k += 6) { x.beginPath(); x.moveTo(X + k, Y); x.lineTo(X + k, Y + h); x.stroke(); } // 방범창
  }
  stains(x, W, H, r, 0.12);
  return { map: tex(c) };
}
function facadeOffice() {
  const W = 256, H = 256, c = cv(W, H), x = c.getContext('2d'), e = cv(W, H), ex = e.getContext('2d'), r = rng(11);
  x.fillStyle = '#5d6a74'; x.fillRect(0, 0, W, H); ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
  for (let f = 0; f < 4; f++) for (let b = 0; b < 4; b++) {
    const X = b * 64 + 3, Y = f * 64 + 6, k = 0.8 + r() * 0.4;
    const g = x.createLinearGradient(X, Y, X, Y + 52); g.addColorStop(0, `rgb(${90 * k | 0},${120 * k | 0},${140 * k | 0})`); g.addColorStop(1, `rgb(${30 * k | 0},${42 * k | 0},${52 * k | 0})`);
    x.fillStyle = g; x.fillRect(X, Y, 58, 52);
    if (r() < 0.1) { ex.fillStyle = '#cfe0ff'; ex.globalAlpha = .6; ex.fillRect(X, Y, 58, 52); ex.globalAlpha = 1; }
  }
  return { map: tex(c), emissiveMap: tex(e) };
}
function storefront() {
  const W = 512, H = 128, c = cv(W, H), x = c.getContext('2d'), r = rng(13);
  for (let i = 0; i < 4; i++) {
    const X = i * 128;
    if (r() < 0.45) { // 셔터
      x.fillStyle = '#8a8d90'; x.fillRect(X, 0, 128, H);
      for (let y = 0; y < H; y += 5) { x.fillStyle = y % 10 ? '#7a7d80' : '#9a9da0'; x.fillRect(X, y, 128, 2); }
      if (r() < 0.6) { x.fillStyle = pick(r, ['#c33', '#36c', '#222', '#3a3']); x.font = 'bold 22px sans-serif'; x.fillText(pick(r, ['임대', '휴업', 'SOS', '살려줘', '감염']), X + 30, 70); }
    } else {
      x.fillStyle = '#1c2228'; x.fillRect(X, 0, 128, H);
      const g = x.createLinearGradient(X, 0, X + 128, H); g.addColorStop(0, 'rgba(170,200,220,.35)'); g.addColorStop(1, 'rgba(0,0,0,.2)');
      x.fillStyle = g; x.fillRect(X + 4, 4, 120, H - 8);
      x.fillStyle = 'rgba(255,255,255,.08)'; for (let k = 0; k < 5; k++) x.fillRect(X + 10 + k * 22, 60 + r() * 30, 14, 40);
      if (r() < 0.5) { x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = 1; for (let k = 0; k < 8; k++) { x.beginPath(); x.moveTo(X + 64, 64); x.lineTo(X + r() * 128, r() * H); x.stroke(); } } // 깨진 유리
    }
    x.fillStyle = '#555'; x.fillRect(X, 0, 4, H);
  }
  return { map: tex(c) };
}
// 알베도에서 높이/거칠기 추출: 어두운 유리=움푹+매끈, 밝은 벽=거침
function surfaceMaps(t) {
  const c = t.map.image, W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
  const hc = cv(W, H), hx = hc.getContext('2d'), img = hx.createImageData(W, H), Hm = new Float32Array(W * H);
  const rc = cv(W, H), rx = rc.getContext('2d'), rim = rx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, l = 0.3 * r + 0.59 * g + 0.11 * b;
    const glass = b >= r - 0.02 && l < 0.42 ? 1 : 0, n = hash2(i % W, (i / W) | 0, 7);
    Hm[i] = glass ? 0.0 : 0.55 + l * 0.4 + n * 0.05;
    const ro = glass ? 0.08 + n * 0.06 : 0.75 + n * 0.2; rim.data[i * 4] = rim.data[i * 4 + 1] = rim.data[i * 4 + 2] = ro * 255; rim.data[i * 4 + 3] = 255;
  }
  // 경계 부드럽게(창틀 깊이감)
  const H2 = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let k = -1; k <= 1; k++) for (let q = -1; q <= 1; q++) a += Hm[((y + k + H) % H) * W + (x + q + W) % W]; H2[y * W + x] = a / 9; }
  rx.putImageData(rim, 0, 0);
  // normalFrom 은 정사각 가정 → 직접 계산
  const nc = cv(W, H), nx = nc.getContext('2d'), ni = nx.createImageData(W, H), at = (x, y) => H2[((y + H) % H) * W + (x + W) % W];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (at(x + 1, y) - at(x - 1, y)) * 4, dy = (at(x, y + 1) - at(x, y - 1)) * 4, l = Math.hypot(dx, dy, 1), k = (y * W + x) * 4; ni.data[k] = (-dx / l * 0.5 + 0.5) * 255; ni.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; ni.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; ni.data[k + 3] = 255; }
  nx.putImageData(ni, 0, 0);
  t.normalMap = tex(nc, false); t.roughnessMap = tex(rc, false);
}
// 잎 아틀라스(2×2): 잎이 다닥다닥 붙은 가지 카드 / 좌하단 모서리는 불투명(나무껍질 UV)
function leavesTex() {
  const N = 512, c = cv(N), x = c.getContext('2d'), r = rng(57);
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256;
    x.strokeStyle = 'rgba(70,55,40,1)'; x.lineWidth = 3; x.beginPath(); x.moveTo(ox + 128, oy + 250); x.quadraticCurveTo(ox + 110 + r() * 40, oy + 128, ox + 128 + (r() - 0.5) * 60, oy + 20); x.stroke();
    for (let i = 0; i < 46; i++) {
      const px = ox + 128 + (r() - 0.5) * 210, py = oy + 20 + r() * 210, s = 9 + r() * 12, a = r() * 6.28, k = 0.7 + r() * 0.45;
      x.save(); x.translate(px, py); x.rotate(a); x.fillStyle = `rgb(${235 * k | 0},${235 * k | 0},${225 * k | 0})`;
      x.beginPath(); if (q % 2) { x.moveTo(0, 0); x.arc(0, 0, s, -0.9, 0.9); x.closePath(); } else { x.ellipse(0, 0, s, s * 0.45, 0, 0, 6.28); } x.fill();
      x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = 1; x.beginPath(); x.moveTo(-s, 0); x.lineTo(s, 0); x.stroke(); x.restore();
    }
  }
  x.fillStyle = '#d8d0c8'; x.fillRect(0, N - 24, 24, 24);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return { map: t };
}
function weedTex() {
  const c = cv(256, 256), x = c.getContext('2d'), r = rng(31);
  for (let i = 0; i < 70; i++) {
    const bx = 128 + (r() - 0.5) * 200, h = 90 + r() * 160, lean = (r() - 0.5) * 90, w = 3 + r() * 6;
    const g = x.createLinearGradient(0, 256, 0, 256 - h); const k = 0.6 + r() * 0.5, dry = r() < 0.45;
    g.addColorStop(0, dry ? `rgb(${90 * k | 0},${80 * k | 0},${40 * k | 0})` : `rgb(${40 * k | 0},${70 * k | 0},${25 * k | 0})`); g.addColorStop(1, dry ? `rgb(${170 * k | 0},${150 * k | 0},${80 * k | 0})` : `rgb(${90 * k | 0},${130 * k | 0},${50 * k | 0})`);
    x.fillStyle = g; x.beginPath(); x.moveTo(bx - w, 256); x.quadraticCurveTo(bx + lean * 0.3, 256 - h * 0.6, bx + lean, 256 - h); x.quadraticCurveTo(bx + lean * 0.3 + 1, 256 - h * 0.55, bx + w, 256); x.fill();
  }
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return { map: t };
}
function stains(x, W, H, r, a) {
  for (let i = 0; i < 30; i++) {
    const X = r() * W, w = 2 + r() * 6, h = 20 + r() * 80, g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(40,35,30,${a})`); g.addColorStop(1, 'rgba(40,35,30,0)'); x.fillStyle = g; x.save(); x.translate(X, r() * H); x.fillRect(0, 0, w, h); x.restore();
  }
}
export const SIGN_WORDS = ['편의점', '약국', '치킨', 'PC방', '노래방', '부동산', '미용실', '분식', '정육점', '세탁소', '안경원', '내과의원', '치과', '마트', '카페', '파출소'];
function signAtlas() {
  const W = 1024, H = 1024, c = cv(W, H), x = c.getContext('2d'), r = rng(17);
  const cols = [['#d62828', '#fff'], ['#1d4e89', '#fff'], ['#f4d35e', '#222'], ['#2a9d8f', '#fff'], ['#fff', '#c1121f'], ['#222', '#ffd166'], ['#6a4c93', '#fff'], ['#ff7b00', '#fff']];
  for (let i = 0; i < 16; i++) {
    const X = (i % 2) * 512, Y = Math.floor(i / 2) * 128, [bg, fg] = cols[i % cols.length];
    x.fillStyle = bg; x.fillRect(X + 2, Y + 2, 508, 124);
    x.fillStyle = 'rgba(255,255,255,.15)'; x.fillRect(X + 2, Y + 2, 508, 18);
    x.fillStyle = fg; x.font = 'bold 74px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(SIGN_WORDS[i], X + 256, Y + 68);
    x.font = 'bold 20px sans-serif'; x.fillText(pick(r, ['☎ 02-' + (100 + (r() * 899 | 0)) + '-' + (1000 + (r() * 8999 | 0)), '24시간 영업', 'SINCE 1998', '배달 가능']), X + 256, Y + 112);
    x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 4; k++) x.fillRect(X + r() * 500, Y + r() * 120, 4 + r() * 20, 2 + r() * 8);
  }
  const t = tex(c); return { map: t, emissiveMap: t };
}
function aptNumbers() {
  const c = cv(512, 512), x = c.getContext('2d');
  x.fillStyle = '#e8e2d4'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) {
    const X = (i % 4) * 128, Y = Math.floor(i / 4) * 128;
    x.fillStyle = '#2a4d7a'; x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText((101 + i) + '', X + 64, Y + 54); x.font = 'bold 34px sans-serif'; x.fillText('동', X + 64, Y + 100);
  }
  return { map: tex(c) };
}
function roadTex(main) {
  const W = 256, H = 256, p = pixels(W, (u, v) => {
    const n = fbm(u * 32, v * 32, 32, 3, 91), g = 0.16 + n * 0.08; return [g, g, g, n];
  });
  const x = p.c.getContext('2d');
  // 도로 방향: v(세로)가 진행방향, u 가로가 폭
  const lanes = main ? 6 : 2;
  x.fillStyle = '#e6c229';
  x.fillRect(W / 2 - 5, 0, 3, H); x.fillRect(W / 2 + 2, 0, 3, H);
  x.fillStyle = '#ddd';
  for (let k = 1; k < lanes / 2; k++) for (const s of [-1, 1]) for (let y = 0; y < H; y += 64) x.fillRect(W / 2 + s * k * (W / lanes) - 1, y, 3, 36);
  x.fillRect(4, 0, 3, H); x.fillRect(W - 7, 0, 3, H);
  x.globalAlpha = 0.25; x.fillStyle = '#000'; for (let k = 0; k < 6; k++) { x.beginPath(); x.ellipse(Math.random() * W, Math.random() * H, 10 + Math.random() * 20, 6, 0, 0, 7); x.fill(); }
  return { map: tex(p.c), normalMap: normalFrom(p.H, W, 2) };
}
function crosswalkTex() {
  const c = cv(256, 64), x = c.getContext('2d'); x.fillStyle = '#2a2a2a'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#e8e8e8'; for (let i = 0; i < 256; i += 32) x.fillRect(i + 6, 4, 18, 56);
  return { map: tex(c) };
}

// 동적 캔버스 텍스처(폰/TV)
export function dynTex(w, h) { const c = cv(w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, ctx: c.getContext('2d'), t }; }
