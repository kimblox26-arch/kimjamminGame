// 고요(GOYO) — 나무
// 가까운 나무는 잎을 한 장씩(알파 컷 카드) 그리고, 먼 나무는 덩어리로 바꿔 단다.
// 두 벌의 InstancedMesh 를 거리로 나눠 채우므로 잎이 아무리 많아도 화면에
// 실제로 그려지는 잎은 일정 수를 넘지 않는다.
import * as THREE from 'three';
import { clamp01, lerp, makeRng, smoothstep, TAU } from '../core/utils.js';
import { heightAt, normalAt, sampleGround, fertilityAt, fbm2, noiseCanvas, normalMapFromHeights, WATER_LEVEL, LAKE, INNER_HALF } from './terrain.js';
import { mergeGeos, tint, windify, WIND } from './flora.js';

/* ------------------------------------------------------------------ */
/* 잎 텍스처 아틀라스 (2×2)                                             */
/*  0: 넓은 잎   1: 톱니 잎   2: 작은 둥근 잎   3: 침엽 다발            */
/* ------------------------------------------------------------------ */
function leafAtlas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  g.clearRect(0, 0, size, size);

  const leafShape = (ox, oy, w, l, serrate) => {
    g.save();
    g.translate(ox + h / 2, oy + h / 2);
    g.beginPath();
    const steps = 26;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      let wid = Math.sin(t * Math.PI) ** 0.72 * w;
      if (serrate) wid *= 1 + Math.sin(t * Math.PI * 9) * 0.16;
      const y = -l / 2 + t * l;
      if (s === 0) g.moveTo(wid, y); else g.lineTo(wid, y);
    }
    for (let s = steps; s >= 0; s--) {
      const t = s / steps;
      let wid = Math.sin(t * Math.PI) ** 0.72 * w;
      if (serrate) wid *= 1 + Math.sin(t * Math.PI * 9) * 0.16;
      g.lineTo(-wid, -l / 2 + t * l);
    }
    g.closePath();
    const grad = g.createLinearGradient(0, -l / 2, 0, l / 2);
    grad.addColorStop(0, '#cfe0b4');
    grad.addColorStop(0.45, '#eef3e2');
    grad.addColorStop(1, '#bccfa2');
    g.fillStyle = grad;
    g.fill();
    // 잎맥
    g.strokeStyle = 'rgba(120,140,96,0.55)';
    g.lineWidth = size * 0.006;
    g.beginPath(); g.moveTo(0, -l / 2 + l * 0.02); g.lineTo(0, l / 2 - l * 0.02); g.stroke();
    g.lineWidth = size * 0.0032;
    for (let i = 1; i < 7; i++) {
      const y = -l / 2 + (i / 7) * l;
      const wid = Math.sin((i / 7) * Math.PI) ** 0.72 * w * 0.82;
      g.beginPath(); g.moveTo(0, y); g.lineTo(wid, y + l * 0.09); g.stroke();
      g.beginPath(); g.moveTo(0, y); g.lineTo(-wid, y + l * 0.09); g.stroke();
    }
    g.restore();
  };

  leafShape(0, 0, h * 0.26, h * 0.82, false);        // 0
  leafShape(h, 0, h * 0.3, h * 0.76, true);          // 1
  leafShape(0, h, h * 0.24, h * 0.54, false);        // 2

  // 3: 침엽 다발
  g.save();
  g.translate(h + h / 2, h + h / 2);
  g.strokeStyle = '#d3e2bb';
  g.lineCap = 'round';
  const rng = makeRng(551);
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI / 2 + (rng() - 0.5) * 1.5;
    const len = h * (0.3 + rng() * 0.17);
    g.lineWidth = size * (0.004 + rng() * 0.004);
    g.beginPath();
    g.moveTo(0, h * 0.34);
    g.quadraticCurveTo(Math.cos(a) * len * 0.4, h * 0.34 + Math.sin(a) * len * 0.5,
      Math.cos(a) * len, h * 0.34 + Math.sin(a) * len);
    g.stroke();
  }
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

let _atlas = null;
export function leafTexture() {
  if (!_atlas) _atlas = leafAtlas();
  return _atlas;
}

