// 절차적 애니메이션: 상태별 포즈를 블렌딩 → 채널별 2차 스프링(겹침 동작/관성) → 고주파 떨림 → 관절 적용
// 모든 각도 단위: 포즈 표는 도(deg), 내부 채널은 라디안.
import * as THREE from 'three';
import { RIG } from './avatar.js';

const D = Math.PI / 180;
const TAU = Math.PI * 2;

// 채널 배치
const NECK = 0, ARM_R = 3, ARM_L = 6, LEG_R = 9, LEG_L = 12, BPOS = 15, BROT = 18;
const N = 21;
// 채널 그룹 (스프링 파라미터 공유)
const G_NECK = 0, G_ARM = 1, G_LEG = 2, G_BPOS = 3, G_BROT = 4;
const GROUP = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  GROUP[i] = i < 3 ? G_NECK : i < 9 ? G_ARM : i < 15 ? G_LEG : i < 18 ? G_BPOS : G_BROT;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// 방향 무관 smoothstep (e0 > e1 도 허용)
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function damp(cur, target, rate, dt) {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}

// ── 포즈 작성 헬퍼 (T 배열에 가중치 w로 누적) ──
// 팔/다리: fwd = 앞으로 흔들기(+), out = 바깥으로 벌리기(+), tw = 비틀기
function arm(T, w, side, fwd, out, tw = 0) {
  const b = side ? ARM_L : ARM_R, s = side ? 1 : -1;
  T[b] += w * -fwd * D;
  T[b + 1] += w * s * tw * D;
  T[b + 2] += w * s * out * D;
}
function arms(T, w, fwd, out, tw = 0) { arm(T, w, 0, fwd, out, tw); arm(T, w, 1, fwd, out, tw); }
function leg(T, w, side, fwd, out) {
  const b = side ? LEG_L : LEG_R, s = side ? 1 : -1;
  T[b] += w * -fwd * D;
  T[b + 2] += w * s * out * D;
}
function legs(T, w, fwd, out) { leg(T, w, 0, fwd, out); leg(T, w, 1, fwd, out); }
// 머리: down = 숙이기(+), yaw = 좌우, roll
function head(T, w, down, yaw = 0, roll = 0) {
  T[NECK] += w * down * D;
  T[NECK + 1] += w * yaw * D;
  T[NECK + 2] += w * roll * D;
}
// 몸: 위치 오프셋(m) + 회전(도). rx + = 앞으로 숙임, rz = 옆 기울기, ry = 비틀기
function bodyP(T, w, px, py, pz, rx = 0, ry = 0, rz = 0) {
  T[BPOS] += w * px; T[BPOS + 1] += w * py; T[BPOS + 2] += w * pz;
  T[BROT] += w * rx * D; T[BROT + 1] += w * ry * D; T[BROT + 2] += w * rz * D;
}

// 채널 3개를 목표 각(라디안, 내부 부호 그대로)으로 보간
function lerpTo(T, b, k, x, y, z) {
  T[b] = lerp(T[b], x, k); T[b + 1] = lerp(T[b + 1], y, k); T[b + 2] = lerp(T[b + 2], z, k);
}

// 값 노이즈 대신 비정수 주파수 사인 합 (할당 없음, 연속)
function wobble(t, seed) {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.77 + seed * 3.1) * 0.2);
}
function flutter(t, seed) {
  return Math.sin(t * 107.0 + seed) * 0.5 + Math.sin(t * 146.3 + seed * 2.3) * 0.3 + Math.sin(t * 199.1 + seed * 4.1) * 0.2;
}

// 상태별 스프링 파라미터 [f(Hz), zeta] — 그룹 순서: neck, arm, leg, bodyPos, bodyRot
const SPRING = {
  ground: [[6, 0.75], [10, 0.6], [12, 0.72], [11, 0.7], [9, 0.75]],
  air:    [[5, 0.6], [6.5, 0.48], [7.5, 0.55], [7, 0.6], [6, 0.65]],
  fly:    [[4, 0.6], [4.2, 0.42], [3.1, 0.38], [3, 0.5], [3.4, 0.6]],
  hero:   [[9, 0.6], [16, 0.55], [18, 0.65], [16, 0.6], [14, 0.6]],
};

