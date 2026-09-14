// 고요(GOYO) — 초목: 풀·꽃·돌·나무
// 풀과 자잘한 오브젝트는 플레이어 주변 셀에만 채워 넣고 재활용한다.
import * as THREE from 'three';
import { clamp01, lerp, makeRng, smoothstep, TAU } from '../core/utils.js';
import { heightAt, normalAt, slopeAt, sampleGround, fertilityAt, surfaceAt, SURFACE, WATER_LEVEL, LAKE, INNER_HALF, fbm2 } from './terrain.js';

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
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
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
const GRASS_VERT = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform vec3 uPlayer;
attribute vec3 instanceColorA;
varying vec3 vColor;
varying float vH;
varying vec3 vNormalW;
varying float vFogDepth;

void main() {
  vColor = instanceColorA;
  float h = uv.y;                         // 0 = 밑동, 1 = 끝
  vH = h;

  vec4 world = instanceMatrix * vec4(position, 1.0);
  vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  // 바람: 큰 물결 + 잔떨림
  float phase = base.x * 0.12 + base.z * 0.15;
  float gust = sin(uTime * 1.1 + phase) * 0.6 + sin(uTime * 2.7 + phase * 1.7) * 0.25;
  float bend = (gust * 0.55 + 0.25) * uWind * h * h;
  world.xz += uWindDir * bend;
  world.y -= abs(bend) * 0.18;

  // 플레이어가 지나가면 풀이 눕는다
  vec3 d = world.xyz - uPlayer;
  d.y = 0.0;
  float dist = length(d);
  float push = smoothstep(1.35, 0.15, dist) * h;
  world.xz += normalize(d.xz + vec2(0.0001)) * push * 0.55;
  world.y -= push * 0.28;

  vNormalW = normalize(mat3(instanceMatrix) * normal);
  vec4 mv = viewMatrix * world;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GRASS_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float uWet;
varying vec3 vColor;
varying float vH;
varying vec3 vNormalW;
varying float vFogDepth;

void main() {
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  float ndl = max(dot(n, uSunDir), 0.0);
  // 잎을 통과하는 빛 (서브서피스 흉내)
  float trans = pow(max(dot(-n, uSunDir), 0.0), 1.6) * 0.5;
  vec3 amb = mix(uAmbGround, uAmbSky, 0.5 + 0.5 * n.y);
  float ao = mix(0.45, 1.0, vH);          // 밑동은 어둡게
  // 비에 젖으면 짙어진다
  vec3 albedo = vColor * mix(1.0, 0.68, uWet);
  vec3 col = albedo * (amb * ao + uSunColor * (ndl * 0.85 + trans) * ao);
  gl_FragColor = vec4(col, 1.0);
  float f = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, f);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function bladeStrip(pos, nrm, uvs, idx, segments, w, ox, oz, rot, curveDir, height) {
  const base = pos.length / 3;
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const width = w * (1 - t * 0.9);
    const y = t * height;
    const curve = t * t * curveDir;
    for (const side of [-1, 1]) {
      const lx = side * width, lz = curve;
      pos.push(ox + lx * c - lz * s, y, oz + lx * s + lz * c);
      nrm.push(-s * 0.2, 0.3, c);
      uvs.push(side * 0.5 + 0.5, t);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = base + i * 2, b = a + 1, cc = a + 2, d = a + 3;
    idx.push(a, cc, b, b, cc, d);
  }
}

/** 잎 세 장이 한 포기를 이룬다 — 인스턴스 수 대비 훨씬 빽빽해 보인다 */
function tuftGeometry(segments = 4, blades = 3) {
  const pos = [], nrm = [], uvs = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const rot = (b / blades) * TAU + 0.4;
    const r = b === 0 ? 0 : 0.022;
    bladeStrip(pos, nrm, uvs, idx, segments, 0.021,
      Math.cos(rot) * r, Math.sin(rot) * r, rot,
      0.16 + b * 0.07, 1 - b * 0.14);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

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
    // 멀어진 셀 회수
    for (const [k, block] of this.active) {
      if (!need.has(k)) { this.active.delete(k); this.free.push(block); this._onRelease?.(block); }
    }
    // 가까운 셀부터 채운다
    this.queue = this.queue.filter((q) => need.has(q.k));
    for (const q of this.queue) {
      q.d = Math.hypot(q.cx * c + c * 0.5 - px, q.cz * c + c * 0.5 - pz);
    }
    this.queue.sort((a, b) => a.d - b.d);
  }

  _queued(k) { return this.queue.some((q) => q.k === k); }

  /** 프레임당 최대 n개 셀 채우기 */
  fill(n, filler) {
    let done = 0;
    while (done < n && this.queue.length && this.free.length) {
      const { k, cx, cz } = this.queue.shift();
      const block = this.free.pop();
      this.active.set(k, block);
      filler(block, cx, cz);
      done++;
    }
    return done;
  }
}

