// 3인칭 추적 카메라: 마우스/터치 궤도, 속도에 따른 거리·FOV, 지연 추적, 트라우마 기반 흔들림
import * as THREE from 'three';
import { onRebase } from './frame.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
const _t = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0;            // 0 = +Z 방향을 봄
    this.pitch = -0.16;      // + = 위를 봄
    this.zoom = 6.2;         // 휠로 조절 (로블록스 기본 거리 비슷하게)
    this.dist = 6.2;
    this.roll = 0;
    this.lag = new THREE.Vector3();
    this.lastTarget = new THREE.Vector3();
    this.trauma = 0;
    this.fovKick = 0;
    this.fovKickV = 0;
    this.baseFov = 70;
    this.time = 0;
    this.first = true;
    this.sens = 0.0022;
    this.groundAt = null;   // (x, z) → 렌더 좌표 지면 높이 (main 에서 연결)
    onRebase((dx, dy, dz) => { this.lastTarget.x -= dx; this.lastTarget.y -= dy; this.lastTarget.z -= dz; });
  }

  addTrauma(a) { this.trauma = clamp(this.trauma + a, 0, 1); }
  kickFov(deg) { this.fovKickV += deg * 14; }

  // 렌더 프레임마다 (실시간 dt)
  update(dt, player, input) {
    this.time += dt;
    const I = input.state;
    // 시점 회전
    this.yaw -= I.lookDX * this.sens;
    this.pitch = clamp(this.pitch - I.lookDY * this.sens, -1.45, 1.35);
    I.lookDX = 0; I.lookDY = 0;
    if (I.zoom) { this.zoom = clamp(this.zoom * Math.pow(1.0012, I.zoom), 3.5, 30); I.zoom = 0; }

    const speed = player.speed;
    const target = _t.copy(player.renderPos);
    target.y += 0.75;

    // 지연 추적: 목표가 움직인 만큼 오차가 생기고, 지수적으로 따라잡음 (고속에서도 화면 밖으로 안 나가게 제한)
    if (this.first) { this.lastTarget.copy(target); this.first = false; }
    _d.subVectors(target, this.lastTarget);
    const tp = Math.max(50, speed * dt * 3);
    if (_d.lengthSq() > tp * tp) _d.set(0, 0, 0);   // 순간이동 방지 (최고속에서도 오작동 없게)
    this.lag.sub(_d);
    this.lag.multiplyScalar(Math.exp(-7.5 * dt));
    const maxLag = 0.6 + 1.1 * smooth(5, 120, speed);
    if (this.lag.length() > maxLag) this.lag.setLength(maxLag);
    this.lastTarget.copy(target);
    target.add(this.lag);

    // 거리: 속도가 빠를수록 뒤로
    const want = this.zoom + 2.6 * smooth(25, 300, speed) + 0.9 * smooth(300, 1400, speed) - (player.mode === 'hero' ? 1.2 : 0);
    this.dist += (want - this.dist) * (1 - Math.exp(-3 * dt));

    const cp = Math.cos(this.pitch);
    _f.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    _p.copy(target).addScaledVector(_f, -this.dist);
    // 지면/옥상 아래로 내려가지 않게
    const gmin = (this.groundAt ? this.groundAt(_p.x, _p.z) : 0) + 0.4;
    if (_p.y < gmin) _p.y = gmin;
    this.cam.position.copy(_p);
    this.cam.lookAt(target);
    // 비행 선회 시 카메라도 살짝 같이 기울어짐 (영화 같은 추적)
    const rollT = player.flying ? -player.bank.y * 0.16 : 0;
    this.roll += (rollT - this.roll) * (1 - Math.exp(-4 * dt));
    if (Math.abs(this.roll) > 1e-4) this.cam.rotateZ(this.roll);

    // 흔들림: 충격 트라우마 + 고속 진동
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    const speedShake = 0.18 * smooth(250, 1400, speed) + 0.1 * player.boostAmt * smooth(40, 300, speed);
    const sh = Math.min(1, this.trauma * this.trauma + speedShake * speedShake);
    if (sh > 1e-4) {
      const t = this.time;
      const n1 = Math.sin(t * 61.0) * 0.5 + Math.sin(t * 89.3 + 1.3) * 0.3 + Math.sin(t * 137.1 + 2.1) * 0.2;
      const n2 = Math.sin(t * 57.3 + 4.0) * 0.5 + Math.sin(t * 97.7 + 0.7) * 0.3 + Math.sin(t * 131.9 + 5.1) * 0.2;
      const n3 = Math.sin(t * 43.1 + 2.2) * 0.6 + Math.sin(t * 77.9 + 3.3) * 0.4;
      this.cam.rotateX(n1 * 0.035 * sh);
      this.cam.rotateY(n2 * 0.035 * sh);
      this.cam.rotateZ(n3 * 0.05 * sh);
      this.cam.translateX(n2 * 0.18 * sh);
      this.cam.translateY(n1 * 0.18 * sh);
    }

    // FOV: 속도감 + 순간 킥 (스프링)
    const k = 90, c = 2 * Math.sqrt(k) * 0.65;
    this.fovKickV += (-k * this.fovKick - c * this.fovKickV) * dt;
    this.fovKick += this.fovKickV * dt;
    const fov = this.baseFov + 5 * player.sprintAmt + 15 * smooth(15, 340, speed) + 9 * smooth(340, 1400, speed) + clamp(this.fovKick, -10, 22);
    if (Math.abs(fov - this.cam.fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
