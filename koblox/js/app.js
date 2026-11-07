// KOBLOX 앱 — 인트로, 가입, 홈/차트/아바타, 상점, 설정, 알림, 검색, 게임 참가
import * as THREE from 'three';
import { ITEMS, ITEM, CATS, OPTIONAL, DEFAULT_EQUIP, creatorOf, BADGES } from './items.js';
import { S, save, onChange, resetAll, owns, priceOf, DEFAULT_SETTINGS, award, onBadge } from './store.js';
import { buildAvatar, animateAvatar, disposeAvatar } from './avatar.js';
import { itemThumb, avatarShot, gameThumb, placeThumb } from './thumbs.js';
import { ico, KB, VER, badgeSvg } from './icons.js';
import { TEST_PLACE, TEMPLATES } from './world.js';
import { openStudio } from './studio.js';
import { makeRenderer, envFromSky } from './gfx.js';
import { startGame, stopGame } from './game.js';
import { sfx, unlockAudio } from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('ko-KR');

// ── 아이콘 ──
// ── 체험 목록 (지금은 Test 하나) ──
const TEST_GAME = { id: 'test', name: 'Test', creator: 'Koblox', genre: '샌드박스', created: '2026-11-07', updated: '2026-11-07', max: 1,
  desc: '파란 하늘과 회색 바닥이 있는 첫 번째 테스트 공간이에요.\n돌아다니고, 점프하고, 장비와 감정 표현, 채팅을 써 보세요!' };
const allGames = () => [TEST_GAME, ...S.places.filter(p => p.published).map(p => ({ id: p.id, name: p.name, creator: S.user?.username || 'me', genre: '사용자 제작', created: new Date(p.created).toLocaleDateString('ko-KR'), updated: new Date(p.updated).toLocaleDateString('ko-KR'), max: 1, desc: p.desc || '스튜디오에서 만든 체험이에요.', mine: true }))];
const gameById = id => allGames().find(g => g.id === id);
const placeById = id => id === 'test' ? TEST_PLACE : S.places.find(p => p.id === id);
const thumbs = {};
const gthumb = id => { if (id === 'test') return thumbs.test || ''; const p = S.places.find(p => p.id === id); return p ? placeThumb(p) : ''; };
const rating = id => (S.likes[id] === -1 ? 0 : 100);