export class Animator {
  constructor(avatar) {
    this.av = avatar;
    this.T = new Float32Array(N);    // 목표
    this.Y = new Float32Array(N);    // 스프링 위치
    this.V = new Float32Array(N);    // 스프링 속도
    this.XP = new Float32Array(N);   // 이전 목표 (속도 추정)
    this.O = new Float32Array(N);    // 최종 출력
    this.f = new Float32Array(5).fill(6);
    this.z = new Float32Array(5).fill(0.6);

    // 레이어 가중치 (부드럽게 전환)
    this.w = { idle: 1, loco: 0, air: 0, fly: 0, hero: 0 };
    this.phase = 0;            // 걷기/달리기 주기
    this.lastStepHalf = 0;
    this.onStep = null;        // (side, strength) 발걸음 콜백
    this.flyMix = { hover: 1, glide: 0, cruise: 0, fast: 0, pierce: 0, brake: 0, vert: 0 };

    this.bodyPos = new THREE.Vector3();
    this.bodyRot = new THREE.Euler(0, 0, 0, 'XYZ');
    this.first = true;
  }

  // 스프링에 속도 임펄스 (착지/도약/부스트 반동)
  kick(ch, vel) { this.V[ch] += vel; }
  kickArms(fwd, out) {
    this.V[ARM_R] += -fwd; this.V[ARM_L] += -fwd;
    this.V[ARM_R + 2] += -out; this.V[ARM_L + 2] += out;
  }
  kickLegs(fwd, out) {
    this.V[LEG_R] += -fwd; this.V[LEG_L] += -fwd;
    this.V[LEG_R + 2] += -out; this.V[LEG_L + 2] += out;
  }
  kickBody(py, rx) { this.V[BPOS + 1] += py; this.V[BROT] += rx; }

