// 아군 분대: 절차적 애니메이션(보행 주기 + 발 고정 + 다리/팔 IK + 시선) 과 동행 AI
import * as THREE from 'three';
import { createHuman, SKEL, BI, frameQuat, setWorldQuat, restDir, WIND, VARIANTS } from './human.js';
import { GUN_BUILDERS } from './guns.js';
import { patchInterior } from './world.js';
import { Audio } from './audio.js';
import { clamp, lerp, damp, rand, gauss, solveIK, raySphere, smooth } from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), FWD = V(0, 0, 1);
const REST = {};
for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
  REST['uarm' + k] = restDir('uarm' + k, 'farm' + k);
  REST['farm' + k] = restDir('farm' + k, 'hand' + k);
  REST['along' + k] = restDir('hand' + k, 'fing1' + k);
  REST['palm' + k] = V(-s * 0.7071, -0.7071, 0);
  REST['thigh' + k] = restDir('thigh' + k, 'shin' + k);
  REST['shin' + k] = restDir('shin' + k, 'foot' + k);
  REST['foot' + k] = restDir('foot' + k, 'toe' + k);
  REST['curl' + k] = new THREE.Vector3().crossVectors(REST['along' + k], REST['palm' + k]).normalize();
  REST['tcurl' + k] = REST['curl' + k].clone();
}
const LEN = { upper: 0.295, fore: 0.255, thigh: 0.431, shin: 0.415 };
const ANKLE_H = 0.085;
// 손목 → 쥔 손 중심(휴지 공간)
const GRIP_OFF = { L: V(0, 0, 0), R: V(0, 0, 0) };
for (const [s, k] of [[1, 'L'], [-1, 'R']]) GRIP_OFF[k].copy(REST['along' + k]).multiplyScalar(0.06).addScaledVector(REST['palm' + k], 0.03);

const _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0), _d = V(0, 0, 0), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();

// 총 프로토타입(지오메트리 공유)
const PROTO = {};
export function propGun(type) {
  if (!PROTO[type]) PROTO[type] = GUN_BUILDERS[type]();
  const p = PROTO[type], g = p.group.clone(true);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.isShaderMaterial || o.material.transparent) o.visible = false; } });
  const find = (n) => g.getObjectByName(n);
  // 개머리판 끝(견착점) 추정: 바운딩 박스 뒤쪽
  const box = new THREE.Box3().setFromObject(p.group);
  return { group: g, grip: find('grip'), fore: find('fore'), butt: V(0, -0.03, box.max.z - 0.01), type };
}

export class HumanAnimator {
  constructor(h) {
    this.h = h; this.B = h.bones;
    this.phase = Math.random(); this.gaitW = 0; this.t = Math.random() * 10;
    this.feet = { L: { p: V(0, 0, 0), yaw: 0, step: 0, from: V(0, 0, 0), to: V(0, 0, 0) }, R: { p: V(0, 0, 0), yaw: 0, step: 0, from: V(0, 0, 0), to: V(0, 0, 0) } };
    this.init = false;
    this.look = V(0, 1.6, 5); this.lookW = V(0, 1.6, 5);
    this.headYaw = 0; this.headPitch = 0;
    this.flinch = 0; this.crouchT = 0; this.ready = 0; this.aimPitch = 0; this.aimYaw = 0; this.lean = 0;
    this.gunSway = V(0, 0, 0);
  }

