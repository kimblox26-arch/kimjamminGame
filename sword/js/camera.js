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
    this.arm = 6.2;          // 실제 카메라 거리 (가려지면 줄어듦)
    this.first2 = true;
    this.lag = new THREE.Vector3();
    this.lastTarget = new THREE.Vector3();
    this.trauma = 0;
    this.fovKick = 0;
    this.fovKickV = 0;
    this.baseFov = 70;
    this.time = 0;
    this.first = true;
    this.sens = 0.0022;
    this.groundAt = null;
    this.firstPerson = false;   // (x, z) → 렌더 좌표 지면 높이 (main 에서 연결)
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
    if (this.first) { this.lastTarget.copy(target); this.first = false; this.first2 = true; }
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
    // 1인칭: 머리 위치에서 시선 방향 그대로 (머리는 숨김 → 내 몸·팔·검이 보임)
    const av = player.avatar;
    if (av.neck.visible === this.firstPerson) av.neck.visible = !this.firstPerson;
    if (this.firstPerson) {
      av.head.getWorldPosition(_p);
      _p.y += 0.06;
      _p.addScaledVector(_f, 0.12);
      this.cam.position.copy(_p);
      _d.copy(_p).add(_f);
      this.cam.lookAt(_d);
      this.arm = this.dist; this.lag.set(0, 0, 0);
    } else {
    // 건물·언덕이 카메라와 캐릭터 사이를 막으면 카메라를 캐릭터 쪽으로 당김 (로블록스 팝퍼 카메라).
    // 높이를 억지로 올리면 시선이 갑자기 꺾이므로, 막힐 때는 거리만 줄이고 시선 방향은 그대로 둠
    let arm = this.dist;
    if (this.groundAt) {
      const g0 = this.groundAt(target.x, target.z);
      const N = 8;
      for (let i = 1; i <= N; i++) {
        const s = (this.dist * i) / N;
        const px = target.x - _f.x * s, py = target.y - _f.y * s, pz = target.z - _f.z * s;
        const gh = this.groundAt(px, pz);
        if (py < gh + 0.4 && gh > g0 + 1.0) { arm = Math.max(0.8, (this.dist * (i - 1)) / N); break; }
      }
    }
    if (this.first2 || arm < this.arm) this.arm = arm;   // 막히면 즉시, 풀리면 부드럽게
    else this.arm += (arm - this.arm) * (1 - Math.exp(-4 * dt));
    this.first2 = false;
    _p.copy(target).addScaledVector(_f, -this.arm);
    // 평평한 땅을 올려다볼 때만 지면 위로 (지형은 매끄러워 시선이 튀지 않음)
    const gmin = (this.groundAt ? this.groundAt(_p.x, _p.z) : 0) + 0.4;
    if (_p.y < gmin) _p.y = gmin;
    this.cam.position.copy(_p);
    this.cam.lookAt(target);
    }
    // 화면은 항상 수평 유지: 이동/선회(조이스틱·WASD)로 카메라가 기울거나 돌지 않음.
    // 시점은 시점 드래그·마우스·오른쪽 스틱으로만 바뀜

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
    const fov = this.baseFov + (this.firstPerson ? 8 : 0) + 5 * player.sprintAmt + 15 * smooth(15, 340, speed) + 9 * smooth(340, 1400, speed) + clamp(this.fovKick, -10, 22);
    if (Math.abs(fov - this.cam.fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
