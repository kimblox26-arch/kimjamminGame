// FREE FREELY 우주 탐사 - 함선 비행 물리
// 병진: Float64 위치/속도를 직접 적분 (계층 프레임 기준, 부동 원점과 무관하게 정밀)
// 회전: src/physics/rigidbody.js 의 6자유도 강체(관성 텐서·자이로 항)를 재사용
// 대기: 행성별 밀도·음속, 항력·양력·재진입 가열(Sutton-Graves ∝ √ρ v³), 소닉붐
import * as THREE from 'three';
import { RigidBody } from '../physics/rigidbody.js';
import { atmosphereAt } from './atmos.js';
import { TIERS, throttleToSpeed, SIGMA, G0 } from './consts.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _air = new THREE.Vector3();
const _atm = {};

export const SHIP = {
  mass: 28000,
  inertia: new THREE.Vector3(1.17e6, 1.73e6, 6.3e5),
  maxRate: new THREE.Vector3(1.3, 0.85, 2.4),      // 피치·요·롤 rad/s (FA)
  rcsTorque: new THREE.Vector3(3.2e6, 2.6e6, 2.2e6),
  wingArea: 62,
  cdA: { x: 38, y: 95, z: 7.5 },
  atmoAccel: 75,          // 해면 대기에서 최대 추력 가속 (≈ 7.6 g)
  heatCap: 2.6e5,         // 표면 열용량 (J/m²K) — 가열 시간 상수
  tempLimit: 2300,
  emissivity: 0.82,
};

export class ShipFlight {
  constructor() {
    this.body = new RigidBody({ mass: SHIP.mass, inertia: SHIP.inertia, angularDamping: 0, gravityScale: 0 });
    this.frame = null;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.tier = 1;
    this.tierFrom = 1;
    this.tierT = 1;               // 단계 전환 진행 (0..1)
    this.maxSpeed = TIERS[0].max; // 현재(전환 중 보간) 단계 최고 속도
    this.throttle = 0;
    this.fa = true;
    this.gear = 0;                // 0 접힘 .. 1 펼침
    this.gearDown = false;
    this.lights = false;
    this.integrity = 100;
    this.hullTemp = 280;
    this.destroyed = false;
    this.warp = false;
    this.warpSpeed = 0;
    this.speedLimit = Infinity;   // 근접 자동 감속 상한 (게임이 설정)
    this.input = { pitch: 0, roll: 0, yaw: 0, lift: 0, strafe: 0, brake: false };
    this.events = [];
    this.t = {
      speed: 0, surfSpeed: 0, alt: 0, agl: 0, vs: 0, g: 1, mach: 0, density: 0, pressure: 0, temp: 3, sound: 300,
      onGround: false, inWater: false, heatFlux: 0, reentry: 0, dyn: 0, gravity: 0, nearest: null, accel: 0,
    };
    this._wasSuper = false;
    this._prevVel = new THREE.Vector3();
    this.contactPoint = new THREE.Vector3();
    this.lastImpact = 0;
  }

  setTier(n) {
    n = Math.max(1, Math.min(5, n));
    if (n === this.tier) return false;
    this.tierFrom = this.tier;
    this.tier = n;
    this.tierT = 0;
    return true;
  }

  get forward() { return _v3.set(0, 0, -1).applyQuaternion(this.body.quaternion); }

  event(text, kind = 'info') { this.events.push({ text, kind }); }

