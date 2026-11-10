import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { find, center, cellOf, at, blocks, cellRectOf, WALL_H } from './map.js';
import { buildWorld } from './world.js';
import { Player, buildDClass } from './player.js';
import { SCP096 } from './scp096.js';
import { buildModel096 } from './model096.js';
import { ROSTER, makeCreature, ScpNPC } from './creatures.js';
import { AudioSys } from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const Q = new URLSearchParams(location.search), DBG = Q.get('dbg');
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || !!Q.get('touch');
const LITE = TOUCH || !!Q.get('lite'); // 모바일 성능 모드
if (TOUCH) document.body.classList.add('touch');
const MARK = { '173': '1', '049': '2', '106': '3', '939': '4', '999': '5', '682': '6' };

const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: !LITE, powerPreference: 'high-performance' });
renderer.setPixelRatio(LITE ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = LITE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030304);
scene.fog = new THREE.FogExp2(0x040405, 0.038);
scene.add(new THREE.HemisphereLight(0x8a96a8, 0x2a2018, LITE ? 0.6 : 0.35));
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 120);

const audio = new AudioSys();
const world = buildWorld(scene, audio, { lite: LITE });
let npc096 = new SCP096(scene, world, audio), puppet = null, player = null;
const npcs = ROSTER.filter(r => MARK[r.id]).map(r => { const m = find(MARK[r.id])[0]; return new ScpNPC(scene, makeCreature(r.id), cellRectOf(m.x, m.y), { x: center(m.x), z: center(m.y) }, audio); });
const dummy = { pos: new THREE.Vector3(0, 0, 0), dead: false, hasCard: false, die() {} };

// 손전등 (그림자)
const flash = new THREE.SpotLight(0xfff1dc, 22, 26, 0.45, 0.5, 1.6);
flash.castShadow = true; flash.shadow.mapSize.set(LITE ? 512 : 1024, LITE ? 512 : 1024); flash.shadow.bias = -0.0005; flash.shadow.camera.near = 0.2;
scene.add(flash, flash.target);

