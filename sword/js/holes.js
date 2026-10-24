// SKY BLADE — 땅에 뚫린 구멍·굴 (파고든 길, 빔이 뚫은 굴, 충돌 구덩이)
//  - 구멍 = 캡슐 (선분 a→b, 반지름 r, 절대 좌표). 지형·도로 셰이더가 캡슐 안 조각을 버림 (가까운 16개)
//  - 굴 벽: 안쪽을 보는 암석 원통 + 끝 반구 (지표 위로 삐져나온 부분은 지표 높이에서 잘라냄)
//  - 물리: 캡슐 안에서는 지형 대신 굴 바닥을 밟고, 벽 밖으로는 못 나감 → 모든 구멍에 들어갈 수 있음
import * as THREE from 'three';
import { origin } from './frame.js';

export const NGH = 16;
export const GH_U = {
  uGHA: { value: Array.from({ length: NGH }, () => new THREE.Vector4(0, -1e9, 0, 0)) },
  uGHB: { value: Array.from({ length: NGH }, () => new THREE.Vector4(0, -1e9, 0, 0)) },
  uGHN: { value: 0 },
};
// 셰이더 조각: p (렌더 좌표) 가 구멍 안이면 true
export const GH_GLSL = /* glsl */`
uniform vec4 uGHA[${NGH}];
uniform vec4 uGHB[${NGH}];
uniform float uGHN;
bool gHole(vec3 p) {
  for (int i = 0; i < ${NGH}; i++) {
    if (float(i) >= uGHN) break;
    vec3 a = uGHA[i].xyz, ab = uGHB[i].xyz - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    if (length(p - a - ab * t) < uGHA[i].w) return true;
  }
  return false;
}`;

const MAX = 96;
const _q = new THREE.Quaternion(), _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();