  // o: {pos, yaw, vel, crouch, ready, aimPitch, aimYaw, lookAt, gun}
  update(dt, o) {
    const B = this.B, root = this.h.root;
    this.t += dt;
    const yaw = o.yaw;
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw)), right = V(-Math.cos(yaw), 0, Math.sin(yaw));
    root.position.copy(o.pos); root.rotation.set(0, yaw, 0); root.updateMatrixWorld();
    for (const b of Object.values(B)) b.quaternion.identity();
    B.hips.position.copy(SKEL[BI.hips].p);
    const hv = Math.hypot(o.vel.x, o.vel.z);
    this.crouchT = damp(this.crouchT, o.crouch ? 1 : 0, 6, dt);
    this.ready = damp(this.ready, o.ready ?? 0, 5, dt);
    this.flinch = Math.max(0, this.flinch - dt * 1.4);
    const fl = smooth(Math.min(1, this.flinch));
    // ── 보행 주기 ──
    const moving = hv > 0.25;
    this.gaitW = damp(this.gaitW, moving ? 1 : 0, 6, dt);
    const L = 0.9 + 0.45 * Math.min(hv, 6), beta = clamp(0.64 - 0.07 * (hv - 1.4), 0.36, 0.64);
    if (moving) this.phase = (this.phase + hv * dt / L) % 1;
    const run = clamp((hv - 2.2) / 2.5, 0, 1);
    const mdir = moving ? V(o.vel.x / hv, 0, o.vel.z / hv) : fwd.clone();
    // ── 골반/척추 ──
    const cr = this.crouchT, w = this.gaitW;
    const bob = (Math.cos(this.phase * Math.PI * 4) * (0.018 + run * 0.02) - 0.01 - run * 0.03) * w;
    const sway = Math.sin(this.phase * Math.PI * 2) * 0.022 * w * (1 - run * 0.6);
    const idleShift = Math.sin(this.t * 0.45) * 0.012 * (1 - w);
    B.hips.position.y += bob - cr * 0.36 - fl * 0.15 - this.ready * 0.02;
    B.hips.position.x += sway + idleShift;
    const twist = Math.sin(this.phase * Math.PI * 2) * 0.12 * w;
    B.hips.quaternion.setFromEuler(new THREE.Euler(0.05 * w + run * 0.1 + cr * 0.25, twist, sway * 1.2, 'YXZ'));
    const breath = Math.sin(this.t * 1.6) * 0.015;
    const lean = 0.04 + run * 0.18 + cr * 0.2 + fl * 0.35;
    B.spine.quaternion.setFromEuler(new THREE.Euler(lean * 0.4 - o.aimPitch * 0.15, -twist * 0.6 + o.aimYaw * 0.3, 0, 'YXZ'));
    B.chest.quaternion.setFromEuler(new THREE.Euler(lean * 0.3 + breath - o.aimPitch * 0.25, -twist * 0.5 + o.aimYaw * 0.35, 0, 'YXZ'));
    root.updateMatrixWorld(true);
    // ── 다리 (발 고정 + IK) ──
    const hipGround = V(0, 0, 0).setFromMatrixPosition(B.hips.matrixWorld); hipGround.y = o.pos.y;
    if (!this.init) {
      for (const [s, k] of [[1, 'L'], [-1, 'R']]) { this.feet[k].p.copy(o.pos).addScaledVector(right, -s * 0.11).addScaledVector(fwd, 0.02); this.feet[k].yaw = yaw; }
      this.init = true;
    }
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const F = this.feet[k];
      const ideal = o.pos.clone().addScaledVector(right, -s * (0.11 + cr * 0.05)).addScaledVector(fwd, 0.02 + (k === 'L' ? cr * 0.12 : -cr * 0.08));
      // 보행 궤적
      const u = (this.phase + (k === 'L' ? 0 : 0.5)) % 1, Sf = beta * L;
      let along, lift;
      if (u < beta) { along = lerp(Sf / 2, -Sf / 2, u / beta); lift = 0; }
      else { const sp = (u - beta) / (1 - beta); along = lerp(-Sf / 2, Sf / 2, smooth(sp)); lift = Math.sin(Math.PI * sp) * (0.07 + run * 0.14); }
      const gait = hipGround.clone().addScaledVector(right, -s * 0.1).addScaledVector(mdir, along); gait.y += lift;
      // 제자리: 이탈하면 한 발씩 스텝
      if (this.gaitW < 0.5) {
        if (F.step <= 0) {
          const other = this.feet[k === 'L' ? 'R' : 'L'];
          const dev = F.p.distanceTo(ideal), dy = Math.abs(Math.atan2(Math.sin(yaw - F.yaw), Math.cos(yaw - F.yaw)));
          if ((dev > 0.2 || dy > 0.6) && other.step <= 0) { F.step = 1; F.from.copy(F.p); F.to.copy(ideal); F.yaw0 = F.yaw; }
        }
        if (F.step > 0) {
          F.step = Math.max(0, F.step - dt / 0.28);
          const k2 = smooth(1 - F.step);
          F.p.lerpVectors(F.from, F.to, k2); F.p.y = o.pos.y + Math.sin(Math.PI * k2) * 0.06;
          F.yaw = F.yaw0 + Math.atan2(Math.sin(yaw - F.yaw0), Math.cos(yaw - F.yaw0)) * k2;
        }
      } else { F.p.copy(gait); F.yaw = yaw; F.step = 0; }
      const foot = F.p.clone().lerp(gait, this.gaitW);
      const fyaw = this.gaitW > 0.5 ? yaw : F.yaw;
      // 발목 목표
      const toe = V(Math.sin(fyaw + s * 0.08), 0, Math.cos(fyaw + s * 0.08));
      const ankle = foot.clone(); ankle.y += ANKLE_H; ankle.addScaledVector(toe, -0.015);
      // 발가락 들림 (스윙) / 뒤꿈치
      let pitch = 0;
      if (this.gaitW > 0.3) { const uu = (this.phase + (k === 'L' ? 0 : 0.5)) % 1; pitch = uu < beta ? lerp(0.25, -0.2, uu / beta) * (uu < 0.1 ? 1 : uu > beta - 0.1 ? 1 : 0.2) : Math.sin(Math.PI * (uu - beta) / (1 - beta)) * -0.4; pitch *= this.gaitW; }
      const hip = V(0, 0, 0).setFromMatrixPosition(B['thigh' + k].matrixWorld);
      const knee = V(0, 0, 0);
      const pole = fwd.clone().addScaledVector(right, -s * 0.15).normalize();
      solveIK(hip, ankle, LEN.thigh, LEN.shin, pole, knee);
      const kf = knee.clone().sub(hip.clone().add(ankle).multiplyScalar(0.5)); if (kf.lengthSq() < 1e-6) kf.copy(pole);
      setWorldQuat(B['thigh' + k], frameQuat(REST['thigh' + k], FWD, knee.clone().sub(hip), kf));
      setWorldQuat(B['shin' + k], frameQuat(REST['shin' + k], FWD, ankle.clone().sub(knee), toe));
      const toeDir = toe.clone().applyAxisAngle(V(Math.cos(fyaw), 0, -Math.sin(fyaw)), -pitch);
      setWorldQuat(B['foot' + k], frameQuat(REST['foot' + k], UP, toeDir, UP));
    }
    // ── 총 자세 ──
    const g = o.gun;
    if (g) {
      B.chest.updateMatrixWorld(true);
      const pocket = V(-0.13, 0.14, 0.1).applyMatrix4(B.chest.matrixWorld);
      const low = lerp(-0.62, 0, this.ready);
      const ap = lerp(low, o.aimPitch, this.ready) - fl * 0.4;
      const ay = yaw + o.aimYaw * this.ready + lerp(-0.35, 0, this.ready);
      this.gunSway.set(Math.sin(this.t * 1.3) * 0.015 + Math.sin(this.phase * Math.PI * 4) * 0.03 * w, Math.sin(this.t * 0.9) * 0.02 + Math.sin(this.phase * Math.PI * 2) * 0.04 * w, 0);
      const dir = V(Math.sin(ay) * Math.cos(ap + this.gunSway.x), Math.sin(ap + this.gunSway.x), Math.cos(ay) * Math.cos(ap + this.gunSway.x));
      const q = frameQuat(V(0, 0, -1), UP, dir, UP.clone().applyAxisAngle(dir, this.gunSway.y * 0.5 + lerp(0.25, 0, this.ready)));
      g.group.quaternion.copy(q);
      g.group.position.copy(pocket).sub(g.butt.clone().applyQuaternion(q));
      g.group.updateMatrixWorld(true);
      // 팔 IK
      this.arm('R', g.grip, 1.25, 1.1, right, fwd);
      this.arm('L', g.fore, 0.95, 0.9, right, fwd);
    }
    // ── 시선 (목/머리/눈) ──
    const head = V(0, 0, 0).setFromMatrixPosition(B.neck.matrixWorld);
    this.lookW.lerp(o.lookAt || head.clone().addScaledVector(fwd, 5), 1 - Math.exp(-4 * dt));
    const ld = this.lookW.clone().sub(head);
    B.chest.updateMatrixWorld(true);
    const inv = B.chest.getWorldQuaternion(new THREE.Quaternion()).invert();
    ld.applyQuaternion(inv);
    const ty = clamp(Math.atan2(ld.x, ld.z), -1.2, 1.2), tp = clamp(Math.atan2(ld.y, Math.hypot(ld.x, ld.z)), -0.6, 0.6);
    this.headYaw = damp(this.headYaw, ty, 6, dt); this.headPitch = damp(this.headPitch, tp, 6, dt);
    B.neck.quaternion.setFromEuler(new THREE.Euler(-this.headPitch * 0.4 + fl * 0.3, this.headYaw * 0.4, 0, 'YXZ'));
    B.head.quaternion.setFromEuler(new THREE.Euler(-this.headPitch * 0.6 + fl * 0.4, this.headYaw * 0.6, Math.sin(this.t * 0.7) * 0.02, 'YXZ'));
    root.updateMatrixWorld(true);
    // 눈동자 + 머리카락 바람
    const hg = this.h.head, ud = hg.userData;
    if (ud.eyes) {
      const hq = B.head.getWorldQuaternion(new THREE.Quaternion()).invert();
      const eyeT = this.lookW.clone().sub(V(0, 0, 0).setFromMatrixPosition(B.head.matrixWorld)).applyQuaternion(hq).normalize();
      for (const e of ud.eyes) e.quaternion.setFromUnitVectors(FWD, V(clamp(eyeT.x, -0.35, 0.35), clamp(eyeT.y, -0.25, 0.25), 1).normalize());
      if (ud.hmat?.userData.wLocal) ud.hmat.userData.wLocal.value.copy(WIND.dir.value).applyQuaternion(hq).multiplyScalar(1 + (hv > 3 ? 0.6 : 0));
    }
  }

  arm(k, anchor, c1, c2, right, fwd) {
    const B = this.B, s = k === 'L' ? 1 : -1;
    anchor.updateWorldMatrix(true, false);
    const ap = V(0, 0, 0), aq = new THREE.Quaternion(), sc = V(0, 0, 0);
    anchor.matrixWorld.decompose(ap, aq, sc);
    const ax = V(1, 0, 0).applyQuaternion(aq), az = V(0, 0, 1).applyQuaternion(aq);
    // 손 방향: 손가락은 -Z(앞), 손바닥은 오른손 -X / 왼손 +X
    const along = az.clone().negate(), palm = ax.clone().multiplyScalar(k === 'R' ? -1 : 1);
    const Qh = frameQuat(REST['along' + k], REST['palm' + k], along, palm);
    const wrist = ap.clone().sub(GRIP_OFF[k].clone().applyQuaternion(Qh));
    const sh = V(0, 0, 0).setFromMatrixPosition(B['uarm' + k].matrixWorld);
    const elbow = V(0, 0, 0);
    const pole = V(0, -1, 0).addScaledVector(right, -s * 0.8).addScaledVector(fwd, -0.3).normalize();
    solveIK(sh, wrist, LEN.upper, LEN.fore, pole, elbow);
    const fl = wrist.clone().sub(elbow);
    const ua = elbow.clone().sub(sh), flex = fl.clone().addScaledVector(ua.clone().normalize(), -fl.dot(ua.clone().normalize()));
    setWorldQuat(B['uarm' + k], frameQuat(REST['uarm' + k], FWD, ua, flex.lengthSq() > 1e-8 ? flex : fwd));
    setWorldQuat(B['farm' + k], frameQuat(REST['farm' + k], FWD, fl, V(0, 0, 1).applyQuaternion(Qh)));
    setWorldQuat(B['hand' + k], Qh);
    const ca = REST['curl' + k];
    B['fing1' + k].quaternion.setFromAxisAngle(ca, c1);
    B['fing2' + k].quaternion.setFromAxisAngle(ca, c2);
    B['thumb1' + k].quaternion.setFromAxisAngle(REST['along' + k], s * 0.4).multiply(_q.setFromAxisAngle(ca, 0.5));
    B['thumb2' + k].quaternion.setFromAxisAngle(ca, 0.6);
  }
}

