// SKY BLADE — 핵 발사 (미사일 → 핵폭발)
//  - 위력 W = 15 kt (히로시마급). 실제 규모 (W 에 따라 W^(1/3) 로 커짐):
//      불덩이 최대 반지름 ≈ 66·W^0.4 m ≈ 195 m (약 1 초에 최대)
//      폭풍 20 psi (철근 콘크리트도 무너짐) ≈ 0.65 km, 5 psi (대부분 건물 붕괴) ≈ 1.7 km, 1 psi (유리창) ≈ 4.7 km
//      충격파: 처음엔 초음속, 곧 음속(343 m/s) 으로. 버섯구름 꼭대기 ≈ 7 km
//  - 소리와 흔들림은 충격파가 카메라에 닿을 때 (거리/343 초 늦게)
//  - 미사일: 쏜 뒤 0.5 초 상승 → 조준점으로 유도, 가속 120 m/s² 로 마하 2 까지, 건물·지면·조준점에서 폭발
import * as THREE from 'three';
import { origin, onRebase, SUN_DIR } from './frame.js';

const W_KT = 15;
const S3 = Math.cbrt(W_KT / 15);
const R_FIRE = 66 * Math.pow(W_KT, 0.4);
const R_20 = 650 * S3, R_5 = 1700 * S3, R_1 = 4700 * S3;
const H_TOP = 7000 * Math.pow(W_KT / 15, 0.3);
const ACC = 120, VMAX = 690, TURN = 2.4;
const front = (t) => 343 * t + 0.9 * R_20 * (1 - Math.exp(-t / 0.7));

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const NOISE = /* glsl */`
float h31(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }`;

// 불덩이 → 버섯 갓. uHeat: 1 (하얗게 빛남) → 0 (식은 연기), uCap: 0 (구) → 1 (납작한 갓, 아래가 말려 올라감)
const BALL_VS = /* glsl */`
uniform float uTime, uCap, uRough;
varying vec3 vN, vP, vW;
varying float vNz;
${NOISE}
void main() {
  vec3 p = position;
  float n = fbm(p * 2.6 + vec3(0.0, -uTime * 0.25, 0.0));
  vNz = n;
  // 갓: 위로 납작, 아래쪽 가장자리가 위로 말림 (도넛처럼)
  float r = length(p.xz);
  p.y *= mix(1.0, 0.62, uCap);
  p.y += uCap * 0.38 * smoothstep(0.2, 1.0, 1.0 - r) * step(p.y, 0.0) * 1.2;
  p += normal * (n - 0.5) * uRough;
  vP = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BALL_FS = /* glsl */`
