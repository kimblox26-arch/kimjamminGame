// 고요(GOYO) — 나무
// 가까운 나무는 잎을 한 장씩(알파 컷 카드) 그리고, 먼 나무는 덩어리로 바꿔 단다.
// 두 벌의 InstancedMesh 를 거리로 나눠 채우므로 잎이 아무리 많아도 화면에
// 실제로 그려지는 잎은 일정 수를 넘지 않는다.
import * as THREE from 'three';
import { clamp01, lerp, makeRng, smoothstep, TAU } from '../core/utils.js';
import { heightAt, normalAt, sampleGround, fertilityAt, fbm2, noiseCanvas, normalMapFromHeights, WATER_LEVEL, LAKE, INNER_HALF } from './terrain.js';
import { mergeGeos, tint, windify, WIND } from './flora.js';

/* ------------------------------------------------------------------ */
/* 잎 텍스처 아틀라스 (4×2)                                             */
/*  실제 잎을 관찰한 대로 종류마다 윤곽과 잎맥이 다르다.                  */
/*  0 난형 · 1 톱니형 · 2 도란형 · 3 피침형                              */
/*  4 심장형 · 5 결각형(참나무) · 6 손바닥형(단풍) · 7 침엽 다발          */
/* ------------------------------------------------------------------ */
export const LEAF = {
  OVATE: 0, SERRATE: 1, ROUND: 2, LANCE: 3, HEART: 4, OAK: 5, MAPLE: 6, NEEDLE: 7,
};

/** 잎 한 장이 차지하는 최대 포락선 — 지오메트리와 텍스처가 같은 식을 쓴다 */
function leafEnvelope(t) {
  return Math.sin(Math.PI * clamp01(0.045 + t * 0.94)) ** 0.6;
}

/** 밑동(t=0)에서 끝(t=1)까지의 반폭 — 종류마다 다른 윤곽 */
function outlineHalf(t, o) {
  const stalk = o.stalk ?? 0.13;
  if (t <= stalk) return 0.035;                       // 잎자루
  const s = clamp01((t - stalk) / (1 - stalk));
  const k = Math.log(0.5) / Math.log(o.peak ?? 0.42); // 가장 넓은 자리를 peak 로 옮긴다
  let w = Math.sin(Math.PI * clamp01(s ** k)) ** (o.sharp ?? 0.8);
  if (o.teeth) {                                      // 톱니 — 끝쪽을 향해 기운다
    const f = (s * o.teethN) % 1;
    w *= 1 - o.teeth * f;
  }
  if (o.lobe) {                                       // 결각 — 깊게 패인 굴곡
    w *= (1 - o.lobe) + o.lobe * Math.abs(Math.cos(s * Math.PI * o.lobeN));
  }
  if (o.base) w += o.base * Math.max(0, 1 - s * 6) ** 2;   // 심장형 밑동
  return Math.min(w * (o.wide ?? 1), leafEnvelope(t) * 0.99);
}

