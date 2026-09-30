// 아군 분대: 절차적 애니메이션(보행 주기 + 발 고정 + 다리/팔 IK + 시선) 과 동행 AI
import * as THREE from 'three';
import { createHuman, SKEL, BI, frameQuat, setWorldQuat, restDir, WIND, VARIANTS } from './human.js';
import { GUN_BUILDERS } from './guns.js';
import { applyHandPose, gunPose, preset } from './hand.js';
import { patchInterior } from './world.js';
import { Audio } from './audio.js';
import { clamp, lerp, damp, rand, gauss, solveIK, raySphere, smooth } from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), FWD = V(0, 0, 1);
const REST = {}, HB = {};
for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
  HB[k] = { d: V(s * 0.7071, -0.7071, 0), n: V(-s * 0.7071, -0.7071, 0), w: V(0, 0, 1) };   // 손 로컬 기저 (hand.js 와 동일)
  REST['uarm' + k] = restDir('uarm' + k, 'farm' + k);
  REST['farm' + k] = restDir('farm' + k, 'hand' + k);
  REST['along' + k] = HB[k].d; REST['palm' + k] = HB[k].n;
  REST['thigh' + k] = restDir('thigh' + k, 'shin' + k);
  REST['shin' + k] = restDir('shin' + k, 'foot' + k);
  REST['foot' + k] = restDir('foot' + k, 'toe' + k);
}
const LEN = { upper: 0.295, fore: 0.255, thigh: 0.431, shin: 0.415 };
const ANKLE_H = 0.085, REACH = 0.535;   // 팔꿈치가 살짝 굽는 실제 도달 거리
const PISTOLS = new Set(['glock', 'm1911', 'deagle', 'python']);
const RELAXED = preset('relaxed');

const _a = V(0, 0, 0), _q = new THREE.Quaternion();

// 총 프로토타입(지오메트리 공유) + 실제 총 형상에 맞춘 손 자세(1회 계산)
const PROTO = {};
export function propGun(type) {
  if (!PROTO[type]) {
    const p = GUN_BUILDERS[type]();
    p.poses = { grip: gunPose(p, p.anchors.grip, 'grip', 'R', PISTOLS.has(type)), fore: gunPose(p, p.anchors.fore, 'fore', 'L', PISTOLS.has(type)) };
    PROTO[type] = p;
  }
  const p = PROTO[type], g = p.group.clone(true);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.isShaderMaterial || o.material.transparent) o.visible = false; } });
  const find = (n) => g.getObjectByName(n);
  // 개머리판 끝(견착점): 바운딩 박스 뒤쪽
  const box = new THREE.Box3().setFromObject(p.group);
  return { group: g, grip: find('grip'), fore: find('fore'), butt: V(0, -0.03, box.max.z - 0.01), sight: p.sight.clone(), poses: p.poses, type, pistol: PISTOLS.has(type) };
}