// ════════ 분대 AI ════════
const SLOTS = [V(-1.7, 0, -1.6), V(1.8, 0, -2.2), V(-0.9, 0, -3.9), V(1.2, 0, -4.8)];
const GUNS = { jin: 'm4', mason: 'm4', sofia: 'm4', dae: 'ak' };

class Friend {
  constructor(squad, key, i) {
    this.sq = squad; this.g = squad.g; this.key = key; this.slot = SLOTS[i % SLOTS.length];
    this.h = createHuman(key);
    this.anim = new HumanAnimator(this.h);
    this.gun = propGun(GUNS[key] || 'm4');
    this.g.scene.add(this.h.root); this.g.scene.add(this.gun.group);
    this.pos = this.g.player.pos.clone().add(V(this.slot.x, 0, -this.slot.z));
    this.vel = V(0, 0, 0); this.yaw = 0; this.st = { grounded: true, canStep: true };
    this.path = null; this.pathT = 0; this.pi = 0;
    this.crouch = false; this.flinchT = 0; this.scanT = rand(1, 4); this.scanTarget = null; this.hitCD = 0;
    this.spheres = Array.from({ length: 10 }, () => ({ c: V(0, 0, 0), r: 0.1 }));
    this.name = VARIANTS[key].name;
  }

  update(dt) {
    const g = this.g, P = g.player, W = g.weapons, w = g.world;
    this.hitCD -= dt;
    // 목표 위치 (플레이어 기준 대형)
    const py = P.yaw + Math.PI; // 플레이어 전방: (-sin, -cos) → 캐릭터 yaw 기준 변환
    const pf = V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), pr = V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const target = P.pos.clone().addScaledVector(pr, this.slot.x).addScaledVector(pf, this.slot.z);
    const dist = target.distanceTo(this.pos), pd = P.pos.distanceTo(this.pos);
    let desired = V(0, 0, 0), speed = 0;
    if (dist > 1.2) {
      speed = dist > 9 ? 5.2 : dist > 4 ? 3.4 : 1.6;
      if (P.sprinting && dist > 2.5) speed = 5.5;
      this.pathT -= dt;
      if (this.pathT <= 0 || !this.path) { this.path = w.findPath(this.pos, target); this.pi = 0; this.pathT = 0.8; }
      if (this.path && this.pi < this.path.length) {
        const wp = this.path[this.pi], d = V(wp.x - this.pos.x, 0, wp.z - this.pos.z);
        if (d.length() < 0.5 && this.pi < this.path.length - 1) this.pi++;
        desired.copy(d.normalize()).multiplyScalar(speed * clamp(dist / 1.5, 0.3, 1));
      }
    }
    if (pd > 45) { this.pos.copy(target); this.path = null; }
    // 분리 (서로/플레이어)
    const push = (p, r) => { const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d2 = dx * dx + dz * dz; if (d2 < r * r && d2 > 1e-5) { const k = (r - Math.sqrt(d2)) * 4; desired.x += dx * k; desired.z += dz * k; } };
    for (const o of this.sq.list) if (o !== this) push(o.pos, 1.0);
    push(P.pos, 1.1);
    if (this.flinchT > 0) { this.flinchT -= dt; desired.multiplyScalar(0.3); }
    const crouching = (P.crouching && dist < 2.5) || this.flinchT > 0.3;
    if (crouching) desired.multiplyScalar(0.5);
    this.vel.x = damp(this.vel.x, desired.x, 7, dt); this.vel.z = damp(this.vel.z, desired.z, 7, dt);
    this.vel.y -= 16 * dt;
    this.st.canStep = true;
    w.move(this.pos, this.vel, dt, 0.28, 1.75, this.st);
    // 방향: 이동 중엔 진행 방향, 정지 시 플레이어 시선 방향 + 개인 편차
    const hv = Math.hypot(this.vel.x, this.vel.z);
    let tyaw;
    const aiming = W.ads > 0.5 || g.inCombat > 0;
    if (hv > 0.4) tyaw = Math.atan2(this.vel.x, this.vel.z);
    else tyaw = Math.atan2(pf.x, pf.z) + this.slot.x * 0.12;
    const dy = Math.atan2(Math.sin(tyaw - this.yaw), Math.cos(tyaw - this.yaw));
    this.yaw += clamp(dy, -4 * dt, 4 * dt);
    // 시선: 주기적으로 주변 탐색, 조준 중엔 플레이어의 조준점
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = rand(2, 5); const a = this.yaw + rand(-1.1, 1.1); this.scanTarget = this.pos.clone().add(V(Math.sin(a) * 10, rand(0.8, 2.5), Math.cos(a) * 10)); if (Math.random() < 0.3) this.scanTarget = P.eye.clone(); }
    let look = this.scanTarget;
    let aimPitch = 0, aimYaw = 0;
    if (aiming && g.aimPoint) {
      look = g.aimPoint;
      const d = g.aimPoint.clone().sub(this.pos); d.y -= 1.45;
      aimPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.6);
      aimYaw = clamp(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - this.yaw), Math.cos(Math.atan2(d.x, d.z) - this.yaw)), -0.8, 0.8);
    }
    this.anim.flinch = Math.max(this.anim.flinch, this.flinchT > 0 ? Math.min(1, this.flinchT) : 0);
    this.anim.update(dt, { pos: this.pos, yaw: this.yaw, vel: this.vel, crouch: crouching, ready: aiming ? 1 : 0, aimPitch, aimYaw, lookAt: look, gun: this.gun });
    // 발소리
    this.stepAcc = (this.stepAcc || 0) + hv * dt;
    if (this.stepAcc > (hv > 3 ? 1.2 : 0.75) && hv > 0.5) { this.stepAcc = 0; if (pd < 25) Audio.play3D(this.st.surf === 'metal' ? 'stepMetal' : this.st.surf === 'dirt' ? 'stepDirt' : 'stepConcrete', this.pos, { vol: hv > 3 ? 0.45 : 0.25, ref: 3, speedDelay: false }); }
  }

  hitboxes() {
    const B = this.h.bones, S = this.spheres;
    const set = (i, b, r, off) => { S[i].c.setFromMatrixPosition(B[b].matrixWorld); if (off) S[i].c.add(off); S[i].r = r; };
    set(0, 'head', 0.13, V(0, 0.09, 0)); set(1, 'chest', 0.22, V(0, 0.08, 0)); set(2, 'spine', 0.2); set(3, 'hips', 0.18);
    set(4, 'shinL', 0.09); set(5, 'shinR', 0.09); set(6, 'thighL', 0.1, V(0, -0.2, 0)); set(7, 'thighR', 0.1, V(0, -0.2, 0));
    set(8, 'farmL', 0.07); set(9, 'farmR', 0.07);
    return S;
  }

  onHit(dir) {
    if (this.hitCD > 0) return;
    this.hitCD = 0.3;
    this.flinchT = 1.2; this.anim.flinch = 1;
    this.path = null;
    this.pos.addScaledVector(V(dir.x, 0, dir.z).normalize(), 0.15);
  }
}