function leafAtlas(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cw = size / 4, ch = size / 2;
  g.clearRect(0, 0, size, size);

  // 셀 안의 좌표: x 는 가운데 기준, t 는 밑동 0 → 끝 1 (캔버스 위쪽이 끝)
  const px = (ox, x) => ox + cw * 0.5 + x * cw * 0.5;
  const py = (oy, t) => oy + ch * (0.975 - t * 0.95);

  /** 반폭 함수 하나로 윤곽선을 그린다 */
  const outline = (ox, oy, half, from = 0) => {
    g.beginPath();
    const N = 56;
    for (let i = 0; i <= N; i++) {
      const t = from + (1 - from) * (i / N);
      const w = half(t);
      if (i === 0) g.moveTo(px(ox, w), py(oy, t)); else g.lineTo(px(ox, w), py(oy, t));
    }
    for (let i = N; i >= 0; i--) {
      const t = from + (1 - from) * (i / N);
      g.lineTo(px(ox, -half(t)), py(oy, t));
    }
    g.closePath();
  };

  const fillBlade = (ox, oy, seed) => {
    const grad = g.createLinearGradient(0, py(oy, 1), 0, py(oy, 0));
    // 끝은 연하고 밑동으로 갈수록 짙다
    grad.addColorStop(0, '#e6efd2');
    grad.addColorStop(0.42, '#f1f5e6');
    grad.addColorStop(1, '#c9dcae');
    g.fillStyle = grad;
    g.fill();
    // 얼룩 — 같은 텍스처를 붙인 느낌을 지운다
    const rng = makeRng(seed);
    g.save();
    g.clip();
    for (let i = 0; i < 26; i++) {
      const t = rng(), x = (rng() - 0.5) * 1.6;
      const r = cw * (0.03 + rng() * 0.07);
      g.fillStyle = `rgba(${150 + rng() * 60 | 0},${170 + rng() * 55 | 0},${110 + rng() * 50 | 0},${0.05 + rng() * 0.11})`;
      g.beginPath();
      g.ellipse(px(ox, x), py(oy, t), r, r * (0.5 + rng()), rng() * 3, 0, TAU);
      g.fill();
    }
    g.restore();
  };

  const stalkLine = (ox, oy, o) => {
    g.strokeStyle = 'rgba(146,156,104,0.9)';
    g.lineWidth = cw * 0.022;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px(ox, 0), py(oy, 0));
    g.lineTo(px(ox, 0), py(oy, (o.stalk ?? 0.13) + 0.03));
    g.stroke();
  };

  const pinnate = (ox, oy, half, o) => {
    const stalk = o.stalk ?? 0.13;
    g.strokeStyle = 'rgba(122,142,94,0.5)';
    g.lineWidth = cw * 0.016;
    g.beginPath();
    g.moveTo(px(ox, 0), py(oy, stalk));
    g.lineTo(px(ox, 0), py(oy, 0.985));
    g.stroke();
    g.lineWidth = cw * 0.008;
    const n = o.veinN ?? 7;
    for (let i = 1; i <= n; i++) {
      const t = stalk + (i / (n + 1)) * (1 - stalk);
      const w = half(t) * 0.86;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(px(ox, 0), py(oy, t));
        g.quadraticCurveTo(px(ox, s * w * 0.55), py(oy, t + 0.035),
          px(ox, s * w), py(oy, t + 0.075));
        g.stroke();
      }
    }
  };

  const parallelVeins = (ox, oy, half) => {
    g.strokeStyle = 'rgba(126,146,98,0.45)';
    for (let i = -2; i <= 2; i++) {
      g.lineWidth = cw * (i === 0 ? 0.014 : 0.007);
      g.beginPath();
      for (let s = 0; s <= 20; s++) {
        const t = 0.14 + (s / 20) * 0.84;
        const x = (i / 2.4) * half(t) * 0.8;
        if (s === 0) g.moveTo(px(ox, x), py(oy, t)); else g.lineTo(px(ox, x), py(oy, t));
      }
      g.stroke();
    }
  };

  const CELLS = [
    { peak: 0.40, sharp: 0.85, wide: 0.92, veinN: 7 },                              // 난형
    { peak: 0.33, sharp: 0.78, wide: 0.96, teeth: 0.22, teethN: 12, veinN: 8 },     // 톱니형
    { peak: 0.62, sharp: 0.62, wide: 1.0, veinN: 5 },                               // 도란형
    { peak: 0.34, sharp: 1.25, wide: 0.52, veinN: 6, parallel: true },              // 피침형
    { peak: 0.24, sharp: 0.66, wide: 0.98, teeth: 0.13, teethN: 15, base: 0.24, veinN: 7 }, // 심장형
    { peak: 0.46, sharp: 0.68, wide: 1.0, lobe: 0.36, lobeN: 4.6, veinN: 5 },       // 결각형
  ];

  CELLS.forEach((o, i) => {
    const ox = (i % 4) * cw, oy = Math.floor(i / 4) * ch;
    const half = (t) => outlineHalf(t, o);
    outline(ox, oy, half);
    fillBlade(ox, oy, 100 + i * 37);
    if (o.parallel) parallelVeins(ox, oy, half); else pinnate(ox, oy, half, o);
    stalkLine(ox, oy, o);
  });

  // 6: 손바닥형 — 갈래 다섯 장이 한 밑동에서 갈라진다
  {
    const ox = 2 * cw, oy = ch;
    const lobes = [
      { a: 0, len: 1, w: 0.62 }, { a: 0.62, len: 0.84, w: 0.5 }, { a: -0.62, len: 0.84, w: 0.5 },
      { a: 1.22, len: 0.58, w: 0.42 }, { a: -1.22, len: 0.58, w: 0.42 },
    ];
    g.save();
    g.translate(px(ox, 0), py(oy, 0.1));
    for (const L of lobes) {
      g.save();
      g.rotate(L.a);
      g.translate(-px(ox, 0), -py(oy, 0.1));
      const half = (t) => outlineHalf(t, { peak: 0.44, sharp: 0.95, wide: L.w, teeth: 0.16, teethN: 5, stalk: 0.06 }) * (t > 0.06 ? 1 : 1);
      g.beginPath();
      const N = 40;
      const top = 0.1 + L.len * 0.86;
      for (let i = 0; i <= N; i++) {
        const t = i / N, ty = 0.1 + t * (top - 0.1);
        if (i === 0) g.moveTo(px(ox, half(t)), py(oy, ty)); else g.lineTo(px(ox, half(t)), py(oy, ty));
      }
      for (let i = N; i >= 0; i--) {
        const t = i / N, ty = 0.1 + t * (top - 0.1);
        g.lineTo(px(ox, -half(t)), py(oy, ty));
      }
      g.closePath();
      const grad = g.createLinearGradient(0, py(oy, 1), 0, py(oy, 0));
      grad.addColorStop(0, '#e9f0d6');
      grad.addColorStop(1, '#ccdcb0');
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = 'rgba(124,144,96,0.45)';
      g.lineWidth = cw * 0.012;
      g.beginPath();
      g.moveTo(px(ox, 0), py(oy, 0.1));
      g.lineTo(px(ox, 0), py(oy, top - 0.02));
      g.stroke();
      g.restore();
    }
    g.restore();
    stalkLine(ox, oy, { stalk: 0.12 });
  }

  // 7: 침엽 다발 — 가는 바늘이 한 다발
  {
    const ox = 3 * cw, oy = ch;
    const rng = makeRng(551);
    g.strokeStyle = '#d7e6c0';
    g.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const spread = (rng() - 0.5) * 0.95;
      const len = 0.5 + rng() * 0.45;
      g.lineWidth = cw * (0.013 + rng() * 0.012);
      g.beginPath();
      g.moveTo(px(ox, 0), py(oy, 0.06));
      g.quadraticCurveTo(px(ox, spread * 0.45), py(oy, 0.06 + len * 0.55),
        px(ox, spread), py(oy, 0.06 + len));
      g.stroke();
    }
    g.strokeStyle = 'rgba(140,124,92,0.9)';
    g.lineWidth = cw * 0.03;
    g.beginPath();
    g.moveTo(px(ox, 0), py(oy, 0));
    g.lineTo(px(ox, 0), py(oy, 0.09));
    g.stroke();
  }

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
const _u = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();

