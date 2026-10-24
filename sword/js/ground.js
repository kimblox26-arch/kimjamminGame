// SKY BLADE — 지면 디테일: 풀 (바람에 흔들림), 바위 (화강암 노두·숲 바닥), 자갈
//  - 카메라 주변만 (풀 45 m, 자갈 25 m, 바위 220 m) 실제 토지 분류(공원·잔디·숲·바위)를 보고 흩뿌림
//  - 건물·도로·물 위에는 안 생김. 카메라가 움직이면 다시 배치 (결정적 해시라 같은 자리엔 같은 풀)
import * as THREE from 'three';
import { origin } from './frame.js';

function hash(ix, iz, s) {
  let h = Math.imul(ix ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(iz + s * 7919, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// 풀 한 포기: 가는 잎 7장 (아래 진하고 위로 밝아짐)
function grassGeo() {
  const pos = [], col = [], idx = [];
  for (let b = 0; b < 7; b++) {
    const a = b / 7 * Math.PI * 2 + b * 0.7, r = 0.04 + (b % 3) * 0.03, h = 0.28 + (b % 4) * 0.07, lean = 0.12 + (b % 2) * 0.1;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, dx = Math.cos(a + 1.57) * 0.018, dz = Math.sin(a + 1.57) * 0.018;
    const base = pos.length / 3;
    pos.push(cx - dx, 0, cz - dz, cx + dx, 0, cz + dz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    col.push(0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 1, 1, 1);
    idx.push(base, base + 1, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 잎 법선은 위쪽으로 (풀밭이 하늘빛을 받게)
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}
// 바위: 찌그러뜨린 이십면체
function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + 0.45 * hash(Math.round(x * 7 + seed), Math.round(y * 7 + z * 3), 3);
    p.setXYZ(i, x * k * 1.1, y * k * 0.7, z * k);
  }
  g.computeVertexNormals();
  return g;
}

export class GroundDetail {
  /** opts: { sample(x,z)→{h,urban,forest,park,rock,level}, roofAt(x,z), road(x,z) } */
  constructor(scene, opts) {
    this.o = opts;
    this.low = opts.quality === 'low';
    this.group = new THREE.Group(); this.group.name = 'groundDetail';
    scene.add(this.group);
    this.uTime = { value: 0 };
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 ip = instanceMatrix[3].xyz;
#else
vec3 ip = vec3(0.0);
#endif
float sway = sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.21) * 0.6 + sin(uTime * 3.1 + ip.x * 1.3) * 0.25;
transformed.xz += vec2(0.07, 0.04) * sway * transformed.y * transformed.y * 6.0;`);
    };
    this.grassMax = this.low ? 2500 : 7000;
    this.grass = new THREE.InstancedMesh(grassGeo(), gm, this.grassMax);
    this.grass.count = 0; this.grass.frustumCulled = false; this.grass.receiveShadow = true;
    this.grass.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.grassMax * 3), 3);
    this.group.add(this.grass);
    const rm = new THREE.MeshStandardMaterial({ color: 0x8b867e, roughness: 0.92, flatShading: true });
    this.rockMax = this.low ? 500 : 1500;
    this.rocks = new THREE.InstancedMesh(rockGeo(1), rm, this.rockMax);
    this.rocks.count = 0; this.rocks.frustumCulled = false; this.rocks.castShadow = true; this.rocks.receiveShadow = true;
    this.rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.rockMax * 3), 3);
    this.group.add(this.rocks);
    this.pebMax = this.low ? 600 : 1800;
    this.pebbles = new THREE.InstancedMesh(rockGeo(5), rm, this.pebMax);
    this.pebbles.count = 0; this.pebbles.frustumCulled = false; this.pebbles.receiveShadow = true;
    this.group.add(this.pebbles);
    this.gAt = null; this.rAt = null;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
    this._e = new THREE.Euler();
  }

  setLow(low) { this.low = low; this.gAt = null; this.rAt = null; }
  /** 표본 함수 교체 (다른 천체 표면) */
  setSource(o) { this.o = o; this.gAt = null; this.rAt = null; }

  update(dt, camAbs, show) {
    this.uTime.value += dt;
    this.group.position.set(-origin.x, -origin.y, -origin.z);
    if (this.enabled === false) { this.group.visible = false; return; }
    const agl = camAbs.y - this.o.sample(camAbs.x, camAbs.z).h;
    this.group.visible = show && agl < 400;
    if (!this.group.visible) return;
    if (!this.gAt || Math.hypot(camAbs.x - this.gAt.x, camAbs.z - this.gAt.z) > 7) { this.gAt = { x: camAbs.x, z: camAbs.z }; this._grass(camAbs); }
    if (!this.rAt || Math.hypot(camAbs.x - this.rAt.x, camAbs.z - this.rAt.z) > 40) { this.rAt = { x: camAbs.x, z: camAbs.z }; this._rocks(camAbs); }
  }

  _ok(x, z, S) {
    if (S.level > S.h - 0.2) return false;
    if (this.o.road && this.o.road(x, z)) return false;
    if (this.o.roofAt && this.o.roofAt(x, z) > S.h + 0.3) return false;
    return true;
  }

  _grass(cam) {
    const R = this.low ? 26 : 45, C = 2;
    const M = this._m, Q = this._q, Sc = this._s, P = this._p, col = this._c;
    let n = 0, pn = 0;
    const i0 = Math.floor((cam.x - R) / C), i1 = Math.floor((cam.x + R) / C), j0 = Math.floor((cam.z - R) / C), j1 = Math.floor((cam.z + R) / C);
    for (let j = j0; j <= j1 && n < this.grassMax; j++) for (let i = i0; i <= i1 && n < this.grassMax; i++) {
      const cx = (i + 0.5) * C, cz = (j + 0.5) * C;
      const d = Math.hypot(cx - cam.x, cz - cam.z);
      if (d > R) continue;
      const S = this.o.sample(cx, cz);
      const w = S.park * 1.0 + S.forest * 0.45 - S.urban * 1.2 - S.rock * 0.6;
      const fade = 1 - Math.max(0, (d - R * 0.6) / (R * 0.4)) * 0.7;
      const k = Math.min(4, Math.floor((w * 4 + hash(i, j, 1) * 1.2) * fade));
      if (k <= 0) {
        // 자갈: 오솔길·숲 바닥·바위 근처
        if (d < 25 && pn < this.pebMax && hash(i, j, 9) < 0.25 + S.rock * 0.5 + S.forest * 0.2 && this._ok(cx, cz, S)) {
          for (let q = 0; q < 3 && pn < this.pebMax; q++) {
            const x = cx + (hash(i, j, 20 + q) - 0.5) * C, z = cz + (hash(i, j, 30 + q) - 0.5) * C;
            const s = 0.04 + hash(i, j, 40 + q) * 0.12;
            Q.setFromEuler(this._e.set(hash(i, j, 50 + q) * 6, hash(i, j, 60 + q) * 6, 0));
            this.pebbles.setMatrixAt(pn++, M.compose(P.set(x, this.o.sample(x, z).h + s * 0.25, z), Q, Sc.set(s, s, s)));
          }
        }
        continue;
      }
      if (!this._ok(cx, cz, S)) continue;
      for (let q = 0; q < k && n < this.grassMax; q++) {
        const x = cx + (hash(i, j, 2 + q) - 0.5) * C, z = cz + (hash(i, j, 7 + q) - 0.5) * C;
        const h = this.o.sample(x, z).h;
        const s = 0.7 + hash(i, j, 12 + q) * 0.9;
        Q.setFromAxisAngle(_Y, hash(i, j, 17 + q) * 6.283);
        this.grass.setMatrixAt(n, M.compose(P.set(x, h - 0.02, z), Q, Sc.set(s, s * (0.8 + 0.5 * S.park), s)));
        // 10월 풀빛: 초록 ~ 마른 황록
        const dry = hash(i, j, 22 + q) * 0.6 + S.forest * 0.2;
        col.setRGB(0.085 + 0.09 * dry, 0.15 + 0.03 * dry, 0.04 + 0.01 * dry);
        this.grass.setColorAt(n, col);
        n++;
      }
    }
    this.grass.count = n; this.grass.instanceMatrix.needsUpdate = true; this.grass.instanceColor.needsUpdate = true;
    this.pebbles.count = pn; this.pebbles.instanceMatrix.needsUpdate = true;
  }

  _rocks(cam) {
    const R = this.low ? 130 : 220, C = 9;
    const M = this._m, Q = this._q, Sc = this._s, P = this._p, col = this._c;
    let n = 0;
    const i0 = Math.floor((cam.x - R) / C), i1 = Math.floor((cam.x + R) / C), j0 = Math.floor((cam.z - R) / C), j1 = Math.floor((cam.z + R) / C);
    for (let j = j0; j <= j1 && n < this.rockMax; j++) for (let i = i0; i <= i1 && n < this.rockMax; i++) {
      const cx = (i + 0.5) * C, cz = (j + 0.5) * C;
      if (Math.hypot(cx - cam.x, cz - cam.z) > R) continue;
      const r = hash(i, j, 70);
      if (r > 0.6) continue;
      const S = this.o.sample(cx, cz);
      const p = S.rock * 0.9 + S.forest * 0.12 + S.park * 0.02;
      if (r > p) continue;
      const x = cx + (hash(i, j, 71) - 0.5) * C, z = cz + (hash(i, j, 72) - 0.5) * C;
      const S2 = this.o.sample(x, z);
      if (!this._ok(x, z, S2)) continue;
      const big = S.rock > 0.5 ? 1.2 + hash(i, j, 73) * 2.6 : 0.35 + hash(i, j, 74) * 0.9;
      Q.setFromEuler(this._e.set((hash(i, j, 75) - 0.5) * 0.5, hash(i, j, 76) * 6.283, (hash(i, j, 77) - 0.5) * 0.5));
      this.rocks.setMatrixAt(n, M.compose(P.set(x, S2.h - big * 0.25, z), Q, Sc.set(big, big * (0.6 + hash(i, j, 78) * 0.5), big * (0.8 + hash(i, j, 79) * 0.4))));
      const t = 0.85 + hash(i, j, 80) * 0.3;
      if (this.o.rockCol) col.setRGB(this.o.rockCol[0] * t, this.o.rockCol[1] * t, this.o.rockCol[2] * t);
      else col.setRGB(0.42 * t, 0.4 * t, 0.37 * t);
      if (S.forest > 0.5) col.lerp(this._c.clone().setRGB(0.2, 0.24, 0.14), 0.35);   // 이끼
      this.rocks.setColorAt(n, col);
      n++;
    }
    this.rocks.count = n; this.rocks.instanceMatrix.needsUpdate = true; this.rocks.instanceColor.needsUpdate = true;
  }
}
const _Y = new THREE.Vector3(0, 1, 0);
