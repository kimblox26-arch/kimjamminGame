// 고요(GOYO) — 초목: 풀·꽃·돌·나무
// 풀과 자잘한 오브젝트는 플레이어 주변 셀에만 채워 넣고 재활용한다.
import * as THREE from 'three';
import { clamp01, lerp, makeRng, smoothstep, TAU } from '../core/utils.js';
import { heightAt, normalAt, slopeAt, sampleGround, fertilityAt, surfaceAt, SURFACE, WATER_LEVEL, LAKE, INNER_HALF, fbm2 } from './terrain.js';

/* 식생 셰이더가 공유하는 태양 상태 (투과광용) */
export const SUN = {
  dir: { value: new THREE.Vector3(0, 1, 0) },
  color: { value: new THREE.Color(0xffffff) },
};

/* 모든 식생 셰이더가 공유하는 바람 상태 */
export const WIND = {
  time: { value: 0 },
  strength: { value: 0.5 },
  dir: { value: new THREE.Vector2(0.86, 0.51) },
  player: { value: new THREE.Vector3(0, -999, 0) },
};

/* ------------------------------------------------------------------ */
/* 지오메트리 도우미                                                    */
/* ------------------------------------------------------------------ */
export function mergeGeos(geos) {
  let vTotal = 0, iTotal = 0;
  for (const g of geos) {
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const col = new Float32Array(vTotal * 3);
  const uvs = new Float32Array(vTotal * 2);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (u) uvs.set(u.array, vo * 2);
    if (c) col.set(c.array, vo * 3);
    else for (let i = 0; i < p.count; i++) { col[(vo + i) * 3] = 1; col[(vo + i) * 3 + 1] = 1; col[(vo + i) * 3 + 2] = 1; }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
    vo += p.count;
    io += g.index ? g.index.count : p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function tint(geo, color, variance = 0, rng = Math.random) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.copy(color);
    if (variance) c.offsetHSL((rng() - 0.5) * variance * 0.1, (rng() - 0.5) * variance * 0.2, (rng() - 0.5) * variance * 0.22);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** 정점을 흔들어 딱딱한 프리미티브 느낌을 지운다 */
function roughen(geo, amount, rng = Math.random, scaleY = 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + (rng() - 0.5) * amount,
      p.getY(i) + (rng() - 0.5) * amount * scaleY,
      p.getZ(i) + (rng() - 0.5) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* 풀밭                                                                */
/* ------------------------------------------------------------------ */
/**
 * 풀잎 한 장.
 * 밑동에서 끝으로 가늘어지고, 앞뒤·좌우 두 방향으로 휘며, 길이를 따라 비틀린다.
 * fold 를 주면 주맥을 따라 접혀(단면이 V자) 옆에서 봐도 선으로 보이지 않는다.
 */
function bladeStrip(pos, uvs, idx, col, o) {
  const {
    segments = 3, w = 0.02, ox = 0, oz = 0, rot = 0, curve = 0.2, height = 1,
    pitch = 0, fold = 0, twist = 0, sideBend = 0, shade = 0.62, tint: tc = [1, 1, 1],
  } = o;
  const base = pos.length / 3;
  const cy = Math.cos(rot), sy = Math.sin(rot);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const sides = fold > 0 ? [-1, 0, 1] : [-1, 1];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // 밑동은 도톰하고 끝으로 갈수록 뾰족해진다
    const width = w * Math.max(0.05, 1 - t ** 1.5 * 0.97);
    const tw = twist * t;
    const ct = Math.cos(tw), st = Math.sin(tw);
    const ly = t * height;
    const lz = t * t * curve;
    const lxc = t * t * sideBend;
    // 밑동은 어둡고 끝으로 갈수록 밝게 — 풀숲 바닥의 그늘
    const ao = shade + t * 0.44;
    for (const side of sides) {
      const wx = width * side;
      const bump = side === 0 ? fold * width : 0;
      const lx = lxc + wx * ct;
      const lzz = lz + wx * st - bump;
      // 눕히기(pitch) → 돌리기(yaw)
      const py = ly * cp - lzz * sp;
      const pz = ly * sp + lzz * cp;
      pos.push(ox + lx * cy - pz * sy, py, oz + lx * sy + pz * cy);
      uvs.push(side * 0.5 + 0.5, t);
      col.push(ao * tc[0], ao * tc[1], ao * tc[2]);
    }
  }
  const stride = sides.length;
  for (let i = 0; i < segments; i++) {
    const a = base + i * stride;
    if (stride === 2) {
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    } else {
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      idx.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
}

/** 휜 잎의 끝점 — 이삭을 달 자리를 찾는 데 쓴다 */
function bladeTip(o) {
  const { rot = 0, curve = 0.2, height = 1, pitch = 0, ox = 0, oz = 0, sideBend = 0 } = o;
  const cy = Math.cos(rot), sy = Math.sin(rot);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const py = height * cp - curve * sp;
  const pz = height * sp + curve * cp;
  return [ox + sideBend * cy - pz * sy, py, oz + sideBend * sy + pz * cy];
}

/**
 * 한 포기 — 길이도 각도도 제각각인 잎 여러 장 + 바닥을 덮도록 눕힌 잎.
 * 눕힌 잎이 포기 사이의 흙을 가려 풀밭에 틈이 보이지 않는다.
 * 포기마다 다른 씨앗으로 만들어, 같은 모양이 되풀이되지 않는다.
 */
function tuftGeometry(seed, o = {}) {
  const rng = makeRng(seed);
  const pos = [], uvs = [], idx = [], col = [];
  const upright = o.upright ?? 4;
  const mats = o.mats ?? 3;
  const fold = o.fold ?? 0;
  const segments = o.segments ?? 3;
  const wK = o.width ?? 1;

  for (let b = 0; b < upright; b++) {
    // 방위는 고르게 흩어지되 간격이 일정하지 않다
    const rot = ((b + rng() * 0.9) / upright) * TAU;
    const r = b === 0 ? 0 : (0.006 + rng() * 0.03);
    const warm = (rng() - 0.5) * 0.12;
    bladeStrip(pos, uvs, idx, col, {
      segments, fold: fold * (o.foldK ?? 1),
      w: (0.006 + rng() * 0.0065) * wK,
      ox: Math.cos(rot) * r, oz: Math.sin(rot) * r,
      rot: rot + (rng() - 0.5) * 1.1,
      // 짧은 잎이 많고 이따금 길게 솟는다
      height: 0.58 + Math.pow(rng(), 1.4) * 0.62,
      curve: 0.1 + rng() * 0.45,
      // 대개 곧게 서고 몇 장만 크게 눕는다
      pitch: 0.04 + Math.pow(rng(), 2.4) * 0.95,
      twist: (rng() - 0.5) * 1.8,
      sideBend: (rng() - 0.5) * 0.22,
      shade: 0.55 + rng() * 0.2,
      tint: [1 + warm, 1, 1 - warm * 0.8],
    });
  }
  // 바닥을 덮는 잎 — 짧고 넓게, 거의 눕혀서
  for (let b = 0; b < mats; b++) {
    const rot = ((b + rng() * 0.8) / mats) * TAU + 1.7;
    bladeStrip(pos, uvs, idx, col, {
      segments: 2,
      w: (0.009 + rng() * 0.009) * wK,
      ox: (rng() - 0.5) * 0.02, oz: (rng() - 0.5) * 0.02,
      rot: rot + (rng() - 0.5) * 0.8,
      height: 0.5 + rng() * 0.4,
      curve: 0.02 + rng() * 0.09,
      pitch: 1.05 + rng() * 0.4,
      twist: (rng() - 0.5) * 0.9,
      sideBend: (rng() - 0.5) * 0.12,
      shade: 0.5 + rng() * 0.18,
    });
  }
  // 이삭 — 이따금 한 대씩 솟아 풀밭이 단조롭지 않다
  if (o.seedHead && rng() < 0.75) {
    const stalk = {
      segments: 2, w: 0.0045, ox: (rng() - 0.5) * 0.02, oz: (rng() - 0.5) * 0.02,
      rot: rng() * TAU, height: 1.25 + rng() * 0.5, curve: 0.25 + rng() * 0.35,
      pitch: 0.06 + rng() * 0.12, twist: 0, sideBend: 0, shade: 0.7,
      tint: [1.05, 1, 0.9],
    };
    bladeStrip(pos, uvs, idx, col, stalk);
    const [tx, ty, tz] = bladeTip(stalk);
    const grains = 5 + Math.floor(rng() * 4);
    for (let k = 0; k < grains; k++) {
      const a = rng() * TAU;
      bladeStrip(pos, uvs, idx, col, {
        segments: 1, w: 0.008 + rng() * 0.005,
        ox: tx + Math.cos(a) * 0.006, oz: tz + Math.sin(a) * 0.006,
        rot: a, height: 0.09 + rng() * 0.07, curve: 0.03,
        pitch: 1.1 + rng() * 0.7, shade: 0.85,
        tint: [1.12, 1.02, 0.82],
      });
      // 이삭 알갱이는 줄기 끝 높이에서 시작한다
      for (let v = pos.length / 3 - 4; v < pos.length / 3; v++) pos[v * 3 + 1] += ty;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 실제 면 법선과 하늘 방향을 섞는다 — 풀 한 장의 입체감은 살리되
  // 풀밭 전체는 부드럽게 빛을 받아 잔디가 까맣게 죽지 않는다
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i) * 0.55, ny = n.getY(i) * 0.55 + 0.52, nz = n.getZ(i) * 0.55;
    const len = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / len, ny / len, nz / len);
  }
  return g;
}

/* 링마다 쓰는 포기 변형 — 잎 수·굵기·이삭이 다르다 */
const TUFT_VARIANTS = [
  { upright: 4, mats: 3, width: 1.05, seedHead: false, foldK: 1 },
  { upright: 5, mats: 3, width: 1.3, seedHead: true, foldK: 0 },
  { upright: 5, mats: 3, width: 0.8, seedHead: false, foldK: 0 },
];

/** 셀 단위로 인스턴스를 재배치하는 공통 로직 */
class CellPool {
  constructor({ cell, radius, blocks, perBlock, minRadius = 0 }) {
    this.cell = cell;
    this.radius = radius;
    this.minRadius = minRadius;   // 안쪽 링이 이미 채운 영역은 비운다
    this.perBlock = perBlock;
    this.free = [];
    for (let i = 0; i < blocks; i++) this.free.push(i);
    this.active = new Map();      // key -> block
    this.queue = [];
  }

  key(cx, cz) { return cx * 100003 + cz; }

  /** 필요한 셀 목록을 갱신하고, 새로 채워야 할 셀을 큐에 넣는다 */
  refresh(px, pz) {
    const c = this.cell, r = this.radius;
    const cx0 = Math.floor((px - r) / c), cx1 = Math.floor((px + r) / c);
    const cz0 = Math.floor((pz - r) / c), cz1 = Math.floor((pz + r) / c);
    const need = new Set();
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const mx = cx * c + c * 0.5 - px, mz = cz * c + c * 0.5 - pz;
        const d = Math.hypot(mx, mz);
        if (d > r + c || d < this.minRadius - c) continue;
        const k = this.key(cx, cz);
        need.add(k);
        if (!this.active.has(k) && !this._queued(k)) this.queue.push({ k, cx, cz, d });
      }
    }
    // 멀어진 셀 회수 (block < 0 은 '비어 있다고 확인된 셀')
    for (const [k, block] of this.active) {
      if (!need.has(k)) {
        this.active.delete(k);
        if (block >= 0) { this.free.push(block); this._onRelease?.(block); }
      }
    }
    // 가까운 셀부터 채운다
    this.queue = this.queue.filter((q) => need.has(q.k));
    for (const q of this.queue) {
      q.d = Math.hypot(q.cx * c + c * 0.5 - px, q.cz * c + c * 0.5 - pz);
    }
    this.queue.sort((a, b) => a.d - b.d);
  }

  _queued(k) { return this.queue.some((q) => q.k === k); }

  /**
   * 프레임당 최대 n개 셀 채우기.
   * filler 가 0(심은 게 없음)을 돌려주면 블록을 즉시 반납한다 —
   * 군락이 드문 꽃일수록 같은 인스턴스 예산으로 훨씬 넓은 땅을 덮을 수 있다.
   */
  fill(n, filler) {
    let done = 0;
    while (done < n && this.queue.length && this.free.length) {
      const { k, cx, cz } = this.queue.shift();
      const block = this.free.pop();
      const used = filler(block, cx, cz);
      if (used === 0) {
        this.active.set(k, -1);
        this.free.push(block);
        this._onRelease?.(block);
      } else {
        this.active.set(k, block);
      }
      done++;
    }
    return done;
  }
}

/* 품질별 잔디 링 구성 — 가까운 링은 빽빽하게, 먼 링은 크고 성기게 */
/* 가까운 링의 풀잎은 주맥을 따라 접혀(fold) 옆에서 봐도 납작하지 않다 */
const GRASS_RINGS = {
  low: [
    { cell: 6, radius: 16, minRadius: 0, perBlock: 174, blocks: 46, size: 1.0, seed: 101, fold: 0.3, segments: 3 },
    { cell: 14, radius: 36, minRadius: 14, perBlock: 105, blocks: 44, size: 1.22, hK: 1.12, seed: 211, segments: 2, seedHeads: false },
  ],
  medium: [
    { cell: 6, radius: 19, minRadius: 0, perBlock: 210, blocks: 60, size: 1.0, seed: 101, fold: 0.3, segments: 3 },
    { cell: 13, radius: 46, minRadius: 17, perBlock: 129, blocks: 70, size: 1.22, hK: 1.12, seed: 211, segments: 2 },
  ],
  high: [
    { cell: 6, radius: 24, minRadius: 0, perBlock: 264, blocks: 80, size: 1.0, seed: 101, fold: 0.32, segments: 3 },
    { cell: 12, radius: 60, minRadius: 22, perBlock: 135, blocks: 116, size: 1.22, hK: 1.12, seed: 211, segments: 3 },
    // 멀리까지 이어지는 성긴 큰 포기 — 풀밭이 끊겨 보이지 않게
    { cell: 24, radius: 132, minRadius: 56, perBlock: 78, blocks: 136, size: 1.95, hK: 1.35, seed: 307, segments: 2, seedHeads: false },
  ],
  ultra: [
    { cell: 6, radius: 29, minRadius: 0, perBlock: 288, blocks: 116, size: 1.0, seed: 101, fold: 0.34, segments: 3 },
    { cell: 12, radius: 74, minRadius: 27, perBlock: 150, blocks: 176, size: 1.22, hK: 1.12, seed: 211, segments: 3 },
    { cell: 24, radius: 165, minRadius: 74, perBlock: 72, blocks: 192, size: 1.95, hK: 1.35, seed: 307, segments: 2, seedHeads: false },
  ],
};

/** 잔디 링 하나 — 서로 다른 포기 모양 몇 벌을 섞어 심는다 */
class GrassRing {
  constructor(scene, cfg, material) {
    const V = cfg.variants ?? TUFT_VARIANTS.length;
    this.variants = V;
    this.perBlock = cfg.perBlock - (cfg.perBlock % V);   // 변형 수로 나눠떨어지게
    this.localPer = this.perBlock / V;
    this.count = this.perBlock * cfg.blocks;
    this.size = cfg.size;
    this.hK = cfg.hK ?? cfg.size;        // 포기 폭과 풀 길이를 따로 둔다
    this.pool = new CellPool({ ...cfg, perBlock: this.perBlock });

    this.meshes = [];
    this.colors = [];
    for (let v = 0; v < V; v++) {
      const geo = tuftGeometry((cfg.seed ?? 1) + v * 7919, {
        ...TUFT_VARIANTS[v % TUFT_VARIANTS.length],
        fold: cfg.fold ?? 0,
        segments: cfg.segments ?? 3,
        seedHead: (TUFT_VARIANTS[v % TUFT_VARIANTS.length].seedHead) && (cfg.seedHeads !== false),
      });
      const mesh = new THREE.InstancedMesh(geo, material, this.localPer * cfg.blocks);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.receiveShadow = true;           // 나무 그늘이 풀밭에 드리운다
      mesh.name = 'grass';
      const col = new THREE.InstancedBufferAttribute(
        new Float32Array(this.localPer * cfg.blocks * 3).fill(1), 3);
      mesh.instanceColor = col;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.colors.push(col);
    }
    this.mesh = this.meshes[0];

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this._base = new THREE.Color(0x76883f);

    this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
    for (const mesh of this.meshes) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this._m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.pool._onRelease = (block) => this._hideBlock(block);
  }

  _hideBlock(block) {
    this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
    const start = block * this.localPer;
    for (const mesh of this.meshes) {
      for (let i = 0; i < this.localPer; i++) mesh.setMatrixAt(start + i, this._m);
    }
    this._dirty = true;
  }

  _fillBlock(block, cx, cz) {
    const cell = this.pool.cell;
    const rng = makeRng((cx * 73856093) ^ (cz * 19349663) ^ 0x9e37);
    const start = block * this.localPer;
    const V = this.variants;
    let used = 0;
    for (let i = 0; i < this.perBlock; i++) {
      const mesh = this.meshes[i % V];
      const colors = this.colors[i % V];
      const slot = start + ((i / V) | 0);
      const x = cx * cell + rng() * cell;
      const z = cz * cell + rng() * cell;
      const { h, slope } = sampleGround(x, z);
      const fert = fertilityAt(x, z, h, slope);
      const surf = surfaceAt(x, z, h, slope);
      const ok = fert > 0.08 && rng() < fert * (surf === SURFACE.GRASS ? 1.45 : surf === SURFACE.DIRT ? 0.7 : 0.1);
      if (ok) used++;
      if (!ok) {
        this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
        mesh.setMatrixAt(slot, this._m);
        continue;
      }
      // 짧은 풀이 많고 이따금 긴 풀이 섞여야 바닥이 촘촘해 보인다
      const r1 = rng();
      const tall = (0.11 + r1 * r1 * 0.55) * lerp(0.65, 1.3, fert);
      const nearWater = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 12 && h < WATER_LEVEL + 1.6;
      const height = (nearWater ? tall * 2.2 : tall) * this.hK;
      // 포기마다 눕는 방향이 다르다 — 바람 자국처럼 결이 생긴다
      const leanA = rng() * TAU, leanS = Math.pow(rng(), 1.6) * 0.34;
      this._e.set(Math.sin(leanA) * leanS, rng() * TAU, Math.cos(leanA) * leanS);
      this._q.setFromEuler(this._e);
      this._p.set(x, h - 0.03, z);
      const w = (0.72 + rng() * 0.55) * this.size;
      this._s.set(w, height * (0.85 + rng() * 0.3), w * (0.8 + rng() * 0.4));
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(slot, this._m);

      this._c.copy(this._base);
      const dry = fbm2(x * 0.03 + 17.3, z * 0.03 - 9.2, 2) * 0.5 + 0.5;
      this._c.offsetHSL((rng() - 0.5) * 0.05 + dry * 0.035,
        (rng() - 0.5) * 0.16 - dry * 0.12, (rng() - 0.45) * 0.12 + fert * 0.05);
      if (nearWater) this._c.offsetHSL(0.01, 0.05, -0.02);
      colors.setXYZ(slot, this._c.r, this._c.g, this._c.b);
    }
    this._dirty = true;
    for (const c of this.colors) c.needsUpdate = true;
    return used;
  }

  flush() {
    if (!this._dirty) return;
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }
}

/** 여러 링을 묶은 잔디밭 — 프레임당 시간 예산 안에서 조금씩 채운다 */
export class GrassField {
  constructor(scene, quality = 'high') {
    const rings = GRASS_RINGS[quality] || GRASS_RINGS.high;
    // 표준 조명 재질을 써서 그림자·안개·해질녘 빛을 그대로 받는다
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      color: 0xffffff,
      emissive: 0x151d0d,          // 그늘에서도 완전히 죽지 않게
    });
    windify(this.material, 2.6, { translucency: 0.85 });
    this.rings = rings.map((cfg) => new GrassRing(scene, cfg, this.material));
    this.count = this.rings.reduce((a, r) => a + r.count, 0);
  }

  /** budgetMs 만큼만 셀을 채워 프레임이 끊기지 않게 한다 */
  update(px, pz, budgetMs = 2.2) {
    const t0 = performance.now();
    for (const ring of this.rings) ring.pool.refresh(px, pz);
    let guard = 0;
    while (performance.now() - t0 < budgetMs && guard < 64) {
      let filled = 0;
      for (const ring of this.rings) {
        filled += ring.pool.fill(1, (b, cx, cz) => ring._fillBlock(b, cx, cz));
        if (performance.now() - t0 >= budgetMs) break;
      }
      if (!filled) break;
      guard++;
    }
    for (const ring of this.rings) ring.flush();
  }

  prime(px, pz) {
    for (const ring of this.rings) {
      ring.pool.refresh(px, pz);
      ring.pool.fill(9999, (b, cx, cz) => ring._fillBlock(b, cx, cz));
      ring._dirty = true;
      ring.flush();
    }
  }

  /** 비에 젖으면 짙어진다 */
  setWet(wet) {
    const v = 1 - wet * 0.32;
    this.material.color.setRGB(v, v, v);
  }
}

