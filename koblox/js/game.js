// 게임 "Test" — 파란 하늘 + 회색 바닥 (혼자 플레이)
import * as THREE from 'three';
import { buildAvatar, animateAvatar, disposeAvatar } from './avatar.js';
import { ITEM } from './items.js';
import { S, save } from './store.js';
import { sfx } from './audio.js';

const GRAV = 196.2, JUMP = 50, SPEED = 16, HW = 0.8;
let G = null;

const UI = `
<canvas class="g-canvas"></canvas>
<div class="g-top">
  <button class="g-btn g-menu" title="메뉴 (Esc)"><span class="k-mark">K</span></button>
  <button class="g-btn g-chat-btn" title="채팅 (/)">💬</button>
  <button class="g-btn g-emote-btn" title="감정 표현 (B)">😀</button>
</div>
<div class="g-players"><div class="g-ph">사람들</div><div class="g-me"></div></div>
<div class="g-fps"></div>
<div class="g-chat hidden"><div class="g-log"></div><input class="g-input" maxlength="100" placeholder="채팅하려면 여기를 누르세요"></div>
<div class="g-emotes hidden"></div>
<div class="g-stick hidden"><div class="g-knob"></div></div>
<button class="g-jump">⤒</button>
<div class="g-toast"></div>
<div class="g-modal hidden">
  <div class="g-panel">
    <div class="g-tabs"><button data-t="people" class="on">사람들</button><button data-t="set">설정</button><button data-t="help">도움말</button></div>
    <div class="g-tab g-t-people"></div>
    <div class="g-tab g-t-set hidden"></div>
    <div class="g-tab g-t-help hidden">
      <p><b>PC</b> — WASD/방향키 이동 · Space 점프 · 마우스 드래그 카메라 · 휠 줌 · / 채팅 · B 감정 표현 · Esc 메뉴</p>
      <p><b>모바일</b> — 화면 왼쪽을 눌러 조이스틱 · 오른쪽을 드래그해 카메라 · 두 손가락으로 줌 · 점프 버튼</p>
    </div>
    <div class="g-actions">
      <button class="g-act g-reset"><span>R</span>캐릭터 재설정</button>
      <button class="g-act g-leave"><span>L</span>나가기</button>
      <button class="g-act g-resume"><span>Esc</span>게임 재개</button>
    </div>
  </div>
</div>
<div class="g-confirm hidden"><div class="g-panel small"><h3></h3><p></p><div class="row"><button class="g-act no">취소</button><button class="g-act yes primary">확인</button></div></div></div>`;

function gridTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#8c9098'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#80848c'; g.fillRect(0, 0, 128, 3); g.fillRect(0, 0, 3, 128);
  g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(3, 3, 125, 2);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; return t;
}
function skyTex() {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#2f8cff'); gr.addColorStop(0.6, '#7cc1ff'); gr.addColorStop(1, '#d4ecff');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function padTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#5d626b'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#4b5058'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(86, 60, 22, 136);
  g.beginPath(); g.moveTo(108, 128); g.lineTo(160, 60); g.lineTo(186, 60); g.lineTo(132, 128); g.lineTo(186, 196); g.lineTo(160, 196); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function labelSprite(text, { bg = 'rgba(0,0,0,0)', color = '#fff', size = 40, w = 512, h = 96, stroke = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const draw = (txt) => {
    g.clearRect(0, 0, w, h);
    g.font = `700 ${size}px "Noto Sans KR", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (bg !== 'rgba(0,0,0,0)') {
      const tw = Math.min(g.measureText(txt).width + 40, w - 4);
      g.fillStyle = bg; g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, h - 24, 18); g.fill();
      g.beginPath(); g.moveTo(w / 2 - 10, h - 17); g.lineTo(w / 2, h - 4); g.lineTo(w / 2 + 10, h - 17); g.fill();
    }
    if (stroke) { g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(txt, w / 2, h / 2 - (bg !== 'rgba(0,0,0,0)' ? 6 : 0)); }
    g.fillStyle = color; g.fillText(txt, w / 2, h / 2 - (bg !== 'rgba(0,0,0,0)' ? 6 : 0));
  };
  draw(text);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.renderOrder = 10; sp.scale.set(w / 96 * 1.0, h / 96 * 1.0, 1);
  sp.userData.set = (txt) => { draw(txt); tex.needsUpdate = true; };
  return sp;
}

export function startGame(host, { onExit }) {
  if (G) stopGame();
  host.innerHTML = UI;
  const $ = s => host.querySelector(s);
  const canvas = $('.g-canvas');
  const set = S.settings;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = skyTex();
  scene.fog = new THREE.Fog(0xc8e6ff, 250, 700);
  const camera = new THREE.PerspectiveCamera(set.fov, 1, 0.1, 2000);

  scene.add(new THREE.HemisphereLight(0xe6f3ff, 0x6b6f76, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(60, 120, 40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  sun.shadow.bias = -0.0005; scene.add(sun, sun.target);

  // 바닥 (Baseplate)
  const colliders = [];
  const addBox = (w, h, d, x, y, z, mat, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
    m.receiveShadow = true; m.castShadow = h < 40; scene.add(m);
    if (collide) colliders.push({ min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2) });
    return m;
  };
  const gt = gridTex(); gt.repeat.set(128, 128);
  const baseTop = new THREE.MeshLambertMaterial({ map: gt }), baseSide = new THREE.MeshLambertMaterial({ color: 0x7a7e86 });
  const base = addBox(512, 4, 512, 0, -2, 0, [baseSide, baseSide, baseTop, baseSide, baseSide, baseSide]); base.castShadow = false;
  const padTop = new THREE.MeshLambertMaterial({ map: padTex() }), padSide = new THREE.MeshLambertMaterial({ color: 0x4b5058 });
  addBox(12, 1, 12, 0, 0.5, 0, [padSide, padSide, padTop, padSide, padSide, padSide]);

  // 구름
  const clouds = new THREE.Group(); scene.add(clouds);
  const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x666666 });
  for (let i = 0; i < 26; i++) {
    const c = new THREE.Group(), n = 2 + (Math.random() * 4 | 0);
    for (let j = 0; j < n; j++) { const b = new THREE.Mesh(new THREE.BoxGeometry(20 + Math.random() * 30, 6 + Math.random() * 6, 14 + Math.random() * 20), cm); b.position.set(j * 14 - n * 7, Math.random() * 4, Math.random() * 10 - 5); c.add(b); }
    c.position.set(Math.random() * 900 - 450, 110 + Math.random() * 60, Math.random() * 900 - 450); clouds.add(c);
  }

  // 플레이어
  const me = { pos: new THREE.Vector3(0, 1, 0), vel: new THREE.Vector3(), yaw: 0, grounded: false, dead: false, emote: null, emoteT: 0 };
  let av = buildAvatar(S.equip); scene.add(av.root);
  const name = S.user?.displayName || S.user?.username || 'Player';
  const tag = labelSprite(name); scene.add(tag);
  const bubble = labelSprite('', { bg: 'rgba(255,255,255,.95)', color: '#111', size: 34, stroke: false }); bubble.visible = false; scene.add(bubble);
  let bubbleT = 0;
  $('.g-me').textContent = name;

  // 카메라
  const cam = { yaw: Math.PI, pitch: 0.35, dist: 14, tYaw: Math.PI, tPitch: 0.35 };
  const keys = new Set();
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const drags = new Map();
  let jumpHeld = false, menuOpen = false, chatOpen = false;

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    const q = set.quality, dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(q === 'low' ? 0.6 : q === 'mid' ? 1 : q === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.5));
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const applySettings = () => {
    renderer.shadowMap.enabled = sun.castShadow = !!set.shadows; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
    camera.fov = set.fov; tag.visible = set.nameTags; $('.g-fps').style.display = set.showFps ? '' : 'none'; resize();
  };

  // ── 입력 ──
  const onKey = (e, down) => {
    if (document.activeElement === $('.g-input')) {
      if (down && e.key === 'Enter') sendChat();
      if (down && e.key === 'Escape') $('.g-input').blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (down) {
      if (k === 'escape') { toggleMenu(); return; }
      if (menuOpen) { if (k === 'r') resetChar(); if (k === 'l') leave(); return; }
      if (k === '/') { e.preventDefault(); openChat(true); return; }
      if (k === 'b') { toggleEmotes(); return; }
      keys.add(k); if (k === ' ') e.preventDefault();
    } else keys.delete(k);
  };
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.pointerType === 'touch' && x < r.width * 0.42 && y > r.height * 0.3 && stick.id === null) {
      Object.assign(stick, { id: e.pointerId, ox: x, oy: y, x: 0, y: 0 });
      const s = $('.g-stick'); s.classList.remove('hidden'); s.style.left = x + 'px';
      s.style.top = y + 'px'; $('.g-knob').style.transform = 'translate(-50%,-50%)';
    } else drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === stick.id) {
      const r = canvas.getBoundingClientRect(); let dx = e.clientX - r.left - stick.ox, dy = e.clientY - r.top - stick.oy;
      const l = Math.hypot(dx, dy), M = 55; if (l > M) { dx *= M / l; dy *= M / l; }
      stick.x = dx / M; stick.y = dy / M; $('.g-knob').style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const d = drags.get(e.pointerId); if (!d) return;
    if (drags.size === 2) {
      const [a, b] = [...drags.entries()]; const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(d.x - other.x, d.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      cam.dist = THREE.MathUtils.clamp(cam.dist * before / Math.max(after, 1), 0.5, 40);
    } else {
      const k = 0.006 * set.sensitivity;
      cam.tYaw -= (e.clientX - d.x) * k; cam.tPitch += (e.clientY - d.y) * k * (set.invertY ? -1 : 1);
      cam.tPitch = THREE.MathUtils.clamp(cam.tPitch, -1.2, 1.45);
    }
    d.x = e.clientX; d.y = e.clientY;
  });
  const up = e => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; $('.g-stick').classList.add('hidden'); }
    drags.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.12), 0.5, 40); }, { passive: false });
  const jb = $('.g-jump');
  jb.addEventListener('pointerdown', e => { e.preventDefault(); jumpHeld = true; jb.classList.add('on'); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => jb.addEventListener(t, () => { jumpHeld = false; jb.classList.remove('on'); }));
  if (!matchMedia('(pointer: coarse)').matches) jb.classList.add('desk');

  // ── UI ──
  const toast = (t) => { const el = $('.g-toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200); };
  const log = (who, msg, sys) => { const d = document.createElement('div'); d.className = 'g-line' + (sys ? ' sys' : ''); d.innerHTML = sys ? '' : `<b></b> `; if (!sys) d.querySelector('b').textContent = who + ':'; d.append(msg); const l = $('.g-log'); l.append(d); l.scrollTop = 1e9; };
  function openChat(focus) { chatOpen = true; $('.g-chat').classList.remove('hidden'); if (focus) setTimeout(() => $('.g-input').focus(), 0); }
  function sendChat() {
    const v = $('.g-input').value.trim(); $('.g-input').value = '';
    if (!v) return;
    if (v.startsWith('/e ')) { const em = 'emote_' + v.slice(3).trim(); if (S.owned.includes(em)) playEmote(em); return; }
    log(name, v); bubble.userData.set(v.length > 24 ? v.slice(0, 24) + '…' : v); bubble.visible = true; bubbleT = 6;
  }
  $('.g-chat-btn').onclick = () => { chatOpen ? ($('.g-chat').classList.add('hidden'), chatOpen = false) : openChat(true); };
  log('', '[시스템] Test 에 오신 걸 환영해요! "/e dance" 처럼 감정 표현도 쓸 수 있어요.', true);
  if (set.chat) openChat(false);

  const emList = S.owned.filter(id => id.startsWith('emote_'));
  $('.g-emotes').innerHTML = emList.map(id => `<button data-e="${id}">${ITEM[id].name}</button>`).join('') + '<button class="x">닫기</button>';
  function toggleEmotes(force) { $('.g-emotes').classList.toggle('hidden', force === undefined ? undefined : !force); }
  $('.g-emote-btn').onclick = () => toggleEmotes();
  $('.g-emotes').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.e) playEmote(b.dataset.e); toggleEmotes(false); };
  function playEmote(id) { me.emote = id; me.emoteT = 0; }

  function toggleMenu(force) {
    menuOpen = force ?? !menuOpen; $('.g-modal').classList.toggle('hidden', !menuOpen);
    keys.clear(); if (menuOpen) renderMenu();
  }
  $('.g-menu').onclick = () => toggleMenu(true);
  $('.g-resume').onclick = () => toggleMenu(false);
  $('.g-reset').onclick = () => resetChar();
  $('.g-leave').onclick = () => leave();
  $('.g-tabs').onclick = e => {
    const t = e.target.dataset.t; if (!t) return;
    host.querySelectorAll('.g-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    host.querySelectorAll('.g-tab').forEach(x => x.classList.toggle('hidden', !x.classList.contains('g-t-' + t)));
  };
  function renderMenu() {
    $('.g-t-people').innerHTML = `<div class="g-person"><img src="${window.KOBLOX_HEADSHOT || ''}" alt=""><div><b></b><small></small></div></div>`;
    $('.g-t-people b').textContent = name; $('.g-t-people small').textContent = '@' + (S.user?.username || 'player');
    const T = $('.g-t-set');
    T.innerHTML = `
      <label>카메라 감도 <input type="range" min="0.2" max="3" step="0.1" data-k="sensitivity"></label>
      <label>시야각 <input type="range" min="50" max="100" step="1" data-k="fov"></label>
      <label>음량 <input type="range" min="0" max="100" step="1" data-k="volume"></label>
      <label>그래픽 품질 <select data-k="quality"><option value="auto">자동</option><option value="low">낮음</option><option value="mid">중간</option><option value="high">높음</option></select></label>
      <label class="chk">카메라 Y축 반전 <input type="checkbox" data-k="invertY"></label>
      <label class="chk">그림자 <input type="checkbox" data-k="shadows"></label>
      <label class="chk">이름표 표시 <input type="checkbox" data-k="nameTags"></label>
      <label class="chk">FPS 표시 <input type="checkbox" data-k="showFps"></label>
      <label class="chk">효과음 <input type="checkbox" data-k="sfx"></label>`;
    T.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k; if (el.type === 'checkbox') el.checked = !!set[k]; else el.value = set[k];
      el.oninput = () => { set[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value; save(); applySettings(); };
    });
  }
  function confirmBox(title, body, cb) {
    const c = $('.g-confirm'); c.querySelector('h3').textContent = title; c.querySelector('p').textContent = body; c.classList.remove('hidden');
    c.querySelector('.no').onclick = () => c.classList.add('hidden');
    c.querySelector('.yes').onclick = () => { c.classList.add('hidden'); cb(); };
  }
  function resetChar() { confirmBox('캐릭터를 재설정할까요?', '캐릭터가 부서지고 처음 위치에서 다시 나타나요.', () => { toggleMenu(false); die(); }); }
  function leave() { confirmBox('게임을 나갈까요?', '홈 화면으로 돌아가요.', () => { stopGame(); onExit?.(); }); }

  // ── 죽음/부활 ──
  const debris = [];
  function die() {
    if (me.dead) return;
    me.dead = true; sfx.die(); if (set.vibrate && navigator.vibrate) navigator.vibrate(120);
    av.root.updateMatrixWorld(true);
    const parts = [];
    av.root.traverse(o => { if (o.isMesh && o.visible) parts.push(o); });
    parts.forEach(o => {
      const m = o.clone(); o.getWorldPosition(m.position); o.getWorldQuaternion(m.quaternion); o.getWorldScale(m.scale);
      scene.add(m);
      debris.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 14 + 4, (Math.random() - 0.5) * 14), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    });
    av.root.visible = false; tag.visible = false; bubble.visible = false;
    setTimeout(respawn, 2200);
  }
  function respawn() {
    debris.forEach(d => scene.remove(d.m)); debris.length = 0;
    me.pos.set(0, 1.05, 0); me.vel.set(0, 0, 0); me.dead = false; me.emote = null;
    av.root.visible = true; tag.visible = set.nameTags; cam.tYaw = me.yaw + Math.PI;
  }

  // ── 물리 ──
  function collideAxis(axis, h) {
    const p = me.pos; let hit = false;
    for (const c of colliders) {
      if (p.x + HW <= c.min.x || p.x - HW >= c.max.x || p.z + HW <= c.min.z || p.z - HW >= c.max.z || p.y + h <= c.min.y || p.y >= c.max.y) continue;
      hit = true;
      if (axis === 'y') { if (me.vel.y <= 0) { p.y = c.max.y; me.grounded = true; } else p.y = c.min.y - h; me.vel.y = 0; }
      else {
        const top = c.max.y - p.y;
        if (me.grounded && top > 0 && top <= 1.05) { p.y = c.max.y; continue; } // 작은 턱은 자동으로 올라감
        if (axis === 'x') p.x = me.vel.x > 0 ? c.min.x - HW - 1e-4 : c.max.x + HW + 1e-4;
        else p.z = me.vel.z > 0 ? c.min.z - HW - 1e-4 : c.max.z + HW + 1e-4;
      }
    }
    return hit;
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
  function physics(dt) {
    if (me.dead) return;
    let ix = stick.x, iz = -stick.y;
    if (!menuOpen) {
      if (keys.has('w') || keys.has('arrowup')) iz += 1;
      if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
      if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
      if (keys.has('d') || keys.has('arrowright')) ix += 1;
    }
    fwd.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)); right.set(-fwd.z, 0, fwd.x);
    mv.set(0, 0, 0).addScaledVector(fwd, iz).addScaledVector(right, ix);
    const l = mv.length(); if (l > 1) mv.divideScalar(l);
    me.vel.x = mv.x * SPEED; me.vel.z = mv.z * SPEED;
    if (l > 0.05) { me.yaw = Math.atan2(mv.x, mv.z); if (me.emote) me.emote = null; }
    const wantJump = (keys.has(' ') || jumpHeld) && !menuOpen;
    if (wantJump && me.grounded) { me.vel.y = JUMP; me.grounded = false; me.emote = null; sfx.jump(); }
    me.vel.y -= GRAV * dt;
    const wasGround = me.grounded, h = av.height;
    me.pos.x += me.vel.x * dt; collideAxis('x', h);
    me.pos.z += me.vel.z * dt; collideAxis('z', h);
    me.grounded = false; me.pos.y += me.vel.y * dt; collideAxis('y', h);
    if (me.grounded && !wasGround && me.vel.y === 0) sfx.land();
    if (me.pos.y < -80) die();
  }

  // ── 루프 ──
  const clock = new THREE.Clock(); let fpsAcc = 0, fpsN = 0, raf = 0;
  const tgt = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    for (let i = 0; i < 3; i++) physics(dt / 3);
    if (me.emote) me.emoteT += dt;
    // 아바타
    av.root.position.copy(me.pos);
    let dy = me.yaw - av.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    av.root.rotation.y += dy * Math.min(1, dt * 14);
    const hs = Math.hypot(me.vel.x, me.vel.z);
    animateAvatar(av, dt, { speed: hs, air: !me.grounded, emote: me.emote, emoteT: me.emoteT });
    tag.position.set(me.pos.x, me.pos.y + av.height + 0.9, me.pos.z);
    bubble.position.set(me.pos.x, me.pos.y + av.height + 2.2, me.pos.z);
    if (bubbleT > 0 && (bubbleT -= dt) <= 0) bubble.visible = false;
    // 잔해
    debris.forEach(d => {
      d.v.y -= GRAV * 0.4 * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
      const fl = Math.abs(d.m.position.x) < 6 && Math.abs(d.m.position.z) < 6 ? 1.3 : 0.3;
      if (d.m.position.y < fl && Math.abs(d.m.position.x) < 256 && Math.abs(d.m.position.z) < 256) { d.m.position.y = fl; d.v.multiplyScalar(0.5); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.8); }
    });
    // 카메라
    cam.yaw += (cam.tYaw - cam.yaw) * Math.min(1, dt * 18); cam.pitch += (cam.tPitch - cam.pitch) * Math.min(1, dt * 18);
    const focus = me.dead && debris[0] ? debris[0].m.position : me.pos;
    tgt.set(focus.x, (me.dead ? focus.y : me.pos.y) + av.height * 0.82, focus.z);
    const first = cam.dist < 1.2;
    av.root.visible = !me.dead && !first; tag.visible = set.nameTags && !me.dead && !first;
    const cd = Math.cos(cam.pitch) * cam.dist;
    camera.position.set(tgt.x + Math.sin(cam.yaw) * cd, tgt.y + Math.sin(cam.pitch) * cam.dist, tgt.z + Math.cos(cam.yaw) * cd);
    if (camera.position.y < 0.4 && Math.abs(camera.position.x) < 256 && Math.abs(camera.position.z) < 256) camera.position.y = 0.4;
    camera.lookAt(tgt);
    if (first) me.yaw = cam.yaw + Math.PI;
    sun.position.set(me.pos.x + 60, 120, me.pos.z + 40); sun.target.position.copy(me.pos);
    clouds.children.forEach(c => { c.position.x += dt * 3; if (c.position.x > 450) c.position.x = -450; });
    renderer.render(scene, camera);
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('.g-fps').textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = fpsN = 0; }
  }
  addEventListener('resize', resize);
  applySettings(); frame();
  toast('Test 에 접속했어요');

  G = {
    stop() {
      cancelAnimationFrame(raf); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
      disposeAvatar(av); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); }); renderer.dispose(); host.innerHTML = '';
    },
  };
}

export function stopGame() { if (G) { G.stop(); G = null; } }
