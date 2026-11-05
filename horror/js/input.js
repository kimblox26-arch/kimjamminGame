// 조작: 화면 조이스틱 · 드래그 시점 · 버튼 + 키보드/마우스
export class Input {
  constructor(el) {
    this.mx = 0; this.my = 0; this.lookDX = 0; this.lookDY = 0; this.runToggle = false; this.shift = false;
    this.keys = {}; this.handlers = {}; this.sens = 1; this.enabled = true;
    const joy = document.getElementById('joy'), knob = document.getElementById('joy-knob');
    this.joy = joy; this.knob = knob; this.joyId = null; this.lookId = null;
    const R = () => joy.getBoundingClientRect();
    const setKnob = (x, y) => {
      const r = R(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2;
      let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy); if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.transform = `translate(${dx}px,${dy}px)`; this.mx = dx / max; this.my = -dy / max;
    };
    const resetKnob = () => { knob.style.transform = ''; this.mx = 0; this.my = 0; };
    const isUI = (t) => t.closest && t.closest('.btn, .hud-top, .modal, .panel, button, #joy-zone, input');
    // 조이스틱 영역
    const zone = document.getElementById('joy-zone');
    zone.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; this.joyId = t.identifier; setKnob(t.clientX, t.clientY); joy.classList.add('on'); }, { passive: false });
    // 시점 드래그 (조이스틱/버튼이 아닌 곳)
    el.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) if (this.lookId === null && !isUI(t.target)) { this.lookId = t.identifier; this.lx = t.clientX; this.ly = t.clientY; }
    }, { passive: true });
    window.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joyId) setKnob(t.clientX, t.clientY);
        else if (t.identifier === this.lookId) { this.lookDX += (t.clientX - this.lx) * 0.0055 * this.sens; this.lookDY += (t.clientY - this.ly) * 0.0045 * this.sens; this.lx = t.clientX; this.ly = t.clientY; }
      }
      if (e.cancelable && this.joyId !== null) e.preventDefault();
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) { if (t.identifier === this.joyId) { this.joyId = null; resetKnob(); joy.classList.remove('on'); } if (t.identifier === this.lookId) this.lookId = null; } };
    window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
    // 마우스
    let mdown = false;
    el.addEventListener('mousedown', e => { if (isUI(e.target)) return; mdown = true; this.lx = e.clientX; this.ly = e.clientY; if (this.pointerLock && el.requestPointerLock) el.requestPointerLock(); });
    window.addEventListener('mouseup', () => mdown = false);
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement) { this.lookDX += e.movementX * 0.0028 * this.sens; this.lookDY += e.movementY * 0.0024 * this.sens; return; }
      if (!mdown) return; this.lookDX += (e.clientX - this.lx) * 0.005 * this.sens; this.lookDY += (e.clientY - this.ly) * 0.004 * this.sens; this.lx = e.clientX; this.ly = e.clientY;
    });
    // 키보드
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      const map = { KeyE: 'interact', Space: 'interact', Enter: 'interact', KeyF: 'torch', Tab: 'notes', KeyN: 'notes', Escape: 'pause', KeyP: 'pause', KeyR: 'run' };
      if (map[e.code]) { e.preventDefault(); if (!e.repeat) this.fire(map[e.code]); }
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; resetKnob(); });
    // 화면 버튼
    document.querySelectorAll('[data-act]').forEach(b => {
      const f = e => { e.preventDefault(); e.stopPropagation(); this.fire(b.dataset.act); b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 140); };
      b.addEventListener('touchstart', f, { passive: false }); b.addEventListener('click', e => { if (e.detail !== 0 || true) f(e); });
    });
  }
  on(name, fn) { this.handlers[name] = fn; }
  fire(name) { if (this.handlers[name]) this.handlers[name](); }
  move() {
    let x = this.mx, y = this.my, k = this.keys;
    if (k.KeyW || k.ArrowUp) y = 1; if (k.KeyS || k.ArrowDown) y = -1; if (k.KeyA || k.ArrowLeft) x = -1; if (k.KeyD || k.ArrowRight) x = 1;
    const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
    return { x, y, mag: Math.min(1, d) };
  }
  get running() { return this.runToggle || this.keys.ShiftLeft || this.keys.ShiftRight; }
  takeLook() { const r = [this.lookDX, this.lookDY]; this.lookDX = 0; this.lookDY = 0; return r; }
}
