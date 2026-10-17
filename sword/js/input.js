// 입력: 키보드 + 마우스(포인터 락/드래그) + 터치(가상 조이스틱, 시점 드래그, 버튼)
const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  Space: 'up', KeyC: 'down', ShiftLeft: 'boost', ShiftRight: 'boost', KeyZ: 'slow',
};
const EDGE = { Space: 'jump', KeyF: 'fly', KeyQ: 'rollL', KeyE: 'rollR', KeyR: 'flip' };

export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.state = { moveX: 0, moveY: 0, up: false, down: false, boost: false, slow: false, lookDX: 0, lookDY: 0, zoom: 0 };
    this.touch = { joyId: -1, joyX: 0, joyY: 0, ox: 0, oy: 0, lookId: -1, lx: 0, ly: 0, hold: new Set() };
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.onFirstGesture = null;
    this.onKey = null;
    this.locked = false;

    addEventListener('keydown', (e) => {
      this.gesture();
      if (e.code === 'Tab') e.preventDefault();
      if (KEYMAP[e.code] || EDGE[e.code]) e.preventDefault();
      if (!e.repeat && EDGE[e.code]) this.edges.add(EDGE[e.code]);
      if (KEYMAP[e.code]) this.keys.add(KEYMAP[e.code]);
      if (!e.repeat && this.onKey) this.onKey(e.code);
    });
    addEventListener('keyup', (e) => { if (KEYMAP[e.code]) this.keys.delete(KEYMAP[e.code]); });
    addEventListener('blur', () => { this.keys.clear(); this.touch.hold.clear(); });

    // 마우스: 클릭 시 포인터 락 (데스크톱), 락이 안 되면 드래그로 회전
    let dragging = false, lx = 0, ly = 0;
    canvas.addEventListener('mousedown', (e) => {
      this.gesture();
      if (this.isTouch) return;
      if (!this.locked && canvas.requestPointerLock) {
        try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* 무시 */ }
      }
      dragging = true; lx = e.clientX; ly = e.clientY;
    });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.state.lookDX += e.movementX; this.state.lookDY += e.movementY; }
      else if (dragging) {
        this.state.lookDX += (e.clientX - lx) * 1.4; this.state.lookDY += (e.clientY - ly) * 1.4;
        lx = e.clientX; ly = e.clientY;
      }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    canvas.addEventListener('wheel', (e) => { this.state.zoom += e.deltaY; e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // 터치: 왼쪽 절반 = 조이스틱, 오른쪽 = 시점
    const T = this.touch;
    canvas.addEventListener('touchstart', (e) => {
      this.gesture();
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.42 && T.joyId < 0) {
          T.joyId = t.identifier; T.ox = t.clientX; T.oy = t.clientY; T.joyX = 0; T.joyY = 0;
          ui.joy.style.display = 'block';
          ui.joy.style.left = t.clientX + 'px'; ui.joy.style.top = t.clientY + 'px';
          ui.knob.style.transform = 'translate(-50%,-50%)';
        } else if (T.lookId < 0) {
          T.lookId = t.identifier; T.lx = t.clientX; T.ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.joyId) {
          let dx = t.clientX - T.ox, dy = t.clientY - T.oy;
          const R = 56, d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          T.joyX = dx / R; T.joyY = -dy / R;
          ui.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else if (t.identifier === T.lookId) {
          this.state.lookDX += (t.clientX - T.lx) * 2.2; this.state.lookDY += (t.clientY - T.ly) * 2.2;
          T.lx = t.clientX; T.ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.joyId) { T.joyId = -1; T.joyX = 0; T.joyY = 0; ui.joy.style.display = 'none'; }
        if (t.identifier === T.lookId) T.lookId = -1;
      }
    };
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);

    // 화면 버튼: data-hold = 누르는 동안, data-edge = 눌렀을 때 1회
    for (const b of ui.buttons) {
      const hold = b.dataset.hold, edge = b.dataset.edge;
      const down = (e) => {
        e.preventDefault();
        this.gesture();
        b.classList.add('on');
        if (edge) for (const k of edge.split(',')) this.edges.add(k);
        if (hold) {
          if (b.dataset.toggle) { if (T.hold.has(hold)) T.hold.delete(hold); else T.hold.add(hold); b.classList.toggle('lit', T.hold.has(hold)); }
          else T.hold.add(hold);
        }
      };
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('on');
        if (hold && !b.dataset.toggle) T.hold.delete(hold);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }

  gesture() {
    if (this.onFirstGesture) { const f = this.onFirstGesture; this.onFirstGesture = null; f(); }
  }

  // 고정 스텝 직전에 호출: 키/터치를 합쳐 상태 갱신
  poll() {
    const k = this.keys, T = this.touch, s = this.state;
    let x = (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0);
    let y = (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0);
    if (T.joyId >= 0) { x += T.joyX; y += T.joyY; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    s.moveX = x; s.moveY = y;
    s.up = k.has('up') || T.hold.has('up');
    s.down = k.has('down') || T.hold.has('down');
    s.boost = k.has('boost') || T.hold.has('boost');
    s.slow = k.has('slow') || T.hold.has('slow');
  }

  consume(name) {
    if (this.edges.has(name)) { this.edges.delete(name); return true; }
    return false;
  }
}
