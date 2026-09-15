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

/**
 * 잎 한 장을 '진짜 모형'으로 만든다.
 * 납작한 카드가 아니라 주맥을 따라 접히고(단면이 V자), 끝으로 갈수록
 * 아래로 휘며, 윤곽 자체가 잎 모양이다. 옆에서 봐도 종이처럼 보이지 않는다.
 */
const LEAF_SEGS = 3;

class LeafBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; this.out = []; }

  /**
   * px,py,pz : 잎자루가 붙는 자리
   * dir      : 잎이 뻗어 나가는 방향(수관 바깥)
   * w, l     : 폭과 길이
   * cell     : 잎 텍스처 아틀라스 칸
   * roll     : 잎면이 도는 각
   */
  add(px, py, pz, dirX, dirY, dirZ, w, l, cell, roll, color, curl = 0.28, crease = 0.2, segs = LEAF_SEGS) {
    _u.set(dirX, dirY, dirZ).normalize();           // 잎이 뻗는 방향
    _t1.set(-_u.z, 0, _u.x);
    if (_t1.lengthSq() < 1e-5) _t1.set(1, 0, 0);
    _t1.normalize();
    _t2.crossVectors(_u, _t1).normalize();
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // 잎면의 가로축(폭)과 면 법선축
    const sx = _t1.x * cr + _t2.x * sr, sy = _t1.y * cr + _t2.y * sr, sz = _t1.z * cr + _t2.z * sr;
    const nx = -_t1.x * sr + _t2.x * cr, ny = -_t1.y * sr + _t2.y * cr, nz = -_t1.z * sr + _t2.z * cr;

    const base = this.pos.length / 3;
    const cu = (cell % 2) * 0.5, cv = Math.floor(cell / 2) * 0.5;

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // 잎 윤곽 — 밑동은 좁고 3할 지점이 가장 넓으며 끝은 뾰족하다
      const prof = Math.sin(Math.PI * clamp01(0.08 + t * 0.9)) ** 0.75 * (1 - t * 0.12);
      const halfW = w * prof;
      const along = l * t;
      const drop = -curl * l * t * t;              // 끝으로 갈수록 처진다
      const lift = crease * halfW;                 // 주맥이 솟아 V자 단면
      for (const side of [-1, 0, 1]) {
        const wx = halfW * side;
        const up = side === 0 ? lift : 0;
        this.pos.push(
          px + _u.x * along + sx * wx + nx * up,
          py + _u.y * along + sy * wx + ny * up + drop,
          pz + _u.z * along + sz * wx + nz * up);
        this.uv.push(cu + (0.17 + (side * 0.5 + 0.5) * 0.66) * 0.5, cv + (0.14 + t * 0.72) * 0.5);
        this.col.push(color.r, color.g, color.b);
        this.out.push(_u.x, _u.y, _u.z);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 3;
      // 왼쪽 반 + 오른쪽 반
      this.idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      this.idx.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // 실제 면 법선과 '수관 바깥 방향'을 섞는다 — 잎 한 장의 입체감은 살리되
    // 수관 전체는 한 덩어리처럼 부드럽게 빛을 받는다
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) {
      const ox = this.out[i * 3], oy = this.out[i * 3 + 1], oz = this.out[i * 3 + 2];
      const mx = n.getX(i) * 0.65 + ox * 0.35;
      const my = n.getY(i) * 0.65 + oy * 0.35;
      const mz = n.getZ(i) * 0.65 + oz * 0.35;
      const len = Math.hypot(mx, my, mz) || 1;
      n.setXYZ(i, mx / len, my / len, mz / len);
    }
    return g;
  }
}

