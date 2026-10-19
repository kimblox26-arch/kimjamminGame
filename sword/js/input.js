// 입력: 키보드 + 마우스(포인터 락/드래그) + 터치(가상 조이스틱, 시점 드래그, 버튼) + 게임패드
const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  Space: 'up', KeyC: 'down', ShiftLeft: 'boost', ShiftRight: 'boost', KeyZ: 'slow',
};
const EDGE = { Space: 'jump', KeyF: 'fly', KeyQ: 'rollL', KeyE: 'rollR', KeyR: 'flip', KeyX: 'lock', KeyT: 'target', KeyG: 'auto' };

export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();
    this.state = { moveX: 0, moveY: 0, up: false, down: false, boost: false, slow: false, lookDX: 0, lookDY: 0, zoom: 0 };
    this.touch = { joyId: -1, joyX: 0, joyY: 0, ox: 0, oy: 0, lookId: -1, lx: 0, ly: 0, hold: new Set() };
    this.isTouch = matchMedia('(pointer: coarse)').matches;
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
    addEventListener('blur', () => {
      this.keys.clear(); this.touch.hold.clear();
      this.touch.joyId = -1; this.touch.lookId = -1; this.touch.joyX = 0; this.touch.joyY = 0; ui.joy.style.display = 'none';
      for (const b of ui.buttons) b.classList.remove('on', 'lit');
    });

    // 마우스: 클릭 시 포인터 락 (데스크톱), 락이 안 되면 드래그로 회전
    let dragging = false, lx = 0, ly = 0;
    canvas.addEventListener('mousedown', (e) => {
      this.gesture();
      // 터치에서 흉내 낸 마우스 이벤트만 무시 (터치스크린 노트북의 진짜 마우스는 허용)
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
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

    // 터치: 왼쪽 42% = 조이스틱, 오른쪽 = 시점
    //  왼쪽에서 시작한 손가락은 절대 시점 회전이 되지 않음 (조이스틱을 잡은 손의 다른 손가락·손바닥이 닿아도 화면이 돌지 않게)
    const T = this.touch;
    canvas.addEventListener('touchstart', (e) => {
      this.gesture();
      // touchend 를 놓친 손가락 정리 (화면 밖으로 미끄러짐, 알림창 등)
      const alive = (id) => { for (const t of e.touches) if (t.identifier === id) return true; return false; };
      if (T.joyId >= 0 && !alive(T.joyId)) { T.joyId = -1; T.joyX = 0; T.joyY = 0; ui.joy.style.display = 'none'; }
      if (T.lookId >= 0 && !alive(T.lookId)) T.lookId = -1;
      for (const t of e.changedTouches) {
        const left = t.clientX < innerWidth * 0.42;
        if (left && T.joyId < 0) {
          T.joyId = t.identifier; T.ox = t.clientX; T.oy = t.clientY; T.joyX = 0; T.joyY = 0;
          ui.joy.style.display = 'block';
          ui.joy.style.left = t.clientX + 'px'; ui.joy.style.top = t.clientY + 'px';
          ui.knob.style.transform = 'translate(-50%,-50%)';
        } else if (!left && T.lookId < 0) {
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

  // 게임패드 (표준 매핑): 왼쪽 스틱 = 이동만, 오른쪽 스틱 = 시점만
  //  A 점프/상승 · B 하강 · X 비행 · Y 공중제비 · LB/RB 롤 · LT 느리게 · RT/L3 부스트 · Back 속도 고정 · Start 자동 항법 · 십자 위 목표
  _pad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    const P = this.pad || (this.pad = { prev: [], x: 0, y: 0, hold: new Set(), active: false });
    P.x = 0; P.y = 0; P.hold.clear(); P.active = false;
    if (!pads) return;
    let g = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { g = p; break; }
    if (!g) for (const p of pads) if (p && p.connected) { g = p; break; }
    if (!g) return;
    P.active = true;
    const dz = (v, d = 0.18) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
    // 왼쪽 스틱: 원형 데드존
    let lx = g.axes[0] || 0, ly = g.axes[1] || 0;
    const lm = Math.hypot(lx, ly);
    if (lm < 0.18) { lx = 0; ly = 0; } else { const k = Math.min(1, (lm - 0.18) / 0.82) / lm; lx *= k; ly *= k; }
    P.x = lx; P.y = -ly;
    // 오른쪽 스틱 → 시점 (초당 회전, 제곱 곡선으로 미세 조작)
    const rx = dz(g.axes[2] || 0), ry = dz(g.axes[3] || 0);
    this.state.lookDX += Math.sign(rx) * rx * rx * 1100 * dt;
    this.state.lookDY += Math.sign(ry) * ry * ry * 750 * dt;
    const B = (i) => { const b = g.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
    const EDGEB = { 0: 'jump', 2: 'fly', 3: 'flip', 4: 'rollL', 5: 'rollR', 8: 'lock', 9: 'auto', 12: 'target' };
    for (const i in EDGEB) { const on = B(+i); if (on && !P.prev[i]) { this.edges.add(EDGEB[i]); this.gesture(); } P.prev[i] = on; }
    if (B(0)) P.hold.add('up');
    if (B(1)) P.hold.add('down');
    if (B(6)) P.hold.add('slow');
    if (B(7) || B(10)) P.hold.add('boost');
  }

  // 프레임마다 호출: 키/터치/게임패드를 합쳐 상태 갱신
  poll(dt = 0) {
    this._pad(dt);
    const k = this.keys, T = this.touch, s = this.state, P = this.pad;
    let x = (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0);
    let y = (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0);
    if (T.joyId >= 0) { x += T.joyX; y += T.joyY; }
    x += P.x; y += P.y;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    s.moveX = x; s.moveY = y;
    const h = (n) => k.has(n) || T.hold.has(n) || P.hold.has(n);
    s.up = h('up');
    s.down = h('down');
    s.boost = h('boost');
    s.slow = h('slow');
  }

  consume(name) {
    if (this.edges.has(name)) { this.edges.delete(name); return true; }
    return false;
  }
}