/* ------------------------------------------------------------------ */
/* 나무껍질 / 바위 텍스처                                                */
/* ------------------------------------------------------------------ */
function barkHeights(size) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // 세로로 길게 늘어난 섬유 + 굵은 골
      let n = fbm2(u * 26, v * 3.2, 4) * 0.5 + 0.5;
      const groove = Math.abs(Math.sin(u * Math.PI * 9 + fbm2(u * 6, v * 1.6, 3) * 3.4));
      n = n * 0.55 + Math.pow(groove, 0.6) * 0.45;
      // 가로 균열
      const crack = fbm2(u * 7 + 31, v * 22, 3) * 0.5 + 0.5;
      if (crack > 0.74) n *= 0.55;
      h[y * size + x] = n;
    }
  }
  return h;
}

let _bark = null, _barkN = null;
export function barkTextures(size = 256) {
  if (_bark) return { map: _bark, normal: _barkN };
  const h = barkHeights(size);
  const canvas = noiseCanvas(size, (d, s) => {
    for (let i = 0; i < s * s; i++) {
      const n = h[i];
      const base = 118 + n * 96;
      d[i * 4] = base * 1.02;
      d[i * 4 + 1] = base * 0.9;
      d[i * 4 + 2] = base * 0.74;
      d[i * 4 + 3] = 255;
    }
  });
  _bark = new THREE.CanvasTexture(canvas);
  _bark.wrapS = _bark.wrapT = THREE.RepeatWrapping;
  _bark.colorSpace = THREE.SRGBColorSpace;
  _bark.anisotropy = 8;
  _bark.repeat.set(2, 3);
  _barkN = normalMapFromHeights(size, h, 3.2, 1);
  _barkN.repeat.set(2, 3);
  return { map: _bark, normal: _barkN };
}

let _rock = null, _rockN = null;
export function rockTextures(size = 256) {
  if (_rock) return { map: _rock, normal: _rockN };
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 7, v = y / size * 7;
      // 알갱이 + 결
      let n = fbm2(u, v, 5) * 0.5 + 0.5;
      n = n * 0.7 + (fbm2(u * 5.3, v * 5.3, 3) * 0.5 + 0.5) * 0.3;
      h[y * size + x] = n;
    }
  }
  const canvas = noiseCanvas(size, (d, s) => {
    for (let i = 0; i < s * s; i++) {
      const n = h[i];
      const base = 138 + n * 92;
      const warm = 1 + (n - 0.5) * 0.12;
      d[i * 4] = base * warm;
      d[i * 4 + 1] = base * 0.99;
      d[i * 4 + 2] = base * 0.95;
      d[i * 4 + 3] = 255;
    }
  });
  _rock = new THREE.CanvasTexture(canvas);
  _rock.wrapS = _rock.wrapT = THREE.RepeatWrapping;
  _rock.colorSpace = THREE.SRGBColorSpace;
  _rock.anisotropy = 8;
  _rock.repeat.set(1.6, 1.6);
  _rockN = normalMapFromHeights(size, h, 2.6, 1);
  _rockN.repeat.set(1.6, 1.6);
  return { map: _rock, normal: _rockN };
}

/* ------------------------------------------------------------------ */
/* 잎 카드 빌더                                                        */
/* ------------------------------------------------------------------ */
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();

class LeafBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }

  /**
   * 잎 한 장. 법선은 카드 면이 아니라 '수관 바깥 방향'을 쓴다.
   * 그래야 잎이 하나하나 보이면서도 전체가 한 덩어리처럼 부드럽게 빛을 받는다.
   */
  add(px, py, pz, dirX, dirY, dirZ, w, l, cell, roll, color) {
    _u.set(dirX, dirY, dirZ).normalize();
    // 잎 면의 기준축
    _t1.set(-_u.z, 0, _u.x);
    if (_t1.lengthSq() < 1e-5) _t1.set(1, 0, 0);
    _t1.normalize();
    _t2.crossVectors(_u, _t1).normalize();
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // 잎이 살짝 아래로 늘어지게
    const droop = -0.26;
    const ax = _t1.x * cr + _t2.x * sr, ay = _t1.y * cr + _t2.y * sr, az = _t1.z * cr + _t2.z * sr;
    const bx = -_t1.x * sr + _t2.x * cr + _u.x * 0, by = -_t1.y * sr + _t2.y * cr + droop, bz = -_t1.z * sr + _t2.z * cr;
    const base = this.pos.length / 3;
    const cu = (cell % 2) * 0.5, cv = Math.floor(cell / 2) * 0.5;
    const corners = [
      [-0.5, -0.5, cu, cv], [0.5, -0.5, cu + 0.5, cv],
      [-0.5, 0.5, cu, cv + 0.5], [0.5, 0.5, cu + 0.5, cv + 0.5],
    ];
    for (const [sx, sy, u0, v0] of corners) {
      this.pos.push(
        px + ax * sx * w + bx * sy * l,
        py + ay * sx * w + by * sy * l,
        pz + az * sx * w + bz * sy * l);
      this.nrm.push(_u.x, _u.y, _u.z);
      this.uv.push(u0, v0);
      this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

function roughen(geo, amount, rng) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + (rng() - 0.5) * amount,
      p.getY(i) + (rng() - 0.5) * amount, p.getZ(i) + (rng() - 0.5) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 구 표면에 잎을 흩뿌린다 */
function scatterBlobLeaves(lb, rng, cx, cy, cz, r, count, cells, palette, size) {
  for (let i = 0; i < count; i++) {
    // 구 표면 근처(바깥 30%)에 몰아 붙인다 — 속은 어차피 보이지 않는다
    let dx = rng() * 2 - 1, dy = rng() * 2 - 1, dz = rng() * 2 - 1;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const rr = r * (0.7 + rng() * 0.34);
    const color = palette[Math.floor(rng() * palette.length)];
    const s = size * (0.75 + rng() * 0.55);
    lb.add(cx + dx * rr, cy + dy * rr * 0.92, cz + dz * rr,
      dx + (rng() - 0.5) * 0.35, dy * 0.7 + 0.25 + (rng() - 0.5) * 0.3, dz + (rng() - 0.5) * 0.35,
      s, s * 1.35, cells[Math.floor(rng() * cells.length)], rng() * TAU, color);
  }
}

const LEAF_GREENS = [0x8fae5e, 0x7fa050, 0x9cba68, 0x6f9046, 0xa8c074, 0x88a85a];
const LEAF_AUTUMN = [0xc8a24e, 0xb98a42, 0xd0b060];
const PINE_GREENS = [0x5d7f4a, 0x4e7040, 0x6b8a52, 0x456638];
const BIRCH_GREENS = [0xa6c46a, 0x96b85e, 0xb4cf7c, 0x8aa855];

function paletteColors(hexes, warm = 0) {
  const out = [];
  for (const h of hexes) {
    const c = new THREE.Color(h);
    if (warm) c.lerp(new THREE.Color(0xc9a05a), warm);
    out.push(c);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 수종                                                                */
/* ------------------------------------------------------------------ */
function pineTree(rng, leafCount) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const h = 8.5 + rng() * 7;
  const trunk = new THREE.CylinderGeometry(0.06, 0.44, h * 0.88, 8);
  trunk.translate(0, h * 0.44, 0);
  roughen(trunk, 0.05, rng);
  trunkParts.push(tint(trunk, new THREE.Color(0x9a8464), 0.35, rng));

  const layers = 7 + Math.floor(rng() * 4);
  const pal = paletteColors(PINE_GREENS);
  const needles = Math.round(leafCount * 1.25);
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = lerp(2.9, 0.5, t) * (0.85 + rng() * 0.3);
    const ch = lerp(2.6, 1.1, t);
    const y = h * (0.32 + t * 0.64);   // 사람 키 위에서 가지가 시작한다

    // 잔가지 — 잎을 많이 그리는 품질에서만 (저사양에서는 삼각형이 아깝다)
    const twigs = leafCount > 200 ? 2 + Math.floor(rng() * 2) : 0;
    for (let k = 0; k < twigs; k++) {
      const a = rng() * TAU;
      // 원점에서 +X 로 눕힌 뒤 각도만큼 돌리고 높이로 올린다 (순서가 중요)
      const tw = new THREE.CylinderGeometry(0.02, 0.05, r * 1.05, 4);
      tw.rotateZ(Math.PI / 2 - 0.22);
      tw.translate(r * 0.48, 0, 0);
      tw.rotateY(-a);
      tw.translate(0, y, 0);
      trunkParts.push(tint(tw, new THREE.Color(0x8b7358)));
    }

    // 속을 채우는 원뿔은 작게 — 실제 모양은 침엽 다발이 만든다
    const cone = new THREE.ConeGeometry(r * 0.5, ch * 0.8, 7, 1);
    cone.translate((rng() - 0.5) * 0.2, y, (rng() - 0.5) * 0.2);
    roughen(cone, 0.12, rng);
    blobParts.push(tint(cone, new THREE.Color(0x3c5b30), 0.45, rng));

    // 가지를 따라 아래로 늘어지는 침엽 다발
    const n = Math.round(needles / layers);
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU;
      const rad = r * (0.35 + Math.sqrt(rng()) * 0.8);
      const drop = (0.35 - rad / r * 0.55) * ch;
      const s = 0.5 + rng() * 0.4;
      lb.add(Math.cos(a) * rad, y + drop, Math.sin(a) * rad,
        Math.cos(a) * 0.85, -0.42 + rng() * 0.5, Math.sin(a) * 0.85,
        s, s * 1.2, 3, rng() * TAU, pal[Math.floor(rng() * pal.length)]);
    }
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

function broadTree(rng, leafCount, autumn = 0) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const h = 6.8 + rng() * 5.6;
  const trunkH = h * 0.5;
  const trunk = new THREE.CylinderGeometry(0.22, 0.56, trunkH, 9);
  trunk.translate(0, trunkH / 2, 0);
  roughen(trunk, 0.07, rng);
  trunkParts.push(tint(trunk, new THREE.Color(0xa0855f), 0.35, rng));

  // 가지 — 끝 위치를 정확히 계산해 그 자리에 잎을 붙인다
  const branches = 4 + Math.floor(rng() * 3);
  const tips = [];
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * TAU + rng() * 0.5;
    const len = h * (0.3 + rng() * 0.22);
    const tilt = 0.5 + rng() * 0.35;
    const y0 = trunkH * (0.72 + rng() * 0.22);
    const b = new THREE.CylinderGeometry(0.055, 0.16, len, 6);
    b.translate(0, len / 2, 0);
    b.rotateZ(tilt);
    b.rotateY(a);
    b.translate(0, y0, 0);
    trunkParts.push(tint(b, new THREE.Color(0x93795a), 0.3, rng));
    // rotateZ(t) 로 (0,len,0) → (-sin t·len, cos t·len, 0), 이어서 rotateY(a)
    tips.push([
      -Math.sin(tilt) * len * Math.cos(a),
      y0 + Math.cos(tilt) * len,
      Math.sin(tilt) * len * Math.sin(a),
    ]);
  }

  const pal = paletteColors(LEAF_GREENS.concat(autumn > 0.5 ? LEAF_AUTUMN : []), autumn * 0.5);
  // 수관은 가지 끝마다 하나 + 가운데 하나
  const centers = [[0, trunkH * 1.12, 0, 2.6 + rng() * 0.9]];
  for (const [tx, ty, tz] of tips) centers.push([tx, ty, tz, 1.75 + rng() * 0.9]);

  for (const [cx, cy, cz, r] of centers) {
    // 속을 채우는 덩어리는 작게 — 잎 껍질 안쪽에 숨는다
    const s = new THREE.IcosahedronGeometry(r * 0.62, 1);
    roughen(s, r * 0.16, rng);
    s.translate(cx, cy, cz);
    blobParts.push(tint(s, new THREE.Color(0x4e7331), 0.45, rng));
  }
  const per = Math.round(leafCount / centers.length);
  for (const [cx, cy, cz, r] of centers) {
    scatterBlobLeaves(lb, rng, cx, cy, cz, r, per, [0, 1], pal, 0.3);
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

function birchTree(rng, leafCount) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const h = 7.5 + rng() * 4.5;
  const lean = (rng() - 0.5) * 0.12;
  const trunk = new THREE.CylinderGeometry(0.09, 0.2, h * 0.76, 8);
  trunk.translate(0, h * 0.38, 0);
  trunk.rotateZ(lean);
  trunkParts.push(tint(trunk, new THREE.Color(0xd9d6ca), 0.2, rng));
  for (let i = 0; i < 7; i++) {
    const mark = new THREE.BoxGeometry(0.2, 0.03 + rng() * 0.03, 0.05);
    mark.translate(0, h * (0.1 + rng() * 0.58), 0.14);
    mark.rotateY(rng() * TAU);
    trunkParts.push(tint(mark, new THREE.Color(0x38342d)));
  }

  const pal = paletteColors(BIRCH_GREENS);
  const blobs = 3 + Math.floor(rng() * 3);
  const centers = [];
  for (let i = 0; i < blobs; i++) {
    const r = 1.7 + rng() * 1.3;
    const a = (i / blobs) * TAU + rng();
    const cx = Math.cos(a) * (i ? 1.3 : 0), cz = Math.sin(a) * (i ? 1.3 : 0);
    const cy = h * (0.66 + rng() * 0.2);
    centers.push([cx, cy, cz, r]);
    const s = new THREE.IcosahedronGeometry(r * 0.62, 1);
    roughen(s, r * 0.18, rng);
    s.translate(cx, cy, cz);
    blobParts.push(tint(s, new THREE.Color(0x6f8c39), 0.45, rng));
  }
  const per = Math.round(leafCount / centers.length);
  for (const [cx, cy, cz, r] of centers) {
    scatterBlobLeaves(lb, rng, cx, cy, cz, r, per, [2, 2, 0], pal, 0.2);
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

function bushGeometry(rng, leafCount) {
  const blobParts = [];
  const lb = new LeafBuilder();
  const pal = paletteColors(LEAF_GREENS);
  const blobs = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.5 + rng() * 0.55;
    const cx = (rng() - 0.5) * 0.8, cz = (rng() - 0.5) * 0.8, cy = r * 0.8 + rng() * 0.2;
    const s = new THREE.IcosahedronGeometry(r * 0.8, 1);
    roughen(s, r * 0.28, rng);
    s.translate(cx, cy, cz);
    blobParts.push(tint(s, new THREE.Color(0x3f6129), 0.5, rng));
    scatterBlobLeaves(lb, rng, cx, cy, cz, r, Math.round(leafCount / blobs), [0, 1, 2], pal, 0.17);
  }
  return { blob: mergeGeos(blobParts), leaves: lb.pos.length ? lb.geometry() : null };
}

function rockGeometry(rng) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = 0.7 + fbm2(p.getX(i) * 1.6 + 3, p.getZ(i) * 1.6 - 2, 3) * 1.6;
    p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.72, p.getZ(i) * n);
  }
  roughen(g, 0.06, rng);
  return tint(g, new THREE.Color(0xb4b0a7), 0.3, rng);
}