/** 침엽 다발 — 얇은 판 세 장을 엇갈려 세워 어느 각도에서도 부피가 있다 */
function needleCluster(lb, px, py, pz, dirX, dirY, dirZ, w, l, color, rng) {
  for (let k = 0; k < 2; k++) {
    lb.add(px, py, pz, dirX, dirY, dirZ, w, l, 3, k * 1.15 + rng() * 0.3, color, 0.16, 0.05, 2);
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

/* ------------------------------------------------------------------ */
/* 가지                                                                */
/* ------------------------------------------------------------------ */
const _bv = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bup = new THREE.Vector3(0, 1, 0);

/** 두 점을 잇는 원뿔대 — 가지 한 마디 */
function limb(p0, dir, len, r0, r1, sides) {
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  _bq.setFromUnitVectors(_bup, _bv.copy(dir).normalize());
  g.applyQuaternion(_bq);
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

/**
 * 재귀로 뻗는 가지.
 * 끝마디의 위치와 방향을 모아 돌려주므로, 잎을 '가지 끝'에 달 수 있다.
 */
function growBranches(rng, opts) {
  const {
    origin, dir, length, radius, depth, children = 3,
    spread = 0.7, droop = 0.1, shrink = 0.68, lenShrink = 0.72,
    sides = 5, geos, tips, curve = 0.15,
  } = opts;

  const end = new THREE.Vector3().copy(origin).addScaledVector(dir, length);
  geos.push(limb(origin, dir, length, radius, radius * shrink, sides));

  if (depth <= 0 || radius < 0.012) {
    tips.push({ pos: end, dir: new THREE.Vector3().copy(dir), r: radius * shrink });
    return;
  }

  const n = Math.max(2, Math.round(children * (0.7 + rng() * 0.6)));
  // 가지 끝에서 갈라지는 축
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  if (side.lengthSq() < 1e-5) side.set(1, 0, 0);
  side.normalize();
  const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();

  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.9;
    const sp = spread * (0.6 + rng() * 0.8);
    const nd = new THREE.Vector3()
      .copy(dir)
      .addScaledVector(side, Math.cos(a) * sp)
      .addScaledVector(side2, Math.sin(a) * sp);
    nd.y -= droop * (0.5 + rng());               // 끝으로 갈수록 처진다
    nd.y += curve * 0.5;                          // 그래도 빛을 향해 조금 든다
    nd.normalize();
    growBranches(rng, {
      ...opts,
      origin: end,
      dir: nd,
      length: length * lenShrink * (0.8 + rng() * 0.4),
      radius: radius * shrink,
      depth: depth - 1,
      children: Math.max(2, children - 1),
      sides: Math.max(4, sides - 1),
    });
  }
}

/**
 * 먼 거리용 수관 덩어리 — 가지 끝을 몇 무리로 묶어 큰 공 몇 개로 만든다.
 * (끝가지마다 공을 만들면 멀리 있는 나무까지 삼각형을 낭비한다)
 */
function blobsFromTips(tips, groups, rng, color, pad = 1.35) {
  const out = [];
  if (!tips.length) return out;
  const buckets = Array.from({ length: groups }, () => []);
  for (const t of tips) {
    // 줄기를 중심으로 한 방위각으로 무리를 나눈다
    const a = Math.atan2(t.pos.z, t.pos.x) + Math.PI;
    buckets[Math.min(groups - 1, Math.floor((a / TAU) * groups))].push(t);
  }
  for (const b of buckets) {
    if (!b.length) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const t of b) { cx += t.pos.x; cy += t.pos.y; cz += t.pos.z; }
    cx /= b.length; cy /= b.length; cz /= b.length;
    let r = 0.5;
    for (const t of b) r = Math.max(r, Math.hypot(t.pos.x - cx, t.pos.y - cy, t.pos.z - cz));
    const g = new THREE.IcosahedronGeometry(r * pad * 0.62, 1);
    roughen(g, r * 0.16, rng);
    g.translate(cx, cy, cz);
    out.push(tint(g, color, 0.42, rng));
  }
  return out;
}

/** 가지 끝 둘레에 잎을 단다 */
function leavesAtTip(lb, rng, tip, count, cells, palette, size, spread = 0.35, along = 0.9) {
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const up = rng() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - up * up));
    const dx = Math.cos(a) * r, dy = up, dz = Math.sin(a) * r;
    const d = Math.sqrt(rng()) * spread;
    // 마지막 가지 마디를 따라 늘어서게
    const t = (rng() - 0.72) * along;
    const px = tip.pos.x + dx * d + tip.dir.x * t;
    const py = tip.pos.y + dy * d * 0.8 + tip.dir.y * t;
    const pz = tip.pos.z + dz * d + tip.dir.z * t;
    const s = size * (0.8 + rng() * 0.5);
    // 잎은 가지 끝에서 바깥·아래로 퍼진다
    lb.add(px, py, pz,
      dx * 0.8 + tip.dir.x * 0.5, dy * 0.5 - 0.25 + tip.dir.y * 0.4, dz * 0.8 + tip.dir.z * 0.5,
      s, s * 1.5, cells[Math.floor(rng() * cells.length)], rng() * TAU,
      palette[Math.floor(rng() * palette.length)]);
  }
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
  const trunk = new THREE.CylinderGeometry(0.06, 0.44, h * 0.9, 8, 1, true);
  trunk.translate(0, h * 0.45, 0);
  roughen(trunk, 0.04, rng);
  trunkParts.push(tint(trunk, new THREE.Color(0x9a8464), 0.35, rng));

  const layers = 7 + Math.floor(rng() * 4);
  const pal = paletteColors(PINE_GREENS);
  const needles = Math.round(leafCount * 0.34);
  const perLayer = Math.max(3, Math.round(needles / layers / 3));   // 다발 하나가 판 세 장
  const origin = new THREE.Vector3();

  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = lerp(2.8, 0.5, t) * (0.85 + rng() * 0.3);
    const y = h * (0.3 + t * 0.66);
    // 층마다 돌려 나는 가지 — 바깥으로 뻗으며 살짝 처진다
    const arms = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < arms; k++) {
      const a = (k / arms) * TAU + i * 0.8 + rng() * 0.3;
      const dir = new THREE.Vector3(Math.cos(a), -0.2 - rng() * 0.2, Math.sin(a)).normalize();
      origin.set(0, y, 0);
      const g = limb(origin, dir, r, 0.045 * (1 - t * 0.6) + 0.015, 0.012, 4);
      trunkParts.push(tint(g, new THREE.Color(0x8b7358), 0.3, rng));

      // 가지를 따라 침엽 다발
      const along = Math.max(2, Math.round(perLayer / arms) + 2);
      for (let m = 0; m < along; m++) {
        const f = 0.25 + (m / along) * 0.8;
        const px = dir.x * r * f, py = y + dir.y * r * f, pz = dir.z * r * f;
        const s = (0.34 + rng() * 0.2) * (1 - t * 0.3);
        needleCluster(lb, px, py, pz,
          dir.x * 0.7 + (rng() - 0.5) * 0.5, -0.35 + rng() * 0.4, dir.z * 0.7 + (rng() - 0.5) * 0.5,
          s * 0.5, s * 1.6, pal[Math.floor(rng() * pal.length)], rng);
      }
    }
    // 먼 거리용 원뿔
    const cone = new THREE.ConeGeometry(r * 0.62, lerp(2.4, 1.0, t), 7, 1, true);
    cone.translate((rng() - 0.5) * 0.15, y + 0.2, (rng() - 0.5) * 0.15);
    roughen(cone, 0.1, rng);
    blobParts.push(tint(cone, new THREE.Color(0x3c5b30), 0.42, rng));
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