export class GroundHoles {
  constructor(scene, heightAt) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.list = [];          // { ax, ay, az, bx, by, bz, r, mesh, top }
    this.group = new THREE.Group(); this.group.name = 'groundHoles';
    scene.add(this.group);
    this.cyl = new THREE.CylinderGeometry(1, 1, 1, 22, 1, true);
    this.cap = new THREE.SphereGeometry(1, 22, 12);
    this.inTunnel = false;
  }

  _mat(top) {
    const m = new THREE.MeshStandardMaterial({ color: 0x5a4c40, roughness: 1, metalness: 0, side: THREE.BackSide });
    const uTop = { value: top };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTop = uTop; sh.uniforms.uOy = this._uOy || (this._uOy = { value: 0 });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vHW;
uniform float uTop, uOy;
float hh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh3(i), hh3(i + vec3(1,0,0)), f.x), mix(hh3(i + vec3(0,1,0)), hh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hh3(i + vec3(0,0,1)), hh3(i + vec3(1,0,1)), f.x), mix(hh3(i + vec3(0,1,1)), hh3(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vHW.y + uOy > uTop) discard;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{ float n = vn3(vHW * 0.9) * 0.5 + vn3(vHW * 3.1) * 0.3 + vn3(vHW * 11.0) * 0.2;
  // 지표 가까이는 흙, 깊을수록 암석
  float soil = smoothstep(-4.0, -0.5, vHW.y + uOy - uTop);
  diffuseColor.rgb = mix(vec3(0.3, 0.28, 0.26), vec3(0.32, 0.22, 0.13), soil) * (0.55 + 0.9 * n); }`);
    };
    m.customProgramCacheKey = () => 'sky-hole';
    m._uTop = uTop;
    return m;
  }

  /** 구멍 추가 (절대 좌표). 같은 사슬이면 이어 붙음 */
  add(ax, ay, az, bx, by, bz, r) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    // 지표 위로 삐져나온 부분을 잘라낼 높이: 끝점이 지표 가까이면 그 지표 높이
    const ga = this.heightAt(ax, az), gb = this.heightAt(bx, bz);
    let top = 1e9;
    if (ay > ga - r * 1.5) top = Math.min(top, ga + 0.05);
    if (by > gb - r * 1.5) top = Math.min(top, gb + 0.05);
    const mat = this._mat(top);
    const g = new THREE.Group();
    const c = new THREE.Mesh(this.cyl, mat);
    c.scale.set(r, Math.max(len, 0.01), r);
    _d.set(bx - ax, by - ay, bz - az);
    if (len > 1e-3) c.quaternion.setFromUnitVectors(_y, _d.normalize());
    c.position.set((bx - ax) / 2, (by - ay) / 2, (bz - az) / 2);
    const e1 = new THREE.Mesh(this.cap, mat); e1.scale.setScalar(r);
    const e2 = new THREE.Mesh(this.cap, mat); e2.scale.setScalar(r); e2.position.set(bx - ax, by - ay, bz - az);
    for (const m of [c, e1, e2]) { m.receiveShadow = true; m.frustumCulled = false; g.add(m); }
    this.group.add(g);
    const H = { ax, ay, az, bx, by, bz, r, mesh: g, top, mat };
    this.list.push(H);
    if (this.list.length > MAX) this._drop(this.list.shift());
    return H;
  }
  _drop(H) { this.group.remove(H.mesh); H.mat.dispose(); }

  // 점에서 가장 가까운 캡슐과 그 축 위의 점
  _closest(x, y, z, out) {
    let best = null, bd = Infinity;
    for (const H of this.list) {
      const abx = H.bx - H.ax, aby = H.by - H.ay, abz = H.bz - H.az;
      const L2 = abx * abx + aby * aby + abz * abz || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - H.ax) * abx + (y - H.ay) * aby + (z - H.az) * abz) / L2));
      const cx = H.ax + abx * t, cy = H.ay + aby * t, cz = H.az + abz * t;
      const d = Math.hypot(x - cx, y - cy, z - cz) - H.r;
      if (d < bd) { bd = d; best = H; out.cx = cx; out.cy = cy; out.cz = cz; }
    }
    out.H = best; out.d = bd;
    return out;
  }

  /** 절대 (x,y,z) 가 구멍 속인가 (margin: 반지름에 더할 여유) */
  inside(x, y, z, margin = 0) {
    if (!this.list.length) return false;
    const c = this._closest(x, y, z, this._c || (this._c = {}));
    return c.d < margin;
  }

  /** 발밑 높이 보정: 구멍 속(또는 구멍 위 지표)이면 굴 바닥 높이, 아니면 null */
  floorAt(x, y, z, ground) {
    if (!this.list.length) return null;
    const C = this._c || (this._c = {});
    // 지표 위에 있으면 지표 바로 아래 점으로, 땅속이면 몸 중심으로 판정
    const py = y > ground ? ground - 0.25 : y + 0.9;
    this._closest(x, py, z, C);
    if (!C.H || C.d > 0) return null;
    const dxz = Math.hypot(x - C.cx, z - C.cz), r = C.H.r;
    if (dxz >= r) return null;
    return C.cy - Math.sqrt(r * r - dxz * dxz);
  }

  /** 굴 벽: 몸 중심(절대)을 굴 안쪽으로 밀어 넣음. 반환: 굴 속이면 true */
  constrain(P, ground) {
    if (!this.list.length) { this.inTunnel = false; return false; }
    const ax = P.pos.x + origin.x, ay = P.pos.y + origin.y, az = P.pos.z + origin.z;
    const C = this._closest(ax, ay, az, this._c2 || (this._c2 = {}));
    // 몸이 지표 아래이고 캡슐 근처일 때만
    if (!C.H || C.d > 0.8 || ay > ground + 0.3) { this.inTunnel = false; return false; }
    this.inTunnel = ay < ground - 1.5;
    const r = C.H.r, lim = Math.max(0.3, r - 0.45);
    const dx = ax - C.cx, dy = ay - C.cy, dz = az - C.cz, d = Math.hypot(dx, dy, dz);
    if (d > lim && d > 1e-4) {
      const k = lim / d;
      P.pos.x = C.cx + dx * k - origin.x; P.pos.y = C.cy + dy * k - origin.y; P.pos.z = C.cz + dz * k - origin.z;
      const nx = dx / d, ny = dy / d, nz = dz / d, vn = P.vel.x * nx + P.vel.y * ny + P.vel.z * nz;
      if (vn > 0) { P.vel.x -= vn * nx; P.vel.y -= vn * ny; P.vel.z -= vn * nz; }
    }
    return true;
  }

  // 매 프레임: 렌더 위치, 셰이더용 가까운 16개
  update(camAbs) {
    if (this._uOy) this._uOy.value = origin.y;
    this.group.position.set(0, 0, 0);
    for (const H of this.list) H.mesh.position.set(H.ax - origin.x, H.ay - origin.y, H.az - origin.z);
    const L = this.list;
    let n = 0;
    if (L.length) {
      const arr = L.length <= NGH ? L : L.slice().sort((p, q) => {
        const dp = Math.hypot((p.ax + p.bx) / 2 - camAbs.x, (p.az + p.bz) / 2 - camAbs.z), dq = Math.hypot((q.ax + q.bx) / 2 - camAbs.x, (q.az + q.bz) / 2 - camAbs.z);
        return dp - dq;
      });
      for (; n < Math.min(NGH, arr.length); n++) {
        const H = arr[n];
        GH_U.uGHA.value[n].set(H.ax - origin.x, H.ay - origin.y, H.az - origin.z, H.r);
        GH_U.uGHB.value[n].set(H.bx - origin.x, H.by - origin.y, H.bz - origin.z, 0);
      }
    }
    GH_U.uGHN.value = n;
  }

  reset() { for (const H of this.list) this._drop(H); this.list.length = 0; GH_U.uGHN.value = 0; this.inTunnel = false; }
}
