// SpaceSim — 궤도 카메라: 마우스/터치(회전·핀치·이동), 관성, 천체 추적, 부드러운 전환
import * as THREE from 'three';
import { clamp } from './util.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class OrbitCam {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();
    this.radius = 10; this.goalRadius = 10;
    this.theta = 0.6; this.goalTheta = 0.6;
    this.phi = 1.1; this.goalPhi = 1.1;
    this.minR = 0.01; this.maxR = 1e5;
    this.follow = null;          // () => Vector3
    this.trans = null;           // 전환 상태
    this.vTheta = 0; this.vPhi = 0;
    this.autoRotate = false;
    this.idle = 0;
    this.nearFactor = 0.002;
    this.minNear = 1e-6;
    this.minFar = 0;
    this.pointers = new Map();
    this.interceptor = null;     // (type, e) => bool  (샌드박스 발사 도구)
    this.onTap = null; this.onDoubleTap = null;
    this._lastTap = 0;
    this._pinch = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e, true));
    d.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0012))); this.idle = 0; }, { passive: false });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _down(e) {
    this.idle = 0;
    if (this._intercepting != null) {
      // 두 번째 손가락: 발사 취소 후 카메라 제스처로 전환
      const id = this._intercepting;
      this._intercepting = null;
      this.interceptor('cancel', e);
      this.pointers.set(id, { ...this._ipos, sx: -1e4, sy: -1e4, t: 0, btn: 0 });
    } else if (this.pointers.size === 0 && this.interceptor && this.interceptor('down', e)) {
      this._intercepting = e.pointerId;
      this._ipos = { x: e.clientX, y: e.clientY };
      return;
    }
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button, shift: e.shiftKey });
    this.vTheta = this.vPhi = 0;
    if (this.pointers.size === 2) this._pinch = this._pinchState();
  }

  _pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  _move(e) {
    if (this._intercepting === e.pointerId) { this._ipos = { x: e.clientX, y: e.clientY }; this.interceptor('move', e); return; }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    this.idle = 0;
    const h = this.dom.clientHeight || 800;
    if (this.pointers.size === 1) {
      if (p.btn === 2 || p.btn === 1 || p.shift) this.pan(dx, dy);
      else {
        const k = 3.2 / h;
        this.goalTheta -= dx * k; this.goalPhi -= dy * k;
        this.vTheta = -dx * k; this.vPhi = -dy * k;
      }
    } else if (this.pointers.size === 2 && this._pinch) {
      const s = this._pinchState();
      if (s.d > 0 && this._pinch.d > 0) this.zoom(this._pinch.d / s.d);
      this.pan(s.mx - this._pinch.mx, s.my - this._pinch.my);
      this._pinch = s;
    }
    this.goalPhi = clamp(this.goalPhi, 0.02, Math.PI - 0.02);
  }

  _up(e, cancel) {
    if (this._intercepting === e.pointerId) { this._intercepting = null; this.interceptor(cancel ? 'cancel' : 'up', e); return; }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this._pinch = null;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    const dt = performance.now() - p.t;
    if (!cancel && moved < 8 && dt < 350 && this.pointers.size === 0) {
      const now = performance.now();
      if (now - this._lastTap < 320 && this.onDoubleTap) { this.onDoubleTap(e.clientX, e.clientY); this._lastTap = 0; }
      else { this._lastTap = now; this.onTap && this.onTap(e.clientX, e.clientY); }
    }
  }

  zoom(f) { this.goalRadius = clamp(this.goalRadius * f, this.minR, this.maxR); }

  pan(dx, dy) {
    const h = this.dom.clientHeight || 800;
    const s = (2 * this.radius * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    if (this.follow) { this._freeze(); }
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  }

  _freeze() { this.follow = null; this.trans = null; }

  // 추적 대상 지정 (부드러운 전환)
  focus(getPos, radius, duration = 1.4) {
    this.trans = { from: this.target.clone(), t: 0, dur: duration, fromR: this.radius };
    this.follow = getPos;
    if (radius) this.goalRadius = clamp(radius, this.minR, this.maxR);
  }

  set(view) {
    if (view.theta !== undefined) this.goalTheta = view.theta;
    if (view.phi !== undefined) this.goalPhi = view.phi;
    if (view.radius !== undefined) this.goalRadius = view.radius;
    if (view.jump) { this.theta = this.goalTheta; this.phi = this.goalPhi; this.radius = this.goalRadius; }
  }

  update(dt) {
    this.idle += dt;
    if (this.pointers.size === 0) {
      this.goalTheta += this.vTheta; this.goalPhi = clamp(this.goalPhi + this.vPhi, 0.02, Math.PI - 0.02);
      const damp = Math.exp(-dt * 4);
      this.vTheta *= damp; this.vPhi *= damp;
      if (this.autoRotate && this.idle > 4) this.goalTheta += dt * 0.05;
    }
    const k = 1 - Math.exp(-dt * 9);
    this.theta += (this.goalTheta - this.theta) * k;
    this.phi += (this.goalPhi - this.phi) * k;
    const kr = 1 - Math.exp(-dt * 6);
    this.radius = Math.exp(Math.log(this.radius) + (Math.log(this.goalRadius) - Math.log(this.radius)) * kr);

    if (this.follow) {
      const fp = this.follow();
      if (this.trans) {
        this.trans.t += dt / this.trans.dur;
        const t = ease(Math.min(this.trans.t, 1));
        this.target.lerpVectors(this.trans.from, fp, t);
        if (this.trans.t >= 1) this.trans = null;
      } else this.target.copy(fp);
    }

    const sp = Math.sin(this.phi);
    const c = this.camera;
    c.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    c.lookAt(this.target);
    const near = Math.max(this.radius * this.nearFactor, this.minNear);
    c.near = near;
    c.far = Math.max(this.radius * 4000, near * 1e6, this.minFar);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
