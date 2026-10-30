import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const chance = (p) => Math.random() < p;
export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 모서리가 둥근 상자 (로블록스 R15 파츠 느낌)
const geoCache = new Map();
export function rbox(w, h, d, r = 0.15, n = 3) {
  const key = [w, h, d, r, n].join();
  if (geoCache.has(key)) return geoCache.get(key);
  r = Math.min(r, w / 2, h / 2, d / 2) * 0.999;
  const S = 2 * n + 1;
  const g = new THREE.BoxGeometry(2, 2, 2, S, S, S);
  const p = g.attributes.position, nr = g.attributes.normal;
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r, e = 1 / S;
  const map = (c, inner) => {
    const a = Math.abs(c);
    if (a <= e + 1e-6) return (c / e) * inner;
    return Math.sign(c) * (inner + ((a - e) / (1 - e)) * r);
  };
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(map(p.getX(i), ix), map(p.getY(i), iy), map(p.getZ(i), iz));
    q.set(clamp(v.x, -ix, ix), clamp(v.y, -iy, iy), clamp(v.z, -iz, iz));
    v.sub(q);
    const L = v.length();
    if (L < 1e-6) v.set(nr.getX(i), nr.getY(i), nr.getZ(i));
    else v.divideScalar(L);
    nr.setXYZ(i, v.x, v.y, v.z);
    p.setXYZ(i, q.x + v.x * r, q.y + v.y * r, q.z + v.z * r);
  }
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

const matCache = new Map();
export function mat(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}

export function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 광선과 캡슐(세로 선분) 교차 — 맞으면 거리, 아니면 Infinity
export function rayCapsule(o, d, a, b, r) {
  const ab = b.clone().sub(a), ao = o.clone().sub(a);
  const abab = ab.dot(ab), abd = ab.dot(d), abao = ab.dot(ao), dao = d.dot(ao);
  const den = abab - abd * abd;
  let t = den > 1e-6 ? (abd * abao - abab * dao) / den : 0;
  t = Math.max(0, t);
  const p = o.clone().addScaledVector(d, t);
  const s = clamp(ab.dot(p.clone().sub(a)) / abab, 0, 1);
  const c = a.clone().addScaledVector(ab, s);
  const dist = p.distanceTo(c);
  if (dist > r) return Infinity;
  return Math.max(0, t - Math.sqrt(r * r - dist * dist));
}