// ── 공통 UI ──
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 2200); }
function modal({ title, body = '', ok = '확인', cancel = '취소', onOk, html = '', danger = false }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="mdl-bg"><div class="mdl"><h3>${title}</h3>${body ? `<p>${body}</p>` : ''}${html}<div class="mdl-row">${cancel ? `<button class="btn" data-m="no">${cancel}</button>` : ''}<button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${ok}</button></div></div></div>`;
  root.onclick = e => { const m = e.target.dataset.m; if (!m && !e.target.classList.contains('mdl-bg')) return; root.innerHTML = ''; if (m === 'ok') onOk?.(root); };
}
function showScreen(id) { $$('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
function applyTheme() {
  const t = S.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  document.documentElement.style.setProperty('--accent', S.plus && S.settings.accent ? S.settings.accent : '');
  document.documentElement.classList.toggle('calm', !!S.settings.reduceMotion);
}
const headerHTML = (title) => `<header class="hdr">
  <button class="ib" data-act="drawer">${ico('menu')}<i class="dot ${S.notifs.length ? '' : 'hide'}"></i></button>
  ${title ? `<h1>${title}</h1>` : `<div class="logo"><span class="k-mark">K</span>KOBLOX</div>`}
  <div class="sp"></div>
  <button class="ib" data-act="search">${ico('search')}</button>
  <button class="ib" data-act="store">${KB}</button>
  <button class="ib" data-act="notifs">${ico('bell')}<i class="badge ${S.notifs.length ? '' : 'hide'}">${S.notifs.length}</i></button>
</header>`;
const myName = () => S.user?.displayName || S.user?.username || '';
let HEAD = '';
const headImg = (cls = '') => `<img class="my-head ${cls}" src="${HEAD}" alt="">`;
function gameCard(g, kind = 'wide') {
  return `<div class="gcard ${kind}" data-act="game" data-id="${g.id}"><div class="gthumb"><img src="${gthumb(g.id)}" alt=""></div>
    <b>${esc(g.name)}</b><span class="meta">${ico('thumb')} ${kind === 'wide' ? '평가 ' : ''}${rating(g.id)}%${kind === 'wide' ? '' : ` &nbsp;${ico('people')} 0`}</span></div>`;
}

// ── 오버레이 (뒤로가기 지원) ──
const stack = []; let skipPop = 0;
// 뒤로가기 버튼 지원 (막혀 있는 환경에서는 조용히 건너뛴다)
const hist = { ok: true, push() { try { history.pushState({ k: 1 }, ''); } catch { this.ok = false; } }, back() { if (this.ok) { skipPop++; try { history.back(); } catch { skipPop--; } } } };
function openOv(html, cls = '', render) {
  const el = document.createElement('div'); el.className = 'ov ' + cls;
  el._render = render; el.innerHTML = render ? render() : html;
  $('#overlays').append(el); stack.push(el); requestAnimationFrame(() => el.classList.add('in'));
  hist.push();
  return el;
}
function closeOv(fromPop) {
  const el = stack.pop(); if (!el) return;
  el.classList.remove('in'); setTimeout(() => el.remove(), 260); el._onClose?.();
  if (!fromPop) hist.back();
}
function closeAll() { while (stack.length) { const el = stack.pop(); el._onClose?.(); el.remove(); } closeDrawer(); }
addEventListener('popstate', () => {
  if (skipPop) { skipPop--; return; }
  if ($('#modal-root').innerHTML) { $('#modal-root').innerHTML = ''; return; }
  if (drawerOpen) closeDrawer(); else if (stack.length) closeOv(true);
});
const ovHead = (title, right = '') => `<header class="hdr ovh"><button class="ib" data-act="back">${ico('back')}</button><h1>${title}</h1><div class="sp"></div>${right}</header>`;
function rerenderOverlays() { stack.forEach(el => { if (el._render) { const sc = el.querySelector('.scroll')?.scrollTop; el.innerHTML = el._render(); const s2 = el.querySelector('.scroll'); if (s2 && sc) s2.scrollTop = sc; fillThumbs(el); } }); }

// ── 썸네일 큐 ──
const tq = []; let tqOn = false; const shotCache = new Map();
function fillThumbs(root) {
  $$('img[data-thumb]', root).forEach(img => { if (!img.src) tq.push(img); });
  if (!tqOn) { tqOn = true; requestAnimationFrame(runTq); }
}
function runTq() {
  const t0 = performance.now();
  while (tq.length && performance.now() - t0 < 12) {
    const img = tq.shift(); if (!img.isConnected) continue;
    const id = img.dataset.thumb;
    if (id.startsWith('outfit:')) { const o = S.outfits[+id.slice(7)]; if (o) { const k = JSON.stringify(o.equip); if (!shotCache.has(k)) shotCache.set(k, avatarShot(o.equip)); img.src = shotCache.get(k); } }
    else if (ITEM[id]) img.src = itemThumb(ITEM[id]);
  }
  if (tq.length) requestAnimationFrame(runTq); else tqOn = false;
}

// ── 인트로 ──
function intro() {
  showScreen('intro');
  const tips = ['블록을 쌓는 중…', '하늘을 파랗게 칠하는 중…', '바닥을 까는 중…', '아바타를 깨우는 중…', '거의 다 됐어요!'];
  const bar = $('.intro-bar i'), tip = $('.intro-tip');
  let p = 0, done = false;
  const finish = () => {
    if (done) return; done = true;
    $('#intro').classList.add('out');
    setTimeout(() => { $('#intro').classList.remove('out'); S.user ? enterApp() : showScreen('signup'); }, 500);
  };
  $('#intro').onclick = () => { unlockAudio(); finish(); };
  setTimeout(() => sfx.intro(), 400);
  const iv = setInterval(() => {
    p = Math.min(100, p + 3 + Math.random() * 6); bar.style.width = p + '%';
    tip.textContent = tips[Math.min(tips.length - 1, p / 22 | 0)];
    if (p >= 100) { clearInterval(iv); setTimeout(finish, 350); }
  }, 90);
}

// ── 가입 ──
function setupSignup() {
  $('#su-go').onclick = () => {
    const u = $('#su-name').value.trim(), d = $('#su-display').value.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) { $('#su-err').textContent = '사용자 이름은 영문, 숫자, _ 로 3~20자여야 해요.'; return; }
    S.user = { username: u, displayName: d || u, about: '', joined: Date.now() };
    save(); sfx.buy(); enterApp();
  };
  $('#su-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#su-go').click(); });
}

// ── 메인 ──
let curTab = 'home', homeChip = 'rec', inited = false;
function enterApp() {
  showScreen('app');
  if (!inited) {
    inited = true;
    thumbs.test = gameThumb(S.equip);
    updateHead();
    initPreview();
  }
  renderAll(); setTab(curTab);
}
function setTab(t) {
  curTab = t;
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'p-' + t));
  if (t === 'me') { resizePreview(); fillThumbs($('#p-me')); }
}
function renderAll() {
  renderHome(); renderCharts(); renderMe(); renderDrawer();
  $$('[data-ico]').forEach(i => { i.outerHTML = ico(i.dataset.ico); });
  $$('.tab-head').forEach(i => i.src = HEAD);
}

function renderHome() {
  const hist = S.history.map(id => gameById(id)).filter(Boolean);
  const list = homeChip === 'rec' ? allGames() : hist;
  $('#p-home').innerHTML = headerHTML() + `<div class="scroll">
    <div class="prof-row" data-act="profile">${headImg('av-c')}<b>${esc(myName())}</b>${S.plus ? '<span class="plus-tag">PLUS</span>' : ''}</div>
    <h2 class="sec">이런 건 어떠세요</h2>
    <div class="grid2">${allGames().map(g => gameCard(g)).join('')}</div>
    <div class="create-card" data-act="create">${ico('cube')}<div><b>나만의 체험 만들기</b><small>코블록스 스튜디오에서 블록을 쌓아 게임을 만들어요</small></div>${ico('chev')}</div>
    <h2 class="sec link" data-act="continue">계속 참가하기 ${ico('chev')}</h2>
    <div class="chips"><button class="chip ${homeChip === 'rec' ? 'on' : ''}" data-act="homechip" data-v="rec">추천</button><button class="chip ${homeChip === 'last' ? 'on' : ''}" data-act="homechip" data-v="last">마지막 플레이</button></div>
    <div class="hrow">${list.length ? list.map(g => gameCard(g, 'sq')).join('') : '<p class="empty">아직 플레이한 체험이 없어요.</p>'}</div>
    <div class="pad-b"></div></div>`;
}

function renderCharts() {
  const row = (t) => `<h2 class="sec link">${t} ${ico('chev')}<span class="sp"></span><button class="ib sm" data-act="chartinfo">${ico('info')}</button></h2><div class="hrow">${allGames().map(g => gameCard(g, 'sq')).join('')}</div>`;
  $('#p-charts').innerHTML = headerHTML('차트') + `<div class="scroll">
    <div class="chips"><label class="chip sel"><select><option>표준 휴대폰</option><option>태블릿</option><option>컴퓨터</option><option>콘솔</option></select>${ico('chev')}</label>
    <label class="chip sel"><select><option>대한민국</option><option>전 세계</option></select>${ico('chev')}</label></div>
    ${row('톱 트렌드')}${row('새롭게 떠오르는 체험')}${row('인기 급상승')}${row('최고 평점')}<div class="pad-b"></div></div>`;
}

// ── 드로어 ──
let drawerOpen = false;
function renderDrawer() {
  const item = (act, ic, t, extra = '') => `<button class="dr-item" data-act="${act}">${ic}<span>${t}</span>${extra}</button>`;
  $('#drawer').innerHTML = `<div class="dr-prof" data-act="profile">${headImg('av-c lg')}<div><b>${esc(myName())}</b><small>@${esc(S.user?.username)}</small></div></div>
    <div class="dr-kb"><div class="row">${KB}<b class="kb-count">${fmt(S.kobux)}</b><span class="sp"></span><button class="btn sm" data-act="store">코벅스 받기</button></div>
    <div class="row link" data-act="plus">${KB}<span>${S.plus ? '코블록스 플러스 구독 중이에요. 혜택을 확인해 보세요.' : '코블록스 플러스 구독으로 더 큰 즐거움을 누리세요.'}</span>${ico('chev')}</div></div>
    ${item('favorites', ico('bookmark'), '즐겨찾기')}${item('continue', ico('history'), '계속 플레이')}${item('inventory', ico('bag'), '인벤토리')}
    ${item('plus', KB, '코블록스 플러스')}${item('store', ico('star'), '코벅스 받기')}${item('settings', ico('gear'), '설정')}${item('help', ico('help'), '도움말')}
    <hr>${item('create', ico('build'), '만들기')}
    <button class="btn wide" data-act="replay-intro">인트로 다시 보기</button>
    <button class="btn wide" data-act="logout">로그아웃</button>`;
}
function openDrawer() { drawerOpen = true; $('#drawer-wrap').classList.add('on'); hist.push(); }
function closeDrawer(viaUi) { if (!drawerOpen) return; drawerOpen = false; $('#drawer-wrap').classList.remove('on'); if (viaUi) hist.back(); }

// ── 아바타 미리보기 (3D) ──
const PV = { r: null, scene: null, cam: null, av: null, key: '', yaw: 0.3, tryOn: null, emote: null, emoteT: 0 };
function initPreview() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b2c31);
  scene.fog = new THREE.Fog(0x2b2c31, 25, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55555f, 0.7));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(4, 10, 8); d.castShadow = true; d.shadow.mapSize.set(1024, 1024); scene.add(d);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshLambertMaterial({ color: 0x45464d })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const bm = new THREE.MeshLambertMaterial({ color: 0x55565e });
  [[-12, -14, 5, 9], [-7, -20, 6, 14], [9, -16, 6, 11], [15, -11, 4, 7], [3, -24, 7, 16], [-17, -6, 4, 6], [19, -4, 3, 5]].forEach(([x, z, w, h]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bm); b.position.set(x, h / 2, z); scene.add(b);
  });
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  Object.assign(PV, { scene, cam });
  PV.canvas = document.createElement('canvas'); PV.canvas.id = 'me-canvas';
  PV.r = makeRenderer(PV.canvas);
  scene.environment = envFromSky(PV.r, { top: '#5a6070', hor: '#c9ced8', bot: '#3a3c44', sun: [0.3, 0.8, 0.5] });
  let drag = null;
  PV.canvas.addEventListener('pointerdown', e => { drag = e.clientX; PV.canvas.setPointerCapture(e.pointerId); });
  PV.canvas.addEventListener('pointermove', e => { if (drag !== null) { PV.yaw += (e.clientX - drag) * 0.012; drag = e.clientX; } });
  PV.canvas.addEventListener('pointerup', () => drag = null);
  const clock = new THREE.Clock();
  const loop = () => {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (curTab !== 'me' || !$('#app').classList.contains('active') || !PV.canvas.isConnected) return;
    const eq = PV.tryOn ? { ...S.equip, ...PV.tryOn } : S.equip, k = JSON.stringify(eq) + JSON.stringify(S.scales);
    if (k !== PV.key) {
      PV.key = k; if (PV.av) { scene.remove(PV.av.root); disposeAvatar(PV.av); }
      PV.av = buildAvatar(eq, S.scales); scene.add(PV.av.root);
    }
    if (PV.emote) { PV.emoteT += dt; if (PV.emoteT > 3.2) PV.emote = null; }
    PV.av.root.rotation.y = PV.yaw;
    animateAvatar(PV.av, dt, { emote: PV.emote, emoteT: PV.emoteT });
    const H = Math.max(PV.av.height, 4.5);
    cam.position.set(0, H * 0.74, H * 3.1 + 2); cam.lookAt(0, H * 0.66, 0);
    PV.r.render(scene, cam);
  };
  loop();
}
function resizePreview() {
  if (!PV.r || !PV.canvas.isConnected) return;
  const w = PV.canvas.parentElement.clientWidth, h = PV.canvas.parentElement.clientHeight;
  PV.r.setPixelRatio(Math.min(devicePixelRatio, 2)); PV.r.setSize(w, h, false); PV.cam.aspect = w / h; PV.cam.updateProjectionMatrix();
}
addEventListener('resize', resizePreview);

// ── 아바타 페이지 (마켓플레이스 / 꾸미기) ──
const ME = { mode: 'custom', cat: 'body', sub: 'skin', mcat: 'all', msub: null, sort: 'rec' };
const undoS = [], redoS = [];
function renderMe() {
  const p = $('#p-me');
  if (!p.querySelector('.me-view')) {
    p.innerHTML = `<div class="me-view"><div class="me-top"><button class="ib" data-act="drawer">${ico('menu')}<i class="dot ${S.notifs.length ? '' : 'hide'}"></i></button>
      <div class="seg"><button data-act="memode" data-v="market">마켓플레이스</button><button data-act="memode" data-v="custom">꾸미기</button></div>
      <button class="pill" data-act="store">${KB}<span class="kb-count">${fmt(S.kobux)}</span></button></div>
      <div class="me-side">${headImg('av-c')}<button class="ib sm" data-act="me-body" title="신체 크기">${ico('body')}</button></div>
      <div class="me-undo"><button class="ib sm" data-act="undo">${ico('undo')}</button><button class="ib sm" data-act="redo">${ico('redo')}</button></div>
      <div class="me-hint">드래그해서 돌려 보세요</div></div>
      <div class="me-sheet"><div class="grab"></div><div class="me-tabs"></div><div class="me-subs"></div><div class="me-grid scroll"></div></div>`;
    p.querySelector('.me-view').prepend(PV.canvas);
  }
  $$('.seg button', p).forEach(b => b.classList.toggle('on', b.dataset.v === ME.mode));
  $('.me-undo', p).style.visibility = ME.mode === 'custom' ? '' : 'hidden';
  const tabs = ME.mode === 'custom' ? [['outfits', '아바타'], ...CATS.map(c => [c.id, c.name])] : [['all', '전체'], ...CATS.map(c => [c.id, c.name])];
  const cur = ME.mode === 'custom' ? ME.cat : ME.mcat;
  $('.me-tabs', p).innerHTML = tabs.map(([id, n]) => `<button class="${id === cur ? 'on' : ''}" data-act="mecat" data-v="${id}">${n}</button>`).join('') + (ME.mode === 'market' ? `<button class="ib sm" data-act="msort">${ico('filter')}</button>` : '');
  const cat = CATS.find(c => c.id === cur);
  const sub = ME.mode === 'custom' ? ME.sub : ME.msub;
  $('.me-subs', p).innerHTML = cat && cat.subs.length > 1 ? (ME.mode === 'market' ? `<button class="chip ${!sub ? 'on' : ''}" data-act="mesub" data-v="">전체</button>` : '') + cat.subs.map(([id, n]) => `<button class="chip ${sub === id ? 'on' : ''}" data-act="mesub" data-v="${id}">${n}</button>`).join('') : '';
  const grid = $('.me-grid', p), st = grid.scrollTop;
  grid.innerHTML = ME.mode === 'custom' ? customGrid() : marketGrid();
  grid.scrollTop = st;
  if (curTab === 'me') fillThumbs(p);
}
function customGrid() {
  if (ME.cat === 'outfits') {
    return `<div class="igrid c4"><div class="icard add" data-act="outfit-save"><div class="it-th">${ico('plus')}</div><span>추가/저장</span></div>` +
      S.outfits.map((o, i) => `<div class="icard" data-act="outfit" data-v="${i}"><div class="it-th"><img data-thumb="outfit:${i}" alt=""><button class="it-x" data-act="outfit-del" data-v="${i}">${ico('close')}</button></div><span>${esc(o.name)}</span></div>`).join('') + '</div>';
  }
  const slot = ME.cat === 'anim' ? 'anim' : ME.cat === 'emote' ? 'emote' : ME.cat === 'gear' ? 'gear' : ME.sub;
  const list = ITEMS.filter(i => i.slot === slot && owns(i.id));
  const on = id => S.equip[ITEM[id].slot] === id;
  return `<div class="igrid c4">` + list.map(i => `<div class="icard ${on(i.id) ? 'sel' : ''}" data-act="${slot === 'emote' ? 'preview-emote' : slot === 'gear' ? 'item' : 'equip'}" data-id="${i.id}"><div class="it-th"><img data-thumb="${i.id}" alt="">${on(i.id) ? `<i class="it-ok">${ico('check')}</i>` : ''}</div><span>${esc(i.name)}</span></div>`).join('') +
    `<div class="icard add" data-act="shop-more" data-v="${slot}"><div class="it-th">${ico('bag')}</div><span>더 찾아보기</span></div></div>`;
}
function marketItems() {
  let list = ITEMS.filter(i => i.price > 0 || i.slot === 'emote' || i.slot === 'anim');
  if (ME.mcat !== 'all') { const c = CATS.find(c => c.id === ME.mcat); const slots = ME.msub ? [ME.msub] : c.subs.map(s => s[0]); list = list.filter(i => slots.includes(i.slot)); }
  if (ME.sort === 'low') list.sort((a, b) => a.price - b.price);
  else if (ME.sort === 'high') list.sort((a, b) => b.price - a.price);
  else if (ME.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  else list.sort((a, b) => ((a.id.charCodeAt(4) * 7 + a.price) % 13) - ((b.id.charCodeAt(4) * 7 + b.price) % 13));
  return list;
}
const priceTag = i => owns(i.id) ? '<span class="owned">보유 중</span>' : i.price === 0 ? '<span class="free">무료</span>' : `<span class="price">${KB}${fmt(priceOf(i))}</span>`;
function itemCard(i) {
  return `<div class="mcard" data-act="item" data-id="${i.id}"><div class="it-th ${i.rare ? 'rare' : ''}"><img data-thumb="${i.id}" alt="">${i.rare ? '<i class="lim">한정</i>' : ''}</div>
    <b>${esc(i.name)}</b><small>${creatorOf(i)} ${VER}</small>${priceTag(i)}</div>`;
}
function marketGrid() {
  const list = marketItems();
  return `${ME.mcat === 'all' ? '<h3 class="sub-h">이런 건 어떠세요</h3>' : ''}<div class="igrid c3">${list.map(itemCard).join('')}</div>`;
}
function equipItem(id) {
  const it = ITEM[id]; if (!it || !owns(id)) return;
  undoS.push(JSON.stringify(S.equip)); redoS.length = 0;
  if (OPTIONAL.has(it.slot) && S.equip[it.slot] === id) S.equip[it.slot] = null; else S.equip[it.slot] = id;
  sfx.click(); save();
}

// ── 아이템 상세 (아래에서 올라오는 시트) ──
function openItem(id) {
  const it = ITEM[id]; if (!it) return;
  if (curTab === 'me' && it.slot !== 'emote' && it.slot !== 'gear') PV.tryOn = { [it.slot]: it.id };
  if (it.slot === 'emote') { PV.emote = it.id; PV.emoteT = 0; }
  const el = openOv('', 'sheet', () => {
    const own = owns(id), on = S.equip[it.slot] === id;
    const btns = !own
      ? `<button class="btn primary wide" data-act="buy" data-id="${id}">${it.price ? `${KB} ${fmt(priceOf(it))} 에 구매` : '무료로 받기'}</button>`
      : it.slot === 'emote' ? `<button class="btn wide" data-act="preview-emote" data-id="${id}">미리 보기</button>`
      : it.slot === 'gear' ? `<p class="hint">${ico('bag')} 가방에 들어 있어요. 게임에서 아래 핫바를 눌러 꺼내 쓰세요.</p>`
      : `<button class="btn ${on ? '' : 'primary'} wide" data-act="equip" data-id="${id}" data-close="1">${on && OPTIONAL.has(it.slot) ? '해제하기' : on ? '착용 중' : '착용하기'}</button>`;
    return `<div class="sheet-bg" data-act="back"></div><div class="sheet-body"><div class="grab"></div>
      <div class="it-detail"><div class="it-th big ${it.rare ? 'rare' : ''}"><img data-thumb="${id}" alt=""></div>
      <div><h2>${esc(it.name)}</h2><p class="by">${creatorOf(it)} ${VER}</p>
      <p class="pr">${own ? '<span class="owned">보유 중</span>' : it.price ? `${KB} <b>${fmt(priceOf(it))}</b>${S.plus ? ` <s>${fmt(it.price)}</s> <span class="plus-tag">PLUS -20%</span>` : ''}` : '<b>무료</b>'}</p>
      <p class="desc">${slotName(it.slot)} · ${it.desc || (it.rare ? '한정판 아이템이에요.' : '코블록스 아바타 아이템이에요.')}</p></div></div>
      ${curTab === 'me' && it.slot !== 'emote' && it.slot !== 'gear' && !own ? '<p class="hint">위 미리보기에서 입어 보고 있어요.</p>' : ''}
      <div class="sheet-btns">${btns}</div></div>`;
  });
  el._onClose = () => { PV.tryOn = null; };
  fillThumbs(el);
}
const slotName = s => ({ skin: '피부색', head: '머리', body: '체형', rleg: '다리', face: '얼굴', shirt: '셔츠', pants: '바지', hat: '모자', hair: '헤어', faceacc: '얼굴 장신구', neck: '목 장신구', back: '등 장신구', aura: '이펙트', anim: '애니메이션', emote: '감정 표현', gear: '장비' }[s]);
function buy(id) {
  const it = ITEM[id], p = priceOf(it);
  if (S.kobux < p) {
    modal({ title: '코벅스가 부족해요', body: `${fmt(p - S.kobux)} 코벅스가 더 필요해요. 코벅스는 무료로 받을 수 있어요!`, ok: '코벅스 받기', onOk: () => openStore() });
    return;
  }
  modal({ title: '아이템 구매', html: `<div class="buy-box"><img src="${itemThumb(it)}" alt=""><div><b>${esc(it.name)}</b><p>${p ? `${KB} ${fmt(p)}` : '무료'}</p><small>구매 후 잔액: ${fmt(S.kobux - p)}</small></div></div>`, ok: p ? '지금 구매' : '받기', onOk: () => {
    S.kobux -= p; S.owned.push(id); sfx.buy(); award('shopper');
    if (it.slot !== 'emote') { undoS.push(JSON.stringify(S.equip)); S.equip[it.slot] = id; }
    save(); toast(`${it.name} 을(를) 얻었어요!`);
  } });
}

// ── 상점 (코벅스 무료) ──
const PACKS = [22500, 10000, 4500, 3150, 1700, 1200, 800, 400, 80, 40];
function openStore() {
  openOv('', 'full', () => `<header class="hdr ovh"><button class="ib" data-act="back">${ico('close')}</button><div class="kb-big">${KB}<b class="kb-count">${fmt(S.kobux)}</b></div><div class="sp"></div></header>
    <div class="scroll pad">
      <h2 class="h2">코벅스 패키지</h2><p class="muted">이 버전에서는 모든 코벅스가 <b>무료</b>예요. 원하는 만큼 받아 가세요!</p>
      <div class="packs">${PACKS.map(n => `<div class="pack">${KB}<b>${fmt(n)}</b>${n === 1700 ? `<span class="rec">${ico('star')} 추천</span>` : ''}<span class="sp"></span><button class="btn ${n === 1700 ? 'primary' : ''}" data-act="getkb" data-v="${n}">무료</button></div>`).join('')}</div>
      <h2 class="h2">${KB} 코블록스의 새로운 기능</h2>
      <div class="plus-card"><div class="row"><b>코블록스 플러스</b><span class="sp"></span><span class="free">무료</span></div>
        <ul><li>${ico('star')} 아이템 및 아바타 20% 할인</li><li>${KB} 구독하면 +500 코벅스</li><li>${ico('palette')} 앱 강조 색상 바꾸기</li><li>${ico('user')} 프로필에 PLUS 배지</li></ul>
        <button class="btn wide ${S.plus ? '' : 'primary'}" data-act="plus-toggle">${S.plus ? '구독 해지' : '무료로 구독하기'}</button></div>
      <h2 class="h2">자주 묻는 질문</h2>
      ${[['코벅스는 무엇인가요?', '코벅스는 코블록스 안에서 아바타 아이템, 감정 표현 등을 살 때 쓰는 가상 화폐예요.'], ['내 코벅스는 어디에 있나요?', '화면 위쪽 코벅스 아이콘이나 메뉴에서 잔액을 볼 수 있어요. 데이터는 이 기기에 저장돼요.'], ['코벅스에 유효기간이 있나요?', '아니요. 데이터를 초기화하지 않는 한 사라지지 않아요.'], ['진짜 돈이 드나요?', '아니요! 이 버전은 결제 기능이 없고 모든 코벅스가 무료예요.']]
        .map(([q, a]) => `<details class="faq"><summary>${q}${ico('chev')}</summary><p>${a}</p></details>`).join('')}
      <div class="pad-b"></div></div>`);
}

// ── 알림 ──
function openNotifs() {
  openOv('', 'full', () => ovHead('알림') + `<div class="scroll pad">${S.notifs.length ? S.notifs.map(n => `<div class="ncard"><img src="${gthumb(n.game)}" alt=""><div class="nc-t"><b>${esc(n.title)}</b><p>${esc(n.body)}</p></div><small>${ago(n.time)}</small>
    <div class="nc-btns"><button class="btn outline" data-act="ndismiss" data-id="${n.id}">해제</button><button class="btn primary" data-act="nopen" data-id="${n.id}">${n.action}</button></div></div>`).join('') : '<p class="empty">새 알림이 없어요.</p>'}</div>`);
}
function ago(t) { const s = (Date.now() - t) / 1000; return s < 60 ? '방금' : s < 3600 ? `${s / 60 | 0}분` : s < 86400 ? `${s / 3600 | 0}시간` : `${s / 86400 | 0}일`; }

// ── 검색 ──
function openSearch() {
  const el = openOv(`<header class="hdr ovh srch"><label class="sbox">${ico('search')}<input placeholder="검색" enterkeyhint="search"></label><button class="txtbtn" data-act="back">취소</button></header><div class="scroll pad sres"></div>`, 'full');
  const inp = $('input', el), res = $('.sres', el);
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) {
      const hist = S.history.map(id => gameById(id)).filter(Boolean);
      res.innerHTML = (hist.length ? `<h2 class="sec">최근 방문</h2><div class="hrow">${hist.map(g => gameCard(g, 'sq')).join('')}</div>` : '') +
        `<h2 class="sec">다음에 대해 검색해 보기:</h2><div class="chips wrap">${['Test', '모자', '날개', '헤드리스', '코블록스', '감정 표현', '얼굴'].map(c => `<button class="chip" data-act="sq" data-v="${c}">${c}</button>`).join('')}</div>`;
      return;
    }
    const gs = allGames().filter(g => g.name.toLowerCase().includes(q) || g.genre.includes(q));
    const its = ITEMS.filter(i => i.name.toLowerCase().includes(q) || slotName(i.slot).includes(q)).slice(0, 30);
    res.innerHTML = `<h2 class="sec">체험</h2>${gs.length ? `<div class="hrow">${gs.map(g => gameCard(g, 'sq')).join('')}</div>` : '<p class="empty">찾는 체험이 없어요.</p>'}
      <h2 class="sec">아바타 아이템</h2>${its.length ? `<div class="igrid c3">${its.map(itemCard).join('')}</div>` : '<p class="empty">찾는 아이템이 없어요.</p>'}`;
    fillThumbs(res);
  };
  inp.oninput = draw; el._sq = v => { inp.value = v; draw(); };
  draw(); setTimeout(() => inp.focus(), 280);
}

// ── 체험 상세 ──
function openGame(id) {
  const g = gameById(id); if (!g) return;
  openOv('', 'full', () => {
    const fav = S.favorites.includes(id), lk = S.likes[id] || 0;
    return ovHead('') + `<div class="scroll">
    <div class="gd-thumb"><img src="${gthumb(id)}" alt=""></div>
    <div class="pad"><h1 class="gd-title">${esc(g.name)}</h1><p class="by">${esc(g.creator)} ${VER}</p>
    <button class="btn play" data-act="play" data-id="${id}"><svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor"/></svg></button>
    <div class="gd-stats"><div><small>평가</small><b>${ico('thumb')} ${rating(id)}%</b></div><div><small>활동 중</small><b>0</b></div><div><small>방문</small><b>${fmt(S.visits[id] || 0)}</b></div><div><small>장르</small><b>${g.genre}</b></div></div>
    <div class="gd-acts"><button class="btn ${fav ? 'primary' : ''}" data-act="fav" data-id="${id}">${ico('star')} ${fav ? '즐겨찾기 됨' : '즐겨찾기'}</button>
      <button class="btn ${lk === 1 ? 'primary' : ''}" data-act="like" data-id="${id}" data-v="1">${ico('thumb')}</button>
      <button class="btn ${lk === -1 ? 'primary' : ''} flip" data-act="like" data-id="${id}" data-v="-1">${ico('thumb')}</button></div>
    <h3 class="h3">설명</h3><p class="desc pre">${esc(g.desc)}</p>
    <h3 class="h3">정보</h3><table class="info"><tr><td>제작자</td><td>${esc(g.creator)}</td></tr><tr><td>생성일</td><td>${g.created}</td></tr><tr><td>업데이트</td><td>${g.updated}</td></tr><tr><td>최대 인원</td><td>${g.max}명 (혼자 플레이)</td></tr><tr><td>장르</td><td>${g.genre}</td></tr></table>
    <div class="pad-b"></div></div></div>`;
  });
}

// ── 목록 페이지 ──
function openList(kind) {
  const titles = { favorites: '즐겨찾기', continue: '계속 플레이', inventory: '인벤토리' };
  openOv('', 'full', () => {
    if (kind === 'inventory') {
      const groups = CATS.flatMap(c => c.subs).map(([s, n]) => [n, ITEMS.filter(i => i.slot === s && owns(i.id))]).filter(([, l]) => l.length);
      return ovHead(titles[kind]) + `<div class="scroll pad"><p class="muted">보유한 아이템 ${S.owned.length}개</p>${groups.map(([n, l]) => `<h3 class="h3">${n}</h3><div class="igrid c3">${l.map(itemCard).join('')}</div>`).join('')}<div class="pad-b"></div></div>`;
    }
    const ids = kind === 'favorites' ? S.favorites : S.history;
    const gs = ids.map(id => gameById(id)).filter(Boolean);
    return ovHead(titles[kind]) + `<div class="scroll pad">${gs.length ? `<div class="grid2">${gs.map(g => gameCard(g)).join('')}</div>` : `<p class="empty">${kind === 'favorites' ? '즐겨찾기한 체험이 없어요.' : '아직 플레이한 체험이 없어요.'}</p>`}</div>`;
  });
  fillThumbs(stack.at(-1));
}

// ── 프로필 ──
function openProfile() {
  openOv('', 'full', () => {
    const worn = Object.values(S.equip).filter(Boolean).map(id => ITEM[id]).filter(i => i && i.price > 0);
    return ovHead('프로필') + `<div class="scroll pad"><div class="pf-top">${headImg('av-c xl')}<div><h2>${esc(myName())} ${S.plus ? '<span class="plus-tag">PLUS</span>' : ''}</h2><p class="muted">@${esc(S.user?.username)}</p></div></div>
      <p class="desc pre">${esc(S.user?.about || '자기소개가 아직 없어요. 설정 > 계정 정보에서 쓸 수 있어요.')}</p>
      <div class="gd-stats"><div><small>가입일</small><b>${new Date(S.user?.joined || Date.now()).toLocaleDateString('ko-KR')}</b></div><div><small>보유 아이템</small><b>${S.owned.length}</b></div><div><small>플레이</small><b>${fmt(Object.values(S.visits).reduce((a, b) => a + b, 0))}</b></div></div>
      <div class="pf-body"><img src="${avatarShot(S.equip)}" alt=""></div>
      <h3 class="h3">배지 <small class="muted">${Object.keys(S.badges).length} / ${BADGES.length}</small></h3>
      <div class="bgrid">${BADGES.map(b => `<div class="bcell ${S.badges[b.id] ? '' : 'off'}">${badgeSvg(b.color, 52)}<b>${b.name}</b><small>${b.desc}</small></div>`).join('')}</div>
      <h3 class="h3">착용 중인 아이템</h3>${worn.length ? `<div class="igrid c3">${worn.map(itemCard).join('')}</div>` : '<p class="empty">기본 아이템만 착용 중이에요.</p>'}
      <button class="btn primary wide" data-act="goavatar">아바타 편집</button><div class="pad-b"></div></div>`;
  });
  fillThumbs(stack.at(-1));
}

// ── 설정 ──
const SET = [
  { id: 'account', n: '계정 정보', i: 'user', rows: [{ t: 'user', k: 'username', n: '사용자 이름' }, { t: 'user', k: 'displayName', n: '표시 이름' }, { t: 'about', n: '자기소개' }, { t: 'joined', n: '가입일' }] },
  { id: 'privacy', n: '개인정보', i: 'lock', rows: [{ t: 'toggle', k: 'profilePublic', n: '프로필 공개' }, { t: 'toggle', k: 'chat', n: '게임 채팅 창 자동으로 열기' }] },
  { id: 'notif', n: '알림', i: 'bell', rows: [{ t: 'toggle', k: 'notifications', n: '알림 받기' }, { t: 'btn', a: 'clear-notifs', n: '모든 알림 지우기' }] },
  { id: 'app', n: '앱 설정', i: 'palette', rows: [{ t: 'select', k: 'theme', n: '테마', o: [['dark', '어둡게'], ['light', '밝게'], ['system', '시스템 설정']] }, { t: 'select', k: 'language', n: '언어', o: [['ko', '한국어']] }, { t: 'accent', n: '강조 색상 (PLUS)' }, { t: 'toggle', k: 'reduceMotion', n: '움직임 줄이기' }] },
  { id: 'game', n: '게임 설정', i: 'pad', rows: [{ t: 'select', k: 'gfx', n: '그래픽 품질', o: [['auto', '자동'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => [String(n), n + '단계' + (n === 10 ? ' (최고)' : n === 1 ? ' (최저)' : '')])] }, { t: 'range', k: 'sensitivity', n: '카메라 감도', min: 0.2, max: 3, step: 0.1 }, { t: 'range', k: 'fov', n: '시야각', min: 50, max: 100, step: 1 }, { t: 'toggle', k: 'invertY', n: '카메라 Y축 반전' }, { t: 'toggle', k: 'nameTags', n: '이름표 표시' }, { t: 'toggle', k: 'showFps', n: 'FPS 표시' }, { t: 'toggle', k: 'vibrate', n: '진동' }] },
  { id: 'sound', n: '소리', i: 'sound', rows: [{ t: 'toggle', k: 'sfx', n: '효과음' }, { t: 'range', k: 'volume', n: '음량', min: 0, max: 100, step: 1 }] },
  { id: 'about', n: '정보', i: 'info', rows: [{ t: 'text', n: '버전', v: 'KOBLOX 0.1.0 (오프라인)' }, { t: 'btn', a: 'replay-intro', n: '인트로 다시 보기' }, { t: 'btn', a: 'reset-settings', n: '설정 기본값으로' }, { t: 'btn', a: 'reset-all', n: '모든 데이터 초기화', danger: true }] },
];
function openSettings() {
  openOv('', 'full', () => ovHead('설정') + `<div class="scroll"><div class="list">${SET.map(s => `<button class="li" data-act="setsec" data-id="${s.id}">${ico(s.i)}<span>${s.n}</span>${ico('chev')}</button>`).join('')}
    <button class="li" data-act="logout">${ico('logout')}<span>로그아웃</span>${ico('chev')}</button></div></div>`);
}
function openSetSec(id) {
  const sec = SET.find(s => s.id === id);
  const el = openOv('', 'full', () => ovHead(sec.n) + `<div class="scroll"><div class="list">${sec.rows.map(r => {
    const v = S.settings[r.k];
    switch (r.t) {
      case 'toggle': return `<label class="li">${r.n}<input type="checkbox" class="tg" data-k="${r.k}" ${v ? 'checked' : ''}></label>`;
      case 'range': return `<label class="li col">${r.n}<span class="rv">${v}</span><input type="range" data-k="${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"></label>`;
      case 'select': return `<label class="li">${r.n}<select data-k="${r.k}">${r.o.map(([a, b]) => `<option value="${a}" ${String(a) === String(v) ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`;
      case 'user': return `<div class="li">${r.n}<span class="sp"></span><span class="muted">${esc(S.user?.[r.k])}</span><button class="ib sm" data-act="edit-user" data-k="${r.k}">${ico('edit')}</button></div>`;
      case 'about': return `<label class="li col">${r.n}<textarea data-about maxlength="200" placeholder="나를 소개해 보세요">${esc(S.user?.about)}</textarea></label>`;
      case 'joined': return `<div class="li">${r.n}<span class="sp"></span><span class="muted">${new Date(S.user?.joined || Date.now()).toLocaleDateString('ko-KR')}</span></div>`;
      case 'text': return `<div class="li">${r.n}<span class="sp"></span><span class="muted">${r.v}</span></div>`;
      case 'btn': return `<button class="li ${r.danger ? 'danger' : ''}" data-act="${r.a}">${r.n}</button>`;
      case 'accent': return `<div class="li">${r.n}<span class="sp"></span>${['', '#ff3b5c', '#22c55e', '#f59e0b', '#a855f7'].map(c => `<button class="swatch ${S.settings.accent === c ? 'on' : ''}" style="background:${c || '#3b82ff'}" data-act="accent" data-v="${c}" ${S.plus ? '' : 'disabled'}></button>`).join('')}</div>`;
    }
  }).join('')}</div>${id === 'app' && !S.plus ? '<p class="muted pad">강조 색상은 코블록스 플러스(무료)에서 쓸 수 있어요.</p>' : ''}</div>`);
  el.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (k) {
      S.settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
      if (e.target.type === 'range') e.target.parentElement.querySelector('.rv').textContent = e.target.value;
      quietSave(); applyTheme();
    }
    if (e.target.dataset.about !== undefined) { S.user.about = e.target.value; quietSave(); }
  });
}
let quiet = false;
function quietSave() { quiet = true; save(); quiet = false; }

// ── 만들기 (스튜디오) ──
function openCreate() {
  openOv('', 'full', () => ovHead('만들기') + `<div class="scroll pad">
    <div class="studio-hero">${ico('cube')}<div><b>코블록스 스튜디오</b><p>블록을 쌓고 스폰, 체크포인트, 용암, 점프대, 코인을 놓아 나만의 체험을 만들어요.</p></div></div>
    <h3 class="h3">새로 만들기</h3>
    <div class="tpl">${[['base', '기본 바닥판', '회색 바닥과 스폰만 있어요'], ['obby', '장애물 코스', '점프 블록, 체크포인트, 용암, 코인'], ['sky', '밤하늘 섬', '바닥 없이 하늘에 떠 있는 섬']]
      .map(([k, n, d]) => `<button class="tcard" data-act="newplace" data-v="${k}">${ico(k === 'obby' ? 'flag' : k === 'sky' ? 'star' : 'cube')}<b>${n}</b><small>${d}</small></button>`).join('')}</div>
    <h3 class="h3">내 체험 <small class="muted">${S.places.length}개</small></h3>
    ${S.places.length ? S.places.slice().sort((a, b) => b.updated - a.updated).map(p => `<div class="pcard"><img src="${placeThumb(p)}" alt=""><div class="pc-t"><b>${esc(p.name)}</b><small>${p.published ? '게시됨' : '게시 안 됨'} · 파트 ${p.parts.length}개</small>
      <div class="pc-b"><button class="btn sm primary" data-act="editplace" data-id="${p.id}">${ico('edit')}편집</button><button class="btn sm" data-act="playplace" data-id="${p.id}">${ico('play')}플레이</button><button class="btn sm" data-act="delplace" data-id="${p.id}">${ico('trash')}</button></div></div></div>`).join('') : '<p class="empty">아직 만든 체험이 없어요.</p>'}
    <div class="pad-b"></div></div>`);
}
function newPlace(tpl) {
  const n = S.places.length + 1;
  const p = { id: 'p' + Date.now().toString(36), name: `${myName()}의 체험 ${n}`, desc: '', created: Date.now(), updated: Date.now(), published: false, ...TEMPLATES[tpl]() };
  S.places.push(p); save(); editPlace(p.id);
}
function editPlace(id) {
  const p = S.places.find(x => x.id === id); if (!p) return;
  closeAll(); showScreen('studio');
  const back = () => { showScreen('app'); renderAll(); setTab(curTab); openCreate(); };
  openStudio($('#studio'), p, {
    onExit: back,
    onTest: (place, resume) => { showScreen('game'); startGame($('#game'), { place, testMode: true, onExit: () => { showScreen('studio'); resume(); } }); },
    onPublish: () => { award('creator'); },
  });
}

// ── 신체 크기 ──
function openScales() {
  const el = openOv('', 'sheet', () => `<div class="sheet-bg" data-act="back"></div><div class="sheet-body"><div class="grab"></div>
    <h2 class="h2">신체 크기</h2>
    ${[['height', '키', 0.9, 1.1], ['width', '너비', 0.75, 1.05], ['head', '머리', 0.9, 1.15]].map(([k, n, a, b]) => `<label class="li col">${n}<span class="rv">${Math.round(S.scales[k] * 100)}%</span><input type="range" min="${a}" max="${b}" step="0.01" value="${S.scales[k]}" data-sc="${k}"></label>`).join('')}
    <div class="sheet-btns"><button class="btn wide" data-act="scale-reset">기본값으로</button></div></div>`);
  el.addEventListener('input', e => { const k = e.target.dataset.sc; if (!k) return; S.scales[k] = +e.target.value; e.target.parentElement.querySelector('.rv').textContent = Math.round(S.scales[k] * 100) + '%'; quietSave(); PV.key = ''; lastHeadKey = ''; });
  el._onClose = () => { save(); };
}

// ── 게임 참가 ──
function play(id) {
  const g = gameById(id); if (!g) return;
  closeAll(); unlockAudio();
  $('.join-thumb').src = gthumb(id); $('.join-title').textContent = g.name; $('.join-by').textContent = '제작: ' + g.creator;
  $('.join-bg').style.backgroundImage = `url(${gthumb(id)})`;
  showScreen('joining');
  const msgs = ['서버를 찾는 중…', '게임에 참가하는 중…', '월드를 불러오는 중…'];
  let i = 0; $('.join-msg').textContent = msgs[0];
  const iv = setInterval(() => { $('.join-msg').textContent = msgs[Math.min(++i, 2)]; }, 550);
  const tm = setTimeout(() => {
    clearInterval(iv);
    S.visits[id] = (S.visits[id] || 0) + 1; S.history = [id, ...S.history.filter(x => x !== id)].slice(0, 20); save();
    showScreen('game');
    startGame($('#game'), { place: placeById(id), onExit: () => { showScreen('app'); renderAll(); setTab(curTab); } });
  }, 1700);
  $('.join-cancel').onclick = () => { clearTimeout(tm); clearInterval(iv); showScreen('app'); };
}

// ── 헤드샷 ──
let headT = 0, lastHeadKey = '';
function updateHead() {
  const k = JSON.stringify(S.equip) + JSON.stringify(S.scales); if (k === lastHeadKey) return; lastHeadKey = k;
  HEAD = avatarShot(S.equip, 'head'); window.KOBLOX_HEADSHOT = HEAD;
  $$('.my-head, .tab-head').forEach(i => i.src = HEAD);
}

// ── 클릭 처리 ──
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const a = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
  if (a !== 'back') sfx.click();
  if (drawerOpen && a !== 'drawer') closeDrawer(true);
  switch (a) {
    case 'drawer': drawerOpen ? closeDrawer(true) : openDrawer(); break;
    case 'back': closeOv(); break;
    case 'search': openSearch(); break;
    case 'sq': stack.at(-1)?._sq?.(v); break;
    case 'store': openStore(); break;
    case 'notifs': openNotifs(); break;
    case 'game': openGame(id); break;
    case 'play': play(id); break;
    case 'homechip': homeChip = v; renderHome(); break;
    case 'chartinfo': toast('체험 순위는 이 기기에서의 플레이 기록으로 정해져요.'); break;
    case 'continue': case 'favorites': case 'inventory': openList(a); break;
    case 'profile': openProfile(); break;
    case 'goavatar': closeAll(); setTab('me'); break;
    case 'settings': openSettings(); break;
    case 'setsec': openSetSec(id); break;
    case 'help': modal({ title: '도움말', html: '<div class="help"><p><b>체험 하기</b> — 홈에서 체험을 눌러 ▶ 를 누르세요.</p><p><b>아바타 꾸미기</b> — 아래 “나” 탭의 꾸미기에서 아이템을 착용해요.</p><p><b>아이템 사기</b> — 마켓플레이스에서 코벅스로 사요. 코벅스는 상점에서 무료!</p><p><b>게임 조작</b> — PC: WASD·Space·마우스, 모바일: 조이스틱·점프 버튼</p></div>', cancel: '', ok: '닫기' }); break;
    case 'create': openCreate(); break;
    case 'newplace': newPlace(v); break;
    case 'editplace': editPlace(id); break;
    case 'playplace': play(id); break;
    case 'delplace': modal({ title: '이 체험을 삭제할까요?', body: '되돌릴 수 없어요.', ok: '삭제', danger: true, onOk: () => { S.places = S.places.filter(p => p.id !== id); S.history = S.history.filter(x => x !== id); S.favorites = S.favorites.filter(x => x !== id); save(); } }); break;
    case 'scale-reset': S.scales = { height: 1, width: 1, head: 1 }; save(); break;
    case 'plus': openStore(); break;
    case 'plus-toggle':
      if (S.plus) modal({ title: '구독을 해지할까요?', body: '할인 혜택과 강조 색상이 꺼져요.', ok: '해지', danger: true, onOk: () => { S.plus = false; save(); applyTheme(); } });
      else { S.plus = true; S.kobux += 500; sfx.coin(); save(); toast('코블록스 플러스 구독 완료! +500 코벅스'); }
      break;
    case 'getkb': S.kobux += +v; sfx.coin(); if (S.kobux >= 100000) award('rich'); save(); toast(`+${fmt(+v)} 코벅스를 받았어요!`); flyCoin(el); break;
    case 'ndismiss': S.notifs = S.notifs.filter(n => n.id !== id); save(); break;
    case 'nopen': { const n = S.notifs.find(n => n.id === id); if (n) { closeOv(); setTimeout(() => openGame(n.game), 50); } break; }
    case 'clear-notifs': S.notifs = []; save(); toast('알림을 모두 지웠어요.'); break;
    case 'fav': S.favorites = S.favorites.includes(id) ? S.favorites.filter(x => x !== id) : [...S.favorites, id]; save(); break;
    case 'like': S.likes[id] = S.likes[id] === +v ? 0 : +v; save(); break;
    case 'logout': modal({ title: '로그아웃할까요?', body: '아이템과 코벅스는 이 기기에 그대로 남아 있어요.', ok: '로그아웃', onOk: () => { closeAll(); S.user = null; save(); $('#su-name').value = ''; $('#su-display').value = ''; showScreen('signup'); } }); break;
    case 'replay-intro': closeAll(); intro(); break;
    case 'reset-settings': S.settings = { ...DEFAULT_SETTINGS }; save(); applyTheme(); toast('설정을 기본값으로 되돌렸어요.'); break;
    case 'reset-all': modal({ title: '모든 데이터를 지울까요?', body: '계정, 아이템, 코벅스, 설정이 모두 사라져요. 되돌릴 수 없어요.', ok: '초기화', danger: true, onOk: () => { resetAll(); location.reload(); } }); break;
    case 'edit-user': {
      const k = el.dataset.k;
      modal({ title: k === 'username' ? '사용자 이름 바꾸기' : '표시 이름 바꾸기', html: `<input class="mdl-in" maxlength="20" value="${esc(S.user[k])}">`, ok: '저장', onOk: () => {} });
      const inp = $('.mdl-in'); inp.focus();
      $('#modal-root').onclick = ev => {
        const m = ev.target.dataset.m; if (!m && !ev.target.classList.contains('mdl-bg')) return;
        if (m === 'ok') { const val = inp.value.trim(); if (k === 'username' && !/^[A-Za-z0-9_]{3,20}$/.test(val)) { toast('영문, 숫자, _ 로 3~20자로 써 주세요.'); return; } if (!val) return; S.user[k] = val; save(); }
        $('#modal-root').innerHTML = '';
      };
      break;
    }
    case 'accent': S.settings.accent = v; save(); applyTheme(); break;
    // 아바타
    case 'memode': ME.mode = v; renderMe(); break;
    case 'mecat':
      if (ME.mode === 'custom') { ME.cat = v; const c = CATS.find(c => c.id === v); ME.sub = c ? c.subs[0][0] : null; }
      else { ME.mcat = v; ME.msub = null; }
      $('.me-grid').scrollTop = 0; renderMe(); break;
    case 'mesub': if (ME.mode === 'custom') ME.sub = v; else ME.msub = v || null; $('.me-grid').scrollTop = 0; renderMe(); break;
    case 'msort': modal({ title: '정렬', html: `<div class="sort">${[['rec', '추천'], ['low', '가격 낮은 순'], ['high', '가격 높은 순'], ['name', '이름 순']].map(([k, n]) => `<label><input type="radio" name="srt" value="${k}" ${ME.sort === k ? 'checked' : ''}> ${n}</label>`).join('')}</div>`, ok: '적용', onOk: r => { } });
      $('#modal-root .sort').addEventListener('change', ev => { ME.sort = ev.target.value; renderMe(); }); break;
    case 'shop-more': { const c = CATS.find(c => c.subs.some(s => s[0] === v)); ME.mode = 'market'; ME.mcat = c.id; ME.msub = c.subs.length > 1 ? v : null; renderMe(); break; }
    case 'equip': equipItem(id); if (el.dataset.close) closeOv(); break;
    case 'item': openItem(id); break;
    case 'buy': buy(id); break;
    case 'preview-emote': if (curTab !== 'me') { closeAll(); setTab('me'); } PV.emote = id; PV.emoteT = 0; break;
    case 'undo': if (undoS.length) { redoS.push(JSON.stringify(S.equip)); S.equip = JSON.parse(undoS.pop()); save(); } break;
    case 'redo': if (redoS.length) { undoS.push(JSON.stringify(S.equip)); S.equip = JSON.parse(redoS.pop()); save(); } break;
    case 'me-body': openScales(); break;
    case 'outfit-save': modal({ title: '아바타 저장', html: `<input class="mdl-in" maxlength="16" value="아바타 ${S.outfits.length + 1}">`, ok: '저장', onOk: r => { } });
      { const inp = $('.mdl-in'); inp.select(); $('#modal-root').onclick = ev => { const m = ev.target.dataset.m; if (!m && !ev.target.classList.contains('mdl-bg')) return; if (m === 'ok') { S.outfits.push({ name: inp.value.trim() || '아바타', equip: { ...S.equip } }); save(); toast('아바타를 저장했어요.'); } $('#modal-root').innerHTML = ''; }; }
      break;
    case 'outfit': if (e.target.closest('.it-x')) break; { const o = S.outfits[+v]; if (o) { undoS.push(JSON.stringify(S.equip)); S.equip = { ...DEFAULT_EQUIP, ...o.equip }; save(); } } break;
    case 'outfit-del': e.stopPropagation(); modal({ title: '이 아바타를 삭제할까요?', ok: '삭제', danger: true, onOk: () => { S.outfits.splice(+v, 1); save(); } }); break;
  }
});
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { sfx.click(); closeAll(); setTab(b.dataset.tab); } });
$('.drawer-bg').addEventListener('click', () => closeDrawer(true));

function flyCoin(from) {
  const r = from.getBoundingClientRect(), c = document.createElement('div'); c.className = 'fly'; c.innerHTML = KB;
  c.style.left = r.left + r.width / 2 + 'px'; c.style.top = r.top + 'px'; document.body.append(c);
  setTimeout(() => c.remove(), 800);
}

// 상태가 바뀌면 화면 갱신
onChange(() => {
  if (quiet || !$('#app').classList.contains('active')) return;
  updateHead();
  $$('.kb-count').forEach(e => e.textContent = fmt(S.kobux));
  $$('.hdr .dot, .me-top .dot').forEach(e => e.classList.toggle('hide', !S.notifs.length));
  renderHome(); renderCharts(); renderMe(); renderDrawer(); rerenderOverlays();
});

window.KOBLOX_THUMB = id => ITEM[id] ? itemThumb(ITEM[id]) : '';
onBadge(id => { if ($('#game').classList.contains('active')) return; const b = BADGES.find(x => x.id === id); if (b) { sfx.badge(); toast(`배지를 얻었어요: ${b.name}`); } });
applyTheme();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
setupSignup();
intro();