function logGeometry(rng) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.26, 0.32, 4.2, 9);
  trunk.rotateZ(Math.PI / 2);
  roughen(trunk, 0.07, rng);
  parts.push(tint(trunk, new THREE.Color(0xa1865f), 0.35, rng));
  for (let i = 0; i < 3; i++) {
    const b = new THREE.CylinderGeometry(0.05, 0.08, 0.8, 5);
    b.rotateZ(rng() * 1.2 - 0.6);
    b.translate((rng() - 0.5) * 3, 0.35, (rng() - 0.5) * 0.5);
    parts.push(tint(b, new THREE.Color(0x93795a)));
  }
  const moss = new THREE.CylinderGeometry(0.29, 0.29, 1.6, 9, 1, true, 0, Math.PI);
  moss.rotateZ(Math.PI / 2);
  moss.translate((rng() - 0.5) * 1.5, 0.02, 0);
  parts.push(tint(moss, new THREE.Color(0x6f9a48), 0.4, rng));
  return mergeGeos(parts);
}

/* ------------------------------------------------------------------ */
/* 숲                                                                  */
/* ------------------------------------------------------------------ */
const QUALITY = {
  low: { step: 10, leaves: 130, nearTrees: 14, leafDist: 17, variants: 2, bushLeaves: 10 },
  medium: { step: 8, leaves: 230, nearTrees: 38, leafDist: 36, variants: 2, bushLeaves: 20 },
  high: { step: 7, leaves: 380, nearTrees: 70, leafDist: 52, variants: 3, bushLeaves: 34 },
  ultra: { step: 6, leaves: 760, nearTrees: 120, leafDist: 70, variants: 3, bushLeaves: 60 },
};

