// 1인칭 플레이어: 이동·회전·점프·웅크리기 (입력은 키보드/제스처/몸 추적을 합친 값)
import * as THREE from 'three';

const WALK = 2.1, RUN = 4.4, TURN = 1.9, PITCH = 1.2, JUMP_V = 4.3, G = 9.8;
const EYE = 1.55, EYE_CROUCH = 1.0, RADIUS = 0.28;

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.rig = new THREE.Object3D();
    this.rig.add(camera);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.obstacles = [];
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 0.15);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.16;
    this.eye = EYE;
    this.onGround = true;
    this.bob = 0;
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.45, 1.45);
  }

  // inp: { forward, strafe, turn(+ = 오른쪽), pitch(+ = 위), run, jump, crouch }
  update(dt, inp) {
    this.yaw -= inp.turn * TURN * dt;
    this.pitch = THREE.MathUtils.clamp(this.pitch + inp.pitch * PITCH * dt, -1.45, 1.45);

    const speed = inp.run ? RUN : WALK;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // 앞 = -Z (yaw 회전), 오른쪽 = +X
    const tx = (inp.strafe * cos - inp.forward * sin) * speed;
    const tz = (-inp.strafe * sin - inp.forward * cos) * speed;
    const acc = 1 - Math.exp(-dt * (this.onGround ? 10 : 2.5));
    this.vel.x += (tx - this.vel.x) * acc;
    this.vel.z += (tz - this.vel.z) * acc;

    if (inp.jump && this.onGround) { this.vel.y = JUMP_V; this.onGround = false; }
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

    // 장애물(탁자 등)과 수평 충돌
    for (const b of this.obstacles) {
      if (this.pos.y > b.max.y - 0.05) continue;
      const cx = THREE.MathUtils.clamp(this.pos.x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(this.pos.z, b.min.z, b.max.z);
      const dx = this.pos.x - cx, dz = this.pos.z - cz, d = Math.hypot(dx, dz);
      if (d < RADIUS && d > 1e-6) { this.pos.x = cx + dx / d * RADIUS; this.pos.z = cz + dz / d * RADIUS; }
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -1900, 1900);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -1900, 1900);

    this.eye += ((inp.crouch ? EYE_CROUCH : EYE) - this.eye) * (1 - Math.exp(-dt * 9));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround) this.bob += dt * hs * 3.6;
    const bobY = this.onGround ? Math.sin(this.bob) * 0.018 * Math.min(1, hs / WALK) : 0;

    this.rig.position.copy(this.pos);
    this.rig.rotation.set(0, this.yaw, 0);
    this.camera.position.set(0, this.eye + bobY, 0);
    this.camera.rotation.set(this.pitch, 0, 0);
    this.rig.updateMatrixWorld(true);
  }
}