  /**
   * 고정 스텝 갱신
   * @param env { near: {body, view, rel(프레임 기준 천체 위치), relVel}, sources: [{mu, pos}], sunFlux, inAtmo }
   */
  step(dt, env) {
    if (this.destroyed) return;
    const b = this.body;
    const tl = this.t;
    // 단계 전환 (로그 공간 보간 — 가속/감속 연출)
    if (this.tierT < 1) {
      this.tierT = Math.min(1, this.tierT + dt / 2.4);
      const k = this.tierT * this.tierT * (3 - 2 * this.tierT);
      this.maxSpeed = Math.exp(Math.log(TIERS[this.tierFrom - 1].max) * (1 - k) + Math.log(TIERS[this.tier - 1].max) * k);
    } else this.maxSpeed = TIERS[this.tier - 1].max;
    const warpNow = this.tier >= 4 && this.tierT > 0.35;
    if (warpNow !== this.warp) { this.warp = warpNow; this.event(warpNow ? '워프 진입' : '워프 해제', warpNow ? 'warp' : 'info'); }

    // 착륙장치
    this.gear += ((this.gearDown ? 1 : 0) - this.gear) * Math.min(1, dt * 1.6);

    // 기준 천체 · 대기
    const near = env.near;
    let alt = Infinity, upW = _v2.set(0, 1, 0), surfVel = new THREE.Vector3();
    let rel = null;
    if (near) {
      rel = _v.copy(this.pos).sub(near.pos);           // 천체 중심 → 함선 (관성 축)
      const r = rel.length();
      upW.copy(rel).divideScalar(r || 1);
      near.body.surfaceVelocity(rel, surfVel);
      alt = r - near.body.radius;
    }
    atmosphereAt(near ? near.body : null, alt, _atm);
    if (near && alt < 0 && (near.body.kind === 'star' || near.body.kind === 'blackhole')) {
      this.integrity = 0;
      this.destroy(near.body.kind === 'star' ? `${near.body.name} 광구에 돌입 — 기화` : '사건의 지평선 통과 — 스파게티화');
      return;
    }
    const rho = _atm.density;
    // 대기 바람 = 행성 자전에 따라 회전하는 공기 (+ 함선 기준 상대 속도)
    _air.copy(this.vel).sub(near ? near.vel : _v3.set(0, 0, 0)).sub(surfVel);
    const airSpeed = _air.length();

    // ---------------- 회전 (RCS · FA) ----------------
    const inp = this.input;
    _qi.copy(b.quaternion).invert();
    const wL = _f.copy(b.angularVelocity).applyQuaternion(_qi);
    const tq = new THREE.Vector3();
    const R = SHIP.maxRate, T = SHIP.rcsTorque, I = SHIP.inertia;
    if (this.fa || this.warp) {
      const tx = inp.pitch * R.x, ty = -inp.yaw * R.y, tz = -inp.roll * R.z;
      const k = 4.5;
      tq.set(
        clampAbs((tx - wL.x) * I.x * k, T.x),
        clampAbs((ty - wL.y) * I.y * k, T.y),
        clampAbs((tz - wL.z) * I.z * k, T.z),
      );
    } else {
      tq.set(inp.pitch * T.x, -inp.yaw * T.y, -inp.roll * T.z);
    }
    // 공력 안정 토크 (풍향계 효과) + 감쇠
    if (rho > 1e-5 && airSpeed > 5 && !this.warp) {
      const q = 0.5 * rho * airSpeed * airSpeed;
      const flowL = _v3.copy(_air).applyQuaternion(_qi).divideScalar(airSpeed);
      const alpha = Math.atan2(-flowL.y, -flowL.z);   // 받음각 (+: 기수가 진행 방향보다 위)
      const beta = Math.atan2(flowL.x, -flowL.z);     // 옆미끄럼 (+: 오른쪽으로 미끄러짐)
      const s = Math.min(1, q / 2e5);
      tq.x += -alpha * q * 60 * (1 - s * 0.5);
      tq.y -= beta * q * 55 * (1 - s * 0.5);
      tq.x -= wL.x * q * 18; tq.y -= wL.y * q * 18; tq.z -= wL.z * q * 8;
    }
    b.torque.copy(tq).applyQuaternion(b.quaternion);
    b.force.set(0, 0, 0);
    b.velocity.set(0, 0, 0);
    b.position.set(0, 0, 0);
    b.integrate(dt);

    // ---------------- 워프 (4·5단계): 단순화 운동 ----------------
    const fwd = _v3.set(0, 0, -1).applyQuaternion(b.quaternion).clone();
    if (this.warp) {
      const want = Math.min(throttleToSpeed(this.tier, this.throttle) * (this.maxSpeed / TIERS[this.tier - 1].max), this.speedLimit);
      // 속도는 급변하지 않도록 지수 근사 (로그 공간)
      const cur = Math.max(1, this.warpSpeed);
      const tgt = Math.max(1, want);
      this.warpSpeed = Math.exp(Math.log(cur) + (Math.log(tgt) - Math.log(cur)) * Math.min(1, dt * 1.8));
      if (want < 2) this.warpSpeed = Math.max(0, this.warpSpeed * (1 - dt * 3));
      this.vel.copy(fwd).multiplyScalar(this.warpSpeed).add(near ? near.vel : _v.set(0, 0, 0));
      this.pos.addScaledVector(fwd, this.warpSpeed * dt);
      this._telemetry(near, rel, alt, surfVel, airSpeed, rho, 0, dt, env);
      this.hullTemp += (Math.max(env.radTemp || 3, 3) - this.hullTemp) * Math.min(1, dt * 0.05);
      return;
    }
    this.warpSpeed = this.vel.length();

    // ---------------- 병진 힘 ----------------
    const acc = new THREE.Vector3();
    // 중력
    for (const s of env.sources) {
      _v.copy(s.pos).sub(this.pos);
      const d2 = Math.max(1, _v.lengthSq());
      acc.addScaledVector(_v, s.mu / (d2 * Math.sqrt(d2)));
    }
    const grav = acc.clone();
    // 추력 한계 (대기 밀도에 따라 감소)
    const atmoK = Math.min(1, Math.pow(rho / 0.02, 0.5));
    const aVac = Math.max(SHIP.atmoAccel, this.maxSpeed / 9);
    const aMax = aVac * (1 - atmoK) + SHIP.atmoAccel * atmoK;
    const up = _f.set(0, 1, 0).applyQuaternion(b.quaternion).clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(b.quaternion);
    const thrust = new THREE.Vector3();
    let thrustFrac = 0;
    if (this.fa) {
      // 관성 보조: 기준 속도(지표 회전 + 천체 운동) 대비 목표 속도로 수렴, 중력 상쇄
      const refBlend = near ? smooth01(1 - (alt - 2000) / (near.body.radius * 0.6)) : 0;
      const vRef = new THREE.Vector3();
      if (near) vRef.copy(near.vel).addScaledVector(surfVel, refBlend);
      const target = throttleToSpeed(Math.min(3, this.tier), this.throttle) * (this.tier <= 3 ? this.maxSpeed / TIERS[this.tier - 1].max : 1);
      const vt = vRef.addScaledVector(fwd, Math.min(target, this.speedLimit));
      vt.addScaledVector(up, inp.lift * Math.min(60, aMax));
      vt.addScaledVector(right, inp.strafe * Math.min(60, aMax));
      const tau = this.tier >= 3 ? 1.2 : 0.55;
      thrust.copy(vt).sub(this.vel).divideScalar(tau).sub(grav);
      // 대기에서는 공기력 일부를 상쇄하지 않아 비행기처럼 느껴지게
      if (thrust.length() > aMax) thrust.setLength(aMax);
      thrustFrac = Math.min(1, thrust.length() / aMax);
      if (inp.brake) thrust.copy(this.vel).sub(near ? near.vel : _v.set(0, 0, 0)).multiplyScalar(-1 / 0.8).clampLength(0, aMax);
    } else {
      thrust.copy(fwd).multiplyScalar(this.throttle * aMax);
      thrust.addScaledVector(up, inp.lift * aMax * 0.25);
      thrust.addScaledVector(right, inp.strafe * aMax * 0.25);
      thrustFrac = this.throttle;
    }
    acc.add(thrust);
    this.thrustFrac = thrustFrac;
    this.thrustAccel = thrust.length();

    // 공력: 항력 + 양력
    let heatFlux = 0;
    if (rho > 1e-7 && airSpeed > 0.5) {
      const flowL = _v.copy(_air).applyQuaternion(_qi).divideScalar(airSpeed);
      const cdA = SHIP.cdA.x * Math.abs(flowL.x) + SHIP.cdA.y * Math.abs(flowL.y) + SHIP.cdA.z * Math.abs(flowL.z) + this.gear * 6;
      const q = 0.5 * rho * airSpeed * airSpeed;
      const mach = airSpeed / _atm.sound;
      const wave = mach > 0.85 ? 1 + 1.4 * Math.exp(-Math.pow((mach - 1.05) / 0.25, 2)) + 0.25 : 1;
      acc.addScaledVector(_air, (-q * cdA * wave * 0.45) / (airSpeed * SHIP.mass));
      // 양력 (받음각, 실속)
      const alpha = Math.atan2(-flowL.y, -flowL.z);
      let cl = 2 * Math.PI * 0.55 * alpha;
      if (Math.abs(alpha) > 0.3) cl = Math.sign(alpha) * Math.max(0, 1.0 - (Math.abs(alpha) - 0.3) * 1.8);
      if (mach > 1) cl /= Math.sqrt(mach * mach - 1) + 0.6;
      const liftDir = _v2.copy(_air).cross(right).normalize().negate();
      if (liftDir.dot(up) < 0) liftDir.negate();
      acc.addScaledVector(liftDir, (q * SHIP.wingArea * cl * 0.6) / SHIP.mass);
      // 재진입 가열 (Sutton-Graves)
      heatFlux = 1.74e-4 * Math.sqrt(rho) * airSpeed * airSpeed * airSpeed;
      // 소닉붐
      const sup = mach > 1;
      if (sup !== this._wasSuper && rho > 0.02) { this.event(sup ? '음속 돌파 — 소닉붐' : '아음속 복귀', sup ? 'boom' : 'info'); }
      this._wasSuper = sup;
      tl.mach = mach;
      tl.dyn = q;
    } else { tl.mach = 0; tl.dyn = 0; this._wasSuper = false; }

    // 적분 (반암시적 오일러)
    this.vel.addScaledVector(acc, dt);
    const stepLen = this.vel.length() * dt;
    // 고속 터널링 방지: 경로를 나눠 지면 교차 검사
    if (near && near.view && near.view.terrain && stepLen > 30 && alt < near.body.radius * 0.2) {
      const n = Math.min(40, Math.ceil(stepLen / 30));
      for (let i = 1; i <= n; i++) {
        _v.copy(this.pos).addScaledVector(this.vel, (dt * i) / n);
        const g = this._groundAlt(near, _v);
        if (g < 0) {
          this.pos.copy(_v);
          this._impact(this.vel.clone().sub(near.vel).sub(surfVel).length(), near, 'ground');
          break;
        }
      }
    }
    if (this.destroyed) return;
    this.pos.addScaledVector(this.vel, dt);

    // 지면 · 수면 접촉
    let onGround = false, inWater = false;
    if (near && near.view && near.view.terrain && alt < 25000) {
      const res = this._contacts(dt, near, surfVel);
      onGround = res.onGround; inWater = res.inWater;
    }
    // 열 수지: 공력 가열 + 항성 복사 − 복사 냉각
    const tEnv = Math.max(_atm.temperature || 3, env.radTemp || 3);
    const qIn = heatFlux * 0.6 + (env.sunFlux || 0) * 0.35;
    const qOut = SHIP.emissivity * SIGMA * (Math.pow(this.hullTemp, 4) - Math.pow(Math.min(tEnv, this.hullTemp), 4));
    const conv = rho > 0.01 ? (tEnv - this.hullTemp) * Math.min(60, rho * 40) : 0;
    this.hullTemp += ((qIn - qOut + conv) / SHIP.heatCap) * dt * 6;
    this.hullTemp = Math.max(3, this.hullTemp);
    if (this.hullTemp > SHIP.tempLimit) {
      this.integrity -= (this.hullTemp - SHIP.tempLimit) * 0.012 * dt;
      if (Math.random() < dt) this.event('선체 과열 — 손상 발생', 'danger');
    }
    // 압력 (기체 행성 깊은 곳)
    if (_atm.pressure > 2e7) {
      this.integrity -= (_atm.pressure / 2e7) * 6 * dt;
      if (Math.random() < dt * 0.6) this.event('외부 압력 한계 초과 — 선체 붕괴 위험', 'danger');
    }
    if (this.integrity <= 0 && !this.destroyed) {
      this.integrity = 0;
      this.destroy(this.hullTemp > SHIP.tempLimit ? '과열로 기체 파괴' : _atm.pressure > 2e7 ? '대기 압력으로 기체 파괴' : '기체 파괴');
    }
    tl.onGround = onGround;
    tl.inWater = inWater;
    tl.heatFlux = heatFlux;
    this._telemetry(near, rel, alt, surfVel, airSpeed, rho, heatFlux, dt, env);
    tl.gravity = grav.length();
  }

