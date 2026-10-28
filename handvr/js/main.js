import * as THREE from 'three';
import { createWorld } from './world.js';
import { Tracker } from './tracking.js';
import { HandState, assignHands, BONES, GESTURE_LABEL, recalibrateDepth } from './hands.js';
import { HandMesh, SKIN_TONES } from './hand-model.js';
import { Player } from './player.js';
import { Physics } from './physics.js';
import { BodyControl } from './body.js';

const $ = s => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;

// ───────── 설정 ─────────
const settings = { gestureMove: true, body: false, swap: false, preview: true, tone: 'medium' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('handvr') || '{}')); } catch { /* 저장소 없음 */ }
const save = () => { try { localStorage.setItem('handvr', JSON.stringify(settings)); } catch { /* 무시 */ } };

// ───────── 렌더러 / 장면 ─────────
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 3000);
const world = createWorld(scene, renderer);
const player = new Player(camera);
scene.add(player.rig);
const physics = new Physics(scene);
player.obstacles = physics.boxes;

const hands = { L: new HandState('L'), R: new HandState('R') };
const meshes = { L: new HandMesh('L', settings.tone), R: new HandMesh('R', settings.tone) };
camera.add(meshes.L.group, meshes.R.group);

// 주먹 조이스틱 표시 (기준점 고리 + 현재 손까지 선)
const joyMarks = {};
for (const s of ['L', 'R']) {
  const color = s === 'L' ? 0x2f8cff : 0xff8a3d;
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0025, 8, 40), mat);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false }));
  line.frustumCulled = false;
  ring.renderOrder = line.renderOrder = 10;
  g.add(ring, line);
  g.visible = false;
  camera.add(g);
  joyMarks[s] = { g, ring, line };
}

const tracker = new Tracker($('#cam'));
const body = new BodyControl();
let playing = false, camMode = false;