uniform float uTime, uHeat, uA;
uniform vec3 uSun;
varying vec3 vN, vP, vW;
varying float vNz;
${NOISE}
vec3 fire(float T) {
  // 흑체 근사: 흰빛 → 노랑 → 주황 → 검붉음
  vec3 c = mix(vec3(0.35, 0.05, 0.01), vec3(1.6, 0.45, 0.08), smoothstep(0.1, 0.35, T));
  c = mix(c, vec3(3.2, 1.9, 0.6), smoothstep(0.35, 0.65, T));
  c = mix(c, vec3(9.0, 8.0, 6.5), smoothstep(0.65, 0.95, T));
  return c;
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float mu = max(dot(n, v), 0.0);
  float t2 = fbm(vP * 6.0 + vec3(0.0, -uTime * 0.6, uTime * 0.2));
  float T = uHeat * (0.55 + 0.6 * vNz + 0.35 * t2) * (0.75 + 0.25 * mu);
  vec3 hot = fire(clamp(T, 0.0, 1.0)) * (uHeat > 0.8 ? 1.0 + (uHeat - 0.8) * 20.0 : 1.0);
  // 식은 연기: 해에 비친 쪽은 밝은 회갈색, 그늘은 어둡게, 밑면은 남은 열로 붉게
  float lit = 0.32 + 0.85 * max(dot(n, uSun), 0.0);
  vec3 smoke = vec3(0.62, 0.55, 0.5) * lit * (0.55 + 0.7 * vNz) + vec3(1.4, 0.35, 0.08) * max(-n.y, 0.0) * uHeat * 2.0;
  vec3 col = mix(smoke, hot, smoothstep(0.08, 0.35, uHeat));
  float a = uA * mix(smoothstep(0.0, 0.35, mu + vNz * 0.4), 1.0, smoothstep(0.2, 0.5, uHeat));
  gl_FragColor = vec4(col, a);
}`;
// 기둥: 위로 빨려 올라가는 연기 (아래쪽은 먼지 치마)
const STEM_VS = /* glsl */`
uniform float uTime;
varying vec3 vP, vW, vN;
${NOISE}
void main() {
  vec3 p = position;
  float n = fbm(vec3(p.x * 3.0, p.y * 6.0 - uTime * 0.5, p.z * 3.0));
  p.xz *= 0.8 + 0.5 * n;
  vP = position;
  vN = normalize(mat3(modelMatrix) * vec3(normal.x, 0.0, normal.z));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STEM_FS = /* glsl */`
uniform float uTime, uA, uHeat;
uniform vec3 uSun;
varying vec3 vP, vW, vN;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float mu = abs(dot(n, v));
  float s = fbm(vec3(vP.x * 4.0, vP.y * 9.0 - uTime * 0.7, vP.z * 4.0));
  float lit = 0.35 + 0.8 * max(dot(n, uSun), 0.0);
  vec3 col = mix(vec3(0.5, 0.42, 0.36), vec3(0.7, 0.64, 0.58), s) * lit;
  col += vec3(1.5, 0.4, 0.08) * uHeat * smoothstep(0.6, 1.0, vP.y) * 1.5;
  float a = uA * smoothstep(0.05, 0.45, mu) * (0.55 + 0.6 * s) * smoothstep(1.0, 0.92, vP.y);
  gl_FragColor = vec4(col, a);
}`;

function makeMissile() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.35, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x23282f, metalness: 0.6, roughness: 0.4 });
  const yel = new THREE.MeshStandardMaterial({ color: 0xe0b020, metalness: 0.2, roughness: 0.5 });
  const add = (m) => { m.castShadow = true; g.add(m); return m; };
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 4.2, 18), white));
  add(new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.4, 18), white)).position.y = 2.8;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.22, 18), yel)).position.y = 1.5;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.12, 18), dark)).position.y = -1.0;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.31, 0.4, 14, 1, true), dark)).position.y = -2.3;
  for (let i = 0; i < 4; i++) {
    const f = add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.9, 0.55), dark));
    const a = i * Math.PI / 2;
    f.position.set(Math.cos(a) * 0.55, -1.65, Math.sin(a) * 0.55);
    f.rotation.y = -a;
  }
  // 분사 불꽃 (가산, HDR)
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 3.2, 12, 1, true), flameMat);
  flame.rotation.x = Math.PI; flame.position.y = -4.1;
  g.add(flame);
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  core.rotation.x = Math.PI; core.position.y = -3.2;
  g.add(core);
  g.userData.flame = flame;
  return g;
}

export class Nukes {
  /** game: { fx, audio, hooks, city, wreck, terrain, trees, water, toast } */
  constructor(scene, game) {
    this.scene = scene; this.game = game;
    this.missiles = [];
    this.blasts = [];
    this.cool = 0;
    this._hit = {};
    onRebase(() => {});      // 모두 절대 좌표로 들고 있어서 옮길 것 없음
  }

  get busy() { return this.missiles.length > 0; }

  /** from, target: 절대 좌표, v0: 쏘는 사람의 속도 */
  launch(from, target, v0) {
    if (this.cool > 0 || this.missiles.length >= 2) return false;
    this.cool = 2;
    const mesh = makeMissile();
    this.scene.add(mesh);
    const dir = _a.subVectors(target, from).normalize();
    const vel = new THREE.Vector3().copy(v0 || _b.set(0, 0, 0)).addScaledVector(Y, 35).addScaledVector(dir, 15);
    this.missiles.push({ mesh, pos: from.clone(), prev: from.clone(), vel, target: target.clone(), t: 0, puff: 0 });
    const G = this.game;
    if (G.audio) G.audio.play('launch', 1);
    if (G.toast) G.toast('☢ 핵미사일 발사 — 위력 ' + W_KT + ' kt');
    return true;
  }

  update(dt, camAbs) {
    this.cool = Math.max(0, this.cool - dt);
    if (dt <= 0) { this._render(0, camAbs); return; }
    for (let i = this.missiles.length - 1; i >= 0; i--) if (!this._fly(this.missiles[i], dt)) this.missiles.splice(i, 1);
    for (let i = this.blasts.length - 1; i >= 0; i--) if (!this._blast(this.blasts[i], dt, camAbs)) { this._drop(this.blasts[i]); this.blasts.splice(i, 1); }
    this._render(dt, camAbs);
  }

