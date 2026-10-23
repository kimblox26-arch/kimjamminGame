// SKY BLADE — 솟아 있는 3D 나무 (카메라 주변)
//  - 지형의 숲/공원 값(terrainSample)으로 배치: 산은 침엽수 위주, 공원·도시 가로수는 활엽수
//  - 128 m 타일 단위로 결정적 생성 → 절대 좌표 캐시 (다시 와도 같은 자리에 같은 나무)
//  - 물·도로·건물·급경사 바위는 피함. 인스턴스 버퍼는 타일이 바뀌거나 원점이 옮겨질 때만 다시 씀
//  - 정점 셰이더에서 바람에 흔들림 (높이에 비례, 나무마다 위상 다름)
import * as THREE from 'three';
import { terrainSample, roadAt } from './terrain.js';
import { origin, onRebase } from './frame.js';

const TILE = 128;

function hash(x, z, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 부드러운 2D 값 노이즈 (숲/잔디밭이 덩어리지게)
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, 11), b = hash(ix + 1, iz, 11), c = hash(ix, iz + 1, 11), d = hash(ix + 1, iz + 1, 11);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// 정점 색을 칠한 지오메트리 합치기 (위치/법선/색)
function merge(parts) {
  let n = 0, m = 0;
  for (const p of parts) { n += p.g.attributes.position.count; m += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = [];
  let o = 0;
  for (const { g, c } of parts) {
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], (o + i) * 3);
      nor.set([N.getX(i), N.getY(i), N.getZ(i)], (o + i) * 3);
      const k = 0.85 + 0.3 * hash(i, o, 7);
      col.set([c[0] * k, c[1] * k, c[2] * k], (o + i) * 3);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o);
    else for (let i = 0; i < P.count; i++) idx.push(i + o);
    o += P.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// 울퉁불퉁한 수관 (정이십면체를 노이즈로 부풀림)