// ───────── 입력 (키보드 / 마우스) ─────────
const keys = {};
addEventListener('keydown', e => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (!playing) return;
  switch (e.code) {
    case 'KeyG': settings.gestureMove = !settings.gestureMove; toast(`손 제스처 이동 ${settings.gestureMove ? '켜짐' : '꺼짐'}`); save(); break;
    case 'KeyB': toggleBody(); break;
    case 'KeyK': recalibrateDepth(); body.recalibrate(); toast('기준 자세·손 거리를 다시 맞춥니다'); break;
    case 'KeyX': settings.swap = !settings.swap; toast('왼손 ↔ 오른손 바꿈'); save(); break;
    case 'KeyV': settings.preview = !settings.preview; save(); break;
    case 'KeyR': physics.reset(); toast('물체 리셋'); break;
    case 'KeyH': $('#help').classList.toggle('hidden'); break;
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const canvas = renderer.domElement;
let dragging = false;
canvas.addEventListener('mousedown', () => {
  if (!playing) return;
  dragging = true;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (!playing || (document.pointerLockElement !== canvas && !dragging)) return;
  player.look(e.movementX * 0.0022, e.movementY * 0.0022);
});
$('#help-btn').addEventListener('click', () => $('#help').classList.toggle('hidden'));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ───────── 시작 화면 ─────────
const optGesture = $('#opt-gesture'), optBody = $('#opt-body');
optGesture.checked = settings.gestureMove;
optBody.checked = settings.body;
optGesture.onchange = () => { settings.gestureMove = optGesture.checked; save(); };
optBody.onchange = () => { settings.body = optBody.checked; save(); };
for (const [name, hex] of Object.entries(SKIN_TONES)) {
  const b = document.createElement('button');
  b.style.background = '#' + hex.toString(16).padStart(6, '0');
  b.title = name;
  b.classList.toggle('on', name === settings.tone);
  b.onclick = () => {
    settings.tone = name; save();
    for (const m of Object.values(meshes)) m.setTone(name);
    document.querySelectorAll('#tones button').forEach(x => x.classList.toggle('on', x === b));
  };
  $('#tones').append(b);
}

const msg = (text, err = false) => { const m = $('#load-msg'); m.textContent = text; m.classList.toggle('err', err); };

$('#btn-start').onclick = async () => {
  const btns = [$('#btn-start'), $('#btn-kb')];
  btns.forEach(b => { b.disabled = true; });
  try {
    msg('카메라 권한을 요청하는 중… (브라우저 창에서 "허용"을 눌러주세요)');
    try { await tracker.startCamera(); } catch (e) { throw new Error(cameraError(e)); }
    msg('손 인식 AI 모델을 불러오는 중… (처음 한 번, 약 10MB)');
    try {
      await tracker.loadHands();
      if (settings.body) { msg('몸 인식 모델을 불러오는 중…'); await tracker.loadPose(); tracker.poseOn = true; }
    } catch (e) {
      console.error(e);
      throw new Error('AI 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (' + (e.message || e) + ')');
    }
    camMode = true;
    enterPlay();
    toast('손을 카메라 앞에 보여주세요 🖐', 3500);
  } catch (e) {
    msg(e.message, true);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
};
$('#btn-kb').onclick = () => { camMode = false; enterPlay(); toast('W A S D 이동 · 마우스로 둘러보기', 3000); };

function cameraError(e) {
  if (!window.isSecureContext) return '카메라는 https 또는 http://localhost 주소에서만 쓸 수 있어요. (README의 실행 방법 참고)';
  if (e.name === 'NotAllowedError') return '카메라 권한이 거부되었어요. 주소창의 카메라 아이콘에서 허용해 주세요.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return '사용할 수 있는 카메라가 없어요.';
  if (e.name === 'NotReadableError') return '다른 프로그램이 카메라를 쓰고 있어요. 그 프로그램을 닫고 다시 시도해 주세요.';
  return '카메라를 켜지 못했어요: ' + e.message;
}

function enterPlay() {
  playing = true;
  $('#start').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#preview-box').classList.toggle('hidden', !camMode || !settings.preview);
  if (!camMode) { $('#chip-L').classList.add('hidden'); $('#chip-R').classList.add('hidden'); }
}

async function toggleBody() {
  if (!camMode) { toast('몸 추적은 카메라 모드에서만 쓸 수 있어요'); return; }
  settings.body = !settings.body; save();
  if (settings.body) {
    if (!tracker.pose) {
      toast('몸 인식 모델 불러오는 중…', 4000);
      try { await tracker.loadPose(); } catch (e) { console.error(e); settings.body = false; toast('몸 인식 모델을 불러오지 못했어요'); return; }
    }
    body.recalibrate();
    tracker.poseOn = true;
    toast('몸 추적 켜짐 — 1.5초간 편한 자세로 정면을 보세요', 3000);
  } else {
    tracker.poseOn = false;
    toast('몸 추적 꺼짐');
  }
}

let toastTimer = 0;
function toast(text, ms = 1800) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ───────── 추적 결과 처리 ─────────
const view = { tanV: 1, tanH: 1 };
function onTracking(now) {
  const v = tracker.video, res = tracker.handResult;
  view.tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  view.tanH = view.tanV * camera.aspect;
  const slot = assignHands(res, settings.swap);
  for (const s of ['L', 'R']) {
    const i = slot[s];
    if (i >= 0) hands[s].ingest(res.landmarks[i], res.worldLandmarks[i], v.videoWidth, v.videoHeight, view, now, lostMs());
  }
  if (settings.body && tracker.poseOn) body.update(tracker.poseResult?.landmarks?.[0], v.videoWidth / v.videoHeight, now);
  drawPreview();
}

const lostMs = () => clamp(tracker.interval * 3, 220, 1500);
const dz = (v, dead = 0.18) => Math.sign(v) * clamp((Math.abs(v) - dead) / (1 - dead), 0, 1);

// 키보드 + 손 제스처 + 몸 추적 → 이동 입력
function gatherInput() {
  const k = c => (keys[c] ? 1 : 0);
  const inp = {
    forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'),
    strafe: k('KeyD') - k('KeyA'),
    turn: k('ArrowRight') + k('KeyE') - k('ArrowLeft') - k('KeyQ'),
    pitch: 0,
    run: !!(keys.ShiftLeft || keys.ShiftRight),
    jump: !!keys.Space,
    crouch: !!keys.KeyC,
  };
  for (const s of ['L', 'R']) {
    const h = hands[s];
    h.action = '';
    if (!h.visible || !settings.gestureMove) { h.joy = null; h.lastG = h.gesture; continue; }
    const g = h.gesture;
    if (h.holding) h.action = '잡는 중 — 손을 펴면 던지기';
    else if (h.pulling) h.action = '끌어오는 중…';
    if (g === 'fist' && !h.holding && !h.pulling) {
      if (!h.joy) h.joy = h.palmCam.clone();
      const dx = h.palmCam.x - h.joy.x, dy = h.palmCam.y - h.joy.y, dzv = h.palmCam.z - h.joy.z;
      if (s === 'L') {
        inp.forward += dz(clamp(-dzv / 0.09, -1, 1));
        inp.strafe += dz(clamp(dx / 0.09, -1, 1));
        h.action = '이동 조이스틱 (밀기·당기기·좌우)';
      } else {
        inp.turn += dz(clamp(dx / 0.08, -1, 1));
        inp.pitch += dz(clamp(dy / 0.08, -1, 1));
        h.action = '시점 조이스틱 (좌우·위아래)';
      }
    } else h.joy = null;
    if (g === 'point' || g === 'victory') {
      // 손가락 기울기(거울 화면 기준)로 회전
      const vid = tracker.video;
      const vx = -(h.img[8].x - h.img[5].x) * vid.videoWidth, vy = -(h.img[8].y - h.img[5].y) * vid.videoHeight;
      const tilt = Math.atan2(vx, vy);
      inp.turn += dz(clamp(tilt / 0.7, -1, 1), 0.2);
      inp.forward += g === 'point' ? 1 : -0.75;
      h.action = g === 'point' ? '앞으로 걷기 (기울이면 회전)' : '뒤로 걷기';
    }
    if (g === 'thumbsUp' && h.lastG !== 'thumbsUp') { inp.jump = true; toast('점프! 👍', 700); }
    if (g === 'thumbsUp') h.action = '점프';
    h.lastG = g;
  }
  if (settings.gestureMove && hands.L.gesture === 'point' && hands.R.gesture === 'point') {
    inp.run = true; hands.L.action = hands.R.action = '달리기!';
  }
  if (settings.body && tracker.poseOn && body.base) {
    inp.forward += body.out.forward;
    inp.turn += body.out.turn;
    inp.crouch ||= body.out.crouch;
    inp.jump ||= body.out.jump;
  }
  inp.forward = clamp(inp.forward, -1, 1);
  inp.strafe = clamp(inp.strafe, -1, 1);
  inp.turn = clamp(inp.turn, -1, 1);
  inp.pitch = clamp(inp.pitch, -1, 1);
  return inp;
}

function handColliders() {
  const out = [];
  for (const h of Object.values(hands)) {
    if (!h.visible) continue;
    for (const i of [4, 8, 12, 16, 20]) out.push({ p: h.world[i], v: h.vel[i], r: 0.011, hand: h });
    for (const i of [2, 3, 6, 7, 10, 11, 14, 15, 18, 19]) out.push({ p: h.world[i], v: h.vel[i], r: 0.0105, hand: h });
    out.push({ p: h.palmWorld, v: h.palmVel, r: 0.034, hand: h });
  }
  return out;
}

// ───────── 카메라 미리보기 (거울 화면 + 인식된 뼈대) ─────────
const pv = $('#preview'), pctx = pv.getContext('2d');
function drawPreview() {
  const show = camMode && settings.preview;
  $('#preview-box').classList.toggle('hidden', !show);
  if (!show) return;
  const v = tracker.video;
  const W = 320, H = Math.round(320 * v.videoHeight / v.videoWidth) || 180;
  if (pv.height !== H) pv.height = H;
  pctx.save();
  pctx.translate(W, 0); pctx.scale(-1, 1);
  pctx.drawImage(v, 0, 0, W, H);
  pctx.restore();
  pctx.lineWidth = 2.5;
  for (const s of ['L', 'R']) {
    const h = hands[s];
    if (!h.visible || tracker.video.currentTime === undefined) continue;
    pctx.strokeStyle = s === 'L' ? '#2f8cff' : '#ff8a3d';
    pctx.fillStyle = '#fff';
    const P = i => [(1 - h.img[i].x) * W, h.img[i].y * H];
    pctx.beginPath();
    for (const [a, b] of BONES) { pctx.moveTo(...P(a)); pctx.lineTo(...P(b)); }
    pctx.stroke();
    for (let i = 0; i < 21; i++) { const [x, y] = P(i); pctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    const [x, y] = P(0);
    pctx.font = 'bold 12px sans-serif'; pctx.fillStyle = pctx.strokeStyle;
    pctx.fillText(s === 'L' ? '왼손' : '오른손', x - 14, Math.min(H - 4, y + 16));
  }
  const pl = tracker.poseResult?.landmarks?.[0];
  if (settings.body && tracker.poseOn && pl) {
    const P = i => [(1 - pl[i].x) * W, pl[i].y * H];
    pctx.strokeStyle = '#7bd389'; pctx.lineWidth = 3;
    pctx.beginPath(); pctx.moveTo(...P(11)); pctx.lineTo(...P(12)); pctx.moveTo(...P(0)); pctx.lineTo((P(11)[0] + P(12)[0]) / 2, (P(11)[1] + P(12)[1]) / 2); pctx.stroke();
  }
}

// ───────── HUD ─────────
let hudT = 0, fpsN = 0, fps = 0, fpsT = 0;
function updateHud(now) {
  fpsN++;
  if (now - fpsT > 1000) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; }
  if (now - hudT < 120) return;
  hudT = now;
  const parts = [];
  if (camMode) {
    const n = (hands.L.visible ? 1 : 0) + (hands.R.visible ? 1 : 0);
    parts.push(`손 ${n}개 인식`, `제스처 이동 ${settings.gestureMove ? 'ON' : 'OFF'}`, `몸 추적 ${settings.body ? 'ON' : 'OFF'}`, `추적 ${tracker.rate}fps`);
  } else parts.push('키보드 모드');
  parts.push(`화면 ${fps}fps`);
  $('#status').textContent = parts.join(' · ');
  if (camMode) for (const s of ['L', 'R']) {
    const h = hands[s], chip = $('#chip-' + s);
    chip.querySelector('.g').textContent = h.visible ? GESTURE_LABEL[h.gesture] : '안 보임';
    chip.querySelector('.a').textContent = h.action;
    chip.style.opacity = h.visible ? 1 : 0.55;
  }
  const bc = $('#chip-B');
  bc.classList.toggle('hidden', !(camMode && settings.body));
  if (camMode && settings.body) {
    bc.querySelector('.g').textContent = body.out.label;
    bc.querySelector('.a').textContent = body.base ? '' : '(K: 다시 보정)';
  }
}

function updateJoyMarks() {
  for (const s of ['L', 'R']) {
    const h = hands[s], m = joyMarks[s];
    m.g.visible = !!(h.visible && h.joy);
    if (!m.g.visible) continue;
    m.ring.position.copy(h.joy);
    m.ring.lookAt(camera.getWorldPosition(new THREE.Vector3()));
    const a = m.line.geometry.attributes.position.array;
    a[0] = h.joy.x; a[1] = h.joy.y; a[2] = h.joy.z;
    a[3] = h.palmCam.x; a[4] = h.palmCam.y; a[5] = h.palmCam.z;
    m.line.geometry.attributes.position.needsUpdate = true;
  }
}

// ───────── 메인 루프 ─────────
let last = performance.now();
const camPos = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (playing && camMode && tracker.update(now)) onTracking(now);
  const inp = playing ? gatherInput() : { forward: 0, strafe: 0, turn: 0, pitch: 0 };
  player.update(dt, inp);

  for (const s of ['L', 'R']) {
    const h = hands[s];
    h.updateDisplay(dt, camera, now, lostMs());
    meshes[s].group.visible = h.visible;
    if (h.visible) meshes[s].update(h.joints, h.sign);
  }
  camera.getWorldPosition(camPos);
  physics.updateHands(Object.values(hands), camPos);
  physics.step(dt, handColliders());
  world.update(dt, player.pos);
  updateJoyMarks();
  if (playing) updateHud(now);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// 디버그용
window.__handvr = { hands, meshes, tracker, player, physics, settings, body };
