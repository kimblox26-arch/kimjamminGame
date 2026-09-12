// FREE FREELY - 입력 관리 (키보드 / 마우스 / 게임패드 / 화면 버튼)
import { clamp, damp } from './utils.js';
import { Settings } from './settings.js';

export const ACTIONS = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  afterburner: ['Tab'],
  brake: ['KeyB'],
  gear: ['KeyG'],
  flapsDown: ['KeyF'],
  flapsUp: ['KeyV'],
  airbrake: ['KeyX'],
  burner: ['Space'],          // 열기구 버너 / 우주선 주엔진
  vent: ['KeyC'],             // 열기구 배기밸브
  rcsUp: ['KeyR'],
  rcsDown: ['KeyT'],
  fire: ['KeyJ'],
  flare: ['KeyK'],
  lights: ['KeyL'],
  autopilot: ['KeyH'],
  camera: ['KeyN'],
  lookBack: ['KeyM'],
  chute: ['KeyP'],
  engineToggle: ['KeyI'],
  respawn: ['KeyO'],
  pause: ['Escape'],
  mapZoom: ['KeyZ'],
  timeSkip: ['KeyU'],
};

export class Input {
  constructor(domElement) {
    this.dom = domElement || window;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.virtual = new Map();    // 화면 버튼 눌림 상태
    this.virtualAxes = new Map();
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, down: false, right: false, wheel: 0, locked: false };
    this.gamepadIndex = null;
    this.enabled = true;
    this.axes = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
    this._raw = { pitch: 0, roll: 0, yaw: 0 };
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (!this.enabled) return;
      // 브라우저 기본 동작 차단 (스크롤/탭이동)
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.virtual.clear(); });
    window.addEventListener('mousemove', (e) => {
      if (this.mouse.locked) {
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      } else {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = (e.clientY / window.innerHeight) * 2 - 1;
        this.mouse.dx += (nx - this.mouse.x) * 600;
        this.mouse.dy += (ny - this.mouse.y) * 600;
        this.mouse.x = nx; this.mouse.y = ny;
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  /** 화면 버튼과 연결 — pointerdown/up 으로 가상 입력 설정 */
  attachButton(el, action, opts = {}) {
    if (!el) return;
    const down = (e) => {
      e.preventDefault();
      if (opts.toggle) this.pressed.add('virtual:' + action);
      else this.virtual.set(action, 1);
      el.classList.add('pressed');
    };
    const up = (e) => {
      e.preventDefault();
      if (!opts.toggle) this.virtual.delete(action);
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }

  setVirtualAxis(name, v) { this.virtualAxes.set(name, clamp(v, -1, 1)); }

  isDown(action) {
    if (this.virtual.get(action)) return true;
    const codes = ACTIONS[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** 이번 프레임에 눌렸는지 (에지 감지) */
  wasPressed(action) {
    if (this.pressed.has('virtual:' + action)) return true;
    const codes = ACTIONS[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  keyPressed(code) { return this.pressed.has(code); }

  gamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] || null;
  }

  /** 매 프레임 축 값 갱신 (부드러운 스틱 느낌) */
  update(dt) {
    const s = Settings.data;
    let pitch = 0, roll = 0, yaw = 0;
    if (this.isDown('pitchUp')) pitch += 1;
    if (this.isDown('pitchDown')) pitch -= 1;
    if (this.isDown('rollLeft')) roll -= 1;
    if (this.isDown('rollRight')) roll += 1;
    if (this.isDown('yawLeft')) yaw -= 1;
    if (this.isDown('yawRight')) yaw += 1;

    // 화면 조이스틱
    const vp = this.virtualAxes.get('pitch'); if (vp !== undefined && Math.abs(vp) > 0.02) pitch = vp;
    const vr = this.virtualAxes.get('roll'); if (vr !== undefined && Math.abs(vr) > 0.02) roll = vr;
    const vy = this.virtualAxes.get('yaw'); if (vy !== undefined && Math.abs(vy) > 0.02) yaw = vy;

    // 게임패드 (좌: 롤/피치, 우: 요/시점, 트리거: 스로틀)
    const gp = this.gamepad();
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      roll += dz(gp.axes[0] || 0);
      pitch += -dz(gp.axes[1] || 0);
      yaw += dz(gp.axes[2] || 0);
      if (gp.buttons[7]) this.axes.throttle = clamp(this.axes.throttle + gp.buttons[7].value * dt * 1.2, 0, 1);
      if (gp.buttons[6]) this.axes.throttle = clamp(this.axes.throttle - gp.buttons[6].value * dt * 1.2, 0, 1);
    }

    // 마우스 비행 모드
    if (s.mouseFlight && this.mouse.locked) {
      this._raw.pitch = clamp(this._raw.pitch - this.mouse.dy * 0.0016 * s.sensitivity, -1, 1);
      this._raw.roll = clamp(this._raw.roll + this.mouse.dx * 0.0016 * s.sensitivity, -1, 1);
      this._raw.pitch = damp(this._raw.pitch, 0, 0.55, dt);
      this._raw.roll = damp(this._raw.roll, 0, 0.55, dt);
      pitch += this._raw.pitch;
      roll += this._raw.roll;
    }

    if (s.invertPitch) pitch = -pitch;
    const rate = 5.5 * s.sensitivity;
    // 선형 램프 방식이 조작감이 좋아 직접 계산
    this.axes.pitch = moveAxis(this.axes.pitch, clamp(pitch, -1, 1), rate, dt);
    this.axes.roll = moveAxis(this.axes.roll, clamp(roll, -1, 1), rate * 1.3, dt);
    this.axes.yaw = moveAxis(this.axes.yaw, clamp(yaw, -1, 1), rate, dt);

    if (this.isDown('throttleUp')) this.axes.throttle = clamp(this.axes.throttle + dt * 0.55, 0, 1);
    if (this.isDown('throttleDown')) this.axes.throttle = clamp(this.axes.throttle - dt * 0.55, 0, 1);
    const vt = this.virtualAxes.get('throttle');
    if (vt !== undefined) this.axes.throttle = clamp(vt, 0, 1);
  }

  /** 프레임 종료 시 에지/델타 초기화 */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }

  requestPointerLock(el) {
    const target = el || document.body;
    if (target.requestPointerLock) target.requestPointerLock();
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = document.pointerLockElement === target;
    });
  }
  exitPointerLock() { if (document.exitPointerLock) document.exitPointerLock(); }
}

function moveAxis(cur, target, rate, dt) {
  const d = target - cur;
  const maxStep = rate * dt * (Math.abs(target) < 0.02 ? 1.8 : 1);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