  /**
   * s = {
   *  t, dt, mode: 'ground'|'air'|'fly'|'hero',
   *  groundSpeed, vy, sprint(bool), slow(bool),
   *  flySpeed, mach, boost, brake 0..1, vert -1..1, attPitch(rad), bank(rad),
   *  accelB: Vector3 (몸 좌표계 가속도), angB: Vector3 (몸 좌표계 각속도),
   *  trick: { type, p } | null, heroT, landT, landHard 0..1,
   *  lookYaw, lookPitch (rad, 몸 기준)
   * }
   */
  update(dt, s) {
    const T = this.T;
    T.fill(0);
    const t = s.t;

    // ── 레이어 가중치 ──
    const moving = smooth(0.25, 1.6, s.groundSpeed);
    const onGround = s.mode === 'ground' || s.mode === 'launch';
    const tw = {
      idle: onGround ? 1 - moving : 0,
      loco: onGround ? moving : 0,
      air: s.mode === 'air' ? 1 : 0,
      fly: s.mode === 'fly' ? 1 : 0,
      hero: s.mode === 'hero' ? 1 : 0,
    };
    const rate = s.mode === 'hero' ? 30 : 11;
    let sum = 0;
    for (const k in this.w) { this.w[k] = damp(this.w[k], tw[k], rate, dt); sum += this.w[k]; }
    for (const k in this.w) this.w[k] /= sum || 1;
    const W = this.w;

    // ── 스프링 파라미터 블렌드 ──
    for (let g = 0; g < 5; g++) {
      const gf = SPRING.ground[g], af = SPRING.air[g], ff = SPRING.fly[g], hf = SPRING.hero[g];
      const gw = W.idle + W.loco;
      let f = gf[0] * gw + af[0] * W.air + ff[0] * W.fly + hf[0] * W.hero;
      let z = gf[1] * gw + af[1] * W.air + ff[1] * W.fly + hf[1] * W.hero;
      // 영웅 착지 후 일어설 때는 묵직하게
      if (s.mode === 'hero' && s.heroT > 0.55) { f = lerp(f, 4.2, smooth(0.55, 0.75, s.heroT)); z = 0.75; }
      this.f[g] = f; this.z[g] = z;
    }

    // ── 걷기/달리기 위상 ──
    const gs = s.groundSpeed;
    const stride = clamp(1.5 + 0.24 * gs, 1.6, 5.4);
    if (s.mode === 'ground') this.phase += TAU * (gs / stride) * dt;
    const ph = this.phase;
    // 반 주기마다 발걸음
    const half = Math.floor(ph / Math.PI);
    if (half !== this.lastStepHalf) {
      this.lastStepHalf = half;
      if (s.mode === 'ground' && gs > 1.2 && this.onStep) this.onStep(half & 1, clamp(gs / 15, 0.15, 1));
    }

    if (W.idle > 0.001) this.poseIdle(T, W.idle, t, s);
    if (W.loco > 0.001) this.poseLoco(T, W.loco, t, s, ph);
    if (W.air > 0.001) this.poseAir(T, W.air, t, s);
    if (W.fly > 0.001) this.poseFly(T, W.fly, t, s, dt);
    if (W.hero > 0.001) this.poseHero(T, W.hero, t, s);

    // 착지 충격 (딱딱한 착지 = 런지 자세가 잠깐 유지)
    if (s.landT >= 0 && s.landT < 0.45 && s.mode === 'ground') {
      const k = s.landHard * (1 - smooth(0.12, 0.45, s.landT));
      leg(T, k, 0, 34, 6); leg(T, k, 1, -22, 8);
      arms(T, k, 26, 38);
      bodyP(T, k, 0, 0, 0.04, 16, 0, 0);
      head(T, k, 8);
    }

    // 이륙 예비 동작: 깊게 웅크렸다가 튀어오름
    if (s.mode === 'launch') {
      const k = smooth(0, 0.07, s.launchT);
      leg(T, k, 0, 46, 7); leg(T, k, 1, -30, 9);
      arm(T, k, 0, -38, 24, 10); arm(T, k, 1, -44, 30, 10);
      bodyP(T, k, 0, 0, 0.02, 24, -8, 0);
      head(T, k, 16);
    }
    // 이륙 직후: 한 주먹을 하늘로 뻗는 슈퍼히어로 상승 자세
    if (s.mode === 'fly' && s.launchPose > 0) {
      const k = s.launchPose;
      lerpTo(T, ARM_R, k, -178 * D, 0, 6 * D * -1);
      lerpTo(T, ARM_L, k, 8 * D, 0, 10 * D);
      lerpTo(T, LEG_R, k, 4 * D, 0, -1 * D);
      lerpTo(T, LEG_L, k, 14 * D, 0, 1 * D);
      T[NECK] = lerp(T[NECK], -18 * D, k);
    }

    // ── 시선 ──
    const lookW = (W.idle + W.loco * 0.5 + W.fly * this.flyMix.hover * 0.8) * (1 - (s.trick ? 1 : 0));
    head(T, lookW, clamp(s.lookPitch, -0.6, 0.5) / D * 0.45, clamp(s.lookYaw, -0.95, 0.95) / D, 0);
    // 시선 방향으로 몸도 살짝
    bodyP(T, lookW * 0.25, 0, 0, 0, 0, clamp(s.lookYaw, -0.95, 0.95) / D * 0.3, 0);

    // ── 관성 (가속/회전에 팔다리가 뒤처짐) ──
    const ab = s.accelB, wb = s.angB;
    const inAir = W.fly + W.air;
    const accK = 0.55 + inAir * 0.5;   // 도 / (m/s²)
    const ax = clamp(ab.x * accK * 0.5, -10, 10), az = clamp(ab.z * accK, -32, 32), ay = clamp(ab.y * accK, -30, 30);
    arms(T, 1, -az, 0); legs(T, 1, -az * 0.6, 0);
    arm(T, 1, 0, 0, ax * 0.8); arm(T, 1, 1, 0, -ax * 0.8);
    leg(T, 1, 0, 0, ax * 0.4); leg(T, 1, 1, 0, -ax * 0.4);
    // 몸 기준 위쪽 가속(급상승) → 팔 처짐, 다리 늘어짐
    arms(T, inAir, -ay * 0.35, -Math.abs(ay) * 0.15);
    // 회전 관성: 앞구르기(ωx) → 팔다리가 뒤로, 몸축 회전(ωy) → 원심력으로 벌어짐
    const wx = clamp(wb.x, -14, 14), wy = clamp(wb.y, -20, 20), wz = clamp(wb.z, -14, 14);
    arms(T, inAir, -wx * 2.2, Math.abs(wy) * 1.3);
    legs(T, inAir, -wx * 1.6, Math.abs(wy) * 0.8);
    arm(T, inAir, 0, 0, wz * 0.8); arm(T, inAir, 1, 0, -wz * 0.8);
    head(T, inAir, wx * 1.2, 0, 0);

    // ── 트릭 오버라이드 ──
    if (s.trick) this.poseTrick(T, s.trick, s);

    // ── 지면 접지 보정: 다리 각도에서 골반 높이 계산 (무릎 없는 R6) ──
    const gW = W.idle + W.loco + W.hero;
    if (gW > 0.001) {
      const brx = T[BROT];
      const lr = -T[LEG_R] - brx, ll = -T[LEG_L] - brx;
      const reach = Math.max(Math.cos(lr), Math.cos(ll)) * RIG.legLen + 0.2 * Math.cos(brx);
      T[BPOS + 1] += gW * (reach - RIG.pivotY);
    }

    // ── 스프링 적분 ──
    this.integrate(dt);

    // ── 고주파 떨림 (스프링 뒤에 적용해 감쇠되지 않게) ──
    const O = this.O;
    O.set(this.Y);
    const sp = s.flySpeed * W.fly;
    const fl = smooth(70, 500, sp) * 0.6 + smooth(330, 1300, sp) * 1.4 + s.boost * W.fly * 0.4;
    if (fl > 0.01) {
      const a = fl * D;
      for (let i = 3; i < 15; i++) O[i] += flutter(t, i * 1.37) * a * (i >= 9 ? 1.6 : 1);
      O[NECK] += flutter(t, 9.1) * a * 0.5;
      O[BPOS] += flutter(t, 3.3) * fl * 0.004;
      O[BPOS + 2] += flutter(t, 5.7) * fl * 0.004;
    }

    this.apply();
  }

