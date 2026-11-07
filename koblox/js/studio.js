// 코블록스 스튜디오 — 블록을 놓아 나만의 체험을 만든다
import * as THREE from 'three';
import { buildWorld, SKIES, KINDS, SHAPES } from './world.js';
import { makeRenderer, makePipeline, gfxLevel, gfxProfile, MATERIALS } from './gfx.js';
import { S, save } from './store.js';
import { sfx } from './audio.js';
import { ico } from './icons.js';

const COLORS = ['#f2f3f5', '#a3a6ad', '#5d626b', '#1f2126', '#ff4d4d', '#ff8a3d', '#ffd23f', '#9be15d', '#3ddc84', '#2bc4c4', '#3b9bff', '#2f5bd8', '#a66bff', '#ff6bd5', '#8b5a2b', '#ffcc33'];
const DEF_SIZE = { normal: [4, 1, 4], spawn: [6, 1, 6], check: [4, 0.4, 4], kill: [4, 0.4, 4], jump: [4, 1, 4], coin: [1.6, 1.6, 0.3] };
const KIND_COLOR = { spawn: '#5d626b', check: '#22c55e', kill: '#ff4a1a', jump: '#ffd400', coin: '#ffcc33' };
const KIND_MAT = { check: 'neon', kill: 'neon', coin: 'metal' };
let ST = null;