/* 품질별 잔디 링 구성 — 가까운 링은 빽빽하게, 먼 링은 크고 성기게 */
const GRASS_RINGS = {
  low: [
    { cell: 6, radius: 16, minRadius: 0, perBlock: 300, blocks: 46, size: 1.0 },
    { cell: 14, radius: 36, minRadius: 14, perBlock: 175, blocks: 44, size: 1.5 },
  ],
  medium: [
    { cell: 6, radius: 19, minRadius: 0, perBlock: 330, blocks: 60, size: 1.0 },
    { cell: 13, radius: 46, minRadius: 17, perBlock: 200, blocks: 70, size: 1.5 },
  ],
  high: [
    { cell: 6, radius: 24, minRadius: 0, perBlock: 460, blocks: 80, size: 1.0 },
    { cell: 12, radius: 60, minRadius: 22, perBlock: 260, blocks: 116, size: 1.55 },
  ],
  ultra: [
    { cell: 6, radius: 30, minRadius: 0, perBlock: 620, blocks: 120, size: 1.0 },
    { cell: 12, radius: 78, minRadius: 28, perBlock: 330, blocks: 190, size: 1.6 },
  ],
};

/** 잔디 링 하나 */
class GrassRing {
  constructor(scene, cfg, material, colorsShared) {
    this.perBlock = cfg.perBlock;
    this.count = cfg.perBlock * cfg.blocks;
    this.size = cfg.size;
    this.pool = new CellPool(cfg);

    const geo = new THREE.InstancedBufferGeometry();
    const blade = tuftGeometry(3, 3);
    geo.setAttribute('position', blade.attributes.position);
    geo.setAttribute('normal', blade.attributes.normal);
    geo.setAttribute('uv', blade.attributes.uv);
    geo.setIndex(blade.index);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
    geo.setAttribute('instanceColorA', this.colors);

    this.mesh = new THREE.InstancedMesh(geo, material, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'grass';
    scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this._base = new THREE.Color(0x5c6d37);

    this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pool._onRelease = (block) => this._hideBlock(block);
  }

  _hideBlock(block) {
    this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
    const start = block * this.perBlock;
    for (let i = 0; i < this.perBlock; i++) this.mesh.setMatrixAt(start + i, this._m);
    this._dirty = true;
  }

  _fillBlock(block, cx, cz) {
    const cell = this.pool.cell;
    const rng = makeRng((cx * 73856093) ^ (cz * 19349663) ^ 0x9e37);
    const start = block * this.perBlock;
    for (let i = 0; i < this.perBlock; i++) {
      const x = cx * cell + rng() * cell;
      const z = cz * cell + rng() * cell;
      const { h, slope } = sampleGround(x, z);
      const fert = fertilityAt(x, z, h, slope);
      const surf = surfaceAt(x, z, h, slope);
      const ok = fert > 0.1 && rng() < fert * (surf === SURFACE.GRASS ? 1.15 : surf === SURFACE.DIRT ? 0.45 : 0.06);
      if (!ok) {
        this._m.compose(this._p.set(0, -999, 0), this._q, this._s.set(0, 0, 0));
        this.mesh.setMatrixAt(start + i, this._m);
        continue;
      }
      // 짧은 풀이 많고 이따금 긴 풀이 섞여야 바닥이 촘촘해 보인다
      const r1 = rng();
      const tall = (0.12 + r1 * r1 * 0.66) * lerp(0.65, 1.35, fert);
      const nearWater = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 12 && h < WATER_LEVEL + 1.6;
      const height = (nearWater ? tall * 2.2 : tall) * this.size;
      this._e.set(0, rng() * TAU, (rng() - 0.5) * 0.25);
      this._q.setFromEuler(this._e);
      this._p.set(x, h - 0.03, z);
      const w = (0.8 + rng() * 0.6) * this.size;
      this._s.set(w, height, w);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(start + i, this._m);

      this._c.copy(this._base);
      const dry = fbm2(x * 0.03 + 17.3, z * 0.03 - 9.2, 2) * 0.5 + 0.5;
      this._c.offsetHSL((rng() - 0.5) * 0.05 + dry * 0.035,
        (rng() - 0.5) * 0.16 - dry * 0.12, (rng() - 0.45) * 0.12 + fert * 0.05);
      if (nearWater) this._c.offsetHSL(0.01, 0.05, -0.02);
      this.colors.setXYZ(start + i, this._c.r, this._c.g, this._c.b);
    }
    this._dirty = true;
    this.colors.needsUpdate = true;
  }

  flush() {
    if (this._dirty) { this.mesh.instanceMatrix.needsUpdate = true; this._dirty = false; }
  }
}

/** 여러 링을 묶은 잔디밭 — 프레임당 시간 예산 안에서 조금씩 채운다 */
export class GrassField {
  constructor(scene, quality = 'high') {
    const rings = GRASS_RINGS[quality] || GRASS_RINGS.high;
    this.uniforms = {
      uTime: WIND.time,
      uWind: WIND.strength,
      uWindDir: WIND.dir,
      uPlayer: WIND.player,
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uAmbSky: { value: new THREE.Color(0x88aacc) },
      uAmbGround: { value: new THREE.Color(0x3a3a2a) },
      fogColor: { value: new THREE.Color(0xc6d6e4) },
      fogNear: { value: 30 },
      fogFar: { value: 400 },
      uWet: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      side: THREE.DoubleSide,
    });
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
      ring.flush();
      ring.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  syncLighting(sky) {
    const u = this.uniforms;
    u.uSunDir.value.copy(sky.sunDir.y > 0 ? sky.sunDir : sky.moonDir);
    u.uSunColor.value.copy(sky.sunLight.color)
      .multiplyScalar(Math.max(sky.sunLight.intensity * 0.32, sky.moonLight.intensity * 0.5));
    u.uAmbSky.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.55);
    u.uAmbGround.value.copy(sky.hemi.groundColor).multiplyScalar(sky.hemi.intensity * 0.5);
    u.fogColor.value.copy(sky.scene.fog.color);
    u.fogNear.value = sky.scene.fog.near;
    u.fogFar.value = sky.scene.fog.far;
  }
}

