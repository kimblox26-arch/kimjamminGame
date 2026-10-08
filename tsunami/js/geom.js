// 소형 지오메트리 유틸: 정점색 박스/원기둥 병합
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function part(geo, x, y, z, color = 0xffffff, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(1, 1, 1));
  g.applyMatrix4(_m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}

export const box = (w, h, d, x, y, z, color, rx, ry, rz) => part(new THREE.BoxGeometry(w, h, d), x, y, z, color, rx, ry, rz);
export const cyl = (r0, r1, h, seg, x, y, z, color, rx, ry, rz) => part(new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, color, rx, ry, rz);

export function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** 박공지붕 프리즘 (밑면 1x1, 높이 1, 용마루는 x축) */
export function gableGeometry() {
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0,
    -0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 1, 0,
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0,
  ];
  // 각 삼각형의 2·3번째 정점을 바꿔 바깥에서 반시계(앞면)가 되게
  for (let t = 0; t < v.length; t += 9) for (let c = 0; c < 3; c++) { const a = v[t + 3 + c]; v[t + 3 + c] = v[t + 6 + c]; v[t + 6 + c] = a; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** 선체 (길이 1 기준, 뱃머리는 +x) */
export function boatGeometry(hullColor, deckColor = 0xf2f2ee) {
  const s = new THREE.Shape();
  const W = 0.16;
  s.moveTo(-0.5, -W); s.lineTo(0.22, -W); s.quadraticCurveTo(0.45, -W * 0.6, 0.5, 0);
  s.quadraticCurveTo(0.45, W * 0.6, 0.22, W); s.lineTo(-0.5, W); s.lineTo(-0.5, -W);
  const hull = new THREE.ExtrudeGeometry(s, { depth: 0.11, bevelEnabled: false, curveSegments: 6 });
  hull.rotateX(Math.PI / 2);
  hull.translate(0, 0.07, 0);
  const g1 = part(hull, 0, 0, 0, hullColor);
  // 상단부 흰 띠
  const pos = g1.attributes.position, col = g1.attributes.color, w = new THREE.Color(deckColor);
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.05) col.setXYZ(i, w.r, w.g, w.b);
  return merge([
    g1,
    box(0.9, 0.012, 0.3, -0.03, 0.074, 0, 0x9a8a70),
    box(0.22, 0.1, 0.2, -0.18, 0.13, 0, deckColor),
    box(0.225, 0.035, 0.205, -0.18, 0.15, 0, 0x203040),
    box(0.012, 0.32, 0.012, 0.05, 0.24, 0, 0xdddddd),
  ]);
}

export function carGeometry() {
  const parts = [
    box(4.4, 0.72, 1.8, 0, 0.62, 0, 0xffffff),
    box(2.3, 0.6, 1.62, -0.2, 1.28, 0, 0x1a2128),
    box(2.2, 0.07, 1.56, -0.2, 1.6, 0, 0xffffff),
    box(0.06, 0.18, 0.4, 2.2, 0.75, 0.6, 0xfff6d0),
    box(0.06, 0.18, 0.4, 2.2, 0.75, -0.6, 0xfff6d0),
    box(0.06, 0.16, 0.4, -2.2, 0.78, 0.62, 0xb01010),
    box(0.06, 0.16, 0.4, -2.2, 0.78, -0.62, 0xb01010),
  ];
  for (const [x, z] of [[1.35, 0.82], [1.35, -0.82], [-1.35, 0.82], [-1.35, -0.82]]) {
    parts.push(cyl(0.34, 0.34, 0.24, 10, x, 0.34, z, 0x111111, Math.PI / 2, 0, 0));
  }
  return merge(parts);
}
