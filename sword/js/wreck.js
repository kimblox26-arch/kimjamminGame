// SKY BLADE — 건물 물리 (강체)
//  - 잘린 건물 윗부분 / 밑동째 밀린 건물이 강체 상자가 되어 실제 중력(9.81 m/s²)으로 기울고 쓰러짐
//  - 모서리 8개와 지면·옥상의 접촉: 충격량(법선 + 마찰) 방식 → 밑변을 축으로 자연스럽게 넘어감
//  - 세게 부딪히거나 옆으로 누우면 부서져 잔해·먼지 구름. 쓰러지며 이웃 건물을 덮치면 그 건물도 무너지거나 같이 넘어감 (도미노)
//  - 좌표: 절대(평면) 좌표로 적분, 그릴 때만 origin 을 뺌 (플로팅 원점)
//  - 그리기: 도시 파사드 재질을 그대로 쓰는 InstancedMesh (aDim/aInfo/aOff 인스턴스 속성) → 잘린 조각도 창문이 이어짐
import * as THREE from 'three';
import { origin } from './frame.js';
import { unitBox } from './city.js';

const G = 9.81;
const MAXB = 48;
const SUB = 1 / 120;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m3 = new THREE.Matrix3(), _M = new THREE.Matrix4(), _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
const CORN = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORN.push([x, y, z]);
// 쓰러지면서 이웃을 덮치는지 볼 표본점 (윗면 모서리 + 옆면 중간)
const PROBE = [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1], [0, 1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [0, 0.5, 0]];

