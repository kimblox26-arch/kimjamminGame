// 모바일 터치 조작: 왼쪽 가상 조이스틱, 오른쪽 드래그 시점, 액션 버튼
const LOOK_GAIN = 1.35;
const DEAD = 0.3;
const ITEMS = ['frag', 'smoke', 'c4'];
const ITEM_KEY = { frag: 'KeyG', smoke: 'Digit4', c4: 'Digit5' };

const BTNS = [
  // [id, 라벨, 동작, 종류] 종류: hold=누르는 동안, tap=한 번, look=누른 채 시점 이동 가능
  ['fire', '발사', 'fire', 'look'],
  ['fire2', '발사', 'fire', 'look'],
  ['ads', '조준', 'ads', 'tap'],
  ['reload', '장전', 'KeyR', 'tap'],
  ['jump', '점프', 'Space', 'tap'],
  ['crouch', '앉기', 'KeyC', 'tap'],
  ['swap', '무기', 'swap', 'tap'],
  ['nade', '투척', 'nade', 'tap'],
  ['use', 'F', 'KeyF', 'tap'],
  ['mode', '모드', 'KeyB', 'tap'],
  ['light', '손전등', 'KeyL', 'tap'],
  ['nvg', '야시경', 'KeyN', 'tap'],
  ['pause', 'Ⅱ', 'Escape', 'tap'],
];

export function isTouchDevice() {
  return new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches;
}

export function setupTouch(g) {
  const I = g.input;
  document.body.classList.add('touch');
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = '<div id="t-look"></div><div id="t-stick"><i></i></div>' +
    BTNS.map(([id, label]) => `<button type="button" class="tb" id="tb-${id}">${label}</button>`).join('') +
    '<div id="t-rotate">가로 화면으로 돌려주세요</div>';
  document.body.appendChild(root);
  const stick = root.querySelector('#t-stick'), knob = stick.querySelector('i');

  let adsOn = false, fireN = 0;
  const touches = new Map(); // 터치 id → { kind, x, y, ox, oy }
  const setAds = (on) => { adsOn = on; I.setMouse(2, on); root.querySelector('#tb-ads').classList.toggle('on', on); };
  const setMove = (nx, ny) => {
    I.hold('KeyW', ny < -DEAD); I.hold('KeyS', ny > DEAD);
    I.hold('KeyA', nx < -DEAD); I.hold('KeyD', nx > DEAD);
    I.hold('ShiftLeft', ny < -0.92 && Math.abs(nx) < 0.5 && !adsOn);
  };

  const act = (a) => {
    const W = g.weapons;
    if (a === 'ads') return setAds(!adsOn);
    if (a === 'swap') { setAds(false); return I.tap(W.item || W.slot ? 'Digit1' : 'Digit2'); }
    if (a === 'nade') { setAds(false); const k = W.item ? ITEMS[(ITEMS.indexOf(W.item) + 1) % ITEMS.length] : 'frag'; return I.tap(ITEM_KEY[k]); }
    if (a === 'KeyR') setAds(false);
    I.tap(a);
  };

  const release = (t) => {
    if (t.kind === 'stick') { setMove(0, 0); stick.classList.remove('on'); }
    if (t.kind === 'fire' && --fireN <= 0) { fireN = 0; I.setMouse(0, false); }
    t.el?.classList.remove('press');
  };
  const reset = () => { for (const t of touches.values()) release(t); touches.clear(); setAds(false); I.releaseAll(); };

  root.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (g.state !== 'playing') return;
    for (const c of e.changedTouches) {
      const b = c.target.closest?.('.tb');
      const t = { kind: 'look', x: c.clientX, y: c.clientY, ox: c.clientX, oy: c.clientY };
      if (b) {
        const def = BTNS.find((d) => 'tb-' + d[0] === b.id);
        t.el = b; b.classList.add('press');
        if (def[2] === 'fire') { t.kind = 'fire'; fireN++; I.setMouse(0, true); }
        else { t.kind = 'btn'; act(def[2]); }
      } else if (c.clientX < innerWidth * 0.4 && ![...touches.values()].some((o) => o.kind === 'stick')) {
        t.kind = 'stick';
        stick.style.left = c.clientX + 'px'; stick.style.top = c.clientY + 'px';
        knob.style.transform = ''; stick.classList.add('on');
      }
      touches.set(c.identifier, t);
    }
  }, { passive: false });

  root.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const c of e.changedTouches) {
      const t = touches.get(c.identifier); if (!t) continue;
      if (t.kind === 'stick') {
        const R = 56;
        let dx = c.clientX - t.ox, dy = c.clientY - t.oy;
        const d = Math.hypot(dx, dy); if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(${dx}px,${dy}px)`;
        setMove(dx / R, dy / R);
      } else if (t.kind === 'look' || t.kind === 'fire') {
        I.look((c.clientX - t.x) * LOOK_GAIN, (c.clientY - t.y) * LOOK_GAIN);
      }
      t.x = c.clientX; t.y = c.clientY;
    }
  }, { passive: false });

  const end = (e) => {
    e.preventDefault();
    for (const c of e.changedTouches) { const t = touches.get(c.identifier); if (t) { release(t); touches.delete(c.identifier); } }
  };
  root.addEventListener('touchend', end, { passive: false });
  root.addEventListener('touchcancel', end, { passive: false });

  // 게임 화면을 벗어나면 누르고 있던 입력 해제
  const show = g.showScreen.bind(g);
  g.showScreen = (name) => { if (name !== 'game') reset(); show(name); };

  // 전체화면 + 가로 고정 (지원 브라우저만)
  g.enterFullscreen = () => {
    const d = document.documentElement;
    if (document.fullscreenElement || !d.requestFullscreen) return;
    d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  };
}