  _telemetry(near, rel, alt, surfVel, airSpeed, rho, heatFlux, dt, env) {
    const tl = this.t;
    tl.density = rho;
    tl.pressure = _atm.pressure || 0;
    tl.temp = _atm.temperature || 3;
    tl.sound = _atm.sound || 300;
    tl.alt = alt;
    tl.speed = near ? _v.copy(this.vel).sub(near.vel).length() : this.vel.length();
    tl.surfSpeed = airSpeed;
    const accel = _v.copy(this.vel).sub(this._prevVel).divideScalar(Math.max(1e-4, dt));
    this._prevVel.copy(this.vel);
    tl.accel = accel.length();
    if (near && rel) {
      const up = _v2.copy(rel).normalize();
      tl.vs = _v.copy(this.vel).sub(near.vel).sub(surfVel).dot(up);
      tl.agl = near.view && near.view.terrain ? this._groundAlt(near, this.pos) : alt;
      const gAcc = accel.clone().addScaledVector(up, (near.body.mu || 0) / Math.max(1, rel.lengthSq()));
      tl.g = this.warp ? 1 : gAcc.length() / G0;
    } else { tl.vs = 0; tl.agl = Infinity; tl.g = 0; }
    tl.reentry = Math.min(1, Math.max(0, (this.hullTemp - 900) / 1200) + heatFlux / 2.5e6);
    if (env) tl.gravity = env.gravityHere || tl.gravity;
  }

