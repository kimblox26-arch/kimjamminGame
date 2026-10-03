// SKYBREAKER — 입력 (키보드 · 마우스 조종 · 게임패드 · 터치)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseBtn = new Set();
    this.mouseStick = { x: 0, y: 0 };
    this.look = { x: 0, y: 0, active: false };
    this.v = { pitch: 0, roll: 0, yaw: 0, throttle: null, fire: false, ab: false };
    this.taps = new Set();
    this.wheel = 0;
    this.locked = false;
    this.mouseFlight = true;
    this.sensitivity = 1;
    this.invert = false;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseBtn.clear(); });
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    let dragId = null, lx = 0, ly = 0;
    cv.addEventListener('pointerdown', (e) => {
      if (this.locked) { this.mouseBtn.add(e.button); return; }
      if (e.pointerType === 'mouse' && this.mouseFlight && this.enabled && e.button === 0) {
        this.requestLock();
        return;
      }
      dragId = e.pointerId; lx = e.clientX; ly = e.clientY;
      this.look.active = true;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.locked) {
        const k = 0.0042 * this.sensitivity;
        this.mouseStick.x = clamp(this.mouseStick.x + e.movementX * k, -1, 1);
        this.mouseStick.y = clamp(this.mouseStick.y + e.movementY * k, -1, 1);
        return;
      }
      if (e.pointerId !== dragId) return;
      this.look.x = clamp(this.look.x + (e.clientX - lx) * 0.006, -2.8, 2.8);
      this.look.y = clamp(this.look.y + (e.clientY - ly) * 0.006, -1.2, 1.2);
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => {
      this.mouseBtn.delete(e.button);
      if (e.pointerId === dragId) { dragId = null; this.look.active = false; }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    window.addEventListener('mouseup', (e) => this.mouseBtn.delete(e.button));
    cv.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === cv;
      if (!this.locked) { this.mouseBtn.clear(); this.mouseStick.x = this.mouseStick.y = 0; }
    });
  }

  requestLock() {
    if (this.canvas.requestPointerLock && !this.locked) {
      try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* noop */ }
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  tap(code) { return this.pressed.has(code); }
  consumeTap(name) { const h = this.taps.has(name); this.taps.delete(name); return h; }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** 프레임별 조종 입력 종합 */
  controls(dt) {
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    let pitch = 0, roll = 0, yaw = 0, thrDelta = 0;
    // 키보드: S/↓ = 기수 올림(당김), W/↑ = 기수 내림
    if (this.down('KeyS', 'ArrowDown')) pitch += 1;
    if (this.down('KeyW', 'ArrowUp')) pitch -= 1;
    if (this.down('KeyD', 'ArrowRight')) roll += 1;
    if (this.down('KeyA', 'ArrowLeft')) roll -= 1;
    if (this.down('KeyE')) yaw += 1;
    if (this.down('KeyQ')) yaw -= 1;
    if (this.down('ShiftLeft', 'ShiftRight')) thrDelta += 0.7;
    if (this.down('ControlLeft', 'ControlRight')) thrDelta -= 0.7;
    // 마우스 조종 (자동 중앙 복귀)
    if (this.locked) {
      pitch += -this.mouseStick.y * 1.2;
      roll += this.mouseStick.x * 1.2;
      const k = Math.exp(-dt * 3.2);
      this.mouseStick.x *= k; this.mouseStick.y *= k;
    }
    if (this.wheel) { thrDelta += -this.wheel * 3; this.wheel = 0; }
    // 게임패드
    const gp = this.gamepad();
    let gpFire = false, gpAb = false;
    if (gp) {
      roll += dz(gp.axes[0] || 0);
      pitch += dz(gp.axes[1] || 0);
      yaw += dz(gp.axes[2] || 0);
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (b(5)) thrDelta += 0.7;
      if (b(4)) thrDelta -= 0.7;
      gpFire = b(7);
      gpAb = b(6);
      const gpTap = (i, name) => { const k = 'gp' + i; if (b(i) && !this['_' + k]) this.taps.add(name); this['_' + k] = b(i); };
      gpTap(0, 'missile'); gpTap(1, 'flare'); gpTap(3, 'camera'); gpTap(9, 'pause'); gpTap(2, 'target');
    }
    // 터치
    pitch += this.v.pitch; roll += this.v.roll; yaw += this.v.yaw;
    if (this.invert) pitch = -pitch;
    const fire = this.down('Space') || this.mouseBtn.has(0) || this.v.fire || gpFire;
    const ab = this.down('Tab', 'KeyB') || this.v.ab || gpAb;
    if (this.tap('KeyX') || this.tap('KeyC')) this.taps.add('flare');
    if (this.tap('KeyF') || this.tap('KeyM') || this.tap('Enter')) this.taps.add('missile');
    if (this.tap('KeyV')) this.taps.add('camera');
    if (this.tap('KeyT')) this.taps.add('target');
    if (this.mouseBtn.has(2) && !this._rmb) this.taps.add('missile');
    this._rmb = this.mouseBtn.has(2);
    return {
      pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), yaw: clamp(yaw, -1, 1),
      thrDelta, thrAbs: this.v.throttle, fire, ab,
    };
  }

  endFrame() { this.pressed.clear(); }
}