  _fly(M, dt) {
    const G = this.game, T = G.terrain, C = G.city;
    M.t += dt;
    const to = _a.subVectors(M.target, M.pos);
    const dist = to.length();
    to.divideScalar(Math.max(dist, 1e-6));
    const sp = M.vel.length();
    const dir = _b.copy(M.vel).divideScalar(Math.max(sp, 1e-6));
    if (M.t > 0.5) {
      // 유도: 조준점 쪽으로 최대 TURN rad/s 만큼 꺾음
      const ang = Math.acos(clamp(dir.dot(to), -1, 1));
      if (ang > 1e-4) { dir.lerp(to, Math.min(1, TURN * dt / ang)).normalize(); }
    } else dir.y += 2 * dt;
    dir.normalize();
    const spd = Math.min(VMAX, sp + ACC * dt);
    M.vel.copy(dir).multiplyScalar(spd);
    M.prev.copy(M.pos);
    M.pos.addScaledVector(M.vel, dt);
    // 연기 꼬리 + 불꽃
    const fx = G.fx;
    M.puff += spd * dt;
    const gap = Math.max(4, spd * 0.012);
    while (M.puff > gap && fx.puff) {
      M.puff -= gap;
      const k = M.puff / Math.max(spd * dt, 1e-3);
      const x = M.pos.x - M.vel.x * dt * k - dir.x * 3 - origin.x, y = M.pos.y - M.vel.y * dt * k - dir.y * 3 - origin.y, z = M.pos.z - M.vel.z * dt * k - dir.z * 3 - origin.z;
      fx.puff({ x, y, z, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, life: 9 + Math.random() * 5, s0: 1.4, s1: 9, spow: 0.6, a: 0.55, fin: 0.02, fpow: 1.5, drag: 0.4, rotv: (Math.random() - 0.5) * 0.4 }, 'smoke', 1.25);
    }
    if (fx.puff) fx.puff({ x: M.pos.x - dir.x * 3.4 - origin.x, y: M.pos.y - dir.y * 3.4 - origin.y, z: M.pos.z - dir.z * 3.4 - origin.z,
      vx: -dir.x * 30, vy: -dir.y * 30, vz: -dir.z * 30, life: 0.12, s0: 1.6, s1: 3, r0: 6, g0: 3.2, b0: 1, r1: 1.5, g1: 0.3, b1: 0.05, a: 0.9, add0: 1, add1: 1, shade: 0, fin: 0.01 }, 'glow');
    // 부딪힘: 조준점, 지면, 건물, 아니면 30 초 뒤 공중 폭발
    let hit = null;
    if (dist < spd * dt + 4) hit = M.target.clone();
    if (!hit && T) {
      const gh = Math.max(T.heightAt(M.pos.x, M.pos.z), T.waterLevelAt(M.pos.x, M.pos.z));
      if (M.pos.y < gh) hit = new THREE.Vector3(M.pos.x, gh, M.pos.z);
    }
    if (!hit && C && C.segmentHit(M.prev.x, M.prev.y, M.prev.z, M.pos.x, M.pos.y, M.pos.z, this._hit)) hit = M.prev.clone().lerp(M.pos, this._hit.t);
    if (!hit && M.t > 30) hit = M.pos.clone();
    if (hit) { this._remove(M); this.detonate(hit); return false; }
    return true;
  }

