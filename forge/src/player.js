// 1인칭 플레이어: 키네마틱 캐릭터 컨트롤러(캡슐) + 카메라
import * as THREE from 'three';
import { GROUP, groups } from './physics.js';
import { clamp, damp, toV } from './core/util.js';

export class Player {
  constructor({ ph, camera, sfx }) {
    this.ph = ph; this.cam = camera; this.sfx = sfx;
    const R = ph.R;
    this.body = ph.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1.2, 10));
    this.col = ph.world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(groups(GROUP.PLAYER, GROUP.PART | GROUP.WORLD)).setMass(80), this.body);
    const kc = (this.kcc = ph.world.createCharacterController(0.02));
    kc.enableAutostep(0.32, 0.2, true); kc.enableSnapToGround(0.3); kc.setMaxSlopeClimbAngle(0.85); kc.setMinSlopeSlideAngle(0.9);
    kc.setApplyImpulsesToDynamicBodies(true); kc.setCharacterMass(80); kc.setUp({ x: 0, y: 1, z: 0 });
    this.yaw = Math.PI; this.pitch = -0.12; this.vy = 0; this.grounded = false; this.crouch = 0;
    this.pos = new THREE.Vector3(0, 1.2, 10); this.prev = this.pos.clone(); this.vel = new THREE.Vector3();
    this.stepAcc = 0; this.bob = 0; this.sens = 0.0022; this.eye = 0.78; this.wish = new THREE.Vector3();
  }
  setEnabled(on) { this.col.setEnabled(on); }
  teleport(p) { this.body.setNextKinematicTranslation(p); this.body.setTranslation(p, true); this.pos.copy(p); this.prev.copy(p); this.vy = 0; }
  look(input, dt) {
    const kx = input.axis('ArrowLeft', 'ArrowRight'), ky = input.axis('ArrowDown', 'ArrowUp');
    this.yaw -= input.mx * this.sens + kx * 2.2 * dt; this.pitch = clamp(this.pitch - input.my * this.sens + ky * 1.6 * dt, -1.5, 1.5);
  }
  // 입력 → 원하는 이동 (매 프레임)
  input(input) {
    let f = input.axis('KeyS', 'KeyW'), r = input.axis('KeyA', 'KeyD');
    if (input.touch.active) { f = -input.touch.my; r = input.touch.mx; }
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    this.crouching = input.down('ControlLeft') || input.down('KeyC');
    const sp = this.crouching ? 1.4 : run ? 5.6 : 3.0;
    const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), rt = new THREE.Vector3(-fw.z, 0, fw.x);
    this.wish.copy(fw).multiplyScalar(f).addScaledVector(rt, r); if (this.wish.lengthSq() > 1) this.wish.normalize(); this.wish.multiplyScalar(sp);
    if (input.pressed('Space') && this.grounded) { this.vy = 4.6; this.grounded = false; }
  }
  // 물리 단계
  step(dt) {
    this.prev.copy(this.pos);
    const k = this.grounded ? 14 : 2.5;
    this.vel.x = damp(this.vel.x, this.wish.x, k, dt); this.vel.z = damp(this.vel.z, this.wish.z, k, dt);
    this.vy -= 9.81 * dt; if (this.vy < -50) this.vy = -50;
    const d = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    this.kcc.computeColliderMovement(this.col, d, undefined, groups(GROUP.PLAYER, GROUP.PART | GROUP.WORLD));
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = -0.5;
    if (!this.grounded && m.y > d.y + 1e-4 && this.vy > 0) this.vy = 0; // 머리 충돌
    const t = this.body.translation();
    const np = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.body.setNextKinematicTranslation(np); this.pos.set(np.x, np.y, np.z);
    const moved = Math.hypot(m.x, m.z);
    if (this.grounded) { this.stepAcc += moved; this.bob += moved * 2.2; if (this.stepAcc > 0.75) { this.stepAcc = 0; this.sfx.play('step', { pos: this.pos, soft: Math.abs(this.pos.x) > 17 || this.pos.z > 26 }); } }
    if (this.pos.y < -50) this.teleport(new THREE.Vector3(0, 2, 10));
  }
  updateCamera(alpha, dt, shake = 0) {
    this.crouch = damp(this.crouch, this.crouching ? 0.55 : 0, 10, dt);
    const p = this.prev.clone().lerp(this.pos, alpha);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const bob = this.grounded ? Math.sin(this.bob * 2) * 0.025 * Math.min(1, sp / 3) : 0;
    this.cam.position.set(p.x, p.y + this.eye - this.crouch + bob, p.z);
    this.cam.rotation.set(this.pitch + (Math.random() - 0.5) * shake * 0.02, this.yaw + (Math.random() - 0.5) * shake * 0.02, Math.sin(this.bob) * 0.004 * Math.min(1, sp / 3), 'YXZ');
  }
  forward(out = new THREE.Vector3()) { return this.cam.getWorldDirection(out); }
}
