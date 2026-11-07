// 게임 실행기 — 플레이스(맵) 데이터를 받아 혼자 플레이
import * as THREE from 'three';
import { buildAvatar, animateAvatar, disposeAvatar, buildGear } from './avatar.js';
import { ITEM, ITEMS, BADGES } from './items.js';
import { S, save, award, onBadge } from './store.js';
import { sfx } from './audio.js';
import { buildWorld, TEST_PLACE } from './world.js';
import { makeRenderer, makePipeline, gfxLevel, gfxProfile, partMat } from './gfx.js';
import { ico, badgeSvg } from './icons.js';

const GRAV = 196.2, JUMP = 50, SPEED = 16, HW = 0.8;
let G = null;

const UI = `
<canvas class="g-canvas"></canvas>
<div class="g-top">
  <button class="g-btn g-menu" title="메뉴 (Esc)"><span class="k-mark">K</span></button>
  <button class="g-btn g-chat-btn" title="채팅 (/)">${ico('chat')}</button>
  <button class="g-btn g-emote-btn" title="감정 표현 (B)">${ico('smile')}</button>
</div>
<div class="g-board"><div class="g-ph"></div><div class="g-rows"></div></div>
<div class="g-fps"></div>
<div class="g-chat hidden"><div class="g-log"></div><input class="g-input" maxlength="100" placeholder="채팅하려면 여기를 누르세요"></div>
<div class="g-emotes hidden"></div>
<div class="g-stick hidden"><div class="g-knob"></div></div>
<div class="g-hotbar"></div>
<button class="g-shift" title="화면 고정 (Shift)">${ico('lock')}</button>
<button class="g-jump" title="점프 (Space)">${ico('jump')}</button>
<div class="g-cross hidden"></div>
<div class="g-toast"></div>
<div class="g-badge"></div>
<div class="g-modal hidden">
  <div class="g-panel">
    <div class="g-tabs"><button data-t="people" class="on">${ico('people')}사람들</button><button data-t="set">${ico('gear')}설정</button><button data-t="badges">${ico('badge')}배지</button><button data-t="help">${ico('help')}도움말</button></div>
    <div class="g-tab g-t-people"></div>
    <div class="g-tab g-t-set hidden"></div>
    <div class="g-tab g-t-badges hidden"></div>
    <div class="g-tab g-t-help hidden">
      <p><b>PC</b> — WASD/방향키 이동 · Space 점프 · 드래그 카메라 · 휠 줌 · Shift 화면 고정 · 1~6 장비 · 클릭 장비 사용 · / 채팅 · B 감정 표현 · Esc 메뉴</p>
      <p><b>모바일</b> — 화면 왼쪽을 눌러 조이스틱 · 오른쪽 드래그 카메라 · 두 손가락 줌 · 화면을 톡 눌러 장비 사용</p>
    </div>
    <div class="g-actions">
      <button class="g-act g-reset">${ico('undo')}<span>R</span>캐릭터 재설정</button>
      <button class="g-act g-shot">${ico('camera')}<span>P</span>캡처</button>
      <button class="g-act g-leave">${ico('logout')}<span>L</span><em>나가기</em></button>
      <button class="g-act g-resume primary">${ico('play')}<span>Esc</span>게임 재개</button>
    </div>
  </div>
</div>
<div class="g-confirm hidden"><div class="g-panel small"><h3></h3><p></p><div class="row"><button class="g-act no">취소</button><button class="g-act yes primary">확인</button></div></div></div>`;

