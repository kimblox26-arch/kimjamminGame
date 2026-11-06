// 초록모자 CHAPTER 1 — 1인칭 진행 · 같이하기(로비/방) · AI 친구 · 컷신 · HUD
import * as THREE from 'three';
import { World, CEIL, roomAt, cv, toTex, MAZE_INFO } from './world.js';
import { createArms } from './noob.js';
import { Monster, buildGreenHat } from './monster.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { DIARY, KEYS, KEY_ORDER, ICONS, paintIcons } from './story.js';
import { createAvatar, SKINS } from './avatar.js';
import { Bot, BOT_DEFS } from './bots.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const angLerp = (a, b, k) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);       // 이 방향을 보는 카메라 yaw
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SKIP = Symbol('skip');
const EYE = 1.5;                                        // 눈높이 (뉴비 키 1.66m)
const POSE = { stand: { eye: 1.5, sp: 1, top: 1.6 }, crouch: { eye: 1.0, sp: 0.55, top: 1.1 }, prone: { eye: 0.38, sp: 0.3, top: 0.45 } };

/* ── 설정 저장 ── */
const SKEY = 'greenhat-ch1';
const SET = Object.assign({ mic: null, sens: 1, vol: 0.9, look: 1, bright: 1, q: isTouch ? 'mid' : 'high', voice: false, seenIntro: false, best: 0, v: 3, nick: '', skin: 0, dev: false }, (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })());
if (SET.v !== 3) { SET.voice = false; SET.v = 3; }
if (!SET.nick) SET.nick = '뉴비' + (Math.random() * 900 + 100 | 0);
const saveSet = () => { try { localStorage.setItem(SKEY, JSON.stringify(SET)); } catch (e) { } };

/* ── 렌더러 · 장면 ── */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: !isTouch, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const EXP = () => 1.45 * SET.bright; renderer.toneMappingExposure = EXP();
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
const FOG = new THREE.Color(0x050304);
scene.background = FOG.clone(); scene.fog = new THREE.FogExp2(0x050304, 0.038);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 46);
const hemi = new THREE.HemisphereLight(0x6a6e90, 0x24140c, 0.85); scene.add(hemi);
const fill = new THREE.PointLight(0xffd8b0, 1.0, 6, 2); scene.add(fill);
const exitLight = new THREE.PointLight(0xfff6e8, 0, 30, 1.2); exitLight.position.set(22, 2, 30.6); scene.add(exitLight);
let curScene = scene;
const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(55, 1, 0.01, 5);
vmScene.add(new THREE.HemisphereLight(0xa0a0b0, 0x2a1810, 1.1));
const vmKey = new THREE.DirectionalLight(0xffe0c0, 0.9); vmKey.position.set(-1, 2, 1); vmScene.add(vmKey);
const arms = createArms(); vmScene.add(arms.root);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  G.baseFov = w / h < 1 ? 88 : 75;
  camera.aspect = w / h; camera.fov = G.baseFov; camera.updateProjectionMatrix();
  vmCam.aspect = w / h; vmCam.fov = w / h < 1 ? 70 : 55; vmCam.updateProjectionMatrix();
}
function applyQuality() {
  const pr = { low: 1, mid: Math.min(devicePixelRatio, 1.5), high: Math.min(devicePixelRatio, 2) }[SET.q] || 1;
  renderer.setPixelRatio(pr); resize();
}
addEventListener('resize', resize);

/* ── 게임 상태 ── */
const audio = new Audio(); audio.setVolume(SET.vol); audio.sens = SET.sens; audio.noVoice = !SET.voice;
const input = new Input(document.body); input.sens = SET.look;
const net = new Net();
let world, monster, street, atlasTex;
const G = {
  mode: 'loading', prevMode: 'play', time: 0, chaseTime: 0, busy: false, safe: true,
  hp: 100, st: 100, tired: false, lastHurt: -99, caught: 0,
  inv: {}, used: {}, diaries: new Set(), code: [0, 0, 0, 0],
  player: { pos: new THREE.Vector3(), hidden: false, spot: null, running: false },
  camYaw: 0, camPitch: 0, eyeH: EYE, roll: 0, hideYaw: 0, hidePitch: 0, walkPh: 0, speed: 0, baseFov: 75,
  micLevel: 0, micThreshold: 0.38, micHideThreshold: 0.2, micCool: 0,
  shake: 0, lightT: 20, flash: 0, focus: null, camera, lookDX: 0, lookDY: 0,
  pose: 'stand', y: 0, dev: { fly: false, noclip: false, invis: false, god: false, freeze: false, fast: false },
  bots: [], occ: new Map(), clueLog: [], memos: [], botMemos: [], hinted: new Set(), bandage: 0,
  mp: false, host: true, cfg: { bots: 2, diff: 1, max: 1, name: '혼자 하기' }, epoch: 0, remotes: new Map(), myPeer: null,
  acts: [], actI: 0, chatI: 0, lockout: {}, escaped: false,
};

/* ── 트윈 · 컷신 도구 ── */
const tweens = new Set(); let skipFlag = false;
const tween = (d, fn) => new Promise(res => { const tw = { t: 0, d, fn, res }; fn(0); tweens.add(tw); });
const wait = d => tween(d, () => { });
const S = async p => { await p; if (skipFlag) throw SKIP; };
function runTweens(dt) {
  for (const tw of [...tweens]) { tw.t += dt; const k = skipFlag ? 1 : Math.min(1, tw.t / tw.d); tw.fn(k); if (k >= 1) { tweens.delete(tw); tw.res(); } }
}
function black(v, d = 0) { const el = $('fx-black'); if (!d) { el.style.opacity = v; return Promise.resolve(); } const a = +el.style.opacity || 0; return tween(d, k => el.style.opacity = a + (v - a) * k); }
function white(v, d = 0) { const el = $('fx-white'); if (!d) { el.style.opacity = v; return Promise.resolve(); } const a = +el.style.opacity || 0; return tween(d, k => el.style.opacity = a + (v - a) * k); }
function view(pos, eyeH, yaw, pitch, d, e = ease) {
  const p0 = G.player.pos.clone(), h0 = G.eyeH, y0 = G.camYaw, q0 = G.camPitch;
  return tween(d, k => {
    const t = e(k);
    if (pos) G.player.pos.lerpVectors(p0, pos, t);
    if (eyeH != null) G.eyeH = h0 + (eyeH - h0) * t;
    if (yaw != null) G.camYaw = angLerp(y0, yaw, t);
    if (pitch != null) G.camPitch = q0 + (pitch - q0) * t;
  });
}
let sub = { full: '', shown: 0, t: 0 };
function say(name, text, dur = 2.6, gh = false) {
  $('sub-name').textContent = name || ''; sub = { full: text, shown: 0, t: dur };
  $('sub-text').textContent = ''; $('sub').className = 'show' + (gh ? ' gh' : '');
}
async function cineText(t, d) { const el = $('cine-text'); el.textContent = t; el.classList.add('show'); await S(wait(d)); el.classList.remove('show'); await S(wait(0.6)); }
let toastT = 0;
function toast(html, d = 2.8) { const t = $('toast'); t.innerHTML = html; t.classList.add('show'); toastT = d; }
let heardT = 0;
function showHeard(text = '초록모자가 소리를 들었다!') { $('heard').querySelector('span').textContent = text; $('heard').classList.add('show'); $('mic').classList.add('alert'); heardT = 1.8; }

/* ── 모달 ── */
const modalStack = [];
function openModal(id) { $(id).classList.remove('hidden'); modalStack.push(id); $(id).style.zIndex = 20 + modalStack.length; if (G.mode === 'play') { G.prevMode = 'play'; G.mode = G.mp ? 'play' : 'modal'; } }
function closeModal(id) {
  $(id).classList.add('hidden'); const i = modalStack.lastIndexOf(id); if (i >= 0) modalStack.splice(i, 1);
  if (!modalStack.length && G.mode === 'modal') G.mode = G.prevMode || 'play';
  if (id === 'settings') saveSet();
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));

/* ── 로딩 ── */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
function setLoad(p, t) { $('ld-fill').style.width = p + '%'; $('ld-text').textContent = t; }