export class Squad {
  constructor(game) { this.g = game; this.list = []; }
  spawn(keys = ['jin', 'mason', 'sofia', 'dae']) { this.clear(); keys.forEach((k, i) => this.list.push(new Friend(this, k, i))); }
  update(dt) { WIND.time.value += dt; for (const f of this.list) f.update(dt); }
  raycast(o, d, maxT) {
    let best = maxT, res = null;
    for (const f of this.list) {
      _a.set(f.pos.x, f.pos.y + 1.0, f.pos.z);
      if (raySphere(o, d, _a, 1.2, best + 1.2) < 0 && _a.distanceTo(o) > 1.2) continue;
      for (const s of f.hitboxes()) { const t = raySphere(o, d, s.c, s.r, best); if (t >= 0 && t < best) { best = t; res = { t, friend: f, c: s.c.clone() }; } }
    }
    if (res) { res.point = o.clone().addScaledVector(d, res.t); res.n = res.point.clone().sub(res.c).normalize(); }
    return res;
  }
  react(pos, radius, strength = 1) {
    for (const f of this.list) { const d = f.pos.distanceTo(pos); if (d < radius) { f.flinchT = Math.max(f.flinchT, strength * (1 - d / radius) * 1.6); } }
  }
  clear() { for (const f of this.list) { this.g.scene.remove(f.h.root); this.g.scene.remove(f.gun.group); } this.list = []; }
}
