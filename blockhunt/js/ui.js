// 로블록스와 같은 UI: 왼쪽 위 메뉴·채팅 버튼, 채팅창, 오른쪽 위 플레이어 목록·체력바, 아래 핫바,
// 모바일 썸스틱(누른 자리에 생김)·점프 버튼, 화면 탭 = 도구 사용, 머리 위 이름·말풍선
import * as THREE from 'three';
import { G } from './game.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const S = (body) => `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const ICONS = {
  bow: S('<path d="M9 3c11 6 11 20 0 26" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M9 3v26" stroke="#ddd" stroke-width="1"/><path d="M5 16h21" stroke="#fff" stroke-width="2"/><path d="M28 16l-5-3.5v7z" fill="#fff"/>'),
  gun: S('<path d="M4 9h23v6H15l-2.5 10H6.5L9 15H4z" fill="#fff"/><rect x="25" y="10" width="4" height="3" fill="#fff"/>'),
  menu: S('<g transform="rotate(-15 16 16)"><rect x="5" y="5" width="22" height="22" rx="3" fill="#fff"/><rect x="13" y="13" width="6" height="6" fill="#26272b"/></g>'),
  chat: S('<path d="M6 6h20a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H14l-6 5v-5H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z" fill="#fff"/>'),
  jump: S('<path d="M16 7l10 10h-6v8h-8v-8H6z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>'),
};

export const Input = {
  mx: 0, my: 0, lookX: 0, lookY: 0, jump: false, jumpPressed: false, fire: false, firePressed: false, slot: -1,
  consume() { this.lookX = this.lookY = 0; this.firePressed = this.jumpPressed = false; this.slot = -1; },
};
const keys = {};
const stick = { id: null, bx: 0, by: 0, x: 0, y: 0 };
const look = { id: null, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: false, timer: 0 };
let touchJump = false, skipMoves = 0, chatFade = 0, dmgV = 0, chatUnlock = false;
const labels = new Map();
const _p = new THREE.Vector3();

const locked = () => document.pointerLockElement === $('gl');
function lockPointer() { if (!G.mobile && !G.paused) { const r = $('gl').requestPointerLock && $('gl').requestPointerLock(); if (r && r.catch) r.catch(() => {}); } }
const chatting = () => document.activeElement === $('chat-input');