/* ------------------------------------------------------------------ */
/* 지면 잡동사니 (돌멩이·꽃·고사리·버섯·나뭇가지)                         */
/* ------------------------------------------------------------------ */
/** 바람에 흔들리는 식물용 재질 패치 */
function windify(material, factor = 1, opts = {}) {
  const trans = opts.translucency ?? 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.time;
    shader.uniforms.uWind = WIND.strength;
    shader.uniforms.uWindDir = WIND.dir;
    shader.uniforms.uPlayer = WIND.player;
    shader.uniforms.uSwayK = { value: factor };
    shader.uniforms.uSunDir = SUN.dir;
    shader.uniforms.uSunColor = SUN.color;
    shader.uniforms.uTrans = { value: trans };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
        uniform vec3 uPlayer; uniform float uSwayK;`)
      // 월드 공간에서 흔들어야 인스턴스 회전과 무관하게 한 방향으로 눕는다
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        {
          vec4 wp4 = modelMatrix * mvPosition;
          #ifdef USE_INSTANCING
            vec3 iBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 iBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          float hh = max(wp4.y - iBase.y, 0.0);
          float ph = iBase.x * 0.11 + iBase.z * 0.13;
          float sway = (sin(uTime * 1.05 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.9) * 0.3) * uWind * uSwayK;
          vec3 d = wp4.xyz - uPlayer; d.y = 0.0;
          float push = smoothstep(1.5, 0.2, length(d)) * uSwayK;
          wp4.xz += uWindDir * sway * hh * 0.14 + normalize(d.xz + vec2(0.0001)) * push * hh * 0.35;
          wp4.y -= (abs(sway) * 0.05 + push * 0.12) * hh;
          mvPosition = viewMatrix * wp4;
        }
        gl_Position = projectionMatrix * mvPosition;`);

    if (trans > 0) {
      // 잎·풀을 통과해 비치는 빛 (아주 단순한 서브서피스 흉내)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTrans;`)
        .replace('#include <dithering_fragment>', `
          {
            // 잎 뒤에서 해가 비칠 때 잎살이 환해진다
            vec3 nv = normalize(vNormal);
            vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
            float back = pow(max(dot(-nv, sunV), 0.0), 1.7);
            gl_FragColor.rgb += uSunColor * uTrans * back * 0.55 * gl_FragColor.rgb;
          }
          #include <dithering_fragment>`);
    }
  };
  material.customProgramCacheKey = () => `windify${factor}_${trans}`;
  return material;
}