export class HumanAnimator {
  constructor(h) {
    this.h = h; this.B = h.bones;
    this.phase = Math.random(); this.gaitW = 0; this.t = Math.random() * 10;
    this.feet = { L: { p: V(0, 0, 0), yaw: 0, step: 0, from: V(0, 0, 0), to: V(0, 0, 0) }, R: { p: V(0, 0, 0), yaw: 0, step: 0, from: V(0, 0, 0), to: V(0, 0, 0) } };
    this.init = false;
    this.look = V(0, 1.6, 5); this.lookW = V(0, 1.6, 5);
    this.headYaw = 0; this.headPitch = 0; this.weldP = 0; this.weldR = 0;
    this.flinch = 0; this.crouchT = 0; this.ready = 0;
    this.gunSway = V(0, 0, 0); this.slide = 0; this.pull = 0;
    this.blinkT = 1 + Math.random() * 4; this.blink = 0;
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
    // ── 골반/척추: 사격 자세는 몸통을 오른쪽으로 틀어(블레이딩) 왼쪽 어깨가 앞으로, 상체 약간 전경 ──
    const cr = this.crouchT, w = this.gaitW, r = this.ready;
    const blade = (r * 0.55 + (1 - r) * 0.2) * (1 - w * 0.55);
    const bob = (Math.cos(this.phase * Math.PI * 4) * (0.018 + run * 0.02) - 0.01 - run * 0.03) * w;
    const sway = Math.sin(this.phase * Math.PI * 2) * 0.022 * w * (1 - run * 0.6);
    const idleShift = Math.sin(this.t * 0.45) * 0.012 * (1 - w);
    B.hips.position.y += bob - cr * 0.36 - fl * 0.15 - r * 0.03;
    B.hips.position.x += sway + idleShift;
    const twist = Math.sin(this.phase * Math.PI * 2) * 0.12 * w;
    B.hips.quaternion.setFromEuler(new THREE.Euler(0.05 * w + run * 0.1 + cr * 0.25 + r * 0.04, twist - blade, sway * 1.2, 'YXZ'));
    const breath = Math.sin(this.t * 1.6) * 0.015;
    const lean = 0.04 + run * 0.18 + cr * 0.2 + fl * 0.35 + r * 0.08;
    const ay0 = clamp(o.aimYaw, -0.9, 0.9) * r;
    B.spine.quaternion.setFromEuler(new THREE.Euler(lean * 0.4 - o.aimPitch * 0.15 * r, -twist * 0.6 + blade * 0.35 + ay0 * 0.3, 0, 'YXZ'));
    B.chest.quaternion.setFromEuler(new THREE.Euler(lean * 0.3 + breath - o.aimPitch * 0.25 * r, -twist * 0.5 + blade * 0.25 + ay0 * 0.35, 0, 'YXZ'));
    root.updateMatrixWorld(true);
    // ── 다리 (발 고정 + IK) — 서 있을 땐 사격 자세 발 배치(왼발 앞, 오른발 뒤, 발끝은 골반 방향) ──
    const hipGround = V(0, 0, 0).setFromMatrixPosition(B.hips.matrixWorld); hipGround.y = o.pos.y;
    const sy = yaw - blade * 0.8, sfw = V(Math.sin(sy), 0, Math.cos(sy)), srt = V(-Math.cos(sy), 0, Math.sin(sy));
    if (!this.init) {
      for (const [s, k] of [[1, 'L'], [-1, 'R']]) { this.feet[k].p.copy(o.pos).addScaledVector(srt, -s * 0.11).addScaledVector(sfw, 0.02); this.feet[k].yaw = sy; }
      this.init = true;
    }
    for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
      const F = this.feet[k];
      const ideal = o.pos.clone().addScaledVector(srt, -s * (0.11 + cr * 0.05 + r * 0.035)).addScaledVector(sfw, 0.02 + (k === 'L' ? cr * 0.12 + r * 0.1 : -cr * 0.08 - r * 0.08));
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
          const dev = F.p.distanceTo(ideal), dy = Math.abs(Math.atan2(Math.sin(sy - F.yaw), Math.cos(sy - F.yaw)));
          if ((dev > 0.1 || dy > 0.4) && other.step <= 0) {
            F.step = 1; F.from.copy(F.p); F.to.copy(ideal); F.yaw0 = F.yaw;
            // 디딘 발 위에 겹쳐 딛지 않도록: 옆으로 최소 17cm
            const sep = F.to.clone().sub(other.p); sep.y = 0;
            const lat = sep.dot(srt) * -s;
            if (sep.length() < 0.17) F.to.addScaledVector(srt, -s * Math.max(0, 0.17 - Math.max(0, lat)));
          }
        }
        if (F.step > 0) {
          F.step = Math.max(0, F.step - dt / 0.28);
          const k2 = smooth(1 - F.step);
          F.p.lerpVectors(F.from, F.to, k2).addScaledVector(srt, -s * Math.sin(Math.PI * k2) * 0.035); F.p.y = o.pos.y + Math.sin(Math.PI * k2) * 0.06;
          F.yaw = F.yaw0 + Math.atan2(Math.sin(sy - F.yaw0), Math.cos(sy - F.yaw0)) * k2;
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
      const pole = toe.clone().addScaledVector(right, -s * 0.12).normalize();
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
      // 견착점: 오른쪽 어깨 안쪽 오목한 곳 (방탄복 앞면 바깥)
      const pocket = V(-0.125, lerp(0.125, 0.172, r), lerp(0.1, 0.095, r)).applyMatrix4(B.chest.matrixWorld);
      const low = lerp(-0.62, -0.8, run);
      const ap = lerp(low, o.aimPitch, r) - fl * 0.4;
      const ay = yaw + o.aimYaw * r + (1 - r) * (0.32 + 0.2 * run);   // 로우레디: 총구가 몸 앞 왼쪽 아래
      this.gunSway.set(Math.sin(this.t * 1.3) * 0.012 * (1 - r * 0.6) + Math.sin(this.phase * Math.PI * 4) * 0.03 * w, Math.sin(this.t * 0.9) * 0.02 + Math.sin(this.phase * Math.PI * 2) * 0.04 * w, 0);
      const dir = V(Math.sin(ay) * Math.cos(ap + this.gunSway.x), Math.sin(ap + this.gunSway.x), Math.cos(ay) * Math.cos(ap + this.gunSway.x));
      const q = frameQuat(V(0, 0, -1), UP, dir, UP.clone().applyAxisAngle(dir, this.gunSway.y * 0.5 + lerp(0.3, 0, r)));
      g.group.quaternion.copy(q);
      const gF = V(0, 0, -1).applyQuaternion(q);
      // 보조손이 닿지 않으면: 핸드가드를 따라 손을 뒤로 → 그래도 멀면 총을 몸쪽으로 당김 (견착 해제)
      const shL = V(0, 0, 0).setFromMatrixPosition(B.uarmL.matrixWorld);
      let slide = 0.16, pull = 0;
      for (let tries = 0; tries < 2; tries++) {
        g.group.position.copy(pocket).sub(g.butt.clone().applyQuaternion(q)).addScaledVector(gF, -pull);
        g.group.updateMatrixWorld(true);
        const need = (sl) => this.wristFor('L', g.fore, g.poses.fore, gF.clone().multiplyScalar(-sl)).distanceTo(shL);
        slide = 0.16;
        for (let t = 0; t <= 0.16; t += 0.02) if (need(t) <= REACH) { slide = t; break; }
        const d = need(slide);
        if (d <= REACH + 0.005) break;
        pull = Math.min(0.14, pull + d - REACH);
      }
      this.slide = damp(this.slide, slide, 8, dt); this.pull = damp(this.pull, pull, 8, dt);
      g.group.position.copy(pocket).sub(g.butt.clone().applyQuaternion(q)).addScaledVector(gF, -this.pull);
      g.group.updateMatrixWorld(true);
      // 팔 IK + 손가락 (조준 중엔 검지를 방아쇠에, 아니면 프레임 위에 곧게)
      const pg = g.poses.grip || RELAXED;
      let poseR = pg;
      if (pg.indexTrig) { poseR = { ...pg }; poseR.index = pg.indexFrame.map((x, i) => x + (pg.indexTrig[i] - x) * smooth(clamp((r - 0.6) / 0.4, 0, 1))); }
      this.arm('R', g.grip, poseR, null, right, fwd);
      this.arm('L', g.fore, g.poses.fore || RELAXED, gF.clone().multiplyScalar(-this.slide), right, fwd);
    }
    // ── 시선 (목/머리/눈) + 조준 시 뺨을 개머리에 붙임(cheek weld) ──
    const head = V(0, 0, 0).setFromMatrixPosition(B.neck.matrixWorld);
    this.lookW.lerp(o.lookAt || head.clone().addScaledVector(fwd, 5), 1 - Math.exp(-4 * dt));
    const ld = this.lookW.clone().sub(head);
    B.chest.updateMatrixWorld(true);
    const inv = B.chest.getWorldQuaternion(new THREE.Quaternion()).invert();
    ld.applyQuaternion(inv);
    const ty = clamp(Math.atan2(ld.x, ld.z), -1.2, 1.2), tp = clamp(Math.atan2(ld.y, Math.hypot(ld.x, ld.z)), -0.6, 0.6);
    this.headYaw = damp(this.headYaw, ty, 6, dt); this.headPitch = damp(this.headPitch, tp, 6, dt);
    const setHead = () => {
      B.neck.quaternion.setFromEuler(new THREE.Euler(-this.headPitch * 0.4 + fl * 0.3 + this.weldP * 0.3, this.headYaw * 0.4, -this.weldR * 0.35, 'YXZ'));
      B.head.quaternion.setFromEuler(new THREE.Euler(-this.headPitch * 0.6 + fl * 0.4 + this.weldP * 0.7, this.headYaw * 0.6, Math.sin(this.t * 0.7) * 0.02 - this.weldR * 0.65, 'YXZ'));
      B.neck.updateMatrixWorld(true);
    };
    setHead();
    if (g && r > 0.05) {
      // 오른눈 → 조준선(가늠자 뒤 연장선) 수직 오차로 목 숙임/기울임 보정
      const gq = g.group.quaternion, gF = V(0, 0, -1).applyQuaternion(gq), gU = V(0, 1, 0).applyQuaternion(gq), gR = V(1, 0, 0).applyQuaternion(gq);
      const sight = g.sight.clone().applyMatrix4(g.group.matrixWorld);
      let wp = 0, wr = 0;
      for (let it = 0; it < 2; it++) {
        const eye = V(-0.031, 0.095, 0.09).applyMatrix4(B.head.matrixWorld), e = eye.sub(sight);
        e.addScaledVector(gF, -e.dot(gF));
        wp = clamp(wp + Math.atan2(e.dot(gU) - 0.02, 0.12), 0, 0.42);
        wr = clamp(wr + Math.atan2(-e.dot(gR), 0.12), -0.1, 0.45);
        this.weldP = wp * r; this.weldR = wr * r; setHead();
      }
    } else { this.weldP = damp(this.weldP, 0, 6, dt); this.weldR = damp(this.weldR, 0, 6, dt); setHead(); }
    root.updateMatrixWorld(true);
    // 눈동자 + 머리카락 바람
    const hg = this.h.head, ud = hg.userData;
    if (ud.eyes) {
      const hq = B.head.getWorldQuaternion(new THREE.Quaternion()).invert();
      const eyeT = this.lookW.clone().sub(V(0, 0, 0).setFromMatrixPosition(B.head.matrixWorld)).applyQuaternion(hq).normalize();
      // 단속 운동(사카드): 응시 중에도 0.3~2초마다 미세하게 시선이 튄다
      this.sacT = (this.sacT ?? 0) - dt;
      if (this.sacT <= 0) { this.sacT = 0.3 + Math.random() * 1.7; this.sac = [(Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.04]; }
      const sc = this.sac || [0, 0];
      for (const e of ud.eyes) e.quaternion.setFromUnitVectors(FWD, V(clamp(eyeT.x / Math.max(eyeT.z, 0.3) + sc[0], -0.35, 0.35), clamp(eyeT.y / Math.max(eyeT.z, 0.3) + sc[1], -0.25, 0.25), 1).normalize());
      if (ud.hmat?.userData.wLocal) ud.hmat.userData.wLocal.value.copy(WIND.dir.value).applyQuaternion(hq).multiplyScalar(1 + (hv > 3 ? 0.6 : 0));
    }
    // 눈 깜빡임 (2~6초 간격, 약 0.15초; 가끔 두 번)
    if (ud.lids) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 0.001; this.blinkT = Math.random() < 0.15 ? 0.25 : 2 + Math.random() * 4; }
      if (this.blink > 0) { this.blink += dt / 0.16; if (this.blink >= 1) this.blink = 0; }
      const b = this.blink > 0 ? Math.sin(Math.PI * this.blink) : 0, fl2 = Math.min(1, fl * 1.5);
      for (const l of ud.lids) l.rotation.x = lerp(-0.9, 1.4, Math.max(b, fl2 * 0.8));
    }
  }

  // 앵커(+이동) 에서 손 자세의 손목 위치
  wristFor(k, anchor, pose, shift) {
    anchor.updateWorldMatrix(true, false);
    const ap = V(0, 0, 0), aq = new THREE.Quaternion(), sc = V(0, 0, 0);
    anchor.matrixWorld.decompose(ap, aq, sc);
    if (shift) ap.add(shift);
    const along = V(0, 0, 1).applyQuaternion(aq).negate(), palm = V(1, 0, 0).applyQuaternion(aq).multiplyScalar(k === 'R' ? -1 : 1);
    const Qh = frameQuat(REST['along' + k], REST['palm' + k], along, palm);
    const H = HB[k], o = pose.off;
    this._Qh = Qh;
    return ap.sub(H.d.clone().multiplyScalar(o[0]).addScaledVector(H.n, o[1]).addScaledVector(H.w, o[2]).applyQuaternion(Qh));
  }

  arm(k, anchor, pose, shift, right, fwd) {
    const B = this.B, s = k === 'L' ? 1 : -1;
    const wrist = this.wristFor(k, anchor, pose, shift), Qh = this._Qh;
    const sh = V(0, 0, 0).setFromMatrixPosition(B['uarm' + k].matrixWorld);
    const elbow = V(0, 0, 0);
    const pole = V(0, -1, 0).addScaledVector(right, -s * 0.7).addScaledVector(fwd, -0.3).normalize();
    solveIK(sh, wrist, LEN.upper, LEN.fore, pole, elbow);
    const fl = wrist.clone().sub(elbow);
    const ua = elbow.clone().sub(sh), un = ua.clone().normalize(), flex = fl.clone().addScaledVector(un, -fl.dot(un));
    setWorldQuat(B['uarm' + k], frameQuat(REST['uarm' + k], FWD, ua, flex.lengthSq() > 1e-8 ? flex : fwd));
    setWorldQuat(B['farm' + k], frameQuat(REST['farm' + k], FWD, fl, V(0, 0, 1).applyQuaternion(Qh)));
    setWorldQuat(B['hand' + k], Qh);
    applyHandPose((n) => B[n + k], pose, HB[k]);
  }
}