  /** 지면(또는 해수면)까지 고도 */
  _groundAlt(near, p) {
    const rel = _v3.copy(p).sub(near.pos);
    const r = rel.length();
    const dirL = rel.divideScalar(r).applyQuaternion(_q.copy(near.body.rotation).invert());
    let h = near.view.heightAt(dirL, 1.5);
    if (near.view.terrain && near.view.terrain.terrain.hasOcean) h = Math.max(h, 0);
    return r - near.body.radius - h;
  }

  /** 착륙장치·동체 접촉점 처리 (스프링-감쇠 + 마찰, 충격 손상) */
  _contacts(dt, near, surfVelCenter) {
    const b = this.body;
    const pts = [];
    if (this.gear > 0.6) for (const p of this.model.gearPoints) pts.push({ p, gear: true });
    for (const p of this.model.hullPoints) pts.push({ p, gear: false });
    let onGround = false, inWater = false;
    const qInv = _q.copy(near.body.rotation).invert();
    const terrain = near.view.terrain;
    const hasOcean = terrain && terrain.terrain.hasOcean;
    const fluid = hasOcean ? terrain.terrain.seaFluid : null;
    const totalF = new THREE.Vector3();
    const totalT = new THREE.Vector3();
    let maxImpact = 0;
    for (const c of pts) {
      const off = _v.copy(c.p).applyQuaternion(b.quaternion);
      const wp = _v2.copy(this.pos).add(off);
      const rel = wp.clone().sub(near.pos);
      const r = rel.length();
      const up = rel.clone().divideScalar(r);
      const dirL = up.clone().applyQuaternion(qInv);
      const hT = near.view.heightAt(dirL, 1.0);
      const ground = near.body.radius + hT;
      // 지면 속도 (자전)
      const gv = near.body.surfaceVelocity(rel, new THREE.Vector3()).add(near.vel);
      const pv = b.angularVelocity.clone().cross(off).add(this.vel);
      const vrel = pv.sub(gv);
      // 수면
      if (hasOcean && hT < 0 && r < near.body.radius + 0.5) {
        const depth = near.body.radius - r;
        inWater = true;
        if (fluid === 'lava') { this.integrity -= 40 * dt; if (Math.random() < dt * 2) this.event('용암에 접촉 — 선체 용융', 'danger'); }
        const vn = vrel.dot(up);
        if (vn < -35 && this.lastImpact <= 0) maxImpact = Math.max(maxImpact, -vn * 0.6);
        const buoy = up.clone().multiplyScalar(Math.min(4, depth + 0.5) * 9.8 * SHIP.mass * 0.11);
        const drag = vrel.clone().multiplyScalar(-SHIP.mass * 0.09 * Math.min(1, depth + 0.3));
        totalF.add(buoy).add(drag);
        totalT.add(off.clone().cross(buoy.add(drag)));
        continue;
      }
      const pen = ground - r;
      if (pen <= 0) continue;
      onGround = true;
      // 지면 노멀 (유한 차분)
      const n = this._groundNormal(near, dirL, up, hT);
      const vn = vrel.dot(n);
      if (!c.gear && vn < -4) maxImpact = Math.max(maxImpact, -vn);
      if (c.gear && vn < -9) maxImpact = Math.max(maxImpact, -vn * 0.5);
      const k = c.gear ? SHIP.mass * 160 : SHIP.mass * 400;
      const damp = c.gear ? SHIP.mass * 18 : SHIP.mass * 30;
      let fn = Math.max(0, pen * k - vn * damp);
      fn = Math.min(fn, SHIP.mass * 400);
      const F = n.clone().multiplyScalar(fn);
      // 마찰 (착륙장치는 구름 방향 저마찰)
      const vt = vrel.clone().addScaledVector(n, -vn);
      const mu = c.gear ? (this.input.brake ? 0.8 : 0.35) : 0.6;
      const vtl = vt.length();
      if (vtl > 0.01) F.addScaledVector(vt, (-Math.min(mu * fn, SHIP.mass * vtl / dt * 0.3)) / vtl);
      totalF.add(F);
      totalT.add(off.clone().cross(F));
      // 깊이 박힘 방지
      if (pen > 1.5) this.pos.addScaledVector(n, pen - 1.5);
      this.contactPoint.copy(wp);
    }
    if (totalF.lengthSq() > 0) {
      this.vel.addScaledVector(totalF, dt / SHIP.mass);
      // 각속도 변화 (본체 좌표 관성)
      const tl = totalT.applyQuaternion(_q.copy(b.quaternion).invert());
      tl.set(tl.x / SHIP.inertia.x, tl.y / SHIP.inertia.y, tl.z / SHIP.inertia.z).applyQuaternion(b.quaternion);
      b.angularVelocity.addScaledVector(tl, dt);
      if (onGround) b.angularVelocity.multiplyScalar(Math.pow(0.2, dt));
    }
    this.lastImpact -= dt;
    if (maxImpact > 0 && this.lastImpact <= 0) this._impact(maxImpact, near, inWater ? 'water' : 'ground');
    return { onGround, inWater };
  }

