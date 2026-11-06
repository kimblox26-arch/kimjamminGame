// 절차적 텍스처 (캔버스): 값 노이즈, 높이 → 노멀맵
import * as THREE from 'three';

function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695040888963407) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
// 타일링 되는 값 노이즈 (주기 per)
export function noise2(x, y, per, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = k => ((k % per) + per) % per;
  const a = hash(m(xi), m(yi), seed), b = hash(m(xi + 1), m(yi), seed), c = hash(m(xi), m(yi + 1), seed), d = hash(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, per, oct = 5, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, per * f, seed + i * 17); n += a; a *= 0.5; f *= 2; }
  return s / n;
}
export function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// fn(u, v) → [r,g,b,(a)] (0~255) 로 캔버스 채우기
export function paint(size, fn) {
  const c = canvas(size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = fn(x / size, y / size, x, y), i = (y * size + x) * 4;
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o.length > 3 ? o[3] : 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
export function heightToNormal(size, hf, strength = 2) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = hf(x / size, y / size, x, y);
  return paint(size, (u, v, x, y) => {
    const g = (xx, yy) => H[((yy + size) % size) * size + ((xx + size) % size)];
    const dx = (g(x + 1, y) - g(x - 1, y)) * strength, dy = (g(x, y + 1) - g(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}
export function toTex(c, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  return t;
}