async function boot() {
  paintIcons();
  { const [c, g] = cv(160); const d = g.createImageData(160, 160); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); $('fx-grain').style.backgroundImage = `url(${c.toDataURL()})`; }
  setLoad(12, '초록모자를 부르는 중...');
  net.init(lobbyStatus);   // 기다리지 않는다
  const [atlasImg, fullImg] = await Promise.all([loadImg('assets/greenhat_parts.png'), loadImg('assets/greenhat_full.png'), audio.preload('sounds/')]);
  setLoad(30, '글꼴을 불러오는 중...');
  try { await Promise.race([Promise.all(['60px "East Sea Dokdo"', '30px "Nanum Pen Script"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]); } catch (e) { }
  setLoad(50, '저택을 짓는 중...'); await nextFrame();
  world = new World(scene, { full: fullImg }, SET.q);
  setLoad(78, '불을 켜는 중...'); await nextFrame();
  atlasTex = new THREE.Texture(atlasImg); atlasTex.needsUpdate = true;
  monster = new Monster(scene, atlasTex, world, audio);
  monster.onDoor = d => doorSet(d, true, true);
  G.bots = BOT_DEFS.map((d, i) => { const b = new Bot(scene, world, audio, d, i); b.onDoor = dd => doorSet(dd, true, true); b.rig.root.visible = false; b.alive = false; return b; });
  street = buildStreet();
  applyQuality();
  audio.onSubtitle = t => { if (G.mode === 'play' || G.mode === 'modal') say('초록모자', t, 2.2, true); };
  world.onStatue = st => G.mode === 'play' && audio.statue(st.pos);
  G.glints = world.inter.filter(i => i.glint).map(i => i.glint).concat(world.items.filter(i => i.glint).map(i => i.glint));
  { const sel = $('dev-tp'); for (const r of [...new Set(world.inter.map(i => roomAt(i.pos.x, i.pos.z)).filter(Boolean))]) sel.insertAdjacentHTML('beforeend', `<option value="${r.id}">${r.num ? r.num + ' ' : ''}${esc(r.name)}</option>`); }
  setLoad(95, '준비 완료'); await nextFrame();
  renderer.compile(scene, camera);
  $('loading').classList.add('hidden');
  toTitle();
  if (SET.dev) setDev(true, true);
  requestAnimationFrame(loop);
}

/* ── 타이틀 ── */
function toTitle() {
  G.mode = 'title'; curScene = scene; tweens.clear(); skipFlag = false;
  for (const id of [...modalStack]) closeModal(id);
  ['hud', 'cine', 'over', 'ending', 'phone', 'card', 'lobby', 'waitroom'].forEach(id => $(id).classList.add('hidden'));
  $('over').classList.remove('scare', 'showbox'); $('fx-hide').className = 'fx';
  $('title').classList.remove('hidden');
  world.reset(); newRunState();
  G.bots.forEach(b => { b.rig.root.visible = false; b.alive = false; });
  for (const r of G.remotes.values()) r.av.root.visible = false;
  monster.reset(new THREE.Vector3(12.5, 0, 7.9)); monster.enabled = false;
  black(0); white(0); camera.rotation.z = 0;
  renderer.toneMappingExposure = EXP(); scene.fog.color.copy(FOG); scene.background.copy(FOG); exitLight.intensity = 0;
  audio.chase(0, 0); G.titleT = 0; $('tags').innerHTML = ''; tagEls.clear();
}
function titleUpdate(dt) {
  G.titleT += dt; const t = G.titleT;
  camera.position.set(4.5 + Math.sin(t * 0.15) * 0.3, 1.55 + Math.sin(t * 0.5) * 0.04, 8.9);
  camera.lookAt(20, 1.4 + Math.sin(t * 0.11) * 0.05, 9.6);
  monster.face = Math.atan2(camera.position.x - monster.pos.x, camera.position.z - monster.pos.z);
  monster.speed = 0; monster.animate(dt, G); monster.mat.emissiveIntensity = 0.24 + Math.sin(t * 2.3) * 0.05;
  monster.root.visible = !(t % 11 > 10.6);
  world.update(dt, camera.position, monster.pos, camera);
  fill.intensity = 0; audio.ambience(true, dt);
}
$('m-start').onclick = () => { audio.init(); goFull(); if (SET.mic === null) openModal('micask'); else openLobby(); };
$('m-intro').onclick = () => { audio.init(); goFull(); G.mp = false; G.host = true; G.cfg = { bots: 2, diff: 1, max: 1, name: '혼자 하기' }; $('title').classList.add('hidden'); playIntro(); };
$('m-settings').onclick = () => { audio.init(); openSettings(); };
$('m-help').onclick = () => openModal('help');
$('mic-yes').onclick = async () => { closeModal('micask'); await enableMic(true); openLobby(); };
$('mic-no').onclick = () => { closeModal('micask'); SET.mic = false; saveSet(); openLobby(); };
function goFull() { if (!isTouch) return; try { const d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d)?.catch?.(() => { }); screen.orientation?.lock?.('landscape').catch(() => { }); } catch (e) { } }
async function enableMic(on) {
  if (!on) { audio.stopMic(); SET.mic = false; saveSet(); updateMicUI(); return; }
  try { await audio.startMic(); SET.mic = true; }
  catch (e) { SET.mic = false; toast('마이크를 켤 수 없어요. 마이크 없이 진행합니다.<br><small>(권한을 거절했거나, 이 주소에서는 마이크가 막혀 있어요)</small>', 4); }
  saveSet(); updateMicUI();
}
function updateMicUI() { const on = !!audio.mic; $('mic').classList.toggle('off', !on); $('mic').querySelector('i').innerHTML = on ? ICONS.mic : ICONS.micOff; $('s-mic').checked = on; }

/* ── 로비 (로블록스처럼: 내 캐릭터 · 방 목록 · 방 만들기) ── */
function lobbyStatus(st) {
  const el = $('lb-status'); if (!el) return;
  el.className = 'pill ' + (st === 'online' ? 'on' : st === 'offline' ? 'off' : '');
  el.textContent = st === 'online' ? '온라인 · 친구와 같이하기 가능' : st === 'offline' ? '오프라인 · 혼자 + AI 친구' : '연결 확인 중...';
  if (st === 'online') { net.lobbyFn = renderRooms; lobbyMe(); renderRooms(net.listRooms()); } else renderRooms([]);
}
function lobbyMe() { net.lobbyPresence({ n: SET.nick, s: SET.skin }); }
function openLobby() {
  $('title').classList.add('hidden'); $('lobby').classList.remove('hidden'); G.mode = 'lobby';
  $('nick').value = SET.nick; drawSkins(); lobbyStatus(net.status);
  $('mk-name').value = SET.nick + '의 방';
}
function drawSkins() {
  $('skins').innerHTML = SKINS.map((s, i) => `<button type="button" data-skin="${i}" class="${i === SET.skin ? 'on' : ''}" title="${esc(s.name)}" style="background:linear-gradient(#${s.head.toString(16).padStart(6, '0')} 0 30%,#${s.torso.toString(16).padStart(6, '0')} 30% 65%,#${s.legs.toString(16).padStart(6, '0')} 65%)"></button>`).join('');
  $('skins').querySelectorAll('button').forEach(b => b.onclick = () => { SET.skin = +b.dataset.skin; saveSet(); drawSkins(); lobbyMe(); });
  drawAvatar2D($('av-prev'), SKINS[SET.skin]);
}
function drawAvatar2D(c, s) {
  const g = c.getContext('2d'), W = c.width, H = c.height, hx = n => '#' + n.toString(16).padStart(6, '0');
  g.clearRect(0, 0, W, H); const u = H / 6.2, cx = W / 2;
  g.fillStyle = hx(s.legs); g.fillRect(cx - u, 4 * u, u * 0.96, 2 * u); g.fillRect(cx + 0.04 * u, 4 * u, u * 0.96, 2 * u);
  g.fillStyle = hx(s.torso); g.fillRect(cx - u, 2 * u, 2 * u, 2 * u);
  g.fillStyle = hx(s.arms); g.fillRect(cx - 2 * u, 2 * u, u * 0.96, 2 * u); g.fillRect(cx + 1.04 * u, 2 * u, u * 0.96, 2 * u);
  g.fillStyle = hx(s.head); g.beginPath(); g.roundRect ? g.roundRect(cx - 0.62 * u, 0.75 * u, 1.24 * u, 1.2 * u, 0.3 * u) : g.rect(cx - 0.62 * u, 0.75 * u, 1.24 * u, 1.2 * u); g.fill();
  if (s.hair) { g.fillStyle = hx(s.hair); g.fillRect(cx - 0.66 * u, 0.62 * u, 1.32 * u, 0.32 * u); }
  if (s.cap) { g.fillStyle = hx(s.cap); g.fillRect(cx - 0.66 * u, 0.52 * u, 1.32 * u, 0.36 * u); }
  g.fillStyle = '#000'; g.beginPath(); g.ellipse(cx - 0.22 * u, 1.2 * u, 0.05 * u, 0.12 * u, 0, 0, 7); g.ellipse(cx + 0.22 * u, 1.2 * u, 0.05 * u, 0.12 * u, 0, 0, 7); g.fill();
  g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(cx, 1.35 * u, 0.25 * u, 0.3, Math.PI - 0.3); g.stroke();
}
function renderRooms(list) {
  const el = $('room-list'); if (!el) return;
  if (!net.online) { el._html = ''; el.innerHTML = '<div class="empty">친구와 같이하기는 claude.ai 게임 링크에서 열었을 때만 돼요.<br>지금은 아래 버튼으로 AI 친구와 함께 할 수 있어요.</div>'; return; }
  if (!list.length) { el._html = ''; el.innerHTML = '<div class="empty">아직 열린 방이 없어요. "방 만들기"로 첫 방을 만들어 보세요!</div>'; return; }
  const html = list.map(r => `<div class="room"><b>${esc(r.name)}</b><small>${r.n}/${r.max}명${r.bots ? ' · AI ' + r.bots : ''}${r.started ? ' · 게임 중' : ''}</small><button class="menu small" data-join="${esc(r.code)}" ${r.n >= r.max || r.mine ? 'disabled' : ''}>참가</button></div>`).join('');
  if (html === el._html) return; el._html = html; el.innerHTML = html;
  el.querySelectorAll('[data-join]').forEach(b => b.onclick = () => joinRoom(b.dataset.join));
}
$('nick').oninput = e => { SET.nick = e.target.value.trim().slice(0, 10) || '뉴비'; saveSet(); lobbyMe(); };
document.querySelectorAll('[data-lt]').forEach(b => b.onclick = () => { document.querySelectorAll('[data-lt]').forEach(x => x.classList.toggle('on', x === b)); $('lt-list').classList.toggle('hidden', b.dataset.lt !== 'list'); $('lt-make').classList.toggle('hidden', b.dataset.lt !== 'make'); });
$('lb-back').onclick = () => { leaveGame(); toTitle(); };
$('quick').onclick = () => { G.mp = false; G.host = true; G.cfg = { bots: 2, diff: 1, max: 1, name: '혼자 하기' }; $('lobby').classList.add('hidden'); if (!SET.seenIntro) playIntro(); else startRun(true); };
$('mk-go').onclick = async () => {
  const cfg = { name: ($('mk-name').value.trim() || SET.nick + '의 방').slice(0, 16), max: +$('mk-max').value, bots: +$('mk-bots').value, diff: +$('mk-diff').value };
  if (!net.online || cfg.max === 1) { G.mp = false; G.host = true; G.cfg = cfg; $('lobby').classList.add('hidden'); startRun(true); return; }
  try { const code = await net.create(cfg); G.mp = true; G.host = true; G.cfg = cfg; G.epoch = 0; enterWaitroom(code); }
  catch (e) { toast('방을 만들지 못했어요. 잠시 뒤 다시 해 보세요.', 3); }
};
$('join-form').onsubmit = e => { e.preventDefault(); const c = $('join-code').value.trim(); if (c) joinRoom(c); };
async function joinRoom(code) {
  if (!net.online) { toast('친구와 같이하기는 claude.ai 게임 링크에서만 돼요.', 3); return; }
  try { await net.enter(code); G.mp = true; G.host = false; G.epoch = 0; G.sawHost = false; G.noHostT = 0; G.seenHit = undefined; G.seenPull = undefined; enterWaitroom(code); }
  catch (e) { toast('방에 들어가지 못했어요. 코드를 확인해 주세요.', 3); }
}
function enterWaitroom(code) {
  $('lobby').classList.add('hidden'); $('waitroom').classList.remove('hidden'); G.mode = 'wait';
  $('wr-code').textContent = code; net.peerFn = onGamePeers;
  sendMe(true); renderWait();
}
function renderWait() {
  if (G.mode !== 'wait') return;
  const ps = net.peers(), hp = net.hostPeer(), cfg = G.host ? G.cfg : (hp && hp.presence.cfg) || G.cfg;
  $('wr-name').textContent = cfg.name || '방';
  const rows = ps.map(p => { const s = SKINS[(p.presence.s | 0) % SKINS.length]; return `<li><span class="dot" style="background:#${s.torso.toString(16).padStart(6, '0')}"></span>${esc(p.presence.n || '...')}${p.isMe && p.sameTab ? ' (나)' : ''}${p.presence.host === true ? '<em>방장</em>' : ''}</li>`; });
  for (let i = 0; i < (cfg.bots | 0); i++) rows.push(`<li><span class="dot" style="background:#${SKINS[BOT_DEFS[i].skin].torso.toString(16).padStart(6, '0')}"></span>${BOT_DEFS[i].name}<em>AI 친구</em></li>`);
  $('wr-list').innerHTML = rows.join('');
  $('wr-start').classList.toggle('hidden', !G.host);
  $('wr-hint').textContent = G.host ? `${ps.length}/${cfg.max}명 · 준비되면 게임 시작을 누르세요` : '방장이 게임을 시작하기를 기다리는 중...';
  if (G.host) { const lp = { n: SET.nick, s: SET.skin, host: { code: net.code, name: cfg.name, n: ps.length, max: cfg.max, bots: cfg.bots, st: G.epoch ? 1 : 0 } }, j = JSON.stringify(lp); if (j !== G.lastLobby) { G.lastLobby = j; net.lobbyPresence(lp); } }
}
$('wr-start').onclick = () => { if (!G.host) return; G.epoch = Date.now() % 1e9; $('waitroom').classList.add('hidden'); startRun(true); };
$('wr-leave').onclick = () => { leaveGame(); openLobby(); };
function leaveGame() { if (net.game) net.leave(); G.mp = false; G.host = true; G.remotes.forEach(r => r.av.root.parent && r.av.root.parent.remove(r.av.root)); G.remotes.clear(); }
// 방 사람들이 바뀌었을 때
function onGamePeers(ch) {
  G.myPeer = (ch.peers.find(p => p.isMe && p.sameTab) || {}).peer || G.myPeer;
  for (const p of ch.left) { const r = G.remotes.get(p.peer); if (r) { r.av.root.parent && r.av.root.parent.remove(r.av.root); G.remotes.delete(p.peer); addLog('', `${r.n}님이 나갔다`, 'sys'); } }
  if (G.mode === 'wait') renderWait();
}
// 방장이 나간 지 3초가 지나면 남은 사람 중 한 명이 이어받는다
function checkHost(dt) {
  if (!G.mp || G.host) return;
  if (net.hostPeer()) { G.sawHost = true; G.noHostT = 0; return; }
  if (!G.sawHost) return;
  G.noHostT = (G.noHostT || 0) + dt; if (G.noHostT < 3) return;
  const cands = net.peers().filter(p => p.kind === 'viewer').map(p => p.peer).sort();
  if (cands[0] && cands[0] === G.myPeer) {
    G.host = true; net.isHost = true; G.cfg = G.lastHostCfg || G.cfg; addLog('', '방장이 나가서 내가 방장이 되었다', 'sys');
    for (const b of G.bots) { b.state = 'idle'; b.path = []; } monster.state = 'patrol'; monster.path = []; monster.enabled = true; sendMe(true);
  }
}

/* ── 프롤로그: 납치 (1인칭) ── */
function buildStreet() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x04060b); s.fog = new THREE.FogExp2(0x04060b, 0.055);
  s.add(new THREE.HemisphereLight(0x50608a, 0x101018, 1.1));
  const moon = new THREE.DirectionalLight(0x8090c0, 1.1); moon.position.set(-6, 10, 8); s.add(moon);
  const asphalt = (() => { const [c, g] = cv(256); g.fillStyle = '#1c1c1e'; g.fillRect(0, 0, 256, 256); const d = g.getImageData(0, 0, 256, 256); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 40; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } g.putImageData(d, 0, 0); const t = toTex(c); t.repeat.set(30, 8); return t; })();
  const brick = (() => { const [c, g] = cv(256); g.fillStyle = '#2a1a16'; g.fillRect(0, 0, 256, 256); for (let y = 0; y < 256; y += 32) for (let x = -(y / 32 % 2) * 32; x < 256; x += 64) { g.fillStyle = `rgb(${70 + Math.random() * 30},${34 + Math.random() * 14},${26 + Math.random() * 10})`; g.fillRect(x + 2, y + 2, 60, 28); } const t = toTex(c); t.repeat.set(24, 1); return t; })();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 24), new THREE.MeshLambertMaterial({ map: asphalt })); ground.rotation.x = -Math.PI / 2; ground.position.z = 6; s.add(ground);
  const walk = new THREE.Mesh(new THREE.BoxGeometry(90, 0.14, 3), new THREE.MeshLambertMaterial({ color: 0x3a3a3c })); walk.position.set(0, 0.07, -1.5); s.add(walk);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(90, 2.2, 0.3), new THREE.MeshLambertMaterial({ map: brick })); wall.position.set(0, 1.1, -3.2); s.add(wall);
  for (let i = 0; i < 9; i++) {
    const h = 5 + Math.random() * 5, house = new THREE.Mesh(new THREE.BoxGeometry(7, h, 6), new THREE.MeshLambertMaterial({ color: 0x0c0c12 })); house.position.set(-36 + i * 9, h / 2, -9); s.add(house);
    if (Math.random() < 0.5) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshBasicMaterial({ color: 0x6a5020 })); w.position.set(house.position.x + (Math.random() - 0.5) * 3, h * 0.6, -5.95); s.add(w); }
    const h2 = 4 + Math.random() * 4, house2 = new THREE.Mesh(new THREE.BoxGeometry(7, h2, 6), house.material); house2.position.set(-36 + i * 9, h2 / 2, 17); s.add(house2);
  }
  const lamps = [];
  for (const x of [-14, 0, 14]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), new THREE.MeshLambertMaterial({ color: 0x222 })); pole.position.set(x, 2.2, -2.7); s.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), pole.material); arm.position.set(x, 4.35, -2.2); s.add(arm);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.25), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })); bulb.position.set(x, 4.3, -1.7); s.add(bulb);
    const sp = new THREE.SpotLight(0xffc888, 60, 14, 0.75, 0.6, 1.3); sp.position.set(x, 4.25, -1.7); sp.target.position.set(x, 0, -1.2); s.add(sp, sp.target);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4.2, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.025, fog: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.position.set(x, 2.15, -1.4); s.add(cone);
    lamps.push({ x, sp, bulb, cone });
  }
  const rig = buildGreenHat(atlasTex), gh = rig.root; gh.visible = false; s.add(gh);
  return { scene: s, lamps, gh, rig };
}
function lampSet(l, v) { l.sp.intensity = 60 * v; l.bulb.material.color.setRGB(1 * v + 0.05, 0.85 * v + 0.04, 0.62 * v + 0.03); l.cone.material.opacity = 0.025 * v; }