// 후처리
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 0.92); bloom.enabled = !LITE;
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fx = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, danger: { value: 0 }, red: { value: 0 }, fade: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, danger, red, fade; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv, c = uv - .5;
      float line = step(.985, h(vec2(floor(uv.y*180.), floor(time*24.)))) * danger;
      uv.x += line * .025 * (h(vec2(time)) - .5) + sin(uv.y*40. + time*30.) * .0012 * danger;
      float ca = .0015 + danger * .007;
      vec3 col = vec3(texture2D(tDiffuse, uv + c*ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c*ca).b);
      float g = dot(col, vec3(.299,.587,.114));
      col = mix(col, vec3(g), .18 + danger*.25);
      col += (h(uv*vec2(1920.,1080.) + time*60.) - .5) * (.055 + danger*.06);
      col *= 1. - dot(c,c) * (1.15 + danger*1.4);
      col = mix(col, vec3(col.r*1.2+.15, col.g*.25, col.b*.25), red);
      gl_FragColor = vec4(col * (1.-fade), 1.);
    }`,
});
composer.addPass(fx);

// ── 캐릭터 선택: 각 모델을 실제로 렌더링한 초상화 ──
function portraits() {
  const ps = new THREE.Scene(); ps.background = new THREE.Color(0x14161a);
  ps.add(new THREE.HemisphereLight(0xbcc8d8, 0x201810, 1.3));
  const key = new THREE.DirectionalLight(0xfff0e0, 2.8); key.position.set(2, 3, 3); ps.add(key);
  const rim = new THREE.DirectionalLight(0xff5a3a, 2.2); rim.position.set(-3, 2, -2.5); ps.add(rim);
  const pc = new THREE.PerspectiveCamera(30, 1, 0.05, 60), W0 = renderer.domElement.width, H0 = renderer.domElement.height, out = {};
  const idle = { speed: 0, phase: 0, air: 0, vy: 0, crouch: 0, landT: 0, act: -1 };
  for (const r of ROSTER) {
    let obj;
    if (r.id === 'dclass') obj = buildDClass().root;
    else if (r.id === '096') obj = buildModel096().root;
    else { const a = makeCreature(r.id); for (let i = 0; i < 30; i++) a.animate(0.05, { ...idle, t: i * 0.05 }); obj = a.root; }
    obj.rotation.y = 0.55; ps.add(obj); obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const h = Math.max(size.y, size.x * 0.85, size.z * 0.55) * 1.12, dist = h / 2 / Math.tan(15 * Math.PI / 180);
    pc.aspect = W0 / H0; pc.updateProjectionMatrix(); pc.position.set(c.x + dist * 0.15, c.y + h * 0.06, c.z + dist); pc.lookAt(c);
    renderer.setRenderTarget(null); renderer.render(ps, pc);
    const cv = document.createElement('canvas'); cv.width = cv.height = 200;
    cv.getContext('2d').drawImage(renderer.domElement, (W0 - H0) / 2, 0, H0, H0, 0, 0, 200, 200);
    out[r.id] = cv.toDataURL('image/jpeg', 0.85); ps.remove(obj);
  }
  return out;
}
let KIND = Q.get('as') || 'dclass';
function buildSelect() {
  const pics = portraits(), grid = $('roster');
  for (const r of ROSTER) {
    const b = document.createElement('button'); b.className = 'pick' + (r.id === KIND ? ' sel' : ''); b.dataset.id = r.id;
    b.innerHTML = `<img src="${pics[r.id]}" alt="${r.name}"><b>${r.name}</b><small>${r.title}</small><i class="c-${r.cls}">${r.cls}</i>`;
    b.onclick = () => { KIND = r.id; grid.querySelectorAll('.pick').forEach(x => x.classList.toggle('sel', x === b)); $('pickdesc').textContent = r.desc; };
    grid.appendChild(b);
  }
  $('pickdesc').textContent = ROSTER.find(r => r.id === KIND).desc;
}

// ── 게임 시작: 고른 캐릭터로 플레이어 생성 ──
let yaw = Math.PI, pitch = -0.12, fp = false, flashOn = true, state = 'menu', time0 = 0, shake = 0, deadT = 0, msgT = 0, alarmOn = false;
function setup(kind) {
  KIND = kind;
  let av = null, sp = find('P')[0];
  if (kind === '096') { puppet = npc096; npc096 = null; av = puppet.asAvatar(); sp = find('S')[0]; }
  else if (kind !== 'dclass') { const i = npcs.findIndex(n => n.av.id === kind); av = npcs[i].av; npcs.splice(i, 1); sp = find(MARK[kind])[0]; }
  player = new Player(scene, world, audio, { x: center(sp.x), z: center(sp.y) }, av);
  yaw = kind === 'dclass' ? Math.PI : 0; // SCP 는 격리실 문(북쪽)을 바라보며 시작
  setObj(kind === 'dclass' ? '관측실에서 LEVEL 3 키카드를 찾아라' : kind === '106' ? '벽을 통과해 Gate A 로 탈출하라' : '격리실 문을 부수고 Gate A 로 탈출하라');
  $('abBtn').hidden = $('abKey').hidden = kind === 'dclass';
  if (kind !== 'dclass') $('abName').textContent = ROSTER.find(r => r.id === kind).desc.split('능력: ')[1] || '능력';
}
function start() {
  setup(KIND); audio.init(); $('menu').hidden = true; $('hud').hidden = false; state = 'play'; time0 = performance.now();
  if (TOUCH) { $('touch').hidden = false; document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {}); }
  else renderer.domElement.requestPointerLock();
  msg(KIND === 'dclass' ? 'SCP-096 의 얼굴을 절대 보지 마라' : `당신은 ${ROSTER.find(r => r.id === KIND).name} 이다`);
}
$('start').onclick = start;

// ── 입력 (키보드·마우스) ──
const keys = {}, inp = { f: 0, b: 0, l: 0, r: 0, run: false, jump: false, crouch: false, ability: false };
let tRun = false, tCrouch = false;
const toggleView = () => { fp = !fp; player.setHeadVisible(!fp); };
const toggleFlash = () => { flashOn = !flashOn; flash.visible = flashOn; audio.unlock(); };
function nearestDoor(r) { let best = null, bd = r; for (const d of world.doors) { if (d.passable()) continue; const dd = Math.hypot(d.cx - player.pos.x, d.cz - player.pos.z); if (dd < bd) { bd = dd; best = d; } } return best; }
function action() {
  if (KIND === 'dclass') { if (player.near && !player.hasCard) { player.hasCard = true; world.card.visible = false; audio.pickup(); msg('LEVEL 3 키카드를 얻었다'); setObj('Gate A 로 탈출하라 (복도 동쪽 끝, 위쪽 게이트)'); } return; }
  const d = nearestDoor(2.8); // SCP: 문 부수기
  if (d) { d.burst(new THREE.Vector3(d.cx - player.pos.x, 0, d.cz - player.pos.z).normalize(), audio); shake = 0.6; }
}
addEventListener('keydown', e => {
  if (e.repeat) return; keys[e.code] = true;
  if (state !== 'play') { if (e.code === 'KeyR' && (state === 'dead' || state === 'win')) location.reload(); return; }
  if (e.code === 'Space') { inp.jump = true; e.preventDefault(); }
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyF') toggleFlash();
  if (e.code === 'KeyE') action();
  if (e.code === 'KeyQ') inp.ability = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement || state !== 'play') return;
  yaw -= e.movementX * 0.0022; pitch = clamp(pitch - e.movementY * 0.0022, -1.25, 1.1);
});
document.addEventListener('pointerlockchange', () => { if (state === 'play' && !DBG && !TOUCH) $('pause').hidden = !!document.pointerLockElement; });
$('pause').onclick = () => renderer.domElement.requestPointerLock();

// ── 터치 조작 (모바일) ──
if (TOUCH) {
  const stick = $('stick'), knob = $('knob'); let sid = null, sc = { x: 0, y: 0 };
  const mv = e => {
    let dx = e.clientX - sc.x, dy = e.clientY - sc.y; const L = Math.hypot(dx, dy), R = 56;
    if (L > R) { dx *= R / L; dy *= R / L; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const nx = dx / R, ny = dy / R, dz = 0.2;
    inp.f = ny < -dz ? 1 : 0; inp.b = ny > dz ? 1 : 0; inp.r = nx > dz ? 1 : 0; inp.l = nx < -dz ? 1 : 0;
  };
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); const r = stick.getBoundingClientRect(); sc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; mv(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) mv(e); });
  const end = e => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; inp.f = inp.b = inp.l = inp.r = 0; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  const look = $('look'); let lid = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', e => { lid = e.pointerId; lx = e.clientX; ly = e.clientY; look.setPointerCapture(lid); });
  look.addEventListener('pointermove', e => { if (e.pointerId !== lid) return; yaw -= (e.clientX - lx) * 0.0065; pitch = clamp(pitch - (e.clientY - ly) * 0.0065, -1.25, 1.1); lx = e.clientX; ly = e.clientY; });
  const lend = e => { if (e.pointerId === lid) lid = null; };
  look.addEventListener('pointerup', lend); look.addEventListener('pointercancel', lend);
  for (const b of document.querySelectorAll('#tbtns [data-k]')) b.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); const k = b.dataset.k;
    if (k === 'jump') inp.jump = true; if (k === 'act') action(); if (k === 'ab') inp.ability = true;
    if (k === 'light') toggleFlash(); if (k === 'view') toggleView();
    if (k === 'run') b.classList.toggle('on', tRun = !tRun);
    if (k === 'crouch') b.classList.toggle('on', tCrouch = !tCrouch);
  });
  $('restart').onclick = $('restart2').onclick = () => location.reload();
}
const setObj = t => { $('obj').textContent = '목표: ' + t; };
function msg(t, red) { const m = $('msg'); m.textContent = t; m.className = red ? 'red show' : 'show'; msgT = 4; }
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ── 카메라 ──
const pivot = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
let pivotY = 1.6;
const camBlocked = p => blocks(cellOf(p.x), cellOf(p.z)) || p.y < 0.15 || p.y > WALL_H - 0.12;
function updateCamera(dt) {
  const fwd = tmp.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  if (player.dead) { // 096 얼굴을 강제로 보게 됨
    camera.position.lerp(player.eyePos(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, 0)), Math.min(1, dt * 3));
    camTarget.lerp(npc096.headPos, Math.min(1, dt * 6)); camera.lookAt(camTarget);
  } else if (fp) {
    player.eyePos(camera.position); camera.position.addScaledVector(fwd, 0.12 + (player.av ? player.r * 0.5 : 0));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  } else {
    pivotY += (player.camH - player.crouch * 0.5 + player.pos.y - pivotY) * Math.min(1, dt * 12);
    pivot.set(player.pos.x, Math.min(pivotY, WALL_H - 0.3), player.pos.z);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const want = pivot.clone().addScaledVector(right, 0.5).addScaledVector(fwd, -player.camDist);
    const p = pivot.clone(), step = want.clone().sub(pivot).divideScalar(30);
    if (!camBlocked(p)) for (let i = 0; i < 30; i++) { p.add(step); if (camBlocked(p)) { p.sub(step).sub(step); break; } }
    else p.copy(want); // 106 이 벽 속에 있을 때
    camera.position.copy(p); camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.08; camera.position.y += (Math.random() - 0.5) * shake * 0.08; camera.rotation.z += (Math.random() - 0.5) * shake * 0.03; }
  camera.updateMatrixWorld();
  player.chestPos(flash.position);
  flash.target.position.copy(camera.position).addScaledVector(camera.getWorldDirection(tmp), 14);
}

// ── 디버그(스크린샷용): ?dbg=1&as=939&... ──
if (DBG) {
  $('menu').hidden = true; $('hud').hidden = false; setup(KIND); state = 'play'; if (TOUCH) $('touch').hidden = false;
  const scp = npc096 || puppet;
  const s = Q.get('s'); if (s && npc096) { scp.state = s; scp.st = Number(Q.get('st') || 0); if (s === 'chase' || s === 'trigger') world.setAlarm(true); if (s === 'wander') { scp.wanders = 3; scp.pickWander(); } }
  if (Q.get('p')) { const [x, z] = Q.get('p').split(',').map(Number); player.pos.set(x, 0, z); }
  if (Q.get('q') && npc096) { const [x, z] = Q.get('q').split(',').map(Number); scp.pos.set(x, 0, z); }
  if (Q.get('qy') && npc096) scp.yaw = Number(Q.get('qy')); if (npc096) npc096.hold = !!Q.get('hold');
  if (Q.get('y')) yaw = Number(Q.get('y')); if (Q.get('pi')) pitch = Number(Q.get('pi'));
  if (Q.get('fp')) { fp = true; player.setHeadVisible(false); }
  if (Q.get('run')) { inp.f = 1; inp.run = Q.get('run') === '2'; }
  window.__g = { get player() { return player; }, npc096, puppet, npcs, world, camera, inp };
} else buildSelect();

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20), t = clock.elapsedTime;
  pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
  if (state === 'play' || state === 'dead') {
    if (!DBG && !TOUCH) { inp.f = +!!keys.KeyW; inp.b = +!!keys.KeyS; inp.l = +!!keys.KeyA; inp.r = +!!keys.KeyD; }
    if (!DBG) { inp.run = !!(keys.ShiftLeft || keys.ShiftRight) || tRun; inp.crouch = !!(keys.KeyC || keys.ControlLeft) || tCrouch; }
    player.update(dt, inp, yaw, pitch, fp);
    if (npc096 && Q.get('freeze') !== '1') npc096.update(dt, player);
    for (const n of npcs) n.update(dt, camera, frustum, player.pos);
    world.update(dt, t, player, npc096 || dummy);
    // 힘센 SCP 는 달려서 부딪히기만 해도 문이 날아감
    if (player.av?.strong && player.speed > 3) { const d = nearestDoor(1.9 + player.r); if (d && (d.cx - player.pos.x) * player.vel.x + (d.cz - player.pos.z) * player.vel.z > 0) { d.burst(player.vel.clone().setY(0).normalize(), audio); shake = 0.8; } }
    updateCamera(dt);
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    // 얼굴 목격 판정 (D계급일 때)
    if (npc096 && KIND === 'dclass' && !player.dead && (!DBG || Q.get('see')) && npc096.checkSeen(camera, frustum, dt)) { npc096.trigger(); shake = 1; msg('당신은 SCP-096 의 얼굴을 보았다', true); }
    if (npc096 && !npc096.calm && !alarmOn) { alarmOn = true; audio.alarm(true); world.setAlarm(true); if (npc096.state === 'trigger') setObj('도망쳐라. 096 이 당신을 찾아온다'); }
    const v = puppet || npc096, d = npc096 ? npc096.pos.distanceTo(player.pos) : 99;
    const danger = !npc096 ? 0 : npc096.state === 'chase' ? clamp(1.2 - d / 25, 0.35, 1) : npc096.state === 'trigger' ? 0.45 : npc096.state === 'kill' || npc096.state === 'done' ? 1 : clamp(1 - d / 10, 0, 0.3);
    shake = Math.max(shake - dt * 1.5, npc096?.state === 'chase' ? clamp(1 - d / 12, 0, 0.7) : npc096?.state === 'trigger' ? 0.2 : puppet?.state === 'chase' ? 0.15 : 0);
    fx.uniforms.danger.value += (danger - fx.uniforms.danger.value) * Math.min(1, dt * 3);
    audio.update(dt, { fear: KIND !== 'dclass' ? 0 : npc096.calm ? clamp(1 - d / 12, 0, 0.5) : 1, tired: player.tired, mood: v.mood, pos096: v.headPos });
    audio.listen(camera);
    // 안내 문구
    let prompt = '';
    if (KIND === 'dclass') {
      const cd = Math.hypot(world.card.position.x - player.pos.x, world.card.position.z - player.pos.z);
      player.near = world.card.visible && cd < 1.7; if (player.near) prompt = TOUCH ? '[손] 키카드 줍기' : '[E] 키카드 줍기';
      const gate = world.doors.find(x => x.gate);
      if (gate.locked && Math.hypot(gate.cx - player.pos.x, gate.cz - player.pos.z) < 3.2 && !player.hasCard) prompt = 'LEVEL 3 키카드가 필요합니다';
    } else if (!player.av.phase && nearestDoor(2.8)) prompt = TOUCH ? '[손] 문 부수기' : '[E] 문 부수기';
    $('prompt').textContent = prompt;
    // 승리 / 사망
    if (at(cellOf(player.pos.x), cellOf(player.pos.z)) === 'E' && state === 'play' && !player.dead) {
      state = 'win'; audio.alarm(false); document.exitPointerLock?.();
      const sec = ((performance.now() - time0) / 1000).toFixed(1);
      $('wintag').textContent = KIND === 'dclass' ? 'GATE A · 탈출 성공' : 'GATE A · 격리 실패';
      $('wintitle').textContent = KIND === 'dclass' ? '생존' : '탈출';
      $('wintime').textContent = KIND === 'dclass' ? `탈출 시간 ${sec}초` + (alarmOn ? ' · 096 에게 쫓기며 탈출!' : ' · 096 은 끝까지 당신을 보지 못했다') : `${ROSTER.find(r => r.id === KIND).name} 이(가) ${sec}초 만에 시설을 빠져나갔다`;
      $('win').hidden = false; $('hud').hidden = true; $('touch').hidden = true;
    }
    if (player.dead) {
      deadT += dt; fx.uniforms.red.value = clamp(deadT / 1.5, 0, 0.85); fx.uniforms.fade.value = clamp((deadT - 2.4) / 1.2, 0, 1);
      if (deadT > 3.4 && state === 'play') { state = 'dead'; document.exitPointerLock?.(); $('dead').hidden = false; $('hud').hidden = true; $('touch').hidden = true; }
    }
    $('stam').style.width = player.stamina + '%';
    $('stam').style.background = player.exhausted ? '#c0392b' : '#e9e4d6';
    msgT -= dt; if (msgT < 0) $('msg').classList.remove('show');
  } else if (state === 'menu') {
    // 메뉴 배경: 096 격리실 안을 천천히 도는 카메라
    const a = t * 0.08; camera.position.set(npc096.pos.x + Math.sin(a) * 1.5, 2.3, npc096.pos.z - 4.5 + Math.cos(a) * 0.6);
    camera.lookAt(npc096.pos.x, 0.8, npc096.pos.z); npc096.update(dt, dummy); world.update(dt, t, dummy, npc096);
    for (const n of npcs) n.update(dt, camera, frustum, dummy.pos);
  }
  fx.uniforms.time.value = t;
  composer.render();
}
frame();