function lumpy(r, detail, sy, seed) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const k = 0.8 + 0.35 * hash(Math.round(x * 50), Math.round(y * 50) + Math.round(z * 31), seed);
    P.setXYZ(i, x * k, y * k * sy, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// 높이 1 m 기준 (인스턴스 스케일로 키 조절)
function conifer(low) {
  const s = low ? 6 : 8;
  const trunk = new THREE.CylinderGeometry(0.018, 0.03, 0.3, 5, 1, true).translate(0, 0.15, 0);
  const parts = [{ g: trunk, c: [0.06, 0.04, 0.025] }];
  const tiers = low ? [[0.2, 0.5, 0.17], [0.45, 0.45, 0.13]] : [[0.18, 0.4, 0.19], [0.38, 0.38, 0.155], [0.58, 0.32, 0.115], [0.76, 0.24, 0.075]];
  for (const [y, h, r] of tiers) parts.push({ g: new THREE.ConeGeometry(r, h, s, 1, true).translate(0, y + h / 2, 0), c: [0.018, 0.05, 0.022] });
  return merge(parts);
}
function broadleaf(low) {
  const trunk = new THREE.CylinderGeometry(0.025, 0.045, 0.5, 5, 1, true).translate(0, 0.25, 0);
  const parts = [{ g: trunk, c: [0.07, 0.05, 0.032] }];
  parts.push({ g: lumpy(0.3, 1, 0.85, 3).translate(0, 0.66, 0), c: [0.045, 0.1, 0.025] });
  if (!low) {
    parts.push({ g: lumpy(0.2, 1, 0.9, 5).translate(0.17, 0.56, 0.08), c: [0.055, 0.115, 0.03] });
    parts.push({ g: lumpy(0.19, 1, 0.9, 9).translate(-0.13, 0.6, -0.12), c: [0.038, 0.085, 0.022] });
  }
  return merge(parts);
}

const WIND = /* glsl */`
vec3 transformed = vec3(position);
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]) + uOrigin;
  float ph = dot(ip.xz, vec2(0.071, 0.053));
  float hy = max(position.y - 0.25, 0.0);
  float bend = hy * hy * (0.035 * sin(uTime * 1.3 + ph) + 0.015 * sin(uTime * 3.1 + ph * 1.7));
  transformed.x += bend * 0.8;
  transformed.z += bend * 0.5;
}
`;

export class Trees {
  constructor(renderer, scene, opts = {}) {
    const low = opts.quality === 'low';
    this.low = low;
    this.radius = low ? 520 : 900;
    this.max = low ? 12000 : 40000;
    this.uniforms = { uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() } };
    const mkMat = () => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMap: opts.envMap || null, envMapIntensity: 0.15, side: THREE.DoubleSide });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.uniforms);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uOrigin;')
          .replace('#include <begin_vertex>', WIND);
      };
      m.customProgramCacheKey = () => 'sky-blade-tree';
      return m;
    };
    this.kinds = [conifer(low), broadleaf(low)].map((g) => {
      const mesh = new THREE.InstancedMesh(g, mkMat(), this.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = !low;
      mesh.receiveShadow = true;
      mesh.name = 'trees';
      scene.add(mesh);
      return mesh;
    });
    this.tiles = new Map();     // key → { c: Float32Array[x,y,z,s,rot,kind,...], n }
    this.active = [];
    this.dirty = true;
    this.cx = 1e9; this.cz = 1e9;
    this.time = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.footprint = opts.footprint || null;   // (x,z) → 건물 지붕 높이 (-Inf = 없음)
    onRebase(() => { this.dirty = true; });
  }

  setRadius(r) { if (r !== this.radius) { this.radius = r; this.cx = 1e9; } }

  _gen(ix, iz) {
    const out = [];
    const cell = this.low ? 9 : 6.5;
    const n = Math.floor(TILE / cell);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r1 = hash(ix * n + i, iz * n + j, 1);
      const x = ix * TILE + (i + 0.15 + 0.7 * hash(ix * n + i, iz * n + j, 2)) * cell;
      const z = iz * TILE + (j + 0.15 + 0.7 * hash(ix * n + i, iz * n + j, 3)) * cell;
      const S = terrainSample(x, z);
      if (S.level > S.h - 0.3) continue;                    // 물·물가
      if (x * x + z * z < 900) continue;                    // 스폰 자리는 비워 둠
      const street = S.urban > 0.25 ? 0.05 : 0;
      const clump = vnoise(x / 70, z / 70) * 0.65 + vnoise(x / 23, z / 23) * 0.35;
      const p = Math.min(1, S.forest * 1.05 * (0.55 + 0.6 * clump) + S.park * 0.6 * Math.max(0, clump * 1.8 - 0.75) + street) * (1 - S.rock * 0.9);
      if (r1 > p) continue;
      const h0 = S.h, mount = S.forest > S.park && S.urban < 0.3;
      if (h0 > 1150) continue;                              // 수목한계
      if (roadAt(x, z)) continue;
      if (this.footprint && this.footprint(x, z) > h0 + 0.5) continue;
      const coni = hash(ix * n + i, iz * n + j, 4) < (mount ? 0.4 + Math.min(0.5, h0 / 900) : 0.12);
      const r2 = hash(ix * n + i, iz * n + j, 5);
      const ht = coni ? 9 + 13 * r2 : 7 + 9 * r2;
      out.push(x, h0 - 0.3, z, ht, hash(ix * n + i, iz * n + j, 6) * 6.283, coni ? 0 : 1);
    }
    return { c: new Float32Array(out), n: out.length / 6 };
  }

  update(dt, camera, camAbs, agl) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uOrigin.value.copy(origin);
    const show = agl < 3500;
    for (const m of this.kinds) m.visible = show && m.count > 0;
    if (!show) return;
    const cx = Math.floor(camAbs.x / TILE), cz = Math.floor(camAbs.z / TILE);
    const R = Math.ceil(this.radius / TILE);
    if (cx !== this.cx || cz !== this.cz || this.pending) {
      this.cx = cx; this.cz = cz;
      // 필요한 타일 (가까운 것부터), 프레임당 생성 개수 제한
      const want = [];
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        const d = Math.hypot(i, j) * TILE;
        if (d <= this.radius + TILE) want.push([d, cx + i, cz + j]);
      }
      want.sort((a, b) => a[0] - b[0]);
      let budget = this.tiles.size === 0 ? 400 : (this.low ? 3 : 6);
      const keep = new Set();
      this.pending = false;
      this.active = [];
      for (const [, ix, iz] of want) {
        const key = ix * 100003 + iz;
        let t = this.tiles.get(key);
        if (!t) { if (budget-- <= 0) { this.pending = true; continue; } t = this._gen(ix, iz); this.tiles.set(key, t); }
        keep.add(key);
        this.active.push(t);
      }
      if (this.tiles.size > keep.size * 2 + 200) for (const k of this.tiles.keys()) if (!keep.has(k)) this.tiles.delete(k);
      this.dirty = true;
    }
    if (this.dirty) this._write();
  }

  _write() {
    this.dirty = false;
    const cnt = [0, 0];
    const [mc, mb] = this.kinds;
    const M = this._m, Q = this._q, V = this._v, S = this._s, up = V.set(0, 1, 0).clone();
    for (const t of this.active) {
      const c = t.c;
      for (let k = 0; k < t.n; k++) {
        const o = k * 6, kind = c[o + 5];
        const mesh = kind === 0 ? mc : mb;
        if (cnt[kind] >= this.max) continue;
        Q.setFromAxisAngle(up, c[o + 4]);
        const h = c[o + 3], w = kind === 0 ? h * 0.9 : h * (0.95 + 0.25 * ((c[o + 4] * 7.13) % 1));
        S.set(w, h, w);
        V.set(c[o] - origin.x, c[o + 1] - origin.y, c[o + 2] - origin.z);
        M.compose(V, Q, S);
        mesh.setMatrixAt(cnt[kind]++, M);
      }
    }
    mc.count = cnt[0]; mb.count = cnt[1];
    mc.instanceMatrix.needsUpdate = true; mb.instanceMatrix.needsUpdate = true;
    this.count = cnt[0] + cnt[1];
  }
}
