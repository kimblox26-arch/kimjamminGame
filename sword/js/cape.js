// SKY BLADE — 망토 (천 물리: 베를레 적분 + 거리 제약)
//  - 어깨 뒤 두 점 사이에 윗줄이 고정, 나머지는 중력·공기 저항·바람(진행 반대 방향)으로 흩날림
//  - 몸통 뒤 평면과 다리 쪽으로 파고들지 않게 밀어냄
//  - 렌더 좌표에 있으므로 원점 이동(rebase) 때 함께 옮김, 순간이동이면 다시 늘어뜨림
import * as THREE from 'three';
import { onRebase } from './frame.js';

const W = 8, H = 12;           // 가로 점, 세로 점
const WIDTH = 0.78, LEN = 1.5;  // 폭, 길이 (m)

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

export class Cape {
  constructor(scene, avatar) {
    this.av = avatar;
    const N = W * H;
    this.p = new Float32Array(N * 3);     // 위치 (렌더 좌표)
    this.o = new Float32Array(N * 3);     // 이전 위치
    this.rest = WIDTH / (W - 1);
    this.restV = LEN / (H - 1);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), idx = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; uv[k * 2] = i / (W - 1); uv[k * 2 + 1] = 1 - j / (H - 1); }
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    // 진한 남색 + 금빛 테두리 (텍스처 없이 uv 로)
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b2a6b, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCapeUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCapeUv = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vCapeUv;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float e = min(min(vCapeUv.x, 1.0 - vCapeUv.x) * 9.0, vCapeUv.y * 14.0);
  float trim = 1.0 - smoothstep(0.55, 0.75, e);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.55, 0.18), trim);
  diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 0.7;   // 안감은 조금 어둡게
}`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.init = false;
    this.anchorPrev = new THREE.Vector3();
    onRebase((dx, dy, dz) => {
      for (let k = 0; k < N; k++) { this.p[k * 3] -= dx; this.p[k * 3 + 1] -= dy; this.p[k * 3 + 2] -= dz; this.o[k * 3] -= dx; this.o[k * 3 + 1] -= dy; this.o[k * 3 + 2] -= dz; }
      this.anchorPrev.x -= dx; this.anchorPrev.y -= dy; this.anchorPrev.z -= dz;
    });
  }

  // 몸 좌표 → 렌더 좌표
  _body(x, y, z, out) { return out.set(x, y, z).applyMatrix4(this.av.body.matrixWorld); }

  _reset() {
    const p = this.p, o = this.o;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 3;
      this._body(-WIDTH / 2 + i * this.rest, 0.56 - j * this.restV, -0.23 - j * 0.02, _a);
      p[k] = o[k] = _a.x; p[k + 1] = o[k + 1] = _a.y; p[k + 2] = o[k + 2] = _a.z;
    }
    this.init = true;
  }

  /** vel = 몸의 속도 (m/s), 렌더 프레임마다 */
  update(dt, vel, visible = true) {
    this.mesh.visible = visible;
    if (!visible) return;
    this.av.body.updateWorldMatrix(true, false);
    this._body(0, 0.56, -0.23, _a);
    if (!this.init || _a.distanceTo(this.anchorPrev) > 8) this._reset();
    this.anchorPrev.copy(_a);
    const p = this.p, o = this.o;
    if (!(dt > 1e-5)) return;          // 일시정지 (dt = 0) 면 그대로
    dt = Math.min(dt, 1 / 30);
    const sub = 3, h = dt / sub;
    // 바람: 몸이 움직이는 반대쪽으로 (아주 빠르면 방향만, 크기는 제한)
    const sp = vel.length();
    const wk = Math.min(sp, 45) / Math.max(sp, 1e-3);
    const wx = -vel.x * wk, wy = -vel.y * wk, wz = -vel.z * wk;
    const t = performance.now() * 0.001;
    _m.copy(this.av.body.matrixWorld); _inv.copy(_m).invert();
    for (let s = 0; s < sub; s++) {
      // 적분 (베를레): 중력 + 공기 저항 + 바람 + 펄럭임
      for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 3;
        const x = p[k], y = p[k + 1], z = p[k + 2];
        let vx = (x - o[k]) / h, vy = (y - o[k + 1]) / h, vz = (z - o[k + 2]) / h;
        const fl = Math.sin(t * 13 + i * 0.9 + j * 0.7) * 0.35 * Math.min(1, sp / 12);
        const drag = 2.2;
        vx += (wx - vx) * drag * h + fl * h * 3; vy += ((wy - vy) * drag - 9.8) * h; vz += (wz - vz) * drag * h + fl * h * 3;
        o[k] = x; o[k + 1] = y; o[k + 2] = z;
        p[k] = x + vx * h; p[k + 1] = y + vy * h; p[k + 2] = z + vz * h;
      }
      // 윗줄 고정 (어깨 뒤)
      for (let i = 0; i < W; i++) {
        this._body(-WIDTH / 2 + i * this.rest, 0.56, -0.23, _a);
        const k = i * 3;
        o[k] = p[k] = _a.x; o[k + 1] = p[k + 1] = _a.y; o[k + 2] = p[k + 2] = _a.z;
      }
      // 거리 제약 (가로·세로·대각)
      for (let it = 0; it < 4; it++) {
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const a = j * W + i;
          if (i < W - 1 && j > 0) this._con(a, a + 1, this.rest, false);
          if (j < H - 1) this._con(a, a + W, this.restV, j === 0);
          if (i < W - 1 && j < H - 1) this._con(a, a + W + 1, Math.hypot(this.rest, this.restV), j === 0);
        }
        // 몸 충돌: 몸 좌표에서 등 뒤 평면 밖으로, 다리 앞으로는 못 감
        for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
          const k = (j * W + i) * 3;
          _b.set(p[k], p[k + 1], p[k + 2]).applyMatrix4(_inv);
          let moved = false;
          if (_b.y > -1.05 && _b.y < 0.62 && Math.abs(_b.x) < 0.46 && _b.z > -0.24) { _b.z = -0.24; moved = true; }
          if (moved) { _b.applyMatrix4(_m); p[k] = _b.x; p[k + 1] = _b.y; p[k + 2] = _b.z; }
        }
      }
    }
    // 메시 갱신
    const P = this.mesh.geometry.attributes.position;
    P.array.set(p);
    P.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  _con(a, b, rest, pinA) {
    const p = this.p, ka = a * 3, kb = b * 3;
    const dx = p[kb] - p[ka], dy = p[kb + 1] - p[ka + 1], dz = p[kb + 2] - p[ka + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const diff = (d - rest) / d;
    if (pinA) { p[kb] -= dx * diff; p[kb + 1] -= dy * diff; p[kb + 2] -= dz * diff; return; }
    const h = diff * 0.5;
    p[ka] += dx * h; p[ka + 1] += dy * h; p[ka + 2] += dz * h;
    p[kb] -= dx * h; p[kb + 1] -= dy * h; p[kb + 2] -= dz * h;
  }
}
