// FREE FREELY - 6자유도 강체 물리 (자체 제작 물리 엔진)
// 반암시적 오일러 적분 + 관성텐서 기반 각운동, 임펄스 충돌 응답 포함.
import * as THREE from 'three';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix3();

export const GRAVITY = 9.80665;
export const MAX_SPEED = 2600;        // m/s (극단적 수치 폭주 방지)
export const MAX_SPIN = 16;           // rad/s

export class RigidBody {
  constructor(opts = {}) {
    this.mass = opts.mass || 1000;
    this.invMass = 1 / this.mass;
    // 대각 관성텐서 (본체 좌표계)
    this.inertia = opts.inertia ? opts.inertia.clone() : new THREE.Vector3(5000, 8000, 4000);
    this.invInertia = new THREE.Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();   // 월드 좌표계 rad/s

    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();

    this.linearDamping = opts.linearDamping ?? 0.0;
    this.angularDamping = opts.angularDamping ?? 0.12;
    this.gravityScale = opts.gravityScale ?? 1;
    this.centerOfMass = new THREE.Vector3();      // 기하 원점 기준 질량중심 (본체 좌표)
    this.frozen = false;
    this.lastAccel = new THREE.Vector3();
    this.gForce = 1;
  }

  setMass(m) {
    this.mass = Math.max(1e-3, m);
    this.invMass = 1 / this.mass;
  }

  setInertia(v) {
    this.inertia.copy(v);
    this.invInertia.set(1 / Math.max(1e-6, v.x), 1 / Math.max(1e-6, v.y), 1 / Math.max(1e-6, v.z));
  }

  /** 점질량 목록으로부터 질량중심과 관성텐서를 계산 */
  setFromPointMasses(points) {
    let total = 0;
    const com = new THREE.Vector3();
    for (const p of points) {
      total += p.mass;
      com.addScaledVector(p.pos, p.mass);
    }
    if (total <= 0) return;
    com.multiplyScalar(1 / total);
    this.centerOfMass.copy(com);
    this.setMass(total);
    const I = new THREE.Vector3();
    for (const p of points) {
      const dx = p.pos.x - com.x, dy = p.pos.y - com.y, dz = p.pos.z - com.z;
      const r = p.radius || 0.5;
      const self = 0.4 * p.mass * r * r;          // 구 근사 자체 관성
      I.x += p.mass * (dy * dy + dz * dz) + self;
      I.y += p.mass * (dx * dx + dz * dz) + self;
      I.z += p.mass * (dx * dx + dy * dy) + self;
    }
    // 지나치게 작은 관성은 수치 불안정을 만들므로 하한 적용
    const floor = this.mass * 0.6;
    I.x = Math.max(I.x, floor); I.y = Math.max(I.y, floor); I.z = Math.max(I.z, floor);
    this.setInertia(I);
  }

  localToWorldDir(v, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(this.quaternion);
  }
  worldToLocalDir(v, out = new THREE.Vector3()) {
    return out.copy(v).applyQuaternion(_q1.copy(this.quaternion).invert());
  }
  /** 본체 좌표(기하 원점 기준) → 월드 좌표 */
  localToWorld(v, out = new THREE.Vector3()) {
    out.copy(v).sub(this.centerOfMass).applyQuaternion(this.quaternion).add(this.position);
    return out;
  }
  /** 질량중심 기준 오프셋 벡터 (월드) */
  localOffsetWorld(v, out = new THREE.Vector3()) {
    return out.copy(v).sub(this.centerOfMass).applyQuaternion(this.quaternion);
  }

  get forward() { return this.localToWorldDir(new THREE.Vector3(0, 0, -1)); }
  get up() { return this.localToWorldDir(new THREE.Vector3(0, 1, 0)); }
  get right() { return this.localToWorldDir(new THREE.Vector3(1, 0, 0)); }

  /** 월드 좌표 한 점의 속도 (회전 성분 포함) */
  pointVelocity(worldPoint, out = new THREE.Vector3()) {
    _v1.copy(worldPoint).sub(this.position);
    out.copy(this.angularVelocity).cross(_v1).add(this.velocity);
    return out;
  }

  addForce(f) { this.force.add(f); }

  addForceAtPoint(f, worldPoint) {
    this.force.add(f);
    _v1.copy(worldPoint).sub(this.position);
    _v2.copy(_v1).cross(f);
    this.torque.add(_v2);
  }

  /** 본체 좌표계 힘 + 본체 좌표 작용점 */
  addLocalForceAtLocalPoint(localForce, localPoint) {
    this.localToWorldDir(localForce, _v3);
    this.localOffsetWorld(localPoint, _v1);
    this.force.add(_v3);
    this.torque.add(_v2.copy(_v1).cross(_v3));
  }

  addTorque(t) { this.torque.add(t); }

  addLocalTorque(t) {
    this.localToWorldDir(t, _v3);
    this.torque.add(_v3);
  }