  _groundNormal(near, dirL, upW, h0) {
    const R = near.body.radius;
    const e = 2.5 / R;
    const t1 = new THREE.Vector3(0, 1, 0).cross(dirL);
    if (t1.lengthSq() < 1e-8) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = dirL.clone().cross(t1);
    const h1 = near.view.heightAt(dirL.clone().addScaledVector(t1, e).normalize(), 1.0);
    const h2 = near.view.heightAt(dirL.clone().addScaledVector(t2, e).normalize(), 1.0);
    const nL = dirL.clone().multiplyScalar(2.5).addScaledVector(t1, -(h1 - h0)).addScaledVector(t2, -(h2 - h0)).normalize();
    return nL.applyQuaternion(near.body.rotation);
  }

  _impact(speed, near, kind) {
    this.lastImpact = 0.4;
    if (speed < 6) return;
    const dmg = speed < 18 ? (speed - 6) * 1.2 : Math.pow(speed, 1.6) * 0.5;
    this.integrity -= dmg;
    this.events.push({ text: `충돌 ${speed.toFixed(0)} m/s — 손상 ${Math.min(100, dmg).toFixed(0)}%`, kind: 'impact', speed, water: kind === 'water' });
    if (this.integrity <= 0 || speed > 90) {
      this.integrity = 0;
      this.destroy(kind === 'water' ? `수면 충돌 (${speed.toFixed(0)} m/s)` : `지면 충돌 (${speed.toFixed(0)} m/s)`);
    }
  }

  destroy(reason) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.push({ text: reason, kind: 'destroyed' });
  }

  reset(frame, pos, vel, quat) {
    this.frame = frame;
    this.pos.copy(pos);
    this.vel.copy(vel);
    this.body.quaternion.copy(quat);
    this.body.angularVelocity.set(0, 0, 0);
    this.integrity = 100;
    this.hullTemp = 280;
    this.destroyed = false;
    this.tier = 1; this.tierFrom = 1; this.tierT = 1;
    this.maxSpeed = TIERS[0].max;
    this.warp = false; this.warpSpeed = 0;
    this.throttle = 0;
    this._prevVel.copy(vel);
    this.events.length = 0;
  }
}

function clampAbs(v, m) { return v > m ? m : v < -m ? -m : v; }
function smooth01(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