function broadTree(rng, leafCount, autumn = 0, depth = 3) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const h = 6.8 + rng() * 5.6;
  const trunkH = h * 0.42;
  const trunk = new THREE.CylinderGeometry(0.2, 0.52, trunkH, 9, 1, true);
  trunk.translate(0, trunkH / 2, 0);
  roughen(trunk, 0.06, rng);
  trunkParts.push(tint(trunk, new THREE.Color(0xa0855f), 0.35, rng));

  // 줄기 위에서 갈라지는 가지 — 두 번 더 갈라져 끝가지가 15~30개 생긴다
  const tips = [];
  const branchGeos = [];
  const primaries = 4 + Math.floor(rng() * 3);
  const start = new THREE.Vector3(0, trunkH * 0.92, 0);
  for (let i = 0; i < primaries; i++) {
    const a = (i / primaries) * TAU + rng() * 0.7;
    const tilt = 0.55 + rng() * 0.35;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    growBranches(rng, {
      origin: start, dir, length: h * (0.22 + rng() * 0.1), radius: 0.13 + rng() * 0.05,
      depth, children: 3, spread: 0.58, droop: 0.16, shrink: 0.7, lenShrink: 0.66,
      sides: 5, geos: branchGeos, tips, curve: 0.2,
    });
  }
  for (const g of branchGeos) trunkParts.push(tint(g, new THREE.Color(0x93795a), 0.3, rng));

  const pal = paletteColors(LEAF_GREENS.concat(autumn > 0.5 ? LEAF_AUTUMN : []), autumn * 0.5);
  const per = Math.max(2, Math.round(leafCount / Math.max(1, tips.length)));
  for (const tip of tips) leavesAtTip(lb, rng, tip, per, [0, 1], pal, 0.25, 0.32, 1.1);
  blobParts.push(...blobsFromTips(tips, 4, rng, new THREE.Color(0x4e7331), 1.28));

  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