// ════════ 2점식 슬링: 총 앞 고리 → 왼쪽 가슴·어깨 → 등 대각선 → 오른 겨드랑이 아래 → 개머리판 ════════
const SLING_PTS = [V(0.09, 0.12, 0.175), V(0.125, 0.245, 0.03), V(0.03, 0.13, -0.19), V(-0.14, -0.02, -0.12), V(-0.195, -0.03, 0.03)];
const SLING_MAT = new THREE.MeshStandardMaterial({ color: 0x4d4536, roughness: 0.92, side: THREE.DoubleSide });
class Sling {
  constructor(n = 40) {
    this.n = n;
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 2 * 3), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, SLING_MAT); this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.curve = new THREE.CatmullRomCurve3(Array.from({ length: SLING_PTS.length + 2 }, () => V(0, 0, 0)), false, 'centripetal');
  }
  update(chest, gun) {
    const gq = gun.group.quaternion, gp = gun.group.position, gF = V(0, 0, -1).applyQuaternion(gq), gL = V(-1, 0, 0).applyQuaternion(gq);
    const front = V(0, 0, 0).setFromMatrixPosition(gun.fore.matrixWorld).addScaledVector(gF, 0.05).addScaledVector(gL, 0.02);
    const rear = gun.butt.clone().applyQuaternion(gq).add(gp).addScaledVector(gF, 0.05).addScaledVector(gL, 0.02).add(V(0, -0.02, 0));
    const P = this.curve.points, c = V(0, 0, 0).setFromMatrixPosition(chest.matrixWorld);
    P[0].copy(front);
    SLING_PTS.forEach((q, i) => P[i + 1].copy(q).applyMatrix4(chest.matrixWorld));
    P[P.length - 1].copy(rear);
    const pos = this.mesh.geometry.attributes.position, t = V(0, 0, 0), nrm = V(0, 0, 0), b = V(0, 0, 0), p = V(0, 0, 0);
    for (let i = 0; i < this.n; i++) {
      const u = i / (this.n - 1);
      this.curve.getPoint(u, p); this.curve.getTangent(u, t);
      nrm.copy(p).sub(c); nrm.y *= 0.3; nrm.normalize();
      b.crossVectors(t, nrm).normalize().multiplyScalar(0.0125);
      p.addScaledVector(nrm, 0.004);
      pos.setXYZ(i * 2, p.x + b.x, p.y + b.y, p.z + b.z); pos.setXYZ(i * 2 + 1, p.x - b.x, p.y - b.y, p.z - b.z);
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals(); this.mesh.geometry.computeBoundingSphere();
  }
}

