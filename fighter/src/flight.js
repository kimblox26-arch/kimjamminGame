// SKYBREAKER — 전투기 비행 모델 (아케이드 + 실제 공력 요소)
// 받음각 기반 양력, 유도/조파 항력, 추력 고도 감쇠, FBW 식 각속도 명령 + G 제한.
import * as THREE from 'three';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _vd = new THREE.Vector3(), _ld = new THREE.Vector3(), _sd = new THREE.Vector3();
const _acc = new THREE.Vector3(), _qi = new THREE.Quaternion(), _vb = new THREE.Vector3();
const _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class FlightModel {
  constructor(stats) {
    this.s = stats;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.rate = new THREE.Vector3();   // x: 롤(p), y: 피치(q), z: 요(r) — 조종 관례
    this.throttle = 0.75;
    this.ab = false;
    this.airbrake = false;
    this.gLoad = 1;
    this.aoa = 0;
    this.beta = 0;
    this.mach = 0;
    this.speed = 0;
    this.stall = 0;
    this.accelFwd = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
  }

  reset(pos, headingDeg, speed) {
    this.pos.copy(pos);
    this.quat.setFromEuler(new THREE.Euler(0, -headingDeg * Math.PI / 180, 0, 'YXZ'));
    this._axes();
    this.vel.copy(this.forward).multiplyScalar(speed);
    this.rate.set(0, 0, 0);
    this.gLoad = 1;
    this.throttle = 0.8;
    this.ab = false;
  }

  _axes() {
    this.forward.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  get heading() { return (Math.atan2(this.forward.x, -this.forward.z) * 180 / Math.PI + 360) % 360; }
  get pitchAngle() { return Math.asin(clamp(this.forward.y, -1, 1)); }
  get bank() {
    // 수평 기준 뱅크각 (오른쪽 +)
    const fwd = this.forward;
    const flatRight = _ax.set(-fwd.z, 0, fwd.x);
    if (flatRight.lengthSq() < 1e-6) return 0;
    flatRight.normalize();
    const s = this.up.dot(flatRight);
    const c = this.up.y / Math.max(1e-4, Math.sqrt(1 - fwd.y * fwd.y));
    return Math.atan2(s, c);
  }

  /** ctl: { pitch, roll, yaw (−1..1), throttle 0..1, ab bool, airbrake bool } */
  step(dt, ctl) {
    const s = this.s;
    this._axes();
    const f = this.forward, u = this.up, r = this.right;
    this.throttle = clamp(ctl.throttle, 0, 1);
    this.ab = !!ctl.ab;
    this.airbrake = !!ctl.airbrake;

    const v = this.vel.length();
    this.speed = v;
    const alt = Math.max(0, this.pos.y);
    const rho = Math.exp(-alt / 9000);
    const sos = Math.max(295, 340 - alt * 0.0040);
    this.mach = v / sos;

    // 기체 좌표계 속도 → 받음각 / 옆미끄럼각
    _qi.copy(this.quat).invert();
    _vb.copy(this.vel).applyQuaternion(_qi);
    const aoa = v > 1 ? Math.atan2(-_vb.y, -_vb.z) : 0;
    const beta = v > 1 ? Math.atan2(_vb.x, -_vb.z) : 0;
    this.aoa = aoa; this.beta = beta;

    // 양력 계수 (실속 후 감소)
    const am = s.aoaMax;
    const absA = Math.abs(aoa);
    let CL;
    if (absA <= am) CL = s.cla * aoa;
    else CL = Math.sign(aoa) * s.cla * am * Math.max(0.3, 1 - (absA - am) * 2.4);
    this.stall = clamp((absA - am * 0.92) / (am * 0.35), 0, 1) * clamp(1.4 - v / 120, 0, 1);
    const qd = rho * v * v;
    let lift = CL * qd * s.liftK;
    const gCap = s.maxG * G;
    lift = clamp(lift, -gCap * 0.45, gCap);

    _vd.copy(this.vel).multiplyScalar(v > 1e-3 ? 1 / v : 0);
    _ld.copy(u).addScaledVector(_vd, -u.dot(_vd));
    if (_ld.lengthSq() > 1e-6) _ld.normalize();
    _sd.copy(r).addScaledVector(_vd, -r.dot(_vd));
    if (_sd.lengthSq() > 1e-6) _sd.normalize();

    const M = this.mach;
    const cdWave = 0.012 * s.wave * smooth(0.85, 1.05, M) * (1 - 0.45 * smooth(1.2, 2.2, M));
    const cd = s.cd0 + cdWave + (this.airbrake ? 0.06 : 0);
    const drag = cd * qd * s.dragK + Math.abs(lift * CL) * 0.11;
    const lapse = Math.pow(rho, 0.72);
    const thrust = (this.throttle * s.accMil + (this.ab ? s.accAB - s.accMil * 0.9 : 0)) * lapse;
    const side = -beta * qd * 0.00045;

    _acc.set(0, -G, 0)
      .addScaledVector(f, thrust)
      .addScaledVector(_vd, -drag)
      .addScaledVector(_ld, lift)
      .addScaledVector(_sd, side);

    // G 부하 (조종사 체감, 기체 위 방향 성분)
    const gNow = (_acc.dot(u) + G * u.y) / G;
    this.gLoad += (gNow - this.gLoad) * (1 - Math.exp(-dt * 12));
    this.accelFwd = _acc.dot(_vd);

    this.vel.addScaledVector(_acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    // ── 회전: 각속도 명령 + 동압 권한 + G/받음각 제한
    const auth = clamp(qd / (140 * 140), 0.1, 1);
    const pitchG = (s.maxG * G) / Math.max(v, 40) * 1.12;
    let pc = ctl.pitch;
    if (pc > 0 && aoa > am * 0.9) pc *= Math.max(0, 1 - (aoa - am * 0.9) * 9);
    if (pc < 0 && aoa < -am * 0.6) pc *= Math.max(0, 1 + (aoa + am * 0.6) * 9);
    const tq = pc * Math.min(s.pitchRate, pitchG) * Math.sqrt(auth);
    const tp = ctl.roll * s.rollRate * auth;
    const tr = ctl.yaw * s.yawRate * Math.sqrt(auth);
    // 풍향 안정 (저속일수록 기수가 속도 벡터를 따라감)
    const wv = 0.5 + (1 - auth) * 2.2;
    const kq = 1 - Math.exp(-dt * 7), kp = 1 - Math.exp(-dt * 10), kr = 1 - Math.exp(-dt * 4);
    const trimA = clamp(G * Math.max(0, u.y) / Math.max(qd * s.liftK * s.cla, 1e-3), 0, am * 0.85);
    this.rate.y += (tq - (aoa - trimA) * wv - this.rate.y) * kq;
    this.rate.x += (tp - this.rate.x) * kp;
    this.rate.z += (tr + beta * wv * 1.4 - this.rate.z) * kr;
    // 실속 버핏
    if (this.stall > 0) {
      this.rate.x += (Math.random() - 0.5) * this.stall * 6 * dt;
      this.rate.y += (Math.random() - 0.5) * this.stall * 4 * dt;
    }

    _ax.set(this.rate.y, -this.rate.z, -this.rate.x);
    const ang = _ax.length() * dt;
    if (ang > 1e-7) {
      _ax.normalize();
      _dq.setFromAxisAngle(_ax, ang);
      this.quat.multiply(_dq).normalize();
    }
    this._axes();
  }
}