function birchTree(rng, leafCount, depth = 3) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const h = 7.5 + rng() * 4.5;
  const trunkH = h * 0.55;
  const lean = (rng() - 0.5) * 0.1;
  const trunk = new THREE.CylinderGeometry(0.1, 0.19, trunkH, 8, 1, true);
  trunk.translate(0, trunkH / 2, 0);
  trunk.rotateZ(lean);
  trunkParts.push(tint(trunk, new THREE.Color(0xd9d6ca), 0.2, rng));
  for (let i = 0; i < 7; i++) {
    const mark = new THREE.BoxGeometry(0.18, 0.03 + rng() * 0.03, 0.05);
    mark.translate(0, trunkH * (0.1 + rng() * 0.85), 0.12);
    mark.rotateY(rng() * TAU);
    trunkParts.push(tint(mark, new THREE.Color(0x38342d)));
  }

  const tips = [], branchGeos = [];
  const primaries = 4 + Math.floor(rng() * 3);
  const start = new THREE.Vector3(0, trunkH * 0.86, 0);
  for (let i = 0; i < primaries; i++) {
    const a = (i / primaries) * TAU + rng() * 0.6;
    const tilt = 0.42 + rng() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    growBranches(rng, {
      origin: start, dir, length: h * (0.18 + rng() * 0.08), radius: 0.07 + rng() * 0.03,
      depth, children: 3, spread: 0.46, droop: 0.32, shrink: 0.66, lenShrink: 0.7,
      sides: 4, geos: branchGeos, tips, curve: 0.05,
    });
  }
  for (const g of branchGeos) trunkParts.push(tint(g, new THREE.Color(0xc9c5b6), 0.25, rng));

  const pal = paletteColors(BIRCH_GREENS);
  const per = Math.max(2, Math.round(leafCount / Math.max(1, tips.length)));
  for (const tip of tips) leavesAtTip(lb, rng, tip, per, [2, 2, 0], pal, 0.17, 0.28, 1.0);
  blobParts.push(...blobsFromTips(tips, 3, rng, new THREE.Color(0x6f8c39), 1.25));

  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