async function playIntro() {
  G.mode = 'cine'; G.safe = true; G.cineFn = null; skipFlag = false;
  $('hud').classList.add('hidden'); $('cine').classList.remove('hidden'); $('b-skip').classList.remove('hidden');
  black(1); audio.ambience(false, 0);
  const pl = G.player;
  try {
    await cineText('어느 날 밤, 휴대폰이 울렸다.', 2.4);
    await phoneSeq();
    // 골목길 — 내 눈으로 걷는다
    curScene = street.scene; street.lamps.forEach(l => lampSet(l, 1)); street.gh.visible = false; audio.street(true);
    pl.pos.set(-11, 0, -1.2); G.eyeH = EYE + 0.14; G.camYaw = -Math.PI / 2; G.camPitch = -0.06; G.roll = 0; G.speed = 0;
    let lastStep = 0; const gh = street.gh, rig = street.rig; let ghSpeed = 0, ghPh = 0, ghChase = false, lunge = false;
    G.cineFn = dt => {
      G.walkPh += dt * G.speed * 2.6;
      const st = Math.floor(G.walkPh / Math.PI); if (G.speed > 0.1 && st !== lastStep) { lastStep = st; audio.step('wood', false); }
      firstPersonCam(dt);
      if (gh.visible) {
        // 초록모자가 플레이어 쪽으로 천천히 걸어온다 (관절 걷기)
        const prev = ghPh; gh.position.x = Math.min(gh.position.x + ghSpeed * dt, pl.pos.x - 1.2); ghPh += dt * ghSpeed * 2.3;
        if (ghSpeed > 0 && Math.floor(prev / Math.PI) !== Math.floor(ghPh / Math.PI)) audio.monsterStep({ x: gh.position.x, z: -1.2 }, false);
        const sw = Math.sin(ghPh) * (ghSpeed > 0 ? 0.55 : 0);
        rig.legR.rotation.x = sw; rig.legL.rotation.x = -sw;
        if (!lunge) { rig.armR.rotation.x = ghChase ? -1.4 + sw * 0.2 : -sw * 0.9; rig.armL.rotation.x = ghChase ? -1.4 - sw * 0.2 : sw * 0.9; }
        rig.hips.position.y = Math.abs(Math.cos(ghPh)) * 0.05 * (ghSpeed > 0 ? 1 : 0);
        gh.rotation.y = Math.PI / 2; rig.neck.rotation.z = Math.sin(performance.now() / 300) * 0.1;
      }
    };
    black(0, 1.4);
    G.speed = 2.0;
    say('나', '(초록모자? 모르는 사람이잖아... 그냥 무시하자.)', 3.2);
    const walkTo = (x, d) => { const a = pl.pos.x; return tween(d, k => pl.pos.x = a + (x - a) * k); };
    for (const [ms, dx] of [[2400, 12], [3000, 11.5], [3600, 11]]) setTimeout(() => !skipFlag && G.mode === 'cine' && audio.monsterStep({ x: pl.pos.x - dx, z: -1 }, false), ms);
    setTimeout(() => !skipFlag && G.mode === 'cine' && audio.play('owl', { vol: 0.35 }), 1200);
    await S(walkTo(-3, 4.4));
    G.speed = 0; say('나', '...누구 있어요?', 2.2);
    // 뒤돌아보면 저 멀리 가로등 아래에 서 있다
    gh.visible = true; gh.position.set(-14, 0.14, -1.25); ghSpeed = 0;
    await S(view(null, null, Math.PI / 2, -0.02, 1.0));
    await S(wait(1.8));
    say('나', '저 사람... 왜 날 쳐다보지?', 2);
    await S(view(null, null, -Math.PI / 2, -0.06, 0.8));
    ghSpeed = 1.3;                                         // 천천히 따라오기 시작
    G.speed = 2.3; await S(walkTo(0.4, 2.6)); G.speed = 0;
    say('나', '...아직도 따라와?', 1.8);
    await S(view(null, null, Math.PI / 2, 0, 0.8));          // 다시 뒤돌아보면 더 가까이 와 있다
    ghSpeed = 1.6; await S(wait(1.6));
    // 가로등 깜빡 → 꺼짐 → 켜지면 바로 앞까지
    const L = street.lamps[1];
    for (let i = 0; i < 6; i++) { lampSet(L, i % 2 ? 1 : 0.1); audio.light(); await S(wait(0.08 + Math.random() * 0.15)); }
    street.lamps.forEach(l => lampSet(l, 0)); audio.light();
    ghSpeed = 2.4; await S(wait(1.0)); ghSpeed = 0;
    gh.position.x = Math.max(gh.position.x, pl.pos.x - 2.2); ghChase = true;
    street.lamps.forEach(l => lampSet(l, 1)); audio.stinger(); G.shake = 0.3;
    await S(view(null, null, null, 0.12, 0.4));
    say('초록모자', '팔로우... 안 했지?', 2.6, true); audio.monsterVoice('팔로우... 안 했지?', gh.position);
    await S(wait(2.4));
    audio.scream(gh.position); G.shake = 0.8;
    const gx = gh.position.x;
    lunge = true;
    await S(tween(0.4, k => { gh.position.x = gx + 1.5 * ease(k); rig.armR.rotation.x = rig.armL.rotation.x = -2.6 * ease(k); G.camPitch = 0.12 + k * 0.15; }));
    black(1); G.cineFn = null; audio.street(false); audio.hit();
    await S(wait(0.8));
    say('', '[무언가에 질질 끌려가는 소리]', 3); audio.drag();
    await S(wait(3.4));
    say('초록모자', '팔로우 안 한 사람... 한 명 더.', 2.8, true);
    await S(wait(2.8)); audio.slam(); await S(wait(1.3));
  } catch (e) { if (e !== SKIP) console.error(e); }
  skipFlag = false; tweens.clear(); G.cineFn = null; G.speed = 0; G.shake = 0; audio.street(false);
  $('phone').classList.add('hidden'); $('cine-text').classList.remove('show'); $('sub').className = '';
  SET.seenIntro = true; saveSet();
  startRun(true);
}
async function phoneSeq() {
  const ph = $('phone'), P = ph.querySelector('.ph'), fin = $('ph-finger');
  ph.classList.remove('hidden'); P.className = 'ph'; black(0);
  $('ph-noti').classList.remove('show'); $('ph-chat').classList.remove('show'); $('ph-chat').innerHTML = '';
  $('ph-profile').style.opacity = 0; $('ph-later').classList.remove('tap');
  fin.innerHTML = ICONS.finger; const pr0 = P.getBoundingClientRect();
  fin.style.left = pr0.width * 0.7 + 'px'; fin.style.top = pr0.height * 1.1 + 'px';
  await S(wait(0.7)); audio.ding(); $('ph-noti').classList.add('show');
  await S(wait(2.2)); $('ph-noti').classList.remove('show'); $('ph-profile').style.opacity = 1;
  await S(wait(1.0));
  const pr = P.getBoundingClientRect(), br = $('ph-later').getBoundingClientRect();
  fin.style.left = (br.left + br.width / 2 - pr.left - 21) + 'px'; fin.style.top = (br.top + br.height / 2 - pr.top - 4) + 'px';
  await S(wait(1.1)); fin.classList.add('tap'); $('ph-later').classList.add('tap'); audio.beep(true);
  await S(wait(0.25)); fin.classList.remove('tap'); await S(wait(0.4));
  fin.style.top = pr.height * 1.1 + 'px'; await S(wait(0.9));
  const chat = $('ph-chat'); chat.classList.add('show');
  chat.innerHTML = `<div class="who"><img src="assets/greenhat_face.png" alt="">초록모자</div>`;
  for (const [t, red, d] of [['왜 맞팔 안 해?', 0, 1.3], ['나 계속 기다렸는데', 0, 1.3], ['팔로우 안 하면...', 0, 1.6], ['내가 직접 데리러 갈게 :)', 1, 2.4]]) {
    const m = document.createElement('div'); m.className = 'msg' + (red ? ' red' : ''); m.textContent = t; chat.appendChild(m);
    red ? audio.glitch() : audio.ding(); await S(wait(d));
  }
  P.classList.add('glitch'); audio.glitch(); await S(wait(0.9));
  P.classList.remove('glitch'); P.classList.add('off'); await S(wait(0.9));
  ph.classList.add('hidden'); black(1);
}

/* ── 새 판 ── */
function newRunState() {
  Object.assign(G, { hp: 100, st: 100, tired: false, lastHurt: -99, caught: 0, time: 0, chaseTime: 0, busy: false, inv: {}, used: {}, diaries: new Set(), focus: null, shake: 0, roll: 0, eyeH: EYE, speed: 0, pose: 'stand', y: 0, bandage: 0, escaped: false, acts: [], lockout: {} });
  G.player.hidden = false; G.player.spot = null; G.player.running = false;
  G.occ.clear(); G.clueLog = []; G.memos = []; G.botMemos = []; G.hinted.clear();
  do { G.code = [0, 0, 0, 0].map(() => Math.random() * 10 | 0); } while (new Set(G.code).size < 3);
  input.runToggle = false;
}
function newRun() {
  world.reset(); newRunState(); renderInv(); updateButtons();
  monster.reset(new THREE.Vector3(38.4, 0, 8.5)); monster.face = -Math.PI / 2; monster.timer = 15; monster.enabled = true;
  monster.speedMul = [0.8, 1, 1.2][G.cfg.diff | 0]; monster.sightMul = [0.8, 1, 1.15][G.cfg.diff | 0];
  G.dripT = 2;
  // AI 친구들: 같이 납치되어 침실 바닥에 쓰러져 있다
  const spots = [[5.8, 2.2], [6.4, 4.4], [3.2, 5.6]];
  G.bots.forEach((b, i) => { const on = i < (G.cfg.bots | 0); b.reset(new THREE.Vector3(...[spots[i][0], 0, spots[i][1]])); b.alive = on; b.rig.root.visible = on; b.face = Math.random() * 6; b.mode = 'follow'; });
  for (const h of world.hides) h.doors.forEach(d => d.piv.visible = true);
  renderer.toneMappingExposure = EXP(); scene.fog.color.copy(FOG); scene.background.copy(FOG); exitLight.intensity = 0;
  $('fx-hide').className = 'fx'; $('hidden-tag').classList.remove('show', 'danger');
  renderTeam();
}