  integrate(dt) {
    const { T, Y, V, XP } = this;
    if (this.first) { Y.set(T); XP.set(T); V.fill(0); this.first = false; return; }
    for (let i = 0; i < N; i++) {
      const g = GROUP[i];
      const f = this.f[g], z = this.z[g];
      const w = TAU * f;
      const k1 = z / (Math.PI * f);
      const k2 = 1 / (w * w);
      const k2s = Math.max(k2, dt * dt / 2 + dt * k1 / 2, dt * k1);
      const x = T[i];
      XP[i] = x;
      Y[i] += dt * V[i];
      V[i] += dt * (x - Y[i] - k1 * V[i]) / k2s;
    }
  }

  apply() {
    const O = this.O, av = this.av;
    av.neck.rotation.set(O[NECK], O[NECK + 1], O[NECK + 2]);
    av.shoulderR.rotation.set(O[ARM_R], O[ARM_R + 1], O[ARM_R + 2]);
    av.shoulderL.rotation.set(O[ARM_L], O[ARM_L + 1], O[ARM_L + 2]);
    av.hipR.rotation.set(O[LEG_R], O[LEG_R + 1], O[LEG_R + 2]);
    av.hipL.rotation.set(O[LEG_L], O[LEG_L + 1], O[LEG_L + 2]);
    this.bodyPos.set(O[BPOS], O[BPOS + 1], O[BPOS + 2]);
    this.bodyRot.set(O[BROT], O[BROT + 1], O[BROT + 2]);
  }