function labelSprite(text, { bg = null, color = '#fff', size = 40, w = 512, h = 96 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const draw = (txt) => {
    g.clearRect(0, 0, w, h);
    g.font = `700 ${size}px "Noto Sans KR", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const y = bg ? h / 2 - 6 : h / 2;
    if (bg) {
      const tw = Math.min(g.measureText(txt).width + 40, w - 4);
      g.fillStyle = bg; g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, h - 24, 18); g.fill();
      g.beginPath(); g.moveTo(w / 2 - 10, h - 17); g.lineTo(w / 2, h - 4); g.lineTo(w / 2 + 10, h - 17); g.fill();
    } else { g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(txt, w / 2, y); }
    g.fillStyle = color; g.fillText(txt, w / 2, y);
  };
  draw(text);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
  sp.renderOrder = 10; sp.scale.set(w / 96, h / 96, 1);
  sp.userData.set = (txt) => { draw(txt); tex.needsUpdate = true; };
  return sp;
}

export function startGame(host, { place = TEST_PLACE, onExit, testMode = false } = {}) {
  if (G) stopGame();
  host.innerHTML = UI;
  const $ = s => host.querySelector(s);
  const canvas = $('.g-canvas');
  const set = S.settings;
  let prof = gfxProfile(gfxLevel(set));
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(set.fov, 1, 0.1, 3000);
  const world = buildWorld(scene, place, prof, renderer);
  let pipe = makePipeline(renderer, scene, camera, prof);
  const hasCoins = world.coins.length > 0, hasChecks = place.parts.some(p => p.k === 'check');
  if (testMode) $('.g-leave em').textContent = '스튜디오로';

  // ── 플레이어 ──
  const me = { pos: world.spawn.clone(), vel: new THREE.Vector3(), yaw: Math.PI, grounded: false, dead: false, emote: null, emoteT: 0, respawn: world.spawn.clone(), stage: 0, coins: 0, lastCheck: null };
  const av = buildAvatar(S.equip, S.scales); scene.add(av.root); av.root.rotation.y = Math.PI;
  const name = S.user?.displayName || S.user?.username || 'Player';
  const tag = labelSprite(name); scene.add(tag);
  const bubble = labelSprite('', { bg: 'rgba(255,255,255,.95)', color: '#111', size: 34 }); bubble.visible = false; scene.add(bubble);
  let bubbleT = 0, jumps = 0;

  // ── 장비 ──
  const gear = ITEMS.filter(i => i.slot === 'gear' && S.owned.includes(i.id)).map(i => i.id);
  let tool = null, toolMesh = null, toolT = 0;
  const hotbar = $('.g-hotbar');
  hotbar.innerHTML = gear.map((id, i) => `<button data-g="${id}"><img src="${window.KOBLOX_THUMB?.(id) || ''}" alt=""><i>${i + 1}</i><small>${ITEM[id].name}</small></button>`).join('');
  hotbar.classList.toggle('hidden', !gear.length);
  hotbar.onclick = e => { const b = e.target.closest('button'); if (b) equipTool(b.dataset.g); };
  function equipTool(id) {
    if (toolMesh) { av.ra.remove(toolMesh); toolMesh = null; }
    tool = tool === id ? null : id;
    if (tool) { toolMesh = buildGear(tool); toolMesh.position.y = av.handY; av.ra.add(toolMesh); me.emote = null; sfx.click(); }
    hotbar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === tool));
    $('.g-cross').classList.toggle('hidden', !(tool && shiftLock));
  }

  // ── 카메라/입력 ──
  const cam = { yaw: 0, pitch: 0.3, dist: 14, tYaw: 0, tPitch: 0.3 };
  const keys = new Set();
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const drags = new Map();
  let jumpHeld = false, menuOpen = false, chatOpen = false, shiftLock = false;

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setPixelRatio(prof.pixelRatio); renderer.setSize(w, h, false); pipe.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  function applySettings() {
    const np = gfxProfile(gfxLevel(set));
    if (np.lv !== prof.lv) {
      prof = np; pipe.dispose(); pipe = makePipeline(renderer, scene, camera, prof);
      world.sun.castShadow = prof.shadows;
      if (world.sun.shadow.mapSize.x !== prof.shadowSize) { world.sun.shadow.map?.dispose(); world.sun.shadow.map = null; world.sun.shadow.mapSize.set(prof.shadowSize, prof.shadowSize); }
      const R = prof.shadowRange; Object.assign(world.sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R }); world.sun.shadow.camera.updateProjectionMatrix();
      scene.fog.far = prof.fog; scene.fog.near = prof.fog * 0.35;
    }
    camera.fov = set.fov; tag.visible = set.nameTags; $('.g-fps').style.display = set.showFps ? '' : 'none'; resize();
  }
  function setShift(on) {
    shiftLock = on; $('.g-shift').classList.toggle('on', on);
    $('.g-shift').innerHTML = ico(on ? 'lock' : 'unlock');
    if (on && !matchMedia('(pointer: coarse)').matches) { try { canvas.requestPointerLock?.()?.catch?.(() => { }); } catch { } }
    if (!on && document.pointerLockElement) document.exitPointerLock();
    $('.g-cross').classList.toggle('hidden', !(on && tool));
  }
  $('.g-shift').onclick = () => setShift(!shiftLock);
  const onLockChange = () => { if (!document.pointerLockElement && shiftLock && !matchMedia('(pointer: coarse)').matches) setShift(false); };
  document.addEventListener('pointerlockchange', onLockChange);

  const onKey = (e, down) => {
    if (document.activeElement === $('.g-input')) {
      if (down && e.key === 'Enter') sendChat();
      if (down && e.key === 'Escape') $('.g-input').blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (down) {
      if (k === 'escape') { toggleMenu(); return; }
      if (menuOpen) { if (k === 'r') resetChar(); if (k === 'l') leave(); if (k === 'p') shot(); return; }
      if (k === '/') { e.preventDefault(); openChat(true); return; }
      if (k === 'b') { toggleEmotes(); return; }
      if (k === 'shift' && !e.repeat) { setShift(!shiftLock); return; }
      if (/^[1-9]$/.test(k) && gear[+k - 1]) { equipTool(gear[+k - 1]); return; }
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
      const s = $('.g-stick'); s.classList.remove('hidden'); s.style.left = x + 'px'; s.style.top = y + 'px'; $('.g-knob').style.transform = 'translate(-50%,-50%)';
    } else drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
  });
  const rotateCam = (dx, dy) => {
    const k = 0.006 * set.sensitivity;
    cam.tYaw -= dx * k; cam.tPitch += dy * k * (set.invertY ? -1 : 1);
    cam.tPitch = THREE.MathUtils.clamp(cam.tPitch, -1.3, 1.45);
  };
  addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) rotateCam(e.movementX, e.movementY); });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === stick.id) {
      const r = canvas.getBoundingClientRect(); let dx = e.clientX - r.left - stick.ox, dy = e.clientY - r.top - stick.oy;
      const l = Math.hypot(dx, dy), M = 55; if (l > M) { dx *= M / l; dy *= M / l; }
      stick.x = dx / M; stick.y = dy / M; $('.g-knob').style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const d = drags.get(e.pointerId); if (!d || document.pointerLockElement) return;
    if (drags.size === 2) {
      const [a, b] = [...drags.entries()]; const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(d.x - other.x, d.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      cam.dist = THREE.MathUtils.clamp(cam.dist * before / Math.max(after, 1), 0.5, 60);
    } else rotateCam(e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX; d.y = e.clientY;
  });
  const up = e => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; $('.g-stick').classList.add('hidden'); }
    const d = drags.get(e.pointerId);
    if (d && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8 && performance.now() - d.t < 350 && drags.size === 1) {
      const r = canvas.getBoundingClientRect();
      if (document.pointerLockElement) useTool(r.width / 2, r.height / 2); else useTool(e.clientX - r.left, e.clientY - r.top);
    }
    drags.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.12), 0.5, 60); }, { passive: false });
  const jb = $('.g-jump');
  jb.addEventListener('pointerdown', e => { e.preventDefault(); jumpHeld = true; jb.classList.add('on'); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => jb.addEventListener(t, () => { jumpHeld = false; jb.classList.remove('on'); }));
  if (!matchMedia('(pointer: coarse)').matches) { jb.classList.add('desk'); $('.g-shift').classList.add('desk'); }

  // ── 장비 사용 ──
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function aim(sx, sy) {
    ndc.set(sx / canvas.clientWidth * 2 - 1, -(sy / canvas.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera); ray.far = 600;
    const hit = ray.intersectObjects(world.meshes, false)[0];
    return { hit, point: hit ? hit.point : ray.ray.at(300, new THREE.Vector3()), dir: ray.ray.direction.clone() };
  }
  const handPos = () => toolMesh ? toolMesh.getWorldPosition(new THREE.Vector3()) : me.pos.clone().setY(me.pos.y + av.height * 0.6);
  const rockets = [], fx = [];
  function useTool(sx, sy) {
    if (!tool || me.dead || menuOpen) return;
    const a = aim(sx, sy);
    me.yaw = Math.atan2(a.point.x - me.pos.x, a.point.z - me.pos.z);
    if (tool === 'gear_sword') { if (toolT <= 0) { toolT = 0.0001; sfx.swing(); } }
    else if (tool === 'gear_rocket') {
      if (rockets.length > 3) return;
      const from = handPos(), dir = a.point.clone().sub(from).normalize();
      const m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.3, 10), partMat('#cfd6df', 'metal')); body.rotation.x = Math.PI / 2; m.add(body);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa02a, toneMapped: false })); fl.position.z = -0.8; m.add(fl);
      m.position.copy(from); m.lookAt(from.clone().add(dir)); scene.add(m);
      rockets.push({ m, dir, life: 0 }); sfx.shoot(); toolT = 0.0001;
    } else if (tool === 'gear_builder') {
      if (!a.hit || S.stats.built > 100000) return;
      const n = a.hit.face.normal.clone().transformDirection(a.hit.object.matrixWorld);
      const p = a.hit.point.clone().addScaledVector(n, 0.5);
      const c = [Math.floor(p.x / 2) * 2 + 1, Math.floor(p.y / 2) * 2 + 1, Math.floor(p.z / 2) * 2 + 1];
      if (Math.abs(c[0] - me.pos.x) < 1 + HW && Math.abs(c[2] - me.pos.z) < 1 + HW && c[1] + 1 > me.pos.y && c[1] - 1 < me.pos.y + av.height) return;
      const cols = ['#ff4d4d', '#ffb02e', '#ffe14d', '#3ddc84', '#3b9bff', '#a66bff', '#ffffff', '#ff7ab6'];
      world.addPart({ t: 'block', k: 'normal', p: c, s: [2, 2, 2], c: cols[Math.random() * cols.length | 0], m: 'plastic', built: true });
      S.stats.built++; toolT = 0.0001; sfx.place();
      if (S.stats.built >= 50) award('builder');
    }
  }
  function explode(pos) {
    sfx.boom();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, toneMapped: false }));
    ball.position.copy(pos); scene.add(ball); fx.push({ m: ball, t: 0 });
    breakNear(pos, 6);
    const d = me.pos.clone().setY(me.pos.y + 2).sub(pos), l = d.length();
    if (l < 9 && !me.dead) { d.normalize(); me.vel.addScaledVector(d, 90 * (1 - l / 12)); me.vel.y = Math.max(me.vel.y, 55); me.grounded = false; if (me.vel.y > 40) award('boom'); }
  }
  function breakNear(pos, r) {
    world.meshes.slice().forEach(m => {
      const p = m.userData.part; if (!p?.built) return;
      if (m.position.distanceTo(pos) < r) {
        world.removeMesh(m);
        const deb = new THREE.Mesh(m.geometry, m.material); deb.position.copy(m.position); deb.scale.setScalar(0.5); scene.add(deb);
        fx.push({ m: deb, t: 0, v: m.position.clone().sub(pos).normalize().multiplyScalar(25).add(new THREE.Vector3(0, 20, 0)), deb: true });
      }
    });
  }

  // ── UI ──
  const toast = (t) => { const el = $('.g-toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200); };
  const log = (who, msg, sys) => { const d = document.createElement('div'); d.className = 'g-line' + (sys ? ' sys' : ''); if (!sys) { const b = document.createElement('b'); b.textContent = who + ': '; d.append(b); } d.append(msg); const l = $('.g-log'); l.append(d); l.scrollTop = 1e9; };
  function openChat(focus) { chatOpen = true; $('.g-chat').classList.remove('hidden'); if (focus) setTimeout(() => $('.g-input').focus(), 0); }
  function sendChat() {
    const v = $('.g-input').value.trim(); $('.g-input').value = '';
    if (!v) return;
    if (v.startsWith('/e ')) { const em = 'emote_' + v.slice(3).trim(); if (S.owned.includes(em)) playEmote(em); return; }
    log(name, v); bubble.userData.set(v.length > 24 ? v.slice(0, 24) + '…' : v); bubble.visible = true; bubbleT = 6;
  }
  $('.g-chat-btn').onclick = () => { chatOpen ? ($('.g-chat').classList.add('hidden'), chatOpen = false) : openChat(true); };
  log('', `[시스템] ${place.name} 에 오신 걸 환영해요! "/e dance" 처럼 감정 표현도 쓸 수 있어요.`, true);
  if (set.chat) openChat(false);

  const emList = S.owned.filter(id => id.startsWith('emote_'));
  $('.g-emotes').innerHTML = emList.map(id => `<button data-e="${id}">${ITEM[id].name}</button>`).join('') + '<button class="x">닫기</button>';
  function toggleEmotes(force) { $('.g-emotes').classList.toggle('hidden', force === undefined ? undefined : !force); }
  $('.g-emote-btn').onclick = () => toggleEmotes();
  $('.g-emotes').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.e) playEmote(b.dataset.e); toggleEmotes(false); };
  function playEmote(id) { if (tool) equipTool(tool); me.emote = id; me.emoteT = 0; award('dancer'); }

  function renderBoard() {
    const cols = [hasCoins && '코인', hasChecks && '단계'].filter(Boolean);
    $('.g-ph').innerHTML = `<span>사람들</span>${cols.map(c => `<b>${c}</b>`).join('')}`;
    $('.g-rows').innerHTML = `<div class="g-row"><span></span>${hasCoins ? `<b>${me.coins}</b>` : ''}${hasChecks ? `<b>${me.stage}</b>` : ''}</div>`;
    $('.g-rows span').textContent = name;
  }
  renderBoard();
  $('.g-board').onclick = () => $('.g-board').classList.toggle('min');

  function toggleMenu(force) {
    menuOpen = force ?? !menuOpen; $('.g-modal').classList.toggle('hidden', !menuOpen);
    keys.clear(); if (menuOpen) { renderMenu(); if (document.pointerLockElement) document.exitPointerLock(); }
  }
  $('.g-menu').onclick = () => toggleMenu(true);
  $('.g-resume').onclick = () => toggleMenu(false);
  $('.g-reset').onclick = () => resetChar();
  $('.g-leave').onclick = () => leave();
  $('.g-shot').onclick = () => shot();
  $('.g-tabs').onclick = e => {
    const t = e.target.closest('button')?.dataset.t; if (!t) return;
    host.querySelectorAll('.g-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    host.querySelectorAll('.g-tab').forEach(x => x.classList.toggle('hidden', !x.classList.contains('g-t-' + t)));
  };
  function renderMenu() {
    $('.g-t-people').innerHTML = `<div class="g-person"><img src="${window.KOBLOX_HEADSHOT || ''}" alt=""><div><b></b><small></small></div></div>`;
    $('.g-t-people b').textContent = name; $('.g-t-people small').textContent = '@' + (S.user?.username || 'player');
    $('.g-t-badges').innerHTML = `<div class="g-bgrid">${BADGES.map(b => `<div class="${S.badges[b.id] ? '' : 'off'}">${badgeSvg(b.color, 44)}<b>${b.name}</b><small>${b.desc}</small></div>`).join('')}</div>`;
    const T = $('.g-t-set'), lv = gfxLevel(set);
    T.innerHTML = `
      <label>그래픽 모드 <select data-k="gfxmode"><option value="auto">자동</option><option value="manual">수동</option></select></label>
      <label>그래픽 품질 <span class="g-lv">${'<i></i>'.repeat(10)}</span><input type="range" min="1" max="10" step="1" data-k="gfx" value="${lv}"></label>
      <label>카메라 감도 <input type="range" min="0.2" max="3" step="0.1" data-k="sensitivity"></label>
      <label>시야각 <input type="range" min="50" max="100" step="1" data-k="fov"></label>
      <label>음량 <input type="range" min="0" max="100" step="1" data-k="volume"></label>
      <label class="chk">카메라 Y축 반전 <input type="checkbox" data-k="invertY"></label>
      <label class="chk">이름표 표시 <input type="checkbox" data-k="nameTags"></label>
      <label class="chk">FPS 표시 <input type="checkbox" data-k="showFps"></label>
      <label class="chk">효과음 <input type="checkbox" data-k="sfx"></label>
      <label class="chk">전체 화면 <input type="checkbox" data-k="fullscreen"></label>`;
    const sel = T.querySelector('[data-k=gfxmode]'); sel.value = set.gfx === 'auto' ? 'auto' : 'manual';
    const paint = () => T.querySelectorAll('.g-lv i').forEach((i, n) => i.classList.toggle('on', n < gfxLevel(set)));
    paint();
    T.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      if (k === 'gfxmode') { el.onchange = () => { set.gfx = el.value === 'auto' ? 'auto' : gfxLevel(set); save(); applySettings(); renderMenu(); }; return; }
      if (k === 'fullscreen') { el.checked = !!document.fullscreenElement; el.onchange = () => { el.checked ? document.documentElement.requestFullscreen?.().catch(() => { }) : document.exitFullscreen?.(); }; return; }
      if (k === 'gfx') { el.disabled = set.gfx === 'auto'; el.oninput = () => { set.gfx = +el.value; save(); paint(); applySettings(); }; return; }
      if (el.type === 'checkbox') el.checked = !!set[k]; else el.value = set[k];
      el.oninput = () => { set[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value; save(); applySettings(); };
    });
  }
  function confirmBox(title, body, cb) {
    const c = $('.g-confirm'); c.querySelector('h3').textContent = title; c.querySelector('p').textContent = body; c.classList.remove('hidden');
    c.querySelector('.no').onclick = () => c.classList.add('hidden');
    c.querySelector('.yes').onclick = () => { c.classList.add('hidden'); cb(); };
  }
  function resetChar() { confirmBox('캐릭터를 재설정할까요?', '캐릭터가 부서지고 마지막 체크포인트에서 다시 나타나요.', () => { toggleMenu(false); die(); }); }
  function leave() { confirmBox(testMode ? '테스트를 끝낼까요?' : '게임을 나갈까요?', testMode ? '스튜디오로 돌아가요.' : '홈 화면으로 돌아가요.', () => { stopGame(); onExit?.(); }); }
  function shot() {
    tag.visible = bubble.visible = false; pipe.render();
    const url = canvas.toDataURL('image/png'); tag.visible = set.nameTags; sfx.shutter();
    const c = $('.g-confirm'); c.querySelector('h3').textContent = '캡처했어요'; c.querySelector('p').innerHTML = `<img class="g-shot-img" src="${url}" alt="캡처한 화면">이미지를 길게 누르거나 오른쪽 클릭해서 저장하세요.`;
    c.querySelector('.no').textContent = '닫기'; c.querySelector('.yes').textContent = '다운로드'; c.classList.remove('hidden');
    c.querySelector('.no').onclick = () => { c.classList.add('hidden'); c.querySelector('.no').textContent = '취소'; c.querySelector('.yes').textContent = '확인'; };
    c.querySelector('.yes').onclick = () => { const a = document.createElement('a'); a.download = `koblox-${Date.now()}.png`; a.href = url; a.click(); };
  }
  let badgeQ = [], badgeBusy = false;
  const showBadge = (id) => {
    const b = BADGES.find(x => x.id === id); if (!b) return;
    badgeQ.push(b); if (badgeBusy) return;
    const next = () => {
      const x = badgeQ.shift(); if (!x) { badgeBusy = false; return; }
      badgeBusy = true; const el = $('.g-badge');
      el.innerHTML = `${badgeSvg(x.color, 48)}<div><small>배지를 얻었어요!</small><b>${x.name}</b><p>${x.desc}</p></div>`;
      el.classList.add('on'); sfx.badge();
      setTimeout(() => { el.classList.remove('on'); setTimeout(next, 400); }, 3200);
    };
    next();
  };
  const unBadge = onBadge(showBadge);

  // ── 죽음/부활 ──
  const debris = [];
  function die() {
    if (me.dead) return;
    me.dead = true; sfx.die(); if (set.vibrate && navigator.vibrate) navigator.vibrate(120);
    S.stats.deaths++; if (S.stats.deaths >= 10) award('oops');
    if (tool) equipTool(tool);
    av.root.updateMatrixWorld(true);
    const parts = []; av.root.traverse(o => { if (o.isMesh && o.visible) parts.push(o); });
    parts.forEach(o => {
      const m = new THREE.Mesh(o.geometry, o.material); o.getWorldPosition(m.position); o.getWorldQuaternion(m.quaternion); o.getWorldScale(m.scale);
      m.castShadow = true; scene.add(m);
      debris.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 14 + 4, (Math.random() - 0.5) * 14), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    });
    av.root.visible = false; tag.visible = false; bubble.visible = false;
    setTimeout(respawn, 2200);
  }
  function respawn() {
    debris.forEach(d => scene.remove(d.m)); debris.length = 0;
    me.pos.copy(me.respawn); me.vel.set(0, 0, 0); me.dead = false; me.emote = null;
    av.root.visible = true; tag.visible = set.nameTags; cam.tYaw = me.yaw + Math.PI;
  }

  // ── 물리 ──
  function touch(c, fromTop) {
    const k = c.part?.k;
    if (k === 'kill') { die(); return; }
    if (k === 'jump' && fromTop) { me.vel.y = 120; me.grounded = false; sfx.jump(); return; }
    if (k === 'check' && fromTop && me.lastCheck !== c) {
      me.lastCheck = c; me.stage++; me.respawn.set((c.min.x + c.max.x) / 2, c.max.y + 0.05, (c.min.z + c.max.z) / 2);
      sfx.coin(); toast(`체크포인트 ${me.stage} 저장!`); renderBoard(); if (me.stage >= 5) award('finish');
    }
  }
  function collideAxis(axis, h) {
    const p = me.pos;
    for (const c of world.colliders) {
      if (p.x + HW <= c.min.x || p.x - HW >= c.max.x || p.z + HW <= c.min.z || p.z - HW >= c.max.z || p.y + h <= c.min.y || p.y >= c.max.y) continue;
      if (axis === 'y') {
        const down = me.vel.y <= 0;
        if (down) { p.y = c.max.y; me.grounded = true; } else p.y = c.min.y - h;
        me.vel.y = 0; touch(c, down);
      } else {
        const top = c.max.y - p.y;
        if (me.grounded && top > 0 && top <= 1.05 && c.part?.k !== 'kill') { p.y = c.max.y; continue; }
        if (axis === 'x') p.x = me.vel.x > 0 ? c.min.x - HW - 1e-4 : c.max.x + HW + 1e-4;
        else p.z = me.vel.z > 0 ? c.min.z - HW - 1e-4 : c.max.z + HW + 1e-4;
        touch(c, false);
      }
      if (me.dead) return;
    }
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
  let lowest = Math.min(0, ...place.parts.map(p => p.p[1] - p.s[1] / 2));
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
    const sp = SPEED * (tool === 'gear_speed' ? 2 : 1);
    // 땅에서는 바로, 공중에서는 천천히 원하는 속도로 (폭발에 밀린 속도가 잠깐 남는다)
    const k = me.grounded ? 1 : Math.min(1, dt * 6);
    me.vel.x += (mv.x * sp - me.vel.x) * k; me.vel.z += (mv.z * sp - me.vel.z) * k;
    if (shiftLock) me.yaw = cam.yaw + Math.PI;
    else if (l > 0.05) me.yaw = Math.atan2(mv.x, mv.z);
    if (l > 0.05 && me.emote) me.emote = null;
    const wantJump = (keys.has(' ') || jumpHeld) && !menuOpen;
    if (wantJump && me.grounded) {
      me.vel.y = JUMP * (tool === 'gear_gravity' ? 1.2 : 1); me.grounded = false; me.emote = null; sfx.jump();
      jumps++; S.stats.jumps++; if (S.stats.jumps >= 100) award('jumper');
    }
    me.vel.y -= GRAV * (tool === 'gear_gravity' ? 0.3 : 1) * dt;
    if (tool === 'gear_balloon' && me.vel.y < -9) me.vel.y = -9;
    const wasGround = me.grounded, h = av.height;
    me.pos.x += me.vel.x * dt; collideAxis('x', h); if (me.dead) return;
    me.pos.z += me.vel.z * dt; collideAxis('z', h); if (me.dead) return;
    me.grounded = false; me.pos.y += me.vel.y * dt; collideAxis('y', h);
    if (me.grounded && !wasGround) sfx.land();
    if (me.pos.y > 50) award('sky');
    if (me.pos.y < lowest - 80) die();
  }

  // ── 루프 ──
  const clock = new THREE.Clock(); let fpsAcc = 0, fpsN = 0, raf = 0, T = 0;
  const tgt = new THREE.Vector3(), camPos = new THREE.Vector3(), camRay = new THREE.Raycaster();
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 20); T += dt;
    for (let i = 0; i < 3; i++) physics(dt / 3);
    if (me.emote) me.emoteT += dt;
    if (toolT > 0) { toolT += dt; if (tool === 'gear_sword' && toolT > 0.1 && toolT < 0.2) breakNear(toolMesh.getWorldPosition(new THREE.Vector3()).addScaledVector(new THREE.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw)), 1.5), 3.5); if (toolT > 0.35) toolT = 0; }
    // 코인
    world.coins.forEach(c => {
      if (c.taken || me.dead) return;
      if (c.m.position.distanceTo(tgt.set(me.pos.x, me.pos.y + av.height / 2, me.pos.z)) < 2.2) {
        c.taken = T + 20; c.m.visible = false; me.coins++; S.stats.coins++; sfx.coin(); renderBoard(); award('coin');
      }
    });
    // 로켓
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]; r.life += dt; r.m.position.addScaledVector(r.dir, 70 * dt);
      const p = r.m.position;
      const hitCol = world.colliders.some(c => p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z);
      if (hitCol || r.life > 4) { explode(p.clone()); scene.remove(r.m); rockets.splice(i, 1); }
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt;
      if (f.deb) { f.v.y -= GRAV * 0.3 * dt; f.m.position.addScaledVector(f.v, dt); f.m.rotation.x += dt * 5; if (f.t > 1.5) { scene.remove(f.m); fx.splice(i, 1); } }
      else { f.m.scale.setScalar(1 + f.t * 25); f.m.material.opacity = Math.max(0, 0.9 - f.t * 2.4); if (f.t > 0.4) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); fx.splice(i, 1); } }
    }
    // 아바타
    av.root.position.copy(me.pos);
    let dy = me.yaw - av.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    av.root.rotation.y += dy * Math.min(1, dt * (shiftLock ? 30 : 14));
    const hs = Math.hypot(me.vel.x, me.vel.z);
    animateAvatar(av, dt, { speed: me.grounded ? hs : 0, air: !me.grounded, emote: me.emote, emoteT: me.emoteT, tool, toolT: tool === 'gear_sword' || tool === 'gear_rocket' ? toolT : 0 });
    tag.position.set(me.pos.x, me.pos.y + av.height + 0.9, me.pos.z);
    bubble.position.set(me.pos.x, me.pos.y + av.height + 2.2, me.pos.z);
    if (bubbleT > 0 && (bubbleT -= dt) <= 0) bubble.visible = false;
    debris.forEach(d => {
      d.v.y -= GRAV * 0.4 * dt; d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
      const p = d.m.position, c = world.colliders.find(c => p.x > c.min.x && p.x < c.max.x && p.z > c.min.z && p.z < c.max.z && p.y < c.max.y + 0.3 && p.y > c.min.y);
      if (c && d.v.y < 0) { p.y = c.max.y + 0.3; d.v.multiplyScalar(0.5); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.8); }
    });
    world.update(dt, T);
    // 카메라
    cam.yaw += (cam.tYaw - cam.yaw) * Math.min(1, dt * 18); cam.pitch += (cam.tPitch - cam.pitch) * Math.min(1, dt * 18);
    const focus = me.dead && debris[0] ? debris[0].m.position : me.pos;
    tgt.set(focus.x, (me.dead ? focus.y : me.pos.y) + av.height * 0.82, focus.z);
    if (shiftLock && !me.dead) tgt.addScaledVector(new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)), 1.75);
    const first = cam.dist < 1.2;
    av.root.visible = !me.dead && !first; tag.visible = set.nameTags && !me.dead && !first;
    const cd = Math.cos(cam.pitch);
    camPos.set(Math.sin(cam.yaw) * cd, Math.sin(cam.pitch), Math.cos(cam.yaw) * cd);
    let dist = cam.dist;
    if (prof.lv >= 3 && !first) { camRay.set(tgt, camPos); camRay.far = cam.dist; const h = camRay.intersectObjects(world.meshes, false)[0]; if (h && h.object.userData.part?.m !== 'glass') dist = Math.max(0.6, h.distance - 0.4); }
    camera.position.copy(tgt).addScaledVector(camPos, dist);
    camera.lookAt(tgt);
    if (first) me.yaw = cam.yaw + Math.PI;
    world.follow(me.pos);
    pipe.render();
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('.g-fps').textContent = `${Math.round(fpsN / fpsAcc)} FPS · 그래픽 ${prof.lv}`; fpsAcc = fpsN = 0; }
  }
  addEventListener('resize', resize);
  applySettings(); frame();
  toast(`${place.name} 에 접속했어요`);
  if (place.id === 'test') setTimeout(() => award('welcome'), 800);

  G = {
    stop() {
      cancelAnimationFrame(raf); removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
      document.removeEventListener('pointerlockchange', onLockChange); if (document.pointerLockElement) document.exitPointerLock();
      unBadge?.(); save();
      disposeAvatar(av); world.dispose(); pipe.dispose(); renderer.dispose(); host.innerHTML = '';
    },
  };
}

export function stopGame() { if (G) { G.stop(); G = null; } }