/* ── 깨어남 → 플레이 ── */
async function startRun(card) {
  newRun();
  if (G.mp && !G.host) { const hp = net.hostPeer(); if (hp && hp.presence.w) G.code = String(hp.presence.w.code || '0000').split('').map(Number); }
  G.mode = 'cine'; G.safe = true; curScene = scene; skipFlag = false;
  $('hud').classList.add('hidden'); $('cine').classList.remove('hidden'); $('b-skip').classList.remove('hidden'); $('waitroom').classList.add('hidden'); $('lobby').classList.add('hidden'); $('title').classList.add('hidden');
  const pl = G.player;
  pl.pos.set(2.6, 0, 0.75); G.eyeH = 0.95; G.camYaw = Math.PI; G.camPitch = 1.35; G.roll = 0.15;
  G.cineFn = dt => { firstPersonCam(dt); world.update(dt, pl.pos, monster.pos, camera); for (const b of G.bots) if (b.alive) b.anim(dt); fill.position.set(pl.pos.x, 2, pl.pos.z); fill.intensity = 1.0; };
  black(1);
  try {
    await S(black(0.35, 1.0)); await S(black(0.9, 0.5)); await S(black(0, 1.2));
    say('나', '으... 머리야...', 2); await S(wait(1.6));
    await S(Promise.all([view(new THREE.Vector3(2.6, 0, 1.3), 1.2, Math.PI, -0.15, 1.1), tween(1.1, k => G.roll = 0.15 * (1 - k))]));
    await S(view(new THREE.Vector3(4.05, 0, 1.75), EYE, -Math.PI / 2 + 0.5, -0.05, 1.0));
    say('나', '여긴... 어디지?', 2);
    await S(view(null, null, -Math.PI / 2 - 0.6, 0, 1.2));
    await S(view(null, null, -Math.PI / 2, -0.08, 0.8));
  } catch (e) { if (e !== SKIP) console.error(e); }
  skipFlag = false; tweens.clear(); black(0); $('sub').className = '';
  const k = G.mp ? (hashStr(G.myPeer || 'a') % 4) * 0.5 : 0;
  pl.pos.set(4.05 + k * 0.4, 0, 1.75 + k); G.eyeH = EYE; G.camYaw = -Math.PI / 2; G.camPitch = -0.08; G.roll = 0;
  $('cine').classList.add('hidden'); $('hud').classList.remove('hidden'); updateButtons();
  G.mode = 'play'; G.safe = false; G.cineFn = null;
  if (card) { const c = $('card'); c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; setTimeout(() => c.classList.add('hidden'), 4200); }
  setTimeout(() => G.mode === 'play' && toast(isTouch ? '왼쪽 <b>조이스틱</b>으로 이동 · 화면을 <b>끌어서</b> 둘러보기' : '<b>WASD</b> 이동 · <b>마우스</b> 둘러보기 · <b>E</b> 조사 · <b>H</b> 숨기 · <b>C/Z</b> 숙이기/엎드리기 · <b>T</b> 말하기', 4.5), 4300);
  setTimeout(() => G.mode === 'play' && toast(audio.mic ? '초록모자는 <b>목소리</b>를 듣는다. 크게 말하지 마...' : '초록모자는 저택을 돌아다닌다. <b>눈에 띄지 마...</b>', 4), 9500);
  G.bots.forEach((b, i) => { if (b.alive && G.host) setTimeout(() => G.mode === 'play' && b.say(G.botApi, ['여긴... 어디야? 너도 잡혀 왔어?', '나도 초록모자 팔로우 안 했다가 끌려왔어...', '같이 나가자. 혼자는 무서워.'][i % 3], true), 1500 + i * 2200); });
  if (G.bots.some(b => b.alive)) setTimeout(() => G.mode === 'play' && toast('같이 끌려온 <b>AI 친구</b>들이 있다. 말하기 버튼으로 <b>"따라와" "기다려" "흩어져" "숨어"</b>라고 하면 말을 들어요', 5), 15000);
  const ck = world.sfx.find(x => x.kind === 'clock'); if (ck) audio.loopAt('clock', 'clock', { pos: ck.pos, vol: 0.8, ref: 1.2, roll: 1.6 });
  sendMe(true);
}
$('b-skip').onclick = () => { if (G.mode === 'cine') skipFlag = true; };
function hashStr(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

/* ── 탈출 ── */
async function startExit() {
  G.mode = 'cine'; G.safe = true; monster.enabled = false; G.busy = true; toggleChat(false); if (G.player.hidden && G.player.spot) { G.player.hidden = false; G.player.spot.doors.forEach(d => d.piv.visible = true); $('fx-hide').className = 'fx'; } G.pose = 'stand'; G.y = 0;
  $('hud').classList.add('hidden'); $('cine').classList.remove('hidden'); $('b-skip').classList.add('hidden');
  audio.chase(0, 0);
  const f = world.front, pl = G.player;
  f.col.on = false; f.outside.visible = true; f.crack.forEach(c => c.visible = false);
  if (monster.pos.distanceTo(pl.pos) < 6) monster.root.visible = false;
  G.speed = 0;
  G.cineFn = dt => { G.walkPh += dt * G.speed * 2.6; firstPersonCam(dt); world.update(dt, pl.pos, null, camera); };
  // 문 앞으로 시선을 옮긴다
  G.speed = 1.2;
  await view(new THREE.Vector3(22, 0, 28.7), EYE, Math.PI, 0.02, 1.4);
  G.speed = 0;
  audio.door({ x: 22, y: 1.5, z: 30 }, true); audio.wind(true); audio.stopLoop('clock', 1);
  const W = new THREE.Color(0xfff8ec);
  await tween(2.6, k => {
    const e = ease(k);
    f.doors.forEach((d, i) => d.rotation.y = (i ? 1 : -1) * 1.65 * e);
    exitLight.intensity = 40 * e; renderer.toneMappingExposure = EXP() + e * 1.6;
    scene.fog.color.copy(FOG).lerp(W, e * 0.8); scene.background.copy(scene.fog.color); white(e * 0.2);
  });
  G.speed = 2.0;
  const a = pl.pos.clone(), b = new THREE.Vector3(22, 0, 31.8);
  await tween(3.0, k => { pl.pos.lerpVectors(a, b, k); G.camPitch = 0.02 + k * 0.12; white(0.2 + 0.8 * clamp((k - 0.3) / 0.7, 0, 1)); renderer.toneMappingExposure = EXP() + 1.6 + k * 2; });
  G.speed = 0; G.cineFn = null;
  $('cine').classList.add('hidden');
  const tsec = Math.round(G.time), mm = (tsec / 60 | 0), ss = String(tsec % 60).padStart(2, '0');
  if (!SET.best || tsec < SET.best) SET.best = tsec; saveSet();
  $('end-stats').innerHTML = `탈출 시간 <b>${mm}:${ss}</b> · 공격당한 횟수 <b>${G.caught}</b> · 최고 기록 <b>${SET.best / 60 | 0}:${String(SET.best % 60).padStart(2, '0')}</b><br>소리 감지 센서: ${audio.mic ? '켜짐' : '꺼짐'}`;
  $('ending').classList.remove('hidden'); G.mode = 'end';
}
$('e-title').onclick = () => { leaveGame(); toTitle(); };

/* ── HUD ── */
function renderInv() {
  $('inv').innerHTML = KEY_ORDER.filter(k => G.inv[k]).map(k => `<div class="key ${k}${G.used[k] ? ' used' : ''}" title="${KEYS[k]}">${ICONS.key}</div>`).join('');
  const nk = KEY_ORDER.filter(k => G.inv[k]).length, nd = G.diaries.size;
  $('c-key').textContent = nk + '/4'; $('c-key').classList.toggle('done', nk === 4);
  $('c-diary').textContent = nd + '/4'; $('c-diary').classList.toggle('done', nd === 4);
  $('b-heal').classList.toggle('hidden', G.bandage <= 0); $('heal-n').textContent = '붕대 ' + G.bandage;
}
function objective() {
  const d = world.doors, f = world.front, nd = G.diaries.size;
  if (!G.diaries.has(1)) return '방을 살펴보자 — 책상 위에 무언가 있다';
  if (!G.inv.rusty) return '녹슨 열쇠를 찾자 (08 부엌)';
  if (d.study.locked) return '녹슨 열쇠로 04 서재를 열자';
  if (!G.diaries.has(2)) return '04 서재를 조사하자';
  if (!G.inv.silver) return '은색 열쇠를 찾자 (05 음악실)';
  if (d.kids.locked) return '은색 열쇠로 06 아이방을 열자';
  if (!G.inv.iron) return '06 아이방에서 검은 열쇠를 찾자';
  if (d.gal.locked) return '검은 열쇠로 09 갤러리를 열자';
  if (!G.diaries.has(4)) return '갤러리 너머 20 초상화 방을 찾아보자';
  if (!G.inv.gold) return `미로 별관 가장 깊은 곳, ${MAZE_INFO.gold}에서 금색 열쇠를 찾자`;
  if (nd < 4) return `일기를 모두 모으자 (${nd}/4) — 비밀번호가 적혀 있다`;
  if (f.padlock || f.keypad) return '현관문을 열자 — 금색 열쇠 + 비밀번호';
  return '현관문으로 탈출하라!';
}
function updateButtons() {
  $('b-run').classList.toggle('on', input.runToggle);
  $('b-crouch').classList.toggle('on', G.pose === 'crouch'); $('b-prone').classList.toggle('on', G.pose === 'prone');
  $('b-hide').classList.toggle('on', G.player.hidden); $('b-hide').querySelector('span').textContent = G.player.hidden ? '나가기' : '숨기';
  $('flybtns').classList.toggle('hidden', !G.dev.fly);
}
function renderTeam() {
  const rows = [];
  for (const b of G.bots) if (b.def && (b.alive || b.state === 'caught') && b.idx < (G.cfg.bots | 0)) rows.push(`<div class="${b.alive ? '' : 'gone'}"><span class="sw" style="background:#${b.skin.torso.toString(16).padStart(6, '0')}"></span>${b.name}<span class="hpm"><i style="width:${Math.max(0, b.hp)}%"></i></span>${b.alive ? (b.hidden ? ' 숨음' : b.mode === 'wait' ? ' 대기' : b.mode === 'explore' ? ' 탐색' : '') : ' 잡혀감'}</div>`);
  for (const r of G.remotes.values()) rows.push(`<div class="${r.al === 0 ? 'gone' : ''}"><span class="sw" style="background:#${SKINS[r.s % SKINS.length].torso.toString(16).padStart(6, '0')}"></span>${esc(r.n)}<span class="hpm"><i style="width:${r.hp}%"></i></span></div>`);
  $('team').innerHTML = rows.join('');
}
function interLabel(it) {
  switch (it.kind) {
    case 'door': { const d = it.door; if (d.locked) return G.inv[d.lock] ? `${KEYS[d.lock]}로 열기` : `${d.name} — 잠김`; return d.open ? '문 닫기' : '문 열기'; }
    case 'hide': return it.spot.label;
    case 'diary': return '일기 줍기';
    case 'front': { const f = world.front; if (f.padlock) return G.inv.gold ? '금색 열쇠로 자물쇠 풀기' : '현관문 살펴보기'; if (f.keypad) return '비밀번호 입력'; return '문 열고 나가기'; }
    case 'bot': { const b = it.bot; return `${b.name}에게 ${b.mode === 'follow' ? '"기다려"' : '"따라와"'}`; }
    default: return it.label || '살펴보기';
  }
}
function findInter() {
  const p = G.player.pos, fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw); let best = null, bs = 1e9;
  const list = world.inter.concat(G.host ? G.bots.filter(b => b.alive && !b.hidden).map(b => (b._it = b._it || { kind: 'bot', bot: b, pos: b.pos, r: 1.6 })) : []);
  for (const it of list) {
    if (it.kind === 'diary' && it.read) continue; if (it.kind === 'drawer' && it.opened) continue;
    if (it.kind === 'hide' && spotBusy(it.spot, 'me')) continue;
    const dx = it.pos.x - p.x, dz = it.pos.z - p.z, d = Math.hypot(dx, dz);
    if (d > (it.r || 1.3) + 0.2) continue;
    const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
    if (dot < 0.45 && d > 0.6) continue;
    const s = d * (1.6 - dot) + (it.kind === 'bot' ? 0.6 : 0);
    if (s < bs) { bs = s; best = it; }
  }
  return best;
}
let lastAct = '';
function updateHUD(dt) {
  $('hp-fill').style.width = G.hp + '%'; $('st-fill').style.width = G.st + '%'; $('st-fill').classList.toggle('tired', G.tired);
  $('objective').textContent = objective();
  const pl = G.player, btn = $('b-act'); let key;
  if (pl.hidden) key = 'out';
  else if (G.focus && !G.busy) key = 'f:' + interLabel(G.focus);
  else key = 'none';
  if (key !== lastAct) {
    lastAct = key;
    btn.querySelector('i').innerHTML = pl.hidden ? ICONS.door : ICONS.hand;
    btn.querySelector('span').textContent = pl.hidden ? '나가기' : '조사';
    btn.classList.toggle('ready', key.startsWith('f:')); btn.classList.toggle('dim', key === 'none');
    $('cross').className = key.startsWith('f:') ? 'on' : pl.hidden ? 'off' : '';
    const pr = $('prompt');
    if (key.startsWith('f:')) { pr.textContent = (isTouch ? '' : '[E] ') + key.slice(2); pr.classList.add('show'); }
    else if (pl.hidden) { pr.textContent = (isTouch ? '' : '[E] ') + '밖으로 나가기'; pr.classList.add('show'); }
    else pr.classList.remove('show');
    updateButtons();
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
  if (heardT > 0) { heardT -= dt; if (heardT <= 0) { $('heard').classList.remove('show'); $('mic').classList.remove('alert'); } }
  G.teamT = (G.teamT || 0) - dt; if (G.teamT <= 0) { G.teamT = 0.5; renderTeam(); }
}

/* ── 저택 상태 바꾸기 (혼자/같이 공통) ── */
const where = p => { const r = roomAt(p.x, p.z); return r ? (r.num ? r.num + ' ' : '') + r.name : '저택'; };
function addClue(text, pos, key) {
  if (key && G.clueLog.some(c => c.key === key)) return;
  G.clueLog.unshift({ text, where: pos ? where(pos) : '', key, t: G.time });
}
function lock(k) { G.lockout[k] = G.time + 2; }
function doorSet(d, open, quiet) { if (d.open === open) return; d.setOpen(open); open ? audio.door(d.pos, quiet) : audio.doorClose(d.pos); }
function unlockDoor(d) { if (!d.locked) return; d.unlock(); world.reachDirty = true; G.used[d.lock] = true; audio.unlock(); renderInv(); setTimeout(() => doorSet(d, true), 350); }
async function openItem(it, mine) {
  if (it.opened) return; it.opened = true; audio.drawer();
  await tween(0.45, k => { if (it.lid) it.dr.rotation.x = -1.9 * ease(k); else it.dr.position.copy(it.slide).multiplyScalar(ease(k)); });
  if (it.item) {
    if (it.glint) it.glint.visible = true;
    await wait(0.35);
    const k = it.item.key; it.mesh.visible = false; if (it.glint) it.glint.visible = false;
    if (k === 'bandage') { if (mine) { G.bandage++; audio.pickup(); toast('<b>붕대</b>를 얻었다! 다쳤을 때 붕대 버튼으로 치료할 수 있다.', 3); } }
    else {
      G.inv[k] = true; audio.pickup(); addClue(`${KEYS[k]}를 찾았다`, it.pos, 'key-' + k);
      toast(`${mine ? '' : '친구가 '}<b>${KEYS[k]}</b>를 찾았다! (열쇠 ${KEY_ORDER.filter(x => G.inv[x]).length}/4)`, 3);
      if (G.host) G.bots.forEach(b => b.alive && Math.random() < 0.5 && b.say(G.botApi, '좋았어! 하나 찾았다!'));
    }
    renderInv();
  } else if (mine) toast(it.text || '비어 있다.', it.text ? 4 : 2);
  if (mine && it.text) addClue(it.text, it.pos, 'item-' + it.id);
}
function readDiary(it, mine, who, quiet) {
  if (it.read) return; it.read = true; it.mesh.visible = false; it.glint.visible = false; G.diaries.add(it.id); audio.book(); renderInv();
  addClue(`일기 ${it.id} — 비밀번호 ${it.id}번째 숫자는 『 ${G.code[it.id - 1]} 』`, it.pos, 'diary-' + it.id);
  if (mine) { if (!quiet) openNotes('d' + it.id); } else toast(`${esc(who || '친구')}가 <b>일기 ${it.id}</b>을 찾았다! 일기 버튼으로 읽을 수 있어요`, 3);
}
function frontPad() { const f = world.front; if (!f.padlock) return; f.padlock = false; G.used.gold = true; f.chain.visible = false; audio.unlock(); audio.play('metal_light', { vol: 0.6, delay: 0.3 }); renderInv(); }
function frontKeypad() { const f = world.front; if (!f.keypad) return; f.keypad = false; f.screen.material.color.setHex(0x0a4010); }
// 내가 한 일: 바로 적용하고, 같이하기면 방장에게 알린다
function act(k, id, v) {
  const a = { i: ++G.actI, k, id, v };
  if (k === 'door') { lock('d' + id); doorSet(world.doors[id], !!v); }
  if (k === 'unlock') { lock('d' + id); unlockDoor(world.doors[id]); }
  if (k === 'item') openItem(world.items[id], true);
  if (k === 'diary') readDiary(diaryById(id), true, null, v);
  if (k === 'pad') frontPad();
  if (k === 'kp') frontKeypad();
  if (k === 'esc') { G.escaped = true; startExit(); }
  if (G.mp && !G.host) { G.acts.push(a); G.acts = G.acts.slice(-6); sendMe(true); }
}
const diaryById = id => world.inter.find(i => i.kind === 'diary' && i.id === id);

/* ── 상호작용 ── */
input.on('interact', () => interact());
input.on('run', () => { if (G.mode !== 'play') return; input.runToggle = !input.runToggle; updateButtons(); });
input.on('notes', () => { if (G.mode === 'play') openNotes(); else if (modalStack.at(-1) === 'notes') closeModal('notes'); });
input.on('pause', () => { if (G.mode === 'play' && !modalStack.length) openModal('pause'); else if (modalStack.length) closeModal(modalStack.at(-1)); else if (!$('chatbar').classList.contains('hidden')) toggleChat(false); });
input.on('hide', () => hideButton());
input.on('crouch', () => setPose(G.pose === 'crouch' ? 'stand' : 'crouch'));
input.on('prone', () => setPose(G.pose === 'prone' ? 'stand' : 'prone'));
input.on('heal', () => useBandage());
input.on('clues', () => { if (G.mode === 'play') openClues(); else if (modalStack.at(-1) === 'clues') closeModal('clues'); });
input.on('memo', () => { if (G.mode === 'play') openMemo(); else if (modalStack.at(-1) === 'memo') closeModal('memo'); });
input.on('chat', () => { if (G.mode === 'play') toggleChat(); });
$('mic').addEventListener('click', () => { if (G.mode === 'play') openSettings(); });

// 초록모자는 마이크로 들어온 실제 목소리만 듣는다 (마이크를 끄면 소리에 반응하지 않는다)
function voiceHeard(lv) {
  if (!monster.enabled || G.safe || !audio.mic) return false;
  const r = 4 + lv * 24;
  if (G.mp && !G.host) { G.voiceI = (G.voiceI || 0) + 1; net.set({ v: { i: G.voiceI, r: +r.toFixed(1) } }); return false; }
  return monster.hearVoice(G.player.pos, r, G, localTarget());
}
async function interact() {
  if (G.mode !== 'play' || G.busy || (G.dev.fly && input.keys.Space)) return;
  if (G.player.hidden) return exitHide();
  const it = G.focus; if (!it) return;
  if (it.kind !== 'hide') arms.reach();
  switch (it.kind) {
    case 'door': {
      const d = it.door;
      if (d.locked) {
        if (G.inv[d.lock]) { act('unlock', d.id); toast(`<b>${KEYS[d.lock]}</b>로 ${d.num ? d.num + '번 ' : ''}${d.name}을 열었다.`); addClue(`${KEYS[d.lock]}로 ${d.num}번 ${d.name}을 열었다`, d.pos, 'open-' + d.id); }
        else { audio.locked(); toast(`잠겨 있다. <b>${KEYS[d.lock].replace(' 열쇠', '')}</b> 자물쇠가 달려 있다.`); addClue(`${d.num ? d.num + '번 ' : ''}${d.name}: ${KEYS[d.lock]}가 필요하다`, d.pos, 'lock-' + d.id); }
      } else act('door', d.id, d.open ? 0 : 1);
      break;
    }
    case 'hide': enterHide(it.spot); break;
    case 'drawer': G.busy = true; act('item', it.id); await wait(0.85); G.busy = false; break;
    case 'diary': act('diary', it.id); break;
    case 'flavor':
      toast(it.text, 4); addClue(it.text, it.pos, 'f-' + world.inter.indexOf(it));
      if (it.sound === 'piano') audio.piano(); else if (it.sound === 'flush') audio.play('flush', { vol: 0.8 }); else if (it.sound === 'sink') audio.play('sink', { vol: 0.7 }); else if (it.sound === 'door') audio.door(it.pos);
      break;
    case 'bot': { const b = it.bot; b.command(b.mode === 'follow' ? 'wait' : 'follow', G.botApi); break; }
    case 'front': {
      const f = world.front;
      if (f.padlock) {
        if (G.inv.gold) { act('pad'); toast('<b>금색 열쇠</b>로 쇠사슬 자물쇠를 풀었다!'); }
        else { audio.locked(); toast('굵은 쇠사슬과 <b>금색 자물쇠</b>, 그리고 <b>비밀번호 장치</b>로 잠겨 있다.\n문틈으로 눈부신 빛이 새어 들어온다.', 4); addClue('현관문: 금색 자물쇠 + 비밀번호 4자리', it.pos, 'front'); }
      } else if (f.keypad) openKeypad();
      else act('esc');
      break;
    }
  }
}

/* ── 자세: 서기 · 숙이기 · 엎드리기 ── */
function setPose(p) {
  if (G.mode !== 'play' || G.busy || G.player.hidden || p === G.pose) return;
  if (p === 'stand' || (p === 'crouch' && G.pose === 'prone')) {
    const t = G.player.pos.clone(); world.collide(t, 0.3, POSE[p].top);
    if (t.distanceTo(G.player.pos) > 0.02 && !G.dev.noclip) { toast('여기선 일어설 수 없어. 위가 막혀 있다.', 1.5); return; }
  }
  G.pose = p; if (p !== 'stand') input.runToggle = false;
  audio.play(p === 'prone' ? 'cloth_2' : 'cloth_1', { vol: 0.35 }); updateButtons();
}

/* ── 숨기 (1인칭) ── */
function eyeOf(spot) {
  const o = spot.out;
  if (spot.type === 'bed') return spot.front.clone().addScaledVector(o, -0.68).setY(0.2);
  if (spot.type === 'cabinet') return spot.inside.clone().addScaledVector(o, 0.18).setY(0.52);
  return spot.inside.clone().addScaledVector(o, 0.14).setY(1.5);
}
const flat = v => new THREE.Vector3(v.x, 0, v.z);
const setDoors = (spot, v) => spot.doors.forEach(d => d.piv.rotation.y = d.open * v);
function spotBusy(s, who) {
  const o = G.occ.get(s.id); if (o && o !== who) return true;
  for (const r of G.remotes.values()) if (r.h === s.id && r.peer !== who) return true;
  return false;
}
function hideButton() {
  if (G.mode !== 'play' || G.busy) return;
  if (G.player.hidden) return exitHide();
  let best = null, bd = 2.6;
  for (const s of world.hides) { if (spotBusy(s, 'me')) continue; const d = Math.hypot(s.front.x - G.player.pos.x, s.front.z - G.player.pos.z); if (d < bd) { bd = d; best = s; } }
  if (best) enterHide(best); else toast('근처에 숨을 곳이 없다. 옷장·침대·서랍장 가까이 가 보자.', 2);
}
async function enterHide(spot) {
  const pl = G.player; G.busy = true; input.runToggle = false; G.pose = 'stand'; G.occ.set(spot.id, 'me'); updateButtons();
  const outYaw = yawTo(spot.out.x, spot.out.z), inYaw = yawTo(-spot.out.x, -spot.out.z), eye = eyeOf(spot);
  await view(spot.front, EYE, inYaw, -0.1, 0.35);
  audio.hide(spot.type, true);
  if (spot.type === 'bed') {
    await view(null, null, outYaw, 0, 0.4);
    await view(null, 0.3, null, 0.25, 0.5);
    await view(flat(eye), eye.y, null, 0.05, 0.7);
  } else {
    await tween(0.3, k => setDoors(spot, ease(k)));
    await view(flat(eye), spot.type === 'cabinet' ? eye.y : EYE, null, spot.type === 'cabinet' ? -0.2 : -0.05, 0.5);
    await view(null, null, outYaw, -0.05, 0.35);
    await tween(0.3, k => setDoors(spot, 1 - ease(k)));
  }
  if (G.mode !== 'play' && G.mode !== 'modal') return;
  pl.hidden = true; pl.spot = spot; spot.doors.forEach(d => d.piv.visible = false);
  G.eyeH = eye.y; pl.pos.copy(flat(eye));
  $('fx-hide').className = 'fx ' + (spot.overlay || spot.type); $('hidden-tag').classList.add('show');
  G.hideYaw = 0; G.hidePitch = G.camPitch;
  if (G.host) monster.noteHide(localTarget(), spot);
  G.busy = false; updateButtons(); sendMe(true);
}
async function exitHide() {
  const pl = G.player, spot = pl.spot; if (!spot) return; G.busy = true; pl.hidden = false; pl.spot = null; G.occ.delete(spot.id);
  spot.doors.forEach(d => d.piv.visible = true);
  $('fx-hide').className = 'fx'; $('hidden-tag').classList.remove('show', 'danger');
  audio.hide(spot.type, false);
  const outYaw = yawTo(spot.out.x, spot.out.z);
  if (spot.type === 'bed') { await view(spot.front, 0.3, outYaw, 0.1, 0.6); await view(null, EYE, null, -0.05, 0.45); }
  else { await tween(0.25, k => setDoors(spot, ease(k))); await view(spot.front, EYE, outYaw, -0.05, 0.45); await tween(0.3, k => setDoors(spot, 1 - ease(k))); }
  G.busy = false; updateButtons(); sendMe(true);
}
function pulledLocal(spot, mpos) {
  if (G.dev.god) return;   // 개발자: 초록모자 공격 안 당하기
  const pl = G.player; pl.hidden = false; pl.spot = null; G.busy = false; tweens.clear(); G.occ.delete(spot.id);
  spot.doors.forEach(d => { d.piv.visible = true; d.piv.rotation.y = d.open; });
  pl.pos.copy(spot.front).addScaledVector(spot.out, 0.35); G.eyeH = EYE;
  G.camYaw = yawTo(mpos.x - pl.pos.x || -spot.out.x, mpos.z - pl.pos.z || -spot.out.z); G.camPitch = 0.05; G.shake = 0.6;
  $('fx-hide').className = 'fx'; $('hidden-tag').classList.remove('show', 'danger');
  audio.stinger(); toast('들켰다!!', 1.5); updateButtons();
  setTimeout(() => tween(0.3, k => setDoors(spot, 1 - k)), 1200);
}

/* ── 초록모자가 노리는 대상들: 나 · AI 친구 · 다른 플레이어 ── */
function localTarget() {
  const pl = G.player;
  return G._lt = Object.assign(G._lt || { id: 'me', isLocal: true }, { pos: pl.pos, hidden: pl.hidden, spot: pl.spot, running: pl.running, pose: G.pose, alive: G.mode === 'play' && G.hp > 0, invisible: G.dev.invis, fly: G.y > 1.0 });
}
G.targets = () => {
  const T = [localTarget()];
  for (const b of G.bots) if (b.alive) T.push(b);
  for (const r of G.remotes.values()) T.push(r);
  return T;
};
G.onSpotted = t => { if (t.isLocal) { audio.stinger(); showHeard('들켰다! 도망쳐!'); } else if (t.isBot) t.say(G.botApi, '저기! 초록모자다!!', true); G.chaseTime = 0; };
G.onHit = (t, m) => {
  if (t.isLocal) return hitLocal(m.pos);
  if (t.isBot) { t.hit(G.botApi); G.bots.forEach(b => b !== t && b.alive && b.say(G.botApi, '괜찮아?!')); return; }
  if (t.peer) { G.hitI = (G.hitI || 0) + 1; G.netHit = { t: t.peer, i: G.hitI }; sendMe(true); }
};
G.onPulled = (spot, t, m) => {
  if (t.isLocal) return pulledLocal(spot, m.pos);
  if (t.isBot) { t.pos.copy(spot.front); G.botApi.releaseSpot(spot); t.hidden = false; t.spot = null; t.rig.root.visible = true; t.say(G.botApi, '으아악! 들켰어!!', true); return; }
  if (t.peer) { G.pullI = (G.pullI || 0) + 1; G.netPull = { t: t.peer, s: spot.id, i: G.pullI }; sendMe(true); }
};
function hitLocal(mpos) {
  if (G.dev.god || G.mode !== 'play') return;
  const pl = G.player;
  G.hp = Math.max(0, G.hp - 34); G.caught++; G.lastHurt = G.time; arms.hurt(); audio.hit(); G.shake = 0.8;
  $('fx-dmg').style.opacity = 1; tween(0.6, k => $('fx-dmg').style.opacity = 1 - k);
  let dx = pl.pos.x - mpos.x, dz = pl.pos.z - mpos.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { dx = Math.sin(G.camYaw); dz = Math.cos(G.camYaw); d = 1; }
  for (let i = 0; i < 8; i++) { pl.pos.x += dx / d * 0.16; pl.pos.z += dz / d * 0.16; world.collide(pl.pos, 0.3); }
  G.camYaw = yawTo(mpos.x - pl.pos.x, mpos.z - pl.pos.z);
  if (G.hp <= 0) die(); else toast(G.hp < 40 ? '피가 많이 난다... 한 번 더 맞으면 끝이야! 붕대가 있으면 치료하자' : '초록모자에게 공격당했다! 도망쳐!', 2);
  sendMe(true);
}
function useBandage() {
  if (G.mode !== 'play' || G.bandage <= 0) return;
  if (G.hp >= 100) { toast('다친 곳이 없다.', 1.5); return; }
  G.bandage--; G.hp = Math.min(100, G.hp + 45); audio.play('cloth_3', { vol: 0.7 }); toast('붕대로 상처를 감았다. (+45)', 2); renderInv();
}
function die() {
  G.mode = 'dead'; G.busy = false; tweens.clear(); audio.chase(0, 0); audio.fall();
  if (!G.mp) monster.enabled = false;
  $('hud').classList.add('hidden'); toggleChat(false);
  tween(0.6, k => { G.eyeH = EYE - (EYE - 0.3) * ease(k); G.roll = 1.1 * ease(k); G.camPitch = 0.3 * k; });
  const lines = ['초록모자: "팔로우 했으면 됐잖아."', '초록모자: "이제 영원히 내 팔로워야."', '초록모자: "맞팔... 해줄 거지?"'];
  $('over-line').textContent = lines[Math.random() * lines.length | 0];
  $('o-retry').textContent = G.mp ? '다시 일어나기' : '다시 하기';
  setTimeout(() => {
    if (G.mode !== 'dead') return;
    audio.jumpscare();
    const o = $('over'); o.classList.remove('hidden', 'showbox', 'scare'); void o.offsetWidth; o.classList.add('scare');
    setTimeout(() => o.classList.add('showbox'), 1500);
  }, 700);
  sendMe(true);
}
$('o-retry').onclick = () => {
  $('over').classList.add('hidden');
  if (!G.mp) return startRun(false);
  // 같이하기: 침실에서 다시 깨어난다 (체력 절반)
  Object.assign(G, { hp: 50, roll: 0, eyeH: EYE, mode: 'play', busy: false, pose: 'stand', y: 0 });
  G.player.pos.set(4.05, 0, 1.75); G.camYaw = -Math.PI / 2; G.camPitch = 0;
  $('hud').classList.remove('hidden'); toast('침실에서 다시 깨어났다...', 2.5); sendMe(true);
};
$('o-title').onclick = () => { leaveGame(); toTitle(); };

/* ── AI 친구와 연결 ── */
G.botApi = {
  get monster() { return monster; }, hinted: G.hinted,
  botSay(b, t) { showBubble(b.id, t); addLog(b.name, t, 'bot'); b.sayI = (b.sayI || 0) + 1; b.sayT2 = t; },
  botMemo(b, t) { G.botMemos.unshift({ n: b.name, t }); G.botMemos = G.botMemos.slice(0, 8); addClue(`${b.name}: ${t}`, null, 'bm-' + t); },
  botCaught(b) { addLog('', `${b.name}이(가) 초록모자에게 잡혀갔다...`, 'sys'); toast(`<b>${b.name}</b>이(가) 잡혀갔다...`, 3); renderTeam(); },
  leaderFor(b) {
    let best = null, bd = 1e9; const me = localTarget();
    const ls = [me, ...G.remotes.values()].filter(t => t.alive !== false && t.al !== 0);
    for (const t of ls) { const d = t.pos.distanceTo(b.pos); if (d < bd) { bd = d; best = t; } }
    return best;
  },
  spotTaken(s, b) { return spotBusy(s, b.id) || (G.player.spot === s); },
  claimSpot(s, b) { G.occ.set(s.id, b.id); },
  releaseSpot(s) { G.occ.delete(s.id); },
};
function botCommand(text) {
  const t = text.replace(/\s/g, '');
  const cmd = /따라|같이가|이리와|붙어/.test(t) ? 'follow' : /기다|멈춰|가만|여기있/.test(t) ? 'wait' : /흩어|찾아|탐색|돌아봐/.test(t) ? 'explore' : /숨어|숨자|숨어라/.test(t) ? 'hide' : null;
  if (cmd) G.bots.forEach((b, i) => b.alive && setTimeout(() => b.command(cmd, G.botApi), 300 + i * 400));
}

/* ── 말풍선 · 이름표 · 채팅 ── */
const tagEls = new Map();
function tagEl(id, name, bot) {
  let e = tagEls.get(id);
  if (!e) { e = document.createElement('div'); e.className = 'tag'; e.innerHTML = `<div class="bb"></div><div class="nm${bot ? ' bot' : ''}"></div>`; $('tags').appendChild(e); tagEls.set(id, e); e.bbT = 0; }
  e.querySelector('.nm').textContent = name; return e;
}
function showBubble(id, text) { const e = tagEls.get(id); if (e) { e.querySelector('.bb').textContent = text; e.bbT = 5; } }
const tv = new THREE.Vector3();
function updateTags(dt) {
  const seen = new Set();
  const put = (id, name, bot, obj, vis) => {
    const e = tagEl(id, name, bot); seen.add(id);
    obj.getWorldPosition(tv); tv.y += 0.35;
    const d = tv.distanceTo(camera.position); tv.project(camera);
    const ok = vis && tv.z < 1 && d < 22 && Math.abs(tv.x) < 1.2 && Math.abs(tv.y) < 1.2;
    e.style.display = ok ? '' : 'none';
    if (ok) { e.style.transform = `translate(${(tv.x * 0.5 + 0.5) * innerWidth}px, ${(-tv.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%) scale(${clamp(6 / d, 0.6, 1.1)})`; }
    if (e.bbT > 0) { e.bbT -= dt; if (e.bbT <= 0) e.querySelector('.bb').textContent = ''; }
  };
  for (const b of G.bots) if (b.alive && b.idx < (G.cfg.bots | 0)) put(b.id, b.name, true, b.rig.tag, !b.hidden);
  for (const r of G.remotes.values()) put(r.peer, r.n, false, r.av.tag, r.h < 0 && r.al !== 0);
  for (const [id, e] of tagEls) if (!seen.has(id)) e.style.display = 'none';
}
function addLog(name, text, cls = '') {
  const d = document.createElement('div'); d.innerHTML = (name ? `<b class="${cls}">${esc(name)}</b>` : `<b class="${cls}">!</b>`) + esc(text);
  const log = $('chatlog'); log.appendChild(d); while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 1000); }, 9000);
}
function toggleChat(on) {
  const bar = $('chatbar'), show = on ?? bar.classList.contains('hidden');
  bar.classList.toggle('hidden', !show);
  if (show) setTimeout(() => !isTouch && $('chatin').focus(), 50); else $('chatin').blur();
}
function sendChat(text) {
  text = text.trim().slice(0, 60); if (!text || G.mode !== 'play') return;
  addLog(SET.nick, text); G.chatI++; G.chat = { i: G.chatI, t: text }; sendMe(true);
  if (G.host) botCommand(text);
}
$('chatform').onsubmit = e => { e.preventDefault(); sendChat($('chatin').value); $('chatin').value = ''; if (isTouch) toggleChat(false); };
$('chatbar').querySelectorAll('.quick button').forEach(b => b.onclick = () => { sendChat(b.textContent); toggleChat(false); });