  // ───────────────────────── 포즈 ─────────────────────────
  poseIdle(T, w, t, s) {
    const br = Math.sin(t * TAU * 0.27);              // 호흡
    const sway = wobble(t * 0.35, 1.3);
    bodyP(T, w, 0, 0.006 * br, 0, 1.2 + 0.6 * br, 0, 1.4 * sway);
    arm(T, w, 0, 3 + 2 * wobble(t * 0.5, 2), 4 + 1.6 * br, 4);
    arm(T, w, 1, 2 + 2 * wobble(t * 0.5, 5), 4 + 1.6 * br, 4);
    // 체중 이동: 한쪽 다리에 무게
    leg(T, w, 0, 1.5 * sway, 2 - 1.2 * sway);
    leg(T, w, 1, -1.5 * sway, 2 + 1.2 * sway);
    head(T, w, -1 + 2 * wobble(t * 0.3, 7), 10 * wobble(t * 0.18, 3), 2 * sway);
    // 탈진: 상체를 숙여 무릎 쪽에 손을 대고 크게 헐떡임
    const k = w * (s.tired || 0);
    if (k > 0.001) {
      const pant = Math.sin(t * TAU * 1.35);
      bodyP(T, k, 0, 0.018 * pant, 0.03, 24 + 3 * pant, 0, 0);
      arms(T, k, 30 + 2 * pant, 4 + 3 * pant);
      legs(T, k, 0, 3);
      head(T, k, -14 + 4 * pant);
    }
  }

  // 포세이큰 스타일: 걷기 12 스터드/s(4.8 m/s)는 여유 있게, 질주 26 스터드/s(10.4 m/s)는 상체를 숙이고 팔을 크게 흔듦
  poseLoco(T, w, t, s, ph) {
    const gs = s.groundSpeed;
    const run = smooth(5.5, 10, gs);
    const tired = s.tired || 0;
    const sn = Math.sin(ph), cs = Math.cos(ph);
    const legA = lerp(27, 50, run);
    const armA = lerp(20, 60, run) * (1 - 0.4 * tired);
    // 다리: 달릴 땐 앞다리를 높이 들고 뒷다리로 차냄
    const lr = sn * legA + run * 9 * Math.max(0, sn) - run * 5;
    const ll = -sn * legA + run * 9 * Math.max(0, -sn) - run * 5;
    leg(T, w, 0, lr, 2 + run * 1.5);
    leg(T, w, 1, ll, 2 + run * 1.5);
    // 팔: 다리와 반대로, 달릴 땐 앞쪽으로 치우쳐 힘차게 펌핑 + 몸 안쪽으로 살짝 교차
    const ab = run * 12 - tired * 6;
    arm(T, w, 0, -sn * armA + ab, lerp(4, 9, run) + Math.max(0, -sn) * run * 5, -run * 14);
    arm(T, w, 1, sn * armA + ab, lerp(4, 9, run) + Math.max(0, sn) * run * 5, -run * 14);
    // 몸통: 상하 반동(걷기=통과 시 높음, 달리기=체공 시 높음), 비틀림, 좌우 흔들림, 앞 기울기, 회전 시 안쪽 기울기
    const c2 = Math.cos(2 * ph);
    const bob = lerp(0.02 * c2, -0.05 * c2 + 0.02, run) * (1 + 0.5 * tired);
    const lean = lerp(2.5, 15, run) + 10 * tired;
    const turn = clamp(s.turnLean || 0, -6, 6);
    bodyP(T, w, 0, bob, 0, lean, -sn * lerp(2.5, 6, run), sn * lerp(0.8, 1.4, run) + turn);
    // 머리는 안정화 (몸 비틀림/기울기 상쇄), 지치면 고개가 처짐
    head(T, w, -lean * 0.6 + 1.5 * cs * run + 9 * tired, sn * lerp(2.5, 7, run), -sn * 1.5);
  }