/**
 * 잎 한 장을 '진짜 모형'으로 만든다.
 * 납작한 카드가 아니라 주맥을 따라 접히고(단면이 V자), 끝으로 갈수록
 * 아래로 휘며, 좌우가 살짝 어긋나고 길이를 따라 비틀린다.
 * 같은 잎이 반복돼 보이지 않도록 장마다 모양을 조금씩 바꿔 준다.
 */
const LEAF_SEGS = 3;

class LeafBuilder {
  constructor(segs = LEAF_SEGS) {
    this.pos = []; this.uv = []; this.col = []; this.idx = []; this.out = [];
    this.segs = segs;
  }

  /**
   * px,py,pz : 잎자루가 붙는 자리
   * dir      : 잎이 뻗어 나가는 방향
   * w, l     : 반폭과 길이
   * cell     : 잎 텍스처 아틀라스 칸 (LEAF.*)
   * roll     : 잎면이 도는 각 (0 이면 잎면이 하늘을 본다)
   * o        : curl 처짐 · crease 주맥 접힘 · twist 비틀림 · asym 좌우 비대칭 · sweep 옆휨
   */
  add(px, py, pz, dirX, dirY, dirZ, w, l, cell, roll, color, o = {}) {
    const curl = o.curl ?? 0.26, crease = o.crease ?? 0.22, twist = o.twist ?? 0;
    const asym = o.asym ?? 0, sweep = o.sweep ?? 0, segs = o.segs ?? this.segs;
    _u.set(dirX, dirY, dirZ).normalize();           // 잎이 뻗는 방향
    _t1.set(-_u.z, 0, _u.x);
    if (_t1.lengthSq() < 1e-5) _t1.set(1, 0, 0);
    _t1.normalize();
    _t2.crossVectors(_u, _t1).normalize();

    const base = this.pos.length / 3;
    const col = (cell % 4) * 0.25 + 0.125;          // 칸 가운데
    const row = Math.floor(cell / 4);
    const vb = 0.5125 - row * 0.5;                  // 캔버스 위쪽 칸이 큰 v

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // 길이를 따라 잎면이 조금씩 비틀린다
      const rt = roll + twist * t * t;
      const cr = Math.cos(rt), sr = Math.sin(rt);
      const sx = _t1.x * cr + _t2.x * sr, sy = _t1.y * cr + _t2.y * sr, sz = _t1.z * cr + _t2.z * sr;
      const nx = -_t1.x * sr + _t2.x * cr, ny = -_t1.y * sr + _t2.y * cr, nz = -_t1.z * sr + _t2.z * cr;
      const env = leafEnvelope(t);                  // 텍스처와 같은 포락선
      const halfW = w * env;
      const along = l * t;
      const drop = -curl * l * t * t;               // 끝으로 갈수록 처진다
      const side1 = sweep * l * t * t;              // 옆으로도 조금 휜다
      const lift = crease * halfW;                  // 주맥이 솟아 V자 단면
      for (const side of [-1, 0, 1]) {
        const wx = halfW * side * (side < 0 ? 1 - asym : 1 + asym) + side1;
        const up = side === 0 ? lift : 0;
        this.pos.push(
          px + _u.x * along + sx * wx + nx * up,
          py + _u.y * along + sy * wx + ny * up + drop,
          pz + _u.z * along + sz * wx + nz * up);
        this.uv.push(col + side * env * 0.125, vb + 0.475 * t);
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

/** 침엽 다발 — 얇은 판 두 장을 엇갈려 세워 어느 각도에서도 부피가 있다 */
function needleCluster(lb, px, py, pz, dirX, dirY, dirZ, w, l, color, rng) {
  for (let k = 0; k < 2; k++) {
    lb.add(px, py, pz, dirX, dirY, dirZ, w, l, LEAF.NEEDLE, k * 1.15 + rng() * 0.4, color,
      { curl: 0.1 + rng() * 0.16, crease: 0.05, segs: 2, twist: (rng() - 0.5) * 0.5 });
  }
}

/* ------------------------------------------------------------------ */
/* 잎차례 — 잔가지를 따라 잎을 단다                                      */
/* ------------------------------------------------------------------ */
const GOLDEN = 2.399963;                 // 황금각: 실제 잎이 줄기를 돌며 나는 각
const _sd = new THREE.Vector3(), _sd2 = new THREE.Vector3();
const _lc = new THREE.Color();

/**
 * 잔가지(org→dir, 길이 len) 를 따라 잎을 단다.
 * 한 점에 몰리지 않고 마디마다 돌아가며 나며, 장마다 방향·크기·비틀림·빛깔이
 * 모두 조금씩 달라 같은 잎을 붙여 놓은 느낌이 나지 않는다.
 */
function leafySpray(lb, rng, org, dir, len, count, cells, palette, o = {}) {
  _sd.set(-dir.z, 0, dir.x);
  if (_sd.lengthSq() < 1e-6) _sd.set(1, 0, 0);
  _sd.normalize();
  _sd2.crossVectors(dir, _sd).normalize();
  const size = o.size ?? 0.2;            // 잎몸 길이 기준
  const spread = o.spread ?? 1.0;        // 가지에서 옆으로 벌어지는 정도
  const forward = o.forward ?? 0.5;      // 가지 끝 쪽으로 기우는 정도
  const droop = o.leafDroop ?? 0.4;
  const start = o.start ?? 0.08;
  const opposite = o.opposite ?? false;  // 마주나기 / 어긋나기
  let a = rng() * TAU;
  for (let i = 0; i < count; i++) {
    // 마디 간격이 고르지 않다
    const t = clamp01(start + (1 - start) * ((i + 0.2 + rng() * 0.7) / count));
    a += (opposite && i % 2) ? Math.PI : GOLDEN + (rng() - 0.5) * 0.8;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rx = _sd.x * ca + _sd2.x * sa, ry = _sd.y * ca + _sd2.y * sa, rz = _sd.z * ca + _sd2.z * sa;
    const sp = spread * (0.55 + rng() * 0.85);
    const fw = forward * (0.55 + rng() * 0.9);
    let dx = rx * sp + dir.x * fw;
    let dy = ry * sp + dir.y * fw - droop * (0.35 + rng());
    let dz = rz * sp + dir.z * fw;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // 잎자루는 잔가지 표면에서 시작한다
    const off = 0.014 * (0.6 + rng());
    const px = org.x + dir.x * len * t + rx * off;
    const py = org.y + dir.y * len * t + ry * off;
    const pz = org.z + dir.z * len * t + rz * off;
    // 끝쪽 잎은 어리고 작다. 큰 잎은 드물게만 섞인다
    const l = size * (0.55 + Math.pow(rng(), 1.6) * 1.05) * lerp(1.06, 0.6, t);
    const w = (l / 3.8) * (0.86 + rng() * 0.32);
    const c = _lc.copy(palette[Math.floor(rng() * palette.length)]);
    c.offsetHSL((rng() - 0.5) * 0.05, (rng() - 0.5) * 0.16, (rng() - 0.5) * 0.17);
    lb.add(px, py, pz, dx, dy, dz, w, l,
      cells[Math.floor(rng() * cells.length)],
      (rng() - 0.5) * 1.15 + (rng() < 0.22 ? Math.PI : 0), c, {
        curl: 0.14 + rng() * 0.34,
        crease: 0.1 + rng() * 0.28,
        twist: (rng() - 0.5) * 1.2,
        asym: (rng() - 0.5) * 0.32,
        sweep: (rng() - 0.5) * 0.24,
      });
  }
}

/** 가지 끝에서 잔가지 몇 대를 뻗고 그 위에 잎을 단다 (잔가지 지오메트리를 돌려준다) */
function shootsAtTip(lb, rng, tip, count, cells, palette, o = {}) {
  const geos = [];
  const n = 2 + Math.floor(rng() * 2.4);
  const per = Math.max(2, Math.round(count / n));
  const base = new THREE.Vector3().copy(tip.dir).normalize();
  const side = new THREE.Vector3(-base.z, 0, base.x);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const side2 = new THREE.Vector3().crossVectors(base, side).normalize();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rng() * 1.5;
    const sp = (o.shootSpread ?? 0.55) * (0.45 + rng() * 1.1);
    const d = new THREE.Vector3().copy(base)
      .addScaledVector(side, Math.cos(a) * sp)
      .addScaledVector(side2, Math.sin(a) * sp);
    d.y -= (o.shootDroop ?? 0.22) * rng();
    d.normalize();
    const len = (o.shoot ?? 0.45) * (0.55 + rng() * 0.9);
    // 잔가지는 끝마디에서 조금 물러난 자리에서 갈라진다
    const org = new THREE.Vector3().copy(tip.pos).addScaledVector(base, -rng() * 0.4);
    geos.push(limb(org, d, len, tip.r * 0.85, tip.r * 0.3, 3));
    leafySpray(lb, rng, org, d, len, per, cells, palette, o);
  }
  return geos;
}

/** 덤불·어린나무 — 가운데에서 잔가지가 사방으로 뻗고 그 위에 잎이 난다 */
function leafyShoots(lb, rng, cx, cy, cz, r, count, cells, palette, o = {}) {
  const geos = [];
  const shoots = Math.max(3, Math.round(count / (o.perShoot ?? 7)));
  const per = Math.max(2, Math.round(count / shoots));
  for (let k = 0; k < shoots; k++) {
    // 아래보다 위·옆으로 더 많이 뻗는다
    const a = rng() * TAU;
    const up = Math.pow(rng(), 0.75) * 1.45 - 0.3;
    const hor = Math.sqrt(Math.max(0.06, 1 - clamp01(up * up) * 0.6));
    const d = new THREE.Vector3(Math.cos(a) * hor, up, Math.sin(a) * hor).normalize();
    const len = r * (0.5 + rng() * 0.8);
    const org = new THREE.Vector3(
      cx + (rng() - 0.5) * r * 0.4,
      cy + (rng() - 0.5) * r * 0.45,
      cz + (rng() - 0.5) * r * 0.4);
    geos.push(limb(org, d, len, 0.013, 0.005, 3));
    leafySpray(lb, rng, org, d, len, per, cells, palette, o);
  }
  return geos;
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
  // 잎은 가지 끝에만 달리지 않는다 — 바깥쪽 마디를 따라서도 잔가지가 난다
  const mids = depth <= 1 ? 3 : depth <= 2 ? 1 : 0;
  for (let m = 0; m < mids; m++) {
    tips.push({
      pos: new THREE.Vector3().copy(origin)
        .addScaledVector(dir, length * ((m + 0.5 + (rng() - 0.5) * 0.6) / mids)),
      dir: new THREE.Vector3().copy(dir), r: radius * 0.75,
    });
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
 * 가지 끝을 몇 무리로 묶는다 — 먼 거리용 수관을 만드는 바탕.
 * (끝가지마다 덩어리를 만들면 멀리 있는 나무까지 삼각형을 낭비한다)
 */
function canopyClusters(tips, groups) {
  const out = [];
  if (!tips.length) return out;
  // 방위로 나누고 위·아래 두 켜로 한 번 더 나눈다 — 수관이 납작한 원반이 아니다
  let lo = Infinity, hi = -Infinity;
  for (const t of tips) { lo = Math.min(lo, t.pos.y); hi = Math.max(hi, t.pos.y); }
  const mid = (lo + hi) * 0.5;
  const buckets = Array.from({ length: groups * 2 }, () => []);
  for (const t of tips) {
    const a = Math.atan2(t.pos.z, t.pos.x) + Math.PI;
    const k = Math.min(groups - 1, Math.floor((a / TAU) * groups));
    buckets[k + (t.pos.y > mid ? groups : 0)].push(t);
  }
  for (const b of buckets) {
    if (!b.length) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const t of b) { cx += t.pos.x; cy += t.pos.y; cz += t.pos.z; }
    cx /= b.length; cy /= b.length; cz /= b.length;
    let r = 0.5;
    for (const t of b) r = Math.max(r, Math.hypot(t.pos.x - cx, t.pos.y - cy, t.pos.z - cz));
    out.push({ cx, cy, cz, r });
  }
  return out;
}

/** 수관 속을 채우는 그늘진 속살 — 잎 사이로 비치는 어두운 부피 */
function canopyMass(clusters, rng, color, pad = 0.9) {
  const out = [];
  for (const c of clusters) {
    const g = new THREE.IcosahedronGeometry(c.r * pad * 0.62, 1);
    roughen(g, c.r * 0.2, rng);
    g.scale(1, 0.82, 1);
    g.translate(c.cx, c.cy, c.cz);
    out.push(tint(g, color, 0.42, rng));
  }
  return out;
}

/**
 * 먼 나무의 겉잎 — 큰 잎 카드를 수관 바깥면에 얹는다.
 * 매끈한 공 대신 잎 실루엣이 남아, 멀리서도 '잎이 달린 나무'로 보인다.
 */
function canopyCards(lb, rng, clusters, cells, palette, count, len = 0.5) {
  for (const c of clusters) {
    const n = Math.max(4, Math.round(count / clusters.length));
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU;
      const up = rng() * 1.7 - 0.75;
      const hor = Math.sqrt(Math.max(0, 1 - clamp01(up * up)));
      const dx = Math.cos(a) * hor, dy = up, dz = Math.sin(a) * hor;
      const rr = c.r * (0.55 + rng() * 0.5);
      const l = Math.min(c.r * 0.5, len * (0.6 + rng() * 0.85));
      const col = _lc.copy(palette[Math.floor(rng() * palette.length)]);
      col.offsetHSL((rng() - 0.5) * 0.05, (rng() - 0.5) * 0.16, (rng() - 0.5) * 0.2);
      lb.add(c.cx + dx * rr, c.cy + dy * rr * 0.85, c.cz + dz * rr,
        dx + (rng() - 0.5) * 0.5, dy * 0.6 - 0.15, dz + (rng() - 0.5) * 0.5,
        l / 3.2, l, cells[Math.floor(rng() * cells.length)],
        (rng() - 0.5) * 1.4, col,
        { curl: 0.12 + rng() * 0.3, crease: 0.14, twist: (rng() - 0.5) * 0.9, segs: 2 });
    }
  }
}

const LEAF_GREENS = [0x8fae5e, 0x7fa050, 0x9cba68, 0x6f9046, 0xa8c074, 0x88a85a];
const LEAF_AUTUMN = [0xc8a24e, 0xb98a42, 0xd0b060];
const PINE_GREENS = [0x5d7f4a, 0x4e7040, 0x6b8a52, 0x456638];
const BIRCH_GREENS = [0xa6c46a, 0x96b85e, 0xb4cf7c, 0x8aa855];

/* 수종마다 잎 모양이 다르다 — 한 나무 안에서는 같은 계열로 난다 */
const BROAD_KINDS = [
  { cells: [LEAF.OVATE, LEAF.OVATE, LEAF.ROUND], size: 0.21, opposite: false },
  { cells: [LEAF.OAK, LEAF.OAK, LEAF.SERRATE], size: 0.24, opposite: false },
  { cells: [LEAF.MAPLE, LEAF.MAPLE, LEAF.OVATE], size: 0.26, opposite: true },
  { cells: [LEAF.SERRATE, LEAF.SERRATE, LEAF.LANCE], size: 0.19, opposite: false },
];

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
  const fb = new LeafBuilder();
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
        const s = (0.3 + rng() * 0.22) * (1 - t * 0.3);
        const c = _lc.copy(pal[Math.floor(rng() * pal.length)]);
        c.offsetHSL((rng() - 0.5) * 0.05, (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.16);
        needleCluster(lb, px, py, pz,
          dir.x * 0.7 + (rng() - 0.5) * 0.6, -0.3 + rng() * 0.5, dir.z * 0.7 + (rng() - 0.5) * 0.6,
          s * 0.5, s * 1.9, c, rng);
      }
    }
    // 먼 거리용 — 속은 원뿔, 겉은 큰 침엽 카드라 실루엣이 매끈하지 않다
    const cone = new THREE.ConeGeometry(r * 0.5, lerp(2.4, 1.0, t), 7, 1, true);
    cone.translate((rng() - 0.5) * 0.15, y + 0.2, (rng() - 0.5) * 0.15);
    roughen(cone, 0.12, rng);
    blobParts.push(tint(cone, new THREE.Color(0x3c5b30), 0.42, rng));