/* ── 모은 단서 · 메모 ── */
function openClues() {
  const list = G.clueLog;
  $('clue-list').innerHTML = list.length ? list.map(c => `<div class="clue">${esc(c.text)}<small>${esc(c.where)}</small></div>`).join('') : '<div class="empty">아직 모은 단서가 없어요. 일기·서랍·사진·동상 등을 조사해 보세요.</div>';
  openModal('clues');
}
function openMemo() { renderMemo(); openModal('memo'); }
function renderMemo() {
  const rows = [];
  G.memos.forEach((m, i) => rows.push(`<div class="memo-i"><div>${esc(m.t)}<small>나 · ${SET.nick}</small></div><button data-del="${i}">지우기</button></div>`));
  for (const r of G.remotes.values()) for (const m of (r.mm || [])) rows.push(`<div class="memo-i peer"><div>${esc(m.t)}<small>${esc(r.n)}</small></div></div>`);
  for (const m of G.botMemos) rows.push(`<div class="memo-i bot"><div>${esc(m.t)}<small>${esc(m.n)} · AI 친구</small></div></div>`);
  $('memo-list').innerHTML = rows.join('') || '<div class="empty">메모가 없어요. 비밀번호 숫자나 열쇠 위치를 적어 두세요.</div>';
  $('memo-list').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { G.memos.splice(+b.dataset.del, 1); sendMe(true); renderMemo(); });
}
$('memo-form').onsubmit = e => {
  e.preventDefault(); const t = $('memo-in').value.trim().slice(0, 50); if (!t) return;
  G.memos.unshift({ t }); G.memos = G.memos.slice(0, 5); $('memo-in').value = ''; audio.paper(); sendMe(true); renderMemo();
};

