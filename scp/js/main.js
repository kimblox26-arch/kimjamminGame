import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { find, center, cellOf, at, blocks, WALL_H } from './map.js';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { SCP096 } from './scp096.js';
import { AudioSys } from './audio.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const Q = new URLSearchParams(location.search), DBG = Q.get('dbg');

const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030304);
scene.fog = new THREE.FogExp2(0x040405, 0.038);
scene.add(new THREE.HemisphereLight(0x8a96a8, 0x2a2018, 0.35));
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 120);

const audio = new AudioSys();
const world = buildWorld(scene, audio);
const sp = find('P')[0];
const player = new Player(scene, world, audio, { x: center(sp.x), z: center(sp.y) });
const scp = new SCP096(scene, world, audio);

// 손전등 (그림자)
const flash = new THREE.SpotLight(0xfff1dc, 22, 26, 0.45, 0.5, 1.6);
flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.bias = -0.0005; flash.shadow.camera.near = 0.2;
scene.add(flash, flash.target);

// 후처리: 블룸 + (비네트·필름 그레인·색수차·위험 왜곡)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 0.92);
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

// ── 입력 ──
const keys = {}, inp = { f: 0, b: 0, l: 0, r: 0, run: false, jump: false, crouch: false };
let yaw = Math.PI, pitch = -0.12, fp = false, flashOn = true, state = 'menu', time0 = 0, shake = 0, deadT = 0, msgT = 0;
addEventListener('keydown', e => {
  if (e.repeat) return; keys[e.code] = true;
  if (state !== 'play') { if (e.code === 'KeyR' && (state === 'dead' || state === 'win')) location.reload(); return; }
  if (e.code === 'Space') { inp.jump = true; e.preventDefault(); }
  if (e.code === 'KeyV') { fp = !fp; player.rig.bones.head.visible = !fp; }
  if (e.code === 'KeyF') { flashOn = !flashOn; flash.visible = flashOn; audio.unlock(); }
  if (e.code === 'KeyE' && player.near && !player.hasCard) { player.hasCard = true; world.card.visible = false; audio.pickup(); msg('LEVEL 3 키카드를 얻었다'); setObj('Gate A 로 탈출하라 (복도 동쪽 끝, 위쪽 게이트)'); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement || state !== 'play') return;
  yaw -= e.movementX * 0.0022; pitch = clamp(pitch - e.movementY * 0.0022, -1.25, 1.1);
});
document.addEventListener('pointerlockchange', () => { if (state === 'play' && !DBG) $('pause').hidden = !!document.pointerLockElement; });
$('pause').onclick = () => renderer.domElement.requestPointerLock();
$('start').onclick = () => {
  audio.init(); $('menu').hidden = true; $('hud').hidden = false; state = 'play'; time0 = performance.now();
  renderer.domElement.requestPointerLock();
  msg('SCP-096 의 얼굴을 절대 보지 마라');
};
const setObj = t => { $('obj').textContent = '목표: ' + t; };
function msg(t, red) { const m = $('msg'); m.textContent = t; m.className = red ? 'red show' : 'show'; msgT = 4; }

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ── 카메라 ──
const pivot = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
let pivotY = 1.6;
function camBlocked(p) { return blocks(cellOf(p.x), cellOf(p.z)) || p.y < 0.15 || p.y > WALL_H - 0.12; }
function updateCamera(dt) {
  const fwd = tmp.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  if (player.dead) { // 096 얼굴을 강제로 보게 됨
    const hp = player.rig.bones.head.getWorldPosition(new THREE.Vector3());
    camera.position.lerp(hp.add(new THREE.Vector3(0, 0.2, 0)), Math.min(1, dt * 3));
    camTarget.lerp(scp.headPos, Math.min(1, dt * 6)); camera.lookAt(camTarget);
  } else if (fp) {
    player.rig.bones.head.getWorldPosition(camera.position); camera.position.y += 0.08;
    camera.position.addScaledVector(fwd, 0.12);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  } else {
    pivotY += (1.62 - player.crouch * 0.5 + player.pos.y - pivotY) * Math.min(1, dt * 12);
    pivot.set(player.pos.x, pivotY, player.pos.z);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const want = pivot.clone().addScaledVector(right, 0.5).addScaledVector(fwd, -3.0);
    // 벽 충돌: 피벗에서 원하는 위치까지 조금씩 전진
    const p = pivot.clone(), step = want.clone().sub(pivot).divideScalar(30);
    for (let i = 0; i < 30; i++) { p.add(step); if (camBlocked(p)) { p.sub(step).sub(step); break; } }
    camera.position.copy(p);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.08; camera.position.y += (Math.random() - 0.5) * shake * 0.08; camera.rotation.z += (Math.random() - 0.5) * shake * 0.03; }
  camera.updateMatrixWorld();
  // 손전등: 가슴에서 시선 방향
  player.rig.bones.chest.getWorldPosition(flash.position); flash.position.y += 0.15;
  flash.target.position.copy(camera.position).addScaledVector(camera.getWorldDirection(tmp), 14);
}