export class Wreck {
  /**
   * @param city City
   * @param scene THREE.Scene
   * @param opts { fx, audio, hooks, terrainH(x,z)→abs y }
   */
  constructor(city, scene, opts) {
    this.city = city;
    this.fx = opts.fx; this.audio = opts.audio; this.hooks = opts.hooks || {};
    this.terrainH = opts.terrainH;
    this.camAbs = new THREE.Vector3();
    const g = unitBox();
    this.aDim = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4);
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(MAXB), 1);
    for (const a of [this.aDim, this.aInfo, this.aOff]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aDim', this.aDim); g.setAttribute('aInfo', this.aInfo); g.setAttribute('aOff', this.aOff);
    this.mesh = new THREE.InstancedMesh(g, city.material, MAXB);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.name = 'wreck';
    scene.add(this.mesh);
    this.bodies = [];
    this.acc = 0;
    this._boxes = [];
    this.stats = { cut: 0, toppled: 0, crumbled: 0 };
  }

  get count() { return this.bodies.length; }

  // ───────── 건물 → 강체 ─────────
  /**
   * 건물 i 를 절대 높이 yCut 에서 잘라 윗부분을 강체로 만든다. 아래(그루터기)는 그대로 서 있음.
   * imp: 윗부분에 줄 속도(절대, m/s), spin: 각속도(rad/s, 월드)
   */
  cut(i, yCut, imp, spin) {
    const C = this.city;
    if (!C.isDynamicable(i)) return null;
    const y0 = C.by[i], h = C.bh[i];
    const hc = clamp(yCut - y0, 2.5, h - 2);
    if (h - hc < 3) return null;
    if (this.bodies.length >= MAXB) {
      // 너무 많으면 그냥 부숨
      const b = C.kill(i); if (b) this._crumbleBoxes([b], b.x, b.y - b.h / 2, b.z, Math.max(b.w, b.d));
      return null;
    }
    const top = h - hc;
    C.setHeight(i, hc);
    const yaw = -Math.atan2(C.bs[i], C.bc[i]);
    const B = {
      c: new THREE.Vector3(C.bx[i], y0 + hc + top / 2 + 0.02, C.bz[i]),
      q: new THREE.Quaternion().setFromAxisAngle(_Y, yaw),
      v: new THREE.Vector3().copy(imp || _v.set(0, 0, 0)),
      w: new THREE.Vector3().copy(spin || _v.set(0, 0, 0)),
      hx: C.bw[i] / 2, hy: top / 2, hz: C.bd[i] / 2,
      info: [C.btype[i], C.bseed[i], C.bnum[i], C.btint[i]], off: hc,
      src: i, age: 0, rest: 0, hit: 0, maxV: 0,
    };
    const m = 8 * B.hx * B.hy * B.hz;           // 질량은 부피에 비례 (밀도 1, 상대값만 중요)
    B.m = m;
    B.Ib = new THREE.Vector3(                    // 상자 관성 모멘트 (몸 좌표)
      (m / 3) * (B.hy * B.hy + B.hz * B.hz),
      (m / 3) * (B.hx * B.hx + B.hz * B.hz),
      (m / 3) * (B.hx * B.hx + B.hy * B.hy));
    this.bodies.push(B);
    this.stats.cut++;
    // 절단면: 불꽃 + 먼지
    const fx = this.fx;
    if (fx) {
      _p.set(C.bx[i] - origin.x, y0 + hc - origin.y, C.bz[i] - origin.z);
      fx.dustCloud(_p.x, _p.y, _p.z, Math.max(B.hx, B.hz) * 1.2, 6);
    }
    return B;
  }

  /** 밑동째 넘어뜨리기: 바닥 근처에서 자르고 (dirX,dirZ) 쪽으로 윗부분 상단을 밈 */
  topple(i, dirX, dirZ, strength = 1) {
    const C = this.city;
    if (!C.isDynamicable(i)) return null;
    const h = C.bh[i];
    const l = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / l, dz = dirZ / l;
    // 밀린 방향으로 기울기 시작: 수평축 (dir × up) 둘레 각속도
    const B = this.cut(i, C.by[i] + 3.5, _b.set(0, 0, 0), _a.set(0, 0, 0));
    if (!B) return null;
    // 미는 쪽 밑변을 축으로 넘어가는 강체 회전: 무게중심이 모서리를 넘을 만큼의 각속도 (에너지 장벽) × 여유
    _c.set(1, 0, 0).applyQuaternion(B.q); _t.set(0, 0, 1).applyQuaternion(B.q);
    const ext = Math.abs(dx * _c.x + dz * _c.z) * B.hx + Math.abs(dx * _t.x + dz * _t.z) * B.hz;
    const W = 2 * ext, H = 2 * B.hy;
    const dh = Math.hypot(ext, B.hy) - B.hy;
    const wc = Math.sqrt((2 * G * dh) / ((W * W + H * H) / 3));
    const wmag = wc * (1.25 + 0.35 * clamp(strength, 0, 3));
    B.w.set(dz, 0, -dx).multiplyScalar(wmag);
    // 중심 속도 = ω × (중심 - 축), 축 = 미는 쪽 밑변
    _r.set(-dx * ext, B.hy, -dz * ext);
    B.v.crossVectors(B.w, _r);
    this.stats.toppled++;
    return B;
  }

  /** 강한 타격: 큰 건물은 맞은 높이에서 잘려 밀려나고, 작은 건물은 산산조각 */
  blast(i, hx, hy, hz, dx, dy, dz, power = 1) {
    const C = this.city;
    if (i < 0 || !C.alive[i]) return;
    const h = C.bh[i], rel = hy - C.by[i];
    if (!C.isDynamicable(i) || h < 18 || power > 6) {
      const b = C.kill(i);
      if (b) this._crumbleBoxes([b], b.x, b.y - b.h / 2, b.z, Math.max(b.w, b.d));
      return;
    }
    const l = Math.hypot(dx, dz) || 1;
    if (rel < h * 0.3) this.topple(i, dx / l, dz / l, power);
    else {
      _b.set(dx, Math.max(0, dy), dz).normalize().multiplyScalar(4 + 6 * power);
      _a.set(dz / l, 0, -dx / l).multiplyScalar(0.25 + 0.3 * power);
      this.cut(i, hy - 2, _b, _a);
    }
  }

  reset() {
    this.bodies.length = 0;
    this.mesh.count = 0;
  }

  // ───────── 시뮬레이션 ─────────
  update(dt, camAbs) {
    if (camAbs) this.camAbs.copy(camAbs);
    if (this.bodies.length) {
      this.acc = Math.min(this.acc + dt, SUB * 12);
      while (this.acc >= SUB) { this.acc -= SUB; this._step(SUB); }
    }
    this._render();
  }

  _ground(x, z, y, B) {
    // 지면 = 지형 또는 (거의 그 높이까지 온) 옥상/그루터기. 옥상보다 한참 아래면 벽을 뚫는 중 → 덮침 처리에서
    const C = this.city;
    let g = this.terrainH(x, z);
    const id = C.roofId(x, z);
    if (id >= 0) {
      const top = C.by[id] + C.bh[id];
      if (top > g && y > top - 3) g = top;
    }
    return g;
  }

  _step(dt) {
    const bodies = this.bodies;
    for (let k = bodies.length - 1; k >= 0; k--) {
      const B = bodies[k];
      B.age += dt;
      // 적분 (반암시적 오일러)
      B.v.y -= G * dt;
      B.v.multiplyScalar(Math.exp(-0.02 * dt));
      B.w.multiplyScalar(Math.exp(-0.15 * dt));
      B.c.addScaledVector(B.v, dt);
      const wl = B.w.length();
      if (wl > 1e-6) {
        _q.setFromAxisAngle(_v.copy(B.w).divideScalar(wl), wl * dt);
        B.q.premultiply(_q).normalize();
      }
      // 월드 역관성 텐서 I⁻¹ = R Ib⁻¹ Rᵀ
      _M.makeRotationFromQuaternion(B.q);
      const e = _M.elements;
      const R = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];   // 열 우선 (열0 = 몸 x축)
      const iI = (out, x) => {   // out = R Ib⁻¹ Rᵀ x
        const lx = R[0] * x.x + R[1] * x.y + R[2] * x.z, ly = R[3] * x.x + R[4] * x.y + R[5] * x.z, lz = R[6] * x.x + R[7] * x.y + R[8] * x.z;
        const ax = lx / B.Ib.x, ay = ly / B.Ib.y, az = lz / B.Ib.z;
        return out.set(R[0] * ax + R[3] * ay + R[6] * az, R[1] * ax + R[4] * ay + R[7] * az, R[2] * ax + R[5] * ay + R[8] * az);
      };
      // 접촉 (모서리 8개): 위치·지면 높이는 한 번만 구하고 충격량은 몇 번 반복
      let pen = 0, touching = 0, hardest = 0, topTouch = false;
      const CR = this._cr || (this._cr = CORN.map(() => ({ r: new THREE.Vector3(), d: 0 })));
      for (let ci = 0; ci < 8; ci++) {
        const [sx, sy, sz] = CORN[ci];
        const lx = sx * B.hx, ly = sy * B.hy, lz = sz * B.hz;
        const cr = CR[ci];
        cr.r.set(R[0] * lx + R[3] * ly + R[6] * lz, R[1] * lx + R[4] * ly + R[7] * lz, R[2] * lx + R[5] * ly + R[8] * lz);
        const px = B.c.x + cr.r.x, py = B.c.y + cr.r.y, pz = B.c.z + cr.r.z;
        cr.d = this._ground(px, pz, py, B) - py;
        if (cr.d > 0) {
          touching++; pen = Math.max(pen, cr.d);
          if (sy > 0) topTouch = true;
          _c.crossVectors(B.w, cr.r).add(B.v);
          if (_c.y < 0) hardest = Math.max(hardest, -_c.y);
        }
      }
      for (let it = 0; it < 3 && touching; it++) {
        for (let ci = 0; ci < 8; ci++) {
          const cr = CR[ci];
          if (cr.d <= 0) continue;
          _r.copy(cr.r);
          // 접촉점 속도
          _c.crossVectors(B.w, _r).add(B.v);
          const vn = _c.y;
          if (vn >= 0) continue;
          // 법선 충격량
          _n.set(0, 1, 0);
          _a.crossVectors(_r, _n); iI(_b, _a); _a.crossVectors(_b, _r);
          const kn = 1 / B.m + _a.dot(_n);
          const jn = -(1 + 0.08) * vn / kn;
          B.v.addScaledVector(_n, jn / B.m);
          _a.crossVectors(_r, _n).multiplyScalar(jn); iI(_b, _a); B.w.add(_b);
          // 마찰 (쿨롱)
          _c.crossVectors(B.w, _r).add(B.v);
          _t.set(_c.x, 0, _c.z);
          const vt = _t.length();
          if (vt > 1e-4) {
            _t.divideScalar(vt);
            _a.crossVectors(_r, _t); iI(_b, _a); _a.crossVectors(_b, _r);
            const kt = 1 / B.m + _a.dot(_t);
            const jt = Math.min(vt / kt, 0.7 * jn);
            B.v.addScaledVector(_t, -jt / B.m);
            _a.crossVectors(_r, _t).multiplyScalar(-jt); iI(_b, _a); B.w.add(_b);
          }
        }
      }
      if (pen > 0) B.c.y += pen * 0.6;   // 위치 보정
      B.maxV = Math.max(B.maxV, hardest);
      // 이웃 건물 덮치기 (움직이는 동안)
      if (B.v.lengthSq() + B.w.lengthSq() * B.hy * B.hy > 4) this._crush(B, R);
      // 부서짐 판정: 세게 부딪힘 / 옆으로 누움 / 오래 정지
      const upY = Math.abs(R[4]);   // 몸 y축의 월드 y 성분
      const sp = B.v.length() + B.w.length() * Math.max(B.hx, B.hy, B.hz);
      if (sp < 1.5) B.rest += dt; else B.rest = 0;
      const tall = B.hy * 2;
      const broke = B.age > 0.25 && ((touching && (hardest > 7 + tall * 0.02 || (topTouch && upY < 0.8) || upY < 0.3)) || B.rest > 1.5);
      if (broke || B.c.y < this.terrainH(B.c.x, B.c.z) - 50 || B.age > 40) {
        this._crumble(B, R, hardest);
        bodies.splice(k, 1);
      }
    }
  }

  // 쓰러지는 조각이 다른 건물 속으로 파고들면 그 건물도 무너짐 (크면 같이 넘어감)
  _crush(B, R) {
    const C = this.city;
    for (const [sx, sy, sz] of PROBE) {
      const lx = sx * B.hx, ly = sy * B.hy, lz = sz * B.hz;
      const px = B.c.x + R[0] * lx + R[3] * ly + R[6] * lz;
      const py = B.c.y + R[1] * lx + R[4] * ly + R[7] * lz;
      const pz = B.c.z + R[2] * lx + R[5] * ly + R[8] * lz;
      const id = C.roofId(px, pz);
      if (id < 0 || id === B.src) continue;
      const top = C.by[id] + C.bh[id];
      if (py > top - 3 || py < C.by[id]) continue;
      // 그 건물 쪽으로 움직이고 있을 때만 (처음부터 맞붙어 있던 이웃은 무시)
      const vx = B.v.x + (B.w.y * (pz - B.c.z) - B.w.z * (py - B.c.y));
      const vz = B.v.z + (B.w.x * (py - B.c.y) - B.w.y * (px - B.c.x));
      if (Math.hypot(vx, vz) < 1 || vx * (C.bx[id] - px) + vz * (C.bz[id] - pz) <= 0) continue;
      if (C.bh[id] > 30 && C.isDynamicable(id) && this.bodies.length < MAXB - 4) {
        const hitRel = (py - C.by[id]) / C.bh[id];
        if (hitRel > 0.35) { this.cut(id, py - 1, _b.set(vx * 0.4, 0, vz * 0.4), _a.set(vz, 0, -vx).normalize().multiplyScalar(0.3)); }
        else this.topple(id, vx, vz, 0.8);
      } else {
        const b = C.kill(id);
        if (b) this._crumbleBoxes([b], b.x, b.y - b.h / 2, b.z, Math.max(b.w, b.d), true);
      }
    }
  }

  _crumble(B, R, hardest) {
    // 조각의 긴 축을 따라 상자 몇 개로 잘라 잔해로
    const ext = [B.hx, B.hy, B.hz];
    let ax = 0; if (ext[1] > ext[ax]) ax = 1; if (ext[2] > ext[ax]) ax = 2;
    const L = ext[ax] * 2;
    const n = clamp(Math.round(L / 14), 1, 8);
    const boxes = this._boxes; boxes.length = 0;
    // 월드 AABB 반폭
    const wx = Math.abs(R[0]) * B.hx + Math.abs(R[3]) * B.hy + Math.abs(R[6]) * B.hz;
    const wy = Math.abs(R[1]) * B.hx + Math.abs(R[4]) * B.hy + Math.abs(R[7]) * B.hz;
    const wz = Math.abs(R[2]) * B.hx + Math.abs(R[5]) * B.hy + Math.abs(R[8]) * B.hz;
    const axw = [R[ax * 3], R[ax * 3 + 1], R[ax * 3 + 2]];
    const ty = B.info[0];
    const color = ty === 0 ? 0xdcd8cf : ty === 1 ? 0x3a4652 : 0x9a8a7a;
    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n - 0.5) * L;
      boxes.push({
        x: B.c.x + axw[0] * s, y: B.c.y + axw[1] * s, z: B.c.z + axw[2] * s,
        w: Math.max(4, (wx * 2) / (Math.abs(axw[0]) > 0.5 ? n : 1)), h: Math.max(4, (wy * 2) / (Math.abs(axw[1]) > 0.5 ? n : 1)),
        d: Math.max(4, (wz * 2) / (Math.abs(axw[2]) > 0.5 ? n : 1)), color,
      });
    }
    const gy = this.terrainH(B.c.x, B.c.z);
    this._crumbleBoxes(boxes, B.c.x, gy, B.c.z, Math.max(wx, wz) * 1.4);
    // 그루터기 위로 수직 낙하한 경우: 아래층도 짓눌려 무너짐 (연쇄 붕괴)
    const C = this.city;
    if (B.src >= 0 && C.alive[B.src] && hardest > 6 && Math.abs(R[4]) > 0.8) {
      const id = C.roofId(B.c.x, B.c.z);
      if (id === B.src) { const b = C.kill(id); if (b) this._crumbleBoxes([b], b.x, b.y - b.h / 2, b.z, Math.max(b.w, b.d)); }
    }
    this.stats.crumbled++;
  }

  // 잔해 + 먼지 + 소리/흔들림 (상자는 절대 좌표)
  _crumbleBoxes(boxes, x, gy, z, R, quiet = false) {
    const fx = this.fx;
    if (fx && fx.debrisBoxes) fx.debrisBoxes(boxes);
    if (fx && fx.dustCloud) fx.dustCloud(x - origin.x, gy - origin.y, z - origin.z, clamp(R, 8, 120), 25);
    const d = Math.hypot(x - this.camAbs.x, z - this.camAbs.z);
    const k = clamp(1 - d / 2500, 0, 1);
    if (!quiet && this.audio) this.audio.play('heroLand', clamp(0.3 + R / 120, 0.3, 1) * (0.3 + 0.7 * k));
    if (this.hooks.shake) this.hooks.shake(clamp(R / 80, 0.1, 0.7) * k);
  }

  _render() {
    const bodies = this.bodies, mesh = this.mesh;
    mesh.count = bodies.length;
    if (!bodies.length) return;
    for (let k = 0; k < bodies.length; k++) {
      const B = bodies[k];
      // 단위 상자 (밑면이 원점) → 중심 기준으로 내리고 회전
      _p.set(0, -B.hy, 0).applyQuaternion(B.q);
      _p.x += B.c.x - origin.x; _p.y += B.c.y - origin.y; _p.z += B.c.z - origin.z;
      _s.set(B.hx * 2, B.hy * 2, B.hz * 2);
      mesh.setMatrixAt(k, _M.compose(_p, B.q, _s));
      this.aDim.setXYZ(k, B.hx * 2, B.hy * 2, B.hz * 2);
      this.aInfo.setXYZW(k, B.info[0], B.info[1], B.info[2], B.info[3]);
      this.aOff.setX(k, B.off);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.aDim.needsUpdate = true; this.aInfo.needsUpdate = true; this.aOff.needsUpdate = true;
  }
}
