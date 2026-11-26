import * as THREE from 'three';

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export function hash2(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// 간단한 이벤트 버스
export class Bus {
  constructor() { this.m = {}; }
  on(e, f) { (this.m[e] ||= []).push(f); return () => this.m[e] = this.m[e].filter(x => x !== f); }
  emit(e, d) { (this.m[e] || []).slice().forEach(f => f(d)); }
}

// 빠른 메시 빌더: 쿼드/박스를 배열에 쌓아 하나의 BufferGeometry 로
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
export class MB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.vc = 0; this.m = null; }
  setMatrix(m) { this.m = m; if (m) _m3.getNormalMatrix(m); return this; }
  vert(x, y, z, nx, ny, nz, u, v, col) {
    if (this.m) { _v.set(x, y, z).applyMatrix4(this.m); x = _v.x; y = _v.y; z = _v.z; _n.set(nx, ny, nz).applyMatrix3(_m3).normalize(); nx = _n.x; ny = _n.y; nz = _n.z; }
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v);
    this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1); return this.vc++;
  }
  // a,b,c,d: 반시계(법선쪽에서 볼 때) [x,y,z], uv: [u0,v0,u1,v1]
  quad(a, b, c, d, n, uv = [0, 0, 1, 1], col) {
    const i = this.vert(a[0], a[1], a[2], n[0], n[1], n[2], uv[0], uv[1], col);
    this.vert(b[0], b[1], b[2], n[0], n[1], n[2], uv[2], uv[1], col);
    this.vert(c[0], c[1], c[2], n[0], n[1], n[2], uv[2], uv[3], col);
    this.vert(d[0], d[1], d[2], n[0], n[1], n[2], uv[0], uv[3], col);
    this.i.push(i, i + 1, i + 2, i, i + 2, i + 3); return this;
  }
  // faces 비트: 1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z
  box(x0, y0, z0, x1, y1, z1, o = {}) {
    const su = o.su || 1, sv = o.sv || su, f = o.faces ?? 63, col = o.col, uo = o.uo || 0, vo = o.vo || 0;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (f & 16) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [uo, vo, uo + w / su, vo + h / sv], col);
    if (f & 32) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [uo, vo, uo + w / su, vo + h / sv], col);
    if (f & 1) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [uo, vo, uo + d / su, vo + h / sv], col);
    if (f & 2) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [uo, vo, uo + d / su, vo + h / sv], col);
    if (f & 4) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 0, w / (o.tu || su), d / (o.tu || su)], o.topCol || col);
    if (f & 8) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [0, 0, w / su, d / su], col);
    return this;
  }
  // 임의 지오메트리 병합 (색 지정)
  geo(g, col) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, base = this.vc;
    for (let k = 0; k < p.count; k++) this.vert(p.getX(k), p.getY(k), p.getZ(k), n.getX(k), n.getY(k), n.getZ(k), uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0, col);
    if (g.index) for (let k = 0; k < g.index.count; k++) this.i.push(base + g.index.getX(k));
    else for (let k = 0; k < p.count; k++) this.i.push(base + k);
    return this;
  }
  get empty() { return this.vc === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  mesh(mat, shadow = true) { const m = new THREE.Mesh(this.build(), mat); m.castShadow = shadow; m.receiveShadow = true; return m; }
}

export function fmt2(n) { return String(n).padStart(2, '0'); }