    const cards = Math.max(6, Math.round(18 * (1 - t * 0.45)));
    for (let m = 0; m < cards; m++) {
      const a = rng() * TAU;
      const rr = r * (0.35 + rng() * 0.62);
      const l = Math.min(0.55, r * (0.42 + rng() * 0.45));
      const col = _lc.copy(pal[Math.floor(rng() * pal.length)]);
      col.offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.18);
      fb.add(Math.cos(a) * rr, y + (rng() - 0.4) * 0.7, Math.sin(a) * rr,
        Math.cos(a) * 0.85 + (rng() - 0.5) * 0.4, -0.3 + rng() * 0.35, Math.sin(a) * 0.85 + (rng() - 0.5) * 0.4,
        l / 3.0, l, LEAF.NEEDLE, (rng() - 0.5) * 1.3, col,
        { curl: 0.12, crease: 0.1, segs: 2 });
    }
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    blobLeaves: fb.geometry(),
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

function broadTree(rng, leafCount, autumn = 0, depth = 3, kindIndex = 0) {
  const trunkParts = [], blobParts = [];
  const lb = new LeafBuilder();
  const kind = BROAD_KINDS[kindIndex % BROAD_KINDS.length];
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
    const tilt = 0.42 + rng() * 0.38;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    growBranches(rng, {
      origin: start, dir, length: h * (0.22 + rng() * 0.1), radius: 0.13 + rng() * 0.05,
      depth, children: 3, spread: 0.58, droop: 0.16, shrink: 0.7, lenShrink: 0.66,
      sides: 5, geos: branchGeos, tips, curve: 0.3,
    });
  }
  const pal = paletteColors(LEAF_GREENS.concat(autumn > 0.5 ? LEAF_AUTUMN : []), autumn * 0.5);
  const per = Math.max(3, Math.round(leafCount / Math.max(1, tips.length)));
  const twigParts = [];
  for (const tip of tips) {
    twigParts.push(...shootsAtTip(lb, rng, tip, per, kind.cells, pal, {
      size: kind.size, opposite: kind.opposite, spread: 1.0, forward: 0.45,
      leafDroop: 0.4, shoot: 0.8, shootSpread: 0.75, shootDroop: 0.3,
    }));
  }
  for (const g of branchGeos) trunkParts.push(tint(g, new THREE.Color(0x93795a), 0.3, rng));
  // 잔가지는 가까이서만 그린다 — 멀리서는 잎덩이에 묻힌다
  const twigs = twigParts.length
    ? mergeGeos(twigParts.map((g) => tint(g, new THREE.Color(0x8a7052), 0.3, rng))) : null;

  // 먼 거리 LOD — 그늘진 속살 + 겉을 덮는 큰 잎
  const clusters = canopyClusters(tips, 4);
  const fb = new LeafBuilder();
  blobParts.push(...canopyMass(clusters, rng, new THREE.Color(0x46682c), 1.02));
  canopyCards(fb, rng, clusters, kind.cells, pal, 88, 0.4);

  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    blobLeaves: fb.geometry(),
    twigs,
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
  const pal = paletteColors(BIRCH_GREENS);
  const per = Math.max(3, Math.round(leafCount / Math.max(1, tips.length)));
  const twigParts = [];
  for (const tip of tips) {
    // 자작나무 잎은 작은 삼각형에 가깝고 잔가지가 늘어진다
    twigParts.push(...shootsAtTip(lb, rng, tip, per, [LEAF.HEART, LEAF.HEART, LEAF.ROUND], pal, {
      size: 0.15, spread: 1.05, forward: 0.4, leafDroop: 0.55,
      shoot: 0.7, shootSpread: 0.6, shootDroop: 0.55,
    }));
  }
  for (const g of branchGeos) trunkParts.push(tint(g, new THREE.Color(0xc9c5b6), 0.25, rng));
  const twigs = twigParts.length
    ? mergeGeos(twigParts.map((g) => tint(g, new THREE.Color(0xbdb8a6), 0.25, rng))) : null;

  const clusters = canopyClusters(tips, 3);
  const fb = new LeafBuilder();
  blobParts.push(...canopyMass(clusters, rng, new THREE.Color(0x63813a), 0.98));
  canopyCards(fb, rng, clusters, [LEAF.HEART, LEAF.ROUND], pal, 72, 0.32);

  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    blobLeaves: fb.geometry(),
    twigs,
    leaves: lb.pos.length ? lb.geometry() : null,
    height: h,
  };
}