/** 어린 나무 — 가는 줄기에 잎덩이 두어 개 */
function sapling(rng, leafCount) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const h = 1.5 + rng() * 1.6;
  const conifer = rng() < 0.45;
  const trunk = new THREE.CylinderGeometry(0.03, 0.07, h * 0.9, 5);
  trunk.translate(0, h * 0.45, 0);
  trunkParts.push(tint(trunk, new THREE.Color(0x8d7454), 0.3, rng));

  const pal = paletteColors(conifer ? PINE_GREENS : LEAF_GREENS);
  if (conifer) {
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      const cone = new THREE.ConeGeometry(lerp(0.5, 0.18, t), 0.7, 6);
      cone.translate(0, h * (0.35 + t * 0.55), 0);
      blobParts.push(tint(cone, new THREE.Color(0x3c5b30), 0.4, rng));
      scatterBlobLeaves(lb, rng, 0, h * (0.35 + t * 0.55), 0, lerp(0.5, 0.2, t),
        Math.round(leafCount / 3), [3], pal, 0.26);
    }
  } else {
    for (let i = 0; i < 2; i++) {
      const r = 0.42 + rng() * 0.3;
      const cy = h * (0.62 + i * 0.26);
      const b = new THREE.IcosahedronGeometry(r * 0.66, 1);
      b.translate((rng() - 0.5) * 0.3, cy, (rng() - 0.5) * 0.3);
      blobParts.push(tint(b, new THREE.Color(0x4e7331), 0.4, rng));
      scatterBlobLeaves(lb, rng, 0, cy, 0, r, Math.round(leafCount / 2), [0, 1, 2], pal, 0.2);
    }
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    leaves: lb.pos.length ? lb.geometry() : null,
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
    const s = new THREE.IcosahedronGeometry(r * 0.62, 1);
    roughen(s, r * 0.2, rng);
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
    p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.88, p.getZ(i) * n);
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
  low: { step: 9.5, leaves: 480, nearTrees: 5, leafDist: 13, variants: 2, bushLeaves: 16, saplings: 0.35, branchDepth: 2 },
  medium: { step: 7.2, leaves: 1100, nearTrees: 10, leafDist: 20, variants: 2, bushLeaves: 32, saplings: 0.7, branchDepth: 2 },
  high: { step: 6.2, leaves: 2000, nearTrees: 15, leafDist: 26, variants: 3, bushLeaves: 55, saplings: 1, branchDepth: 3 },
  ultra: { step: 5.4, leaves: 3400, nearTrees: 26, leafDist: 36, variants: 3, bushLeaves: 100, saplings: 1.3, branchDepth: 3 },
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
      alphaTest: 0.3,
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
    const trees = [], bushes = [], rocks = [], logs = [], saplings = [];
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
        } else if (roll < density * 0.5 + 0.14) {
          bushes.push([px, pz, h, rng() * TAU, 0.6 + rng() * 0.85, 0, rng()]);
        } else if (roll < density * 0.5 + 0.14 + 0.09 * q.saplings && density > 0.12) {
          // 어린 나무 — 큰 나무 사이를 메워 숲에 층이 생긴다
          saplings.push([px, pz, h, rng() * TAU, 0.5 + rng() * 0.7, 0, rng()]);
        } else if (roll < density * 0.5 + 0.145 + 0.09 * q.saplings
            && (slope > 0.12 || rng() < 0.35)) {
          rocks.push([px, pz, h, rng() * TAU, 0.3 + Math.pow(rng(), 2.4) * 2.3, 0, rng()]);
        } else if (roll < density * 0.5 + 0.152 + 0.09 * q.saplings && density > 0.25) {
          logs.push([px, pz, h, rng() * TAU, 0.7 + rng() * 0.6, 0, rng()]);
        }
      }
    }
    this.trees = trees;
    this.saplings = saplings;
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
        let c = list[i][7];
        if (!c) {
          const b = 1 + (this.rng() - 0.5) * jitter;
          c = [b * (1 + (this.rng() - 0.5) * jitter * 0.5), b, b * (1 - (this.rng() - 0.5) * jitter * 0.6)];
          list[i][7] = c;
        }
        im.instanceColor.setXYZ(i, c[0], c[1], c[2]);
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    this.group.add(im);
    return im;
  }

  _build(rng, q) {
    const depth = q.branchDepth ?? 3;
    const makers = [
      (r) => pineTree(r, q.leaves * 0.75),
      (r) => broadTree(r, q.leaves, r() < 0.18 ? 1 : 0, depth),
      (r) => birchTree(r, q.leaves * 0.8, depth),
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

    // 어린 나무
    this.saplingVariants = [];
    if (q.saplings > 0 && this.saplings.length) {
      for (let v = 0; v < 2; v++) {
        const list = this.saplings.filter((_, i) => i % 2 === v);
        if (!list.length) continue;
        const built = sapling(rng, Math.round(q.leaves * 0.12));
        this._staticInstanced(built.trunk, this.barkMat, list, false, -0.1, false, 0.2);
        const blob = this._staticInstanced(built.blob, this.blobMat, list, true, -0.1, false, 0.4);
        if (blob) blob.name = `sapling-${v}`;
        const variant = { list, blob, leafGeo: built.leaves, near: null };
        if (built.leaves && q.nearTrees > 0) {
          const cap = 20;
          const near = new THREE.InstancedMesh(built.leaves, this.leafMat, cap);
          near.name = `sapling-leaves-${v}`;
          near.castShadow = false;
          near.receiveShadow = true;
          near.frustumCulled = false;
          near.count = 0;
          this.group.add(near);
          variant.near = near;
          variant.cap = cap;
        }
        this.saplingVariants.push(variant);
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
      const blob = variant.blob;
      const cap = variant.cap || 0;
      const yOff = tilt ? -0.15 : -0.2;
      let n = 0, far = 0;
      for (const item of variant.list) {
        const [x, z, h, ry, sc] = item;
        const dx = x - px, dz = z - pz;
        const isNear = near && n < cap && dx * dx + dz * dz <= R2;
        this._qt.setFromEuler(this._e.set(0, ry, 0));
        this._m.compose(this._p.set(x, h + yOff, z), this._qt, this._s.set(sc, sc, sc));
        if (isNear) {
          // 가까운 나무 — 잎을 한 장씩
          near.setMatrixAt(n, this._m);
          if (near.instanceColor) {
            const b = 0.86 + (item[6] || 0) * 0.3;
            near.instanceColor.setXYZ(n, b * 1.02, b, b * 0.94);
          }
          n++;
        } else if (blob) {
          // 먼 나무 — 덩어리로. 가까운 나무의 덩어리는 아예 그리지 않는다
          blob.setMatrixAt(far, this._m);
          const c = item[7];
          if (blob.instanceColor && c) blob.instanceColor.setXYZ(far, c[0], c[1], c[2]);
          far++;
        }
      }
      if (near) {
        near.count = n;
        near.instanceMatrix.needsUpdate = true;
        if (near.instanceColor) near.instanceColor.needsUpdate = true;
      }
      if (blob) {
        blob.count = far;
        blob.instanceMatrix.needsUpdate = true;
        if (blob.instanceColor) blob.instanceColor.needsUpdate = true;
      }
    };

    for (const v of this.variants) fill(v);
    for (const v of this.bushVariants) fill(v, true);
    for (const v of this.saplingVariants) fill(v, true);
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