/* ── 개발자 모드 (비밀번호) ── */
const DEV_HASH = 2539790135;   // 비밀번호의 해시 (비밀번호 자체는 코드에 적지 않는다)
function setDev(on, boot) {
  SET.dev = on; saveSet();
  $('s-dev').textContent = on ? '끄기' : '켜기';
  if (on) { $('devwin').classList.remove('hidden'); $('devfab').classList.remove('hidden'); if (boot) { $('devwin').classList.add('closed'); $('devfab').classList.add('show'); } else devWin(true, true); }
  else {
    $('devwin').classList.add('hidden'); $('devfab').classList.add('hidden');
    Object.keys(G.dev).forEach(k => G.dev[k] = false); monster.frozen = false; document.querySelectorAll('[data-dev]').forEach(b => b.classList.remove('on')); updateButtons();
  }
}
// 창 ↔ 동그란 버튼: 창이 버튼 자리로 빨려 들어가며 작아지고, 버튼을 누르면 그 자리에서 창이 펼쳐진다
function devWin(open, fromFab) {
  const w = $('devwin'), f = $('devfab');
  const fr = f.getBoundingClientRect(), wr = w.getBoundingClientRect();
  if (fr.width || wr.width) {
    w.style.setProperty('--dx', (fr.left + fr.width / 2 - (wr.left + wr.width / 2)) + 'px');
    w.style.setProperty('--dy', (fr.top + fr.height / 2 - (wr.top + wr.height / 2)) + 'px');
  }
  if (open && fromFab) { w.classList.add('snap', 'closed'); void w.offsetWidth; w.classList.remove('snap'); }
  requestAnimationFrame(() => { w.classList.toggle('closed', !open); f.classList.toggle('show', !open); });
  audio.play(open ? 'woosh_1' : 'woosh_2', { vol: 0.35, rate: open ? 1.2 : 1.5 });
}
$('dw-close').onclick = e => { e.stopPropagation(); devWin(false); };
$('devfab').onclick = e => { e.stopPropagation(); devWin(true, true); };
$('s-dev').onclick = () => { if (SET.dev) { setDev(false); toast('개발자 모드를 껐어요.', 2); } else { $('devpw-in').value = ''; $('devpw-msg').textContent = ''; openModal('devpw'); setTimeout(() => $('devpw-in').focus(), 50); } };
$('devpw-form').onsubmit = e => {
  e.preventDefault();
  if (hashStr($('devpw-in').value) === DEV_HASH) { closeModal('devpw'); setDev(true); toast('개발자 모드가 켜졌어요! 창을 닫으면 왼쪽의 동그란 버튼이 돼요.', 3); }
  else { $('devpw-msg').textContent = '비밀번호가 틀렸어요.'; audio.beep(false); }
};
document.querySelectorAll('[data-dev]').forEach(b => b.onclick = () => {
  const k = b.dataset.dev;
  if (k in G.dev) {
    G.dev[k] = !G.dev[k]; b.classList.toggle('on', G.dev[k]); if (k === 'freeze') monster.frozen = G.dev.freeze; if (k === 'fly' && !G.dev.fly) G.y = 0; updateButtons();
    const names = { noclip: '벽뚫기', fly: '날기', god: '초록모자 공격 안 당하기', invis: '투명', freeze: '초록모자 정지', fast: '빠르게' };
    toast(`${names[k]} ${G.dev[k] ? '켜짐' : '꺼짐'}${k === 'fly' && G.dev.fly ? ' — 위·아래 버튼(스페이스/Q)으로 높이 조절' : ''}`, 1.6); return;
  }
  b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 300);
  if (k === 'keys') { let n = 0; for (const it of world.items) if (it.item && it.item.key !== 'bandage' && !it.opened) { act('item', it.id); n++; } toast(n ? '자물쇠 열쇠를 모두 얻었어요!' : '열쇠는 이미 다 있어요.', 2); }
  if (k === 'diaries') { for (const i of world.inter) if (i.kind === 'diary' && !i.read) act('diary', i.id, 1); toast(`일기 4개를 모두 얻었어요! 비밀번호는 <b>${G.code.join('')}</b>`, 3.5); }
  if (k === 'doors') { let n = 0; for (const d of Object.values(world.doors)) { if (d.locked) { act('unlock', d.id); n++; } else if (!d.open) { act('door', d.id, 1); n++; } } toast(n ? '문을 모두 열었어요.' : '문이 이미 다 열려 있어요.', 2); }
  if (k === 'exit') {
    if (G.mode !== 'play') return;
    if (G.player.hidden) { toast('숨은 곳에서 나온 다음 눌러 주세요.', 2); return; }
    G.player.pos.set(22, 0, 28.3); G.y = 0; G.camYaw = Math.PI; G.camPitch = 0;
    toast('탈출구(현관문) 앞으로 순간이동했어요!', 2); devWin(false);
  }
  if (k === 'summon') { monster.pos.set(G.player.pos.x + 6, 0, G.player.pos.z); world.collide(monster.pos, 0.35); monster.state = 'patrol'; monster.path = []; }
});
$('dev-tp').onchange = e => {
  const id = e.target.value; e.target.value = ''; if (!id) return;
  const n = Object.values(world.nodes).find(n => { const r = roomAt(n.x, n.z); return r && r.id === id; });
  if (n && G.mode === 'play' && !G.player.hidden) { G.player.pos.set(n.x, 0, n.z); toast(`${where(G.player.pos)}(으)로 이동했어요.`, 1.5); }
};
let flyDir = 0;
for (const [id, d] of [['fly-up', 1], ['fly-down', -1]]) {
  const b = $(id);
  b.addEventListener('touchstart', e => { e.preventDefault(); flyDir = d; }, { passive: false }); b.addEventListener('touchend', () => flyDir = 0);
  b.addEventListener('mousedown', () => flyDir = d); b.addEventListener('mouseup', () => flyDir = 0); b.addEventListener('mouseleave', () => flyDir = 0);
}

