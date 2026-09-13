// ORBITER — 입력 관리자
// 키보드 / 마우스 / 터치 / 게임패드를 하나의 추상 입력 상태로 통합한다.

import { clamp, deadzone, Vec2 } from './math.js';

/** 기본 키 바인딩 — 설정에서 덮어쓸 수 있다. */
export const DEFAULT_BINDINGS = {
  pitchUp: ['KeyW', 'ArrowUp'],
  pitchDown: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  throttleMax: ['KeyZ'],
  throttleZero: ['KeyX'],
  stage: ['Space'],
  rcsToggle: ['KeyR'],
  sasToggle: ['KeyT'],
  gearToggle: ['KeyG'],
  chuteDeploy: ['KeyP'],
  lightToggle: ['KeyU'],
  translateUp: ['KeyI'],
  translateDown: ['KeyK'],
  translateLeft: ['KeyJ'],
  translateRight: ['KeyL'],
  warpUp: ['Period', 'Comma'],
  warpDown: ['Comma'],
  mapToggle: ['KeyM'],
  cameraNext: ['KeyC'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  pause: ['Escape'],
  quicksave: ['F5'],
  quickload: ['F9'],
  screenshot: ['F2'],
  navPrograde: ['Digit1'],
  navRetrograde: ['Digit2'],
  navRadialIn: ['Digit3'],
  navRadialOut: ['Digit4'],
  navTarget: ['Digit5'],
  navSurface: ['Digit6'],
  timeSkip: ['Backslash'],
  help: ['F1'],
};

export class InputManager {
  constructor(target = window, opts = {}) {
    this.target = target;
    this.canvas = opts.canvas || null;
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));

    /** 현재 눌린 키 코드 */
    this.keys = new Set();
    /** 이번 프레임에 눌린 키 */
    this.keysPressed = new Set();
    /** 이번 프레임에 떼어진 키 */
    this.keysReleased = new Set();

    this.mouse = {
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      wheel: 0,
      left: false,
      right: false,
      middle: false,
      leftPressed: false,
      leftReleased: false,
      rightPressed: false,
      rightReleased: false,
      downX: 0,
      downY: 0,
      dragging: false,
      dragDistance: 0,
      overUI: false,
    };

    /** 활성 터치 목록 */
    this.touches = new Map();
    this.pinch = { active: false, startDist: 0, dist: 0, scale: 1, delta: 0 };
    this.isTouchDevice =
      'ontouchstart' in window || navigator.maxTouchPoints > 0;

    /** 가상 조이스틱/버튼(터치 UI)이 기록하는 값 */
    this.virtual = {
      pitch: 0,
      roll: 0,
      throttle: null,
      buttons: new Set(),
      buttonsPressed: new Set(),
    };

    this.gamepadIndex = -1;
    this.gamepadState = null;
    this.gamepadDeadzone = 0.12;

    /** 텍스트 입력 중일 때 게임 키 입력을 막는다 */
    this.textCaptureDepth = 0;
    this.enabled = true;

    this._handlers = [];
    this._attach();
  }

  /* ── 이벤트 연결 ───────────────────────────────────────── */

  _add(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this._handlers.push([el, type, fn, opts]);
  }

  _attach() {
    const t = this.target;
    this._add(t, 'keydown', (e) => this._onKeyDown(e));
    this._add(t, 'keyup', (e) => this._onKeyUp(e));
    this._add(t, 'blur', () => this.clearAll());

    const surface = this.canvas || t;
    this._add(surface, 'mousemove', (e) => this._onMouseMove(e));
    this._add(surface, 'mousedown', (e) => this._onMouseDown(e));
    this._add(t, 'mouseup', (e) => this._onMouseUp(e));
    this._add(surface, 'wheel', (e) => this._onWheel(e), { passive: false });
    this._add(surface, 'contextmenu', (e) => e.preventDefault());

    this._add(surface, 'touchstart', (e) => this._onTouchStart(e), {
      passive: false,
    });
    this._add(surface, 'touchmove', (e) => this._onTouchMove(e), {
      passive: false,
    });
    this._add(t, 'touchend', (e) => this._onTouchEnd(e));
    this._add(t, 'touchcancel', (e) => this._onTouchEnd(e));

    this._add(window, 'gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      console.info('[input] 게임패드 연결:', e.gamepad.id);
    });
    this._add(window, 'gamepaddisconnected', () => {
      this.gamepadIndex = -1;
      this.gamepadState = null;
    });
  }

  destroy() {
    for (const [el, type, fn, opts] of this._handlers) {
      el.removeEventListener(type, fn, opts);
    }
    this._handlers.length = 0;
  }

  /* ── 키보드 ───────────────────────────────────────────── */

  _onKeyDown(e) {
    if (this.textCaptureDepth > 0) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable)
      return;
    if (!this.enabled) return;
    if (!this.keys.has(e.code)) this.keysPressed.add(e.code);
    this.keys.add(e.code);
    // 브라우저 기본 동작을 막아야 하는 키
    if (
      [
        'Space',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Tab',
        'F1',
        'F2',
        'F5',
        'F9',
        'Backslash',
      ].includes(e.code)
    ) {
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    if (this.keys.has(e.code)) this.keysReleased.add(e.code);
    this.keys.delete(e.code);
  }

  /** 텍스트 입력 시작 — 게임 단축키 차단 */
  captureText() {
    this.textCaptureDepth++;
    this.keys.clear();
  }

  releaseText() {
    this.textCaptureDepth = Math.max(0, this.textCaptureDepth - 1);
  }

  clearAll() {
    this.keys.clear();
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.mouse.middle = false;
    this.mouse.dragging = false;
    this.touches.clear();
    this.virtual.buttons.clear();
    this.virtual.pitch = 0;
    this.virtual.roll = 0;
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.keysPressed.has(code);
  }

  wasReleased(code) {
    return this.keysReleased.has(code);
  }

  /** 액션 이름으로 질의 (바인딩 사용) */
  action(name) {
    const codes = this.bindings[name];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return this.virtual.buttons.has(name);
  }

  actionPressed(name) {
    const codes = this.bindings[name];
    if (codes) {
      for (const c of codes) if (this.keysPressed.has(c)) return true;
    }
    return this.virtual.buttonsPressed.has(name);
  }

  /** 축 입력 (-1 … 1) */
  axis(negAction, posAction) {
    let v = 0;
    if (this.action(negAction)) v -= 1;
    if (this.action(posAction)) v += 1;
    return v;
  }

  setBinding(action, codes) {
    this.bindings[action] = Array.isArray(codes) ? codes : [codes];
  }

  resetBindings() {
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
  }

  /* ── 마우스 ───────────────────────────────────────────── */

  _localPos(e) {
    const el = this.canvas || document.body;
    const r = el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (el.width ? el.width / r.width / (window.devicePixelRatio || 1) : 1),
      y: (e.clientY - r.top) * (el.height ? el.height / r.height / (window.devicePixelRatio || 1) : 1),
    };
  }

  _onMouseMove(e) {
    const p = this._localPos(e);
    this.mouse.dx += p.x - this.mouse.x;
    this.mouse.dy += p.y - this.mouse.y;
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    if (this.mouse.left || this.mouse.right || this.mouse.middle) {
      const dx = p.x - this.mouse.downX;
      const dy = p.y - this.mouse.downY;
      this.mouse.dragDistance = Math.hypot(dx, dy);
      if (this.mouse.dragDistance > 4) this.mouse.dragging = true;
    }
  }

  _onMouseDown(e) {
    const p = this._localPos(e);
    this.mouse.x = p.x;
    this.mouse.y = p.y;
    this.mouse.downX = p.x;
    this.mouse.downY = p.y;
    this.mouse.dragDistance = 0;
    this.mouse.dragging = false;
    if (e.button === 0) {
      this.mouse.left = true;
      this.mouse.leftPressed = true;
    } else if (e.button === 1) {
      this.mouse.middle = true;
    } else if (e.button === 2) {
      this.mouse.right = true;
      this.mouse.rightPressed = true;
    }
  }

  _onMouseUp(e) {
    if (e.button === 0) {
      this.mouse.left = false;
      this.mouse.leftReleased = true;
    } else if (e.button === 1) {
      this.mouse.middle = false;
    } else if (e.button === 2) {
      this.mouse.right = false;
      this.mouse.rightReleased = true;
    }
    if (!this.mouse.left && !this.mouse.right && !this.mouse.middle) {
      this.mouse.dragging = false;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    // 브라우저별 delta 정규화
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= 100;
    this.mouse.wheel += clamp(d, -400, 400);
  }

  /** 클릭(드래그가 아닌) 판정 */
  get clicked() {
    return this.mouse.leftReleased && this.mouse.dragDistance < 5;
  }

  /* ── 터치 ─────────────────────────────────────────────── */

  _onTouchStart(e) {
    for (const t of e.changedTouches) {
      const el = this.canvas || document.body;
      const r = el.getBoundingClientRect();
      this.touches.set(t.identifier, {
        id: t.identifier,
        x: t.clientX - r.left,
        y: t.clientY - r.top,
        startX: t.clientX - r.left,
        startY: t.clientY - r.top,
        dx: 0,
        dy: 0,
        age: 0,
      });
    }
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      this.pinch.active = true;
      this.pinch.startDist = d;
      this.pinch.dist = d;
      this.pinch.scale = 1;
      this.pinch.delta = 0;
    }
    // 단일 터치는 좌클릭처럼 취급
    if (this.touches.size === 1) {
      const t = [...this.touches.values()][0];
      this.mouse.x = t.x;
      this.mouse.y = t.y;
      this.mouse.downX = t.x;
      this.mouse.downY = t.y;
      this.mouse.left = true;
      this.mouse.leftPressed = true;
      this.mouse.dragDistance = 0;
    }
    if (e.cancelable) e.preventDefault();
  }

  _onTouchMove(e) {
    const el = this.canvas || document.body;
    const r = el.getBoundingClientRect();
    for (const t of e.changedTouches) {
      const rec = this.touches.get(t.identifier);
      if (!rec) continue;
      const nx = t.clientX - r.left;
      const ny = t.clientY - r.top;
      rec.dx += nx - rec.x;
      rec.dy += ny - rec.y;
      rec.x = nx;
      rec.y = ny;
    }
    if (this.pinch.active && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      this.pinch.delta = d - this.pinch.dist;
      this.pinch.dist = d;
      this.pinch.scale = this.pinch.startDist > 1 ? d / this.pinch.startDist : 1;
    } else if (this.touches.size === 1) {
      const t = [...this.touches.values()][0];
      this.mouse.dx += t.x - this.mouse.x;
      this.mouse.dy += t.y - this.mouse.y;
      this.mouse.x = t.x;
      this.mouse.y = t.y;
      this.mouse.dragDistance = Math.hypot(
        t.x - this.mouse.downX,
        t.y - this.mouse.downY
      );
      if (this.mouse.dragDistance > 6) this.mouse.dragging = true;
    }
    if (e.cancelable) e.preventDefault();
  }

  _onTouchEnd(e) {
    for (const t of e.changedTouches) this.touches.delete(t.identifier);
    if (this.touches.size < 2) {
      this.pinch.active = false;
      this.pinch.delta = 0;
    }
    if (this.touches.size === 0) {
      this.mouse.left = false;
      this.mouse.leftReleased = true;
      this.mouse.dragging = false;
    }
  }

  /* ── 게임패드 ─────────────────────────────────────────── */

  _pollGamepad() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = this.gamepadIndex >= 0 ? pads[this.gamepadIndex] : null;
    if (!pad) {
      for (const p of pads) {
        if (p && p.connected) {
          pad = p;
          this.gamepadIndex = p.index;
          break;
        }
      }
    }
    if (!pad) {
      this.gamepadState = null;
      return;
    }
    const dz = this.gamepadDeadzone;
    const prev = this.gamepadState;
    const buttons = pad.buttons.map((b) => b.pressed);
    this.gamepadState = {
      lx: deadzone(pad.axes[0] || 0, dz),
      ly: deadzone(pad.axes[1] || 0, dz),
      rx: deadzone(pad.axes[2] || 0, dz),
      ry: deadzone(pad.axes[3] || 0, dz),
      lt: pad.buttons[6]?.value ?? 0,
      rt: pad.buttons[7]?.value ?? 0,
      buttons,
      pressed: buttons.map((b, i) => b && !(prev?.buttons[i] ?? false)),
      id: pad.id,
    };
  }

  gamepadButton(i) {
    return this.gamepadState?.buttons[i] ?? false;
  }

  gamepadPressed(i) {
    return this.gamepadState?.pressed[i] ?? false;
  }

  /* ── 가상 버튼 (터치 UI) ──────────────────────────────── */

  pressVirtual(action) {
    if (!this.virtual.buttons.has(action))
      this.virtual.buttonsPressed.add(action);
    this.virtual.buttons.add(action);
  }

  releaseVirtual(action) {
    this.virtual.buttons.delete(action);
  }

  setVirtualStick(pitch, roll) {
    this.virtual.pitch = clamp(pitch, -1, 1);
    this.virtual.roll = clamp(roll, -1, 1);
  }

  /* ── 통합 제어 입력 ───────────────────────────────────── */

  /**
   * 비행 제어 입력을 하나로 합쳐서 반환.
   * @returns {{pitch:number, roll:number, throttleDelta:number,
   *            translateX:number, translateY:number}}
   */
  flightInput() {
    let pitch = 0;
    let roll = 0;
    if (this.action('pitchUp')) pitch += 1;
    if (this.action('pitchDown')) pitch -= 1;
    if (this.action('rollLeft')) roll -= 1;
    if (this.action('rollRight')) roll += 1;

    pitch += this.virtual.pitch;
    roll += this.virtual.roll;

    const gp = this.gamepadState;
    if (gp) {
      pitch += -gp.ly;
      roll += gp.lx;
    }

    let throttleDelta = 0;
    if (this.action('throttleUp')) throttleDelta += 1;
    if (this.action('throttleDown')) throttleDelta -= 1;
    if (gp) throttleDelta += gp.rt - gp.lt;

    let tx = 0;
    let ty = 0;
    if (this.action('translateLeft')) tx -= 1;
    if (this.action('translateRight')) tx += 1;
    if (this.action('translateUp')) ty += 1;
    if (this.action('translateDown')) ty -= 1;
    if (gp) {
      tx += gp.rx;
      ty += -gp.ry;
    }

    return {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      throttleDelta: clamp(throttleDelta, -1, 1),
      translateX: clamp(tx, -1, 1),
      translateY: clamp(ty, -1, 1),
    };
  }

  /** 매 프레임 시작 시 폴링 */
  beginFrame() {
    this._pollGamepad();
    for (const t of this.touches.values()) t.age++;
  }

  /** 매 프레임 끝에 1프레임 플래그 초기화 */
  endFrame() {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.virtual.buttonsPressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftPressed = false;
    this.mouse.leftReleased = false;
    this.mouse.rightPressed = false;
    this.mouse.rightReleased = false;
    this.pinch.delta = 0;
    for (const t of this.touches.values()) {
      t.dx = 0;
      t.dy = 0;
    }
  }

  get mousePos() {
    return new Vec2(this.mouse.x, this.mouse.y);
  }
}

/**
 * 화면 위 가상 조이스틱 위젯.
 * DOM 요소 위에 포인터 이벤트를 붙여 -1..1 축 값을 만든다.
 */
export class VirtualStick {
  constructor(el, opts = {}) {
    this.el = el;
    this.knob = el.querySelector('.stick-knob') || null;
    this.radius = opts.radius ?? 56;
    this.x = 0;
    this.y = 0;
    this.active = false;
    this.pointerId = null;
    this.onChange = opts.onChange || null;

    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.style.touchAction = 'none';
  }

  _down(e) {
    this.active = true;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this._move(e);
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / this.radius;
    let dy = (e.clientY - cy) / this.radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.x = dx;
    this.y = -dy;
    this._render();
    if (this.onChange) this.onChange(this.x, this.y);
  }

  _up(e) {
    if (e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this._render();
    if (this.onChange) this.onChange(0, 0);
  }

  _render() {
    if (!this.knob) return;
    this.knob.style.transform = `translate(${this.x * this.radius * 0.6}px, ${
      -this.y * this.radius * 0.6
    }px)`;
  }
}