// ── 디버그(스크린샷용): ?dbg=1&s=chase&cam=x,y,z&look=x,y,z ──
if (DBG) {
  $('menu').hidden = true; $('hud').hidden = false; state = 'play';
  const s = Q.get('s'); if (s) { scp.state = s; scp.st = Number(Q.get('st') || 0); if (s === 'chase' || s === 'trigger') world.setAlarm(true); if (s === 'wander') { scp.wanders = 3; scp.pickWander(); } }
  if (Q.get('p')) { const [x, z] = Q.get('p').split(',').map(Number); player.pos.set(x, 0, z); }
  if (Q.get('q')) { const [x, z] = Q.get('q').split(',').map(Number); scp.pos.set(x, 0, z); }
  if (Q.get('qy')) scp.yaw = Number(Q.get('qy')); scp.hold = !!Q.get('hold');
  if (Q.get('y')) yaw = Number(Q.get('y')); if (Q.get('pi')) pitch = Number(Q.get('pi'));
  if (Q.get('fp')) { fp = true; player.rig.bones.head.visible = false; }
  if (Q.get('run')) { inp.f = 1; inp.run = Q.get('run') === '2'; }
  window.__g = { player, scp, world, camera, inp };
}

setObj('관측실에서 LEVEL 3 키카드를 찾아라');
const clock = new THREE.Clock();
let alarmOn = false;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 1 / 20), t = clock.elapsedTime;
  if (state === 'play' || state === 'dead') {
    if (!DBG) { inp.f = +!!keys.KeyW; inp.b = +!!keys.KeyS; inp.l = +!!keys.KeyA; inp.r = +!!keys.KeyD; inp.run = !!(keys.ShiftLeft || keys.ShiftRight); inp.crouch = !!(keys.KeyC || keys.ControlLeft); }
    player.update(dt, inp, yaw, pitch, fp);
    if (Q.get('freeze') !== '1') scp.update(dt, player);
    world.update(dt, t, player, scp);
    updateCamera(dt);
    // 얼굴 목격 판정
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    if (!player.dead && (!DBG || Q.get('see')) && scp.checkSeen(camera, frustum, dt)) { scp.trigger(); shake = 1; msg('당신은 SCP-096 의 얼굴을 보았다', true); }
    if (!scp.calm && !alarmOn) { alarmOn = true; audio.alarm(true); world.setAlarm(true); if (scp.state === 'trigger') setObj('도망쳐라. 096 이 당신을 찾아온다'); }
    const d = scp.pos.distanceTo(player.pos);
    const danger = scp.state === 'chase' ? clamp(1.2 - d / 25, 0.35, 1) : scp.state === 'trigger' ? 0.45 : scp.state === 'kill' || scp.state === 'done' ? 1 : clamp(1 - d / 10, 0, 0.3);
    shake = Math.max(shake - dt * 1.5, scp.state === 'chase' ? clamp(1 - d / 12, 0, 0.7) : scp.state === 'trigger' ? 0.2 : 0);
    fx.uniforms.danger.value += (danger - fx.uniforms.danger.value) * Math.min(1, dt * 3);
    audio.update(dt, { fear: scp.calm ? clamp(1 - d / 12, 0, 0.5) : 1, tired: player.tired, mood: scp.mood, pos096: scp.headPos });
    audio.listen(camera);
    // 키카드
    const cd = Math.hypot(world.card.position.x - player.pos.x, world.card.position.z - player.pos.z);
    player.near = world.card.visible && cd < 1.7;
    $('prompt').textContent = player.near ? '[E] 키카드 줍기' : '';
    const gate = world.doors.find(x => x.gate);
    if (gate.locked && Math.hypot(gate.cx - player.pos.x, gate.cz - player.pos.z) < 3.2 && !player.hasCard) $('prompt').textContent = 'LEVEL 3 키카드가 필요합니다';
    // 승리 / 사망
    if (at(cellOf(player.pos.x), cellOf(player.pos.z)) === 'E' && state === 'play' && !player.dead) {
      state = 'win'; audio.alarm(false); document.exitPointerLock();
      $('wintime').textContent = `탈출 시간 ${((performance.now() - time0) / 1000).toFixed(1)}초` + (alarmOn ? ' · 096 에게 쫓기며 탈출!' : ' · 096 은 끝까지 당신을 보지 못했다');
      $('win').hidden = false; $('hud').hidden = true;
    }
    if (player.dead) {
      deadT += dt; fx.uniforms.red.value = clamp(deadT / 1.5, 0, 0.85); fx.uniforms.fade.value = clamp((deadT - 2.4) / 1.2, 0, 1);
      if (deadT > 3.4 && state === 'play') { state = 'dead'; document.exitPointerLock(); $('dead').hidden = false; $('hud').hidden = true; }
    }
    // HUD
    $('stam').style.width = player.stamina + '%';
    $('stam').style.background = player.exhausted ? '#c0392b' : '#e9e4d6';
    msgT -= dt; if (msgT < 0) $('msg').classList.remove('show');
  } else if (state === 'menu') {
    // 메뉴 배경: 096 쪽을 천천히 도는 카메라 (얼굴은 안 보이게 뒤쪽)
    const a = t * 0.08; camera.position.set(scp.pos.x + Math.sin(a) * 1.5 - 0, 2.3, scp.pos.z - 4.5 + Math.cos(a) * 0.6);
    camera.lookAt(scp.pos.x, 0.8, scp.pos.z); scp.update(dt, player); world.update(dt, t, player, scp);
  }
  fx.uniforms.time.value = t;
  composer.render();
}
frame();