// 총기 라이트 광선 (옆에서 볼 때 안개 속 원뿔)
const BEAM_GEO = (() => { const g = new THREE.ConeGeometry(1, 1, 28, 1, true); g.translate(0, -0.5, 0); g.rotateX(-Math.PI / 2); return g; })();
const BEAM_MAT = new THREE.ShaderMaterial({
  uniforms: { uK: { value: 0 } },
  vertexShader: `varying float vZ; varying vec3 vN, vV; void main(){ vZ = position.z; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uK; varying float vZ; varying vec3 vN, vV; void main(){ float e = abs(dot(vN, vV)); float a = uK * pow(1. - vZ, 2.) * smoothstep(0.0, 0.05, vZ) * e * e * 0.07; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.); }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

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
    this.sling = new Sling(); this.g.scene.add(this.sling.mesh);
    // 총기 라이트 (야간에 플레이어가 켜면 함께 켬)
    this.light = new THREE.SpotLight(0xfff0dc, 0, 40, 0.32, 0.6, 1.6); this.g.scene.add(this.light, this.light.target); this.lightK = 0;
    this.beam = new THREE.Mesh(BEAM_GEO, BEAM_MAT.clone()); this.beam.scale.set(4.4, 4.4, 14); this.beam.visible = false; this.beam.renderOrder = 5; this.beam.frustumCulled = false; this.g.scene.add(this.beam);
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
    w.move(this.pos, this.vel, dt, 0.31, 1.75, this.st);
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
    // 눈 맞춤: 가까이서 플레이어가 이 대원을 바라보면 마주 봄
    if (pd < 3.5 && !aiming) {
      const cf = V(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
      const toMe = this.pos.clone().add(V(0, 1.6, 0)).sub(P.eye).normalize();
      if (cf.dot(toMe) > 0.965) { this.eyeT = 2.5; }
    }
    if ((this.eyeT = (this.eyeT || 0) - dt) > 0) look = P.eye.clone();
    let aimPitch = 0, aimYaw = 0, ready = aiming ? 1 : 0;
    if (aiming && g.aimPoint) {
      look = g.aimPoint;
      const d = g.aimPoint.clone().sub(this.pos); d.y -= 1.45;
      aimPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.6);
      aimYaw = clamp(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - this.yaw), Math.cos(Math.atan2(d.x, d.z) - this.yaw)), -0.8, 0.8);
    }
    // 총구 통제: 플레이어/아군이 총구 선상에 있으면 총구를 내리고, 벽이 가로막으면 들어 올리지 않음
    let safe = 0;
    if (ready) {
      // 겨누려는 선(총구 → 조준점) 위에 사람이 있으면 총구를 내린 채 유지
      const ay = this.yaw + aimYaw, ad = V(Math.sin(ay) * Math.cos(aimPitch), Math.sin(aimPitch), Math.cos(ay) * Math.cos(aimPitch));
      const mo = this.gun.group.position.lengthSq() > 0 ? this.gun.group.position.clone() : this.pos.clone().add(V(0, 1.42, 0));
      const inLine = (p) => { const v = p.clone().sub(mo), t = v.dot(ad); return t > 0.3 && t < 30 && v.addScaledVector(ad, -t).length() < 0.5 + t * 0.03; };
      if (inLine(P.eye) || inLine(P.pos.clone().add(V(0, 1.0, 0))) || this.sq.list.some((o) => o !== this && (inLine(o.pos.clone().add(V(0, 1.3, 0))) || inLine(o.pos.clone().add(V(0, 0.8, 0)))))) safe = 1;
      if (w.raycast(mo, ad, 0.95, { solid: true })) safe = Math.max(safe, 0.8);
    }
    this.safeT = damp(this.safeT || 0, safe, safe > this.safeT ? 12 : 3, dt);
    ready *= 1 - this.safeT;
    this.anim.flinch = Math.max(this.anim.flinch, this.flinchT > 0 ? Math.min(1, this.flinchT) : 0);
    this.anim.update(dt, { pos: this.pos, yaw: this.yaw, vel: this.vel, crouch: crouching, ready, aimPitch, aimYaw, lookAt: look, gun: this.gun });
    this.sling.update(this.h.bones.chest, this.gun);
    const DN = g.dayNight, wantL = DN && DN.flashOn && DN.lamp > 0.4 ? 1 : 0;
    this.lightK = damp(this.lightK, wantL, wantL ? 3 + this.slot.x : 4, dt);
    this.light.intensity = this.lightK > 0.05 ? 55 * this.lightK : 0;
    if (this.light.intensity > 0) {
      const gq = this.gun.group.quaternion, gF = V(0, 0, -1).applyQuaternion(gq);
      this.light.position.setFromMatrixPosition(this.gun.fore.matrixWorld).addScaledVector(gF, 0.12).add(V(0, 0.02, 0));
      this.light.target.position.copy(this.light.position).addScaledVector(gF, 10); this.light.target.updateMatrixWorld();
      this.beam.position.copy(this.light.position); this.beam.lookAt(this.light.target.position);
    }
    this.beam.visible = this.lightK > 0.05; this.beam.material.uniforms.uK.value = this.lightK;
    // 발소리
    this.stepAcc = (this.stepAcc || 0) + hv * dt;
    if (this.stepAcc > (hv > 3 ? 1.2 : 0.75) && hv > 0.5) {
      this.stepAcc = 0;
      if (pd < 25) Audio.play3D(this.st.surf === 'metal' ? 'stepMetal' : this.st.surf === 'dirt' ? 'stepDirt' : 'stepConcrete', this.pos, { vol: hv > 3 ? 0.45 : 0.25, ref: 3, speedDelay: false });
      // 달릴 때 발밑 먼지
      if (hv > 2.6 && pd < 40 && this.st.surf !== 'metal') {
        const c = this.st.surf === 'dirt' ? [0.34, 0.29, 0.21] : [0.4, 0.39, 0.37];
        for (let i = 0; i < 3; i++) g.fx.alpha.add(this.pos.clone().add(V(rand(-0.12, 0.12), 0.04, rand(-0.12, 0.12))), V(rand(-0.3, 0.3), rand(0.1, 0.35), rand(-0.3, 0.3)).addScaledVector(this.vel, 0.12), { life: rand(0.6, 1.1), size: rand(0.12, 0.22), grow: 0.5, drag: 2, grav: -0.04, color: c, alpha: 0.3, fadeIn: 0.05 });
      }
    }
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
  clear() { for (const f of this.list) { this.g.scene.remove(f.h.root); this.g.scene.remove(f.gun.group); this.g.scene.remove(f.sling.mesh); this.g.scene.remove(f.light, f.light.target, f.beam); } this.list = []; }
}