export const UI = {
  init() {
    document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = ICONS[el.dataset.icon]));
    document.body.classList.toggle('touch', G.mobile);
    if (G.mobile) $('chat-input').placeholder = '채팅하려면 여기를 누르세요';
    const wake = () => Sound.init();
    for (const e of ['pointerdown', 'keydown', 'touchstart']) addEventListener(e, wake, { capture: true });
    this.bindKeys(); this.bindMouse(); this.bindTouch(); this.bindChat(); this.bindMenu();
  },

  bindKeys() {
    addEventListener('keydown', (e) => {
      if (chatting()) { if (e.code === 'Escape') $('chat-input').blur(); return; }
      if (e.code === 'Slash') { e.preventDefault(); this.openChat(); return; }
      if (e.code === 'Escape') { this.toggleMenu(); return; }
      if (G.paused) return;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) Input.jumpPressed = true; }
      keys[e.code] = true;
      if (/^Digit[1-9]$/.test(e.code)) Input.slot = +e.code.slice(5) - 1;
    });
    addEventListener('keyup', (e) => (keys[e.code] = false));
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; Input.fire = false; });
  },
  bindMouse() {
    const gl = $('gl');
    gl.addEventListener('mousedown', (e) => {
      if (G.paused || G.mobile) return;
      if (!locked()) { lockPointer(); return; }
      if (e.button === 0) { Input.fire = true; Input.firePressed = true; }
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) Input.fire = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!locked()) return;
      if (skipMoves > 0 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) { skipMoves--; return; }
      Input.lookX += e.movementX * 0.0022; Input.lookY += e.movementY * 0.0022;
    });
    document.addEventListener('pointerlockchange', () => {
      skipMoves = 2;
      if (chatUnlock) { chatUnlock = false; return; }
      if (!locked() && !G.paused && !G.mobile && !chatting()) this.toggleMenu(true);
    });
  },
  // 모바일: 왼쪽 아래를 누르면 그 자리에 썸스틱, 다른 곳은 끌면 시점 회전, 톡 치면 도구 사용
  bindTouch() {
    const zone = $('look'), R = 56;
    const setKnob = () => { $('knob').style.transform = `translate(${stick.x * R}px, ${stick.y * R}px)`; };
    const tool = () => (G.player.weapon() ? G.player.weapon().def.type : null);
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (stick.id === null && t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.35) {
          stick.id = t.identifier; stick.bx = t.clientX; stick.by = t.clientY; stick.x = stick.y = 0;
          const s = $('stick'); s.style.left = t.clientX + 'px'; s.style.top = t.clientY + 'px'; s.classList.add('on'); setKnob();
        } else if (look.id === null) {
          Object.assign(look, { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now(), moved: false });
          clearTimeout(look.timer);
          if (tool() === 'bow') look.timer = setTimeout(() => { if (look.id !== null && !look.moved) Input.fire = true; }, 150);
        }
      }
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === stick.id) {
          let dx = (t.clientX - stick.bx) / R, dy = (t.clientY - stick.by) / R;
          const L = Math.hypot(dx, dy);
          if (L > 1) { dx /= L; dy /= L; }
          stick.x = dx; stick.y = dy; setKnob();
        } else if (t.identifier === look.id) {
          Input.lookX += (t.clientX - look.x) * 0.0055; Input.lookY += (t.clientY - look.y) * 0.0055;
          look.x = t.clientX; look.y = t.clientY;
          if (Math.hypot(t.clientX - look.sx, t.clientY - look.sy) > 10) look.moved = true;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stick.id) { stick.id = null; stick.x = stick.y = 0; $('stick').classList.remove('on'); setKnob(); }
        if (t.identifier === look.id) {
          look.id = null; clearTimeout(look.timer);
          if (tool() === 'gun' && !look.moved && performance.now() - look.t < 350) { Input.fire = true; Input.firePressed = true; setTimeout(() => (Input.fire = false), 50); }
          if (tool() === 'bow') Input.fire = false;
        }
      }
    };
    zone.addEventListener('touchend', end); zone.addEventListener('touchcancel', end);
    const jb = $('t-jump');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); jb.setPointerCapture(e.pointerId); jb.classList.add('down'); touchJump = true; Input.jumpPressed = true; });
    const up = () => { jb.classList.remove('down'); touchJump = false; };
    jb.addEventListener('pointerup', up); jb.addEventListener('pointercancel', up);
  },
  poll() {
    if (stick.id !== null) { Input.mx = stick.x; Input.my = -stick.y; }
    else {
      const k = (c) => !chatting() && keys[c];
      const x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
      const y = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
      const L = Math.hypot(x, y) || 1;
      Input.mx = x / L; Input.my = y / L;
    }
    Input.jump = (!!keys.Space && !chatting()) || touchJump;
  },

  bindChat() {
    const inp = $('chat-input');
    $('btn-chat').addEventListener('click', () => { $('chat').classList.toggle('hidden'); $('btn-chat').classList.toggle('on'); });
    inp.addEventListener('focus', () => $('chat').classList.add('active'));
    inp.addEventListener('blur', () => $('chat').classList.remove('active'));
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = inp.value.trim();
      inp.value = '';
      inp.blur();
      if (t && G.onPlayerChat) G.onPlayerChat(t);
      lockPointer();
    });
  },
  openChat() {
    $('chat').classList.remove('hidden'); $('btn-chat').classList.add('on');
    if (locked()) { chatUnlock = true; document.exitPointerLock(); }
    setTimeout(() => $('chat-input').focus(), 0);
  },
  chat(name, text, color = '#fff') {
    const log = $('chat-log'), d = document.createElement('div');
    d.className = 'line';
    const n = document.createElement('span'); n.className = 'nm'; n.style.color = color; n.textContent = `[${name}]: `;
    d.append(n, document.createTextNode(text));
    log.append(d);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    chatFade = 12; $('chat').classList.remove('faded');
  },

  bindMenu() {
    $('btn-menu').addEventListener('click', () => this.toggleMenu());
    $('m-resume').addEventListener('click', () => this.toggleMenu(false));
    $('m-reset').addEventListener('click', () => { this.toggleMenu(false); if (G.player.alive) G.player.die(); });
    const s = G.settings;
    $('s-vol').value = s.sound; $('s-vol').addEventListener('input', (e) => { s.sound = +e.target.value; Sound.setVolume(s.sound); });
    $('s-sens').value = s.sens; $('s-sens').addEventListener('input', (e) => (s.sens = +e.target.value));
  },
  toggleMenu(open) {
    open = open ?? $('menu').classList.contains('hidden');
    $('menu').classList.toggle('hidden', !open);
    G.paused = open;
    Input.fire = false;
    for (const k in keys) keys[k] = false;
    if (open && locked()) document.exitPointerLock();
    if (!open) lockPointer();
  },

  setHotbar(inv, eq) {
    const hb = $('hotbar');
    hb.innerHTML = '';
    inv.forEach((w, i) => {
      const b = document.createElement('button');
      b.className = 'slot' + (i === eq ? ' sel' : '');
      b.innerHTML = `<span class="num">${i + 1}</span>${ICONS[w.def.id]}`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Input.slot = i; });
      hb.append(b);
    });
    document.body.classList.toggle('armed', eq >= 0);
  },
  setCar(on) { document.body.classList.toggle('driving', on); },
  damage(dmg) { dmgV = Math.min(1, dmgV + dmg / 30); },

  label(npc) {
    let L = labels.get(npc);
    if (!L) {
      const el = document.createElement('div'); el.className = 'tag'; el.style.display = 'none';
      el.innerHTML = '<div class="bubbles"></div><div class="name"></div><div class="hpb"><i></i></div>';
      el.querySelector('.name').textContent = npc.name;
      $('labels').append(el);
      L = { el, bub: el.querySelector('.bubbles'), hp: el.querySelector('.hpb'), fill: el.querySelector('.hpb i'), vis: false };
      labels.set(npc, L);
    }
    return L;
  },
  removeLabel(npc) { const L = labels.get(npc); if (L) { L.el.remove(); labels.delete(npc); } },
  bubble(npc, text) {
    const L = this.label(npc), b = document.createElement('div');
    b.className = 'bub'; b.textContent = text;
    L.bub.append(b);
    while (L.bub.children.length > 3) L.bub.firstChild.remove();
    setTimeout(() => b.classList.add('out'), 6000); setTimeout(() => b.remove(), 6500);
  },
  update(dt, cam) {
    const W = innerWidth, H = innerHeight;
    for (const n of G.npcs) {
      const L = this.label(n);
      const d = n.pos.distanceTo(cam.position);
      let show = n.alive && d < 90;
      if (show) {
        _p.copy(n.headPos()).y += 0.95;
        _p.project(cam);
        show = _p.z < 1 && Math.abs(_p.x) < 1.2 && Math.abs(_p.y) < 1.2;
      }
      if (show !== L.vis) { L.el.style.display = show ? '' : 'none'; L.vis = show; }
      if (!show) continue;
      const sc = Math.max(0.55, Math.min(1, 26 / d));
      L.el.style.transform = `translate(${((_p.x + 1) / 2) * W}px, ${((1 - _p.y) / 2) * H}px) translate(-50%, -100%) scale(${sc})`;
      const hpOn = n.health < 99;
      L.hp.style.display = hpOn ? '' : 'none';
      if (hpOn) { L.fill.style.width = Math.max(0, n.health) + '%'; L.fill.style.background = n.health > 50 ? '#3ad45e' : n.health > 25 ? '#f6c544' : '#f0473d'; }
    }
    const P = G.player;
    $('health').classList.toggle('hidden', P.health >= 100);
    $('hp-fill').style.width = Math.max(0, P.health) + '%';
    $('hp-fill').style.background = P.health > 50 ? '#3ad45e' : P.health > 25 ? '#f6c544' : '#f0473d';
    chatFade -= dt;
    if (chatFade < 0 && !chatting()) $('chat').classList.add('faded');
    dmgV = Math.max(0, dmgV - dt * 1.2);
    $('dmg').style.opacity = dmgV;
  },
};
