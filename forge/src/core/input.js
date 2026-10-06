// 입력: 키보드 · 마우스(포인터 락) · 터치(가상 조이스틱/버튼)
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.hit = new Set();
    this.mx = 0; this.my = 0; // 이번 프레임 마우스 이동
    this.wheel = 0;
    this.btn = [false, false, false];
    this.btnHit = [false, false, false];
    this.btnUp = [false, false, false];
    this.locked = false;
    this.enabled = false; // 게임 플레이 중일 때만 입력 받음
    this.touch = { active: false, mx: 0, my: 0 }; // 가상 조이스틱 이동 (-1~1)
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.hit.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1'].includes(e.code)) e.preventDefault();
      if (this.enabled && (e.ctrlKey || e.metaKey) && ['KeyS', 'KeyZ', 'KeyW'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.btn = [false, false, false]; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.isTouch) { this.lock(); return; }
      this.btn[e.button] = true; this.btnHit[e.button] = true;
    });
    addEventListener('mouseup', (e) => { if (this.btn[e.button]) this.btnUp[e.button] = true; this.btn[e.button] = false; });
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mx += e.movementX; this.my += e.movementY; }
    });
    addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.btn = [false, false, false]; this.onUnlock?.(); }
    });
    if (this.isTouch) this.initTouch();
  }
  lock() { if (!this.isTouch) this.canvas.requestPointerLock?.()?.catch?.(() => {}); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  down(c) { return this.keys.has(c); }
  pressed(c) { return this.hit.has(c); }
  axis(neg, pos) { return (this.down(pos) ? 1 : 0) - (this.down(neg) ? 1 : 0); }
  endFrame() {
    this.hit.clear(); this.mx = 0; this.my = 0; this.wheel = 0;
    this.btnHit = [false, false, false]; this.btnUp = [false, false, false];
  }
  // 가상 키 (터치 버튼)
  vkey(code, on) { if (on) { if (!this.keys.has(code)) this.hit.add(code); this.keys.add(code); } else this.keys.delete(code); }
  vbtn(i, on) { if (on) { this.btn[i] = true; this.btnHit[i] = true; } else { if (this.btn[i]) this.btnUp[i] = true; this.btn[i] = false; } }

  initTouch() {
    document.body.classList.add('touch');
    const stick = document.getElementById('t-stick'), knob = document.getElementById('t-knob');
    const look = document.getElementById('t-look');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    stick?.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; stickId = t.identifier;
      const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault();
    }, { passive: false });
    look?.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = (t.clientX - sx) / 50, dy = (t.clientY - sy) / 50;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.touch.mx = dx; this.touch.my = dy; this.touch.active = true;
          knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        } else if (t.identifier === lookId) {
          this.mx += (t.clientX - lx) * 2.2; this.my += (t.clientY - ly) * 2.2; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.touch.mx = this.touch.my = 0; this.touch.active = false; knob.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    for (const b of document.querySelectorAll('[data-tkey],[data-tbtn]')) {
      const on = (v) => (e) => {
        e.preventDefault(); b.classList.toggle('on', v);
        if (b.dataset.tkey) this.vkey(b.dataset.tkey, v); else this.vbtn(+b.dataset.tbtn, v);
      };
      b.addEventListener('touchstart', on(true), { passive: false });
      b.addEventListener('touchend', on(false), { passive: false });
      b.addEventListener('touchcancel', on(false), { passive: false });
    }
  }
}