/** 셀 풀로 관리되는 산포 레이어 */
export class ScatterLayer {
  constructor(scene, { geometry, material, perBlock, blocks, cell, radius, place, castShadow = false, name = 'clutter', salt = 0 }) {
    this.perBlock = perBlock;
    this.count = perBlock * blocks;
    this.place = place;
    this.salt = salt | 0;          // 같은 셀이라도 레이어마다 다른 자리에 심는다
    this.pool = new CellPool({ cell, radius, blocks, perBlock });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3).fill(1), 3);
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this._hidden = new THREE.Matrix4().compose(
      new THREE.Vector3(0, -999, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pool._onRelease = (block) => {
      const start = block * this.perBlock;
      for (let i = 0; i < this.perBlock; i++) this.mesh.setMatrixAt(start + i, this._hidden);
      this._dirty = true;
    };
  }

  _fill(block, cx, cz) {
    const cell = this.pool.cell;
    const rng = makeRng((cx * 73856093) ^ (cz * 19349663) ^ (0x51ed + this.salt));
    const start = block * this.perBlock;
    let used = 0;
    for (let i = 0; i < this.perBlock; i++) {
      const x = cx * cell + rng() * cell;
      const z = cz * cell + rng() * cell;
      const res = this.place(x, z, rng, this);
      if (!res) { this.mesh.setMatrixAt(start + i, this._hidden); continue; }
      this.mesh.setMatrixAt(start + i, res.matrix || this._m);
      if (res.color) this.mesh.instanceColor.setXYZ(start + i, res.color.r, res.color.g, res.color.b);
      else this.mesh.instanceColor.setXYZ(start + i, 1, 1, 1);
      used++;
    }
    this._dirty = true;
    this.mesh.instanceColor.needsUpdate = true;
    return used;
  }

  compose(x, y, z, ry, scale, tiltX = 0, tiltZ = 0) {
    this._e.set(tiltX, ry, tiltZ);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    if (typeof scale === 'number') this._s.set(scale, scale, scale);
    else this._s.copy(scale);
    this._m.compose(this._p, this._q, this._s);
    return this._m;
  }

  update(px, pz, budget = 1) {
    this.pool.refresh(px, pz);
    this.pool.fill(budget, (b, cx, cz) => this._fill(b, cx, cz));
    if (this._dirty) { this.mesh.instanceMatrix.needsUpdate = true; this._dirty = false; }
  }

  prime(px, pz) {
    this.pool.refresh(px, pz);
    this.pool.fill(9999, (b, cx, cz) => this._fill(b, cx, cz));
    this.mesh.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }
}