/* ------------------------------------------------------------------ */
/* 지면 잡동사니 (돌멩이·꽃·고사리·버섯·나뭇가지)                         */
/* ------------------------------------------------------------------ */
/** 바람에 흔들리는 식물용 재질 패치 */
function windify(material, factor = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.time;
    shader.uniforms.uWind = WIND.strength;
    shader.uniforms.uWindDir = WIND.dir;
    shader.uniforms.uPlayer = WIND.player;
    shader.uniforms.uSwayK = { value: factor };
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
          mvPosition = viewMatrix * wp4;
        }
        gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => 'windify' + factor;
  return material;
}

/** 셀 풀로 관리되는 산포 레이어 */
export class ScatterLayer {
  constructor(scene, { geometry, material, perBlock, blocks, cell, radius, place, castShadow = false }) {
    this.perBlock = perBlock;
    this.count = perBlock * blocks;
    this.place = place;
    this.pool = new CellPool({ cell, radius, blocks, perBlock });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    this.mesh.name = 'clutter';
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
    const rng = makeRng((cx * 73856093) ^ (cz * 19349663) ^ 0x51ed);
    const start = block * this.perBlock;
    for (let i = 0; i < this.perBlock; i++) {
      const x = cx * cell + rng() * cell;
      const z = cz * cell + rng() * cell;
      const res = this.place(x, z, rng, this);
      if (!res) { this.mesh.setMatrixAt(start + i, this._hidden); continue; }
      this.mesh.setMatrixAt(start + i, res.matrix || this._m);
      if (res.color) this.mesh.instanceColor.setXYZ(start + i, res.color.r, res.color.g, res.color.b);
      else this.mesh.instanceColor.setXYZ(start + i, 1, 1, 1);
    }
    this._dirty = true;
    this.mesh.instanceColor.needsUpdate = true;
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

function flowerGeometry(rng, petalColor) {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.006, 0.009, 0.22, 4);
  stem.translate(0, 0.11, 0);
  parts.push(tint(stem, new THREE.Color(0x5d7a37)));
  const petals = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < petals; i++) {
    const p = new THREE.PlaneGeometry(0.042, 0.03);
    p.rotateX(-Math.PI / 2.4);
    p.translate(0, 0.225, 0.027);
    p.rotateY((i / petals) * TAU);
    parts.push(tint(p, petalColor, 0.5, rng));
  }
  const core = new THREE.SphereGeometry(0.014, 5, 4);
  core.translate(0, 0.228, 0);
  parts.push(tint(core, new THREE.Color(0xe8c44a)));
  return mergeGeos(parts);
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
    parts.push(tint(g, new THREE.Color(0x3f6a2c), 0.5, rng));
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
      return { matrix: m, color: new THREE.Color().setHSL(0.09, 0.05 + r() * 0.06, 0.42 + r() * 0.22) };
    },
  }));

  // 꽃
  const flowerColors = [0xf4f1e6, 0xf2ead0, 0xe9d76a, 0xf0f0f0, 0xd9a0b4, 0xb3a6d6, 0xe0b36a];
  layers.push(new ScatterLayer(scene, {
    geometry: flowerGeometry(rng, new THREE.Color(0xffffff)),
    material: plantMat,
    perBlock: Math.round(28 * q), blocks: 92, cell: 14, radius: 58,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      const surf = surfaceAt(x, z, h, slope);
      if (surf !== SURFACE.GRASS) return null;
      const fert = fertilityAt(x, z, h, slope);
      const patch = fbm2(x * 0.05 + 88, z * 0.05 - 41, 2) * 0.5 + 0.5;
      if (r() > fert * patch * 1.5) return null;
      const sc = 0.55 + r() * 0.6;
      const ci = Math.floor(clamp01(fbm2(x * 0.01, z * 0.01, 2) * 0.5 + 0.5) * flowerColors.length * 0.999);
      return {
        matrix: self.compose(x, h, z, r() * TAU, sc, (r() - 0.5) * 0.18, (r() - 0.5) * 0.18),
        color: new THREE.Color(flowerColors[ci]).offsetHSL(0, (r() - 0.5) * 0.1, (r() - 0.5) * 0.12),
      };
    },
  }));

  // 고사리 / 덤불풀
  layers.push(new ScatterLayer(scene, {
    geometry: fernGeometry(rng),
    material: plantMat,
    perBlock: Math.round(16 * q), blocks: 84, cell: 14, radius: 55,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      const fert = fertilityAt(x, z, h, slope);
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;  // 숲 밀도와 같은 노이즈
      if (r() > fert * clamp01((shade - 0.3) * 2) * 0.9) return null;
      const sc = 0.7 + r() * 0.8;
      return {
        matrix: self.compose(x, h - 0.05, z, r() * TAU, sc, (r() - 0.5) * 0.12, (r() - 0.5) * 0.12),
        color: new THREE.Color().setHSL(0.26 + (r() - 0.5) * 0.03, 0.42, 0.3 + r() * 0.16),
      };
    },
  }));

  // 버섯
  layers.push(new ScatterLayer(scene, {
    geometry: mushroomGeometry(rng, new THREE.Color(0xffffff)),
    material: plantMat,
    perBlock: 5, blocks: 48, cell: 18, radius: 48,
    place(x, z, r, self) {
      const { h, slope } = sampleGround(x, z);
      const shade = fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5;
      if (shade < 0.45 || slope > 0.3 || h < WATER_LEVEL + 0.6) return null;
      if (r() > 0.35) return null;
      const sc = 0.7 + r() * 1.1;
      const pal = [0xb4503c, 0xd9c9a8, 0x8a6a4a, 0xe2e0d4];
      return {
        matrix: self.compose(x, h, z, r() * TAU, sc, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2),
        color: new THREE.Color(pal[Math.floor(r() * pal.length * 0.999)]),
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
