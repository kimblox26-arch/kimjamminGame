// FREE FREELY - 카메라 리그 (1인칭 / 3인칭 / 궤도 / 시네마틱 / 관제탑)
import * as THREE from 'three';
import { clamp, lerp, damp, rand, smoothstep, TAU } from './utils.js';
import { Settings } from './settings.js';

export const CAMERA_MODES = [
  { id: 'cockpit', name: '1인칭 (조종석)' },
  { id: 'chase', name: '3인칭 (추적)' },
  { id: 'orbit', name: '궤도 (자유 회전)' },
  { id: 'cinematic', name: '시네마틱' },
  { id: 'tower', name: '관제탑' },
];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.modeIndex = 1;
    this.pos = new THREE.Vector3(0, 40, 60);
    this.target = new THREE.Vector3();
    this.orbit = { yaw: 0.6, pitch: 0.28, dist: 28 };
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.shake = 0;
    this.fov = Settings.get('fov');
    this.baseFov = this.fov;
    this.cineTimer = 0;
    this.cinePos = new THREE.Vector3();
    this.cineLookAhead = 0;
    this.headOffset = new THREE.Vector3();
    this.lookBack = false;
    this.velSmooth = new THREE.Vector3();
    this.rollSmooth = 0;
  }

  setMode(id) {
    const i = CAMERA_MODES.findIndex((m) => m.id === id);
    if (i >= 0) { this.modeIndex = i; this.mode = id; }
    this.cineTimer = 0;
  }

  cycle() {
    this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length;
    this.mode = CAMERA_MODES[this.modeIndex].id;
    this.cineTimer = 0;
    return CAMERA_MODES[this.modeIndex].name;
  }

  get isInterior() { return this.mode === 'cockpit'; }

  update(dt, craft, tele, input, world, fxShake = 0) {
    const cam = this.camera;
    const body = craft.body;
    const speed = body.velocity.length();
    this.velSmooth.lerp(body.velocity, 1 - Math.pow(0.02, dt));

    // 시점 둘러보기 (마우스 우클릭 드래그 / 방향 입력)
    if (input) {
      const look = input.mouse.right || this.mode === 'orbit';
      if (look && !input.mouse.locked) {
        this.lookYaw -= input.mouse.dx * 0.0022;
        this.lookPitch = clamp(this.lookPitch - input.mouse.dy * 0.0022, -1.2, 1.2);
      }
      if (this.mode === 'orbit') {
        this.orbit.yaw = this.lookYaw;
        this.orbit.pitch = clamp(this.lookPitch + 0.2, -1.35, 1.35);
        this.orbit.dist = clamp(this.orbit.dist * (1 + input.mouse.wheel * 0.12), craft.radius * 1.4, 900);
      }
      this.lookBack = input.isDown('lookBack');
    }

    const desiredFov = Settings.get('fov') + clamp(speed / 22, 0, 26) * (this.mode === 'cockpit' ? 0.4 : 1)
      + (tele && tele.afterburner ? 5 : 0);
    this.fov = damp(this.fov, desiredFov, 0.02, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    switch (this.mode) {
      case 'cockpit': this._cockpit(dt, craft, tele); break;
      case 'chase': this._chase(dt, craft, tele); break;
      case 'orbit': this._orbit(dt, craft); break;
      case 'cinematic': this._cinematic(dt, craft); break;
      case 'tower': this._tower(dt, craft, world); break;
      default: this._chase(dt, craft, tele);
    }

    // 지형 관통 방지
    if (world && this.mode !== 'cockpit') {
      const s = world.surfaceAt(cam.position.x, cam.position.z);
      const minY = s.height + 2.2;
      if (cam.position.y < minY) cam.position.y = lerp(cam.position.y, minY, 0.6);
    }

    // 흔들림 (충격 + 난류 + 실속 버핏)
    const turb = world ? clamp(world.env.gust.length() / 14, 0, 1) : 0;
    const buffet = tele ? clamp(tele.stall, 0, 1) * 0.7 : 0;
    const reentry = tele ? clamp(tele.reentry, 0, 1) * 0.5 : 0;
    this.shake = damp(this.shake, fxShake * 0.8 + turb * 0.25 + buffet * 0.5 + reentry, 0.0001, dt);
    if (this.shake > 0.001) {
      const s = this.shake * (this.mode === 'cockpit' ? 0.55 : 0.35);
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
      cam.position.z += rand(-s, s);
      _q1.setFromEuler(new THREE.Euler(rand(-s, s) * 0.02, rand(-s, s) * 0.02, rand(-s, s) * 0.03));
      cam.quaternion.multiply(_q1);
    }
  }

  _cockpit(dt, craft, tele) {
    const cam = this.camera;
    const body = craft.body;
    const eye = craft.cockpit ? craft.cockpit.pos : new THREE.Vector3(0, 1, 0);
    body.localToWorld(eye, _v1);
    cam.position.copy(_v1);
    // G에 따른 머리 흔들림
    const gShift = clamp((tele ? tele.g : 1) - 1, -3, 4);
    this.headOffset.lerp(_v2.set(
      clamp(-body.worldToLocalDir(body.velocity, new THREE.Vector3()).x * 0.002, -0.06, 0.06),
      clamp(-gShift * 0.014, -0.08, 0.05),
      0
    ), 1 - Math.pow(0.01, dt));
    cam.quaternion.copy(body.quaternion);
    const yaw = this.lookBack ? Math.PI : this.lookYaw * 0.9;
    _q1.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch * 0.8);
    cam.quaternion.multiply(_q1).multiply(_q2);
    cam.translateX(this.headOffset.x);
    cam.translateY(this.headOffset.y);
  }

  _chase(dt, craft, tele) {
    const cam = this.camera;
    const body = craft.body;
    const r = Math.max(6, craft.radius);
    const back = r * 2.4 + clamp(body.velocity.length() * 0.05, 0, r * 1.5);
    const up = r * 0.85;
    // 기체 뒤쪽 (롤은 부분만 반영해 멀미 방지)
    const att = body.getAttitude();
    this.rollSmooth = damp(this.rollSmooth, att.roll, 0.02, dt);
    const fwd = body.forward;
    const desired = _v1.copy(body.position)
      .addScaledVector(fwd, this.lookBack ? back : -back)
      .addScaledVector(UP, up);
    // 속도 방향으로 약간 당김 (스피드감)
    desired.addScaledVector(this.velSmooth, -0.12);
    const follow = 1 - Math.pow(0.0009, dt);
    this.pos.lerp(desired, follow);
    cam.position.copy(this.pos);

    const lookAt = _v2.copy(body.position).addScaledVector(fwd, this.lookBack ? -r * 2 : r * 2.2)
      .addScaledVector(UP, r * 0.25);
    _m.lookAt(cam.position, lookAt, _v1.set(0, 1, 0).applyAxisAngle(fwd, this.rollSmooth * 0.35));
    cam.quaternion.setFromRotationMatrix(_m);
    // 둘러보기
    if (Math.abs(this.lookYaw) > 0.001 || Math.abs(this.lookPitch) > 0.001) {
      _q1.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.lookYaw * 0.7);
      _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.lookPitch * 0.5);
      cam.quaternion.multiply(_q1).multiply(_q2);
    }
    void tele;
  }

  _orbit(dt, craft) {
    const cam = this.camera;
    const o = this.orbit;
    const center = craft.body.position;
    const d = o.dist;
    cam.position.set(
      center.x + Math.cos(o.yaw) * Math.cos(o.pitch) * d,
      center.y + Math.sin(o.pitch) * d,
      center.z + Math.sin(o.yaw) * Math.cos(o.pitch) * d
    );
    cam.lookAt(center);
    void dt;
  }

  _cinematic(dt, craft) {
    const cam = this.camera;
    const body = craft.body;
    this.cineTimer -= dt;
    if (this.cineTimer <= 0) {
      this.cineTimer = rand(4.5, 8);
      const r = Math.max(14, craft.radius * 3);
      const ang = rand(0, TAU);
      const side = rand(r * 2, r * 7);
      this.cinePos.copy(body.position)
        .addScaledVector(body.forward, rand(r * 3, r * 9))
        .add(new THREE.Vector3(Math.cos(ang) * side, rand(-r, r * 2.5), Math.sin(ang) * side));
      this.cineLookAhead = rand(0.2, 1.2);
    }
    // 고정 카메라 앞으로 기체가 지나가도록
    cam.position.lerp(this.cinePos, 1 - Math.pow(0.35, dt));
    const look = _v1.copy(body.position).addScaledVector(body.velocity, this.cineLookAhead * 0.35);
    cam.lookAt(look);
  }

  _tower(dt, craft, world) {
    const cam = this.camera;
    const t = _v1.set(-520, 0, 210);
    if (world) t.y = world.heightAt(t.x, t.z) + 56;
    else t.y = 80;
    cam.position.lerp(t, 1 - Math.pow(0.001, dt));
    const d = craft.body.position.distanceTo(cam.position);
    cam.lookAt(craft.body.position);
    // 먼 거리에서는 줌인
    const fov = clamp(60 - smoothstep(clamp(d / 4000, 0, 1)) * 48, 8, 60);
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  /** 메인 메뉴용 시네마틱 궤도 */
  menuOrbit(dt, time, world, center = new THREE.Vector3(0, 260, 0)) {
    const cam = this.camera;
    const r = 900 + Math.sin(time * 0.07) * 240;
    const y = center.y + Math.sin(time * 0.05) * 140;
    cam.position.set(
      center.x + Math.cos(time * 0.045) * r,
      y,
      center.z + Math.sin(time * 0.045) * r
    );
    const look = _v1.copy(center).add(_v2.set(Math.sin(time * 0.1) * 200, -120, Math.cos(time * 0.08) * 200));
    if (world) {
      const s = world.surfaceAt(cam.position.x, cam.position.z);
      if (cam.position.y < s.height + 40) cam.position.y = s.height + 40;
    }
    cam.lookAt(look);
    if (Math.abs(cam.fov - 58) > 0.1) { cam.fov = 58; cam.updateProjectionMatrix(); }
    void dt;
  }
}