/* ── 일기 · 단서 ── */
function openNotes(tab) {
  const tabs = [...G.diaries].sort().map(i => ['d' + i, i === 3 ? '크레용 일기' : `일기 ${i}`]);
  tabs.push(['clue', '단서']);
  if (!tab) tab = tabs[0][0];
  $('note-tabs').innerHTML = tabs.map(([id, t]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${t}</button>`).join('');
  $('note-tabs').querySelectorAll('button').forEach(b => b.onclick = () => { audio.paper(); openNotes(b.dataset.tab); });
  const page = $('note-page');
  if (tab === 'clue') {
    let h = `<h3>비밀번호</h3><p class="who">일기 네 장에 숫자가 하나씩 적혀 있다</p>`;
    h += `<div class="code">${[1, 2, 3, 4].map(i => `<span>${G.diaries.has(i) ? G.code[i - 1] : '?'}</span>`).join('')}</div>`;
    h += '<ul>' + [1, 2, 3, 4].map(i => `<li>일기 ${i}: ${G.diaries.has(i) ? '<b>' + G.code[i - 1] + '</b>' : '아직 못 찾음'}</li>`).join('') + '</ul>';
    h += '<ul>' + KEY_ORDER.map(k => `<li>${KEYS[k]}: ${G.inv[k] ? (G.used[k] ? '사용함' : '가지고 있음') : '없음'}</li>`).join('') + '</ul>';
    page.innerHTML = h;
  } else {
    const n = +tab.slice(1), d = DIARY[n];
    page.innerHTML = `<h3>${d.title}</h3><p class="who">— ${d.who} · ${d.where}</p>${d.text(G.code[n - 1])}<div class="stain"></div>`;
  }
  page.scrollTop = 0;
  if (!modalStack.includes('notes')) openModal('notes');
}

/* ── 비밀번호 ── */
let kpEntry = '';
function openKeypad() { kpEntry = ''; drawKp(); openModal('keypad'); }
function drawKp(cls = '') { const s = $('kp-screen'); s.textContent = (kpEntry + '____').slice(0, 4).split('').join(' '); s.className = 'kp-screen ' + cls; }
$('kp-grid').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(k => `<button data-k="${k}" class="${k === 'C' ? 'c' : k === 'OK' ? 'e' : ''}">${k === 'C' ? '지움' : k === 'OK' ? '확인' : k}</button>`).join('');
addEventListener('keydown', e => {
  if (modalStack.at(-1) !== 'keypad') return;
  const k = /^\d$/.test(e.key) ? e.key : e.key === 'Enter' ? 'OK' : e.key === 'Backspace' ? 'C' : null;
  if (k) { e.preventDefault(); e.stopPropagation(); kpPress(k); }
}, true);
$('kp-grid').querySelectorAll('button').forEach(b => b.onclick = () => kpPress(b.dataset.k));
function kpPress(k) {
  if (k === 'C') { kpEntry = ''; audio.beep(true); drawKp(); return; }
  if (k === 'OK') {
    if (kpEntry === G.code.join('')) {
      audio.beep(true); audio.unlock(); drawKp('ok'); act('kp');
      setTimeout(() => { closeModal('keypad'); toast(world.front.padlock ? '철컥! 비밀번호가 풀렸다. 이제 자물쇠만 남았다.' : '철컥! 잠금이 모두 풀렸다! 문을 열자!', 3); }, 700);
    } else {
      audio.beep(false); audio.alarm(); drawKp('bad'); kpEntry = '';
      setTimeout(() => { closeModal('keypad'); toast('틀렸다! 일기에 적힌 숫자를 다시 확인하자.', 2.5); }, 500);
    }
    return;
  }
  if (kpEntry.length < 4) { kpEntry += k; audio.beep(true); drawKp(); }
}

/* ── 설정 ── */
function openSettings() {
  $('s-mic').checked = !!audio.mic; $('s-sens').value = SET.sens; $('s-vol').value = SET.vol; $('s-look').value = SET.look; $('s-q').value = SET.q; $('s-voice').checked = SET.voice; $('s-bright').value = SET.bright; $('s-dev').textContent = SET.dev ? '끄기' : '켜기';
  openModal('settings');
}
$('s-mic').onchange = e => enableMic(e.target.checked);
$('s-sens').oninput = e => { SET.sens = +e.target.value; audio.sens = SET.sens; };
$('s-vol').oninput = e => { SET.vol = +e.target.value; audio.setVolume(SET.vol); };
$('s-look').oninput = e => { SET.look = +e.target.value; input.sens = SET.look; };
$('s-bright').oninput = e => { SET.bright = +e.target.value; renderer.toneMappingExposure = EXP(); };
$('s-q').onchange = e => { SET.q = e.target.value; applyQuality(); };
$('s-voice').onchange = e => { SET.voice = e.target.checked; audio.noVoice = !SET.voice; };
$('p-resume').onclick = () => closeModal('pause');
$('p-settings').onclick = () => openSettings();
$('p-help').onclick = () => openModal('help');
$('p-restart').onclick = () => { closeModal('pause'); if (G.mp && !G.host) { toast('같이하기에서는 방장만 처음부터 다시 할 수 있어요.', 2.5); return; } if (G.mp) G.epoch = Date.now() % 1e9; startRun(false); };
$('p-title').onclick = () => { leaveGame(); toTitle(); };
document.addEventListener('visibilitychange', () => { if (document.hidden && G.mode === 'play' && !G.mp && !modalStack.length) openModal('pause'); });

/* ── 1인칭 카메라 ── */
const tmpV = new THREE.Vector3(), lookDir = new THREE.Vector3();
function firstPersonCam(dt) {
  const pl = G.player, sp = G.speed, run = pl.running;
  const k = Math.min(1, sp / 2.5);
  const bobY = (pl.hidden ? Math.sin(G.time * 1.6) * 0.008 : -Math.abs(Math.sin(G.walkPh)) * (run ? 0.07 : 0.04) * k);
  const bobX = Math.cos(G.walkPh) * (run ? 0.035 : 0.02) * k;
  const y = G.camYaw, p = G.camPitch;
  lookDir.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  camera.position.set(pl.pos.x + Math.cos(y) * bobX, G.dev.noclip ? G.y + G.eyeH + bobY : clamp(G.y + G.eyeH + bobY, 0.12, CEIL - 0.12), pl.pos.z - Math.sin(y) * bobX);
  camera.lookAt(tmpV.copy(camera.position).add(lookDir));
  camera.rotateZ(G.roll + Math.sin(G.walkPh) * 0.006 * k);
  if (G.shake > 0) { G.shake -= dt; const s = G.shake * 0.1; camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s; }
  const fov = G.baseFov + (run && sp > 3 ? 7 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
}

/* ── 플레이 업데이트 ── */
function surfaceAt(p) {
  const r = roomAt(p.x, p.z); if (!r) return 'wood';
  if ((r.id === 'hall' || r.id === 'hallB' || r.id === 'hallC') && Math.abs(p.z - (r.z0 + 1.5)) < 0.6) return 'rug';
  return r.fl === 'tileF' ? 'tile' : r.fl === 'marble' || r.fl.startsWith('stone') ? 'marble' : 'wood';
}
let lastStep = 0;
function updatePlayer(dt) {
  const pl = G.player, P = POSE[G.pose];
  const [lx, ly] = input.takeLook(); G.lookDX = lx; G.lookDY = ly;
  if (pl.hidden && !G.busy) {
    G.hideYaw = clamp(G.hideYaw - lx, -0.85, 0.85); G.hidePitch = clamp(G.hidePitch - ly, -0.5, 0.4);
    G.camYaw = yawTo(pl.spot.out.x, pl.spot.out.z) + G.hideYaw; G.camPitch = G.hidePitch;
  } else if (!G.busy) { G.camYaw -= lx; G.camPitch = clamp(G.camPitch - ly, -1.35, 1.25); }
  let sp = 0, run = false;
  if (!G.busy && !pl.hidden) {
    const mv = input.move();
    const fx = -Math.sin(G.camYaw), fz = -Math.cos(G.camYaw), rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
    const mx = fx * mv.y + rx * mv.x, mz = fz * mv.y + rz * mv.x;
    const want = input.running && mv.y > 0.3 && !G.tired && G.pose === 'stand';
    sp = (want ? 4.6 : 2.4) * mv.mag * P.sp * (G.dev.fast ? 2.2 : 1); run = want;
    if (mv.mag > 0.05) { pl.pos.x += mx * sp * dt; pl.pos.z += mz * sp * dt; if (!G.dev.noclip) world.collide(pl.pos, 0.3, P.top); }
    if (run && !G.dev.fast) { G.st -= 16 * dt; if (G.st <= 0) { G.st = 0; G.tired = true; input.runToggle = false; updateButtons(); toast('숨이 차다...', 1.5); } }
    else { G.st = Math.min(100, G.st + (mv.mag > 0.05 ? 11 : 18) * dt); if (G.tired && G.st > 35) G.tired = false; }
    G.walkPh += sp * dt * Math.PI / (run ? 1.25 : 0.72);
    const st = Math.floor(G.walkPh / Math.PI);
    if (sp > 0.2 && st !== lastStep && G.y < 0.1) { lastStep = st; if (G.pose === 'stand' || st % 2) audio.step(surfaceAt(pl.pos), run); }
    G.eyeH += (P.eye - G.eyeH) * Math.min(1, dt * 8);
    // 개발자: 날기
    if (G.dev.fly) {
      const up = flyDir || (input.keys.Space ? 1 : input.keys.KeyQ ? -1 : 0);
      G.y += up * 3.5 * dt;
      G.y = G.dev.noclip ? clamp(G.y, -1, 14) : clamp(G.y, 0, CEIL - G.eyeH - 0.2);
    } else G.y += (0 - G.y) * Math.min(1, dt * 6);
  } else if (G.busy) sp = 1.2;
  pl.running = run; G.speed = sp;
  if (G.time - G.lastHurt > 8 && G.hp < 100) G.hp = Math.min(100, G.hp + 2.0 * dt);
}
function updateFill() { fill.position.set(G.player.pos.x, 2.0 + G.y, G.player.pos.z); fill.intensity = G.player.hidden ? 0.15 : 1.0; }

/* ── 같이하기 동기화 ── */
function sendMe(force) {
  if (!G.mp || !net.game) return;
  const pl = G.player, me = {
    n: SET.nick, s: SET.skin, x: +pl.pos.x.toFixed(2), z: +pl.pos.z.toFixed(2), y: +G.y.toFixed(2), f: +G.camYaw.toFixed(2), p: G.pose,
    h: pl.hidden && pl.spot ? pl.spot.id : -1, hp: Math.round(G.hp), al: G.mode === 'dead' ? 0 : 1, iv: G.dev.invis ? 1 : 0, rn: pl.running ? 1 : 0,
    ch: G.chat || null, mm: G.memos.slice(0, 5), a: G.acts,
  };
  if (G.host) {
    me.host = true; me.cfg = G.cfg; me.st = G.epoch || 0;
    me.w = worldSnap(); me.m = monster.netState();
    me.b = G.bots.filter(b => b.idx < (G.cfg.bots | 0)).map(b => ({ x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), f: +(b.face || 0).toFixed(2), p: b.pose || 'stand', h: b.hidden ? 1 : 0, hp: b.hp | 0, al: b.alive ? 1 : 0, sp: +(b.speed || 0).toFixed(1), si: b.sayI || 0, st: b.sayT2 || '', md: b.mode }));
    me.bm = G.botMemos.slice(0, 5); me.hit = G.netHit || null; me.pull = G.netPull || null;
  }
  net.set(me);
  if (force) net.flush();
}
function worldSnap() {
  return {
    d: Object.values(world.doors).map(d => d.locked ? 'l' : d.open ? 'o' : 'c').join(''),
    it: world.items.map(i => i.opened ? 1 : 0).join(''),
    dr: [1, 2, 3, 4].map(i => G.diaries.has(i) ? 1 : 0).join(''),
    f: (world.front.padlock ? 1 : 0) + '' + (world.front.keypad ? 1 : 0) + (G.escaped ? 1 : 0),
    code: G.code.join(''),
  };
}
function applySnap(w) {
  if (!w) return;
  const ds = Object.values(world.doors);
  [...(w.d || '')].forEach((c, i) => { const d = ds[i]; if (!d || G.lockout['d' + d.id] > G.time) return; if (c !== 'l' && d.locked) unlockDoor(d); if (c !== 'l') doorSet(d, c === 'o', true); });
  [...(w.it || '')].forEach((c, i) => { const it = world.items[i]; if (c === '1' && it && !it.opened) openItem(it, false); });
  [...(w.dr || '')].forEach((c, i) => { const it = diaryById(i + 1); if (c === '1' && it && !it.read) readDiary(it, false); });
  const f = w.f || '110'; if (f[0] === '0') frontPad(); if (f[1] === '0') frontKeypad();
  if (f[2] === '1' && !G.escaped && G.mode === 'play') { G.escaped = true; startExit(); }
}
const lastActs = new Map();
function netUpdate(dt) {
  if (!G.mp || !net.game) return;
  checkHost(dt);
  const now = performance.now();
  for (const p of net.others()) {
    const q = p.presence || {}; if (q.x === undefined) continue;
    let r = G.remotes.get(p.peer);
    if (!r) {
      const av = createAvatar(SKINS[(q.s | 0) % SKINS.length]); scene.add(av.root);
      r = { id: p.peer, peer: p.peer, av, pos: new THREE.Vector3(q.x, 0, q.z), n: '', s: q.s | 0, alive: true, isRemote: true, chI: q.ch ? q.ch.i : 0, mm: [] };
      G.remotes.set(p.peer, r); addLog('', `${String(q.n || '친구').slice(0, 10)}님이 들어왔다`, 'sys');
    }
    if ((q.s | 0) !== r.s) { scene.remove(r.av.root); r.av = createAvatar(SKINS[(q.s | 0) % SKINS.length]); scene.add(r.av.root); r.s = q.s | 0; }
    r.n = String(q.n || '친구').slice(0, 10); r.hp = clamp(+q.hp || 0, 0, 100); r.al = q.al; r.alive = q.al !== 0; r.h = Number.isInteger(q.h) ? q.h : -1;
    r.hidden = r.h >= 0; r.spot = r.hidden ? world.hides[r.h] : null; r.pose = ['stand', 'crouch', 'prone'].includes(q.p) ? q.p : 'stand'; r.running = !!q.rn; r.invisible = !!q.iv;
    r.fly = (+q.y || 0) > 1.0; r.mm = Array.isArray(q.mm) ? q.mm.slice(0, 5).map(m => ({ t: String(m && m.t || '').slice(0, 50) })) : [];
    const k = Math.min(1, dt * 10), tx = +q.x || 0, tz = +q.z || 0;
    if (Math.hypot(tx - r.pos.x, tz - r.pos.z) > 4) r.pos.set(tx, 0, tz);
    const before = r.pos.clone(); r.pos.x += (tx - r.pos.x) * k; r.pos.z += (tz - r.pos.z) * k;
    r.av.root.position.set(r.pos.x, +q.y || 0, r.pos.z); r.av.root.rotation.y = (+q.f || 0) + Math.PI;
    r.av.root.visible = !r.hidden && r.alive;
    r.av.update(dt, before.distanceTo(r.pos) / Math.max(dt, 0.001), r.alive ? r.pose : 'dead');
    if (q.ch && q.ch.i !== r.chI) { r.chI = q.ch.i; const t = String(q.ch.t || '').slice(0, 60); showBubble(r.peer, t); addLog(r.n, t); if (G.host) botCommand(t); }
    if (q.v && q.v.i !== r.vI) { r.vI = q.v.i; r.loudT = now; if (G.host && monster.enabled) monster.hearVoice(r.pos, clamp(+q.v.r || 0, 0, 30), G, r); }
    r.loud = now - (r.loudT || 0) < 1200;
    if (G.host && Array.isArray(q.a)) {
      const seen = lastActs.get(p.peer) || 0; let mx = seen;
      for (const a of q.a) { if (!a || !(a.i > seen)) continue; mx = Math.max(mx, a.i); hostApply(a, r); }
      lastActs.set(p.peer, mx);
    }
  }
  // 방장이 아니면: 방장의 상태를 받아 저택 · 초록모자 · AI 친구를 맞춘다
  if (!G.host) {
    const hp = net.hostPeer(), q = hp && hp.presence;
    if (q) {
      G.lastHostCfg = q.cfg; if (q.cfg) G.cfg = Object.assign({}, G.cfg, q.cfg);
      if (q.st && q.st !== G.epoch) { G.epoch = q.st; if (G.mode === 'wait' || G.mode === 'end' || G.mode === 'play' || G.mode === 'dead') { $('ending').classList.add('hidden'); $('over').classList.add('hidden'); startRun(G.mode === 'wait'); return; } }
      if (G.mode === 'play' || G.mode === 'dead') {
        applySnap(q.w);
        if (q.m) monster.applyNet(q.m, dt, G);
        if (Array.isArray(q.b)) q.b.forEach((n, i) => { const b = G.bots[i]; if (b && n) applyBotNet(b, n, dt); });
        G.botMemos = Array.isArray(q.bm) ? q.bm.slice(0, 5).map(m => ({ n: String(m.n || '').slice(0, 8), t: String(m.t || '').slice(0, 60) })) : [];
        if (G.seenHit === undefined) G.seenHit = q.hit ? q.hit.i : 0;
        if (G.seenPull === undefined) G.seenPull = q.pull ? q.pull.i : 0;
        if (q.hit && q.hit.t === G.myPeer && q.hit.i !== G.seenHit) { G.seenHit = q.hit.i; hitLocal(monster.pos); }
        if (q.pull && q.pull.t === G.myPeer && q.pull.i !== G.seenPull) { G.seenPull = q.pull.i; const s = world.hides[q.pull.s]; if (s && G.player.hidden) pulledLocal(s, monster.pos); }
      }
    }
  }
  G.netT = (G.netT || 0) - dt; if (G.netT <= 0) { G.netT = 0.1; sendMe(); }
  net.tick(now);
}
function hostApply(a, r) {
  const who = r.n;
  if (a.k === 'door' && world.doors[a.id]) doorSet(world.doors[a.id], !!a.v);
  if (a.k === 'unlock' && world.doors[a.id]) unlockDoor(world.doors[a.id]);
  if (a.k === 'item' && world.items[a.id]) openItem(world.items[a.id], false);
  if (a.k === 'diary') { const it = diaryById(a.id); if (it) readDiary(it, false, who); }
  if (a.k === 'pad') frontPad();
  if (a.k === 'kp') frontKeypad();
  if (a.k === 'esc' && !G.escaped) { G.escaped = true; sendMe(true); startExit(); }
}
function applyBotNet(b, n, dt) {
  const on = b.idx < (G.cfg.bots | 0); b.alive = !!n.al && on; b.hidden = !!n.h; b.hp = n.hp; b.mode = n.md || b.mode;
  const k = Math.min(1, dt * 10); if (Math.hypot(n.x - b.pos.x, n.z - b.pos.z) > 4) b.pos.set(n.x, 0, n.z); else { b.pos.x += (n.x - b.pos.x) * k; b.pos.z += (n.z - b.pos.z) * k; }
  b.face = n.f; b.speed = n.sp; b.pose = n.p || 'stand'; b.rig.root.visible = b.alive && !b.hidden;
  if (n.si && n.si !== b.netSay) { if (b.netSay !== undefined) { showBubble(b.id, n.st); addLog(b.name, n.st, 'bot'); } b.netSay = n.si; }
  b.anim(dt);
}

function playUpdate(dt) {
  G.time += dt;
  const pl = G.player;
  updatePlayer(dt);
  G.focus = (G.busy || pl.hidden) ? null : findInter();
  if (audio.mic) {
    const lv = audio.readMic(dt); G.micLevel = lv;
    const md = monster.pos.distanceTo(pl.pos);
    const th = pl.hidden ? (md < 5 ? G.micHideThreshold : 0.3) : G.micThreshold;
    G.micCool -= dt;
    if (lv > th && G.micCool <= 0) { G.micCool = 0.9; if (voiceHeard(lv)) showHeard(); }
    $('mic-fill').style.width = (lv * 100) + '%'; $('mic-th').style.left = (th * 100) + '%';
  } else G.micLevel = 0;
  if (G.host) {
    monster.update(dt, G);
    for (const b of G.bots) if (b.alive && b.idx < (G.cfg.bots | 0)) b.update(dt, G.botApi);
  }
  if (monster.chasing) G.chaseTime += dt;
  netUpdate(dt);
  firstPersonCam(dt);
  updateFill();
  arms.update(dt);
  world.update(dt, pl.pos, monster.pos, camera);
  updateTags(dt);
  G.dripT -= dt; if (G.dripT <= 0) { G.dripT = 1.2 + Math.random() * 2.5; for (const sp of world.sfx) if (sp.kind === 'drip' && sp.pos.distanceTo(pl.pos) < 14) audio.drip(sp.pos); }
  const md = monster.pos.distanceTo(pl.pos), near = clamp(1 - md / 12, 0, 1);
  const chasingMe = monster.chasing && (monster.tgt === 'me' || monster.tgt === G.myPeer);
  audio.chase(chasingMe ? 1 : monster.chasing && md < 15 ? 0.5 : monster.state === 'search' || monster.state === 'goCheck' ? 0.25 : 0, dt);
  if (near > 0.15 || chasingMe) audio.heartbeat(70 + near * 70 + (chasingMe ? 25 : 0), 0.2 + near * 0.6);
  $('fx-vig').style.opacity = 0.75 + near * 0.25;
  $('fx-low').style.opacity = G.hp < 70 ? (1 - G.hp / 100) * (0.8 + Math.sin(G.time * 5) * 0.2) : 0;
  $('hidden-tag').classList.toggle('danger', pl.hidden && md < 4.5);
  audio.ambience(true, dt);
  G.lightT -= dt;
  if (G.lightT <= 0) { G.lightT = 24 + Math.random() * 30; world.lightning = 0.55; G.flash = 0.5; audio.thunder(0.4 + Math.random() * 0.8); }
  G.flash = Math.max(0, G.flash - dt); hemi.intensity = 0.85 + (G.flash > 0.25 ? 0.9 : G.flash > 0.12 && G.flash < 0.18 ? 0.6 : 0);
  for (const g of G.glints) g.material.opacity = 0.45 + Math.sin(G.time * 3.2) * 0.35;
  updateHUD(dt);
}

/* ── 메인 루프 ── */
let last = performance.now();
function micMeter(dt) { const lv = audio.readMic(dt); $('s-micfill').style.width = lv * 100 + '%'; $('s-miclabel').textContent = audio.mic ? (lv > G.micThreshold ? '초록모자가 들어요!' : '조용함') : '마이크 꺼짐'; }
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.mode !== 'modal') runTweens(dt);
  if (sub.t > 0) { sub.t -= dt; sub.shown = Math.min(sub.full.length, sub.shown + dt * 28); $('sub-text').textContent = sub.full.slice(0, Math.ceil(sub.shown)); if (sub.t <= 0) $('sub').className = ''; }
  switch (G.mode) {
    case 'title': case 'lobby': titleUpdate(dt); break;
    case 'wait': titleUpdate(dt); netUpdate(dt); G.waitT = (G.waitT || 0) - dt; if (G.waitT <= 0) { G.waitT = 1; renderWait(); } break;
    case 'play': playUpdate(dt); break;
    case 'cine': if (G.cineFn) G.cineFn(dt); else if (curScene === scene) world.update(dt, camera.position, monster.pos, camera); if (curScene === scene && monster.root.visible) monster.animate(dt, G); if (G.mp && curScene === scene) { G.netT = (G.netT || 0) - dt; if (G.netT <= 0) { G.netT = 0.2; sendMe(); } net.tick(now); } break;
    case 'dead': G.time += dt; firstPersonCam(dt); world.update(dt, G.player.pos, monster.pos, camera); if (G.mp) { if (G.host) monster.update(dt, G); netUpdate(dt); } else monster.animate(dt, G); break;
    case 'end': if (G.mp) netUpdate(dt); break;
  }
  if (modalStack.includes('settings')) micMeter(dt);
  if (audio.ctx) { camera.getWorldDirection(tv); audio.listener(camera.position, tv); audio.lastCam = camera.position; if (monster) audio.monsterAt(monster.pos); }
  renderer.autoClear = true;
  renderer.render(curScene, camera);
  if ((G.mode === 'play' || G.mode === 'modal') && !G.player.hidden && arms.root.visible) {
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, vmCam);
  }
}

if (location.search.includes('debug')) window.GH = { G, audio, renderer, arms, net, get world() { return world; }, get monster() { return monster; }, camera, startExit, die, interact, act, setPose, hideButton, sendChat, setDev, THREE };
boot().catch(e => { console.error(e); $('ld-text').textContent = '불러오기 실패: ' + e.message + ' — 웹서버(https 또는 localhost)에서 열어 주세요.'; });