  poseAir(T, w, t, s) {
    const vy = s.vy;
    const rise = smooth(0.5, 8, vy), fall = smooth(-0.5, -12, vy);
    const apex = Math.max(0, 1 - rise - fall);
    // 상승: 팔을 크게 위로, 한쪽 다리 접어올림
    if (rise > 0) {
      arm(T, w * rise, 0, 172, 9, -6); arm(T, w * rise, 1, 166, 12, -6);
      leg(T, w * rise, 0, 34, 4); leg(T, w * rise, 1, -14, 5);
      bodyP(T, w * rise, 0, 0, 0, -5, 0, 0);
      head(T, w * rise, -8);
    }
    if (apex > 0) {
      arm(T, w * apex, 0, 150, 26); arm(T, w * apex, 1, 142, 30);
      leg(T, w * apex, 0, 22, 6); leg(T, w * apex, 1, -6, 6);
      bodyP(T, w * apex, 0, 0, 0, 0, 0, 0);
    }
    // 낙하: 팔을 벌려 허우적, 다리 교차 버둥
    if (fall > 0) {
      const fl = smooth(-6, -30, vy);
      const fA = 8 + fl * 10;
      arm(T, w * fall, 0, 95 + fA * Math.sin(t * 7.3), 58 + 8 * Math.sin(t * 5.1), 0);
      arm(T, w * fall, 1, 92 + fA * Math.sin(t * 7.3 + 2.1), 60 + 8 * Math.sin(t * 5.1 + 1), 0);
      leg(T, w * fall, 0, 12 * Math.sin(t * 6.1) + 6, 9);
      leg(T, w * fall, 1, -12 * Math.sin(t * 6.1) - 4, 9);
      bodyP(T, w * fall, 0, 0, 0, 4 + fl * 8, 0, 3 * Math.sin(t * 3));
      head(T, w * fall, 6 + fl * 14);
    }
  }

