// SKYBREAKER — 카메라 (3인칭 추적 · 1인칭 조종석 · 원거리 · 시네마틱 플라이바이 · 격추 궤도)
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _m = new THREE.Matrix4();

export const CAM_MODES = ['chase', 'cockpit', 'far', 'cinematic'];
export const CAM_NAMES = { chase: '3인칭 추적', cockpit: '1인칭 조종석', far: '원거리 추적', cinematic: '시네마틱' };

export class FighterCamera {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'chase';
    this.q = new THREE.Quaternion();
    this.shake = 0;
    this.fovKick = 0;
    this.baseFov = 72;
    this.intro = 1;
    this.cine = null;
    this.deathPos = null;
    this.deathT = 0;
    this._t = 0;
    this._look = new THREE.Vector2();
  }

  get interior() { return this.mode === 'cockpit' && !this.deathPos; }

  cycle() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    this.cine = null;
    return CAM_NAMES[this.mode];
  }

  startIntro(fm) { this.intro = 0; this.q.copy(fm.quat); }
  snap(fm) { this.q.copy(fm.quat); }

  /** 화면 흔들림 노이즈 */
  _noise(t, s) { return Math.sin(t * 37.1 + s) * 0.5 + Math.sin(t * 61.7 + s * 2.3) * 0.3 + Math.sin(t * 13.3 + s * 4.1) * 0.2; }

  update(dt, P, input, world, extraShake = 0) {
    const cam = this.cam;
    this._t += dt;
    const fm = P.fm, jet = P.jet;
    const scale = jet.L / 17.5;
    // 드래그 둘러보기 (놓으면 복귀)
    if (input && !input.look.active) { const k = Math.exp(-dt * 3); input.look.x *= k; input.look.y *= k; }
    const lx = input ? input.look.x : 0, ly = input ? input.look.y : 0;
    let fovTarget = this.baseFov + clamp((fm.speed - 160) / 360, 0, 1) * 11 + (fm.ab ? 4 : 0);
    const amp = clamp(this.shake + extraShake, 0, 2.5);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    if (this.deathPos) {
      this.deathT += dt;
      const a = this.deathT * 0.35;
      const r = 70 + this.deathT * 6;
      cam.position.set(this.deathPos.x + Math.cos(a) * r, this.deathPos.y + 28 + this.deathT * 3, this.deathPos.z + Math.sin(a) * r);
      const s = world.surfaceAt(cam.position.x, cam.position.z);
      cam.position.y = Math.max(cam.position.y, s.height + 6);
      cam.lookAt(this.deathPos);
      fovTarget = 60;
    } else if (this.mode === 'cockpit') {
      _q.setFromEuler(_e.set(-ly * 0.8, -lx, 0, 'YXZ'));
      cam.quaternion.copy(fm.quat).multiply(_q);
      const g = clamp(fm.gLoad - 1, -4, 9);
      _v.copy(jet.eye).add(_v2.set(0, -g * 0.012, 0)).applyQuaternion(fm.quat).add(fm.pos);
      cam.position.copy(_v);
      fovTarget -= 4;
    } else if (this.mode === 'cinematic') {
      const need = !this.cine || this.cine.distanceTo(fm.pos) > 650 || _v.copy(this.cine).sub(fm.pos).dot(fm.forward) < -260;
      if (need) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.cine = fm.pos.clone().addScaledVector(fm.vel, 2.4)
          .addScaledVector(fm.right, side * (30 + Math.random() * 50))
          .addScaledVector(fm.up, -8 + Math.random() * 30);
        const s = world.surfaceAt(this.cine.x, this.cine.z);
        this.cine.y = Math.max(this.cine.y, s.height + 6);
      }
      cam.position.copy(this.cine);
      cam.lookAt(fm.pos);
      const d = this.cine.distanceTo(fm.pos);
      fovTarget = clamp(2 * Math.atan(28 / Math.max(d, 1)) * 57.3 * 2.2, 14, 70);
    } else {
      const far = this.mode === 'far';
      this.q.slerp(fm.quat, 1 - Math.exp(-dt * (far ? 3.2 : 5.5)));
      _q.setFromEuler(_e.set(-ly * 0.9, -lx, 0, 'YXZ'));
      const qc = this.q.clone().multiply(_q);
      const back = (far ? 46 : 17) * scale + clamp(fm.accelFwd * 0.12, -2, 3.5);
      const up = (far ? 9 : 4.3) * scale;
      _v.set(0, up, back).applyQuaternion(qc).add(fm.pos);
      // 인트로: 기체 앞 측면에서 추적 위치로 스윕
      if (this.intro < 1) {
        this.intro = Math.min(1, this.intro + dt / 2.6);
        const k = 1 - Math.pow(1 - this.intro, 3);
        const from = _v2.copy(fm.pos).addScaledVector(fm.right, 26 * scale).addScaledVector(fm.forward, 30 * scale).addScaledVector(fm.up, -2);
        cam.position.copy(from).lerp(_v, k);
        _m.lookAt(cam.position, fm.pos, fm.up);
        const qLook = new THREE.Quaternion().setFromRotationMatrix(_m);
        cam.quaternion.copy(qLook).slerp(qc, k * k);
      } else {
        cam.position.copy(_v);
        cam.quaternion.copy(qc).multiply(_q.setFromAxisAngle(_v2.set(1, 0, 0), -0.05));
      }
      const s = world.surfaceAt(cam.position.x, cam.position.z);
      if (cam.position.y < s.height + 2.5) cam.position.y = s.height + 2.5;
    }

    // 흔들림
    if (amp > 0.001) {
      const t = this._t;
      const a = amp * amp;
      cam.position.x += this._noise(t, 1) * a * 0.35;
      cam.position.y += this._noise(t, 2) * a * 0.35;
      cam.rotateX(this._noise(t, 3) * a * 0.012);
      cam.rotateY(this._noise(t, 4) * a * 0.012);
      cam.rotateZ(this._noise(t, 5) * a * 0.008);
    }
    this.fovKick *= Math.exp(-dt * 4);
    const fov = fovTarget + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 6));
      cam.updateProjectionMatrix();
    }
  }
}