/* ---------------------------- 지오메트리 ---------------------------- */
function pebbleGeometry(rng) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.scale(1, 0.62, 0.85);
  return roughen(g, 0.16, rng);
}

function fernGeometry(rng) {
  const parts = [];
  const leaves = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < leaves; i++) {
    const len = 0.5 + rng() * 0.45;
    const g = new THREE.PlaneGeometry(0.11, len, 1, 3);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = (p.getY(v) + len / 2) / len;
      p.setX(v, p.getX(v) * (1 - t * 0.8));
      p.setZ(v, t * t * 0.28);
      p.setY(v, p.getY(v) + len / 2);
    }
    g.computeVertexNormals();
    g.rotateX(-0.5 - rng() * 0.35);
    g.rotateY((i / leaves) * TAU + rng() * 0.4);
    parts.push(tint(g, new THREE.Color(0x55813a), 0.45, rng));
  }
  return mergeGeos(parts);
}

function mushroomGeometry(rng, capColor) {
  const stem = new THREE.CylinderGeometry(0.018, 0.026, 0.11, 6);
  stem.translate(0, 0.055, 0);
  const cap = new THREE.SphereGeometry(0.058, 8, 5, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.62, 1);
  cap.translate(0, 0.105, 0);
  return mergeGeos([tint(stem, new THREE.Color(0xe6ddc8)), tint(cap, capColor, 0.4, rng)]);
}