  poseFly(T, w, t, s, dt) {
    const sp = s.flySpeed;
    // 속도 구간 분할
    let hover = 1 - smooth(1.5, 7, sp);
    let glide = smooth(1.5, 6, sp) * (1 - smooth(14, 24, sp));
    let cruise = smooth(14, 24, sp) * (1 - smooth(55, 105, sp));
    let fast = smooth(55, 105, sp) * (1 - smooth(290, 380, sp));
    let pierce = smooth(290, 380, sp);
    if (s.slow) { glide += cruise + fast; cruise = 0; fast = 0; }
    const brake = clamp(s.brake, 0, 1);
    const k = 1 - brake;
    const M = this.flyMix;
    M.hover = damp(M.hover, hover * k, 8, dt);
    M.glide = damp(M.glide, glide * k, 8, dt);
    M.cruise = damp(M.cruise, cruise * k, 8, dt);
    M.fast = damp(M.fast, fast * k, 8, dt);
    M.pierce = damp(M.pierce, pierce * k, 6, dt);
    M.brake = damp(M.brake, brake, 10, dt);
    M.vert = damp(M.vert, s.vert, 5, dt);
    const tot = M.hover + M.glide + M.cruise + M.fast + M.pierce + M.brake || 1;
    const hv = (w * M.hover) / tot, gl = (w * M.glide) / tot, cr = (w * M.cruise) / tot;
    const fa = (w * M.fast) / tot, pi = (w * M.pierce) / tot, bk = (w * M.brake) / tot;

    // 호버: 공중에 떠서 다리가 흔들리고 팔은 균형을 잡음
    if (hv > 0) {
      const up = Math.max(0, M.vert), dn = Math.max(0, -M.vert);
      arm(T, hv, 0, 10 + 5 * Math.sin(t * 1.1) - 22 * up + 18 * dn, 17 + 5 * Math.sin(t * 1.3) - 6 * up + 26 * dn, 6);
      arm(T, hv, 1, 8 + 5 * Math.sin(t * 1.1 + 0.8) - 22 * up + 18 * dn, 19 + 5 * Math.sin(t * 1.3 + 1.1) - 6 * up + 26 * dn, 6);
      leg(T, hv, 0, 9 + 7 * Math.sin(t * 1.45) - 14 * up + 16 * dn, 4 + 2 * Math.sin(t * 0.9));
      leg(T, hv, 1, -3 + 7 * Math.sin(t * 1.45 + 1.7) - 14 * up + 10 * dn, 5 + 2 * Math.sin(t * 0.9 + 2));
      bodyP(T, hv, 0, 0.05 * Math.sin(t * 1.7), 0, 3 + 1.5 * Math.sin(t * 0.9) - 3 * up, 0, 0.5 * Math.sin(t * 0.7));
      head(T, hv, 3 * Math.sin(t * 0.8) + 6 * dn - 4 * up);
    }
    // 느린 비행(활공): 날개처럼 팔을 펼치고 다리는 가볍게 물장구
    if (gl > 0) {
      const wv = Math.sin(t * 1.8);
      arm(T, gl, 0, -8 + 4 * wv, 74 + 7 * wv, 12);
      arm(T, gl, 1, -8 + 4 * Math.sin(t * 1.8 + 0.4), 74 + 7 * Math.sin(t * 1.8 + 0.4), 12);
      leg(T, gl, 0, -9 + 8 * Math.sin(t * 2.6), 5);
      leg(T, gl, 1, -12 + 8 * Math.sin(t * 2.6 + Math.PI), 5);
      bodyP(T, gl, 0, 0.04 * Math.sin(t * 1.8 + 0.5), 0, 0, 0, 0.6 * Math.sin(t * 0.9));
    }
    // 순항: 팔을 몸 옆 뒤로, 다리 모아 뻗음
    if (cr > 0) {
      arm(T, cr, 0, -24 + 3 * Math.sin(t * 2.1), 21, -8);
      arm(T, cr, 1, -27 + 3 * Math.sin(t * 2.1 + 1), 23, -8);
      leg(T, cr, 0, -5 + 3 * Math.sin(t * 2.4), 2);
      leg(T, cr, 1, -10 + 3 * Math.sin(t * 2.4 + 2), 2);
      bodyP(T, cr, 0, 0.03 * Math.sin(t * 2.0), 0);
    }
    // 고속: 슈퍼맨 자세 (오른 주먹 앞으로, 왼팔은 옆구리)
    if (fa > 0) {
      arm(T, fa, 0, 172, 5, -24);
      arm(T, fa, 1, -16, 11, -6);
      leg(T, fa, 0, -3, 1.5);
      leg(T, fa, 1, -11, 1.5);
    }
    // 초음속: 두 주먹을 모아 공기를 뚫는 자세
    if (pi > 0) {
      arm(T, pi, 0, 177, 5, -30);
      arm(T, pi, 1, 176, 5, -30);
      leg(T, pi, 0, -2, 0.5);
      leg(T, pi, 1, -6, 0.5);
      head(T, pi, 10);
    }
    // 급제동: 몸을 세우며 팔다리를 펼쳐 공기를 받음
    if (bk > 0) {
      arm(T, bk, 0, 48, 66, 10); arm(T, bk, 1, 44, 70, 10);
      leg(T, bk, 0, 36, 9); leg(T, bk, 1, 20, 9);
      head(T, bk, -6);
    }

    // 머리: 몸이 눕는 만큼 고개를 들어 진행 방향을 봄
    const lift = Math.sin(clamp(s.attPitch, 0, Math.PI)) * 74;
    head(T, w, -lift * (1 - 0.3 * M.hover));
    // 선회 시 바깥 팔이 더 벌어짐
    const bank = clamp(s.bank, -1.2, 1.2) / D;
    arm(T, w * (1 - M.hover), 0, 0, -bank * 0.18);
    arm(T, w * (1 - M.hover), 1, 0, bank * 0.18);
    leg(T, w * (1 - M.hover), 0, 0, -bank * 0.06);
    leg(T, w * (1 - M.hover), 1, 0, bank * 0.06);
  }

