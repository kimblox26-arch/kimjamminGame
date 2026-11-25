// 걸어 다니기: 왼쪽 아래 조이스틱(모바일) / WASD·방향키(PC, Shift 달리기), 벽·진열대 충돌, 자동문, 발소리, 걸을 때 화면 흔들림
import * as THREE from 'three';

const RAD = 0.28;
// 매장 안 가구·벽 (x0,x1,z0,z1)
export const STORE_COLLIDERS = [
  { x0: -5.2, x1: -4.95, z0: -4, z1: 4 }, { x0: 4.55, x1: 4.8, z0: -4, z1: 4 },
  { x0: -5.2, x1: 3.1, z0: -4.1, z1: -3.95 }, { x0: 4.1, x1: 4.8, z0: -4.1, z1: -3.95 },          // 뒷벽 (직원문 틈 3.1~4.1)
  { x0: -5.2, x1: 0.62, z0: 3.95, z1: 4.1 }, { x0: 1.58, x1: 4.8, z0: 3.95, z1: 4.1 },            // 앞 유리벽 (출입문 틈)
  { x0: -3.5, x1: -2.5, z0: -2.05, z1: 2.6 }, { x0: -1.5, x1: -0.5, z0: -2.05, z1: 2.6 },          // 곤돌라 + 엔드캡
  { x0: -4.95, x1: -4.4, z0: -2.65, z1: 2.65 }, { x0: -4.6, x1: 1.9, z0: -4, z1: -3.2 },           // 벽 선반, 냉장고
  { x0: 2.28, x1: 2.92, z0: -1.22, z1: 2.42 }, { x0: 4.08, x1: 4.6, z0: -0.62, z1: 2.42 },         // 계산대, 뒤 카운터
  { x0: -1.82, x1: -0.38, z0: 2.96, z1: 3.65 }, { x0: -4.78, x1: -4.02, z0: 3.12, z1: 3.8 },       // 냉동고, ATM
  { x0: -3.98, x1: -2.26, z0: 3.4, z1: 3.85 }, { x0: -2.38, x1: -1.92, z0: 3.4, z1: 3.82 }, { x0: 0.08, x1: 0.52, z0: 3.38, z1: 3.82 },
];

export class Mover {
  constructor({ yawObj, camera, look, audio, colliders }) {
    Object.assign(this, { yawObj, camera, look, audio });
    this.colliders = colliders; this.vec = new THREE.Vector2(); this.keys = {}; this.stepAcc = 0; this.phase = 0; this.enabled = false; this.foot = 0;
    const joy = document.getElementById('joy'), knob = joy?.querySelector('i');
    let id = null;
    const set = e => { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2; let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } this.vec.set(dx, dy); knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`; };
    joy?.addEventListener('pointerdown', e => { id = e.pointerId; joy.setPointerCapture(id); set(e); e.stopPropagation(); });
    joy?.addEventListener('pointermove', e => { if (e.pointerId === id) set(e); });
    const end = e => { if (e.pointerId !== id) return; id = null; this.vec.set(0, 0); knob.style.transform = ''; };
    joy?.addEventListener('pointerup', end); joy?.addEventListener('pointercancel', end);
    addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') this.keys[e.code] = true; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
  }
  update(dt) {
    if (!this.enabled) return;
    const k = this.keys; let x = this.vec.x, y = this.vec.y;
    if (k.KeyW || k.ArrowUp) y -= 1; if (k.KeyS || k.ArrowDown) y += 1; if (k.KeyA || k.ArrowLeft) x -= 1; if (k.KeyD || k.ArrowRight) x += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    const run = k.ShiftLeft || k.ShiftRight || Math.hypot(this.vec.x, this.vec.y) > 0.95;
    const speed = (run ? 3.6 : 2.0) * Math.min(1, Math.hypot(x, y));
    const p = this.yawObj.position, yaw = this.look.yaw;
    if (speed > 0.05) {
      // 화면 앞(-z)을 기준으로 회전
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const mx = (fx * -y + rx * x), mz = (fz * -y + rz * x), n = Math.hypot(mx, mz) || 1;
      const step = speed * dt;
      p.x += mx / n * step; p.z += mz / n * step;
      this.collide(p);
      this.stepAcc += step; this.phase += step * 3.4;
      if (this.stepAcc > (run ? 0.85 : 0.7)) { this.stepAcc = 0; const out = p.z > 4.1 || p.z < -8.1; this.audio.play(this.foot++ % 2 ? 'step1' : 'step2', { pos: new THREE.Vector3(p.x, 0.1, p.z), vol: out ? 0.7 : 0.55, rate: (out ? 0.8 : 1.05) + Math.random() * 0.1 }); }
      this.look.target = null;
    }
    const bob = speed > 0.05 ? 1 : 0;
    this.camera.position.y += (Math.sin(this.phase) * 0.022 * bob - this.camera.position.y) * Math.min(1, dt * 10);
    this.camera.position.x = Math.sin(this.phase * 0.5) * 0.012 * bob;
    this.moving = speed > 0.05; this.running = this.moving && run;
  }
  collide(p) {
    for (let it = 0; it < 2; it++) for (const c of this.colliders) {
      const qx = Math.max(c.x0, Math.min(p.x, c.x1)), qz = Math.max(c.z0, Math.min(p.z, c.z1)), dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
      if (d < RAD) {
        if (d > 1e-4) { p.x = qx + dx / d * RAD; p.z = qz + dz / d * RAD; }
        else { const o = [p.x - c.x0, c.x1 - p.x, p.z - c.z0, c.z1 - p.z], m = Math.min(...o), i = o.indexOf(m); if (i === 0) p.x = c.x0 - RAD; else if (i === 1) p.x = c.x1 + RAD; else if (i === 2) p.z = c.z0 - RAD; else p.z = c.z1 + RAD; }
      }
    }
  }
}