export class Forest {
  constructor(scene, quality = 'high', seed = 20260914) {
    const q = QUALITY[quality] || QUALITY.high;
    this.q = q;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'forest';
    scene.add(this.group);

    const rng = makeRng(seed);
    this.rng = rng;

    const bark = barkTextures();
    const rock = rockTextures();
    this.barkMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0,
      map: bark.map, normalMap: bark.normal, normalScale: new THREE.Vector2(1.1, 1.1),
    });
    this.birchMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.78, metalness: 0,
      normalMap: bark.normal, normalScale: new THREE.Vector2(0.35, 0.35),
    });
    this.blobMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), 0.5);
    this.rockMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.9, metalness: 0.02,
      map: rock.map, normalMap: rock.normal, normalScale: new THREE.Vector2(1, 1),
    });
    this.leafMat = q.leaves > 0 ? windify(new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: leafTexture(),
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0,
      emissive: new THREE.Color(0x16240f),
      emissiveIntensity: 0.55,
      alphaToCoverage: true,
    }), 0.85, { translucency: 1.0 }) : null;

    this._place(rng, q);
    this._build(rng, q);

    this._lodCenter = new THREE.Vector3(1e9, 0, 1e9);
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._qt = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  /** 지형 조건에 따라 나무·덤불·바위·통나무 위치를 정한다 */
  _place(rng, q) {
    const trees = [], bushes = [], rocks = [], logs = [];
    const R = INNER_HALF - 10;
    for (let z = -R; z < R; z += q.step) {
      for (let x = -R; x < R; x += q.step) {
        const px = x + (rng() - 0.5) * q.step * 0.95;
        const pz = z + (rng() - 0.5) * q.step * 0.95;
        if (Math.hypot(px, pz) > R) continue;
        const { h, slope } = sampleGround(px, pz);
        const fert = fertilityAt(px, pz, h, slope);
        if (fert <= 0.05) continue;
        if (Math.hypot(px - LAKE.x, pz - LAKE.z) - LAKE.r < 3) continue;

        const forestNoise = fbm2(px * 0.0045 + 5.5, pz * 0.0045 - 2.2, 3) * 0.5 + 0.5;
        let density = clamp01((forestNoise - 0.32) * 2.1) * fert;
        density *= smoothstep(clamp01((Math.hypot(px, pz - 26) - 14) / 22));   // 스폰 주변은 트인 초원
        if (slope > 0.34) density *= 0.25;

        const roll = rng();
        if (roll < density * 0.5) {
          // 침엽수는 높은 곳, 자작나무는 중간, 활엽수는 어디든
          let sp;
          const r2 = rng();
          if (h > 26 && r2 < 0.62) sp = 0;
          else if (r2 < 0.42) sp = 0;
          else if (r2 < 0.8) sp = 1;
          else sp = 2;
          trees.push([px, pz, h, rng() * TAU, 0.78 + rng() * 0.5, sp, rng()]);
        } else if (roll < density * 0.5 + 0.09) {
          bushes.push([px, pz, h, rng() * TAU, 0.6 + rng() * 0.8, 0, rng()]);
        } else if (roll < density * 0.5 + 0.12 && (slope > 0.12 || rng() < 0.4)) {
          rocks.push([px, pz, h, rng() * TAU, 0.35 + Math.pow(rng(), 2.2) * 3.4, 0, rng()]);
        } else if (roll < density * 0.5 + 0.127 && density > 0.25) {
          logs.push([px, pz, h, rng() * TAU, 0.7 + rng() * 0.6, 0, rng()]);
        }
      }
    }
    this.trees = trees;
    this.bushes = bushes;
    this.rocks = rocks;
    this.logs = logs;
    this.treeCount = trees.length;
  }

  _staticInstanced(geo, mat, list, shadow, yOff = 0, tiltFromGround = false, jitter = 0) {
    if (!list.length || !geo) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = shadow;
    im.receiveShadow = true;
    if (jitter > 0) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), qt = new THREE.Quaternion(),
      s = new THREE.Vector3(), e = new THREE.Euler(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Quaternion();
    for (let i = 0; i < list.length; i++) {
      const [x, z, h, ry, sc] = list[i];
      if (tiltFromGround) {
        qt.setFromUnitVectors(up, normalAt(x, z, 1.2));
        qt.multiply(tmp.setFromEuler(e.set(0, ry, 0)));
      } else qt.setFromEuler(e.set(0, ry, 0));
      m.compose(p.set(x, h + yOff, z), qt, s.set(sc, sc, sc));
      im.setMatrixAt(i, m);
      if (jitter > 0) {
        const b = 1 + (this.rng() - 0.5) * jitter;
        im.instanceColor.setXYZ(i, b * (1 + (this.rng() - 0.5) * jitter * 0.5), b, b * (1 - (this.rng() - 0.5) * jitter * 0.6));
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    this.group.add(im);
    return im;
  }

  _build(rng, q) {
    const makers = [
      (r) => pineTree(r, q.leaves * 0.75),
      (r) => broadTree(r, q.leaves, r() < 0.18 ? 1 : 0),
      (r) => birchTree(r, q.leaves * 0.8),
    ];

    // 수종 × 변형별로 나무를 나눠 담는다
    this.variants = [];
    const buckets = [];
    for (let sp = 0; sp < 3; sp++) {
      for (let v = 0; v < q.variants; v++) buckets.push([]);
    }
    for (const t of this.trees) {
      const sp = t[5];
      const v = Math.floor(t[6] * q.variants) % q.variants;
      buckets[sp * q.variants + v].push(t);
    }

    for (let sp = 0; sp < 3; sp++) {
      for (let v = 0; v < q.variants; v++) {
        const list = buckets[sp * q.variants + v];
        if (!list.length) continue;
        const built = makers[sp](rng);
        this._staticInstanced(built.trunk, sp === 2 ? this.birchMat : this.barkMat, list, true, -0.2, false, 0.18);
        const blob = this._staticInstanced(built.blob, this.blobMat, list, true, -0.2, false, 0.42);
        if (blob) blob.name = `canopy-${sp}-${v}`;
        const variant = { list, blob, leafGeo: built.leaves, near: null, farCount: list.length };
        if (built.leaves && q.nearTrees > 0) {
          const cap = Math.max(6, Math.round(q.nearTrees / (3 * q.variants)) + 4);
          const near = new THREE.InstancedMesh(built.leaves, this.leafMat, cap);
          near.name = `leaves-near-${sp}-${v}`;
          near.castShadow = true;
          near.receiveShadow = true;
          near.frustumCulled = false;
          near.count = 0;
          near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
          this.group.add(near);
          variant.near = near;
          variant.cap = cap;
        }
        this.variants.push(variant);
      }
    }

    // 덤불 — 가까운 것에는 잎을 단다
    this.bushVariants = [];
    for (let v = 0; v < 3; v++) {
      const list = this.bushes.filter((_, i) => i % 3 === v);
      if (!list.length) continue;
      const built = bushGeometry(rng, q.bushLeaves);
      const blob = this._staticInstanced(built.blob, this.blobMat, list, true, -0.15, false, 0.4);
      const variant = { list, blob, leafGeo: built.leaves, near: null };
      if (built.leaves && q.nearTrees > 0) {
        const cap = 26;
        const near = new THREE.InstancedMesh(built.leaves, this.leafMat, cap);
        near.name = `bush-leaves-${v}`;
        near.castShadow = false;
        near.receiveShadow = true;
        near.frustumCulled = false;
        near.count = 0;
        this.group.add(near);
        variant.near = near;
        variant.cap = cap;
      }
      this.bushVariants.push(variant);
    }

    for (let v = 0; v < 4; v++) {
      const list = this.rocks.filter((_, i) => i % 4 === v);
      this._staticInstanced(rockGeometry(rng), this.rockMat, list, true, -0.25, true, 0.3);
    }
    for (let v = 0; v < 2; v++) {
      const list = this.logs.filter((_, i) => i % 2 === v);
      this._staticInstanced(logGeometry(rng), this.barkMat, list, true, 0.25, true, 0.2);
    }
  }

  /** 플레이어가 8 m 넘게 움직이면 가까운 나무의 잎을 다시 고른다 */
  updateLOD(px, pz, force = false) {
    if (!this.q.nearTrees) return;
    if (!force && Math.hypot(px - this._lodCenter.x, pz - this._lodCenter.z) < 8) return;
    this._lodCenter.set(px, 0, pz);
    const R2 = this.q.leafDist * this.q.leafDist;

    const fill = (variant, tilt = false) => {
      const near = variant.near;
      if (!near) return;
      let n = 0;
      const cap = variant.cap;
      for (const item of variant.list) {
        if (n >= cap) break;
        const [x, z, h, ry, sc] = item;
        const dx = x - px, dz = z - pz;
        if (dx * dx + dz * dz > R2) continue;
        this._qt.setFromEuler(this._e.set(0, ry, 0));
        this._m.compose(this._p.set(x, h + (tilt ? -0.15 : -0.2), z), this._qt, this._s.set(sc, sc, sc));
        near.setMatrixAt(n, this._m);
        if (near.instanceColor) {
          const b = 0.86 + (item[6] || 0) * 0.3;
          near.instanceColor.setXYZ(n, b * 1.02, b, b * 0.94);
        }
        n++;
      }
      near.count = n;
      near.instanceMatrix.needsUpdate = true;
      if (near.instanceColor) near.instanceColor.needsUpdate = true;
    };

    for (const v of this.variants) fill(v);
    for (const v of this.bushVariants) fill(v, true);
  }

  /** 새가 앉을 나뭇가지 후보 (x, z, 높이) */
  get perchTrees() { return this.trees; }
}

/* ------------------------------------------------------------------ */
/* 흩날리는 잎                                                          */
/* ------------------------------------------------------------------ */
export class FallingLeaves {
  constructor(scene, count = 90) {
    const geo = new THREE.PlaneGeometry(0.22, 0.3);
    // 아틀라스의 넓은 잎 칸만 쓴다
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
    const mat = new THREE.MeshStandardMaterial({
      map: leafTexture(), alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.8, metalness: 0,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'falling-leaves';
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    this.mesh.castShadow = false;
    scene.add(this.mesh);

    const rng = makeRng(8931);
    this.items = [];
    const pal = paletteColors(LEAF_GREENS.concat(LEAF_AUTUMN, LEAF_AUTUMN));
    for (let i = 0; i < count; i++) {
      this.items.push({
        x: (rng() - 0.5) * 60, y: rng() * 14, z: (rng() - 0.5) * 60,
        fall: 0.5 + rng() * 0.9, spin: (rng() - 0.5) * 2.4, phase: rng() * TAU,
        sway: 0.5 + rng() * 1.2, scale: 0.7 + rng() * 0.8,
        color: pal[Math.floor(rng() * pal.length)],
      });
      const c = this.items[i].color;
      this.mesh.instanceColor.setXYZ(i, c.r, c.g, c.b);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.rng = rng;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.t = 0;
  }

  update(dt, px, pz, density = 1, windX = 0, windZ = 0, windStrength = 0.5, eyeY = null) {
    this.t += dt;
    const active = Math.round(this.items.length * clamp01(density));
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      // 눈앞을 가리는 잎은 그리지 않는다 (한 장이 화면을 덮어버린다)
      const near = eyeY !== null
        && Math.hypot(it.x - px, it.z - pz) < 1.6
        && Math.abs(it.y - eyeY) < 1.4;
      if (i >= active || near) {
        this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      it.y -= it.fall * dt * (0.6 + windStrength * 0.5);
      it.x += (windX * windStrength * 1.6 + Math.sin(this.t * it.sway + it.phase) * 0.6) * dt;
      it.z += (windZ * windStrength * 1.6 + Math.cos(this.t * it.sway * 0.8 + it.phase) * 0.6) * dt;
      // 플레이어 주변 60 m 상자 안에서 순환
      let rx = it.x - px, rz = it.z - pz;
      if (rx > 30) it.x -= 60; else if (rx < -30) it.x += 60;
      if (rz > 30) it.z -= 60; else if (rz < -30) it.z += 60;
      const ground = heightAt(it.x, it.z);
      if (it.y < ground) { it.y = ground + 9 + this.rng() * 7; }

      this._e.set(this.t * it.spin, this.t * it.spin * 0.7 + it.phase, Math.sin(this.t * it.sway) * 0.6);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(it.x, it.y, it.z), this._q, this._s.setScalar(it.scale));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