  poseHero(T, w, t, s) {
    const ht = s.heroT;
    // 0~0.62 s: 3점 착지 자세 유지, 이후 천천히 일어남
    const hold = 1 - smooth(0.62, 1.05, ht);
    const k = w * hold;
    if (k > 0) {
      bodyP(T, k, 0, 0, -0.04, 44, -6, 0);
      leg(T, k, 0, 96, 8);          // 앞으로 내딛은 다리
      leg(T, k, 1, -10, 11);         // 뒤로 꿇은 다리
      arm(T, k, 0, -42, 13, 8);      // 주먹으로 땅 짚기
      arm(T, k, 1, -78, 58, -10);    // 뒤로 젖힌 팔
      // 처음엔 고개 숙였다가 들어올림
      const lookUp = smooth(0.3, 0.5, ht);
      head(T, k, lerp(14, -34, lookUp), lerp(0, 10, lookUp));
    }
    const rise = w * (1 - hold);
    if (rise > 0) this.poseIdle(T, rise, t, s);
  }

  poseTrick(T, tr, s) {
    const p = tr.p;
    const bump = Math.pow(Math.sin(Math.PI * clamp(p, 0, 1)), 0.6);
    if (tr.type === 'roll') {
      // 배럴 롤: 팔다리를 몸에 붙여 회전 (빠른 자세에서는 앞 주먹 유지)
      const keepFwd = this.flyMix.fast + this.flyMix.pierce;
      const k = bump * 0.85;
      T[ARM_R + 2] *= 1 - k; T[ARM_L + 2] *= 1 - k;
      T[LEG_R + 2] *= 1 - k; T[LEG_L + 2] *= 1 - k;
      if (keepFwd < 0.5) { T[ARM_R] = lerp(T[ARM_R], 12 * D, k); T[ARM_L] = lerp(T[ARM_L], 12 * D, k); }
      T[LEG_R] = lerp(T[LEG_R], 4 * D, k); T[LEG_L] = lerp(T[LEG_L], 7 * D, k);
      T[NECK] += 10 * D * k;
    } else if (tr.type === 'flip') {
      // 앞구르기: 다리를 앞으로 접는 파이크 자세 + 팔로 감싸기
      const k = bump * 0.95;
      T[LEG_R] = lerp(T[LEG_R], -100 * D, k); T[LEG_L] = lerp(T[LEG_L], -94 * D, k);
      T[LEG_R + 2] = lerp(T[LEG_R + 2], -5 * D, k); T[LEG_L + 2] = lerp(T[LEG_L + 2], 5 * D, k);
      T[ARM_R] = lerp(T[ARM_R], -72 * D, k); T[ARM_L] = lerp(T[ARM_L], -72 * D, k);
      T[ARM_R + 2] = lerp(T[ARM_R + 2], -14 * D, k); T[ARM_L + 2] = lerp(T[ARM_L + 2], 14 * D, k);
      T[NECK] = lerp(T[NECK], 38 * D, k);
    } else if (tr.type === 'cart') {
      // 옆돌기: 팔다리를 X자로 활짝
      const k = bump * 0.9;
      T[ARM_R] = lerp(T[ARM_R], 0, k); T[ARM_L] = lerp(T[ARM_L], 0, k);
      T[ARM_R + 2] = lerp(T[ARM_R + 2], -150 * D, k); T[ARM_L + 2] = lerp(T[ARM_L + 2], 150 * D, k);
      T[LEG_R] = lerp(T[LEG_R], 0, k); T[LEG_L] = lerp(T[LEG_L], 0, k);
      T[LEG_R + 2] = lerp(T[LEG_R + 2], -32 * D, k); T[LEG_L + 2] = lerp(T[LEG_L + 2], 32 * D, k);
    }
  }
}

export const CH = { NECK, ARM_R, ARM_L, LEG_R, LEG_L, BPOS, BROT };