  /** 충돌 임펄스 적용 (과도한 임펄스는 제한해 시뮬레이션 폭주를 막는다) */
  applyImpulseAtPoint(impulse, worldPoint) {
    const maxImpulse = this.mass * 45;
    if (impulse.lengthSq() > maxImpulse * maxImpulse) impulse.setLength(maxImpulse);
    this.velocity.addScaledVector(impulse, this.invMass);
    _v1.copy(worldPoint).sub(this.position);
    _v2.copy(_v1).cross(impulse);
    // 월드 토크 임펄스 → 본체 좌표 → 각속도 변화
    this.worldToLocalDir(_v2, _v3);
    _v3.set(_v3.x * this.invInertia.x, _v3.y * this.invInertia.y, _v3.z * this.invInertia.z);
    this.localToWorldDir(_v3, _v1);
    this.angularVelocity.add(_v1);
  }

  clearAccumulators() {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }

  integrate(dt) {
    if (this.frozen) { this.clearAccumulators(); return; }
    // --- 선형 ---
    _v1.copy(this.force).multiplyScalar(this.invMass);
    _v1.y -= GRAVITY * this.gravityScale;
    this.lastAccel.copy(_v1);
    this.velocity.addScaledVector(_v1, dt);
    if (this.linearDamping > 0) this.velocity.multiplyScalar(Math.pow(1 - this.linearDamping, dt));
    this.position.addScaledVector(this.velocity, dt);

    // --- 각운동 (본체 좌표계에서 오일러 방정식) ---
    this.worldToLocalDir(this.torque, _v2);
    this.worldToLocalDir(this.angularVelocity, _v3);
    // ω × (Iω) 자이로스코프 항
    const Iw = _v1.set(_v3.x * this.inertia.x, _v3.y * this.inertia.y, _v3.z * this.inertia.z);
    const gyro = _v1.copy(_v3).cross(Iw);
    _v2.sub(gyro);
    _v2.set(_v2.x * this.invInertia.x, _v2.y * this.invInertia.y, _v2.z * this.invInertia.z);
    _v3.addScaledVector(_v2, dt);
    if (this.angularDamping > 0) _v3.multiplyScalar(Math.pow(1 - Math.min(0.99, this.angularDamping), dt));
    this.localToWorldDir(_v3, this.angularVelocity);

    // 쿼터니언 적분
    const w = this.angularVelocity;
    _q1.set(w.x, w.y, w.z, 0).multiply(this.quaternion);
    this.quaternion.x += _q1.x * 0.5 * dt;
    this.quaternion.y += _q1.y * 0.5 * dt;
    this.quaternion.z += _q1.z * 0.5 * dt;
    this.quaternion.w += _q1.w * 0.5 * dt;
    this.quaternion.normalize();

    // 안전 클램프: 수치 불안정으로 발산하지 않도록 상한을 둔다
    if (this.velocity.lengthSq() > MAX_SPEED * MAX_SPEED) this.velocity.setLength(MAX_SPEED);
    if (this.angularVelocity.lengthSq() > MAX_SPIN * MAX_SPIN) this.angularVelocity.setLength(MAX_SPIN);
    if (!isFinite(this.position.x + this.position.y + this.position.z)) {
      this.position.set(0, 800, 0); this.velocity.set(0, 0, 0);
    }
    if (!isFinite(this.velocity.x + this.velocity.y + this.velocity.z)) this.velocity.set(0, 0, 0);
    if (!isFinite(this.angularVelocity.x + this.angularVelocity.y + this.angularVelocity.z)) this.angularVelocity.set(0, 0, 0);
    if (!isFinite(this.quaternion.x + this.quaternion.y + this.quaternion.z + this.quaternion.w)) {
      this.quaternion.set(0, 0, 0, 1);
    }

    // G 계산 (조종사가 느끼는 수직 가속도)
    const upAccel = this.lastAccel.clone();
    upAccel.y += GRAVITY * this.gravityScale;
    const bodyUp = this.up;
    this.gForce = upAccel.dot(bodyUp) / GRAVITY;

    this.clearAccumulators();
  }

  /** 오일러각 (heading, pitch, roll) — 계기용 */
  getAttitude() {
    const fwd = this.forward;
    const up = this.up;
    const right = this.right;
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    let heading = Math.atan2(fwd.x, -fwd.z);
    if (heading < 0) heading += Math.PI * 2;
    // 롤: 수평면 기준 오른쪽 벡터의 기울기
    const horizRight = _v1.set(-Math.cos(heading), 0, -Math.sin(heading));
    void horizRight;
    const worldUp = _v2.set(0, 1, 0);
    const refRight = _v3.copy(fwd).cross(worldUp).normalize();
    let roll = Math.atan2(refRight.dot(up), right.dot(refRight) !== 0 ? right.dot(_v1.copy(refRight).cross(fwd).normalize()) : 1);
    // 더 안정적인 롤 계산
    const projUp = _v1.copy(worldUp).sub(_v2.copy(fwd).multiplyScalar(worldUp.dot(fwd))).normalize();
    roll = Math.atan2(right.dot(projUp), up.dot(projUp));
    return { pitch, heading, roll: -roll };
  }
}

/** 대각 행렬 도우미 (외부 사용) */
export function diagInertiaMatrix(v) {
  return _m1.set(v.x, 0, 0, 0, v.y, 0, 0, 0, v.z).clone();
}