export function openStudio(host, place, { onExit, onTest, onPublish }) {
  if (ST) ST.stop();
  host.innerHTML = `
  <canvas class="st-canvas"></canvas>
  <header class="st-top">
    <button class="st-ib" data-s="exit" title="나가기">${ico('back')}</button>
    <input class="st-name" maxlength="30">
    <span class="sp"></span>
    <button class="st-ib" data-s="undo" title="실행 취소 (Ctrl+Z)">${ico('undo')}</button>
    <button class="st-ib" data-s="redo" title="다시 실행 (Ctrl+Y)">${ico('redo')}</button>
    <button class="st-ib" data-s="world" title="월드 설정">${ico('globe')}</button>
    <button class="st-btn" data-s="test">${ico('play')}<span>테스트</span></button>
    <button class="st-btn primary" data-s="publish">${ico('upload')}<span>게시</span></button>
  </header>
  <div class="st-tools">
    <button data-tool="add" title="추가 (1)">${ico('cube')}<small>추가</small></button>
    <button data-tool="del" title="삭제 (2)">${ico('eraser')}<small>삭제</small></button>
    <button data-tool="paint" title="칠하기 (3)">${ico('brush')}<small>칠하기</small></button>
    <button data-tool="pick" title="스포이드 (4)">${ico('pick')}<small>스포이드</small></button>
    <button data-tool="rot" title="돌리기 (5)">${ico('redo')}<small>돌리기</small></button>
  </div>
  <div class="st-count"></div>
  <div class="st-panel">
    <button class="st-fold">${ico('chev')}</button>
    <div class="st-row"><b>모양</b><div class="st-chips" data-g="shape">${SHAPES.map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</div></div>
    <div class="st-row"><b>종류</b><div class="st-chips" data-g="kind">${KINDS.map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</div></div>
    <div class="st-row"><b>색</b><div class="st-colors">${COLORS.map(c => `<button data-c="${c}" style="background:${c}"></button>`).join('')}<label class="st-custom">${ico('plus')}<input type="color"></label></div></div>
    <div class="st-row"><b>재질</b><div class="st-chips" data-g="mat">${MATERIALS.map(([k, n]) => `<button data-v="${k}">${n}</button>`).join('')}</div></div>
    <div class="st-row"><b>크기</b><div class="st-size">${['가로', '높이', '세로'].map((n, i) => `<span>${n}<button data-sz="${i}" data-d="-1">${ico('minus')}</button><i></i><button data-sz="${i}" data-d="1">${ico('plus')}</button></span>`).join('')}</div></div>
  </div>
  <div class="st-toast"></div>
  <div class="st-modal hidden"></div>`;
  const $ = s => host.querySelector(s), $$ = s => [...host.querySelectorAll(s)];
  const canvas = $('.st-canvas');
  const prof = gfxProfile(Math.min(gfxLevel(S.settings), 7));
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
  let world = buildWorld(scene, place, prof, renderer);
  let pipe = makePipeline(renderer, scene, camera, prof);
  const grid = new THREE.GridHelper(512, 128, 0x000000, 0x000000); grid.material.opacity = 0.08; grid.material.transparent = true; grid.position.y = 0.01; scene.add(grid);
  grid.visible = place.baseplate;

  const B = { tool: 'add', shape: 'block', kind: 'normal', color: '#3b9bff', mat: 'plastic', size: [4, 1, 4], rot: 0 };
  const undo = [], redo = [];
  const snap = () => { undo.push(JSON.stringify(place.parts)); if (undo.length > 60) undo.shift(); redo.length = 0; };
  let saveT = 0; const store = () => { place.updated = Date.now(); clearTimeout(saveT); saveT = setTimeout(save, 300); };
  const toast = t => { const el = $('.st-toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 1800); };

  $('.st-name').value = place.name;
  $('.st-name').oninput = e => { place.name = e.target.value || '이름 없는 체험'; store(); };

  function rebuild() {
    world.dispose(); world = buildWorld(scene, place, prof, renderer); grid.visible = place.baseplate; count();
  }
  const count = () => { $('.st-count').textContent = `파트 ${place.parts.length}개`; };
  function syncUI() {
    $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === B.tool));
    $$('[data-g=shape] button').forEach(b => b.classList.toggle('on', b.dataset.v === B.shape));
    $$('[data-g=kind] button').forEach(b => b.classList.toggle('on', b.dataset.v === B.kind));
    $$('[data-g=mat] button').forEach(b => b.classList.toggle('on', b.dataset.v === B.mat));
    $$('.st-colors [data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === B.color));
    $$('.st-size i').forEach((i, n) => i.textContent = B.size[n]);
    updateGhost();
  }
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) { B.tool = b.dataset.tool; sfx.click(); }
    const g = b.parentElement.dataset.g;
    if (g === 'shape') B.shape = b.dataset.v;
    if (g === 'kind') { B.kind = b.dataset.v; B.size = [...DEF_SIZE[B.kind]]; if (KIND_COLOR[B.kind]) B.color = KIND_COLOR[B.kind]; B.mat = KIND_MAT[B.kind] || 'plastic'; if (B.kind !== 'normal') B.shape = 'block'; }
    if (g === 'mat') B.mat = b.dataset.v;
    if (b.dataset.c) B.color = b.dataset.c;
    if (b.dataset.sz) { const i = +b.dataset.sz, v = B.size[i], st = v < 1 || (v === 1 && +b.dataset.d < 0) ? 0.2 : 1; B.size[i] = Math.round(THREE.MathUtils.clamp(v + st * +b.dataset.d, 0.2, 64) * 10) / 10; }
    if (b.classList.contains('st-fold')) $('.st-panel').classList.toggle('min');
    switch (b.dataset.s) {
      case 'exit': save(); stop(); onExit?.(); return;
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'world': worldModal(); break;
      case 'test': save(); pause(); onTest?.(place, resume); return;
      case 'publish': publishModal(); break;
    }
    syncUI();
  });
  $('.st-custom input').oninput = e => { B.color = e.target.value; syncUI(); };
  function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(place.parts)); place.parts = JSON.parse(undo.pop()); rebuild(); store(); sfx.click(); }
  function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(place.parts)); place.parts = JSON.parse(redo.pop()); rebuild(); store(); sfx.click(); }

  function modal(html, onOk) {
    const m = $('.st-modal'); m.innerHTML = `<div class="st-mbox">${html}<div class="row"><button class="g-act" data-m="no">닫기</button>${onOk ? '<button class="g-act primary" data-m="ok">확인</button>' : ''}</div></div>`;
    m.classList.remove('hidden');
    m.onclick = e => { const k = e.target.dataset.m; if (!k) return; if (k === 'ok') onOk?.(m); m.classList.add('hidden'); };
  }
  function worldModal() {
    modal(`<h3>월드 설정</h3>
      <label>하늘 <select class="w-sky">${Object.entries(SKIES).map(([k, v]) => `<option value="${k}" ${place.sky === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <label class="chk">회색 바닥판 <input type="checkbox" class="w-base" ${place.baseplate ? 'checked' : ''}></label>
      <label>설명 <textarea class="w-desc" maxlength="300" placeholder="체험을 소개해 보세요"></textarea></label>
      <button class="g-act danger w-clear">${ico('trash')} 모든 파트 지우기</button>`, m => {
      place.sky = m.querySelector('.w-sky').value; place.baseplate = m.querySelector('.w-base').checked; place.desc = m.querySelector('.w-desc').value;
      rebuild(); store();
    });
    const m = $('.st-modal'); m.querySelector('.w-desc').value = place.desc || '';
    m.querySelector('.w-clear').onclick = () => { snap(); place.parts = place.parts.filter(p => p.k === 'spawn'); rebuild(); store(); toast('스폰만 남기고 지웠어요'); };
  }
  function publishModal() {
    modal(`<h3>${place.published ? '체험 업데이트' : '체험 게시'}</h3><p>게시하면 홈 화면의 “내가 만든 체험”에 나타나고 누구나(이 기기에서) 플레이할 수 있어요.</p>
      ${place.parts.some(p => p.k === 'spawn') ? '' : '<p class="warn">스폰이 없어요. 스폰을 놓으면 그 위에서 시작해요.</p>'}`, () => {
      place.published = true; place.updated = Date.now(); save(); onPublish?.(place); toast('게시했어요!');
    });
  }

  // ── 카메라 ──
  const cam = { tgt: new THREE.Vector3(0, place.parts[0]?.p[1] || 0, 0), yaw: 0.6, pitch: 0.6, dist: 40 };
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setPixelRatio(prof.pixelRatio); renderer.setSize(w, h, false); pipe.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);
  const pts = new Map(); let downInfo = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), n: pts.size }; });
  canvas.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    if (!p) { hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (pts.size === 2) {
      const [a, b] = [...pts.entries()], o = a[0] === e.pointerId ? b[1] : a[1];
      const d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      cam.dist = THREE.MathUtils.clamp(cam.dist * d0 / Math.max(d1, 1), 4, 400);
      pan(dx / 2, dy / 2);
    } else if (p.b === 2 || e.shiftKey) pan(dx, dy);
    else { cam.yaw -= dx * 0.008; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.008, -1.4, 1.5); }
    p.x = e.clientX; p.y = e.clientY;
  });
  const upH = e => {
    if (downInfo && downInfo.n === 1 && pts.size === 1 && Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) < 8 && performance.now() - downInfo.t < 400) act(e);
    pts.delete(e.pointerId); if (!pts.size) downInfo = null;
  };
  canvas.addEventListener('pointerup', upH); canvas.addEventListener('pointercancel', e => pts.delete(e.pointerId));
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 4, 400); }, { passive: false });
  function pan(dx, dy) {
    const k = cam.dist * 0.0025;
    const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)), fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    cam.tgt.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
  }
  const keys = new Set();
  const kd = e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
    const tools = ['add', 'del', 'paint', 'pick', 'rot']; if (/^[1-5]$/.test(k)) { B.tool = tools[+k - 1]; syncUI(); return; }
    keys.add(k);
  };
  const ku = e => keys.delete(e.key.toLowerCase());
  addEventListener('keydown', kd); addEventListener('keyup', ku);

  // ── 클릭/탭으로 편집 ──
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [...world.meshes, ...world.coins.map(c => c.m)];
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) return hit;
    if (!place.baseplate) { const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()); if (p) return { point: p, face: { normal: new THREE.Vector3(0, 1, 0) }, object: null }; }
    return null;
  }
  function placePos(hit) {
    const n = hit.face.normal.clone(); if (hit.object) n.transformDirection(hit.object.matrixWorld);
    const ax = Math.abs(n.x) > 0.5 ? 0 : Math.abs(n.y) > 0.5 ? 1 : 2;
    const s = B.rot % 2 ? [B.size[2], B.size[1], B.size[0]] : B.size;
    const c = hit.point.clone().addScaledVector(n, s[ax] / 2 + 0.001);
    const out = [c.x, c.y, c.z].map((v, i) => i === ax ? Math.round((v) * 10) / 10 : Math.round(v - s[i] / 2) + s[i] / 2);
    return { p: out, s };
  }
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x3b9bff, transparent: true, opacity: 0.35, depthWrite: false }));
  ghost.visible = false; scene.add(ghost);
  const hl = new THREE.Box3Helper(new THREE.Box3(), 0xffd400); hl.visible = false; scene.add(hl);
  let lastHover = null;
  function updateGhost() { ghost.material.color.set(B.color); if (lastHover) hover(lastHover); }
  function hover(e) {
    lastHover = e; ghost.visible = hl.visible = false;
    if (e.pointerType === 'touch') return;
    const hit = pick(e); if (!hit) return;
    if (B.tool === 'add') { const { p, s } = placePos(hit); ghost.position.set(...p); ghost.scale.set(...s); ghost.visible = true; }
    else if (hit.object) { hl.box.setFromObject(hit.object); hl.visible = true; }
  }
  function act(e) {
    const hit = pick(e); if (!hit) return;
    const part = hit.object?.userData.part;
    if (B.tool === 'add') {
      if (place.parts.length >= 3000) { toast('파트는 3000개까지 놓을 수 있어요'); return; }
      const { p, s } = placePos(hit);
      snap();
      const np = { t: B.shape, k: B.kind, p, s: [...s], c: B.color, m: B.mat };
      place.parts.push(np); world.addPart(np); sfx.place();
    } else if (!part || part.k === 'base') { return; }
    else if (B.tool === 'del') {
      snap(); place.parts.splice(place.parts.indexOf(part), 1);
      if (part.k === 'coin') rebuild(); else world.removeMesh(hit.object); sfx.remove();
    } else if (B.tool === 'paint') {
      snap(); part.c = B.color; if (part.k === 'normal') part.m = B.mat; rebuild(); sfx.place();
    } else if (B.tool === 'pick') {
      Object.assign(B, { shape: part.t, kind: part.k, color: part.c, mat: part.m, size: [...part.s] }); B.tool = 'add'; toast('이 파트를 복사했어요');
    } else if (B.tool === 'rot') {
      snap(); part.s = [part.s[2], part.s[1], part.s[0]]; rebuild(); sfx.place();
    }
    count(); store(); syncUI();
    if (lastHover) hover(lastHover);
  }

  // ── 루프 ──
  const clock = new THREE.Clock(); let raf = 0, running = true, T = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05); T += dt;
    const mv = new THREE.Vector3((keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0), (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0));
    if (mv.lengthSq()) { mv.applyAxisAngle(new THREE.Vector3(0, 1, 0), cam.yaw).multiplyScalar(dt * Math.max(20, cam.dist)); cam.tgt.add(mv); }
    const cd = Math.cos(cam.pitch) * cam.dist;
    camera.position.set(cam.tgt.x + Math.sin(cam.yaw) * cd, cam.tgt.y + Math.sin(cam.pitch) * cam.dist, cam.tgt.z + Math.cos(cam.yaw) * cd);
    camera.lookAt(cam.tgt);
    world.follow(cam.tgt); world.update(dt, T);
    pipe.render();
  }
  function pause() { running = false; cancelAnimationFrame(raf); }
  function resume() { if (running) return; running = true; clock.getDelta(); rebuild(); resize(); frame(); }
  function stop() {
    pause(); removeEventListener('resize', resize); removeEventListener('keydown', kd); removeEventListener('keyup', ku);
    world.dispose(); pipe.dispose(); renderer.dispose(); host.innerHTML = ''; ST = null;
  }
  ST = { stop };
  count(); syncUI(); resize(); frame();
  toast('화면을 눌러 블록을 놓아 보세요');
}