/** 낙엽 — 바닥에 겹쳐 깔린 마른 잎 몇 장 */
function litterGeometry(rng) {
  const parts = [];
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const len = 0.07 + rng() * 0.06, wid = len * (0.3 + rng() * 0.18);
    const segs = 2;
    const pos = [], idx = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const w = wid * Math.sin(Math.PI * clamp01(0.1 + t * 0.9)) ** 0.7;
      // 마른 잎은 가장자리가 말려 올라간다
      const y = Math.sin(t * Math.PI) * len * 0.12;
      pos.push(-w, y + w * 0.35, t * len, 0, y, t * len, w, y + w * 0.35, t * len);
    }
    for (let s = 0; s < segs; s++) {
      const a = s * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.rotateY(rng() * TAU);
    g.translate((rng() - 0.5) * 0.28, 0.004 + rng() * 0.01, (rng() - 0.5) * 0.28);
    const c = new THREE.Color().setHSL(0.07 + rng() * 0.06, 0.35 + rng() * 0.2, 0.42 + rng() * 0.16);
    parts.push(tint(g, c, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 이끼 — 흙과 풀 사이를 메우는 낮은 더껑이 */
function mossGeometry(rng) {
  const g = new THREE.CircleGeometry(0.22, 9);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (i === 0) { p.setY(i, 0.012); continue; }
    const jr = 0.55 + rng() * 0.75;                 // 테두리가 들쭉날쭉하다
    p.setXYZ(i, p.getX(i) * jr, (rng() - 0.3) * 0.02, p.getZ(i) * jr);
  }
  g.computeVertexNormals();
  return tint(g, new THREE.Color(0x5c7f42), 0.55, rng);
}

function stickGeometry(rng) {
  const g = new THREE.CylinderGeometry(0.025, 0.035, 1, 5);
  g.rotateZ(Math.PI / 2);
  roughen(g, 0.05, rng);
  return tint(g, new THREE.Color(0x5b4630), 0.5, rng);
}

/* ------------------------------------------------------------------ */
/* 잡동사니 레이어 묶음                                                 */
/* ------------------------------------------------------------------ */
export function buildClutter(scene, quality = 'high') {
  const rng = makeRng(4242);
  const q = quality === 'low' ? 0.45 : quality === 'medium' ? 0.7 : 1;
  const layers = [];

  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const plantMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), 1.0);

  // 돌멩이
  layers.push(new ScatterLayer(scene, {
    geometry: tint(pebbleGeometry(rng), new THREE.Color(0x8e8a80), 0.4, rng),
    material: stoneMat,
    perBlock: Math.round(24 * q), blocks: 100, cell: 16, radius: 70, castShadow: true,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      if (h < WATER_LEVEL - 0.4) return null;
      const surf = surfaceAt(x, z, h, slope);
      const chance = surf === SURFACE.ROCK ? 0.75 : surf === SURFACE.DIRT ? 0.4 : surf === SURFACE.SAND ? 0.5 : 0.16;
      if (r() > chance) return null;
      const sc = 0.08 + Math.pow(r(), 2.4) * 0.75;
      const n = normalAt(x, z, 0.8);
      const m = self.compose(x, h - sc * 0.18, z, r() * TAU, new THREE.Vector3(sc, sc * (0.6 + r() * 0.5), sc),
        Math.asin(-n.z) * 0.8, Math.asin(n.x) * 0.8);
      const v = 0.82 + r() * 0.34;
      return { matrix: m, color: new THREE.Color(v * 1.03, v, v * 0.94) };
    },
  }));

  // 고사리 / 덤불풀
  layers.push(new ScatterLayer(scene, {
    geometry: fernGeometry(rng),
    material: plantMat,
    perBlock: Math.round(26 * q), blocks: 84, cell: 14, radius: 55,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      const fert = fertilityAt(x, z, h, slope);
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;  // 숲 밀도와 같은 노이즈
      if (r() > fert * clamp01((shade - 0.34) * 2.4) * 1.35) return null;
      const sc = 0.7 + r() * 0.8;
      return {
        matrix: self.compose(x, h - 0.05, z, r() * TAU, sc, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12),
        color: new THREE.Color(0.86 + r() * 0.24, 0.9 + r() * 0.22, 0.8 + r() * 0.2),
      };
    },
  }));

  // 버섯
  layers.push(new ScatterLayer(scene, {
    geometry: mushroomGeometry(rng, new THREE.Color(0xffffff)),
    material: plantMat,
    perBlock: 9, blocks: 48, cell: 18, radius: 48,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;
      if (shade < 0.45 || slope > 0.3 || h < WATER_LEVEL + 0.6) return null;
      if (r() > 0.55) return null;
      const sc = 0.7 + r() * 1.1;
      const pal = [0xb4503c, 0xd9c9a8, 0x8a6a4a, 0xe2e0d4];
      return {
        matrix: self.compose(x, h, z, r() * TAU, sc, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2),
        color: new THREE.Color(pal[Math.floor(r() * pal.length * 0.999)]),
      };
    },
  }));

  // 낙엽 — 나무 밑동 둘레에 쌓인다. 흙과 풀 사이가 이어져 보인다
  layers.push(new ScatterLayer(scene, {
    geometry: litterGeometry(rng),
    material: plantMat,
    perBlock: Math.round(20 * q), blocks: 76, cell: 12, radius: 40, salt: 0x5a11,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      if (h < WATER_LEVEL + 0.2 || slope > 0.4) return null;
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;
      if (r() > clamp01((shade - 0.3) * 2.2) * 0.85) return null;
      const n = normalAt(x, z, 0.8);
      const sc = 0.65 + r() * 0.8;
      const v = 0.85 + r() * 0.3;
      return {
        matrix: self.compose(x, h + 0.01, z, r() * TAU, sc, Math.asin(-n.z), Math.asin(n.x)),
        color: new THREE.Color(v * 1.05, v * 0.96, v * 0.86),
      };
    },
  }));

  // 이끼 — 바위 곁과 그늘의 흙을 덮는다
  layers.push(new ScatterLayer(scene, {
    geometry: mossGeometry(rng),
    material: plantMat,
    perBlock: Math.round(12 * q), blocks: 64, cell: 14, radius: 42, salt: 0x3c77,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      if (h < WATER_LEVEL + 0.1) return null;
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;
      const wet = clamp01(1 - (h - WATER_LEVEL) / 8) * 0.5 + clamp01((shade - 0.35) * 2) * 0.7;
      if (r() > wet * 0.7) return null;
      const n = normalAt(x, z, 0.8);
      const sc = 0.6 + r() * 1.1;
      const v = 0.8 + r() * 0.35;
      return {
        matrix: self.compose(x, h - 0.025, z, r() * TAU, sc, Math.asin(-n.z), Math.asin(n.x)),
        color: new THREE.Color(v * 0.95, v * 1.02, v * 0.88),
      };
    },
  }));

  // 잔가지
  layers.push(new ScatterLayer(scene, {
    geometry: stickGeometry(rng),
    material: stoneMat,
    perBlock: 8, blocks: 58, cell: 18, radius: 55,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      if (h < WATER_LEVEL + 0.3 || slope > 0.35) return null;
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;
      if (r() > shade * 0.5) return null;
      const sc = 0.35 + r() * 0.9;
      const n = normalAt(x, z, 0.8);
      return {
        matrix: self.compose(x, h + 0.03, z, r() * TAU, sc, Math.asin(-n.z), Math.asin(n.x)),
        color: new THREE.Color().setHSL(0.09, 0.22, 0.2 + r() * 0.14),
      };
    },
  }));

  return layers;
}

export { windify };
