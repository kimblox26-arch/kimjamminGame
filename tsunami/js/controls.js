// 입력(키보드·마우스·터치 조이스틱) 과 지도 카메라(이동·확대·회전·기울기, 핀치 지원)
import * as THREE from 'three';
import { HALF } from './config.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.lookX = 0; this.lookY = 0;
    this.joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.lookTouch = null;
    this.actPressed = false; this.jumpPressed = false; this.runToggle = false;
    this.fpMode = false;
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.actPressed = true;
      if (e.code === 'Space') { this.jumpPressed = true; if (this.fpMode) e.preventDefault(); }
      if (this.onKey) this.onKey(e);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.lookX += e.movementX * 0.0022; this.lookY += e.movementY * 0.0022; }
    });
    // 터치 조이스틱 / 시점 드래그 (사람 모드)
    const joyEl = document.getElementById('joy'), knob = document.getElementById('joy-knob');
    this.joyEl = joyEl; this.knob = knob;
    const tz = document.getElementById('touch-zone');
    tz.addEventListener('pointerdown', (e) => {
      if (!this.fpMode) return;
      if (e.pointerType === 'mouse') { if (canvas.requestPointerLock) canvas.requestPointerLock(); return; }
      tz.setPointerCapture(e.pointerId);
      if (e.clientX < innerWidth * 0.45 && this.joy.id === null) {
        this.joy.id = e.pointerId; this.joy.ox = e.clientX; this.joy.oy = e.clientY;
        joyEl.style.left = e.clientX + 'px'; joyEl.style.top = e.clientY + 'px'; joyEl.classList.add('on');
      } else if (!this.lookTouch) this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    tz.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joy.id) {
        let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
        const l = Math.hypot(dx, dy), R = 55;
        if (l > R) { dx *= R / l; dy *= R / l; }
        this.joy.x = dx / R; this.joy.y = dy / R;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (this.lookTouch && e.pointerId === this.lookTouch.id) {
        this.lookX += (e.clientX - this.lookTouch.x) * 0.0042; this.lookY += (e.clientY - this.lookTouch.y) * 0.0042;
        this.lookTouch.x = e.clientX; this.lookTouch.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === this.joy.id) { this.joy.id = null; this.joy.x = this.joy.y = 0; knob.style.transform = ''; joyEl.classList.remove('on'); }
      if (this.lookTouch && e.pointerId === this.lookTouch.id) this.lookTouch = null;
    };
    tz.addEventListener('pointerup', end);
    tz.addEventListener('pointercancel', end);
  }

  /** 사람 모드 입력 한 프레임 소비 */
  consumeFP() {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    mx += this.joy.x; mz -= this.joy.y;
    const joyRun = Math.hypot(this.joy.x, this.joy.y) > 0.92;
    const out = {
      mx, mz, run: k.has('ShiftLeft') || k.has('ShiftRight') || this.runToggle || joyRun,
      jump: this.jumpPressed, act: this.actPressed, lookX: this.lookX, lookY: this.lookY,
    };
    this.lookX = this.lookY = 0; this.jumpPressed = false; this.actPressed = false;
    return out;
  }
}

export class MapCamera {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.target = new THREE.Vector3(-100, 0, 80);
    this.dist = 2600; this.yaw = 0; this.pitch = 0.95;
    this.goal = { dist: this.dist, yaw: 0, pitch: this.pitch, tx: this.target.x, tz: this.target.z };
    this.pointers = new Map();
    this.enabled = true;
    this.onTap = null;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.goal.dist = Math.max(40, Math.min(5200, this.goal.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(e) {
    if (!this.enabled) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button });
    this.moved = this.pointers.size > 1;
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.enabled) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) this.moved = true;
    if (this.pointers.size === 1) {
      if (p.btn === 2 || e.shiftKey) {
        this.goal.yaw -= dx * 0.005;
        this.goal.pitch = Math.max(0.12, Math.min(1.5, this.goal.pitch + dy * 0.004));
      } else if (this.moved) {
        const s = this.dist * 0.0013 * (1 / Math.max(0.35, Math.sin(this.pitch)));
        const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
        this.goal.tx -= (dx * c + dy * sn * 1.0) * s * 0.8;
        this.goal.tz -= (-dx * sn + dy * c) * s * 0.8;
      }
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const other = a === p ? b : a;
      const d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 10) this.goal.dist = Math.max(40, Math.min(5200, this.goal.dist * d0 / d1));
      const a0 = Math.atan2(p.y - other.y, p.x - other.x), a1 = Math.atan2(e.clientY - other.y, e.clientX - other.x);
      this.goal.yaw += (a1 - a0);
      this.goal.pitch = Math.max(0.12, Math.min(1.5, this.goal.pitch + dy * 0.002));
    }
    p.x = e.clientX; p.y = e.clientY;
  }

  up(e, cancel) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || cancel || !this.enabled) return;
    if (!this.moved && this.pointers.size === 0 && performance.now() - p.t < 450 && p.btn === 0 && this.onTap) this.onTap(e.clientX, e.clientY);
  }

  keys(keys, dt) {
    const s = this.dist * 0.6 * dt;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    let fx = 0, fz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    this.goal.tx += (fx * c + fz * sn) * s;
    this.goal.tz += (-fx * sn + fz * c) * s;
    if (keys.has('KeyQ')) this.goal.yaw += dt * 1.2;
    if (keys.has('KeyE')) this.goal.yaw -= dt * 1.2;
    if (keys.has('KeyR')) this.goal.pitch = Math.min(1.5, this.goal.pitch + dt);
    if (keys.has('KeyF')) this.goal.pitch = Math.max(0.12, this.goal.pitch - dt);
  }

  focus(x, z, dist) {
    this.goal.tx = x; this.goal.tz = z;
    if (dist) this.goal.dist = dist;
  }

  update(dt, groundAt) {
    const g = this.goal, k = 1 - Math.exp(-dt * 8);
    g.tx = Math.max(-HALF - 800, Math.min(HALF + 800, g.tx));
    g.tz = Math.max(-HALF - 800, Math.min(HALF + 800, g.tz));
    this.target.x += (g.tx - this.target.x) * k;
    this.target.z += (g.tz - this.target.z) * k;
    this.dist += (g.dist - this.dist) * k;
    this.yaw += (g.yaw - this.yaw) * k;
    this.pitch += (g.pitch - this.pitch) * k;
    const gy = Math.max(0, groundAt(this.target.x, this.target.z));
    this.target.y += (gy - this.target.y) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cam = this.camera;
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    const minY = Math.max(0, groundAt(cam.position.x, cam.position.z)) + 3;
    if (cam.position.y < minY) cam.position.y = minY;
    cam.lookAt(this.target);
  }
}