  _remove(M) {
    this.scene.remove(M.mesh);
    M.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  /** 핵폭발 (절대 좌표) */
  detonate(p) {
    const G = this.game, C = G.city, T = G.terrain;
    const gy = T ? T.heightAt(p.x, p.z) : p.y;
    const wl = T ? T.waterLevelAt(p.x, p.z) : -1e9;
    const B = { p: p.clone(), gy: Math.max(gy, wl), water: wl > gy && p.y - wl < R_FIRE, t: 0, k: 0, heard: false, hitPlayer: false, front: 0 };
    // 불덩이 + 갓
    const u = { uTime: { value: 0 }, uHeat: { value: 1 }, uCap: { value: 0 }, uRough: { value: 0.12 }, uA: { value: 1 }, uSun: { value: SUN_DIR } };
    B.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), new THREE.ShaderMaterial({ vertexShader: BALL_VS, fragmentShader: BALL_FS, uniforms: u, transparent: true, depthWrite: false, fog: false }));
    B.ball.frustumCulled = false; B.ball.renderOrder = 5;
    B.u = u;
    const su = { uTime: { value: 0 }, uA: { value: 0 }, uHeat: { value: 1 }, uSun: { value: SUN_DIR } };
    const sg = new THREE.CylinderGeometry(1, 1, 1, 40, 24, true); sg.translate(0, 0.5, 0);
    // 아래로 갈수록 넓게 (먼지 치마)
    const ps = sg.attributes.position;
    for (let i = 0; i < ps.count; i++) { const y = ps.getY(i), w = 1 + 2.2 * Math.pow(1 - y, 6); ps.setX(i, ps.getX(i) * w); ps.setZ(i, ps.getZ(i) * w); }
    sg.computeVertexNormals();
    B.stem = new THREE.Mesh(sg, new THREE.ShaderMaterial({ vertexShader: STEM_VS, fragmentShader: STEM_FS, uniforms: su, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    B.stem.frustumCulled = false; B.stem.renderOrder = 4;
    B.su = su;
    this.scene.add(B.ball, B.stem);
    // 피해 대상 건물: 거리순
    B.q = [];
    if (C) {
      for (let i = 0; i < C.n; i++) {
        if (!C.alive[i]) continue;
        const d = Math.hypot(C.bx[i] - p.x, C.bz[i] - p.z);
        if (d < R_5 * 1.15) B.q.push([d, i]);
      }
      B.q.sort((a, b) => a[0] - b[0]);
    }
    if (G.trees && G.trees.addBlast) B.zone = G.trees.addBlast(p.x, p.z, R_FIRE * 1.6, R_5 * 1.3);
    // 순간 효과
    const fx = G.fx;
    _c.set(p.x - origin.x, B.gy - origin.y, p.z - origin.z);
    if (fx.nukeBlast) fx.nukeBlast(_c, R_FIRE, R_5, Math.max(0, p.y - B.gy));
    if (B.water && fx.splash) { fx.splash(_c.x, _c.y, _c.z, 40); if (G.water && G.water.ripple) G.water.ripple(p.x, p.z, 6, 300); }
    G.hooks.flash(1);
    this.blasts.push(B);
    this.lastBlast = B;
  }

  _blast(B, dt, camAbs) {
    const G = this.game, C = G.city, W = G.wreck, fx = G.fx;
    B.t += dt;
    const t = B.t;
    B.front = front(t);
    // 충격파가 지나간 건물: 가까우면 증발/산산조각, 멀면 바깥으로 쓰러짐
    if (C && W) {
      const boxes = [];
      let budget = 40;
      while (B.k < B.q.length && B.q[B.k][0] < B.front && budget-- > 0) {
        const [d, i] = B.q[B.k++];
        if (!C.alive[i]) continue;
        const dx = (C.bx[i] - B.p.x) / Math.max(d, 1), dz = (C.bz[i] - B.p.z) / Math.max(d, 1);
        if (d < R_FIRE * 1.3) { C.kill(i); continue; }                // 증발
        if (d < R_20 || !C.isDynamicable(i) || W.count >= 40) { const b = C.kill(i); if (b) boxes.push(b); continue; }
        const pr = R_5 / d;                                             // 압력에 비례하는 세기
        if (d < R_5 * (0.85 + 0.3 * Math.random())) W.topple(i, dx, dz, clamp(pr, 0.5, 3));
      }
      if (boxes.length && fx.debrisBoxes) fx.debrisBoxes(boxes);
    }
    if (B.zone && G.trees.setFront) G.trees.setFront(B.zone, B.front);
    // 플레이어: 충격파가 닿으면 날아감
    const P = G.player;
    if (P && !B.hitPlayer && !P.hidden) {
      const pa = _a.set(P.pos.x + origin.x, P.pos.y + origin.y, P.pos.z + origin.z);
      const d = pa.distanceTo(_b.set(B.p.x, B.gy, B.p.z));
      if (d < B.front) {
        B.hitPlayer = true;
        if (d < R_1) {
          const k = clamp(Math.pow(R_5 / Math.max(d, 50), 1.4) * 70, 8, 380);
          _c.subVectors(pa, _b).setY(0).normalize();
          P.vel.addScaledVector(_c, k); P.vel.y += k * 0.25;
          if (P.mode === 'ground') P.mode = 'air';
          if (d < R_FIRE * 1.5 && G.toast) G.toast('불덩이 속 — 표면 온도 수천만 °C');
        }
      }
    }
    // 소리·흔들림: 충격파가 카메라에 닿을 때
    if (!B.heard) {
      const dc = Math.hypot(camAbs.x - B.p.x, camAbs.y - B.gy, camAbs.z - B.p.z);
      if (dc < B.front || t > 120) {
        B.heard = true;
        const near = clamp(1 - Math.log10(Math.max(dc, 100) / 100) / 2.3, 0.05, 1);
        G.audio.play('nuke', near);
        G.hooks.shake(clamp(near * 1.2, 0.15, 1));
        G.hooks.fovKick && G.hooks.fovKick(4 + 10 * near);
        if (G.hooks.shockwave) G.hooks.shockwave(_c.set(B.p.x - origin.x, B.gy - origin.y + 50, B.p.z - origin.z), near);
      }
    }
    return t < 150;
  }

  _drop(B) {
    for (const m of [B.ball, B.stem]) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  }

  _render(dt, camAbs) {
    for (const M of this.missiles) {
      M.mesh.position.set(M.pos.x - origin.x, M.pos.y - origin.y, M.pos.z - origin.z);
      M.mesh.quaternion.setFromUnitVectors(Y, _a.copy(M.vel).normalize());
      const f = M.mesh.userData.flame;
      f.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }
    for (const B of this.blasts) {
      const t = B.t;
      // 불덩이: 1 초에 최대 반지름, 수 초 동안 하얗게 → 식으며 떠올라 갓이 됨
      const rise = H_TOP * (1 - Math.exp(-Math.pow(t / 45, 1.3)));
      const heat = t < 0.15 ? 1 : Math.exp(-(t - 0.15) / 3.2);
      const rCap = R_FIRE * Math.min(1, Math.pow(t / 0.9 + 0.02, 0.4)) + 0.32 * rise;
      const cap = clamp((t - 2) / 10, 0, 1);
      const cy = B.gy + Math.max(R_FIRE * 0.6, Math.max(0, B.p.y - B.gy)) + rise;
      B.ball.position.set(B.p.x - origin.x, cy - origin.y, B.p.z - origin.z);
      B.ball.scale.set(rCap, rCap, rCap);
      const u = B.u;
      u.uTime.value = t; u.uHeat.value = heat; u.uCap.value = cap; u.uRough.value = 0.1 + 0.15 * cap;
      u.uA.value = t < 100 ? 1 : 1 - (t - 100) / 50;
      // 기둥: 지면 → 갓 밑
      const sh = Math.max(1, cy - rCap * 0.4 - B.gy);
      const sr = Math.max(10, rCap * 0.22);
      B.stem.position.set(B.p.x - origin.x, B.gy - origin.y, B.p.z - origin.z);
      B.stem.scale.set(sr, sh, sr);
      B.su.uTime.value = t; B.su.uHeat.value = heat;
      B.su.uA.value = clamp((t - 1.5) / 5, 0, 0.85) * (t < 100 ? 1 : 1 - (t - 100) / 50);
      // 갓 둘레로 말려 올라가는 연기 덩어리 (부피감)
      const fx = this.game.fx;
      if (dt > 0 && fx.puff && t > 3 && t < 90 && Math.random() < 0.5 * (fx.q || 1)) {
        const a = Math.random() * Math.PI * 2, rr = rCap * (0.75 + Math.random() * 0.3);
        const ca = Math.cos(a), sa = Math.sin(a);
        fx.puff({ x: B.ball.position.x + ca * rr, y: B.ball.position.y - rCap * 0.15 + Math.random() * rCap * 0.3, z: B.ball.position.z + sa * rr,
          vx: ca * rCap * 0.03, vy: rCap * 0.04, vz: sa * rCap * 0.03, life: 18 + Math.random() * 10, s0: rCap * 0.35, s1: rCap * 0.6, a: 0.5, fin: 0.12, fpow: 1.2, drag: 0.2, rotv: (Math.random() - 0.5) * 0.2 }, 'smoke', 0.8);
      }
    }
  }

  reset() {
    for (const M of this.missiles) this._remove(M);
    for (const B of this.blasts) this._drop(B);
    this.missiles.length = 0; this.blasts.length = 0;
  }
}