/** 어린 나무 — 가는 줄기에 잎덩이 두어 개 */
function sapling(rng, leafCount) {
  const trunkParts = [], blobParts = [], twigParts = [];
  const lb = new LeafBuilder();
  const fb = new LeafBuilder();
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
      const cy = h * (0.35 + t * 0.55);
      cone.translate(0, cy, 0);
      blobParts.push(tint(cone, new THREE.Color(0x3c5b30), 0.4, rng));
      canopyCards(fb, rng, [{ cx: 0, cy, cz: 0, r: lerp(0.5, 0.2, t) }], [LEAF.NEEDLE], pal, 8, 0.3);
      // 어린 침엽수 — 짧은 가지에 침엽 다발이 달린다
      const shoots = leafyShoots(lb, rng, 0, cy, 0, lerp(0.5, 0.2, t),
        Math.round(leafCount / 3), [LEAF.NEEDLE], pal,
        { size: 0.17, spread: 0.8, forward: 0.5, leafDroop: 0.25, perShoot: 5 });
      for (const g of shoots) twigParts.push(tint(g, new THREE.Color(0x7d6a4e), 0.3, rng));
    }
  } else {
    for (let i = 0; i < 2; i++) {
      const r = 0.42 + rng() * 0.3;
      const cy = h * (0.62 + i * 0.26);
      const b = new THREE.IcosahedronGeometry(r * 0.6, 1);
      b.translate((rng() - 0.5) * 0.3, cy, (rng() - 0.5) * 0.3);
      blobParts.push(tint(b, new THREE.Color(0x4e7331), 0.4, rng));
      canopyCards(fb, rng, [{ cx: 0, cy, cz: 0, r }], [LEAF.OVATE, LEAF.SERRATE], pal, 16, 0.26);
      const shoots = leafyShoots(lb, rng, 0, cy, 0, r, Math.round(leafCount / 2),
        [LEAF.OVATE, LEAF.SERRATE, LEAF.ROUND], pal,
        { size: 0.17, spread: 1.0, forward: 0.45, leafDroop: 0.4, perShoot: 6 });
      for (const g of shoots) twigParts.push(tint(g, new THREE.Color(0x7d6a4e), 0.3, rng));
    }
  }
  return {
    trunk: mergeGeos(trunkParts),
    blob: mergeGeos(blobParts),
    blobLeaves: fb.geometry(),
    twigs: twigParts.length ? mergeGeos(twigParts) : null,
    leaves: lb.pos.length ? lb.geometry() : null,
  };
}

function bushGeometry(rng, leafCount) {
  const blobParts = [], twigParts = [];
  const lb = new LeafBuilder();
  const fb = new LeafBuilder();
  const pal = paletteColors(LEAF_GREENS);
  const kind = BROAD_KINDS[Math.floor(rng() * BROAD_KINDS.length)];
  const blobs = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const r = 0.5 + rng() * 0.55;
    const cx = (rng() - 0.5) * 0.8, cz = (rng() - 0.5) * 0.8, cy = r * 0.75 + rng() * 0.2;
    const s = new THREE.IcosahedronGeometry(r * 0.56, 1);
    roughen(s, r * 0.2, rng);
    s.translate(cx, cy, cz);
    blobParts.push(tint(s, new THREE.Color(0x3f6129), 0.5, rng));
    // 덤불은 먼 거리에서 덩어리만 남으므로 잔가지는 따로 그리지 않는다
    twigParts.length = 0;
    canopyCards(fb, rng, [{ cx, cy, cz, r }], kind.cells, pal, 18, 0.26);
    leafyShoots(lb, rng, cx, cy, cz, r, Math.round(leafCount / blobs), kind.cells, pal,
      { size: kind.size * 0.7, opposite: kind.opposite, spread: 1.0, forward: 0.4, leafDroop: 0.45, perShoot: 6 });
  }
  return {
    blob: mergeGeos(blobParts),
    blobLeaves: fb.geometry(),
    leaves: lb.pos.length ? lb.geometry() : null,
  };
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
  low: { step: 9.5, leaves: 1100, nearTrees: 5, leafDist: 13, variants: 2, bushLeaves: 26, saplings: 0.35, branchDepth: 2 },
  medium: { step: 7.2, leaves: 2400, nearTrees: 10, leafDist: 20, variants: 2, bushLeaves: 46, saplings: 0.7, branchDepth: 2 },
  high: { step: 6.2, leaves: 4200, nearTrees: 15, leafDist: 26, variants: 3, bushLeaves: 80, saplings: 1, branchDepth: 3 },
  ultra: { step: 5.4, leaves: 6800, nearTrees: 26, leafDist: 36, variants: 3, bushLeaves: 140, saplings: 1.3, branchDepth: 3 },
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

  /** 가까울 때만 그리는 보조 메시 (잔가지 등) */
  _nearMesh(geo, mat, cap, name) {
    if (!geo) return null;
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.name = name;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.count = 0;
    this.group.add(im);
    return im;
  }

  _build(rng, q) {
    const depth = q.branchDepth ?? 3;
    const makers = [
      (r) => pineTree(r, q.leaves * 0.75),
      // 변형마다 잎 모양이 다르다 — 참나무·단풍·느릅나무처럼 갈린다
      (r, v) => broadTree(r, q.leaves, r() < 0.18 ? 1 : 0, depth, v),
      (r) => birchTree(r, q.leaves * 0.85, depth),
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
        const built = makers[sp](rng, v);
        this._staticInstanced(built.trunk, sp === 2 ? this.birchMat : this.barkMat, list, true, -0.2, false, 0.18);
        const blob = this._staticInstanced(built.blob, this.blobMat, list, true, -0.2, false, 0.42);
        if (blob) blob.name = `canopy-${sp}-${v}`;
        const card = this._staticInstanced(this.leafMat ? built.blobLeaves : null, this.leafMat, list, false, -0.2, false, 0.42);
        if (card) card.name = `canopy-leaf-${sp}-${v}`;
        const variant = { list, blob, blobs: [blob, card], leafGeo: built.leaves, near: null, farCount: list.length };
        if (built.leaves && q.nearTrees > 0) {
          const cap = Math.max(6, Math.round(q.nearTrees / (3 * q.variants)) + 4);
          variant.nearTwig = this._nearMesh(built.twigs, sp === 2 ? this.birchMat : this.barkMat, cap, `twigs-near-${sp}-${v}`);
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
        const card = this._staticInstanced(this.leafMat ? built.blobLeaves : null, this.leafMat, list, false, -0.1, false, 0.4);
        const variant = { list, blob, blobs: [blob, card], leafGeo: built.leaves, near: null };
        if (built.leaves && q.nearTrees > 0) {
          const cap = 20;
          variant.nearTwig = this._nearMesh(built.twigs, this.barkMat, cap, `sapling-twigs-${v}`);
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
      const card = this._staticInstanced(this.leafMat ? built.blobLeaves : null, this.leafMat, list, false, -0.15, false, 0.4);
      const variant = { list, blob, blobs: [blob, card], leafGeo: built.leaves, near: null };
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
      const twig = variant.nearTwig;
      const blobs = (variant.blobs || [variant.blob]).filter(Boolean);
      const blob = blobs[0] || null;
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
          if (twig) twig.setMatrixAt(n, this._m);
          if (near.instanceColor) {
            const b = 0.86 + (item[6] || 0) * 0.3;
            near.instanceColor.setXYZ(n, b * 1.02, b, b * 0.94);
          }
          n++;
        } else if (blob) {
          // 먼 나무 — 덩어리로. 가까운 나무의 덩어리는 아예 그리지 않는다
          const c = item[7];
          for (const b of blobs) {
            b.setMatrixAt(far, this._m);
            if (b.instanceColor && c) b.instanceColor.setXYZ(far, c[0], c[1], c[2]);
          }
          far++;
        }
      }
      if (near) {
        near.count = n;
        near.instanceMatrix.needsUpdate = true;
        if (near.instanceColor) near.instanceColor.needsUpdate = true;
      }
      if (twig) { twig.count = n; twig.instanceMatrix.needsUpdate = true; }
      for (const b of blobs) {
        b.count = far;
        b.instanceMatrix.needsUpdate = true;
        if (b.instanceColor) b.instanceColor.needsUpdate = true;
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
    const geo = new THREE.PlaneGeometry(0.15, 0.28);
    // 아틀라스의 난형 잎 칸(0번)만 쓴다
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, 0.5125 + uv.getY(i) * 0.475);
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
